import assert from "node:assert/strict";
import test from "node:test";
import { evaluateHuman, smoothHumanSurface, validHumanDetail } from "./human-surface.js";
import { changeHuman, generatedHuman, humanForm } from "./human-form.js";
import { validateForm } from "./recipe.js";
import { foldedTriangles } from "./family-transfer.js";
import { familyMember, familyPanel, familyText, headKeeper, headKeptText, registerFamilyNeutral, transferFamilyHead } from "./human-family-editor.js";
import { fitHumanReference, optimizeHumanMeasurements } from "./human-fit.js";
import { referenceGeometry } from "./human-reference-align.js";

/* A family made from the editable adult itself, so nothing here is fitted to
   outside material: its drawn surface has another topology than the cage that
   is edited. The neutral is a plain adult and the member the same adult with
   another head, so what the transfer should find is known. */
const drawn = (human) => {
  const s = smoothHumanSurface(evaluateHuman(human));
  return { positions: s.positions, indices: s.indices };
};
const neutral = drawn({ height: 1.72 });
const person = { height: 1.72, jaw: 0.6, noseLength: -0.5, cheeks: -0.5, noseHump: 0.6, earFlare: 0.5, jowlFullness: -0.5, eyeTilt: 0.5 };
const member = drawn(person);
const cage = (form) => evaluateHuman(form.human, form.humanFit, form.humanDetail);
const lips = (surface) => {
  // Paired vertices on the upper and lower inner lip rims of the cage.
  const pairs = [[425, 426], [416, 438], [469, 475], [470, 481], [472, 487], [474, 523], [7228, 7242], [7226, 7236], [7225, 7230], [7176, 7198], [7185, 7186]];
  return Math.max(...pairs.map(([a, b]) => Math.hypot(...[0, 1, 2].map((d) => surface.positions[a * 3 + d] - surface.positions[b * 3 + d]))));
};
// An adult saved before the identity controls existed, as seed 44 drew it then. A transfer onto a saved
// head solves with the measurements it always had, so this recipe pins that contract.
const savedHead = {
  "height": 1.765, "frame": 0, "age": 0.55, "weight": 0.2862, "muscle": -0.7251, "stance": 0.98, "armForward": -0.12, "elbowBend": -0.49, "legSpread":
  0, "handTwist": 0.05, "wristFlex": 0.44, "fingerCurl": 0.3, "faceA": -0.136, "faceB": -0.394, "shoulders": 0.0255, "waist": -0.1229, "hips": 0.1629,
  "belly": 0.4084, "chest": -0.55, "legs": -0.732, "neck": -0.044, "jaw": 0.421, "nose": 0.01, "noseBridge": 0.366, "cheeks": 0.265, "lips": -0.295,
  "chin": 0.5408, "jawProjection": 0.674, "chinHeight": 0.218, "forehead": 0.135, "temples": 0.32, "noseLength": -0.216, "noseTipWidth": -0.3452,
  "nostrilWidth": 0.239, "craniumDepth": 0.1094, "faceHeight": -0.2651, "noseHump": 0.245, "lipFullness": -0.205, "upperLipHeight": -0.565, "cupidsBow":
  0.248, "underEye": -0.188, "headWidth": -0.129, "eyeSize": 0.402, "brow": 0.683, "ears": -0.309, "seat": 0.323, "arms": -0.2193, "calves": -0.5226,
  "upperArmLength": 0.156, "forearmLength": 0.2155, "shinLength": 0.372, "torsoLength": 0.302, "neckLength": -0.01, "bust": 0.435, "mouthCorners":
  0.455, "mouthProjection": -0.2262, "mouthLevel": -0.0095, "noseTipAngle": -0.0522, "lipParting": -0.0153, "lipBalance": 0.3273, "smileLeft": 0.273,
  "smileRight": 0.193, "eyeSpacing": 0.146, "eyeTilt": 0.354, "eyeFold": -0.721, "earTip": -0.147, "earLevel": -0.1256, "earSetback": 0.0859,
  "earLength": 0.0643, "earFlare": 0.056, "cheekFullness": -0.1487, "hands": 0.666, "feet": -0.591, "malarHeight": -0.6286, "jowlFullness": 0.1643,
  "submentalFullness": 0.3001, "shoulderLine": 0, "upperBack": 0,
};
let registered;
const registration = () => (registered ??= registerFamilyNeutral(neutral));

