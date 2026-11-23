import assert from "node:assert/strict";
import test from "node:test";
import { Mesh, SphereGeometry, MeshStandardMaterial } from "three";
import {
  attachEyes,
  eyeDefaults,
  fitEyeSettings,
  gazeNames,
  setGaze,
  validEyes,
} from "./ocular.js";

test("paint-free heads get independent iris and lid morphs in face coordinates", () => {
  const head = new Mesh(
    new SphereGeometry(0.12, 32, 24),
    new MeshStandardMaterial(),
  );
  const settings = fitEyeSettings(head);
  assert.deepEqual(settings, eyeDefaults);
  assert.ok(attachEyes(head, settings));
  const iris = head.getObjectByName("Iris"),
    lids = head.getObjectByName("Lids");
  lids.morphTargetInfluences[lids.morphTargetDictionary.Blink] = 0.75;
  setGaze(head, -0.65, 0.4);
  assert.deepEqual(
    gazeNames.map(
      (k) => iris.morphTargetInfluences[iris.morphTargetDictionary[k]],
    ),
    [0, 0.65, 0.4, 0],
  );
  assert.equal(
    lids.morphTargetInfluences[lids.morphTargetDictionary.Blink],
    0.75,
  );
  const left =
    iris.geometry.morphAttributes.position[iris.morphTargetDictionary.LookLeft];
  const up =
    iris.geometry.morphAttributes.position[iris.morphTargetDictionary.LookUp];
  for (let i = 0; i < left.count; i++) {
    assert.ok(left.getX(i) > 0 && Math.abs(left.getY(i)) < 1e-6);
    assert.ok(up.getY(i) > 0 && Math.abs(up.getX(i)) < 1e-6);
  }
  setGaze(head, 0, 0);
  assert.ok(iris.morphTargetInfluences.every((x) => x === 0));
});

test("rejects incomplete or inverted saved eye fit measurements", () => {
  const edge = () => ({
    upper: Array(9).fill(0.02),
    lower: Array(9).fill(-0.012),
  });
  const example = {
    ...eyeDefaults,
    source: true,
    offsets: [
      [-0.01, 0],
      [0, 0.01],
    ],
    contours: [edge(), edge()],
  };
  assert.ok(validEyes(example));
  for (const bad of [
    {
      offsets: [
        [Infinity, 0],
        [0, 0],
      ],
    },
    { contours: [null, edge()] },
    { contours: [{ ...edge(), lower: Array(9).fill(0.01) }, edge()] },
    { width: 12 },
  ])
    assert.equal(validEyes({ ...example, ...bad }), false);
});

test("painted eye keeps both gaze directions inside its opening when edited", () => {
  const face = new Mesh(
    new SphereGeometry(0.14, 48, 32),
    new MeshStandardMaterial(),
  );
  assert.ok(attachEyes(face, { ...eyeDefaults, source: true, iris: 1.25 }));
  const eye = face.getObjectByName("Iris"),
    g = eye.geometry;
  assert.equal(eye.material, face.material);
  assert.equal(face.getObjectByName("Sclera"), undefined);
  const x = g.morphAttributes.position[eye.morphTargetDictionary.LookRight];
  const y = g.morphAttributes.position[eye.morphTargetDictionary.LookUp];
  // The first and last vertex of the opening are fixed at the canthi.
  assert.ok(Math.abs(x.getX(0)) < 1e-7 && Math.abs(y.getY(0)) < 1e-7);
  assert.ok(x.array.every(Number.isFinite) && y.array.every(Number.isFinite));
  assert.ok(x.array.some((v) => v < -0.001) && y.array.some((v) => v > 0.001));
});
