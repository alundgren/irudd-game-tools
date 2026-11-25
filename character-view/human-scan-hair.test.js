import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { humanForm, generatedHuman, changeHuman } from "./human-form.js";
import { humanRegions } from "./human-mesh.js";
import { evaluateHuman } from "./human-surface.js";
import { surfaceFrame } from "./human-fringe.js";
import { hatHead } from "./human-hats.js";
import { adultStyles, adultStyleProblems, chooseAdultStyle, dressHuman, dressedHuman } from "./human-wardrobe.js";
import { scanHairStyles, scanHairCredit, scanHairSource, scanHair } from "./human-scan-hair.js";

const material = (colour) => new T.MeshStandardMaterial({ color: colour });
const head = (form) => humanRegions(form, material, false, (s) => dressedHuman(s, form, material, false, 0))(form.parts.find((part) => part.humanBone === "head"));
const styled = (form, patch) => ({ ...form, humanStyle: chooseAdultStyle(form.humanStyle, patch) });
const drawn = (seed) => { const base = generatedHuman(seed); return { ...base, ...dressHuman(base, seed) }; };
const worn = (group) => group.children.filter((mesh) => mesh.userData.scanHair);

test("scan cuts are hairstyles to choose, each with the scan it came from, and ordinary draws do not pick them", () => {
  assert.deepEqual(scanHairStyles, ["Silver side part", "Feathered dark crop"]);
  for (const hair of scanHairStyles) {
    assert.ok(adultStyles.hair.includes(hair));
    assert.deepEqual(adultStyleProblems({ hair }), []);
    assert.match(scanHairSource({ hair }), /^HSR\d{4}-Body-\d{3}$/);
  }
  assert.equal(scanHairSource({ hair: "Crop" }), null);
  assert.match(scanHairCredit.credit, /HSRD-100/);
  assert.match(scanHairCredit.license, /creativecommons\.org\/licenses\/by\/4\.0/);
  assert.match(scanHairCredit.revision, /^[0-9a-f]{40}$/);
  for (let seed = 930100; seed < 930160; seed++) assert.ok(!scanHairStyles.includes(drawn(seed).humanStyle.hair));
});

test("a native adult wears a scan cut as one cut-out piece on the head, under a hat too", () => {
  for (const hair of scanHairStyles) {
    const person = styled(drawn(930009), { hair, hat: "None" }), pieces = worn(head(person));
    assert.equal(pieces.length, 1);
    const [mesh] = pieces;
    assert.equal(mesh.userData.styleRegion, "head");
    assert.ok(mesh.material.alphaTest > 0 && mesh.material.map);
    assert.ok(mesh.geometry.index.count / 3 <= 6000);
    for (const value of mesh.geometry.attributes.position.array) assert.ok(Number.isFinite(value));
    for (const value of mesh.geometry.attributes.uv.array) assert.ok(value >= 0 && value <= 1);
    assert.equal(worn(head(styled(person, { hat: "Flat cap" }))).length, 1);
  }
});

test("the cut lies on the skin of whatever head wears it and keeps its relief above", () => {
  for (const patch of [{}, { frame: 0.9 }, { frame: -0.9 }, { age: 0.9 }]) {
    const form = changeHuman(humanForm(), patch), surface = evaluateHuman(form.human), skull = hatHead(surfaceFrame(surface));
    for (const hair of scanHairStyles) {
      const [mesh] = scanHair(surface, { hair, hairColor: "#44372f" }, material, false, "#c29a7e");
      const at = mesh.geometry.attributes.position.array, heights = [];
      for (let i = 0; i < at.length; i += 3) heights.push(skull.over([at[i], at[i + 1], at[i + 2]]).h);
      heights.sort((a, b) => a - b);
      assert.ok(heights[0] > 0.001, `${hair} under the skin: ${heights[0]}`);
      assert.ok(heights[heights.length >> 1] > 0.003 && heights.at(-1) < 0.05, `${hair} relief ${heights[heights.length >> 1]} to ${heights.at(-1)}`);
    }
  }
});

test("a dye keeps the photographed variation and the scan's own cut-out", () => {
  const surface = evaluateHuman(humanForm().human);
  const pixels = (colour) => scanHair(surface, { hair: "Silver side part", hairColor: colour }, material, false, "#c29a7e")[0].material.map.image.data;
  const dark = pixels("#302725"), grey = pixels("#9b948c");
  let covered = 0, lighter = 0, values = new Set();
  for (let i = 0; i < dark.length; i += 4) {
    assert.equal(dark[i + 3], grey[i + 3]);
    if (dark[i + 3] < 200) continue;
    covered++;
    if (grey[i + 1] > dark[i + 1]) lighter++;
    values.add(dark[i + 1]);
  }
  assert.ok(covered > 50000);
  assert.ok(lighter > 0.95 * covered);
  assert.ok(values.size > 40, "a dark dye still shows many tones");
});
