import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { unzlibSync } from "three/addons/libs/fflate.module.js";
import { evaluateHuman } from "./human-surface.js";
import { generatedHuman } from "./human-form.js";
import { attireAssets, attireClothes, attireCredits, wearSurface } from "./human-attire.js";
import { libraryClothes, libraryPieces } from "./human-library.js";
import { palette } from "./human-style.js";
import { completeLook, lookDirections } from "./human-looks.js";
import { adultStyles, dressHuman, dressedHuman, validAdultStyle } from "./human-wardrobe.js";
import { validateForm } from "./recipe.js";

const material = () => new T.MeshStandardMaterial();
const bytes = text => unzlibSync(Uint8Array.from(atob(text), c => c.charCodeAt(0)));
const lean = evaluateHuman({ height: 1.58, frame: -0.9, weight: -0.6 }), broad = evaluateHuman({ height: 1.9, frame: 0.8, weight: 0.9, muscle: 0.6 });

test("every community costume names its author, its CC0 release and its page in the official pack", () => {
  for (const [outfit, garments] of Object.entries(attireClothes)) {
    assert.ok(attireCredits[outfit].length, outfit);
    for (const credit of attireCredits[outfit]) {
      assert.ok(garments.includes(credit.garment));
      assert.equal(credit.licence, "CC0 1.0");
      assert.equal(credit.pack, "suits02_cc0");
      assert.ok(credit.author && /^http:\/\/www\.makehumancommunity\.org\/node\/\d+$/.test(credit.source), credit.garment);
    }
  }
});

test("a costume is an ordinary outfit: listed, valid in a saved style and built by the library", () => {
  for (const outfit of Object.keys(attireClothes)) {
    assert.ok(adultStyles.outfit.includes(outfit) && Object.hasOwn(libraryClothes, outfit));
    assert.ok(validAdultStyle({ outfit, clothColor: "#27334d", clothSecond: "#7a6832", leatherColor: "#754b34" }));
  }
});

test("costumes are fitted and skinned on a slight and a broad adult and stand on the ground", () => {
  for (const outfit of Object.keys(attireClothes)) {
    const widths = [];
    for (const human of [lean, broad]) {
      const pieces = libraryPieces(human, { outfit }, material, true), box = new T.Box3();
      assert.ok(pieces.length > 3, outfit);
      for (const mesh of pieces) {
        const { position, normal, uv } = mesh.geometry.attributes, skin = mesh.humanWeights;
        assert.equal(uv.count, position.count);
        assert.equal(normal.count, position.count);
        assert.equal(skin.weights.length, position.count * 4);
        assert.ok(human.names.includes(mesh.userData.styleRegion));
        for (let i = 0; i < position.count; i++) {
          assert.ok(Math.abs(skin.weights[i * 4] + skin.weights[i * 4 + 1] + skin.weights[i * 4 + 2] + skin.weights[i * 4 + 3] - 1) < 1e-4);
          assert.ok(Number.isFinite(position.getX(i) + position.getY(i) + position.getZ(i)));
        }
        if (/spine|pelvis/.test(mesh.userData.styleRegion)) box.union(new T.Box3().setFromBufferAttribute(position));
      }
      const all = new T.Box3();
      for (const mesh of pieces) all.union(new T.Box3().setFromBufferAttribute(mesh.geometry.attributes.position));
      assert.ok(all.min.y > -0.035 && all.min.y < 0.03, outfit + " soles are at the ground: " + all.min.y.toFixed(3));
      assert.ok(all.max.y < human.height * 0.9, outfit + " leaves the head bare");
      widths.push(box.max.x - box.min.x, box.max.z - box.min.z);
    }
    assert.ok(widths[2] > widths[0] * 1.12 && widths[3] > widths[1] * 1.12, outfit + " follows the body it is worn on");
  }
});

