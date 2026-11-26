import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyChanges,
  assetCreditsLimit,
  assetCreditsNamespace,
  diff,
  mergeAssetCredits,
  openJournal,
  previewProposal,
  readAssetCredits,
  reduce,
  storedAssetCredits,
  type CharacterDocument,
  type CommandEnvelopeInput,
  type DocumentState,
  type Json,
  type JsonObject,
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
  rejected,
  run,
} from "./support/fixtures.js";

const a = blob("credit-a");
const b = blob("credit-b");
const c = blob("credit-c");
const o = blob("credit-orphan");
const env = environment([a, b, c, o]);

const credit = (digest: string, author: string): JsonObject => ({
  digest,
  via: "paired-agent",
  submittedBy: { kind: "agent", id: "assistant", name: "Assistant" },
  art: { id: "art-fixture", kind: "turnaround" },
  summary: "fixture sheet",
  author,
});
const digestOf = (entry: JsonObject | undefined): string => {
  const digest = entry?.["digest"];
  return typeof digest === "string" ? digest : "";
};
const record = (...credits: JsonObject[]): Json => ({
  format: "irudd.asset-credits",
  version: 1,
  assets: [...credits].sort((x, y) => (digestOf(x) < digestOf(y) ? -1 : 1)),
});
const sizes = new Map<string, number>([a, b, c, o].map((x) => [x.digest, x.bytes.length]));
type Op = Extract<CommandEnvelopeInput["command"], { readonly type: "edit" }>["ops"][number];
const addAsset = (digest: string): Op => ({
  op: "asset.add",
  asset: {
    digest,
    mediaType: "image/webp",
    byteLength: sizes.get(digest) ?? 1,
    role: "paint-atlas",
  },
});
const setCredits = (value: Json | null): Op => ({
  op: "extension.set",
  namespace: assetCreditsNamespace,
  value,
});
const head = (s: DocumentState): CharacterDocument => {
  assert.ok(s.document);
  return s.document;
};
const authors = (doc: CharacterDocument) =>
  Object.fromEntries(storedAssetCredits(doc).map((x) => [x.digest, x.author]));

function credited(...extra: Op[]): DocumentState {
  return run(
    generatedCreature(env),
    env,
    envelope(human, 1, {
      type: "edit",
      ops: [addAsset(a.digest), setCredits(record(credit(a.digest, "Ada"))), ...extra],
    }),
  );
}

const propose = (s: DocumentState, id: string, base: number, ops: Op[]) =>
  run(
    s,
    env,
    envelope(agent, base, {
      type: "proposal.create",
      proposal: id,
      summary: id,
      content: { kind: "ops", ops },
    }),
  );
const accept = (s: DocumentState, id: string) =>
  run(s, env, envelope(human, s.head, { type: "proposal.accept", proposal: id, version: 1 }));

test("two proposals that credit different new pictures merge credit by credit", () => {
  let s = credited();
  s = propose(s, "prop-b", 2, [
    addAsset(b.digest),
    setCredits(record(credit(a.digest, "Ada"), credit(b.digest, "Bo"))),
  ]);
  s = propose(s, "prop-c", 2, [
    addAsset(c.digest),
    setCredits(record(credit(a.digest, "Ada"), credit(c.digest, "Cy"))),
  ]);
  const proposal = s.proposals.get("prop-c");
  assert.deepEqual(
    proposal?.changes.map((x) => x.path),
    [
      ["extensions", assetCreditsNamespace, c.digest],
      ["assets", c.digest],
    ],
    "the proposal names the one credit it adds, not the whole record",
  );
  s = accept(s, "prop-b");
  const preview = previewProposal(s, "prop-c");
  assert.ok(preview.ok);
  assert.equal(preview.value.stale, true);
  assert.ok(preview.value.rebased.ok, JSON.stringify(preview.value.rebased));
  const merged = applyChanges(head(s), preview.value.rebased.value);
  assert.ok(merged.ok);
  assert.deepEqual(authors(merged.value), {
    [a.digest]: "Ada",
    [b.digest]: "Bo",
    [c.digest]: "Cy",
  });
  const again = applyChanges(head(s), diff(head(s), merged.value));
  assert.ok(again.ok);
  assert.deepEqual(again.value, merged.value);
});

test("two proposals that credit the same picture differently still conflict on that credit", () => {
  let s = credited();
  s = propose(s, "prop-1", 2, [setCredits(record(credit(a.digest, "Ada Lovelace")))]);
  s = propose(s, "prop-2", 2, [setCredits(record(credit(a.digest, "A. L.")))]);
  s = accept(s, "prop-1");
  const preview = previewProposal(s, "prop-2");
  assert.ok(preview.ok);
  assert.equal(preview.value.rebased.ok, false);
  if (preview.value.rebased.ok) return;
  assert.deepEqual(
    preview.value.rebased.diagnostics.map((d) => [d.code, d.path.join("/")]),
    [["conflict", `extensions/${assetCreditsNamespace}/${a.digest}`]],
  );
});

