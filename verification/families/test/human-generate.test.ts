// The adult generator in the revision protocol. A seeded adult is created
// with the values G0's `#adult=SEED` draw decides and the regions G0's form
// holds; a person's region edit survives a steer of the measurements; values
// outside the editor's limits are refused at their field.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  createRegistry,
  decodeWith,
  DocumentId,
  emptyState,
  familyFeatures,
  frameCreature,
  memoryEnvironment,
  reduce,
  type CharacterDocument,
  type CommandEnvelopeInput,
  type DocumentState,
  type Environment,
} from "@irudd/document";
import {
  humanAdultGenerator,
  humanAdultId,
  humanAdultVersion,
  humanSlot,
  seededHumanAdult,
  type HumanAdultParams,
} from "@irudd/character/human";
import { isRecord } from "../src/glb.js";
import { loadHumanBody } from "../src/human-assets.js";

const body = await loadHumanBody();
const registry = createRegistry({
  features: familyFeatures,
  generators: [frameCreature, humanAdultGenerator(body)],
});
const env: Environment = memoryEnvironment(registry);
const person = { kind: "human", id: "tester" } as const;
const decodedId = decodeWith(DocumentId, "doc-adult491");
if (!decodedId.ok) throw new Error("Invalid fixture document ID.");
const documentId = decodedId.value;

let counter = 0;
function step(
  state: DocumentState,
  expectedRevision: number,
  command: CommandEnvelopeInput["command"],
) {
  counter += 1;
  return reduce(
    state,
    {
      format: "irudd.command",
      version: 1,
      requestId: `req-human-${counter}`,
      documentId,
      actor: person,
      expectedRevision,
      command,
    },
    env,
  );
}
function commit(
  state: DocumentState,
  expectedRevision: number,
  command: CommandEnvelopeInput["command"],
): DocumentState {
  const next = step(state, expectedRevision, command);
  if (next.outcome.kind !== "committed")
    throw new Error(`Expected a commit: ${JSON.stringify(next.outcome)}`);
  return next.state;
}
const doc = (state: DocumentState): CharacterDocument => {
  if (!state.document) throw new Error("No document.");
  return state.document;
};

// SHA-256 from G0's frozen adult-{seed}.form.json: sorted region labels,
// each followed by NUL and its three position components as big-endian float64.
const g0Positions = [
  [491, "1aeb0a30c1fc31140a0d4e33df6015b5a9df71e9cdf063ef097676b69869fb7d"],
  [42, "f92281f9e43e81fcb983b374beed7d471324a1e0c89f5adf7ba5fcd11e4992a7"],
] as const;

function generated(seed: number): DocumentState {
  return commit(emptyState(documentId), 0, {
    type: "document.generate",
    label: `Adult ${seed}`,
    generator: humanAdultId,
    version: humanAdultVersion,
    params: seededHumanAdult(body, seed),
  });
}

test("a seeded adult is created with G0's 52 regions", () => {
  const started = performance.now();
  for (const [seed, expected] of g0Positions) {
    const d = doc(generated(seed));
    assert.equal(d.parts.length, 52);
    const hash = createHash("sha256");
    for (const part of d.parts.toSorted((a, b) => a.label.localeCompare(b.label, "en"))) {
      const xyz = Buffer.alloc(24);
      part.position.forEach((value, i) => xyz.writeDoubleBE(value, i * 8));
      hash.update(part.label).update("\0").update(xyz);
      assert.deepEqual(part.size, [1, 1, 1]);
      assert.deepEqual(part.features, {});
    }
    assert.equal(hash.digest("hex"), expected, `G0 region labels and positions for adult ${seed}`);
    const labels = new Map<string, string>(d.parts.map((p) => [p.id, p.label]));
    const head = d.parts.find((p) => p.slot === "head");
    assert.equal(head?.label, "head");
    assert.equal(labels.get(head?.parent ?? ""), "neck");
  }
  console.log(`  created 2 adults in ${(performance.now() - started).toFixed(0)} ms`);
});

test("a person's head edit survives a height steer", () => {
  let s = generated(491);
  const head = doc(s).parts.find((p) => p.slot === humanSlot("head"));
  const pelvis = doc(s).parts.find((p) => p.slot === "pelvis");
  assert.ok(head && pelvis);
  // Tip the head forward 10 degrees and raise it 5 mm.
  const half = (10 * Math.PI) / 360;
  s = commit(s, 1, {
    type: "edit",
    ops: [
      {
        op: "part.transform",
        part: head.id,
        translate: [0, 0.005, 0],
        rotate: [Math.sin(half), 0, 0, Math.cos(half)],
      },
    ],
  });
  const edited = doc(s).parts.find((p) => p.id === head.id);
  const generation = doc(s).generation;
  assert.ok(edited && generation);
  const params: HumanAdultParams = seededHumanAdult(body, 491);
  const taller = { ...params, human: { ...params.human, height: 1.9 } };
  s = commit(s, 2, { type: "edit", ops: [{ op: "generation.steer", params: taller }] });
  const after = doc(s);
  const steeredHead = after.parts.find((p) => p.id === head.id);
  const steeredPelvis = after.parts.find((p) => p.id === pelvis.id);
  const baseHead = after.generation?.base.slots.find((b) => b.slot === "head");
  assert.ok(steeredHead && steeredPelvis && baseHead);
  // The rotation is kept and the offset rides on the new generated joint.
  assert.deepEqual(steeredHead.rotation, edited.rotation);
  for (let d = 0; d < 3; d++)
    assert.ok(
      Math.abs(
        (steeredHead.position[d] ?? 0) - (baseHead.position[d] ?? 0) - (d === 1 ? 0.005 : 0),
      ) < 1e-9,
    );
  // The unedited pelvis takes the taller body's joint.
  assert.ok(steeredPelvis.position[1] > (pelvis.position[1] ?? 0) + 0.05);
  assert.equal(
    isRecord(after.generation?.params) && after.generation.params["human"] !== undefined,
    true,
  );
});

test("measurements outside the editor's limits are refused at their field", () => {
  const s = generated(491);
  const params = seededHumanAdult(body, 491);
  for (const human of [
    { ...params.human, height: 2.5 },
    { ...params.human, wingspan: 1 },
  ]) {
    const outcome = step(s, 1, {
      type: "edit",
      ops: [{ op: "generation.steer", params: { ...params, human } }],
    }).outcome;
    assert.equal(outcome.kind, "rejected");
    const diagnostics = outcome.kind === "rejected" ? outcome.diagnostics : [];
    assert.ok(
      diagnostics.some((d) => d.path.includes("human")),
      JSON.stringify(diagnostics),
    );
  }
});

test("everyday makeup steers the face and a stage look, not yet painted, is refused", () => {
  const s = generated(491);
  const params = seededHumanAdult(body, 491);
  const steer = (makeup: string) =>
    step(s, 1, {
      type: "edit",
      ops: [{ op: "generation.steer", params: { ...params, style: { ...params.style, makeup } } }],
    }).outcome;
  assert.notEqual(steer("Rose stain").kind, "rejected");
  const refused = steer("Plum stage");
  assert.equal(refused.kind, "rejected");
  const diagnostics = refused.kind === "rejected" ? refused.diagnostics : [];
  assert.ok(
    diagnostics.some((d) => d.path.includes("makeup")),
    JSON.stringify(diagnostics),
  );
});
