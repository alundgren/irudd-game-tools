import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalJson,
  createRegistry,
  defaultFrameCreatureParams,
  defineFeature,
  defineGenerator,
  DocumentId,
  documentAccess,
  emptyState,
  frameCreatureSlots,
  FrameCreatureParams,
  isUndone,
  journalJson,
  memoryEnvironment,
  openJournal,
  reduce,
  replayJournal,
  type CommandEnvelopeInput,
  type DocumentState,
  type Environment,
  digestJson,
  isJson,
  isJsonArray,
  isJsonObject,
  type JournalEntry,
  type Json,
  type JsonObject,
} from "@irudd/document";
import { Schema } from "effect";
import {
  agent,
  committed,
  docId,
  envelope,
  environment,
  generatedCreature,
  human,
  partBySlot,
  rejected,
  requestId,
  run,
} from "./support/fixtures.js";

const env = environment();

function stored(journal: ReadonlyArray<JournalEntry>): JsonObject[] {
  return journal.map((e) => {
    const parsed: unknown = JSON.parse(canonicalJson(journalJson(e)));
    assert.ok(isJson(parsed) && isJsonObject(parsed));
    return parsed;
  });
}

function entryAt(s: DocumentState, i: number): JournalEntry {
  const entry = s.journal[i < 0 ? s.journal.length + i : i];
  assert.ok(entry, `no journal entry ${i}`);
  return entry;
}

function field(value: Json | undefined): JsonObject {
  assert.ok(isJsonObject(value));
  return value;
}

function box(id: string, label: string, features: object = {}): Record<string, unknown> {
  return {
    id,
    label,
    parent: null,
    shape: "box",
    position: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    size: [1, 1, 1],
    color: "#808080",
    sculpt: [],
    features,
  };
}

function manual(parts: unknown[], requires: unknown[] = [{ feature: "core.parts", version: 1 }]) {
  return {
    format: "irudd.character",
    version: 1,
    id: docId,
    label: "Journal",
    requires,
    catalog: [],
    assets: [],
    parts,
    poses: [],
    features: {},
    extensions: {},
  };
}

const rename = (part: string, label: string): CommandEnvelopeInput["command"] => ({
  type: "edit",
  ops: [{ op: "part.rename", part, label }],
});

test("sparse arrays cannot enter the journal through creation, editing or a draft", () => {
  const sparse: Json[] = [];
  sparse[2] = "end";
  const clean = manual([box("p-a", "A")]);
  const document = { ...clean, extensions: { "org.test": { list: sparse } } };
  const empty = emptyState(docId);
  const s = run(empty, env, envelope(human, 0, { type: "document.create", document: clean }));
  for (const [state, command] of [
    [empty, { type: "document.create", document }],
    [s, { type: "edit", ops: [{ op: "extension.set", namespace: "org.test", value: sparse }] }],
    [
      s,
      {
        type: "proposal.create",
        proposal: "prop-sparse",
        summary: "replace",
        content: { kind: "replace", document },
      },
    ],
  ] as const) {
    const result = reduce(state, envelope(human, state.head, command), env);
    assert.equal(result.outcome.kind, "rejected");
    assert.equal(result.state, state);
  }
  assert.throws(() => canonicalJson(sparse), TypeError);
  assert.equal(canonicalJson([null, null, "end"]), '[null,null,"end"]');
});

