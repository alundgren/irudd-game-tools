// Revision protocol through the public entry: initialisation, manual commit,
// stale writes, retries, undo, restore, proposals and per-document policy.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attribution,
  changesSince,
  defaultFrameCreatureParams,
  emptyState,
  pathKey,
  previewProposal,
  openJournal,
  reduce,
  replayJournal,
} from "@irudd/document";
import {
  agent,
  blob,
  committed,
  docId,
  envelope,
  environment,
  generatedCreature,
  human,
  manualDocument,
  partBySlot,
  rejected,
  requestId,
  run,
} from "./support/fixtures.js";

const env = environment();

test("generating a document creates revision 1 with a stored generator base", () => {
  const s = generatedCreature(env);
  assert.equal(s.head, 1);
  assert.equal(s.history[0]?.kind, "create");
  const doc = s.document;
  assert.ok(doc?.generation);
  assert.equal(doc.generation.base.slots.length, doc.parts.length);
  assert.ok(doc.parts.every((p) => p.slot !== undefined));
  assert.deepEqual(
    doc.requires.map((r) => r.feature),
    ["core.generation", "core.parts"],
  );
});

test("one manual edit appends exactly one revision attributed to its actor", () => {
  const s0 = generatedCreature(env);
  const head = partBySlot(s0, "head");
  const step = reduce(
    s0,
    envelope(human, 1, {
      type: "edit",
      ops: [{ op: "part.transform", part: head.id, translate: [0, 0.02, 0] }],
    }),
    env,
  );
  const { receipt } = committed(step.outcome);
  assert.equal(receipt.revision, 2);
  assert.equal(step.state.history.length, 2);
  assert.deepEqual(
    step.state.history[1]?.changes.map((c) => c.path.join("/")),
    [`parts/${head.id}/position`],
  );
  assert.equal(
    attribution(step.state).get(pathKey(["parts", head.id, "position"]))?.actor.id,
    "user",
  );
});

test("a stale write changes nothing and names the head", () => {
  const s0 = generatedCreature(env);
  const head = partBySlot(s0, "head");
  const s1 = run(
    s0,
    env,
    envelope(human, 1, {
      type: "edit",
      ops: [{ op: "part.rename", part: head.id, label: "Skull" }],
    }),
  );
  const stale = reduce(
    s1,
    envelope(human, 1, {
      type: "edit",
      ops: [{ op: "part.rename", part: head.id, label: "Crown" }],
    }),
    env,
  );
  const r = rejected(stale.outcome);
  assert.equal(r.diagnostics[0]?.code, "stale-revision");
  assert.equal(stale.state, s1);
});

test("retrying a committed request returns the original receipt; reusing its ID fails", () => {
  const s0 = generatedCreature(env);
  const head = partBySlot(s0, "head");
  const id = requestId();
  const e = envelope(
    human,
    1,
    { type: "edit", ops: [{ op: "part.rename", part: head.id, label: "Skull" }] },
    id,
  );
  const first = reduce(s0, e, env);
  const original = committed(first.outcome).receipt;
  // The head moves on; the retry still replays.
  const s2 = run(
    first.state,
    env,
    envelope(human, 2, {
      type: "edit",
      ops: [{ op: "part.rename", part: head.id, label: "Crown" }],
    }),
  );
  const retry = reduce(s2, e, env);
  assert.equal(retry.outcome.kind, "replayed");
  assert.deepEqual(retry.outcome.kind === "replayed" ? retry.outcome.receipt : null, original);
  assert.equal(retry.state, s2);
  const reused = reduce(s2, { ...e, expectedRevision: 3 }, env);
  assert.equal(rejected(reused.outcome).diagnostics[0]?.code, "request-reused");
  assert.equal(reused.state, s2);
});

