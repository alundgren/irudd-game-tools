import test from "node:test";
import assert from "node:assert/strict";
import { BufferAttribute, BufferGeometry, Matrix4, Vector3 } from "three";
import { evaluateHuman, smoothHumanSurface } from "./human-surface.js";
import { humanForm } from "./human-form.js";
import { fitHumanReference, optimizeHumanMeasurements } from "./human-fit.js";
import { surfaceIndex } from "./human-reference-align.js";
import { placeHeadScan } from "./head-registration.js";
import {
  clearMask,
  createMask,
  hideBeyond,
  hidePatch,
  maskSummary,
  maskText,
  maskedIndices,
  undoMask,
  underMask,
  vertexAreas,
} from "./reference-mask.js";

function ball(rings = 24, around = 48, radius = 0.09, centre = [0, 1.6, 0]) {
  const positions = [],
    indices = [];
  for (let i = 0; i <= rings; i++)
    for (let j = 0; j < around; j++) {
      const a = (Math.PI * i) / rings,
        b = (2 * Math.PI * j) / around;
      positions.push(
        centre[0] + radius * Math.sin(a) * Math.sin(b),
        centre[1] + radius * Math.cos(a),
        centre[2] + radius * Math.sin(a) * Math.cos(b),
      );
    }
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < around; j++) {
      const a = i * around + j,
        b = i * around + ((j + 1) % around),
        c = a + around,
        d = b + around;
      if (i) indices.push(a, c, b);
      if (i < rings - 1) indices.push(b, c, d);
    }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
}
const middle = ({ positions, indices }, f) =>
  [0, 1, 2].map((d) => [0, 1, 2].reduce((sum, k) => sum + positions[indices[f * 3 + k] * 3 + d], 0) / 3);