test("two proposals that each compact the same stale credit agree", () => {
  let s = credited(setCredits(record(credit(a.digest, "Ada"), credit(o.digest, "Gone"))));
  s = propose(s, "prop-b", 2, [
    addAsset(b.digest),
    setCredits(record(credit(a.digest, "Ada"), credit(b.digest, "Bo"))),
  ]);
  s = propose(s, "prop-c", 2, [
    addAsset(c.digest),
    setCredits(record(credit(a.digest, "Ada"), credit(c.digest, "Cy"))),
  ]);
  s = accept(s, "prop-b");
  const preview = previewProposal(s, "prop-c");
  assert.ok(preview.ok);
  assert.ok(preview.value.rebased.ok, JSON.stringify(preview.value.rebased));
  const merged = applyChanges(head(s), preview.value.rebased.value);
  assert.ok(merged.ok);
  assert.deepEqual(
    Object.keys(authors(merged.value)).sort(),
    [a.digest, b.digest, c.digest].sort(),
  );
});

test("a whole-record change from an earlier build applies credit by credit on a record that moved on", () => {
  const s = credited();
  const moved = run(
    s,
    env,
    envelope(human, 2, {
      type: "edit",
      ops: [
        addAsset(b.digest),
        setCredits(record(credit(a.digest, "Ada"), credit(b.digest, "Bo"))),
      ],
    }),
  );
  const legacy = [
    {
      path: ["extensions", assetCreditsNamespace],
      before: record(credit(a.digest, "Ada")),
      after: record(credit(a.digest, "Ada"), credit(c.digest, "Cy")),
    },
  ];
  const merged = applyChanges(head(moved), legacy);
  assert.ok(merged.ok, JSON.stringify(merged));
  assert.deepEqual(authors(merged.value), {
    [a.digest]: "Ada",
    [b.digest]: "Bo",
    [c.digest]: "Cy",
  });
  const disagree = [
    {
      path: ["extensions", assetCreditsNamespace],
      before: record(credit(a.digest, "Ada")),
      after: record(credit(a.digest, "Someone else")),
    },
  ];
  const changed = run(
    moved,
    env,
    envelope(human, 3, {
      type: "edit",
      ops: [setCredits(record(credit(a.digest, "Ada L."), credit(b.digest, "Bo")))],
    }),
  );
  const refused = applyChanges(head(changed), disagree);
  assert.equal(refused.ok, false);
  const exact = applyChanges(head(s), legacy);
  assert.ok(exact.ok);
  assert.deepEqual(authors(exact.value), { [a.digest]: "Ada", [c.digest]: "Cy" });
});

test("diffs reproduce every record form; only the written form is split by credit", () => {
  const plain = head(credited());
  const unsorted: Json = {
    format: "irudd.asset-credits",
    version: 1,
    assets: [credit(c.digest, "Cy"), credit(a.digest, "Ada")].sort((x, y) =>
      digestOf(x) < digestOf(y) ? 1 : -1,
    ),
  };
  const forms: Array<Json | undefined> = [
    undefined,
    record(credit(a.digest, "Ada")),
    record(credit(a.digest, "Ada"), credit(b.digest, "Bo")),
    unsorted,
    { format: "irudd.asset-credits", version: 1, assets: "unreadable" },
  ];
  const withRecord = (value: Json | undefined): CharacterDocument => {
    const { [assetCreditsNamespace]: _old, ...rest } = plain.extensions;
    return {
      ...plain,
      extensions: value === undefined ? rest : { ...rest, [assetCreditsNamespace]: value },
    };
  };
  for (const x of forms)
    for (const y of forms) {
      const from = withRecord(x);
      const to = withRecord(y);
      const changes = diff(from, to);
      const applied = applyChanges(from, changes);
      assert.ok(applied.ok, JSON.stringify({ x, y, changes }));
      assert.deepEqual(applied.value.extensions, to.extensions, JSON.stringify({ x, y }));
      const written = (v: Json | undefined): boolean =>
        v === undefined || (v !== unsorted && !JSON.stringify(v).includes("unreadable"));
      const split = changes.some((ch) => ch.path.length === 3);
      if (split) assert.ok(written(x) && written(y), "only written records are split");
    }
});