test("invalid commands and no-op edits leave no history", () => {
  const s0 = generatedCreature(env);
  const head = partBySlot(s0, "head");
  for (const bad of [
    { format: "irudd.command" },
    envelope(human, 1, { type: "edit", ops: [] }),
    envelope(human, 1, {
      type: "edit",
      ops: [{ op: "part.rename", part: "p-missing", label: "X" }],
    }),
    envelope(human, 1, {
      type: "edit",
      ops: [{ op: "part.rename", part: head.id, label: head.label }],
    }),
    envelope(human, 1, {
      type: "edit",
      ops: [{ op: "part.set", part: head.id, set: { parent: head.id } }],
    }),
    envelope(human, 1, {
      type: "edit",
      ops: [{ op: "part.remove", part: partBySlot(s0, "trunk").id, cascade: false }],
    }),
  ]) {
    const step = reduce(s0, bad, env);
    assert.equal(step.outcome.kind, "rejected");
    assert.equal(step.state, s0);
  }
});

test("undo appends a compensating revision and keeps the other actor's later edit", () => {
  let s = generatedCreature(env);
  s = run(s, env, envelope(human, 1, { type: "policy.set", agentDirectEdit: true }));
  const tail = partBySlot(s, "tail");
  const head = partBySlot(s, "head");
  s = run(
    s,
    env,
    envelope(agent, 1, {
      type: "edit",
      ops: [{ op: "part.transform", part: tail.id, scale: [1, 1, 0.5] }],
    }),
  );
  s = run(
    s,
    env,
    envelope(human, 2, { type: "edit", ops: [{ op: "part.rename", part: head.id, label: "Jaw" }] }),
  );
  s = run(s, env, envelope(human, 3, { type: "undo", target: 2 }));
  assert.equal(s.head, 4);
  assert.equal(s.history[3]?.undoes, 2);
  assert.deepEqual(partBySlot(s, "tail").size, tail.size);
  assert.equal(partBySlot(s, "head").label, "Jaw");
  // Undoing twice is refused; undoing the undo redoes.
  assert.equal(
    rejected(reduce(s, envelope(human, 4, { type: "undo", target: 2 }), env).outcome).diagnostics[0]
      ?.code,
    "already-undone",
  );
  s = run(s, env, envelope(human, 4, { type: "undo", target: 4 }));
  assert.deepEqual(partBySlot(s, "tail").size, [tail.size[0], tail.size[1], tail.size[2] * 0.5]);
});

test("undo of an edit whose field changed later is a field-specific conflict", () => {
  let s = generatedCreature(env);
  const head = partBySlot(s, "head");
  s = run(
    s,
    env,
    envelope(human, 1, { type: "edit", ops: [{ op: "part.rename", part: head.id, label: "Jaw" }] }),
  );
  s = run(
    s,
    env,
    envelope(human, 2, {
      type: "edit",
      ops: [{ op: "part.rename", part: head.id, label: "Snout" }],
    }),
  );
  const step = reduce(s, envelope(human, 3, { type: "undo", target: 2 }), env);
  const d = rejected(step.outcome).diagnostics[0];
  assert.equal(d?.code, "conflict");
  assert.deepEqual(d?.path, ["parts", head.id, "label"]);
  assert.deepEqual(d?.detail, {
    expected: "Jaw",
    found: "Snout",
    editedIn: { revision: 3, actor: { kind: "human", id: "user" } },
  });
  assert.equal(step.state, s);
  assert.equal(
    rejected(reduce(s, envelope(human, 3, { type: "undo", target: 1 }), env).outcome).diagnostics[0]
      ?.code,
    "not-undoable",
  );
});

test("restore appends a revision equal to an earlier document", () => {
  let s = generatedCreature(env);
  const head = partBySlot(s, "head");
  s = run(
    s,
    env,
    envelope(human, 1, { type: "edit", ops: [{ op: "part.rename", part: head.id, label: "Jaw" }] }),
  );
  s = run(
    s,
    env,
    envelope(human, 2, {
      type: "edit",
      ops: [{ op: "part.remove", part: head.id, cascade: true }],
    }),
  );
  s = run(s, env, envelope(human, 3, { type: "restore", revision: 1 }));
  assert.equal(s.head, 4);
  assert.equal(s.history[3]?.digest, s.history[0]?.digest);
  assert.equal(
    rejected(reduce(s, envelope(human, 4, { type: "restore", revision: 4 }), env).outcome)
      .diagnostics[0]?.code,
    "no-change",
  );
});