test("a cut hides what lies beyond the click and leaves the reference itself alone", () => {
  const scan = ball(),
    before = { positions: scan.positions.slice(), indices: scan.indices.slice() },
    mask = createMask(scan.indices.length / 3);
  const hidden = hideBeyond(mask, scan.positions, scan.indices, [0, 1.645, 0.078], [0, 1, 0]);
  assert.ok(hidden > 0 && hidden === mask.count);
  for (let f = 0; f < mask.hidden.length; f++)
    assert.equal(Boolean(mask.hidden[f]), middle(scan, f)[1] > 1.645, "triangle " + f);
  assert.deepEqual(scan, before, "positions and indices are untouched");
  const summary = maskSummary(mask, scan.positions, scan.indices);
  assert.ok(Math.abs(summary.hiddenArea - 0.25) < 0.02, "area share " + summary.hiddenArea);
  assert.equal(summary.hiddenTriangles, hidden);
  assert.match(maskText(summary), /^\d+ of 2,208 triangles hidden, 2\d% of the reference's surface$/);
  const lists = maskedIndices(mask, scan.indices);
  assert.equal(lists.shown.length + lists.hidden.length, scan.indices.length);
  lists.kept.forEach((f, i) => {
    assert.equal(mask.hidden[f], 0);
    assert.deepEqual(Array.from(lists.shown.subarray(i * 3, i * 3 + 3)), Array.from(scan.indices.subarray(f * 3, f * 3 + 3)));
  });
  const tilted = createMask(scan.indices.length / 3),
    slope = new Vector3(0, 1, 1).normalize().toArray();
  hideBeyond(tilted, scan.positions, scan.indices, [0, 1.62, 0.0877], slope);
  const kept = (y, z) => {
    for (let f = 0; f < tilted.hidden.length; f++) {
      const c = middle(scan, f);
      if (Math.abs(c[0]) < 0.01 && Math.abs(c[1] - y) < 0.006 && Math.abs(c[2] - z) < 0.01) return !tilted.hidden[f];
    }
    throw new Error("no triangle there");
  };
  assert.equal(kept(1.6636, 0.0636), false, "the forehead is cut");
  assert.equal(kept(1.6886, -0.0156), true, "the back of the crown stays");
});

test("patches add up, undo one at a time and never hide everything", () => {
  const scan = ball(),
    mask = createMask(scan.indices.length / 3),
    chin = [0, 1.6 - 0.09 * Math.cos(0.5), 0.09 * Math.sin(0.5)],
    inside = (f, radius) => Math.hypot(...middle(scan, f).map((x, d) => x - chin[d])) < radius;
  const first = hidePatch(mask, scan.positions, scan.indices, chin, 0.025);
  assert.ok(first > 4);
  for (let f = 0; f < mask.hidden.length; f++) assert.equal(Boolean(mask.hidden[f]), inside(f, 0.025));
  assert.equal(hidePatch(mask, scan.positions, scan.indices, chin, 0.025), 0);
  assert.equal(mask.steps.length, 1);
  const second = hidePatch(mask, scan.positions, scan.indices, chin, 0.04);
  assert.ok(second > 0 && mask.count === first + second && mask.steps.length === 2);
  const cut = hideBeyond(mask, scan.positions, scan.indices, [0, 1.66, 0], [0, 1, 0]);
  assert.equal(mask.count, first + second + cut);
  assert.equal(undoMask(mask), cut);
  assert.equal(undoMask(mask), second);
  assert.equal(mask.count, first);
  for (let f = 0; f < mask.hidden.length; f++) assert.equal(Boolean(mask.hidden[f]), inside(f, 0.025));
  const state = [Array.from(mask.hidden), mask.steps.length, mask.count];
  assert.throws(() => hideBeyond(mask, scan.positions, scan.indices, [0, 1.4, 0], [0, 1, 0]), /hide the whole reference/);
  assert.throws(() => hidePatch(mask, scan.positions, scan.indices, [0, 1.6, 0], 0.2), /hide the whole reference/);
  assert.deepEqual([Array.from(mask.hidden), mask.steps.length, mask.count], state);
  assert.equal(clearMask(mask), first);
  assert.equal(undoMask(mask), 0);
  assert.equal(maskSummary(mask, scan.positions, scan.indices).hiddenArea, 0);
  assert.equal(maskedIndices(mask, scan.indices).shown.length, scan.indices.length);
});

test("skin under a hidden part is told apart from skin beside what is on show", () => {
  const scan = ball(),
    mask = createMask(scan.indices.length / 3);
  hideBeyond(mask, scan.positions, scan.indices, [0, 1.645, 0], [0, 1, 0]);
  const lists = maskedIndices(mask, scan.indices),
    shown = surfaceIndex(scan.positions, lists.shown),
    hidden = underMask(surfaceIndex(scan.positions, lists.hidden)),
    under = (point) => hidden(point, shown(point));
  const at = (angle) => new Vector3(0, 1.6 + 0.095 * Math.cos(angle), 0.095 * Math.sin(angle));
  assert.equal(under(at(0.2)), true);
  assert.equal(under(at(1.6)), false);
  assert.equal(under(at(Math.acos(0.5) - 0.15)), true);
  assert.equal(under(at(Math.acos(0.5) + 0.15)), false);
  const skin = ball(24, 48, 0.095),
    areas = vertexAreas(skin.positions, skin.indices),
    point = new Vector3();
  let covered = 0,
    total = 0,
    vertices = 0;
  for (let v = 0; v < areas.length; v++) {
    total += areas[v];
    if (!under(point.fromArray(skin.positions, v * 3))) continue;
    covered += areas[v];
    vertices++;
  }
  assert.ok(Math.abs(total - 4 * Math.PI * 0.095 ** 2) / total < 0.01, "areas add up to the ball");
  assert.ok(Math.abs(covered / total - 0.25) < 0.03, "by area " + (covered / total).toFixed(3));
  assert.ok(vertices / areas.length > 0.3, "by count " + (vertices / areas.length).toFixed(3));
  const flat = Float32Array.from([...skin.indices].flatMap((v) => [...skin.positions.subarray(v * 3, v * 3 + 3)]));
  assert.ok(Math.abs(vertexAreas(flat).reduce((a, b) => a + b, 0) - total) < 1e-6);
});

function cappedHead() {
  const form = humanForm({}),
    cage = evaluateHuman(form.human),
    s = smoothHumanSurface(cage),
    head = s.names.indexOf("head");
  const owner = (v) => {
    let best = v * 4;
    for (let j = best + 1; j < v * 4 + 4; j++) if (s.weights[j] > s.weights[best]) best = j;
    return s.boneIndices[best];
  };
  const seen = new Map(),
    positions = [],
    indices = [];
  for (let f = 0; f < s.bodyTriangles; f++) {
    const corners = [0, 1, 2].map((k) => s.indices[f * 3 + k]);
    if (!corners.every((v) => owner(v) === head)) continue;
    for (const v of corners) {
      if (!seen.has(v)) {
        seen.set(v, positions.length / 3);
        positions.push(...s.positions.subarray(v * 3, v * 3 + 3));
      }
      indices.push(seen.get(v));
    }
  }
  const brow = 1.63,
    centre = [0, 1.62, 0.03],
    p = Float32Array.from(positions);
  for (let i = 0; i < p.length; i += 3) {
    if (p[i + 1] <= brow) continue;
    const reach = Math.hypot(...[0, 1, 2].map((d) => p[i + d] - centre[d])),
      lift = (Math.min(1, (p[i + 1] - brow) / 0.01) * 0.025) / reach;
    for (let d = 0; d < 3; d++) p[i + d] += (p[i + d] - centre[d]) * lift;
  }
  return { form, cage, brow, raw: { positions: p, indices: Uint32Array.from(indices) } };
}
function geometry(positions, indices) {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(positions, 3));
  g.setIndex(new BufferAttribute(indices, 1));
  return g;
}

