import test from "node:test";
import assert from "node:assert/strict";
import { BufferGeometry, Float32BufferAttribute } from "three";
import { validRadialFit, applyRadialFit } from "./radial-fit.js";
import { validateForm } from "./recipe.js";
import { mhrStudy } from "../examples/mhr-study.js";
import { mhrFit } from "../examples/local-references.js";

test("radial fit keeps its two ends anchored and wraps across the front axis", () => {
  const zero = Array(8).fill(0),
    middle = [0.04, 0.03, 0.02, 0, -0.01, 0, 0.02, 0.03];
  const fit = { bottom: 0, step: 0.1, rows: [zero, middle, zero] };
  assert.ok(validRadialFit(fit));
  assert.ok(!validRadialFit({ ...fit, rows: [middle, middle, zero] }));
  const geom = new BufferGeometry();
  geom.setAttribute(
    "position",
    new Float32BufferAttribute([0, 0, 0.12, 0, 0.1, 0.12, 0, 0.2, 0.12], 3),
  );
  applyRadialFit(geom, fit);
  [0.12, 0.16, 0.12].forEach((r, i) =>
    assert.ok(Math.abs(geom.attributes.position.getZ(i) - r) < 1e-6),
  );
});
const needsFit = { skip: !mhrFit && "examples/mhr-fit.json is not installed" };
test("rig fit study reopens with the same editable torso and procedural joints", needsFit, () => {
  const form = mhrStudy(),
    base = mhrStudy(null);
  validateForm(JSON.parse(JSON.stringify(form)));
  const torso = form.parts.find((p) => p.id === "body");
  assert.ok(torso.radialFit);
  delete torso.radialFit;
  assert.deepEqual(form, base);
});
