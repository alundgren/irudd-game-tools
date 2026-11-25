import test from "node:test";
import assert from "node:assert/strict";
import { MeshStandardMaterial } from "three";
import { scannedAssets, scannedClothes, scannedCredit, scannedShare } from "./human-scanned-tops.js";
import { libraryClothes, libraryPieces } from "./human-library.js";
import { completeLook } from "./human-looks.js";
import { evaluateHuman } from "./human-surface.js";

test("every scanned top is a whole packed garment with its own chart, dye and credit", () => {
  for (const [name, record] of Object.entries(scannedAssets)) {
    for (const key of ["refs", "weights", "offsets", "uv", "uvCorners", "corners", "hide", "panels", "texture", "normal", "surface"]) assert.ok(record[key]?.length, name + " has " + key);
    assert.ok(record.dye.length >= 1 && record.dye.every(rule => rule.tone && rule.level > 0), name + " names what dyes it");
    assert.equal(record.credit.licence, "CC BY 4.0");
    assert.match(record.credit.source, /^HSRD-100 HSR\d{4}-Body-\d{3}$/);
  }
  assert.match(scannedCredit, /Digital Reality Lab \(CC BY 4\.0\)/);
});

test("each outfit wears one scanned top over trousers and shoes the library holds", () => {
  for (const [outfit, garments] of Object.entries(scannedClothes)) {
    assert.deepEqual(libraryClothes[outfit], garments);
    assert.equal(garments.filter(garment => Object.hasOwn(scannedAssets, garment)).length, 1, outfit);
    assert.equal(garments.at(-1) in scannedAssets, true, outfit + " puts the top on last, over the waistband");
  }
});

test("a scanned top follows both arms and the trunk of slight and heavy builds", () => {
  const makeMaterial = () => new MeshStandardMaterial();
  for (const human of [{ height: 1.55, weight: -.9, muscle: -.8 }, { height: 1.92, frame: .8, weight: .95, belly: .8 }]) {
    const body = evaluateHuman(human);
    for (const outfit of Object.keys(scannedClothes)) {
      const pieces = libraryPieces(body, { outfit }, makeMaterial, true);
      for (const region of ["lowerarm_l", "lowerarm_r", "spine_02"]) {
        const piece = pieces.find(mesh => mesh.userData.styleRegion === region);
        assert.ok(piece, outfit + " covers " + region);
        for (const v of piece.geometry.attributes.position.array) assert.ok(Number.isFinite(v));
      }
    }
  }
});

test("ordinary looks draw the scanned tops in a small share, and only where they suit the direction", () => {
  const base = { appearance: { skin: "#ad8068" } };
  for (const direction of Object.keys(scannedShare)) {
    let worn = 0;
    for (let seed = 0; seed < 600; seed++) {
      const look = completeLook(base, seed, direction);
      if (!Object.hasOwn(scannedClothes, look.wardrobe)) continue;
      worn++;
      assert.equal(look.style.outfit, look.wardrobe);
    }
    assert.ok(worn > 0 && worn < 600 * (scannedShare[direction] + .05), direction + " drew " + worn);
  }
  for (let seed = 0; seed < 300; seed++) assert.ok(!Object.hasOwn(scannedClothes, completeLook(base, seed, "Adventure").wardrobe));
});