test("a head fit follows a cap until it is hidden, then holds the crown and fits the face", () => {
  const { form, cage, brow, raw } = cappedHead(),
    mask = createMask(raw.indices.length / 3);
  const crownOf = (after) => {
    let crown = 0;
    for (let v = 0; v < cage.bodyVertices; v++)
      if (cage.positions[v * 3 + 1] > brow + 0.02)
        crown = Math.max(crown, 1000 * Math.hypot(...[0, 1, 2].map((d) => after.positions[v * 3 + d] - cage.positions[v * 3 + d])));
    return crown;
  };
  function fitted(indices, hold) {
    const result = fitHumanReference(form, geometry(raw.positions, indices), { region: "head", isolatedHead: true, hold });
    return { crown: crownOf(evaluateHuman(form.human, result.fit)), ...result.metrics };
  }
  const whole = fitted(raw.indices);
  assert.ok(whole.crown > 15, "the unmasked fit follows the cap: " + whole.crown.toFixed(1) + " mm");
  assert.equal(whole.heldAnchors, undefined);
  hideBeyond(mask, raw.positions, raw.indices, [0, brow - 0.004, 0.1], [0, 1, 0]);
  const lists = maskedIndices(mask, raw.indices),
    shown = surfaceIndex(raw.positions, lists.shown),
    under = underMask(surfaceIndex(raw.positions, lists.hidden)),
    hold = (point) => under(point, shown(point)),
    masked = fitted(lists.shown, hold);
  assert.ok(masked.crown < 0.05, "the crown holds: " + masked.crown.toFixed(3) + " mm");
  assert.equal(masked.eligibleAnchors, whole.eligibleAnchors);
  assert.ok(masked.heldAnchors > 60 && masked.fittedAnchors > 100);
  assert.ok(masked.fittedAnchors + masked.heldAnchors <= masked.eligibleAnchors);
  assert.ok(masked.after.samples < whole.after.samples && masked.after.meanMm < 0.6, masked.after.meanMm + " mm");
  const kept = fitted(raw.indices, hold);
  assert.ok(kept.crown < 0.05 && kept.heldAnchors === masked.heldAnchors, "crown " + kept.crown.toFixed(3) + " mm");
  const sliders = (indices, hold) => {
    const result = optimizeHumanMeasurements(form, geometry(raw.positions, indices), { region: "head", isolatedHead: true, hold }),
      moved = Object.keys(result.form.human).filter((k) => Math.abs(result.form.human[k] - (form.human[k] ?? 0)) > 0.2);
    return { moved, crown: crownOf(evaluateHuman(result.form.human)), samples: result.metrics.after.samples };
  };
  const loose = sliders(raw.indices),
    careful = sliders(lists.shown, hold);
  assert.ok(loose.moved.length > 8 && loose.crown > 10, loose.moved.join());
  assert.deepEqual(careful.moved, []);
  assert.ok(careful.crown < 2 && careful.samples < loose.samples, "crown " + careful.crown.toFixed(2) + " mm");
  clearMask(mask);
  assert.deepEqual(fitted(maskedIndices(mask, raw.indices).shown), whole);
});

test("masking leaves the placement of a registered scan exactly where it was", () => {
  const { form, raw } = cappedHead(),
    surface = evaluateHuman(form.human),
    registration = {
      transform: new Matrix4().makeRotationY(0.2).setPosition(0.004, -0.002, 0.003),
      scale: 1,
      rmsMm: 1.2,
    },
    options = { units: "m", up: "y", turn: "0", nudge: [0, 0, 0] },
    whole = { positions: raw.positions.slice(), indices: raw.indices.slice() },
    before = placeHeadScan(raw, options, surface, registration).positions,
    mask = createMask(raw.indices.length / 3);
  hideBeyond(mask, before, raw.indices, [0, 1.63, 0.1], [0, 1, 0]);
  hidePatch(mask, before, raw.indices, [0, 1.52, 0.14], 0.03);
  assert.deepEqual(raw, whole);
  assert.deepEqual(placeHeadScan(raw, options, surface, registration).positions, before);
  const lists = maskedIndices(mask, raw.indices);
  assert.ok(lists.hidden.length > 0 && lists.shown.length + lists.hidden.length === raw.indices.length);
});