test("the head of a family member reaches another character and leaves the rest of it alone", { timeout: 600000 }, () => {
  const family = registration();
  assert.ok(family.report.coverage.head.registered > 0.6 * family.report.coverage.head.vertices);
  assert.equal(family.factor, 1);

  // A dressed character with another body, another head and a few surface corrections of its own.
  let form = humanForm(savedHead, 44);
  form.outfit = "Work clothes";
  form = changeHuman(form, { weight: 0.3, shoulders: 0.4 });
  form = { ...form, humanFit: { version: 1, strength: 1, controls: [[300, 20, 0, 40], [301, -10, 30, 15]] } };
  const before = cage(form), made = transferFamilyHead(family, member, form), after = cage(made.form);

  // Head measurements moved towards the member's and the fine layer holds the rest.
  for (const key of ["jaw", "noseLength", "cheeks", "noseHump"])
    assert.ok(Math.abs((made.form.human[key] ?? 0) - person[key]) < Math.abs((form.human[key] ?? 0) - person[key]), key);
  assert.ok(validHumanDetail(made.form.humanDetail));
  assert.equal(made.form.humanFit, form.humanFit);
  const m = made.metrics;
  assert.ok(m.afterDetail.meanMm < 0.6 && m.afterDetail.meanMm < 0.3 * m.afterMeasurements.meanMm, JSON.stringify([m.afterMeasurements, m.afterDetail]));
  assert.equal(m.folds + m.drawnFolds, 0);
  assert.equal(m.outsideRegionMaxMm, 0);
  for (const eye of m.eyes) assert.ok(eye.ballStretchMm < 1);
  // Lips that were closed stay closed.
  assert.ok(lips(after) < lips(before) + 0.0008, "lip rims " + lips(before) * 1000 + " → " + lips(after) * 1000 + " mm");
  assert.match(familyText(m), /no skin turned over/);

  // Outside the head. Head measurements are the ordinary sliders, and three of them are not confined
  // to it: under-chin fullness and head width carry skin at the base of the neck, and cranium depth
  // keeps the stature, which rescales the figure a hair. That is small, measured and reported.
  const head = (v) => /^(head|neck)/.test(before.names[before.boneIndices[v * 4]]);
  const moved = (a, b, v) => Math.hypot(...[0, 1, 2].map((k) => a.positions[v * 3 + k] - b.positions[v * 3 + k]));
  let outside = 0, low = 0;
  for (let v = 0; v < before.bodyVertices; v++) {
    if (head(v)) continue;
    outside = Math.max(outside, moved(after, before, v));
    if (before.positions[v * 3 + 1] < 0.75 * before.height) low = Math.max(low, moved(after, before, v));
  }
  assert.ok(outside > 0 && outside < 0.001, "skin outside the head moved " + outside * 1000 + " mm");
  assert.ok(low < 0.0003, "skin below the shoulders moved " + low * 1000 + " mm");
  assert.ok(Math.abs(m.outsideFromStart.maxMm - outside * 1000) < 1e-3 && Math.abs(m.outsideFromStart.belowShouldersMaxMm - low * 1000) < 1e-3);
  assert.match(familyText(m), /skin outside the head moved at most 0\.\d mm/);
  // Joints of the bones that carry skin outside the head stay with it.
  const bodyBones = new Set();
  for (let v = 0; v < before.bodyVertices; v++) if (!head(v)) bodyBones.add(before.boneIndices[v * 4]);
  before.names.forEach((name, j) => {
    if (/^(head|neck)/.test(name) || !bodyBones.has(j)) return;
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(after.joints[j * 3 + k] - before.joints[j * 3 + k]) < 0.0003, name);
  });
  // The fine layer on its own moves nothing outside the head at all: not skin, not a helper, not a joint.
  const layer = transferFamilyHead(family, member, form, { measurements: false }), layered = cage(layer.form);
  assert.deepEqual(layer.form.human, form.human);
  assert.ok(validHumanDetail(layer.form.humanDetail));
  for (let v = 0; v < before.positions.length / 3; v++) if (!head(v)) assert.equal(moved(layered, before, v), 0, "vertex " + v);
  assert.deepEqual(layered.joints, before.joints);
  assert.equal(layer.metrics.outsideFromStart.maxMm, 0);
  assert.doesNotMatch(familyText(layer.metrics), /outside the head/);
  assert.equal(made.form.outfit, form.outfit);
  assert.deepEqual(made.form.appearance, form.appearance);
  assert.deepEqual(made.form.parts.map((p) => p.id), form.parts.map((p) => p.id));
  assert.deepEqual(Object.keys(made.form.human).filter((key) => /waist|chest|hips|weight|shoulders|legs|arms|height/.test(key)).map((key) => made.form.human[key]),
    Object.keys(made.form.human).filter((key) => /waist|chest|hips|weight|shoulders|legs|arms|height/.test(key)).map((key) => form.human[key]));

  // Reference privacy: the saved character holds its own numbers and nothing of either mesh.
  const saved = JSON.stringify(validateForm(made.form));
  assert.deepEqual(Object.keys(made.form).filter((key) => !(key in form)), ["humanDetail"]);
  assert.ok(saved.length < JSON.stringify(form).length + 160000);
  assert.ok(!/glb|neutral|member|registration|familyVertices/i.test(saved.replace(/"neutral"/g, "")));
  assert.equal(made.form.referenceRigs, undefined);

  // The rebase rule on a real transfer: sizeable head changes afterwards keep the layer and turn nothing over.
  const edited = changeHuman(made.form, { jaw: -0.6, craniumDepth: 0.5, noseLength: 0.6, lipFullness: 0.5, earFlare: -0.4, height: 1.86 });
  assert.equal(edited.humanDetail, made.form.humanDetail);
  const under = evaluateHuman(edited.human, edited.humanFit), over = cage(edited);
  const smoothUnder = smoothHumanSurface(under), smoothOver = smoothHumanSurface(over);
  assert.equal(foldedTriangles(under.positions, over.positions, over.indices, over.bodyTriangles).folded.length, 0);
  assert.equal(foldedTriangles(smoothUnder.positions, smoothOver.positions, smoothUnder.indices, smoothUnder.indices.length / 3).folded.length, 0);

  // A second transfer replaces the layer; without the layer option none is kept.
  const again = transferFamilyHead(family, member, made.form);
  assert.ok(again.metrics.afterDetail.meanMm < 0.6);
  const coarse = transferFamilyHead(family, member, made.form, { detail: false });
  assert.equal(coarse.form.humanDetail, undefined);
  assert.throws(() => transferFamilyHead(family, member, form, { measurements: false, detail: false }), /Choose/);
});

