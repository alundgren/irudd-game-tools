import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { humanRegions } from "./human-mesh.js";
import { generatedHuman, humanForm } from "./human-form.js";
import { evaluateHuman, smoothHumanSurface, restLipProfile } from "./human-surface.js";
import { faceAnatomy, faceAnatomyFields, refineExpressions, refineFaceForm } from "./human-face-anatomy.js";

const head = (form, plain = false) =>
  humanRegions(form, (color) => new T.MeshStandardMaterial({ color }), plain)(form.parts.find((part) => part.humanBone === "head"));
const skinOf = (group) => group.children.find((mesh) => mesh.userData.faceSurface);

test("the fields touch only the nose, mouth and lid margins of the head", () => {
  const { move, shade, count } = faceAnatomyFields(),
    s = smoothHumanSurface(evaluateHuman({})),
    p = s.positions;
  assert.equal(count, p.length / 3);
  let moved = 0,
    most = 0;
  for (let v = 0; v < count; v++) {
    const size = Math.hypot(move[v * 3], move[v * 3 + 1], move[v * 3 + 2]);
    most = Math.max(most, size);
    if (size < 1e-4 && !shade[v]) continue;
    moved++;
    assert.ok(p[v * 3 + 1] > 1.5 && p[v * 3 + 1] < 1.64 && p[v * 3 + 2] > 0.118, "on the front of the face");
    assert.ok(shade[v] >= 0 && shade[v] <= 0.7);
  }
  assert.ok(moved > 800 && moved < 9000, "vertices " + moved);
  assert.ok(most > 1.5 && most < 3.2, "largest move in mm " + most);
});

test("the fields are smooth across the surface, so nothing tears", () => {
  const { move } = faceAnatomyFields(),
    s = smoothHumanSurface(evaluateHuman({})),
    p = s.positions;
  let steepest = 0;
  for (let t = 0; t < s.indices.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = s.indices[t + e],
        b = s.indices[t + ((e + 1) % 3)];
      const step = Math.hypot(move[a * 3] - move[b * 3], move[a * 3 + 1] - move[b * 3 + 1], move[a * 3 + 2] - move[b * 3 + 2]);
      const edge = 1000 * Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);
      if (step > 1e-6) steepest = Math.max(steepest, step / Math.max(edge, 0.3));
    }
  // No edge changes length by more than its own length.
  assert.ok(steepest > 0.05 && steepest < 1.1, "steepest change per mm of edge " + steepest);
});

test("the lips lose their roll: the upper border sits back and the seam comes forward", () => {
  for (const form of [humanForm({}, 1), generatedHuman(8736), generatedHuman(8739)]) {
    const cage = evaluateHuman(form.human, form.humanFit, form.humanDetail),
      before = smoothHumanSurface(cage),
      after = refineFaceForm(smoothHumanSurface(cage)),
      unit = (0.001 * (form.human.height ?? 1.72)) / 1.72,
      back = (v) => (before.positions[v * 3 + 2] - after.positions[v * 3 + 2]) / unit;
    // Vertices on the midline: the upper border, the front of the lower lip, and the nose tip.
    assert.ok(back(455) > 1.6 && back(455) < faceAnatomy.upperBack + faceAnatomy.philtrum, "upper border " + back(455));
    assert.ok(back(496) > 0.8 && back(496) < faceAnatomy.lowerBack + 0.01, "lower lip " + back(496));
    assert.equal(back(294), 0);
    assert.ok(restLipProfile(after).upper < restLipProfile(before).upper + 0.5);
    // Nothing outside the head moves.
    let far = 0;
    for (let i = 0; i < before.positions.length; i += 3)
      if (before.positions[i + 1] < 1.3 * (form.human.height ?? 1.72) / 1.72)
        far = Math.max(far, Math.abs(before.positions[i + 2] - after.positions[i + 2]));
    assert.equal(far, 0);
  }
});

test("nostrils and the line between the lips are shaded on the coloured head and absent in clay", () => {
  const form = generatedHuman(8737),
    skin = skinOf(head(form)),
    { shade } = faceAnatomyFields(),
    ids = skin.humanSkin.vertices,
    colour = skin.geometry.attributes.color;
  let dark = 0,
    plain = 0,
    darkN = 0,
    plainN = 0;
  for (let i = 0; i < ids.length; i++) {
    const light = colour.getX(i) + colour.getY(i) + colour.getZ(i);
    if (shade[ids[i]] > 0.4) (dark += light), darkN++;
    else if (!shade[ids[i]]) (plain += light), plainN++;
  }
  assert.ok(darkN > 20 && dark / darkN < 0.75 * (plain / plainN), "nostril vertices are darker");
  assert.equal(skinOf(head(form, true)).geometry.attributes.color, undefined);
  // Expressions are still the full targets on the refined head.
  assert.deepEqual(Object.keys(skin.morphTargetDictionary), ["Blink", "Smile", "BrowLift", "LookUp", "LookDown"]);
});

