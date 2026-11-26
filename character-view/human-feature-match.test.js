import test from "node:test";
import assert from "node:assert/strict";
import { evaluateHuman, smoothHumanSurface } from "./human-surface.js";
import { humanForm } from "./human-form.js";
import { validateForm } from "./recipe.js";
import { featureText, matchFeature } from "./human-feature-match.js";

const smooth = (form) => smoothHumanSurface(evaluateHuman(form.human, form.humanFit));
const centre = (surface, face) =>
  [0, 1, 2].map(
    (d) =>
      [0, 1, 2].reduce((sum, k) => sum + surface.positions[surface.indices[face * 3 + k] * 3 + d], 0) / 3,
  );
function faceNear(surface, [x, y, z]) {
  const want = [x, y, z].map((v) => v * surface.height);
  let best = -1,
    gap = Infinity;
  for (let face = 0; face < surface.bodyTriangles; face++) {
    const d = Math.hypot(...centre(surface, face).map((v, i) => v - want[i]));
    if (d < gap) {
      gap = d;
      best = face;
    }
  }
  return best;
}
const touchAt = (surface, face) => ({ face, point: centre(surface, face) });
const add = (a, b) => a.map((v, d) => v + b[d]);
const mm = (a, b) => 1000 * Math.hypot(...a.map((v, d) => v - b[d]));
function most(a, b, keep = () => true) {
  let far = 0;
  for (let v = 0; v < a.positions.length / 3; v++)
    if (keep(v, a.positions.subarray(v * 3, v * 3 + 3)))
      far = Math.max(far, mm(a.positions.subarray(v * 3, v * 3 + 3), b.positions.subarray(v * 3, v * 3 + 3)));
  return far;
}

const base = humanForm({}, 11),
  bare = smooth(base),
  cheek = faceNear(bare, [0.028, 0.905, 0.052]),
  chin = faceNear(bare, [0, 0.868, 0.058]);

test("the clicked skin travels to the reference point along each axis and a diagonal", () => {
  const touch = touchAt(bare, cheek);
  for (const step of [
    [0.004, 0, 0],
    [-0.004, 0, 0],
    [0, 0.004, 0],
    [0, -0.004, 0],
    [0, 0, 0.004],
    [0, 0, -0.004],
    [0.003, -0.002, 0.0035],
  ]) {
    const result = matchFeature(base, touch, add(touch.point, step)),
      after = smooth(result.form),
      now = centre(after, cheek);
    assert.ok(result.changed && !result.held, "step " + step);
    assert.ok(mm(now, add(touch.point, result.moved)) < 0.02, "reading and recipe agree for " + step);
    for (let d = 0; d < 3; d++)
      assert.ok(
        Math.abs(now[d] - touch.point[d] - step[d]) < 0.0003,
        "axis " + d + " of " + step + ": " + (1000 * (now[d] - touch.point[d])).toFixed(2) + " mm",
      );
    assert.ok(Math.abs(result.requestedMm - 1000 * Math.hypot(...step)) < 1e-6);
    assert.ok(result.leftMm < 0.3 && Math.abs(result.achievedMm - result.requestedMm) < 0.3);
    assert.doesNotThrow(() => validateForm(result.form));
  }
});

