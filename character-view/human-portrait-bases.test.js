import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { evaluateHuman, portraitAxes, randomHuman, smoothHumanSurface } from "./human-surface.js";

test("blending a portrait on an edited adult preserves the orientation of the facial skin", () => {
  const params = randomHuman(29169);
  const zero = Object.fromEntries(portraitAxes.map(key => [key, 0]));
  const base = evaluateHuman({ ...params, ...zero });
  const shaped = evaluateHuman({ ...params, ...zero, portraitDivorcee: 1 });
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  function normal(points, i, j, k, out) {
    a.fromArray(points, 3*i);
    b.fromArray(points, 3*j).sub(a);
    c.fromArray(points, 3*k).sub(a);
    return out.crossVectors(b, c);
  }
  for (const [before, after] of [[base, shaped], [smoothHumanSurface(base), smoothHumanSurface(shaped)]]) {
    const n1 = new Vector3(), n2 = new Vector3();
    let peak = 0;
    for (let t=0; t < before.bodyTriangles * 3; t+=3) {
      const i=before.indices[t], j=before.indices[t+1], k=before.indices[t+2];
      if (before.positions[3*i+1] < .86 * before.height) continue;
      normal(before.positions, i, j, k, n1);
      normal(after.positions, i, j, k, n2);
      if (n1.length() * n2.length() > 1e-17) assert.ok(n1.dot(n2) > 0);
      peak = Math.max(peak, Math.abs(after.positions[3*i+2]-before.positions[3*i+2]));
    }
    assert.ok(peak > .002, "the foundation changes the profile by measurable millimetres");
  }
});
