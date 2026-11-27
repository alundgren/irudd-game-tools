import assert from "node:assert/strict";
import { test } from "node:test";
import { exportCharacter, readProvenance } from "@irudd/character";
import {
  applyOperations,
  decodeOperations,
  documentDigest,
  figureCage,
  figureSweep,
  motionPoses,
  validateDocument,
  type CharacterDocument,
} from "@irudd/document";
import { compareGlb } from "../src/compare.js";
import { installNodeExporter } from "../src/node-exporter.js";
import { familyRegistry } from "../src/prepare.js";
import { readFixture } from "../src/fixtures.js";

installNodeExporter();
const build = "test-build";
const base = readFixture("marsh-draw-5");

function edit(doc: CharacterDocument, raw: unknown): CharacterDocument {
  const ops = decodeOperations(raw);
  if (!ops.ok) throw new Error(JSON.stringify(ops.diagnostics));
  const applied = applyOperations(doc, ops.value, {
    registry: familyRegistry,
    retired: new Set(),
    idFor: (slot) => {
      throw new Error("No generated slots in a manual edit: " + slot);
    },
  });
  if (!applied.ok) throw new Error(JSON.stringify(applied.diagnostics));
  const checked = validateDocument(applied.value, { registry: familyRegistry });
  if (!checked.ok) throw new Error(JSON.stringify(checked.diagnostics));
  return checked.value;
}

function positionChanges(before: Uint8Array, after: Uint8Array): number {
  const comparison = compareGlb(before, after);
  return comparison.accessors.find((a) => a.use === "POSITION")?.differing ?? 0;
}

const exported = await exportCharacter(base, { preset: "clay", revision: 1, build });

test("the export records the document, digest, revision, build and preset", () => {
  const expected = {
    format: "irudd.export",
    version: 1,
    document: "doc-marsh-draw-5",
    digest: documentDigest(base),
    revision: 1,
    build,
    preset: "clay",
  };
  assert.deepEqual(exported.provenance, expected);
  assert.deepEqual(readProvenance(exported.bytes), expected);
  assert.deepEqual(exported.credits, []);
});

test("a typed part size edit changes the fresh export", async () => {
  const body = base.parts.find((p) => p.label === "body");
  assert.ok(body);
  const [x, y, z] = body.size;
  const edited = edit(base, [{ op: "part.set", part: body.id, set: { size: [x * 1.2, y, z] } }]);
  assert.notEqual(documentDigest(edited), documentDigest(base));
  const result = await exportCharacter(edited, { preset: "clay", revision: 2, build });
  assert.ok(positionChanges(exported.bytes, result.bytes) > 0);
  const provenance = readProvenance(result.bytes);
  assert.ok(typeof provenance === "object" && provenance !== null);
  assert.equal(Reflect.get(provenance, "revision"), 2);
  assert.equal(Reflect.get(provenance, "digest"), documentDigest(edited));
});

test("a typed sweep shape edit changes the fresh export", async () => {
  const feeler = base.parts.find((p) => p.label === "left-feeler");
  assert.ok(feeler);
  const sweep = figureSweep.read(feeler.features);
  assert.ok(sweep);
  const thicker = sweep.knots.map(([x, y, z, rx, ry]) => [x, y, z, rx * 1.5, ry * 1.5]);
  const edited = edit(base, [
    { op: "feature.set", feature: "figure.sweep", part: feeler.id, value: { knots: thicker } },
  ]);
  const result = await exportCharacter(edited, { preset: "clay", revision: 2, build });
  assert.ok(positionChanges(exported.bytes, result.bytes) > 0);
});

test("an invalid sweep edit is refused before it reaches a builder", () => {
  const feeler = base.parts.find((p) => p.label === "left-feeler");
  assert.ok(feeler);
  assert.throws(() =>
    edit(base, [
      {
        op: "feature.set",
        feature: "figure.sweep",
        part: feeler.id,
        value: { knots: [[0, 0, 0, 0.1, 0.1]] },
      },
    ]),
  );
});

test("a joint pose must turn by a unit quaternion and move a part that exists", () => {
  const gesture = readFixture("merchant-gesture");
  const poses = motionPoses.read(gesture.features);
  assert.ok(poses);
  const [first] = poses.poses;
  assert.ok(first);
  const withJoint = (joint: object) => [
    {
      op: "feature.set",
      feature: "motion.poses",
      value: { poses: [{ ...first, joints: [...first.joints, joint] }] },
    },
  ];
  assert.throws(() => edit(gesture, withJoint({ part: null, station: 0, turn: [0, 0, 0.5, 0.5] })));
  assert.throws(() =>
    edit(gesture, withJoint({ part: "p-nowhere", station: 0, turn: [0, 0, 0, 1] })),
  );
  const root = edit(gesture, withJoint({ part: null, station: 0, shift: [0, 0.01, 0] }));
  assert.equal(motionPoses.read(root.features)?.poses[0]?.joints.length, first.joints.length + 1);
});

test("the body build warp reaches the export", async () => {
  const eel = readFixture("glassgrass-eel");
  const warped = await exportCharacter(eel, { preset: "clay", revision: 1, build });
  const plain = edit(eel, [{ op: "feature.set", feature: "figure.build", value: null }]);
  const unwarped = await exportCharacter(plain, { preset: "clay", revision: 2, build });
  assert.ok(positionChanges(warped.bytes, unwarped.bytes) > 0);
});

test("a cage whose faces meet along equally wound edges is refused", () => {
  const fen = readFixture("fen-crown");
  const caged = fen.parts.find((p) => figureCage.read(p.features));
  const cage = caged && figureCage.read(caged.features);
  assert.ok(caged && cage);
  const [first, ...rest] = cage.faces;
  assert.ok(first);
  const flipped = { ...cage, faces: [[...first].reverse(), ...rest] };
  assert.throws(() =>
    edit(fen, [{ op: "feature.set", feature: "figure.cage", part: caged.id, value: flipped }]),
  );
});