test("a smile brings the lower lip up toward the upper teeth and still parts the lips", () => {
  // At the standard animated opening all three faces show the upper teeth.
  // A deliberately reserved smile can part the lips by less than 2 mm.
  for (const form of [humanForm({}, 1), generatedHuman(8734), generatedHuman(8738)]) {
    form.human.smileOpenness = 0;
    const skin = skinOf(head(form)),
      g = skin.geometry,
      smile = g.morphAttributes.position.find((attr) => attr.name === "Smile"),
      { upperEdge, lowerEdge, lower } = faceAnatomyFields(),
      at = new Map();
    skin.humanSkin.vertices.forEach((v, i) => at.has(v) || at.set(v, i));
    const mean = (ids, posed) =>
      ids.reduce((sum, v) => sum + g.attributes.position.getY(at.get(v)) + (posed ? smile.getY(at.get(v)) : 0), 0) / ids.length;
    assert.ok(upperEdge.length >= 3 && lowerEdge.length >= 3);
    const rest = mean(upperEdge, false) - mean(lowerEdge, false),
      smiling = mean(upperEdge, true) - mean(lowerEdge, true),
      unit = (0.001 * (form.human.height ?? 1.72)) / 1.72;
    assert.ok(smiling - rest > 2 * unit && smiling - rest < 9 * unit, "the lips part by " + (smiling - rest) / unit);
    // Applying it again closes only a share of what is left, so the lips cannot cross.
    assert.ok(refineExpressions(g, skin.humanSkin.vertices, unit * 1000) <= faceAnatomy.smileLiftMost * unit + 1e-9);
    assert.ok(mean(upperEdge, true) > mean(lowerEdge, true));
    assert.ok(lower.some((w) => w > 0.9));
  }
});

test("a reserved smile leaves less space between the lips than an open smile on the same head", () => {
  const form = generatedHuman(8734);
  const {upperEdge, lowerEdge} = faceAnatomyFields();
  function parted(opening) {
    const skin = skinOf(head({...form, human: {...form.human, smileOpenness: opening}}));
    const smile = skin.geometry.morphAttributes.position.find(attr => attr.name === "Smile");
    const ids = new Map();
    skin.humanSkin.vertices.forEach((v, i) => ids.set(v, i));
    const rise = rim => rim.reduce((sum, v) => sum + smile.getY(ids.get(v)), 0)/rim.length;
    return rise(upperEdge) - rise(lowerEdge);
  }
  const reserved = parted(-.85), normal = parted(0), open = parted(.9);
  assert.ok(reserved > 0 && reserved < normal*.6);
  assert.ok(open > normal*1.12);
});

test("eyelids carry 3D supratarsal crease depth, thicker margins, lid anchors and smooth Blink unwinding", () => {
  const { move, crease, lidAnchors } = faceAnatomyFields();
  const cage = evaluateHuman({}), before = smoothHumanSurface(cage), after = refineFaceForm(smoothHumanSurface(cage));
  const unit = 0.001;
  // Upper crease vertices tuck inward (negative dz) and are unwound during Blink; ring 0 opening stays unmoved.
  let creaseVerts = 0, maxTuck = 0;
  for (let v = 0; v < crease.length; v++) {
    if (crease[v] > 0.5) {
      creaseVerts++;
      maxTuck = Math.max(maxTuck, -move[v * 3 + 2]);
    }
  }
  assert.ok(creaseVerts > 40 && maxTuck > 0.9 && maxTuck < 2.2, `crease verts=${creaseVerts} tuck=${maxTuck}`);
  // Cage opening loop (6756..6783, 13352..13379) stays anchored and unmoved in Y so the editable opening is preserved.
  for (const v of [6756, 6770, 13352, 13370]) {
    assert.equal(lidAnchors[v], 1);
    assert.equal(Math.abs(after.positions[v * 3 + 1] - before.positions[v * 3 + 1]), 0);
  }
  // Blink unwinds the recessed crease forward rather than pinching it deeper.
  const form = generatedHuman(8734), skin = skinOf(head(form));
  const blink = skin.geometry.morphAttributes.position.find((a) => a.name === "Blink");
  let unwound = 0;
  for (let i = 0; i < skin.humanSkin.vertices.length; i++) {
    const v = skin.humanSkin.vertices[i];
    if (crease[v] > 0.7 && blink.getZ(i) > 0.5 * unit) unwound++;
  }
  assert.ok(unwound > 20, "Blink unwinds the crease forward: " + unwound);
});
