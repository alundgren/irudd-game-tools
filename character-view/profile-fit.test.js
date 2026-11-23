import test from "node:test";
import assert from "node:assert/strict";
import { Mesh, SphereGeometry } from "three";
import {
  profileTrace,
  fitHeadProfile,
  sectionDepth,
  validProfile,
} from "./profile-fit.js";

test("a mirrored photograph yields the same scale-free brow-to-chin trace", () => {
  const right = [
      [20, 6],
      [27, 21],
      [19, 30],
      [23, 42],
    ],
    left = right.map(([x, y]) => [200 - 2 * x, 3 + 2 * y]);
  assert.deepEqual(profileTrace(right, "right"), profileTrace(left, "left"));
  assert.throws(() =>
    profileTrace([
      [20, 6],
      [27, 21],
      [19, 20],
      [23, 42],
    ]),
  );
  assert.equal(
    validProfile({
      curve: [
        [0, 0],
        [0.3, 0.2],
        [0.8, 0.1],
        [1, 0.2],
      ],
      amount: 2,
    }),
    false,
  );
});

test("a fitted section preserves rear vertices, carries the input UVs and accounts for nonuniform model scale", () => {
  const mesh = new Mesh(new SphereGeometry(0.5, 96, 96));
  mesh.scale.set(1, 1.3, 0.9);
  const geo = mesh.geometry,
    pos = geo.attributes.position,
    original = pos.clone(),
    tex = geo.attributes.uv.clone();
  const fit = {
    curve: [
      [0, 0],
      [0.4, 0.1],
      [0.62, 0.06],
      [1, -0.19],
    ],
    amount: 1,
  };
  fitHeadProfile(mesh, { ...fit, amount: 0 });
  assert.deepEqual(pos.array, original.array);
  fitHeadProfile(mesh, fit);
  assert.deepEqual(geo.attributes.uv.array, tex.array);
  let fixed = 0,
    shift = 0;
  for (let i = 0; i < pos.count; i++) {
    assert.equal(pos.getX(i), original.getX(i));
    assert.equal(pos.getY(i), original.getY(i));
    if (original.getZ(i) < -0.1) {
      fixed++;
      assert.equal(pos.getZ(i), original.getZ(i));
    }
    shift = Math.max(shift, Math.abs(pos.getZ(i) - original.getZ(i)));
  }
  assert.ok(shift > 0.03 && fixed > 100);
  const brow = 0.16,
    span = 0.605,
    row = brow - 0.4 * span;
  const upper = sectionDepth(geo, brow - 0.001, brow + 0.001, 3).near[1],
    nose = sectionDepth(geo, row - 0.001, row + 0.001, 3).near[1];
  assert.ok(Math.abs(((nose - upper) * 0.9) / (span * 1.3) - 0.1) < 0.012);
});