test("caller objects stay theirs and nothing reachable from a state can be changed", () => {
  const doc = manual([box("p-a", "A")]);
  const create = envelope(human, 0, { type: "document.create", document: doc });
  const ops = [{ op: "part.rename" as const, part: "p-a", label: "Renamed" }];
  const edit = envelope(human, 1, { type: "edit", ops });
  const s = run(emptyState(docId), env, create, edit);
  const bytes = canonicalJson(journalJson(entryAt(s, 1)));

  assert.ok(!Object.isFrozen(doc) && !Object.isFrozen(create) && !Object.isFrozen(edit));
  doc.label = "MUTATED";
  doc.parts.push(box("p-junk", "junk"));
  ops.push({ op: "part.rename", part: "p-a", label: "MUTATED" });
  if (ops[0]) ops[0].label = "MUTATED-OP";
  assert.equal(s.document?.label, "Journal");
  assert.equal(s.document?.parts.length, 1);
  assert.equal(canonicalJson(journalJson(entryAt(s, 1))), bytes);
  assert.ok(openJournal(docId, s.journal, env).ok);

  const part = s.document?.parts[0];
  assert.throws(() => Object.assign(part ?? {}, { label: "X" }), TypeError);
  assert.throws(() => Reflect.apply(Array.prototype.push, s.history, [null]), TypeError);
  assert.throws(() => Object.assign(s.journal[0]?.envelope ?? {}, { requestId: "x" }), TypeError);
  assert.throws(() => Object.assign(s.history[0]?.document.parts ?? [], { 0: null }), TypeError);
  const receipts: unknown = s.receipts;
  assert.ok(!(receipts instanceof Map));
  assert.throws(() => Map.prototype.set.call(receipts, "x", 1), TypeError);
  assert.equal(typeof Reflect.get(s.receipts, "set"), "undefined");
  assert.equal(typeof Reflect.get(s.retired, "add"), "undefined");
  assert.equal(s.history[1]?.document.parts[0]?.label, "Renamed");
  assert.equal(s.history[0]?.document.parts[0]?.label, "A");
});

test("a faulty generator rejects its request without appending a journal entry", () => {
  const faulty = defineGenerator({
    id: "org.test.faulty",
    version: 1,
    label: "Faulty generator",
    schema: FrameCreatureParams,
    toJson: (p) => p,
    generate: () => {
      throw new Error("cannot build this shape");
    },
  });
  const initial = emptyState(docId);
  const result = reduce(
    initial,
    envelope(human, 0, {
      type: "document.generate",
      label: "Example",
      generator: faulty.id,
      version: 1,
      params: defaultFrameCreatureParams,
    }),
    memoryEnvironment(createRegistry({ generators: [faulty] })),
  );
  assert.equal(rejected(result.outcome).diagnostics[0]?.code, "generator-failed");
  assert.equal(result.state, initial);
});

test("generator output is copied, so a generator's own data is never frozen", () => {
  const shared = frameCreatureSlots(defaultFrameCreatureParams);
  const leaky = defineGenerator({
    id: "org.test.leaky",
    version: 1,
    label: "Leaky",
    schema: FrameCreatureParams,
    toJson: (p) => p,
    generate: () => shared,
  });
  const e = memoryEnvironment(createRegistry({ generators: [leaky] }));
  run(
    emptyState(docId),
    e,
    envelope(human, 0, {
      type: "document.generate",
      label: "L",
      generator: "org.test.leaky",
      version: 1,
      params: defaultFrameCreatureParams,
    }),
  );
  assert.ok(!Object.isFrozen(shared) && !Object.isFrozen(shared[0]));
});

function richState(e: Environment = env): DocumentState {
  let s = generatedCreature(e);
  const trunk = partBySlot(s, "trunk");
  const tail = partBySlot(s, "tail");
  s = run(
    s,
    e,
    envelope(human, 1, {
      type: "edit",
      ops: [
        {
          op: "sculpt.at",
          part: trunk.id,
          edit: "d-hump",
          world: [0, 0.85, 0.1],
          offset: [0, 0.03, 0],
          radius: 0.08,
        },
      ],
    }),
    envelope(human, 2, rename(tail.id, "Brush")),
    envelope(human, 3, { type: "undo", target: 3 }),
    envelope(agent, 4, {
      type: "proposal.create",
      proposal: "prop-open",
      summary: "open",
      content: { kind: "ops", ops: [{ op: "document.label", label: "Fen walker" }] },
    }),
    envelope(agent, 4, {
      type: "proposal.create",
      proposal: "prop-gone",
      summary: "gone",
      content: { kind: "ops", ops: [{ op: "document.label", label: "Gone" }] },
    }),
    envelope(agent, 4, { type: "proposal.discard", proposal: "prop-gone" }),
    envelope(human, 4, { type: "policy.set", agentDirectEdit: true }),
  );
  return s;
}

function summary(s: DocumentState): string {
  const plain: unknown = JSON.parse(
    JSON.stringify({
      head: s.head,
      document: s.document,
      history: s.history,
      receipts: [...s.receipts],
      proposals: [...s.proposals],
      policy: s.policy,
      retired: [...s.retired],
      undone: [...s.undone],
      undos: [...s.undos],
      journal: s.journal,
    }),
  );
  assert.ok(isJson(plain));
  return canonicalJson(plain);
}

