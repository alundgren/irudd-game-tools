import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { changeHuman, generatedHuman, humanForm, tintHumanSkin } from "./human-form.js";
import { evaluateHuman } from "./human-surface.js";
import { defaultTailor, tailorHuman, tailorLayer, tailorLimit, tailorPieces, validTailor } from "./human-tailor.js";
import { chooseAdultStyle, dressHuman, dressedHuman, validAdultStyle } from "./human-wardrobe.js";
import { validateForm } from "./recipe.js";

const material = (color) => new T.MeshStandardMaterial({ color });
const slim = evaluateHuman({ height: 1.66, frame: -0.9, weight: -0.8 });
const heavy = evaluateHuman({ height: 1.82, frame: 0.6, weight: 1, muscle: -0.4, belly: 0.6, hips: 0.5 });
const layered = {
  layers: [
    tailorLayer("trousers", { pockets: "back and cargo" }),
    tailorLayer("top", { sleeve: 0.1, gather: 0.6 }),
    tailorLayer("top", { material: "leather", sleeve: 1.9, length: 0.3, ease: 14, stiff: 0.7, neck: "v", depth: 140, collar: "hood", front: "zip", gather: 1, pockets: "chest and hip" }),
    tailorLayer("belt"),
    tailorLayer("boots", { height: 1.3, heel: 20 }),
    tailorLayer("gloves", { cuff: 12 }),
  ],
};

function check(surface, meshes, label) {
  assert.ok(Number.isFinite(meshes.ground), label + " reports where its soles stand");
  for (const mesh of meshes) {
    const position = mesh.geometry.attributes.position, count = position.count, name = label + ": " + mesh.name;
    assert.ok(count > 0 && mesh.geometry.index.count > 0, name + " has geometry");
    assert.equal(mesh.humanWeights.weights.length, count * 4, name + " has four weights per vertex");
    assert.ok(surface.names.includes(mesh.userData.styleRegion), name + " follows a real joint");
    let finite = true, summed = true, bones = true, indexed = true;
    for (const x of position.array) finite &&= Number.isFinite(x);
    for (let v = 0; v < count; v++) {
      let total = 0;
      for (let n = 0; n < 4; n++) { total += mesh.humanWeights.weights[v * 4 + n]; bones &&= mesh.humanWeights.boneIndices[v * 4 + n] < surface.names.length; }
      summed &&= Math.abs(total - 1) < 1e-3;
    }
    for (const index of mesh.geometry.index.array) indexed &&= index < count;
    assert.ok(finite && bones && summed && indexed, name + " is a sound skinned mesh");
  }
}

test("tailored layers are checked against each piece's fields and limits", () => {
  assert.ok(validTailor(defaultTailor()));
  assert.ok(validTailor(layered));
  assert.ok(!validTailor({ layers: [] }), "an outfit needs a piece");
  assert.ok(!validTailor({ layers: [{ piece: "cape" }] }), "unknown piece");
  assert.ok(!validTailor({ layers: [{ piece: "top", ease: 400 }] }), "out of range");
  assert.ok(!validTailor({ layers: [{ piece: "top", collar: "ruff" }] }), "unknown choice");
  assert.ok(!validTailor({ layers: [{ piece: "top", color: "red" }] }), "colours are six hex digits");
  assert.ok(!validTailor({ layers: Array.from({ length: tailorLimit + 1 }, () => tailorLayer("belt")) }), "too many layers");
  assert.ok(validTailor({ layers: [{ piece: "top" }] }), "missing fields take their starting values");
  for (const [piece, spec] of Object.entries(tailorPieces)) assert.ok(validTailor({ layers: [tailorLayer(piece)] }), spec.label + " starts valid");
  assert.ok(validAdultStyle({ outfit: "None", tailor: layered }));
  assert.ok(!validAdultStyle({ tailor: { layers: [{ piece: "cape" }] } }));
});

test("every piece builds skinned meshes on a slim and a heavy adult", () => {
  for (const [label, surface] of [["slim", slim], ["heavy", heavy]]) {
    const meshes = tailorHuman(surface, layered, material), names = meshes.map((m) => m.name);
    check(surface, meshes, label);
    for (const name of ["Trousers", "Top", "Hooded top", "Zip", "Belt", "Buckle", "Boot", "Boot sole", "Boot shaft", "Glove"]) assert.ok(names.includes(name), label + " has " + name);
    check(surface, tailorHuman(surface, defaultTailor(), material), label + " default");
  }
});

