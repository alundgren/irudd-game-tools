import assert from "node:assert/strict";
import test from "node:test";
import { Matrix4, Quaternion, Vector3 } from "three";
import {
  alignPoints,
  contactPairs,
  foldedTriangles,
  registerFamily,
  transformPoints,
  wrapFamilyMember,
} from "./family-transfer.js";
import { evaluateHuman, smoothHumanSurface } from "./human-surface.js";
import {
  applyHumanDetail,
  regionMeasurements,
  registerHumanFamily,
  transferHumanIdentity,
  validHumanDetail,
} from "./human-family-transfer.js";

function ball(radius, rings, spokes, shape = (x, y, z) => [x, y, z]) {
  const positions = [0, radius, 0], indices = [];
  for (let r = 1; r < rings; r++)
    for (let s = 0; s < spokes; s++) {
      const a = (Math.PI * r) / rings, b = (2 * Math.PI * s) / spokes;
      positions.push(radius * Math.sin(a) * Math.cos(b), radius * Math.cos(a), radius * Math.sin(a) * Math.sin(b));
    }
  positions.push(0, -radius, 0);
  const at = (r, s) => 1 + (r - 1) * spokes + (s % spokes), last = positions.length / 3 - 1;
  for (let s = 0; s < spokes; s++) {
    indices.push(0, at(1, s + 1), at(1, s));
    for (let r = 1; r < rings - 1; r++) indices.push(at(r, s), at(r, s + 1), at(r + 1, s), at(r, s + 1), at(r + 1, s + 1), at(r + 1, s));
    indices.push(last, at(rings - 1, s), at(rings - 1, s + 1));
  }
  const out = new Float32Array(positions.length);
  for (let i = 0; i < out.length; i += 3) out.set(shape(positions[i], positions[i + 1], positions[i + 2]), i);
  return { positions: out, indices: Uint32Array.from(indices) };
}
const farthest = (a, b) => {
  let most = 0;
  for (let i = 0; i < a.length; i += 3) most = Math.max(most, Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1], a[i + 2] - b[i + 2]));
  return most;
};

test("a registered surface follows a family member through its own triangles", () => {
  const neutral = ball(0.1, 24, 32), base = ball(0.1015, 13, 17);
  const registration = registerFamily(neutral, base);
  assert.ok(registration.vertex.length > 0.95 * base.positions.length / 3);
  const rows = (positions) => Float32Array.from(Array.from(registration.vertex).flatMap((v) => Array.from(positions.subarray(v * 3, v * 3 + 3))));

  assert.ok(farthest(wrapFamilyMember(registration, neutral), rows(base.positions)) < 1e-6);

  const matrix = new Matrix4().compose(new Vector3(0.3, -0.1, 0.2),
    new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), 0.7), new Vector3(1.2, 1.2, 1.2));
  const moved = { positions: transformPoints(neutral.positions, matrix), indices: neutral.indices };
  assert.ok(farthest(wrapFamilyMember(registration, moved), transformPoints(rows(base.positions), matrix)) < 1e-5);

  const squashed = ball(0.1, 24, 32, (x, y, z) => [x, 0.8 * y, z]);
  const landed = wrapFamilyMember(registration, squashed, 0);
  for (let i = 0; i < landed.length; i += 3) {
    const radius = Math.hypot(landed[i], landed[i + 1] / 0.8, landed[i + 2]);
    assert.ok(Math.abs(radius - 0.1) < 0.0006, "vertex " + i / 3 + " is off the member by " + (radius - 0.1));
  }

  assert.throws(() => wrapFamilyMember(registration, ball(0.1, 20, 32)), /topology/);
});

test("layered skin that faces another surface stays unregistered", () => {
  const neutral = ball(0.1, 24, 32), outer = ball(0.1015, 13, 17), inner = ball(0.094, 13, 17);
  const count = outer.positions.length / 3;
  const positions = new Float32Array(count * 6);
  positions.set(outer.positions);
  positions.set(inner.positions, count * 3);
  const indices = Uint32Array.from([...outer.indices, ...Array.from(inner.indices, (i) => i + count)]);
  const registration = registerFamily(neutral, { positions, indices });
  assert.ok(Array.from(registration.vertex).every((v) => v < count));
});