test("recovery rebuilds every part of the state from stored bytes", () => {
  const s = richState();
  const r = openJournal(docId, stored(s.journal), env, {
    last: { sequence: s.journal.length, digest: entryAt(s, -1).digest },
  });
  assert.ok(r.ok, JSON.stringify(!r.ok && r.diagnostics));
  assert.equal(summary(r.state), summary(s));
  assert.equal(r.access.mode, "writable");
  assert.equal(r.state.proposals.get("prop-open")?.status, "draft");
  assert.equal(r.state.proposals.get("prop-gone")?.status, "discarded");
  assert.ok(isUndone(r.state, 3));
  const retry = reduce(r.state, entryAt(s, 1).envelope, env);
  assert.equal(retry.outcome.kind, "replayed");
  const next = reduce(r.state, envelope(agent, 4, { type: "undo", target: 2 }), env);
  committed(next.outcome);
});

test("recovery needs no generator: a retired or changed generator still opens", () => {
  const s = richState();
  const changed = defineGenerator({
    id: "irudd.frame-creature",
    version: 1,
    label: "changed",
    schema: FrameCreatureParams,
    toJson: (p) => p,
    generate: (p) => frameCreatureSlots(p).map((x) => ({ ...x, color: "#5f7a59" })),
  });
  const changedEnv = memoryEnvironment(createRegistry({ generators: [changed] }));
  const retiredEnv = memoryEnvironment(createRegistry({ generators: [] }));

  const a = openJournal(docId, stored(s.journal), changedEnv);
  assert.ok(a.ok);
  assert.equal(summary(a.state), summary(s));
  assert.equal(a.access.mode, "writable");

  const b = openJournal(docId, stored(s.journal), retiredEnv);
  assert.ok(b.ok);
  assert.equal(summary(b.state), summary(s));
  assert.equal(b.access.mode, "read-only");
  assert.equal(
    b.access.mode === "read-only" && b.access.diagnostics[0]?.code,
    "unsupported-generator",
  );
  const retry = reduce(b.state, entryAt(s, 2).envelope, retiredEnv);
  assert.deepEqual(
    retry.outcome.kind === "replayed" && retry.outcome.receipt,
    entryAt(s, 2).receipt,
  );
  const edit = reduce(
    b.state,
    envelope(human, s.head, rename(partBySlot(s, "head").id, "X")),
    retiredEnv,
  );
  assert.equal(edit.state, b.state);
  assert.deepEqual(
    rejected(edit.outcome).diagnostics.map((d) => d.code),
    ["read-only", "unsupported-generator"],
  );
  const policy = reduce(
    b.state,
    envelope(human, s.head, { type: "policy.set", agentDirectEdit: false }),
    retiredEnv,
  );
  committed(policy.outcome);

  const forensic = replayJournal(docId, stored(s.journal), changedEnv);
  assert.ok(!forensic.ok);
  assert.equal(forensic.index, 0);
  assert.equal(forensic.diagnostics[0]?.code, "journal-integrity");
  assert.ok(replayJournal(docId, stored(s.journal), env).ok);
});

