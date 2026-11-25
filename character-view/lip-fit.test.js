import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { evaluateHuman } from "./human-surface.js";
import { lipCreaseSamples } from "./lip-fit.js";

test("a displaced reference nose distinguishes the lips from a lower chin fold", () => {
  const surface = evaluateHuman({});
  const nose = surface.positions[3*297+1] + .030;
  const mouth = nose - .032, fold = mouth - .020;
  const target = {fromView(p) {
    const hill = (y,w) => Math.exp(-(((p.y-y)/w)**2));
    const z = .135 + .022*hill(nose,.008) - .003*hill(mouth,.0015) - .005*hill(fold,.0015);
    return {point:new Vector3(p.x,p.y,z)};
  }};
  const samples=lipCreaseSamples(surface,target);
  assert.ok(samples.length>=14);
  for(const {index,error} of samples) assert.ok(Math.abs(surface.positions[index*3+1]+error-mouth)<.001);
});

test("a visible closed crease supplies rim heights while a parting or a smooth cheek supplies none", () => {
  const body = evaluateHuman({});
  const midY = body.positions[3*474+1];
  function crease(p) { return midY + .002 - Math.abs(p.x)*.10; }
  const target = (dip, hole=false) => ({
    fromView(p) {
      const dy = p.y-crease(p);
      if (hole && Math.abs(dy)<.0015) return null;
      const relief = dip*Math.exp(-((dy/.0018)**2));
      return {point:new Vector3(p.x,p.y,.15-relief)};
    },
  });
  const hits=lipCreaseSamples(body,target(.003));
  assert.ok(hits.length>=14);
  for (const {index,error} of hits) {
    const p = new Vector3().fromArray(body.positions,3*index);
    assert.ok(Math.abs(p.y+error-crease(p))<.0009);
  }
  assert.deepEqual(lipCreaseSamples(body,target(0)),[]);
  assert.deepEqual(lipCreaseSamples(body,target(.014)),[]);
  assert.deepEqual(lipCreaseSamples(body,target(.003,true)),[]);
});
