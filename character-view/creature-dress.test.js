import { creaturePlateChart } from "./creature-livery.js";
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCreature,
  creaturePresets,
  drawCreatureDress,
  freeCreaturePlan,
  randomCreaturePlan,
  readCreaturePlan,
  rebuildCreature,
  steerCreaturePlan,
} from "./creature-plan.js";
import { dressKinds, dressRegionCount } from "./creature-dress.js";
import { creatureFamilies, creatureKins, familyOf } from "./creature-families.js";
import { liveryChart } from "./creature-livery.js";
import { cageGeometry } from "./control-cage.js";
import { validateForm } from "./recipe.js";
import { applyOperations } from "./variations.js";

const worn = (p) => p.id.startsWith("dress ");

test("a deck of consecutive draws deals every family and repeats exactly", () => {
  const plans = Array.from({ length: 30 }, (_, n) => randomCreaturePlan(9000 + n));
  const dealt = {};
  for (const p of plans) dealt[p.family] = (dealt[p.family] ?? 0) + 1;
  assert.deepEqual(Object.keys(dealt).sort(), [...creatureFamilies].sort());
  assert.equal(dealt.envoy, 4);
  assert.equal(dealt.wild, 1);
  assert.equal(new Set(plans.map((p) => p.skin.base)).size, 30);
  for (const [n, p] of plans.entries()) {
    assert.deepEqual(randomCreaturePlan(9000 + n), p);
    assert.deepEqual(readCreaturePlan(p), p);
    const form = validateForm(buildCreature(p));
    assert.deepEqual(form.origin.plan, p);
    assert.ok(form.parts.length <= 128);
  }
});

test("a drawn head is never small against its body and rows of legs keep daylight", () => {
  for (let seed = 9100; seed < 9220; seed++) {
    const p = randomCreaturePlan(seed);
    assert.ok(p.head.size >= Math.min(1.7, (0.2 * p.spine.length) / p.spine.girth) - 1e-9, "head of " + seed);
    for (const leg of p.limbs)
      if (leg.kind === "leg" && leg.pairs > 2 && leg.fan <= 100 && p.spine.rear <= 60) {
        const across = 2 * p.spine.girth * (leg.style === "pillar" ? 0.62 : leg.style === "insect" ? 0.34 : 0.46);
        const gap = (Math.abs(leg.to - leg.from) * p.spine.length) / (leg.pairs - 1);
        assert.ok(gap >= 2.2 * across * leg.girth - 1e-9, "legs of " + seed);
      }
  }
});

test("the free draw and saved plans are untouched by families, poses and dress", () => {
  const old = freeCreaturePlan(8716);
  assert.equal(old.family, undefined);
  assert.equal(old.dress, undefined);
  for (const [name, raw] of Object.entries(creaturePresets)) {
    const plan = readCreaturePlan(raw);
    if (raw.dress) continue;
    assert.equal(plan.dress, undefined, name);
    assert.equal("turn" in plan.head, false, name);
    assert.equal("sway" in plan.tail, false, name);
    assert.ok(plan.limbs.every((l) => !("raise" in l)), name);
  }
});

test("every ensemble is fitted as ordinary regions and leaves the animal alone", () => {
  for (const name of ["Upright four-armed trader", "Four-legged grazer", "Two-legged runner"]) {
    const bare = buildCreature({ ...creaturePresets[name], dress: null });
    for (const kind of dressKinds.slice(1)) {
      const plan = steerCreaturePlan(creaturePresets[name], { dress: { kind, color: "#27408b", trim: "#e8ecf2" } });
      const form = validateForm(buildCreature(plan));
      const pieces = form.parts.filter(worn);
      assert.ok(pieces.length >= 3, name + " " + kind);
      assert.ok(pieces.length <= dressRegionCount(plan.dress));
      assert.deepEqual(form.parts.filter((p) => !worn(p)), bare.parts);
      for (const p of pieces) {
        assert.equal(p.shape, "cage");
        assert.equal(p.motionRole, "rigid");
        assert.ok(form.parts.some((parent) => parent.id === p.parent));
        assert.ok(p.cage.vertices.length <= 192 && p.cage.faces.length <= 256);
      }
      assert.deepEqual(buildCreature(form.origin.plan), form);
      const undressed = applyOperations(form, [{ op: "steerCreature", set: { dress: null } }]);
      assert.deepEqual(undressed.parts.map((p) => p.id), bare.parts.map((p) => p.id));
    }
  }
});

test("worn pieces keep an artist's colour through a change of plan and through layers", () => {
  const plan = readCreaturePlan(creaturePresets["Court envoy"]);
  const form = buildCreature(plan);
  form.parts.find((p) => p.id === "dress surcoat").color = "#123456";
  const taller = validateForm(rebuildCreature(form, steerCreaturePlan(plan, { spine: { length: 0.8 } })));
  assert.equal(taller.parts.find((p) => p.id === "dress surcoat").color, "#123456");
  const fewer = buildCreature(steerCreaturePlan(plan, { dress: { layers: 1 } }));
  assert.ok(fewer.parts.filter(worn).length < form.parts.filter(worn).length);
  assert.ok(!fewer.parts.some((p) => p.id === "dress circlet" || p.id === "dress plume"));
  const drawn = drawCreatureDress(creaturePresets["Four-legged grazer"], 4);
  assert.ok(dressKinds.includes(drawn.kind) && drawn.kind !== "none");
  assert.equal(drawCreatureDress(creaturePresets["Finned swimmer"], 4), null);
});