test("a body fitted to a reference after the transfer keeps the transferred head", { timeout: 600000 }, () => {
  // The head first, onto a plain adult; then the whole body is fitted to a heavier, broader
  // reference, as the dialog does it: measurements, then control anchors.
  const start = generatedHuman(46, "neutral"), made = transferFamilyHead(registration(), member, start).form;
  const weight = made.human.weight ?? 0, shoulders = made.human.shoulders ?? 0;
  const target = drawn({ ...made.human, weight: weight + (weight > 0.4 ? -0.5 : 0.5), shoulders: shoulders + (shoulders > 0.4 ? -0.4 : 0.4) });
  const geometry = referenceGeometry(target.positions, target.indices), before = cage(made);
  const head = before.names.indexOf("head"), joint = (s, d) => s.joints[head * 3 + d];
  // How far the skull's skin stands from where it stood, seen from the head joint.
  const drift = (surface) => {
    let sum = 0, most = 0, count = 0;
    for (let v = 0; v < before.bodyVertices; v++) {
      let own = 0;
      for (let j = v * 4; j < v * 4 + 4; j++) if (before.boneIndices[j] === head) own += before.weights[j];
      if (own < 0.9) continue;
      const d = Math.hypot(...[0, 1, 2].map((k) => surface.positions[v * 3 + k] - joint(surface, k) - (before.positions[v * 3 + k] - joint(before, k))));
      sum += d; most = Math.max(most, d); count++;
    }
    return { mean: sum / count, most };
  };
  const fit = (hold) => {
    const coarse = optimizeHumanMeasurements(made, geometry);
    const fine = fitHumanReference(coarse.form, geometry, { hold });
    return { form: { ...coarse.form, humanFit: fine.fit }, measure: coarse.metrics, surface: fine.metrics };
  };

  // Without keeping, the layer is still there but the head under it has changed with the body.
  const loose = fit(null);
  assert.equal(loose.form.humanDetail, made.humanDetail);
  assert.ok(drift(cage(loose.form)).mean > 0.0008, "head drifted " + drift(cage(loose.form)).mean * 1000 + " mm");

  const keeper = headKeeper(made), fitted = fit(keeper.hold), kept = keeper.rebuild(fitted.form);
  // The body went to the reference.
  assert.ok(Math.abs(kept.form.human.weight - (weight + (weight > 0.4 ? -0.5 : 0.5))) < 0.25, "weight " + kept.form.human.weight);
  assert.ok(fitted.surface.after.meanMm < 0.5 * fitted.measure.before.meanMm, JSON.stringify([fitted.measure.before, fitted.surface.after]));
  assert.ok(fitted.surface.heldAnchors > 50);
  // The head stands where it stood, under a layer worked out again for the new body.
  const now = drift(cage(kept.form)), m = kept.metrics;
  assert.ok(now.mean < 0.0003 && now.most < 0.003, JSON.stringify(now));
  assert.ok(m.kept.meanMm < 0.3 && m.kept.meanMm < 0.3 * m.carried.meanMm, JSON.stringify([m.carried, m.kept]));
  assert.equal(m.folds + m.drawnFolds, 0);
  assert.ok(validHumanDetail(kept.form.humanDetail));
  assert.notDeepEqual(kept.form.humanDetail, made.humanDetail);
  assert.ok(lips(cage(kept.form)) < lips(before) + 0.0008);
  assert.ok(validateForm(kept.form).humanDetail);
  assert.match(headKeptText(m), /^head kept under its fine layer: \d+\.\d → 0\.\d mm from where it stood/);
  // A character without a layer has no head to keep.
  assert.equal(headKeeper(start).rebuild(start).form.humanDetail, undefined);
});

