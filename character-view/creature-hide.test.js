import { flankMarkings, flankPaint } from "./creature-flank-markings.js";
import test from "node:test";
import assert from "node:assert/strict";
import { faceCoat, faceMarkings } from "./creature-face-coat.js";
import { Color, Mesh, MeshStandardMaterial, Object3D, SphereGeometry } from "three";
import {
  bakeCreatureHide,
  buildHideCharts,
  createHideEvaluator,
  isCreatureHidePart,
  packHideCharts,
  patternVisibility,
} from "./creature-hide.js";
import { buildCreature, creaturePresets, randomCreaturePlan } from "./creature-plan.js";
import { drawCreatureCoat } from "./creature-coat.js";
import { cageGeometry } from "./control-cage.js";
import { handGeometry } from "./hands.js";
import { skullCage } from "./creature-anatomy.js";

test("isCreatureHidePart selects organic hide parts and respects artist overrides", () => {
  const plan = randomCreaturePlan(12103);
  const form = buildCreature(plan);
  const skin = form.origin.plan.skin;
  const byId = (id) => form.parts.find((p) => p.id === id);

  assert.equal(isCreatureHidePart(byId("body"), skin), true);
  assert.equal(isCreatureHidePart(byId("head"), skin), true);
  assert.equal(isCreatureHidePart(byId("neck"), skin), true);

  // Eyes, teeth, horns, dress, gear are excluded.
  for (const p of form.parts) {
    if (/(?:eye|pupil|iris|tooth|nostril|mouth|claw|horn|beak)$/.test(p.id) || p.id.startsWith("dress ") || p.id.startsWith("gear ")) {
      assert.equal(isCreatureHidePart(p, skin), false, `expected ${p.id} excluded`);
    }
  }

  // Artist surface or paint override opts that part out cleanly.
  assert.equal(isCreatureHidePart({ ...byId("head"), surface: "metal" }, skin), false);
  assert.equal(isCreatureHidePart({ ...byId("head"), paint: { atlas: "a" } }, skin), false);
});

test("patternVisibility ranks flat, countershade, low-contrast and high-contrast patterns", () => {
  assert.equal(patternVisibility({ base: "#8042be", markings: null }), 0);
  assert.ok(patternVisibility({ base: "#a53d35", markings: { kind: "Countershade", color: "#d2ad9f" } }) < 0.2);
  const paleCream = patternVisibility({ base: "#d4c3a6", markings: { kind: "Bands", color: "#f0eee6" } });
  const strongRosettes = patternVisibility({ base: "#3d97c3", markings: { kind: "Rosettes", color: "#185960" } });
  assert.ok(paleCream < 0.55, `pale cream bands should read low contrast, got ${paleCream}`);
  assert.ok(strongRosettes > 0.8, `strong rosettes should read high contrast, got ${strongRosettes}`);
});

test("buildHideCharts and packHideCharts produce valid non-overlapping charts and preserve handRig indices", () => {
  const skull = new Mesh(cageGeometry(skullCage("long", "muzzle")), new MeshStandardMaterial());
  skull.scale.set(0.35, 0.35, 0.42);
  const handGeo = handGeometry({ fingers: 3, side: 1 });
  const origVertCount = handGeo.attributes.position.count;
  const hand = new Mesh(handGeo, new MeshStandardMaterial());
  hand.handRig = handGeo.handRig;
  const ball = new Mesh(new SphereGeometry(0.25, 16, 12), new MeshStandardMaterial());

  const charts = buildHideCharts([
    { mesh: skull, part: { id: "head", shape: "cage", motionRole: "head" } },
    { mesh: hand, part: { id: "left arm 1 hand", shape: "hand", motionRole: "hand" } },
    { mesh: ball, part: { id: "body", shape: "ellipsoid", motionRole: "torso" } },
  ]);
  assert.ok(charts.length >= 4);
  // Remapped handRig must stay completely in bounds and keep non-empty digit bindings without mutating cached handGeo.handRig.
  assert.notEqual(hand.handRig, handGeo.handRig);
  const vCount = hand.geometry.attributes.position.count;
  for (const digit of hand.handRig) {
    assert.ok(digit.vertices.length > 0 && digit.vertices.length === digit.parameters.length);
    for (const vi of digit.vertices) assert.ok(vi >= 0 && vi < vCount);
  }

  packHideCharts(charts, 1024);
  for (let i = 0; i < charts.length; i++) {
    const [x, y, w, h] = charts[i].rect;
    assert.ok(x >= 0 && y >= 0 && w >= 10 && h >= 10 && x + w <= 1024 && y + h <= 1024);
    for (let j = i + 1; j < charts.length; j++) {
      const [x2, y2, w2, h2] = charts[j].rect;
      const overlap = x < x2 + w2 && x + w > x2 && y < y2 + h2 && y + h > y2;
      assert.equal(overlap, false, "packed hide charts must never overlap");
    }
  }
  const headChart = charts.find((c) => c.part.id === "head");
  const handChart = charts.find((c) => c.part.id === "left arm 1 hand");
  assert.ok(headChart.weight / headChart.area > handChart.weight / handChart.area * 3);
});

