import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { armInkBones, armInkStyles, armSleeveStyles, isArmSleeve, sleeveChart } from "./human-arm-ink.js";
import { evaluateHuman, smoothHumanSurface } from "./human-surface.js";
import { generatedHuman, humanForm } from "./human-form.js";
import { humanRegions } from "./human-mesh.js";
import { adultStyles, chooseAdultStyle, validAdultStyle } from "./human-wardrobe.js";
import { makeBrief, readProposal, validateForm } from "./recipe.js";

test("armInkStyles preserves legacy marks, adds three coherent sleeves, and round-trips through forms and proposals", () => {
  assert.deepEqual(armInkStyles, [
    "None",
    "Diving swift",
    "Fern frond",
    "Botanical sleeve",
    "Engraved sleeve",
    "Cartographic sleeve",
  ]);
  assert.deepEqual(adultStyles.armInk, armInkStyles);
  assert.equal(armSleeveStyles.length, 3);
  for (const style of armInkStyles) {
    assert.ok(validAdultStyle({ armInk: style }), style);
  }
  assert.ok(!validAdultStyle({ armInk: "Unknown sleeve" }));

  const base = humanForm({}, 42);
  const legacy = { ...base, outfit: "Work clothes", humanStyle: { outfit: "T-shirt and jeans", armInk: "Diving swift" } };
  validateForm(legacy);
  const brief = makeBrief(legacy, "test", null, {}, "Switch to a cartographic sleeve");
  assert.ok(brief.humanAppearanceInstructions.armInk.includes("Cartographic sleeve"));
  const updated = readProposal({
    format: "irudd.form-proposal.v1",
    requestId: brief.requestId,
    revision: "test",
    summary: "Cartographic sleeve",
    operations: [{ op: "setForm", set: { humanStyle: { armInk: "Cartographic sleeve" } } }],
  }, brief, "test").form;
  validateForm(updated);
  assert.equal(updated.humanStyle.armInk, "Cartographic sleeve");
  assert.equal(updated.humanStyle.outfit, "T-shirt and jeans");

  const nextStyle = chooseAdultStyle(legacy.humanStyle, { armInk: "Botanical sleeve" });
  assert.equal(nextStyle.armInk, "Botanical sleeve");
  assert.equal(nextStyle.outfit, "T-shirt and jeans");
});

test("armInkBones and sleeveChart span upper arm and forearm seamlessly across the elbow", () => {
  assert.deepEqual(armInkBones("None"), []);
  assert.deepEqual(armInkBones("Diving swift"), ["lowerarm_l"]);
  assert.deepEqual(armInkBones("Fern frond"), ["lowerarm_l"]);
  for (const name of armSleeveStyles) {
    assert.ok(isArmSleeve(name));
    assert.deepEqual(armInkBones(name), ["upperarm_l", "lowerarm_l"]);
  }

  const surface = smoothHumanSurface(evaluateHuman({ height: 1.72, leftArmLift: 0.3 }));
  const chart = sleeveChart(surface, "l");
  const upperIdx = surface.names.indexOf("upperarm_l");
  const lowerIdx = surface.names.indexOf("lowerarm_l");
  let upperCount = 0, upperVSum = 0, lowerCount = 0, lowerVSum = 0;
  for (let v = 0; v < surface.positions.length / 3; v++) {
    const b0 = surface.boneIndices[v * 4];
    if (b0 !== upperIdx && b0 !== lowerIdx) continue;
    const [u, y] = chart(v);
    assert.ok(Number.isFinite(u) && u >= 0 && u <= 1, "u in [0,1]: " + u);
    assert.ok(Number.isFinite(y) && y >= 0.01 && y <= 0.99, "v in [0.01,0.99]: " + y);
    if (b0 === upperIdx) { upperCount++; upperVSum += y; }
    else { lowerCount++; lowerVSum += y; }
  }
  assert.ok(upperCount > 50 && lowerCount > 50);
  const meanUpper = upperVSum / upperCount;
  const meanLower = lowerVSum / lowerCount;
  assert.ok(meanUpper > 0.60 && meanUpper < 0.88, "upper arm sits in upper half: " + meanUpper);
  assert.ok(meanLower > 0.14 && meanLower < 0.42, "forearm sits in lower half: " + meanLower);
});

test("humanRegions inks upper and lower arm with one shared sleeve material and preserves legacy forearm-only ink", () => {
  const mkCtx = () => {
    const ops = [];
    const ctx = {
      fillStyle: "", strokeStyle: "", lineWidth: 1, lineCap: "butt", lineJoin: "miter",
      save() {}, restore() {}, scale() {}, translate() {}, rotate() {}, clip() {},
      beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, bezierCurveTo() {}, quadraticCurveTo() {},
      arc() {}, ellipse() {}, fillRect() { ops.push("fillRect"); }, fill() { ops.push("fill"); }, stroke() { ops.push("stroke"); },
      ops,
    };
    return ctx;
  };
  const created = [];
  globalThis.document = {
    createElement() {
      const ctx = mkCtx();
      const c = { width: 0, height: 0, getContext: () => ctx, ctx };
      created.push(c);
      return c;
    },
  };
  try {
    const baseMat = new T.MeshStandardMaterial({ color: "#bd8e76", roughness: 0.66 });
    const form = { ...humanForm({}, 1751), outfit: "Work clothes", humanStyle: { armInk: "Cartographic sleeve" } };
    const build = humanRegions(form, () => baseMat, false);
    const upper = build(form.parts.find((p) => p.humanBone === "upperarm_l")).children[0];
    const lower = build(form.parts.find((p) => p.humanBone === "lowerarm_l")).children[0];
    const right = build(form.parts.find((p) => p.humanBone === "lowerarm_r")).children[0];

    assert.equal(upper.material, lower.material, "upper arm and forearm share one sleeve material/tile");
    assert.notEqual(upper.material, right.material, "uninked right arm keeps plain body skin");
    assert.equal(upper.material.name, "Cartographic sleeve arm ink");
    assert.equal(upper.material.roughness, right.material.roughness, "sleeve roughness matches body skin");
    assert.ok(created.length === 1 && created[0].width === 512 && created[0].height === 768);
    assert.ok(created[0].ctx.ops.length > 50, "sleeve draws substantial original artwork");

    const plainBuild = humanRegions(form, () => baseMat, true);
    assert.equal(plainBuild(form.parts.find((p) => p.humanBone === "upperarm_l")).children[0].material, baseMat);
  } finally {
    delete globalThis.document;
  }
});

test("ordinary generated adults occasionally draw sleeves alongside legacy marks", () => {
  const seen = new Set();
  let inked = 0;
  for (let seed = 41000; seed < 41250; seed++) {
    const f = generatedHuman(seed);
    const ink = f.humanStyle?.armInk;
    if (ink && ink !== "None") {
      inked++;
      seen.add(ink);
    }
  }
  assert.ok(inked >= 15 && inked <= 60, `occasional ink rate: ${inked}/250`);
  for (const name of armSleeveStyles) assert.ok(seen.has(name), "ordinary draws include " + name);
});
