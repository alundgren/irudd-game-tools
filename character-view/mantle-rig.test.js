import test from "node:test";
import assert from "node:assert/strict";
import {
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Vector3,
} from "three";
import { mantleGeometry, validCut } from "./mantle.js";
import { bindMantleArms } from "./mantle-rig.js";
const cut = {
  kind: "Cape",
  width: 0.43,
  depth: 0.29,
  drop: 0.76,
  flare: 1.24,
  opening: 45,
  folds: 4,
};
test("the same garment cut can cover the arms or have open sides and sewn armholes", () => {
  function count(style, y) {
    const c = { ...cut, armAccess: style };
    assert.ok(validCut(c));
    const m = new Mesh(
      mantleGeometry(c),
      new MeshBasicMaterial({ side: DoubleSide }),
    );
    return new Raycaster(
      new Vector3(2, y, 0),
      new Vector3(-1, 0, 0),
    ).intersectObject(m, false).length;
  }
  assert.ok(count("Covered", -0.33) > 0);
  assert.equal(count("Open sides", -0.33), 0);
  assert.equal(count("Armholes", -0.33), 0);
  assert.ok(count("Armholes", -0.66) > 0);
  assert.equal(count("Open sides", -0.66), 0);
  assert.equal(validCut({ ...cut, armAccess: "Unknown" }), false);
});
test("a turned wearer keeps the same cloth-to-arm weights and both sides of the sewn panel move together", () => {
  function bind(yaw) {
    const host = new Group();
    host.rotation.y = yaw;
    const g = mantleGeometry(cut),
      obj = new Mesh(g),
      arm = new Group();
    host.add(obj, arm);
    host.updateMatrixWorld(true);
    g.applyMatrix4(obj.matrixWorld);
    const count = g.attributes.position.count,
      indices = new Uint16Array(count * 4),
      weights = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) weights[i * 4] = 1;
    const driver = {
      role: "upper arm",
      object: arm,
      points: [
        [0.2, -0.09, 0],
        [0.23, -0.33, 0],
        [0.26, -0.53, 0],
      ].map((row) => new Vector3(...row).applyMatrix4(arm.matrixWorld)),
      bones: [1, 2],
    };
    bindMantleArms(
      {
        part: { shape: "mantle", parent: "body", cut, wearFit: true },
        object: obj,
      },
      new Map([
        ["body", { object: host }],
        ["arm", driver],
      ]),
      g,
      indices,
      weights,
      new Map([
        [1, 1],
        [2, 2],
      ]),
      () => [0, 1, 0.6, 0.4],
    );
    for (let i = 0; i < count; i++)
      assert.ok(
        Math.abs(weights.slice(i * 4, i * 4 + 4).reduce((a, b) => a + b) - 1) <
          1e-6,
      );
    assert.deepEqual(weights.slice(0, count * 2), weights.slice(count * 2));
    assert.ok(weights.some((w, i) => i % 4 === 2 && w > 0.55));
    return weights;
  }
  const a = bind(0),
    b = bind(Math.PI * 0.41);
  assert.equal(a.length, b.length);
  assert.ok(a.every((w, i) => Math.abs(w - b[i]) < 1e-5));
});
