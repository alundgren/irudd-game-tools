import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { evaluateHuman } from "./human-surface.js";
import { fittedEyewear, eyewearStyles } from "./human-eyewear.js";
import { validAdultStyle, chooseAdultStyle } from "./human-wardrobe.js";

const material = (color) => new T.MeshStandardMaterial({ color });

test("frames clear the pupils from the front and three-quarter views on different heads", () => {
  for (const frame of [-1, 1]) {
    const surface = evaluateHuman({
      frame,
      headWidth: frame,
      eyeSpacing: frame * 0.8,
      noseBridge: -frame,
      weight: frame,
    });
    for (const eyewear of eyewearStyles.slice(1)) {
      const [mesh] = fittedEyewear(surface, eyewear, material);
      assert.equal(mesh.userData.styleRegion, "head");
      assert.ok(mesh.geometry.index.count < 7000);
      mesh.material.side = T.DoubleSide;
      for (const ids of surface.eyeGroups) {
        const bounds = new T.Box3(),
          p = new T.Vector3();
        for (const i of ids)
          bounds.expandByPoint(p.fromArray(surface.positions, 3 * i));
        const eye = bounds.getCenter(p);
        eye.z = bounds.max.z;
        for (const angle of [0, -0.5, 0.5]) {
          const view = new T.Vector3(Math.sin(angle), 0, Math.cos(angle));
          const ray = new T.Raycaster(
            eye.clone().addScaledVector(view, 0.3),
            view.negate(),
            0,
            0.3,
          );
          assert.equal(
            ray.intersectObject(mesh).length,
            0,
            eyewear + " covers a pupil",
          );
        }
      }
    }
  }
});
test("eyewear travels with a saved look and can be removed independently", () => {
  for (const eyewear of eyewearStyles) assert.ok(validAdultStyle({ eyewear }));
  const styled = { eyewear: "Square acetate", outfit: "Traveller" };
  assert.equal(
    chooseAdultStyle(styled, { outfit: "Explorer" }).eyewear,
    "Square acetate",
  );
  assert.deepEqual(fittedEyewear(null, "None", material), []);
  assert.deepEqual(fittedEyewear(null, undefined, material), []);
});
