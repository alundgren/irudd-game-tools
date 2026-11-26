import { test } from "node:test";
import assert from "node:assert/strict";
import {
  affinePoint,
  createRegistry,
  emptyState,
  familyFeatures,
  frameCreature,
  memoryEnvironment,
  partPlacement,
  reduce,
  Part as PartSchema,
  type CharacterDocument,
  type DocumentState,
  type Environment,
  type Part,
  type Vec3,
} from "@irudd/document";
import { Schema } from "effect";
import { committed, docId, envelope, human, partBySlot, run } from "./support/fixtures.js";

const registry = createRegistry({ features: familyFeatures, generators: [frameCreature] });
const env: Environment = memoryEnvironment(registry);

const doc = (s: DocumentState): CharacterDocument => {
  if (!s.document) throw new Error("No document");
  return s.document;
};

function horn(head: Part, position: Vec3, size: Vec3): Part {
  return Schema.decodeUnknownSync(PartSchema)({
    id: "p-horn",
    label: "Horn",
    parent: head.id,
    shape: "cone",
    position,
    rotation: [0, 0, 0, 1],
    size,
    color: "#d9cfb8",
    sculpt: [],
    features: {},
  });
}

function seat(d: CharacterDocument): { crown: number; base: number } {
  const head = d.parts.find((p) => p.slot === "head");
  const crown = head && partPlacement(d, head.id, registry);
  const base = partPlacement(d, "p-horn", registry);
  assert.ok(crown && base);
  return {
    crown: affinePoint(crown.node, [0, 0.5, 0])[1],
    base: affinePoint(base.node, [0, -0.5, 0])[1],
  };
}

function generated(): DocumentState {
  return run(
    emptyState(docId),
    env,
    envelope(human, 0, {
      type: "document.generate",
      label: "Marsh walker",
      generator: "irudd.frame-creature",
      version: 1,
      params: {
        scale: 1,
        trunk: { length: 0.9, girth: 0.2, shape: "ellipsoid" },
        neck: { length: 0.28, pitch: 45 },
        head: { size: 0.22 },
        legs: { pairs: 2, length: 0.45 },
        tail: { length: 0.5 },
        color: "#5f7a58",
      },
    }),
  );
}

function scaled(s: DocumentState, revision: number): CharacterDocument {
  const step = reduce(
    s,
    envelope(human, revision, {
      type: "edit",
      ops: [{ op: "generation.scale", factor: 1.05 }],
    }),
    env,
  );
  committed(step.outcome);
  return doc(step.state);
}

test("core parenting is rigid: a hand-added horn keeps its stored offset and sinks 5.5 mm", () => {
  let s = generated();
  const head = partBySlot(s, "head");
  s = run(
    s,
    env,
    envelope(human, 1, {
      type: "edit",
      ops: [{ op: "part.add", part: horn(head, [0, 0.14, 0], [0.03, 0.06, 0.03]) }],
    }),
  );
  const before = seat(doc(s));
  assert.ok(Math.abs(before.base - before.crown) < 1e-12);
  const after = scaled(s, 2);
  const stored = after.parts.find((p) => p.id === "p-horn");
  assert.deepEqual(stored?.position, [0, 0.14, 0]);
  assert.deepEqual(stored?.size, [0.03, 0.06, 0.03]);
  const sink = seat(after).crown - seat(after).base;
  assert.ok(Math.abs(sink - 0.0055) < 1e-9, `sink ${sink}`);
});

test("a figure-assembled head carries a hand-added horn through a 5% scale", () => {
  let s = generated();
  const head = partBySlot(s, "head");
  const [w, h, d] = head.size;
  s = run(
    s,
    env,
    envelope(human, 1, {
      type: "edit",
      ops: [
        { op: "feature.set", feature: "figure.assembly", part: head.id, value: { order: 0 } },
        {
          op: "part.add",
          part: horn(head, [0, 0.5 + 0.03 / h, 0], [0.03 / w, 0.06 / h, 0.03 / d]),
        },
      ],
    }),
  );
  const authored = doc(s).parts.find((p) => p.id === "p-horn");
  const before = seat(doc(s));
  assert.ok(Math.abs(before.base - before.crown) < 1e-12);
  const after = scaled(s, 2);
  assert.deepEqual(
    after.parts.find((p) => p.id === "p-horn"),
    authored,
    "the merge leaves the manual horn as authored",
  );
  const fit = seat(after);
  assert.ok(Math.abs(fit.base - fit.crown) < 1e-12, `gap ${fit.base - fit.crown}`);
  assert.ok(fit.crown > before.crown, "the head grew");
});
