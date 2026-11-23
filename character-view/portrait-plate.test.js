import test from "node:test";
import assert from "node:assert/strict";
import { BufferGeometry, Float32BufferAttribute } from "three";
import {
  rasterTriangles,
  photoRegistration,
  backdropOpacity,
} from "./portrait-plate.js";

test("registration maps every chosen feature to its source pixel, including rolled rectangular portraits", () => {
  const pairs = [
    { at: [-0.23, 0.14, 0.12], uv: [0.21, 0.24] },
    { at: [0.22, 0.1, 0.15], uv: [0.77, 0.32] },
    { at: [0.02, -0.08, 0.34], uv: [0.49, 0.53] },
    { at: [-0.19, -0.2, 0.19], uv: [0.2, 0.65] },
  ];
  const sample = photoRegistration(pairs, 1.6),
    out = [0, 0];
  for (const p of pairs) {
    sample(p.at[0], p.at[1], out);
    assert.ok(Math.hypot(out[0] - p.uv[0], out[1] - p.uv[1]) < 1e-8);
  }
  sample(0, 0, out);
  assert.ok(out.every((v) => v > 0 && v < 1));
});

test("the UV baker covers both windings and avoids sampling beyond a clipped triangle", () => {
  const g = new BufferGeometry().setAttribute(
    "position",
    new Float32BufferAttribute(new Float32Array(9), 3),
  );
  const xy = [-1, 0, 3, 0, 1, 3],
    draw = (order) => {
      g.setIndex(order);
      const hits = [];
      rasterTriangles(g, xy, 3, 3, (i, a, b, c, l, s, t) => {
        assert.ok(i >= 0 && i < 9);
        assert.ok(Math.abs(l + s + t - 1) < 1e-8);
        hits.push(i);
      });
      return hits;
    };
  const forward = draw([0, 1, 2]);
  assert.deepEqual(forward, draw([2, 1, 0]));
  assert.ok(forward.length >= 4 && forward.length < 9);
  assert.deepEqual(draw([0, 1, 1]), []);
});

test("the keyed background fades out without removing neutral grey hair or warm skin", () => {
  const samples = Uint8Array.from([
    203, 245, 214, 255, 80, 80, 77, 255, 219, 164, 131, 255, 165, 190, 169, 255,
    204, 246, 213, 255,
  ]);
  assert.equal(backdropOpacity(samples, 0, 0, 16), 0);
  assert.equal(backdropOpacity(samples, 4, 0, 16), 1);
  assert.equal(backdropOpacity(samples, 8, 0, 16), 1);
  assert.ok(backdropOpacity(samples, 12, 0, 16) < 0.08);
});
