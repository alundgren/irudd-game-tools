import assert from "node:assert/strict";
import test from "node:test";
import { BufferAttribute, BufferGeometry } from "three";
import { humanForm, changeHuman } from "./human-form.js";
import { evaluateHuman, humanControls } from "./human-surface.js";
import { fitHumanReference, optimizeHumanMeasurements } from "./human-fit.js";
import { exteriorSkin } from "./human-fit-exterior.js";
import {
  headFitSupport,
  smoothHeadFit,
  headFitDistortion,
} from "./human-fit-head.js";

test("a crown pulled upward keeps its curved profile and the saved height", () => {
  const base = evaluateHuman({height:1.72}), ids = humanControls().ids;
  const controls = Array.from(ids, (v,i) =>
    base.positions[v*3+1] > 1.64 ? [i,0,180,0] : null).filter(Boolean);
  const shaped = evaluateHuman({height:1.72}, {version:1,strength:1,controls});
  let oldAtTop = 0, newAtTop = 0, moved = 0;
  for (let i=0; i<base.bodyVertices; i++) {
    const y = base.positions[3*i+1], now = shaped.positions[3*i+1];
    if (Math.abs(y-base.height) < 1e-6) oldAtTop++;
    if (Math.abs(now-base.height) < 1e-6) newAtTop++;
    if (y>1.64 && now-y > .001) moved++;
    assert.ok(now <= base.height+1e-6);
  }
  assert.ok(moved>5);
  assert.equal(newAtTop,oldAtTop);
});

test("the head fit reading catches a folded triangle at the same pose", () => {
  const before = {
    names: ["head"],
    bodyTriangles: 1,
    indices: [0, 1, 2],
    boneIndices: new Uint8Array(12),
    positions: [0, 0, 0, 0.01, 0, 0, 0, 0.01, 0],
  };
  assert.deepEqual(headFitDistortion(before, before), {
    triangles: 1,
    pastPerpendicular: 0,
  });
  const folded = { ...before, positions: [0, 0, 0, 0.01, 0, 0, 0, -0.004, 0] };
  assert.deepEqual(headFitDistortion(before, folded), {
    triangles: 1,
    pastPerpendicular: 1,
  });
});

test("a fit moves adjacent facial rims together and preserves a previous sculpt", () => {
  // Two nearby sides of a lip opening and one distant cheek anchor.
  const surface = {
    height: 1.72,
    names: ["head"],
    boneIndices: new Uint8Array(12),
    positions: [0, 0, 0, 0, 0.001, 0, 0.08, 0.04, 0.01],
  };
  const support = headFitSupport(surface, { ids: [0, 1, 2] }, [0, 1, 2]);
  const prior = new Float32Array([0, 0, 0.002, 0, 0, -0.001, 0, 0.003, 0]);
  const proposed = prior.slice();
  proposed[2] += 0.014;
  smoothHeadFit(proposed, prior, support);
  assert.ok(
    Math.abs(proposed[2] - prior[2] - (proposed[5] - prior[5])) < 0.0001,
  );
  assert.ok(proposed[5] - prior[5] > 0.006);
  assert.deepEqual(proposed.slice(6), prior.slice(6));
});

test("a second head fit keeps near-limit edits valid after neighbour smoothing", () => {
  const initial = Float32Array.of(.05, 0, 0, 0, 0, 0);
  const candidate = Float32Array.of(.0649, 0, 0, .045, 0, 0);
  smoothHeadFit(candidate, initial, [{ i: 0, near: [[0, 1], [1, 1]], total: 2 }]);
  assert.ok(candidate[0] >= .0648);
  assert.ok(Math.round(candidate[0] * 10000) <= 649);
});