test("resting gestures move only what they name", () => {
  const base = readCreaturePlan(creaturePresets["Upright four-armed trader"]);
  const still = buildCreature(base);
  const part = (f, id) => f.parts.find((p) => p.id === id);
  const looking = buildCreature(steerCreaturePlan(base, { head: { turn: 30 } }));
  assert.notDeepEqual(part(looking, "head"), part(still, "head"));
  for (const id of ["body", "left leg 1 thigh", "left arm 1 upper", "tail"])
    assert.deepEqual(part(looking, id), part(still, id));
  const waving = buildCreature(steerCreaturePlan(base, { setLimbs: [{ index: 1, raise: 50 }] }));
  assert.notDeepEqual(part(waving, "left arm 1 upper").knots, part(waving, "right arm 1 upper").knots.map(([x, ...r]) => [-x, ...r]));
  assert.deepEqual(part(waving, "left leg 1 thigh"), part(still, "left leg 1 thigh"));
  const swayed = buildCreature(steerCreaturePlan(base, { tail: { sway: 40 } }));
  assert.notDeepEqual(part(swayed, "tail"), part(still, "tail"));
  assert.deepEqual(part(swayed, "head"), part(still, "head"));
});

test("each family walks through all of its kins before one repeats", () => {
  const drawn = {};
  for (let seed = 0; seed < 3600; seed++) {
    const { family, kin } = familyOf(seed);
    assert.ok(creatureKins[family].includes(kin));
    assert.equal(randomCreaturePlan(seed).family, family);
    (drawn[family] ??= []).push(kin);
  }
  for (const [family, kins] of Object.entries(creatureKins)) {
    const run = drawn[family];
    for (let i = 0; i + kins.length <= run.length; i += kins.length)
      assert.deepEqual([...run.slice(i, i + kins.length)].sort(), [...kins].sort(), family + " deck " + i);
  }
  for (let deck = 0; deck < 120; deck++) {
    const seen = new Set();
    for (let n = 0; n < 30; n++) {
      const { family, kin } = familyOf(deck * 30 + n);
      assert.ok(!seen.has(family + kin), "deck " + deck);
      seen.add(family + kin);
    }
  }
});

test("grown crests and facial ornament are ordinary regions on the head", () => {
  const base = { ...creaturePresets["Four-legged grazer"], anatomyRevision: 2 };
  const plain = buildCreature(steerCreaturePlan(base, { head: { crest: "none" }, details: [] }));
  const count = { antlers: 6, ram: 2, lyre: 2, spire: 1, nubs: 4, fan: 4, plume: 4 };
  for (const [crest, regions] of Object.entries(count)) {
    const plan = steerCreaturePlan(base, { head: { crest }, details: [] });
    assert.equal(plan.head.crest, crest);
    const form = validateForm(buildCreature(plan));
    const added = form.parts.filter((p) => !plain.parts.some((q) => q.id === p.id));
    assert.equal(added.length, regions, crest);
    for (const p of added) {
      assert.equal(p.motionRole, "rigid");
      assert.ok(p.parent === "head" || added.some((q) => q.id === p.parent), p.id);
    }
    assert.deepEqual(form.parts.filter((p) => plain.parts.some((q) => q.id === p.id)), plain.parts);
    assert.deepEqual(buildCreature(form.origin.plan), form);
  }
  const faced = validateForm(buildCreature(steerCreaturePlan(base, { head: { crest: "none" }, details: ["nose horn", "brow horns", "beard", "cheek frills"] })));
  for (const id of ["nose horn", "left brow horn", "right brow horn", "beard", "left cheek frill", "right cheek frill"])
    assert.ok(faced.parts.some((p) => p.id === id), id);
  assert.deepEqual(readCreaturePlan(creaturePresets["Four-legged grazer"]).details.filter((d) => /horn|beard|cheek/.test(d)), []);
});

test("armour is shaped to the animal instead of stacked in hoops", () => {
  const plan = steerCreaturePlan(creaturePresets["Upright four-armed trader"], { dress: { kind: "warden", color: "#27408b", trim: "#e8ecf2", layers: 3, cut: 2 } });
  const form = validateForm(buildCreature(plan));
  const piece = (id) => form.parts.find((p) => p.id === "dress " + id);
  const cuirass = piece("cuirass");
  const ys = cuirass.cage.vertices.map((v) => v[1]), zs = cuirass.cage.vertices.map((v) => v[2]);
  const low = Math.min(...ys);
  assert.ok(zs[ys.indexOf(low)] > 0);
  const greave = piece("left leg 1 greave");
  assert.equal(greave.parent, "left leg 1 shin");
  const span = (axis) => Math.max(...greave.cage.vertices.map((v) => v[axis])) - Math.min(...greave.cage.vertices.map((v) => v[axis]));
  assert.ok(span(2) < 0.8 * span(0));
  const ringed = buildCreature(steerCreaturePlan(randomCreaturePlan(47214), { dress: { kind: "sage", color: "#27408b", trim: "#e8ecf2", layers: 2, cut: 2 } }));
  if (ringed.origin.plan.limbs.some((l) => l.kind === "leg" && l.fan > 100)) assert.ok(ringed.parts.some((p) => p.id === "dress capelet"));
});