test("the match is measured on the current skin and keeps what was fitted before", () => {
  const first = touchAt(bare, chin),
    earlier = matchFeature(base, first, add(first.point, [0, -0.004, 0.006])),
    current = earlier.form,
    shown = smooth(current),
    original = structuredClone(current);
  assert.ok(mm(centre(shown, chin), centre(bare, chin)) > 6.5);
  const touch = touchAt(shown, chin),
    target = add(touch.point, [0, 0.003, 0]),
    result = matchFeature(current, touch, target),
    after = smooth(result.form);
  assert.ok(Math.abs(result.requestedMm - 3) < 1e-6 && result.leftMm < 0.3);
  assert.ok(mm(centre(after, chin), target) < 0.3, "the current chin reaches the reference");
  assert.ok(mm(centre(bare, chin), target) > 6);
  assert.ok(Math.abs(centre(after, chin)[2] - centre(shown, chin)[2]) < 0.0003, "the earlier forward move is kept");
  assert.deepEqual(current, original, "the recipe the step started from is untouched");
  assert.ok(!base.humanFit, "and so is the form the dialog opened with");
  const side = touchAt(after, faceNear(after, [0.062, 0.925, 0.012])),
    third = matchFeature(result.form, side, add(side.point, [0.003, 0, 0]), { reach: 0.03 }),
    last = smooth(third.form);
  assert.ok(third.changed && mm(centre(last, chin), centre(after, chin)) < 0.6);
});

test("the rest of the body stays as it was", () => {
  const touch = touchAt(bare, cheek),
    result = matchFeature(base, touch, add(touch.point, [0.003, 0.002, 0.005])),
    after = smooth(result.form),
    area = result.areaMm / 1000;
  assert.ok(area >= 0.05 && area < 0.11, "area " + result.areaMm.toFixed(0) + " mm");
  assert.equal(most(bare, after, (v, p) => p[1] < 0.84 * bare.height), 0);
  const far = most(bare, after, (v, p) => Math.hypot(...touch.point.map((x, d) => p[d] - x)) > area * 1.35);
  assert.ok(far < 0.01, "skin beyond the area moved " + far.toFixed(4) + " mm");
  assert.ok(most(bare, after) > 5.5);
  const other = touchAt(bare, faceNear(bare, [-0.028, 0.905, 0.052]));
  assert.ok(mm(centre(after, other.face), other.point) < 0.5);
  const mirrored = matchFeature(base, touch, add(touch.point, [0.003, 0.002, 0.005]), { mirror: true }),
    both = smooth(mirrored.form),
    twin = centre(both, other.face).map((x, d) => x - other.point[d]),
    mine = centre(both, cheek).map((x, d) => x - touch.point[d]);
  assert.ok(Math.abs(twin[0] + mine[0]) < 0.0006 && Math.abs(twin[1] - mine[1]) < 0.0006 && Math.abs(twin[2] - mine[2]) < 0.0006);
});

test("a far reference point is held to the brush limit and reported", () => {
  const touch = touchAt(bare, cheek),
    result = matchFeature(base, touch, add(touch.point, [0, 0, 0.04]));
  assert.ok(result.held && result.changed);
  assert.ok(result.limitMm >= 10 && result.limitMm <= 50, "limit " + result.limitMm.toFixed(1) + " mm");
  assert.ok(result.achievedMm <= result.limitMm + 0.3 && result.achievedMm > 0.8 * result.limitMm);
  assert.ok(Math.abs(result.leftMm - (40 - result.achievedMm)) < 0.5);
  const wide = matchFeature(base, touch, add(touch.point, [0, 0, 0.04]), { reach: 0.12 });
  assert.ok(wide.achievedMm > result.achievedMm + 5);
  assert.match(featureText({ part: "head", ...result }), /asked 40\.0 mm, moved \d+\.\d mm .* held to/);
  assert.doesNotThrow(() => validateForm(result.form));
});

test("points that already meet change nothing, and broken input is refused", () => {
  const touch = touchAt(bare, cheek),
    same = matchFeature(base, touch, touch.point);
  assert.equal(same.changed, false);
  assert.equal(same.form, base);
  assert.ok(same.requestedMm < 1e-6 && same.achievedMm === 0);
  assert.throws(() => matchFeature(base, { face: -1, point: touch.point }, touch.point), /not part of this body/);
  assert.throws(() => matchFeature(base, { face: bare.bodyTriangles, point: touch.point }, touch.point), /not part of this body/);
  assert.throws(() => matchFeature(base, touch, [0, NaN, 0]), /finite/);
  assert.throws(() => matchFeature({}, touch, touch.point), /adult human/);
});