test("agents propose by default; a person accepts in one step", () => {
  let s = generatedCreature(env);
  const tail = partBySlot(s, "tail");
  const direct = reduce(
    s,
    envelope(agent, 1, {
      type: "edit",
      ops: [{ op: "part.rename", part: tail.id, label: "Brush" }],
    }),
    env,
  );
  assert.equal(rejected(direct.outcome).diagnostics[0]?.code, "proposal-required");
  assert.equal(
    rejected(
      reduce(s, envelope(agent, 1, { type: "policy.set", agentDirectEdit: true }), env).outcome,
    ).diagnostics[0]?.code,
    "forbidden",
  );

  s = run(
    s,
    env,
    envelope(agent, 1, {
      type: "proposal.create",
      proposal: "prop-tail",
      summary: "Shorter tail",
      content: { kind: "ops", ops: [{ op: "part.transform", part: tail.id, scale: [1, 1, 0.6] }] },
    }),
  );
  assert.equal(s.head, 1);
  assert.equal(s.proposals.get("prop-tail")?.status, "draft");
  s = run(
    s,
    env,
    envelope(agent, 1, {
      type: "proposal.refine",
      proposal: "prop-tail",
      version: 1,
      summary: "Shorter, lighter tail",
      content: {
        kind: "ops",
        ops: [
          { op: "part.transform", part: tail.id, scale: [1, 1, 0.6] },
          { op: "part.set", part: tail.id, set: { color: "#8aa07f" } },
        ],
      },
    }),
  );
  const accepted = reduce(
    s,
    envelope(human, 1, { type: "proposal.accept", proposal: "prop-tail", version: 2 }),
    env,
  );
  committed(accepted.outcome);
  const record = accepted.state.history[1];
  assert.equal(record?.kind, "proposal");
  assert.equal(record?.actor.id, "user");
  assert.equal(record?.author.id, "assistant");
  assert.equal(accepted.state.proposals.get("prop-tail")?.status, "accepted");
  assert.equal(partBySlot(accepted.state, "tail").color, "#8aa07f");
});

test("acceptance credits the editor of the accepted version and retains the draft creator", () => {
  const s = generatedCreature(env);
  const tail = partBySlot(s, "tail");
  const draft = {
    proposal: "prop-tail",
    summary: "Rename the tail",
    content: { kind: "ops", ops: [{ op: "part.rename", part: tail.id, label: "Brush" }] },
  } as const;
  const result = run(
    s,
    env,
    envelope(human, 1, { type: "proposal.create", ...draft }),
    envelope(agent, 1, {
      ...draft,
      type: "proposal.refine",
      version: 1,
      content: { kind: "ops", ops: [{ op: "part.rename", part: tail.id, label: "Plume" }] },
    }),
    envelope(human, 1, { type: "proposal.accept", proposal: draft.proposal, version: 2 }),
  );
  const proposal = result.proposals.get(draft.proposal);
  assert.deepEqual(proposal?.author, human);
  assert.deepEqual(proposal?.lastEditor, agent);
  assert.deepEqual(result.history[1]?.author, agent);
  assert.deepEqual(result.history[1]?.actor, human);
});