test("a later layer lies outside the layers under it", () => {
  // Shirt under a snug gathered jacket: at shared skin points the jacket is never the nearer one.
  const under = tailorLayer("top", { sleeve: 0.1, ease: 6 }), over = tailorLayer("top", { sleeve: 1.9, ease: 8, stiff: 0.6, gather: 1 });
  const [shirt] = tailorHuman(heavy, { layers: [under] }, material), both = tailorHuman(heavy, { layers: [under, over] }, material);
  const jacket = both.find((m) => m.name === "Jacket");
  const reach = (mesh) => { let r = 0; const p = mesh.geometry.attributes.position.array; for (let i = 0; i < p.length; i += 3) if (p[i + 1] > 1.15 && p[i + 1] < 1.3 && Math.abs(p[i]) < 0.12) r = Math.max(r, Math.abs(p[i + 2])); return r; };
  assert.ok(reach(jacket) > reach(shirt), "the jacket stands outside the shirt over the trunk");
});

test("boots listed after trousers take the legs inside the shaft", () => {
  const loose = tailorHuman(slim, { layers: [tailorLayer("trousers", { ease: 30, fit: 0 })] }, material)[0];
  const tucked = tailorHuman(slim, { layers: [tailorLayer("trousers", { ease: 30, fit: 0 }), tailorLayer("boots", { height: 1.3 })] }, material)[0];
  const width = (mesh) => { let r = 0; const p = mesh.geometry.attributes.position.array; for (let i = 0; i < p.length; i += 3) if (p[i + 1] > 0.12 && p[i + 1] < 0.2) r = Math.max(r, Math.abs(p[i])); return r; };
  assert.ok(width(tucked) < width(loose) - 0.01, "the trouser legs are gathered at the shin");
});

test("a tailored outfit shows in ordinary clothes and is kept through other edits", () => {
  const start = humanForm({}, 7), style = { outfit: "Explorer", hair: "Crop", hairColor: "#44372f", clothColor: "#466068", tailor: defaultTailor() };
  const form = { ...start, outfit: "Work clothes", humanStyle: style };
  validateForm(form);
  const names = (f) => dressedHuman(evaluateHuman(f.human, f.humanFit), f, material, true).map((m) => m.name);
  assert.ok(names(form).includes("Belt") && !names(form).includes("Jacket"), "tailored pieces replace the preset");
  // Body, skin and hair changes keep the tailoring.
  assert.deepEqual(changeHuman(form, { weight: 0.5 }).humanStyle.tailor, style.tailor);
  assert.deepEqual(tintHumanSkin(form, "#8a5a44").humanStyle.tailor, style.tailor);
  assert.deepEqual(chooseAdultStyle(style, { hair: "Bun" }).tailor, style.tailor);
  assert.deepEqual(chooseAdultStyle(style, { clothColor: "#603d4b" }).tailor, style.tailor);
  // The base shape and the suit preview hide the pieces without discarding them.
  for (const outfit of ["Anatomy", "Base layer", "Pressure suit"]) {
    const shown = { ...form, outfit };
    assert.ok(!names(shown).includes("Belt"), outfit + " hides tailored pieces");
    assert.deepEqual(shown.humanStyle.tailor, style.tailor);
  }
});

test("choosing or rolling a preset outfit shows that outfit instead of earlier tailored pieces", () => {
  const start = humanForm({}, 7), style = { outfit: "Explorer", hair: "Crop", hairColor: "#44372f", clothColor: "#466068", tailor: defaultTailor() };
  const form = { ...start, outfit: "Work clothes", humanStyle: style };
  const names = (f) => dressedHuman(evaluateHuman(f.human, f.humanFit), f, material, true).map((m) => m.name);
  // The clothing select.
  const chosen = { ...form, humanStyle: chooseAdultStyle(form.humanStyle, { outfit: "Chore jacket" }) };
  assert.equal(chosen.humanStyle.tailor, undefined);
  assert.equal(chosen.humanStyle.outfit, "Chore jacket");
  assert.ok(!names(chosen).includes("Belt"), "the tailored belt is gone");
  assert.notDeepEqual(names(chosen), names(form));
  // Roll a look.
  for (const seed of [1, 2, 3, 4]) {
    const rolled = dressHuman(form, seed);
    // A rolled look may bring tailored pieces of its own, never the ones worn before.
    assert.notDeepEqual(rolled.humanStyle.tailor, style.tailor, "a rolled look is not hidden by old pieces");
    assert.ok(rolled.humanStyle.tailor === undefined || validTailor(rolled.humanStyle.tailor));
    validateForm(rolled);
  }
  // Undo restores the earlier form object, which still holds the pieces.
  assert.deepEqual(form.humanStyle.tailor, style.tailor);
  // Handing over tailoring together with an outfit name keeps it.
  assert.deepEqual(chooseAdultStyle({ outfit: "Explorer" }, { outfit: "None", tailor: style.tailor }).tailor, style.tailor);
});