test("a dressed animal saved before the armour was reshaped keeps its earlier cut", () => {
  const old = steerCreaturePlan(creaturePresets["Upright four-armed trader"], { dress: { kind: "warden", color: "#27408b", trim: "#e8ecf2", layers: 3 } });
  assert.equal(old.dress.cut, undefined);
  const form = buildCreature(old);
  const greave = form.parts.find((p) => p.id === "dress left leg 1 greave");
  const span = (axis) => Math.max(...greave.cage.vertices.map((v) => v[axis])) - Math.min(...greave.cage.vertices.map((v) => v[axis]));
  assert.ok(span(2) > 0.8 * span(0));
  assert.equal(drawCreatureDress(creaturePresets["Four-legged grazer"], 4).cut, 3);
});

test("an inclined biped wears a breastplate in the new cut and keeps its saved barding in cut 2", () => {
  const plan = randomCreaturePlan(14111);
  const pieces = cut => buildCreature({...plan, dress: {...plan.dress, cut}}).parts.map(p => p.id);
  assert.ok(pieces(2).includes("dress lamellar barding"));
  assert.ok(pieces(3).includes("dress cuirass"));
  assert.ok(pieces(3).includes("dress tassets"));
  const quadruped = buildCreature(steerCreaturePlan(creaturePresets["Harbour warden"], {dress: {cut:3}}));
  assert.ok(quadruped.parts.some(p=>p.id === "dress lamellar barding"));
});

test("an embroidered design follows the subdivided surface of the garment", () => {
  const plan = readCreaturePlan(creaturePresets["Court envoy"]);
  const form = buildCreature(plan);
  assert.ok(plan.dress.device);
  let painted = 0;
  for (const part of form.parts) {
    const chart = liveryChart(part, plan.dress);
    if (!chart) continue;
    painted++;
    assert.equal(chart.uv.length, part.cage.vertices.length);
    const drawn = cageGeometry(part.cage, chart.uv);
    const uv = drawn.getAttribute("uv");
    assert.equal(uv.count, drawn.getAttribute("position").count);
    assert.ok(uv.array.every(v => v >= -1e-6 && v <= 1.000001));
    const old = {...plan.dress};
    delete old.device;
    assert.equal(liveryChart(part, old), null);
    drawn.dispose();
  }
  assert.ok(painted >= 2);
  assert.deepEqual(buildCreature(form.origin.plan), form);
});

test("an old muzzle and insect legs change only when the new shapes are selected", () => {
  const old = readCreaturePlan(creaturePresets["Four-legged grazer"]);
  const plain = buildCreature(steerCreaturePlan(old, {head:{snout:"muzzle",crest:"ears"},details:[]}));
  const changed = buildCreature(steerCreaturePlan(plain.origin.plan, {head:{muzzleProfile:"grazing",ear:"lop"}}));
  const get = (form, id) => form.parts.find(p => p.id === id);
  assert.notEqual(get(plain, "muzzle").shape, "cage");
  assert.equal(get(changed, "muzzle").shape, "cage");
  assert.deepEqual(get(changed,"body"),get(plain,"body"));
  assert.deepEqual(validateForm(changed),changed);
  const legs = steerCreaturePlan(old, {setLimbs:[{index:0,style:"insect",sockets:true}]});
  const plated = validateForm(buildCreature(legs));
  for (const side of ["left","right"]) {
    const piece = get(plated, side + " thoracic shields");
    assert.equal(piece.parent,"body");
    assert.ok(piece.cage.vertices.length > 10 && piece.cage.vertices.length <= 192);
    assert.equal(get(plain,piece.id),undefined);
  }
});

test("plate decoration follows the cage layout across pauldron tiers and an upright breastplate", () => {
  const input = randomCreaturePlan(14111);
  const plan = {...input,dress:{...input.dress,cut:3}};
  const plates = buildCreature(plan).parts.filter(p=>p.id.startsWith("dress ") && p.surface==="metal");
  const charts = plates.map(p=>[p,creaturePlateChart(p)]).filter(([,uv])=>uv);
  assert.ok(charts.some(([p])=>p.id==="dress cuirass"));
  assert.ok(charts.some(([p])=>p.id.endsWith("pauldron")));
  for (const [part,uv] of charts) {
    assert.equal(uv.length,part.cage.vertices.length);
    assert.ok(uv.flat().every(value=>value>0 && value<1));
  }
});
