import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { Color } from "three";
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
import { chartDensity, chartSize } from "../../../packages/character/src/human/chart.js";
import { paintStageMakeup } from "../../../packages/character/src/human/stage-makeup.js";
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

function generated(seed: number): DocumentState {
  return commit(emptyState(documentId), 0, {
    type: "document.generate",
    label: `Adult ${seed}`,
    generator: humanAdultId,
    version: humanAdultVersion,
    params: seededHumanAdult(body, seed),
  });
}

test("a seeded adult is created with 52 regions", () => {
  const started = performance.now();
  for (const seed of [491, 42]) {
    const d = doc(generated(seed));
    assert.equal(d.parts.length, 52);
    for (const part of d.parts) {
      assert.deepEqual(part.size, [1, 1, 1]);
      assert.deepEqual(part.features, {});
    }
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
  assert.deepEqual(steeredHead.rotation, edited.rotation);
  for (let d = 0; d < 3; d++)
    assert.ok(
      Math.abs(
        (steeredHead.position[d] ?? 0) - (baseHead.position[d] ?? 0) - (d === 1 ? 0.005 : 0),
      ) < 1e-9,
    );
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

test("the adult can switch from Rose stain to the browser's Plum stage face paint", () => {
  let s = generated(491);
  const params = seededHumanAdult(body, 491);
  for (const makeup of ["Rose stain", "Plum stage"] as const) {
    const steered = { ...params, style: { ...params.style, makeup } };
    s = commit(s, s.head, {
      type: "edit",
      ops: [{ op: "generation.steer", params: steered }],
    });
    assert.deepEqual(doc(s).generation?.params, steered);
  }
  const { width, height } = chartSize(body);
  const size = width * height * chartDensity ** 2 * 4;
  const map = new Uint8ClampedArray(size).fill(255);
  const rough = new Uint8ClampedArray(size).fill(255);
  const skin = new Color(params.skin).toArray();
  paintStageMakeup(body, { map, rough }, "Plum stage", { skin, base: skin, brow: "eyebrow001" });
  assert.equal(
    createHash("sha256").update(map).update(rough).digest("hex"),
    "ff2b2d9925d713fb32f7561cbb2626baf205a2f0c0b2a10288a2f22c0b4e718b",
    "the browser's colour and roughness maps on the same blank face",
  );
});