test("createHideEvaluator gives flat hides continuous palette-true variation and respects per-part edits", () => {
  const flatPlan = {
    ...creaturePresets["Four-legged grazer"],
    skin: {
      base: "#8042be",
      accent: "#22e8b4",
      pale: "#e0cee8",
      eye: "#eb5547",
      surface: "plain",
      blend: true,
      belly: 0.7,
      socks: 0,
      markings: null,
    },
  };
  const form = buildCreature(flatPlan);
  // Simulate an artist recolouring the head in an expanded authored recipe.
  form.parts.find((p) => p.id === "head").color = "#c84030";
  const objects = new Map();
  for (const part of form.parts) {
    const o = new Object3D();
    o.position.fromArray(part.position);
    objects.set(part.id, o);
  }
  const ev = createHideEvaluator(form, objects, new Map());
  const topOut = new Float64Array(5);
  const botOut = new Float64Array(5);
  const bodyLayer = ev.partLayers.get("body");
  ev.evaluate(topOut, 0, 1.0, 0, 0, 1, 0, bodyLayer, null, 1);
  ev.evaluate(botOut, 0, 0.4, 0, 0, -1, 0, bodyLayer, null, 1);

  for (const v of [...topOut, ...botOut]) assert.ok(Number.isFinite(v));
  // Dorsal top is visibly richer/deeper than ventral underside, and roughness varies.
  assert.ok(botOut[0] + botOut[1] + botOut[2] > topOut[0] + topOut[1] + topOut[2] + 0.12);
  assert.ok(topOut[4] < botOut[4], "dorsal hide should have sleeker roughness than ventral belly");
  // Palette preserved: purple stays purple (blue & red stronger than green on dorsal body).
  assert.ok(topOut[2] > topOut[1] * 1.4 && topOut[0] > topOut[1] * 1.1);

  // Per-part artist edit on head is respected (red channel dominates on head).
  const headOut = new Float64Array(5);
  ev.evaluate(headOut, 0, 0.8, 0.5, 0.5, 0.2, 0.8, ev.partLayers.get("head"), null, 1);
  assert.ok(headOut[0] > headOut[2] * 1.8, "recoloured head keeps its authored red hue");
});

test("old expanded recipes without origin.plan and explicit skin.coat opt out cleanly", () => {
  const plainForm = { parts: [{ id: "body", shape: "ellipsoid", color: "#557766", surface: "plain" }] };
  assert.equal(bakeCreatureHide(plainForm, new Map(), new Map()).size, 0);

  const coated = randomCreaturePlan(9110);
  coated.skin = drawCreatureCoat(coated, 9110);
  const coatedForm = buildCreature(coated);
  assert.equal(bakeCreatureHide(coatedForm, new Map(), new Map()).size, 0);
});

test("facial markings mirror on the skull and follow each turned head in world space", () => {
  const plan = randomCreaturePlan(67901);
  const head = {id: "head 2", color: plan.skin.base};
  const mesh = new Object3D();
  mesh.position.set(.38, 1.2, -.45);
  mesh.rotation.y = -.68;
  mesh.scale.set(.23, .45, .37);
  delete plan.skin.faceMarking;
  assert.equal(faceCoat(head, mesh, plan), null);
  for (const marking of faceMarkings.slice(1)) {
    plan.skin.faceMarking = marking;
    const sample = faceCoat(head, mesh, plan);
    const base = new Color(head.color);
    let strongest = 0;
    for (const x of [0, .1, .3, .5]) for (const y of [-.15,0,.12,.22]) {
      const local = sample.local(base.clone(),x,y,.28);
      const other = sample.local(base.clone(),-x,y,.28);
      assert.deepEqual(local,other);
      const point = mesh.position.clone().set(x,y,.28).applyMatrix4(mesh.matrixWorld);
      const world = sample.world(base.clone(),point.x,point.y,point.z);
      assert.ok(Math.abs(local.r-world.r)+Math.abs(local.g-world.g)+Math.abs(local.b-world.b)<1e-10);
      strongest = Math.max(strongest,Math.abs(local.r-base.r)+Math.abs(local.g-base.g)+Math.abs(local.b-base.b));
    }
    assert.ok(strongest>.1,marking);
    assert.equal(buildCreature(plan).origin.plan.skin.faceMarking,marking);
  }
});

test("regional flank marks keep the neck and tail clear and follow the editable palette", () => {
  const base = new Color("#435354"), accent = new Color("#cf7633"), pale = new Color("#f3d796");
  assert.equal(flankPaint("None", accent, pale, base), null);
  for (const style of flankMarkings.slice(1)) {
    const paint = flankPaint(style, accent, pale, base);
    const control = { skin: { flankMarking: style } };
    assert.equal(buildCreature(control).origin.plan.skin.flankMarking, style);
    for (const end of [-.1, 1.1]) assert.deepEqual(paint(base.clone(), end, .13, 0, 1), base);
    let largest = 0;
    for (const t of [.24, .46, .72]) for (const d of [-.3, 0, .13, .3, .75]) {
      const sample = paint(base.clone(), t, d, 0, 1);
      const partial = paint(base.clone(), t, d, 0, 0);
      assert.deepEqual(partial, base);
      largest = Math.max(largest, Math.abs(sample.r - base.r) + Math.abs(sample.g - base.g) + Math.abs(sample.b - base.b));
    }
    assert.ok(largest > .2, style);
  }
});