test("removing a picture retires its credit, undo restores it, and other credits stay", () => {
  let s = run(
    generatedCreature(env),
    env,
    envelope(human, 1, {
      type: "edit",
      ops: [
        addAsset(a.digest),
        addAsset(b.digest),
        setCredits(record(credit(a.digest, "Ada"), credit(b.digest, "Bo"))),
      ],
    }),
  );
  s = run(
    s,
    env,
    envelope(human, 2, { type: "edit", ops: [{ op: "asset.remove", digest: a.digest }] }),
  );
  assert.deepEqual(authors(head(s)), { [b.digest]: "Bo" });
  assert.deepEqual(
    s.history.at(-1)?.changes.map((x) => x.path),
    [
      ["extensions", assetCreditsNamespace, a.digest],
      ["assets", a.digest],
    ],
  );
  s = run(s, env, envelope(human, 3, { type: "undo", target: 3 }));
  assert.deepEqual(authors(head(s)), { [a.digest]: "Ada", [b.digest]: "Bo" });
  assert.ok(head(s).assets.some((x) => x.digest === a.digest));
  s = run(
    s,
    env,
    envelope(human, 4, {
      type: "edit",
      ops: [
        { op: "asset.remove", digest: a.digest },
        { op: "asset.remove", digest: b.digest },
      ],
    }),
  );
  assert.equal(head(s).extensions[assetCreditsNamespace], undefined);
  const reopened = openJournal(docId, s.journal, env);
  assert.ok(reopened.ok);
  if (reopened.ok) assert.deepEqual(reopened.state.document, s.document);
});

test("a record that cannot be read is never replaced; removal leaves it as it is", () => {
  const broken: Json = { format: "irudd.asset-credits", version: 1, assets: "unreadable" };
  let s = credited(setCredits(broken));
  const doc = head(s);
  const read = readAssetCredits(doc);
  assert.equal(read.ok, false, "the reader reports it");
  assert.deepEqual(storedAssetCredits(doc), [], "credits never block a build");
  const merged = mergeAssetCredits(doc, new Set([a.digest, b.digest]), []);
  assert.equal(merged.ok, false);
  if (!merged.ok) assert.match(merged.diagnostics[0]?.message ?? "", /cannot be read/);
  const one = applyChanges(doc, [
    { path: ["extensions", assetCreditsNamespace, b.digest], after: credit(b.digest, "Bo") },
  ]);
  assert.equal(one.ok, false);
  if (!one.ok) assert.match(one.diagnostics[0]?.message ?? "", /not in a form/);
  s = run(
    s,
    env,
    envelope(human, 2, { type: "edit", ops: [{ op: "asset.remove", digest: a.digest }] }),
  );
  assert.deepEqual(head(s).extensions[assetCreditsNamespace], broken);
});

test("a reader keeps every credit past the write limit, and a merge over the limit fails", () => {
  const many = Array.from({ length: assetCreditsLimit + 1 }, (_, i) =>
    credit(`sha256:${i.toString(16).padStart(64, "0")}`, `Old ${i}`),
  );
  const s = credited(setCredits(record(...many)));
  assert.equal(storedAssetCredits(head(s)).length, assetCreditsLimit + 1);
  const declared = new Set(many.map((x) => digestOf(x)));
  const over = mergeAssetCredits(head(s), declared, []);
  assert.equal(over.ok, false);
  if (!over.ok) assert.equal(over.diagnostics[0]?.code, "limit");
  const first = digestOf(many[0]);
  const compact = mergeAssetCredits(head(s), new Set([first]), []);
  assert.ok(compact.ok);
  assert.deepEqual(
    compact.ok ? JSON.parse(JSON.stringify(compact.value)) : null,
    record(credit(first, "Old 0")),
  );
});

test("an agent's proposal may not slip a credit past a stale base", () => {
  let s = credited();
  s = propose(s, "prop-b", 2, [
    addAsset(b.digest),
    setCredits(record(credit(a.digest, "Ada"), credit(b.digest, "Bo"))),
  ]);
  s = run(
    s,
    env,
    envelope(human, 2, {
      type: "edit",
      ops: [
        addAsset(b.digest),
        setCredits(record(credit(a.digest, "Ada"), credit(b.digest, "Someone"))),
      ],
    }),
  );
  const preview = previewProposal(s, "prop-b");
  assert.ok(preview.ok);
  assert.equal(preview.value.rebased.ok, false);
  const step = reduce(
    s,
    envelope(human, 3, { type: "proposal.accept", proposal: "prop-b", version: 1 }),
    env,
  );
  rejected(step.outcome);
  committed(
    reduce(s, envelope(human, 3, { type: "proposal.discard", proposal: "prop-b" }), env).outcome,
  );
});