test("a stale acceptance is refused without damaging the draft, which stays reviewable", () => {
  let s = generatedCreature(env);
  const tail = partBySlot(s, "tail");
  const head = partBySlot(s, "head");
  s = run(
    s,
    env,
    envelope(agent, 1, {
      type: "proposal.create",
      proposal: "prop-tail",
      summary: "Shorter tail",
      content: { kind: "ops", ops: [{ op: "part.transform", part: tail.id, scale: [1, 1, 0.6] }] },
    }),
  );
  s = run(
    s,
    env,
    envelope(human, 1, { type: "edit", ops: [{ op: "part.rename", part: head.id, label: "Jaw" }] }),
  );
  const draft = s.proposals.get("prop-tail");
  const stale = reduce(
    s,
    envelope(human, 2, { type: "proposal.accept", proposal: "prop-tail", version: 1 }),
    env,
  );
  assert.equal(rejected(stale.outcome).diagnostics[0]?.code, "stale-revision");
  assert.equal(stale.state.proposals.get("prop-tail"), draft);
  const preview = previewProposal(s, "prop-tail");
  assert.ok(preview.ok);
  assert.equal(preview.value.stale, true);
  assert.ok(preview.value.rebased.ok);
  // Refine against the head, then accept.
  s = run(
    s,
    env,
    envelope(agent, 2, {
      type: "proposal.refine",
      proposal: "prop-tail",
      version: 1,
      summary: "Shorter tail",
      content: { kind: "ops", ops: [{ op: "part.transform", part: tail.id, scale: [1, 1, 0.6] }] },
    }),
  );
  s = run(
    s,
    env,
    envelope(human, 2, { type: "proposal.accept", proposal: "prop-tail", version: 2 }),
  );
  assert.equal(partBySlot(s, "head").label, "Jaw");
  // Rejecting a draft keeps the head.
  s = run(
    s,
    env,
    envelope(agent, 3, {
      type: "proposal.create",
      proposal: "prop-head",
      summary: "Bigger head",
      content: { kind: "ops", ops: [{ op: "part.transform", part: head.id, scale: [2, 2, 2] }] },
    }),
  );
  const before = s.head;
  s = run(s, env, envelope(human, 3, { type: "proposal.discard", proposal: "prop-head" }));
  assert.equal(s.head, before);
  assert.equal(s.proposals.get("prop-head")?.status, "discarded");
});

test("a whole-document replacement is validated and stored as an explicit diff", () => {
  let s = generatedCreature(env);
  const doc = s.document;
  assert.ok(doc);
  const tail = partBySlot(s, "tail");
  const replacement = {
    ...doc,
    label: "Marsh strider",
    parts: doc.parts.map((p) => (p.id === tail.id ? { ...p, color: "#123456" } : p)),
  };
  s = run(
    s,
    env,
    envelope(agent, 1, {
      type: "proposal.create",
      proposal: "prop-replace",
      summary: "Rename and recolour",
      content: { kind: "replace", document: replacement },
    }),
  );
  assert.deepEqual(
    s.proposals.get("prop-replace")?.changes.map((c) => c.path.join("/")),
    ["label", `parts/${tail.id}/color`],
  );
  // Only the generator assigns slots and records the base: a replacement that
  // moves a slot to another part ID, or rewrites the base, is refused.
  const renamedId = {
    ...doc,
    parts: doc.parts.map((p) => (p.id === tail.id ? { ...p, id: "p-newtail" } : p)),
  };
  const generation = doc.generation;
  assert.ok(generation);
  const params = { ...defaultFrameCreatureParams, tail: { length: 2.5 } };
  const forged = { ...doc, generation: { ...generation, params } };
  for (const [document, path] of [
    [renamedId, ["content", "document", "parts", "p-newtail", "slot"]],
    [forged, ["content", "document", "generation"]],
  ] as const) {
    const step = reduce(
      s,
      envelope(agent, 1, {
        type: "proposal.create",
        proposal: "prop-ids",
        summary: "IDs",
        content: { kind: "replace", document },
      }),
      env,
    );
    assert.equal(step.state, s);
    assert.deepEqual(
      rejected(step.outcome).diagnostics.map((d) => [d.code, d.path]),
      [["forbidden", path]],
    );
  }
  const foreign = { ...doc, id: "doc-other01" };
  const wrong = reduce(
    s,
    envelope(agent, 1, {
      type: "proposal.create",
      proposal: "prop-bad",
      summary: "x",
      content: { kind: "replace", document: foreign },
    }),
    env,
  );
  assert.equal(rejected(wrong.outcome).diagnostics[0]?.code, "immutable-id");
});

