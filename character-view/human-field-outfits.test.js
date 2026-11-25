import test from "node:test";
import assert from "node:assert/strict";
import { MeshStandardMaterial } from "three";
import { fieldClothes } from "./human-field-outfits.js";
import { libraryPieces } from "./human-library.js";
import { completeLook } from "./human-looks.js";
import { evaluateHuman } from "./human-surface.js";

test("both sleeves of the field outfits remain bound to their own arm", () => {
  const body = evaluateHuman({ height: 1.8, frame: .75, weight: .8 });
  const makeMaterial = () => new MeshStandardMaterial();
  for (const outfit of Object.keys(fieldClothes)) {
    const pieces = libraryPieces(body, { outfit }, makeMaterial, true);
    for (const side of ["l", "r"]) {
      const sleeve = pieces.find(mesh => mesh.userData.styleRegion === "lowerarm_" + side);
      assert.ok(sleeve, outfit + " has a " + side + " sleeve");
      const { boneIndices, weights } = sleeve.humanWeights;
      let ownArm = 0;
      for (let j = 0; j < weights.length; j++) {
        if (body.names[boneIndices[j]] === "lowerarm_" + side) ownArm += weights[j];
      }
      assert.ok(ownArm > .5 * sleeve.geometry.attributes.position.count, outfit + " sleeve follows the forearm");
    }
  }
});

test("an ordinary look can draw either field outfit, and directed wardrobes draw the matching one", () => {
  const base = { appearance: { skin: "#ad8068" } };
  const available = Object.keys(fieldClothes);
  for (const [direction, expected] of [["Any", available], ["Everyday", [available[1]]], ["Workwear", [available[0]]]]) {
    const worn = new Set();
    for (let seed = 0; seed < 400; seed++) {
      const look = completeLook(base, seed, direction);
      if (Object.hasOwn(fieldClothes, look.wardrobe)) {
        assert.equal(look.style.outfit, look.wardrobe);
        worn.add(look.wardrobe);
      }
    }
    assert.deepEqual([...worn].sort(), [...expected].sort());
  }
});