test("a reference correction turns with its forearm and survives a return to rest", () => {
  const source = humanForm(),
    surface = evaluateHuman(source.human);
  const anchor = Array.from(humanControls().ids).findIndex(
    (v) => surface.names[surface.boneIndices[v * 4]] === "lowerarm_l",
  );
  assert.ok(anchor >= 0);
  source.humanFit = {
    version: 1,
    strength: 0.75,
    controls: [[anchor, 0, 0, 180]],
  };
  const bent = changeHuman(source, { elbowBend: 0.9 }),
    row = bent.humanFit.controls[0];
  assert.equal(bent.humanFit.strength, 0.75);
  assert.ok(
    Math.hypot(
      ...row.slice(1).map((n, i) => n - source.humanFit.controls[0][i + 1]),
    ) > 12,
  );
  assert.ok(Math.abs(Math.hypot(...row.slice(1)) - 180) < 1);
  const returned = changeHuman(bent, { elbowBend: 0 }).humanFit.controls[0];
  assert.ok(
    Math.hypot(
      ...returned
        .slice(1)
        .map((n, i) => n - source.humanFit.controls[0][i + 1]),
    ) < 2,
  );
});
function targetFor(surface) {
  const g = new BufferGeometry();
  g.setAttribute(
    "position",
    new BufferAttribute(
      surface.positions.slice(0, surface.bodyVertices * 3),
      3,
    ),
  );
  g.setIndex(
    new BufferAttribute(surface.indices.slice(0, surface.bodyTriangles * 3), 1),
  );
  return g;
}

test("fitting a one-sided scan leaves the unobserved side of the cage at its prior", () => {
  const form = humanForm({ height: 1.72 });
  const source = evaluateHuman(form.human);
  const scan = targetFor(evaluateHuman({ ...form.human, belly: 0.8, chest: 0.4 }));
  const pos = scan.attributes.position;
  const visible = [];
  for (let i = 0; i < scan.index.count; i += 3) {
    const [a, b, c] = scan.index.array.subarray(i, i + 3);
    const nz = (pos.getX(b) - pos.getX(a)) * (pos.getY(c) - pos.getY(a)) -
      (pos.getY(b) - pos.getY(a)) * (pos.getX(c) - pos.getX(a));
    if (nz > 0) visible.push(a, b, c);
  }
  scan.setIndex(visible);
  const { metrics, fit } = fitHumanReference(form, scan, { region: "trunk" });
  assert.equal(metrics.observedSurfaceOnly, true);
  assert.ok(metrics.after.meanMm < 0.85 * metrics.before.meanMm);
  const geometry = targetFor(source);
  geometry.computeVertexNormals();
  const ids = humanControls().ids;
  for (const [i] of fit.controls) assert.ok(geometry.attributes.normal.getZ(ids[i]) > -0.1);
  geometry.dispose();
  scan.dispose();
});

test("an isolated scan ending below the crown leaves unobserved crown controls alone", () => {
  const form = humanForm({ height: 1.72 });
  const s = evaluateHuman(form.human);
  const scan = targetFor(s);
  const pos = scan.attributes.position;
  const faces = [];
  const cut = s.height - .075;
  for (let f = 0; f < scan.index.count; f += 3) {
    const tri = scan.index.array.subarray(f, f+3);
    if (tri.every(v => pos.getY(v) < cut && pos.getY(v) > cut-.16)) faces.push(...tri);
  }
  scan.setIndex(faces);
  const result = fitHumanReference(form, scan, {region:"head", isolatedHead:true});
  const ids = humanControls().ids;
  const crown = result.fit.controls.filter(([i]) => pos.getY(ids[i]) > cut + .015);
  assert.deepEqual(crown, []);
  assert.ok(result.metrics.fittedAnchors > 20);
  scan.dispose();
});

