import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { unzlibSync } from "three/addons/libs/fflate.module.js";
import { evaluateHuman } from "./human-surface.js";
import { generatedHuman } from "./human-form.js";
import { einarAssets, einarClothes, einarCredit, einarOutfit, einarShare } from "./human-einar-attire.js";
import { libraryClothes, libraryPieces } from "./human-library.js";
import { completeLook } from "./human-looks.js";
import { adultStyles, validAdultStyle } from "./human-wardrobe.js";

const material = () => new T.MeshStandardMaterial();
const bytes = text => unzlibSync(Uint8Array.from(atob(text), c => c.charCodeAt(0)));
const slender = evaluateHuman({ height: 1.58, frame: -0.9, weight: -0.6 }), broad = evaluateHuman({ height: 1.9, frame: 0.8, weight: 0.9, muscle: 0.6 });

test("the coat, trousers and boots carry the Einar credit and licence", () => {
  assert.match(einarCredit, /Einar Rig \(CC-BY\) Blender Foundation \| studio\.blender\.org/);
  for (const garment of einarClothes[einarOutfit]) {
    const credit = einarAssets[garment].credit;
    assert.equal(credit.notice, "Einar Rig (CC-BY) Blender Foundation | studio.blender.org");
    assert.equal(credit.licence, "CC BY 4.0");
    assert.equal(credit.license, "https://creativecommons.org/licenses/by/4.0/");
    assert.equal(credit.source, "https://studio.blender.org/characters/einar/v1/");
  }
});

test("the outfit is an ordinary wardrobe choice with dyes for cloth, knit, patches, leather and soles", () => {
  assert.ok(adultStyles.outfit.includes(einarOutfit) && Object.hasOwn(libraryClothes, einarOutfit));
  assert.ok(validAdultStyle({ outfit: einarOutfit, clothColor: "#4b5540", clothSecond: "#5a5648", leatherColor: "#754b34" }));
  const tones = new Set();
  for (const garment of einarClothes[einarOutfit]) {
    const record = einarAssets[garment], chart = bytes(record.panels);
    for (const [k, rule] of record.dye.entries()) {
      tones.add(rule.tone);
      assert.ok(rule.level > 0.02 && rule.level < 0.6 && rule.worn > 0.2 && rule.worn < 0.7, garment + " " + rule.tone);
      assert.ok(chart.includes(k + 1), garment + " charts " + rule.tone);
    }
    if (garment !== "einar_boots") assert.ok(chart.includes(0), garment);
  }
  assert.deepEqual([...tones].sort(), ["accent", "dark", "leather", "light", "main", "sole"]);
});

test("it is fitted and skinned on a slender and a broad adult, with two sleeves, and stands on the ground", () => {
  for (const human of [slender, broad]) {
    const pieces = libraryPieces(human, { outfit: einarOutfit }, material, true), all = new T.Box3(), arms = { l: 0, r: 0 };
    assert.ok(pieces.length > 8);
    for (const mesh of pieces) {
      const { position, normal, uv } = mesh.geometry.attributes, skin = mesh.humanWeights;
      assert.equal(uv.count, position.count);
      assert.equal(normal.count, position.count);
      assert.ok(human.names.includes(mesh.userData.styleRegion));
      for (let i = 0; i < position.count; i++) {
        assert.ok(Math.abs(skin.weights[i * 4] + skin.weights[i * 4 + 1] + skin.weights[i * 4 + 2] + skin.weights[i * 4 + 3] - 1) < 1e-4);
        assert.ok(Number.isFinite(position.getX(i) + position.getY(i) + position.getZ(i)));
      }
      all.union(new T.Box3().setFromBufferAttribute(position));
      const sleeve = /^lowerarm_([lr])$/.exec(mesh.userData.styleRegion);
      if (sleeve) arms[sleeve[1]] += mesh.geometry.index.count / 3;
    }
    assert.ok(arms.l > 300 && arms.r > 300 && Math.abs(arms.l - arms.r) < 0.5 * arms.r, JSON.stringify(arms));
    assert.ok(all.min.y > -0.06 && all.min.y < 0.03, "soles at the ground: " + all.min.y.toFixed(3));
    assert.ok(all.max.y < human.height * 0.93, "the head stays bare");
    assert.ok(all.max.x - all.min.x < human.height * 0.75 && all.max.z - all.min.z < 0.75, "no point flies off");
    assert.ok(pieces.hidden.size > 3000);
  }
});

test("the cloth follows the body it is worn on", () => {
  const trunk = human => {
    const box = new T.Box3();
    for (const mesh of libraryPieces(human, { outfit: einarOutfit }, material, true))
      if (/spine/.test(mesh.userData.styleRegion)) box.union(new T.Box3().setFromBufferAttribute(mesh.geometry.attributes.position));
    return box.max.z - box.min.z;
  };
  assert.ok(trunk(broad) > trunk(slender) * 1.12);
});

test("looks draw it for journeys and the outdoors, in drab tones, and leave tailored and armoured looks alone", () => {
  const base = generatedHuman(8734), count = {};
  for (const direction of ["Any", "Adventure", "Outdoors", "Smart", "Festive", "Everyday", "Workwear"]) {
    count[direction] = 0;
    for (let seed = 52000; seed < 52600; seed++) {
      const look = completeLook(base, seed, direction);
      if (look.style.outfit !== einarOutfit) continue;
      count[direction]++;
      assert.equal(look.wardrobe, einarOutfit);
      assert.ok(!look.style.tailor && !look.style.armour);
      for (const field of ["clothColor", "clothSecond", "clothLight", "accentColor"]) {
        const [r, g, b] = [1, 3, 5].map(at => parseInt(look.style[field].slice(at, at + 2), 16) / 255), light = (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
        assert.ok(light < 0.45 && light > 0.08, field + " " + look.style[field]);
      }
    }
  }
  for (const [direction, share] of Object.entries(einarShare)) assert.ok(count[direction] > 600 * share * 0.4 && count[direction] < 600 * share * 1.5, direction + " " + count[direction]);
  for (const direction of ["Smart", "Festive", "Everyday", "Workwear"]) assert.equal(count[direction], 0, direction);
});
