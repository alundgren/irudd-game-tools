import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { evaluateHuman } from "./human-surface.js";
import { surfaceFrame } from "./human-fringe.js";
import { productionHair, productionStyles } from "./human-production-hair.js";
import { validAdultStyle } from "./human-wardrobe.js";

test("the production grooms fit edited heads and retain their dyed transparency and scalp weights", () => {
  for (const human of [{ frame: -.85, headWidth: -.8 }, { frame: .8, headWidth: .9 }]) {
    const skin = evaluateHuman(human);
    const { centre, k } = surfaceFrame(skin);
    for (const hair of productionStyles) {
      const style = { hair, fringe: "Swept right", hairColor: "#bfa576" };
      assert.ok(validAdultStyle(style));
      const [mesh] = productionHair(skin, style, () => new T.MeshStandardMaterial(), false, "#80583e");
      const { position, uv } = mesh.geometry.attributes;
      for (let i = 0; i < position.count; i++) {
        const radius = Math.hypot(position.getX(i) - centre[0], position.getY(i) - centre[1], position.getZ(i) - centre[2]);
        assert.ok(radius < .65 * k, hair + " has a distant or non-finite point");
        assert.ok(uv.getX(i) >= 0 && uv.getX(i) <= 1 && uv.getY(i) >= 0 && uv.getY(i) <= 1);
        assert.equal(mesh.humanWeights.weights[4*i], 1);
      }
      const pixels = mesh.material.map.image.data;
      assert.ok(pixels.some((v, i) => i % 4 === 3 && v === 0));
      assert.ok(pixels.some((v, i) => i % 4 === 3 && v > 240));
      assert.ok(mesh.userData.ownedPortraitTexture);
      mesh.material.map.dispose();
      mesh.material.dispose();
      mesh.geometry.dispose();
    }
  }
});
