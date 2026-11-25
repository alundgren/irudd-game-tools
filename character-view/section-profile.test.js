import { preserveArmAxes } from "./arm-section-fit.js";
import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import {
  sectionHeights,
  sectionWarp,
  validSectionProfile,
} from "./section-profile.js";
import { buildFigure } from "./figure.js";
import { validateForm } from "./recipe.js";
import { resizeInMetres } from "./dimensions.js";

test("body section edits preserve stature, scale with the rig, and survive a figure rebuild", () => {
  const profile = {
    height: 1.72,
    stations: sectionHeights.map((_, i) => [
      0.9 + i * 0.01,
      1.1 - i * 0.01,
      0.01,
      -0.02,
    ]),
  };
  const figure = buildFigure({ height: 1.72, sectionProfile: profile });
  validateForm(figure);
  assert.deepEqual(buildFigure(figure.origin.figure), figure);
  const resized = resizeInMetres(figure, 1.72, 0.86);
  const warp = sectionWarp(profile);
  for (const [i, y] of sectionHeights.entries()) {
    const p = new Vector3(0.2, y * 1.72, 0.12),
      result = warp(p.clone());
    assert.equal(p.y, result.y);
    assert.ok(
      Math.abs(result.x - (0.2 * profile.stations[i][0] + 0.0172)) < 1e-9,
    );
    assert.ok(
      result
        .clone()
        .multiplyScalar(0.5)
        .distanceTo(
          sectionWarp(resized.sectionProfile)(p.multiplyScalar(0.5)),
        ) < 1e-9,
    );
  }
  assert.equal(
    validSectionProfile({ ...profile, stations: [[2, 1, 0, 0]] }),
    false,
  );
  assert.throws(() =>
    validateForm({ ...figure, sectionProfile: { ...profile, height: -1 } }),
  );
});

test("a changing torso width preserves the arm axis between its fitted elbow and wrist", () => {
  const a = new Vector3(0.23, 1.2, 0),
    b = new Vector3(0.28, 0.85, 0.035);
  const fit = (v) => {
    v.x *= 1 + 0.24 * Math.exp(-(((v.y - 1.03) / 0.07) ** 2));
    return v;
  };
  const mid = a.clone().lerp(b, 0.5),
    target = fit(a.clone()).lerp(fit(b.clone()), 0.5);
  assert.ok(fit(mid.clone()).distanceTo(target) > 0.045);
  const warp = preserveArmAxes(fit, [[a, b]], 1.72);
  assert.ok(warp(mid.clone()).distanceTo(target) < 0.001);
  const trunk = new Vector3(0.1, mid.y, 0);
  assert.ok(warp(trunk.clone()).distanceTo(fit(trunk.clone())) < 1e-7);
});

test("a broad waist does not push a resting elbow out to the side", () => {
  const chain = [
    new Vector3(0.24, 1.39, 0),
    new Vector3(0.26, 1.06, -0.02),
    new Vector3(0.28, 0.79, 0.035),
  ];
  const fit = (v) => {
    v.x *= 1 + 0.26 * Math.exp(-(((v.y - 1.06) / 0.05) ** 2));
    return v;
  };
  const warp = preserveArmAxes(fit, [chain], 1.72);
  assert.ok(warp(chain[1].clone()).distanceTo(chain[1]) < 0.001);
});