test("an external head scan leaves every internal mouth anchor at its prior", () => {
  const form = humanForm({ height: 1.72 }), source = evaluateHuman(form.human);
  const exterior = exteriorSkin(source), anchors = humanControls().ids;
  const inner = Array.from(anchors, (v,i) => exterior[v] ? -1 : i).filter(i => i >= 0);
  assert.ok(inner.length > 20);
  const surface = evaluateHuman({ ...form.human, cheeks: .55, lips: .4 });
  const scan = targetFor(surface);
  const triangles = [];
  for (let i=0; i<surface.bodyTriangles * 3; i+=3) {
    const tri = surface.indices.subarray(i,i+3);
    if (tri.every(v => exterior[v] && surface.names[surface.boneIndices[v*4]] === "head")) triangles.push(...tri);
  }
  scan.setIndex(triangles);
  const retained = [inner[0], 0, 28, 0];
  form.humanFit = { version: 1, strength: 1, controls: [retained] };
  const result = fitHumanReference(form, scan, { region: "head", isolatedHead: true });
  assert.deepEqual(result.fit.controls.filter(([id]) => inner.includes(id)), [retained]);
  assert.ok(result.fit.controls.length > 1);
  scan.dispose();
});

test("a leg fit recovers toe-to-heel length on larger and smaller feet", () => {
  const form = humanForm({ height: 1.72 });
  const extent = (surface) => {
    let back = Infinity,
      front = -Infinity;
    for (let i = 0; i < surface.bodyVertices; i++) {
      const [x, y, z] = surface.positions.subarray(i * 3, i * 3 + 3);
      if (x <= 0 || y > surface.height * 0.055) continue;
      back = Math.min(back, z);
      front = Math.max(front, z);
    }
    return front - back;
  };
  for (const feet of [-0.85, 0.85]) {
    const reference = evaluateHuman({ ...form.human, feet });
    const geometry = targetFor(reference);
    const fitted = optimizeHumanMeasurements(form, geometry, {
      region: "legs",
    }).form;
    const length = extent(evaluateHuman(fitted.human));
    assert.ok(Math.abs(length - extent(reference)) < 0.0021);
    geometry.dispose();
  }
});

test("unreferenced vertices in a scan cannot lengthen the fitted feet", () => {
  const form = humanForm({ height: 1.72 });
  const g = targetFor(evaluateHuman({ ...form.human, feet: -0.8 }));
  const clean = optimizeHumanMeasurements(form, g, { region: "legs" }).form;
  const positions = g.attributes.position.array;
  const padded = new Float32Array(positions.length + 6);
  padded.set(positions);
  padded.set([0.12, 0.05, 0.21, -0.12, 0.05, 0.21], positions.length);
  g.setAttribute("position", new BufferAttribute(padded, 3));
  const partial = optimizeHumanMeasurements(form, g, { region: "legs" }).form;
  assert.deepEqual(partial.human, clean.human);
  g.dispose();
});

test("refitting identical geometry has submillimetre residuals and leaves the recipe alone", () => {
  const form = humanForm({ frame: -0.35, height: 1.61, stance: 0.7 });
  const original = JSON.stringify(form),
    g = targetFor(evaluateHuman(form.human));
  const { metrics, fit } = fitHumanReference(form, g);
  assert.ok(metrics.after.p95Mm < 0.1);
  assert.equal(fit.controls.length, 0);
  assert.equal(JSON.stringify(form), original);
  g.translate(3, 0, 0);
  assert.throws(() => fitHumanReference(form, g), /overlap/);
  g.dispose();
});

test("fitting a fuller chest improves its surface while the head and feet stay still", () => {
  const form = humanForm({
    frame: -0.8,
    height: 1.74,
    stance: 0.72,
    bust: -0.6,
  });
  const a = evaluateHuman(form.human);
  const g = targetFor(
    evaluateHuman({ ...form.human, bust: 0.85, chest: 0.32 }),
  );
  const { metrics, fit } = fitHumanReference(form, g, { region: "trunk" });
  assert.ok(metrics.after.meanMm < metrics.before.meanMm * 0.75);
  const b = evaluateHuman(form.human, fit);
  for (let i = 0; i < a.bodyVertices; i++) {
    const j = i * 3,
      y = a.positions[j + 1];
    if (y < 0.35 || y > 1.55)
      for (let k = 0; k < 3; k++)
        assert.ok(Math.abs(a.positions[j + k] - b.positions[j + k]) < 0.0001);
  }
  g.dispose();
});
