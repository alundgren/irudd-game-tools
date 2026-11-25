import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import {
  castShapeAxes, wearsCastShape, evaluateHuman, expressionDisplacements, humanFitAxes, humanRange, portraitAxes,
  randomHuman, smoothHumanSurface, validHuman,
} from "./human-surface.js";

const none = Object.fromEntries([...portraitAxes, ...castShapeAxes].map(key => [key, 0]));
const drawn = { ...randomHuman(830431), ...none };
const base = evaluateHuman(drawn);
const dist = (p, a, b) => Math.hypot(p[3*a]-p[3*b], p[3*a+1]-p[3*b+1], p[3*a+2]-p[3*b+2]);

test("an adult saved before the cast foundations keeps its shape, and the new axes are ordinary 0..1 controls", () => {
  const old = Object.fromEntries(Object.entries(drawn).filter(([key]) => !castShapeAxes.includes(key)));
  assert.deepEqual(Array.from(evaluateHuman(old).positions), Array.from(base.positions));
  for (const key of castShapeAxes) {
    assert.deepEqual(humanRange(key), [0, 1, 0]);
    assert.ok(!humanFitAxes.includes(key));
    assert.ok(validHuman({ [key]: 1 }) && !validHuman({ [key]: -.1 }) && !validHuman({ [key]: 1.1 }));
  }
  assert.equal(wearsCastShape(drawn), false);
  assert.equal(wearsCastShape({ ...drawn, [castShapeAxes[0]]: .4 }), true);
  assert.equal(wearsCastShape(undefined), false);
});

test("every cast foundation reshapes the face by millimetres and leaves skull, ears, neck seam and body alone", () => {
  const head = base.names.indexOf("head"), hy = base.joints[3*head+1], hz = base.joints[3*head+2], top = base.height;
  for (const key of castShapeAxes) {
    const shaped = evaluateHuman({ ...drawn, [key]: 1 });
    let face = 0;
    for (let v = 0; v < base.bodyVertices; v++) {
      const moved = dist2(shaped.positions, base.positions, v), y = base.positions[3*v+1], z = base.positions[3*v+2];
      // Behind the ear line, on the crown and below the jaw nothing moves.
      if (y < hy - .125 || z < hz - .03 || y > top - .035) assert.ok(moved < 2e-5, `${key} moves vertex ${v} off the face by ${moved}`);
      face = Math.max(face, moved);
    }
    assert.ok(face > .004 && face < .0175, `${key} peak ${face}`);
    assert.deepEqual(Array.from(shaped.joints), Array.from(base.joints));
  }
});
function dist2(a, b, v) { return Math.hypot(a[3*v]-b[3*v], a[3*v+1]-b[3*v+1], a[3*v+2]-b[3*v+2]); }

test("facial skin keeps its orientation on the cage and the smooth surface", () => {
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), n1 = new Vector3(), n2 = new Vector3();
  const normal = (points, i, j, k, out) => { a.fromArray(points, 3*i); b.fromArray(points, 3*j).sub(a); c.fromArray(points, 3*k).sub(a); return out.crossVectors(b, c); };
  for (const key of castShapeAxes) {
    const shaped = evaluateHuman({ ...drawn, [key]: 1 });
    for (const [before, after] of [[base, shaped], [smoothHumanSurface(base), smoothHumanSurface(shaped)]])
      for (let t = 0; t < before.bodyTriangles * 3; t += 3) {
        const i = before.indices[t], j = before.indices[t+1], k = before.indices[t+2];
        if (before.positions[3*i+1] < .86 * before.height) continue;
        normal(before.positions, i, j, k, n1); normal(after.positions, i, j, k, n2);
        if (n1.length() * n2.length() > 1e-17) assert.ok(n1.dot(n2) > 0, key + " turns a facial triangle over");
      }
  }
});

test("eyes stay round and seated, and the lips keep their order", () => {
  // Lip pairs: skin vertices of the mouth that lie within 6 mm of each other at rest, one above the other.
  const p = base.positions, head = base.names.indexOf("head"), hy = base.joints[3*head+1];
  const mouth = [];
  for (let v = 0; v < base.bodyVertices; v++)
    if (Math.abs(p[3*v]) < .03 && p[3*v+1] > hy - .053 && p[3*v+1] < hy - .036 && p[3*v+2] > base.joints[3*head+2] + .05) mouth.push(v);
  const smile = expressionDisplacements("Smile");
  const pairs = [];
  for (const i of mouth) for (const j of mouth) if (i < j && dist(p, i, j) < .006 && Math.abs(p[3*i]-p[3*j]) < .001) pairs.push([i, j]);
  assert.ok(pairs.length > 6, "lip pairs found: " + pairs.length);
  for (const key of castShapeAxes) {
    const shaped = evaluateHuman({ ...drawn, [key]: 1 }), q = shaped.positions;
    for (const group of base.eyeGroups) {
      let worst = 0;
      for (let i = 0; i < group.length; i += 3) for (let j = 1; j < group.length; j += 7)
        worst = Math.max(worst, Math.abs(dist(q, group[i], group[j]) - dist(p, group[i], group[j])));
      assert.ok(worst < 3e-5, `${key} bends an eyeball by ${worst}`);
    }
    // A foundation may thin or fill the lips with the lower face it brings. It never folds one over the other.
    for (const [i, j] of pairs) { const r = dist(q, i, j) / dist(p, i, j); assert.ok(r > .45 && r < 1.5 && (Math.abs(p[3*i+1]-p[3*j+1]) < .001 || (q[3*i+1]-q[3*j+1]) * (p[3*i+1]-p[3*j+1]) > 0), `${key} folds the lips at ${i},${j}: ${r}`); }
  }
});

test("a draw is repeatable, wears at most one foundation of either kind, and its measurements are valid", () => {
  let cast = 0;
  for (let seed = 830500; seed < 830560; seed++) {
    const spec = randomHuman(seed, "any", { fitRestingLips: false });
    assert.ok(validHuman(spec));
    assert.deepEqual(randomHuman(seed, "any", { fitRestingLips: false }), spec);
    const worn = [...portraitAxes, ...castShapeAxes].filter(key => spec[key] > 0);
    assert.equal(worn.length, 1);
    if (castShapeAxes.includes(worn[0])) { cast++; assert.ok(spec.frame > .2, "only a male frame draws a cast foundation"); }
  }
  assert.ok(cast > 4 && cast < 30, "cast foundations are drawn, beside the earlier ones: " + cast);
});