test("alignment recovers a turn, a move and a size", () => {
  const from = ball(0.1, 6, 7).positions;
  const matrix = new Matrix4().compose(new Vector3(0.02, 0.5, -0.3),
    new Quaternion().setFromAxisAngle(new Vector3(-1, 0.5, 2).normalize(), 1.1), new Vector3(0.9, 0.9, 0.9));
  const to = transformPoints(from, matrix);
  const found = alignPoints(from, to, { scale: true });
  assert.ok(Math.abs(found.scale - 0.9) < 1e-5);
  assert.ok(farthest(transformPoints(from, found.matrix), to) < 1e-6);
  assert.ok(Math.abs(alignPoints(from, to).scale - 1) < 1e-12);
});

test("folds and touching skin are found without a list of vertices", () => {
  const flat = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0, 0, 1, 0, 1, 1, 0, 2, 1, 0, 3, 1, 0, 4, 1, 0]);
  const indices = new Uint32Array([0, 1, 5, 1, 6, 5, 1, 2, 6, 2, 7, 6, 2, 3, 7, 3, 8, 7, 3, 4, 8, 4, 9, 8]);
  assert.equal(foldedTriangles(flat, flat, indices, 8).folded.length, 0);
  const pulled = flat.slice();
  pulled[2 * 3] = 3.5;
  assert.ok(foldedTriangles(flat, pulled, indices, 8).folded.length > 0);

  const bent = flat.slice();
  for (const v of [4, 9]) { bent[v * 3] = 0.05; bent[v * 3 + 2] = 0.05; }
  const pairs = contactPairs(bent, indices, 8, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 0.2);
  assert.deepEqual(pairs.map(([a, b]) => [Math.min(a, b), Math.max(a, b)]).sort((a, b) => a[0] - b[0]), [[0, 4], [5, 9]]);
});

const smooth = (human) => {
  const s = smoothHumanSurface(evaluateHuman(human));
  return { positions: s.positions, indices: s.indices };
};

test("a head from a family reaches the editable adult and leaves the body alone", { timeout: 240000 }, () => {
  const base = { human: { height: 1.72 } };
  const registration = registerHumanFamily(base, smooth(base.human));
  assert.ok(registration.report.coverage.head.registered > 0.6 * registration.report.coverage.head.vertices);

  const nobody = transferHumanIdentity(registration, smooth(base.human), { controls: false, detail: true, keepOffset: 1 });
  assert.ok(nobody.metrics.start.maxMm < 0.02);
  assert.ok(nobody.metrics.detail.maxMm < 0.05);
  assert.equal(nobody.metrics.outsideRegionMaxMm, 0);

  const keys = regionMeasurements(base.human, "head");
  assert.ok(keys.length >= 4);
  const person = { height: 1.72 };
  keys.forEach((key, i) => { if (i % 3 === 0) person[key] = i % 2 ? -0.6 : 0.6; });
  const member = smooth(person);
  const coarse = transferHumanIdentity(registration, member, { controls: false });
  assert.ok(coarse.metrics.afterMeasurements.meanMm < 0.35 * coarse.metrics.start.meanMm,
    JSON.stringify([coarse.metrics.start, coarse.metrics.afterMeasurements]));
  assert.equal(coarse.detail, undefined);
  const share = Object.entries(person).filter(([key]) => key !== "height").map(([key, value]) => coarse.form.human[key] / value);
  assert.ok(share.every((x) => x > 0), JSON.stringify(share));
  assert.ok(share.sort((x, y) => x - y)[share.length >> 1] > 0.7, JSON.stringify(share));

  const fine = transferHumanIdentity(registration, member, { controls: false, detail: true });
  assert.ok(validHumanDetail(fine.detail));
  assert.ok(fine.metrics.afterDetail.meanMm <= fine.metrics.afterMeasurements.meanMm);
  assert.ok(fine.metrics.afterDetail.meanMm < 0.25, JSON.stringify(fine.metrics.afterDetail));
  assert.equal(fine.metrics.folds, 0);
  assert.equal(fine.metrics.outsideRegionMaxMm, 0);
  assert.ok(fine.metrics.contacts.afterMaxMm < fine.metrics.contacts.beforeMaxMm + 1.2);
  for (const eye of fine.metrics.eyes) assert.ok(eye.ballStretchMm < 1.5);

  const measured = evaluateHuman(fine.form.human, fine.form.humanFit);
  assert.ok(farthest(applyHumanDetail(measured, fine.detail, 0).positions, measured.positions) === 0);
  assert.ok(farthest(applyHumanDetail(measured, fine.detail).positions, fine.surface.positions) < 1e-6);

  assert.throws(() => transferHumanIdentity(registration, ball(0.1, 8, 9)), /topology/);
});