test("removed part IDs are retired and cannot name a new part", () => {
  let s = generatedCreature(env);
  const tail = partBySlot(s, "tail");
  s = run(
    s,
    env,
    envelope(human, 1, {
      type: "edit",
      ops: [{ op: "part.remove", part: tail.id, cascade: true }],
    }),
  );
  const reuse = reduce(
    s,
    envelope(human, 2, { type: "edit", ops: [{ op: "part.add", part: tail }] }),
    env,
  );
  assert.equal(reuse.outcome.kind, "rejected");
  const { slot: _slot, ...handmade } = tail;
  const again = reduce(
    s,
    envelope(human, 2, { type: "edit", ops: [{ op: "part.add", part: handmade }] }),
    env,
  );
  assert.equal(rejected(again.outcome).diagnostics[0]?.code, "retired-id");
  // Undo of the removal brings back the same part with the same ID.
  s = run(s, env, envelope(human, 2, { type: "undo", target: 2 }));
  assert.equal(partBySlot(s, "tail").id, tail.id);
});

test("a manual document with artwork, a pose and a catalog part needs its blobs and catalog", () => {
  const atlas = blob("atlas");
  const occluder = blob("occluder");
  const catalog = blob("catalog").digest;
  const doc = manualDocument(atlas, occluder, catalog);
  const full = environment([atlas, occluder], [["irudd.parts", catalog]]);
  const s = run(
    emptyState(docId),
    full,
    envelope(human, 0, { type: "document.create", document: doc }),
  );
  assert.equal(s.head, 1);
  for (const [label, partial, code] of [
    ["missing occluder blob", environment([atlas], [["irudd.parts", catalog]]), "missing-asset"],
    [
      "changed catalog",
      environment([atlas, occluder], [["irudd.parts", blob("other").digest]]),
      "catalog-mismatch",
    ],
    ["missing catalog", environment([atlas, occluder]), "catalog-missing"],
  ] as const) {
    const step = reduce(
      emptyState(docId),
      envelope(human, 0, { type: "document.create", document: doc }),
      partial,
    );
    assert.equal(rejected(step.outcome).diagnostics[0]?.code, code, label);
    assert.equal(step.state.head, 0);
  }
  // Adding a paint reference to an asset that was never staged is refused.
  const late = blob("late");
  const step = reduce(
    s,
    envelope(human, 1, {
      type: "edit",
      ops: [
        {
          op: "asset.add",
          asset: {
            digest: late.digest,
            mediaType: "image/webp",
            byteLength: late.bytes.length,
            role: "paint-atlas",
          },
        },
        { op: "part.set", part: "p-lamp", set: { paint: { atlas: late.digest } } },
      ],
    }),
    full,
  );
  assert.equal(rejected(step.outcome).diagnostics[0]?.code, "missing-asset");
});

test("the journal recovers an identical state and forensic replay reproduces it", () => {
  let s = generatedCreature(env);
  const head = partBySlot(s, "head");
  s = run(
    s,
    env,
    envelope(human, 1, { type: "edit", ops: [{ op: "part.rename", part: head.id, label: "Jaw" }] }),
    envelope(agent, 2, {
      type: "proposal.create",
      proposal: "prop-a",
      summary: "a",
      content: { kind: "ops", ops: [{ op: "document.label", label: "Fen walker" }] },
    }),
    envelope(human, 2, { type: "proposal.accept", proposal: "prop-a", version: 1 }),
    envelope(human, 3, { type: "undo", target: 2 }),
  );
  for (const recovered of [
    openJournal(docId, s.journal, env),
    replayJournal(docId, s.journal, env),
  ]) {
    assert.ok(recovered.ok);
    assert.equal(recovered.state.head, s.head);
    assert.deepEqual(
      recovered.state.history.map((r) => r.digest),
      s.history.map((r) => r.digest),
    );
  }
  assert.equal(changesSince(s, 2).length, 2);
  const tampered = s.journal.map((entry, i) =>
    i === 1 ? { ...entry, receipt: { ...entry.receipt, revision: 99 } } : entry,
  );
  assert.equal(openJournal(docId, tampered, env).ok, false);
  assert.equal(replayJournal(docId, tampered, env).ok, false);
});

test("requests for another document are refused", () => {
  const s = generatedCreature(env);
  const step = reduce(
    s,
    envelope(human, 1, { type: "undo", target: 1 }, requestId(), "doc-another1"),
    env,
  );
  assert.equal(rejected(step.outcome).diagnostics[0]?.code, "wrong-document");
});
