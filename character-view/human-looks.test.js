import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { evaluateHuman } from "./human-surface.js";
import { changeHuman, generatedHuman, humanForm } from "./human-form.js";
import { palette, styleHuman, toneFields } from "./human-style.js";
import { finishTailored } from "./human-cloth-swatch.js";
import { libraryPieces, loadHumanLibraryMaps } from "./human-library.js";
import { faceMarkKind } from "./human-face-marks.js";
import { completeLook, lookDirections, lookFields, value } from "./human-looks.js";
import { adultStyles, dressHuman, dressedHuman, validAdultStyle } from "./human-wardrobe.js";
import { validateForm } from "./recipe.js";

const slim = evaluateHuman({ height: 1.66, frame: -0.9 });
const material = (color, kind = "cloth") => Object.assign(new T.MeshStandardMaterial({ color }), { userData: { kind } });
const colours = meshes => meshes.map(mesh => mesh.name + " " + mesh.material.color.getHexString());

test("an outfit saved with one cloth colour keeps every tone it had", () => {
  assert.deepEqual(palette({ clothColor: "#466068" }), { main: "#466068", dark: "#4e606a", light: "#b7d0d4", accent: "#7f8867", leather: "#59473d", sole: "#2f3131", metal: "#8f9296" });
  assert.deepEqual(palette({}), palette({ clothColor: "#6f7f86" }));
  const saved = { outfit: "Shirt and chinos", hair: "Crop", clothColor: "#466068" }, tones = palette(saved);
  const named = { ...saved, clothSecond: tones.dark, clothLight: tones.light, accentColor: tones.accent, leatherColor: tones.leather, soleColor: tones.sole, metalColor: tones.metal };
  assert.ok(validAdultStyle(saved) && validAdultStyle(named));
  assert.deepEqual(colours(styleHuman(slim, named, material, true)), colours(styleHuman(slim, saved, material, true)));
  const before = colours(styleHuman(slim, saved, material, true)), after = colours(styleHuman(slim, { ...saved, clothSecond: "#2f4466" }, material, true));
  const changed = before.filter((item, i) => item !== after[i]).map(item => item.split(" ")[0]);
  assert.deepEqual([...new Set(changed)], ["Chinos"]);
  assert.ok(!validAdultStyle({ clothSecond: "navy" }) && !validAdultStyle({ secondDesign: "Outfit swatch" }));
  assert.ok(validAdultStyle({ secondDesign: "Pinstripe", accentColor: "#b5622e" }));
});

test("tailored pieces saved before designs reached them stay as they were", () => {
  const form = humanForm({}, 7), tailor = { layers: [{ piece: "trousers" }, { piece: "top" }, { piece: "top", material: "leather", stiff: 0.7 }, { piece: "shoes" }] };
  const dressed = style => dressedHuman(evaluateHuman(form.human, form.humanFit), { ...form, outfit: "Work clothes", humanStyle: { hair: "Crop", tailor, ...style } }, material, false);
  const names = meshes => meshes.filter(mesh => mesh.material.name.includes("·")).map(mesh => mesh.material.name);
  assert.deepEqual(names(dressed({})), []);
  assert.deepEqual(names(dressed({ clothDesign: "Outfit swatch" })), []);
  assert.deepEqual(names(dressed({ clothDesign: "Plain cloth" })), []);
  assert.deepEqual(names(dressed({ clothDesign: "Breton stripe", secondDesign: "Pinstripe" })), ["Trousers · twill", "Top · jersey"]);
  const meshes = [Object.assign(new T.Mesh(new T.BoxGeometry(.4, .4, .2), material("#445566")), { name: "Jacket", userData: { styleType: "leather", styleRegion: "spine_03" } })], shared = meshes[0].material;
  finishTailored(meshes, { clothDesign: "Gingham" }, { k: 1, waist: 1, shoulder: 1.5, chest: [0, 1.3, 0] });
  assert.equal(meshes[0].material, shared);
});

test("library clothes keep their light tint until a style names its tones, then take the dye", async () => {
  const tint = style => libraryPieces(slim, style, material, false).find(mesh => !mesh.userData.libraryHair).material;
  const saved = tint({ outfit: "Tailored suit", clothColor: "#466068" });
  assert.equal(saved.color.getHexString(), new T.Color("#ffffff").lerp(new T.Color("#466068"), 0.32).getHexString());
  assert.equal(saved.map, null);
  const scan = Uint8ClampedArray.from([41, 41, 41, 255, 200, 200, 200, 255, 4, 4, 9, 255, 0, 0, 0, 255]), load = T.TextureLoader.prototype.loadAsync;
  let painted = null, paints = [];
  globalThis.document = { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: Uint8ClampedArray.from(scan) }), putImageData: image => { paints.push(image.data); } }) }) };
  T.TextureLoader.prototype.loadAsync = async () => new T.Texture({ width: 2, height: 2 });
  try {
    await loadHumanLibraryMaps();
    const style = { outfit: "Tailored suit", clothColor: "#27334d", clothLight: "#efe8d8", accentColor: "#b5622e" };
    const dyed = tint(style);
    painted = paints[0];
    assert.equal(dyed.color.getHexString(), "ffffff");
    assert.ok(dyed.map && painted);
    const texel = at => "#" + [0, 1, 2].map(c => painted[at * 4 + c].toString(16).padStart(2, "0")).join("");
    const near = (a, b) => Math.hypot(...[1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16))) < 40;
    assert.ok(near(texel(0), style.clothColor), "suit cloth takes the cloth colour: " + texel(0));
    assert.ok(near(texel(1), style.clothLight), "the shirt takes the pale tone: " + texel(1));
    assert.ok(near(texel(2), style.accentColor), "the tie takes the accent: " + texel(2));
    assert.ok(value(texel(3)) < value(texel(0)), "shading painted into the scan stays darker than the cloth");
    assert.equal(tint(style).map, dyed.map, "the same dye is made once");
    assert.notEqual(tint({ ...style, clothColor: "#254a3a" }).map, dyed.map);
    const again = tint({ outfit: "Tailored suit", clothColor: "#466068" });
    assert.equal(again.color.getHexString(), saved.color.getHexString());
    assert.notEqual(again.map, dyed.map);
  } finally {
    delete globalThis.document;
    T.TextureLoader.prototype.loadAsync = load;
  }
});

