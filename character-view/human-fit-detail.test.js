import test from "node:test";
import assert from "node:assert/strict";
import { BufferAttribute, BufferGeometry } from "three";
import { fitHumanReference } from "./human-fit.js";
import { evaluateHuman, humanControls, validHumanFit } from "./human-surface.js";

test("facial contour refinement fits intervening skin and keeps held control edits", () => {
  const human = {height: 1.72};
  const target = evaluateHuman({ ...human, nose: .75, cheekFullness: .7, chin: -.45 });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(target.positions, 3));
  geometry.setIndex(new BufferAttribute(target.indices.subarray(0, 3*target.bodyTriangles), 1));
  const base = evaluateHuman(human), controls = humanControls();
  const crown = Array.from(controls.ids).findIndex(v => base.positions[3*v+1] > 1.69);
  assert.ok(crown >= 0);
  const prior = {version:1, strength:1, controls:[[crown, 18, 0, 0]]};
  const options = {region:"head", hold: point => point.y > 1.68, keepEyeOpenings:true};
  const ordinary = fitHumanReference({human,humanFit:prior},geometry,options);
  const refined = fitHumanReference({human,humanFit:prior},geometry,{...options,denseHead:true});
  assert.ok(validHumanFit(refined.fit));
  assert.equal(refined.metrics.headDistortion.pastPerpendicular, 0);
  assert.ok(refined.metrics.refinedFacialContours);
  assert.deepEqual(refined.fit.controls.find(row => row[0] === crown),prior.controls[0]);
  assert.ok(refined.metrics.after.meanMm < ordinary.metrics.after.meanMm);
  geometry.dispose();
});