test("a feature codec upgrade keeps old revisions and asks for an explicit upgrade", () => {
  const v1 = defineFeature({
    id: "org.test.tag",
    version: 1,
    scope: "part",
    schema: Schema.Struct({ tag: Schema.String }),
    toJson: (v) => v,
  });
  const v2 = defineFeature({
    id: "org.test.tag",
    version: 2,
    scope: "part",
    schema: Schema.Struct({ tags: Schema.Array(Schema.String) }),
    toJson: (v) => v,
    upgrades: [(p) => ({ tags: isJsonObject(p) ? [p["tag"] ?? null] : [] })],
  });
  const env1 = memoryEnvironment(createRegistry({ features: [v1] }));
  const env2 = memoryEnvironment(createRegistry({ features: [v2] }));
  const doc = manual(
    [box("p-a", "A", { "org.test.tag": { tag: "red" } })],
    [
      { feature: "core.parts", version: 1 },
      { feature: "org.test.tag", version: 1 },
    ],
  );
  const s = run(
    emptyState(docId),
    env1,
    envelope(human, 0, { type: "document.create", document: doc }),
    envelope(human, 1, rename("p-a", "B")),
  );
  const r = openJournal(docId, stored(s.journal), env2);
  assert.ok(r.ok);
  assert.deepEqual(
    r.state.history.map((h) => h.digest),
    s.history.map((h) => h.digest),
  );
  assert.equal(r.access.mode, "upgrade-required");
  const blocked = reduce(r.state, envelope(human, 2, rename("p-a", "C")), env2);
  assert.equal(rejected(blocked.outcome).diagnostics[0]?.code, "upgrade-required");
  const retry = reduce(r.state, entryAt(s, 1).envelope, env2);
  assert.equal(retry.outcome.kind, "replayed");

  const agentUpgrade = reduce(r.state, envelope(agent, 2, { type: "document.upgrade" }), env2);
  assert.equal(rejected(agentUpgrade.outcome).diagnostics[0]?.code, "proposal-required");
  const upgraded = reduce(r.state, envelope(human, 2, { type: "document.upgrade" }), env2);
  committed(upgraded.outcome);
  const u = upgraded.state;
  assert.equal(u.history[2]?.kind, "upgrade");
  assert.deepEqual(u.document?.parts[0]?.features, { "org.test.tag": { tags: ["red"] } });
  assert.equal(documentAccess(u, env2).mode, "writable");
  const again = reduce(u, envelope(human, 3, { type: "document.upgrade" }), env2);
  assert.equal(rejected(again.outcome).diagnostics[0]?.code, "no-change");
  assert.equal(
    rejected(reduce(u, envelope(human, 3, { type: "undo", target: 3 }), env2).outcome)
      .diagnostics[0]?.code,
    "not-undoable",
  );
  const after = run(u, env2, envelope(human, 3, rename("p-a", "C")));
  const reopened = openJournal(docId, stored(after.journal), env2);
  assert.ok(reopened.ok);
  assert.equal(reopened.access.mode, "writable");
  assert.equal(summary(reopened.state), summary(after));
  const old = openJournal(docId, stored(after.journal), env1);
  assert.ok(old.ok);
  assert.equal(old.access.mode, "read-only");
});

test("corruption, truncation and missing receipts fail the whole journal", () => {
  const s = richState();
  const good = stored(s.journal);
  const at = (i: number): JsonObject => field(good[i]);
  const without = (o: JsonObject, key: string): JsonObject =>
    Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));
  const cases: Array<[string, unknown[], number]> = [
    ["dropped middle entry", [...good.slice(0, 2), ...good.slice(3)], 2],
    ["swapped entries", [good[0], good[2], good[1], ...good.slice(3)], 1],
    ["missing receipt", good.map((e, i) => (i === 3 ? without(at(3), "receipt") : e)), 3],
    [
      "tampered receipt",
      good.map((e, i) =>
        i === 2 ? { ...at(2), receipt: { ...field(at(2)["receipt"]), revision: 9 } } : e,
      ),
      2,
    ],
    ["tampered effect", good.map((e, i) => (i === 1 ? { ...at(1), effect: {} } : e)), 1],
    ["not JSON", good.map((e, i) => (i === 4 ? "junk" : e)), 4],
    ["newer journal", good.map((e, i) => (i === 0 ? { ...at(0), version: 2 } : e)), 0],
  ];
  for (const [name, entries, index] of cases) {
    const r = openJournal(docId, entries, env);
    assert.ok(!r.ok, name);
    assert.equal(r.index, index, name);
  }
  const next = reduce(s, envelope(human, s.head, rename(partBySlot(s, "head").id, "Real")), env);
  const real = stored([committed(next.outcome).entry])[0];
  assert.ok(real);
  const revision = field(field(real["effect"])["revision"]);
  const changes = revision["changes"];
  assert.ok(isJsonArray(changes));
  const forgedBody = without(
    {
      ...real,
      effect: {
        ...field(real["effect"]),
        revision: {
          ...revision,
          changes: changes.map((c) => ({ ...field(c), after: "Forged" })),
        },
      },
    },
    "digest",
  );
  const forged = { ...forgedBody, digest: digestJson(forgedBody) };
  assert.ok(openJournal(docId, [...good, real], env).ok);
  const r = openJournal(docId, [...good, forged], env);
  assert.ok(!r.ok);
  assert.equal(r.index, good.length);
  assert.deepEqual(r.diagnostics[0]?.path, [good.length, "effect", "revision", "digest"]);
  const last = { sequence: s.journal.length, digest: entryAt(s, -1).digest };
  const truncated = openJournal(docId, good.slice(0, -1), env, { last });
  assert.ok(!truncated.ok);
  assert.equal(truncated.index, good.length - 1);
  assert.ok(!openJournal(docId, good, environment(), { last: { ...last, sequence: 1 } }).ok);
  const other = openJournal(Schema.decodeUnknownSync(DocumentId)("doc-fixture2"), good, env);
  assert.ok(!other.ok);
});