test("skin and cloth that lie well inside another piece are left out", () => {
  const triangles = (mesh) => mesh.geometry.index.count / 3, shirt = tailorLayer("top", { sleeve: 1.4, ease: 6 }), jacket = tailorLayer("top", { sleeve: 1.9, ease: 10, stiff: 0.6, neck: "v", depth: 120 });
  const alone = tailorHuman(slim, { layers: [shirt] }, material), both = tailorHuman(slim, { layers: [shirt, jacket] }, material);
  assert.ok(triangles(both[0]) < triangles(alone[0]) * 0.6, "most of a shirt under a jacket is not built");
  assert.ok(triangles(both[0]) > 200, "the part of the shirt showing in the jacket's opening stays");
  const unused = (mesh) => mesh.geometry.attributes.position.count - new Set(mesh.geometry.index.array).size;
  assert.equal(unused(both.find((m) => m.name === "Jacket")), 0, "the outer layer is whole");
  assert.ok(unused(both[0]) > 0);
  // Covered skin is named by source vertex, as library clothing names it. Open edges keep their skin.
  const source = new Map(Array.from(slim.ids, (id, v) => [id, v])), heights = [...alone.hidden].map((id) => slim.positions[source.get(id) * 3 + 1]);
  assert.ok(alone.hidden.size > 500 && both.hidden.size >= alone.hidden.size);
  let neck = -Infinity, hand = 0;
  for (let j = 0; j < slim.names.length; j++) if (slim.names[j] === "neck_01") neck = slim.joints[j * 3 + 1];
  assert.ok(Math.max(...heights) < neck + 0.02, "the neck above the opening stays");
  for (const id of alone.hidden) { const v = source.get(id); for (let n = 0; n < 4; n++) if (slim.names[slim.boneIndices[v * 4 + n]].startsWith("hand") && slim.weights[v * 4 + n] > 0.5) hand++; }
  assert.equal(hand, 0, "bare hands stay");
  // The editor's skin builder reads the same list from a dressed adult, and nothing is hidden in the base shape.
  const form = { ...humanForm({}, 7), outfit: "Work clothes", humanStyle: { outfit: "Explorer", hair: "Crop", tailor: { layers: [shirt] } } };
  const dressed = (f) => dressedHuman(evaluateHuman(f.human, f.humanFit), f, material, true).hidden;
  assert.ok(dressed(form).size > 500);
  assert.ok(dressed({ ...form, outfit: "Anatomy" }).size < dressed(form).size);
});

test("cargo pockets follow the thigh even when resting fingers touch them", () => {
  const surface = evaluateHuman({ ...generatedHuman(42719).human, leftArmLift: 0, rightArmLift: 0 });
  const trousers = tailorHuman(surface, { layers: [tailorLayer("trousers", {
    pockets: "back and cargo", fit: .05, ease: 14, rise: .55, length: 2.03, hemBand: 18,
  })] }, material).find(mesh => mesh.name === "Trousers");
  const { boneIndices, weights } = trousers.humanWeights;
  for (let i = 0; i < weights.length; i++) {
    if (weights[i] > .001) assert.doesNotMatch(surface.names[boneIndices[i]], /arm|hand|thumb|index|middle|ring|pinky/);
  }
});

test("a folded shirt collar tucks under a high stand and stays visible in an open jacket", () => {
  const folded = tailorLayer("top", { collar:"shirt", sleeve:1.4, neck:"crew", ease:5 });
  const plain = {...folded, collar:"none"};
  const shirtVertices = (shirt, outer) =>
    tailorHuman(slim, {layers:[shirt,outer]}, material)[0].geometry.attributes.position.count;
  const closed = tailorLayer("top",{neck:"high", collar:"stand", sleeve:1.9, ease:12, stiff:.62});
  const opened = {...closed, neck:"v", depth:130};
  // Both shirts have separately cut neck openings. Compare the collar geometry
  // of the same shirt across the two openings of its outer jacket.
  assert.ok(shirtVertices(folded,opened) > shirtVertices(folded,closed));
  assert.equal(shirtVertices(plain,opened),shirtVertices(plain,closed));
});