test("a complete look replaces what was worn and leaves the person alone", () => {
  const base = generatedHuman(8712), worn = { ...base, humanStyle: { ...base.humanStyle, outfit: "Explorer", clothAccent: "#ff00ff", clothSecond: "#00ff00", secondDesign: "Gingham", armour: { look: "Light fantasy", seed: 3 } } };
  const otherBody = changeHuman(worn, { height: 1.9, weight: 0.8, frame: 0.6 });
  for (let seed = 0; seed < 300; seed++) {
    const look = dressHuman(worn, seed), style = look.humanStyle;
    validateForm(look);
    assert.deepEqual(dressHuman(worn, seed), look, "the same seed gives the same look");
    assert.equal(look.human, worn.human);
    assert.equal(look.appearance, worn.appearance);
    assert.notEqual(style.clothAccent, "#ff00ff");
    assert.notEqual(style.clothSecond, "#00ff00");
    assert.ok([style.tailor, style.armour, style.outfit !== "None" ? style.outfit : null].filter(Boolean).length === 1, "one wardrobe at a time");
    assert.ok(adultStyles.clothDesign.includes(style.clothDesign));
    const other = dressHuman(otherBody, seed).humanStyle;
    for (const field of lookFields) assert.deepEqual(other[field], style[field], field);
  }
});

test("looks differ from seed to seed and keep their two large pieces apart in tone", () => {
  const base = generatedHuman(8734), wardrobes = new Map(), cloth = new Set(), designs = new Set();
  let close = 0, tailored = 0, armoured = 0;
  for (let seed = 1000; seed < 1600; seed++) {
    const look = completeLook(base, seed), style = look.style;
    wardrobes.set(look.wardrobe, (wardrobes.get(look.wardrobe) ?? 0) + 1);
    cloth.add(style.clothColor);
    designs.add(style.clothDesign);
    if (style.tailor) tailored++;
    if (style.armour) armoured++;
    if (["T-shirt and jeans", "Shirt and chinos", "Chore jacket", "Explorer", "Hoodie and joggers"].includes(style.outfit) && Math.abs(value(style.clothColor) - value(style.clothSecond)) < 0.1) close++;
  }
  assert.ok(wardrobes.size >= 20, "wardrobes drawn: " + wardrobes.size);
  assert.ok(Math.max(...wardrobes.values()) < 240, "no wardrobe dominates");
  assert.ok(tailored > 70 && tailored < 180 && armoured > 10 && armoured < 70, `${tailored} tailored, ${armoured} armoured`);
  assert.ok(cloth.size > 500, "cloth colours: " + cloth.size);
  assert.ok(designs.size >= 10, "designs: " + designs.size);
  assert.equal(close, 0);
});

test("a direction narrows the wardrobe and worn paint takes a colour of the clothes", () => {
  const base = generatedHuman(8739);
  const drawn = direction => new Set(Array.from({ length: 300 }, (_, seed) => completeLook(base, seed, direction).wardrobe));
  assert.deepEqual([...drawn("Workwear")].sort(), ["Chore jacket", "Coveralls", "Crew sweatshirt and cargo trousers", "Overshirt and denim", "Survey vest", "Workshop apron", "Workshop overalls", "separates"]);
  assert.ok(!drawn("Smart").has("Coveralls") && drawn("Smart").has("Tailored suit"));
  assert.ok(drawn("Adventure").has("armour") && !drawn("Everyday").has("armour"));
  assert.deepEqual(completeLook(base, 5, "No such direction"), completeLook(base, 5, "Any"));
  for (const direction of lookDirections) for (let seed = 0; seed < 120; seed++) validateForm(dressHuman(base, seed, direction));
  let painted = 0, festive = 0;
  for (let seed = 0; seed < 600; seed++) {
    const look = dressHuman(base, seed), paint = (look.faceMarks ?? []).filter(mark => faceMarkKind(mark.kind).worn && mark.tone);
    for (const mark of paint) { painted++; assert.equal(mark.tone, completeLook(base, seed).paint); }
    festive += (dressHuman(base, seed, "Festive").faceMarks ?? []).some(mark => mark.kind.startsWith("Paint")) ? 1 : 0;
  }
  assert.ok(painted > 5 && festive > painted * 3, `${painted} painted, ${festive} festive`);
  assert.ok(Object.keys(toneFields).every(field => lookFields.includes(field)));
});