test("undo of an undo cannot re-instate a second undo of the same revision", () => {
  const s0 = run(
    emptyState(docId),
    env,
    envelope(human, 0, { type: "document.create", document: manual([box("p-x", "value 0")]) }),
  );
  const steps: Array<[CommandEnvelopeInput["command"], string, string]> = [
    [rename("p-x", "value 1"), "committed 2", "value 1"],
    [{ type: "undo", target: 2 }, "committed 3", "value 0"],
    [{ type: "undo", target: 3 }, "committed 4", "value 1"],
    [{ type: "undo", target: 2 }, "committed 5", "value 0"],
    [rename("p-x", "value 1"), "committed 6", "value 1"],
    [{ type: "undo", target: 4 }, "rejected already-undone", "value 1"],
    [{ type: "undo", target: 5 }, "rejected conflict", "value 1"],
    [{ type: "undo", target: 6 }, "committed 7", "value 0"],
    [{ type: "undo", target: 5 }, "committed 8", "value 1"],
    [{ type: "undo", target: 4 }, "committed 9", "value 0"],
    [{ type: "undo", target: 8 }, "rejected already-undone", "value 0"],
    [{ type: "undo", target: 9 }, "committed 10", "value 1"],
    [{ type: "undo", target: 2 }, "committed 11", "value 0"],
    [{ type: "undo", target: 10 }, "rejected already-undone", "value 0"],
    [{ type: "undo", target: 11 }, "committed 12", "value 1"],
  ];
  let s = s0;
  for (const [command, expected, label] of steps) {
    const step = reduce(s, envelope(human, s.head, command, requestId()), env);
    const got =
      step.outcome.kind === "rejected"
        ? `rejected ${step.outcome.diagnostics[0]?.code}`
        : `${step.outcome.kind} ${step.outcome.receipt.revision}`;
    assert.equal(got, expected, JSON.stringify(command));
    s = step.state;
    assert.equal(s.document?.parts[0]?.label, label, JSON.stringify(command));
    const inForce = new Map<number, number>();
    for (const r of s.history)
      if (r.undoes !== undefined && !isUndone(s, r.revision))
        inForce.set(r.undoes, (inForce.get(r.undoes) ?? 0) + 1);
    assert.ok(
      [...inForce.values()].every((n) => n === 1),
      expected,
    );
  }
  const r = openJournal(docId, stored(s.journal), env);
  assert.ok(r.ok);
  assert.deepEqual([...r.state.undone], [...s.undone]);
});

test("an agent discards only its own drafts while direct editing is off", () => {
  let s = generatedCreature(env);
  s = run(
    s,
    env,
    envelope(human, 1, {
      type: "proposal.create",
      proposal: "prop-person",
      summary: "mine",
      content: { kind: "ops", ops: [{ op: "document.label", label: "Mine" }] },
    }),
  );
  const step = reduce(
    s,
    envelope(agent, 1, { type: "proposal.discard", proposal: "prop-person" }),
    env,
  );
  assert.equal(step.state, s);
  assert.equal(rejected(step.outcome).diagnostics[0]?.code, "forbidden");
  const allowed = run(
    s,
    env,
    envelope(human, 1, { type: "policy.set", agentDirectEdit: true }),
    envelope(agent, 1, { type: "proposal.discard", proposal: "prop-person" }),
  );
  assert.equal(allowed.proposals.get("prop-person")?.status, "discarded");
});
