import assert from "node:assert/strict";
import test from "node:test";
import { BufferAttribute, BufferGeometry } from "three";
import { humanForm } from "./human-form.js";
import { evaluateHuman, humanControls } from "./human-surface.js";
import { fitHumanReference, optimizeHumanMeasurements } from "./human-fit.js";
import { exteriorSkin } from "./human-fit-exterior.js";
import { eyeOpenings } from "./human-fit-eyes.js";

const eyeSliders = ["eyeSize", "eyeSpacing", "eyeFold", "eyeTilt", "underEye"];

// The outside of a head as an isolated scan: no lining of the mouth or the eye sockets.
function headScan(surface, keep = () => true) {
  const exterior = exteriorSkin(surface),
    triangles = [];
  for (let i = 0; i < surface.bodyTriangles * 3; i += 3) {
    const tri = surface.indices.subarray(i, i + 3);
    if (tri.every((v) => exterior[v] && surface.names[surface.boneIndices[v * 4]] === "head" && keep(v)))
      triangles.push(...tri);
  }
  const scan = new BufferGeometry();
  scan.setAttribute("position", new BufferAttribute(surface.positions.slice(0, surface.bodyVertices * 3), 3));
  scan.setIndex(triangles);
  return scan;
}
const rowsOn = (fit, flags) => fit.controls.filter(([i]) => flags[i]);

test("the eye openings are read from the head's own build", () => {
  const surface = evaluateHuman({ height: 1.72 }),
    eyes = eyeOpenings(surface),
    { ids, refs, weights } = humanControls();
  // Every anchor that moves an eyeball is kept, and so is its own skin.
  for (const group of surface.eyeGroups)
    for (const v of group)
      for (let j = v * 4; j < v * 4 + 4; j++) if (weights[j]) assert.equal(eyes.anchors[refs[j]], 1);
  const kept = Array.from(eyes.anchors.keys()).filter((i) => eyes.anchors[i]);
  assert.ok(kept.length >= 12 && kept.length <= 0.05 * ids.length);
  for (const i of kept) assert.equal(eyes.skin[ids[i]], 1);
  // The lining wraps each eyeball, lies in both halves alike and is not skin a scan can see.
  const exterior = exteriorSkin(surface);
  let left = 0,
    right = 0;
  for (let v = 0; v < surface.bodyVertices; v++) {
    if (!eyes.lining[v]) continue;
    assert.equal(exterior[v], 0);
    assert.equal(eyes.skin[v], 1);
    assert.equal(surface.names[surface.boneIndices[v * 4]], "head");
    surface.positions[v * 3] > 0 ? left++ : right++;
  }
  assert.ok(left > 50);
  assert.equal(left, right);
  // The lids stay observable: some kept anchors sit on skin a scan can see.
  assert.ok(kept.some((i) => exterior[ids[i]]));
  // The same skin on a head of another build.
  assert.equal(eyeOpenings(evaluateHuman({ height: 1.9, frame: 1, age: 0.8, weight: 0.7 })), eyes);
});

test("a head scan fits visible lids but never the lining of the eye sockets", () => {
  const form = humanForm({ height: 1.72 }),
    source = evaluateHuman(form.human),
    eyes = eyeOpenings(source),
    ids = humanControls().ids;
  const scan = headScan(evaluateHuman({ ...form.human, cheeks: 0.55, eyeSize: 0.9, underEye: 0.8 }));
  const lining = Array.from(ids, (v) => eyes.lining[v]),
    retained = [lining.indexOf(1), 0, 21, 0];
  form.humanFit = { version: 1, strength: 1, controls: [retained] };
  const { fit } = fitHumanReference(form, scan, { region: "head", isolatedHead: true });
  assert.deepEqual(rowsOn(fit, lining), [retained]);
  const lids = Array.from(ids, (v, i) => (eyes.anchors[i] && !eyes.lining[v] ? 1 : 0));
  assert.ok(rowsOn(fit, lids).length > 3);
  scan.dispose();
});

test("kept eye openings hold their anchors and an earlier sculpt while the rest is fitted", () => {
  const form = humanForm({ height: 1.72 }),
    source = evaluateHuman(form.human),
    eyes = eyeOpenings(source),
    ids = humanControls().ids;
  const lid = Array.from(ids.keys()).find((i) => eyes.anchors[i] && !eyes.lining[ids[i]]),
    retained = [lid, 0, 0, 14];
  form.humanFit = { version: 1, strength: 1, controls: [retained] };
  const target = evaluateHuman({ ...form.human, cheeks: 0.55, eyeSize: 0.9, underEye: 0.8 });
  // Once with the scan's eyes in place and once with holes where they were.
  for (const scan of [headScan(target), headScan(target, (v) => !eyes.skin[v])]) {
    const { fit, metrics } = fitHumanReference(form, scan, { region: "head", isolatedHead: true, keepEyeOpenings: true });
    assert.deepEqual(rowsOn(fit, eyes.anchors), [retained]);
    assert.equal(metrics.eyeOpeningsKept, true);
    assert.ok(fit.controls.length > 20);
    assert.ok(metrics.after.meanMm < metrics.before.meanMm);
    scan.dispose();
  }
});

test("kept eye openings leave the eye sliders where the artist set them", () => {
  const form = humanForm({ height: 1.72, eyeSize: 0.2 }),
    scan = headScan(evaluateHuman({ ...form.human, cheeks: 0.6, jaw: 0.5, eyeSpacing: 0.6, underEye: 0.8 }));
  const options = { region: "head", isolatedHead: true };
  const free = optimizeHumanMeasurements(form, scan, options).form.human,
    kept = optimizeHumanMeasurements(form, scan, { ...options, keepEyeOpenings: true }).form.human;
  // Without the option the eyes are measured like the rest of the face.
  assert.ok((free.eyeSpacing ?? 0) > 0.1);
  assert.ok((free.underEye ?? 0) > 0.1);
  for (const key of eyeSliders) assert.equal(kept[key] ?? 0, form.human[key] ?? 0);
  assert.ok((kept.cheeks ?? 0) > 0.2);
  assert.ok((kept.jaw ?? 0) > 0.15);
  scan.dispose();
});