test("only a mesh with the neutral's own vertex order is taken as a member", { timeout: 600000 }, () => {
  const family = registration();
  assert.throws(() => familyMember(family, { positions: member.positions.subarray(0, 3000), indices: member.indices.subarray(0, 300) }), /same vertex order/);
  const shuffled = { positions: member.positions, indices: member.indices.slice() };
  [shuffled.indices[0], shuffled.indices[1]] = [shuffled.indices[1], shuffled.indices[0]];
  assert.throws(() => familyMember(family, shuffled), /same vertex order/);
  assert.throws(() => registerFamilyNeutral({ positions: new Float32Array(0), indices: new Uint32Array(0) }), /no surface/);
  // A family in centimetres is read at the same size.
  const cm = { positions: Float32Array.from(member.positions, (x) => x * 100), indices: member.indices };
  const scaled = familyMember({ ...family, factor: 0.01 }, cm);
  assert.ok(Math.abs(scaled.positions[301] - member.positions[301]) < 1e-5);
});

test("the panel in the reference dialog transfers, reports and removes, and keeps the meshes to the session", { timeout: 600000 }, async () => {
  globalThis.requestAnimationFrame ??= (run) => setTimeout(run, 0);
  // Stand-ins for the dialog's controls.
  const controls = new Map();
  const $ = (id) => {
    if (!controls.has(id)) controls.set(id, { id, disabled: false, checked: true, textContent: "", value: "", files: [], click() { this.clicked = true; } });
    return controls.get(id);
  };
  const start = generatedHuman(45, "neutral");
  const state = { form: start, reference: null, busy: false, notes: [], steps: [] };
  let panel;
  const lock = (value) => {
    state.busy = value;
    panel?.sync();
  };
  panel = familyPanel({
    $,
    read: async (file) => file.mesh,
    raw: () => state.reference,
    settings: () => ({ units: "auto", up: "auto", turn: "auto", nudge: [0, 0, 0] }),
    form: () => state.form,
    busy: () => state.busy,
    lock,
    note: (text) => state.notes.push(text),
    accept(next, entry) {
      state.steps.push({ form: state.form, entry });
      state.form = next;
    },
  });
  panel.sync();
  assert.ok($("hfit-family-run").disabled);
  assert.ok($("hfit-family-clear").disabled);
  assert.match($("hfit-family-reading").textContent, /not uploaded or saved/);

  // The button opens the file chooser; a chosen neutral is read once.
  $("hfit-family-browse").onclick();
  assert.ok($("hfit-family-file").clicked);
  $("hfit-family-file").files = [{ name: "family-neutral.glb", mesh: neutral }];
  await $("hfit-family-file").onchange();
  assert.equal($("hfit-family-file").value, "");
  assert.ok($("hfit-family-run").disabled, "no member chosen yet");
  assert.match($("hfit-family-reading").textContent, /family-neutral\.glb/);

  // A reference that is not of this family cannot be transferred.
  state.reference = { positions: member.positions.subarray(0, 3000), indices: member.indices.subarray(0, 300) };
  panel.sync();
  assert.ok($("hfit-family-run").disabled);
  assert.match($("hfit-family-reading").textContent, /not a member of this family/);

  // The member: measurements and the fine layer are both on by default.
  state.reference = member;
  panel.sync();
  assert.ok(!$("hfit-family-run").disabled);
  assert.ok($("hfit-family-measure").checked && $("hfit-family-detail").checked);
  await $("hfit-family-run").onclick();
  assert.equal(state.steps.length, 1);
  assert.ok(validHumanDetail(state.form.humanDetail));
  assert.ok(state.steps[0].entry.family.afterDetail.meanMm < 0.6, "remaining distance " + state.steps[0].entry.family.afterDetail.meanMm + " mm");
  assert.notDeepEqual(state.form.human, start.human);
  assert.match(state.notes.at(-1), /Head from the family .* Apply to keep it\./);
  assert.match($("hfit-family-reading").textContent, /registered, head \d+ of \d+ vertices/);
  assert.equal(state.busy, false);
  assert.ok(!$("hfit-family-clear").disabled);
  // Undo is the dialog's own step list: the earlier form is untouched.
  assert.equal(state.steps[0].form, start);
  assert.equal(start.humanDetail, undefined);
  // Nothing of the neutral or the member is on the character.
  assert.ok(!JSON.stringify(validateForm(state.form)).includes("family-neutral"));

  // Measurements alone leave no layer; with neither there is nothing to run.
  const layered = state.form;
  state.form = start;
  $("hfit-family-detail").checked = false;
  $("hfit-family-detail").onchange();
  await $("hfit-family-run").onclick();
  assert.equal(state.form.humanDetail, undefined);
  assert.notDeepEqual(state.form.human, start.human);
  $("hfit-family-measure").checked = false;
  $("hfit-family-measure").onchange();
  assert.ok($("hfit-family-run").disabled);

  // Removing the layer keeps measurements and corrections.
  state.form = layered;
  panel.sync();
  $("hfit-family-clear").onclick();
  assert.equal(state.form.humanDetail, undefined);
  assert.deepEqual(state.form.human, layered.human);
  assert.equal(state.steps.at(-1).entry.family, null);
  assert.ok($("hfit-family-clear").disabled || (panel.sync(), $("hfit-family-clear").disabled));

  // A failure is reported and leaves the character as it is.
  $("hfit-family-measure").checked = true;
  state.reference = { positions: member.positions, indices: member.indices.slice().reverse() };
  panel.sync();
  const count = state.steps.length;
  await $("hfit-family-run").onclick();
  assert.equal(state.steps.length, count);
  assert.match(state.notes.at(-1), /No head was transferred/);
  assert.equal(state.busy, false);
});