test("a costume hides the skin it covers and leaves the head and hands", () => {
  const bone = v => { let best = 0; for (let k = 1; k < 4; k++) if (lean.weights[v * 4 + k] > lean.weights[v * 4 + best]) best = k; return lean.names[lean.boneIndices[v * 4 + best]]; };
  const at = new Map(Array.from(lean.ids, (id, i) => [id, i]));
  for (const outfit of Object.keys(attireClothes)) {
    const hidden = libraryPieces(lean, { outfit }, material, true).hidden, bones = new Set([...hidden].filter(id => at.has(id)).map(id => bone(at.get(id))));
    assert.ok(hidden.size > 3000, outfit);
    assert.ok(bones.has("spine_02") && bones.has("thigh_l") && bones.has("foot_r"), outfit + " covers trunk, legs and feet");
    for (const name of bones) assert.ok(!/^head$|hand|thumb|index|middle|ring|pinky/.test(name), outfit + " hides " + name);
  }
});

test("each costume charts the texels its dyes reach and paints its own surface", () => {
  const tones = Object.keys(palette({}));
  for (const [name, record] of Object.entries(attireAssets)) {
    assert.ok(record.dye.length && record.dye.every(rule => tones.includes(rule.tone) && rule.level > 0.02 && rule.level < 0.9), name);
    const chart = bytes(record.panels), side = Math.sqrt(chart.length);
    assert.ok(Number.isInteger(side) && side >= 512, name + " chart is square");
    const counts = new Array(record.dye.length + 1).fill(0);
    for (const label of chart) counts[label]++;
    assert.equal(counts.length, record.dye.length + 1);
    counts.slice(1).forEach((count, k) => assert.ok(count > chart.length * 0.01, name + " " + record.dye[k].tone + " dyes some cloth"));
    for (const map of ["texture", "normal", "surface"]) assert.ok(record[map].startsWith("data:image/webp;base64,"), name + " " + map);
    assert.ok(!("rest" in record) && !("cover" in record));
  }
  const tunic = bytes(attireAssets.viking_tunic.panels);
  assert.ok(tunic.filter(label => label === 0).length > tunic.length * 0.2);
  const steel = wearSurface(new T.MeshStandardMaterial({ roughness: 0.8 }), new T.Texture());
  assert.ok(steel.metalnessMap === steel.roughnessMap && steel.aoMap === steel.roughnessMap && steel.metalness === 1 && steel.roughness === 1);
});

test("an adventure look often draws a costume, any look sometimes, and other directions never", () => {
  const share = direction => { let n = 0; for (let seed = 1; seed <= 1500; seed++) if (Object.hasOwn(attireClothes, completeLook(null, seed, direction).wardrobe)) n++; return n / 1500; };
  assert.ok(share("Adventure") > 0.22 && share("Adventure") < 0.38);
  assert.ok(share("Any") > 0.03 && share("Any") < 0.1);
  for (const direction of lookDirections.filter(name => !["Any", "Adventure"].includes(name))) assert.equal(share(direction), 0, direction);
  const seen = new Set();
  for (let seed = 40000; seed < 40300; seed++) {
    const base = generatedHuman(seed), look = completeLook(base, seed, "Adventure");
    if (!Object.hasOwn(attireClothes, look.wardrobe)) continue;
    seen.add(look.wardrobe);
    const { style } = look, form = { ...base, ...dressHuman(base, seed, "Adventure") };
    assert.equal(style.outfit, look.wardrobe);
    assert.ok(validAdultStyle(form.humanStyle));
    validateForm(form);
    for (const field of ["clothColor", "clothSecond", "leatherColor", "soleColor"]) assert.match(style[field], /^#[0-9a-f]{6}$/);
    if (seen.size === 1 || seed % 7 === 0) {
      const human = evaluateHuman(form.human, form.humanFit), worn = dressedHuman(human, form, material, true);
      assert.ok(worn.hidden.size > 3000 && worn.length > 6);
    }
  }
  assert.equal(seen.size, Object.keys(attireClothes).length);
});
