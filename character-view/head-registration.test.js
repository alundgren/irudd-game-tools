import test from "node:test";
import assert from "node:assert/strict";
import { Matrix4, Quaternion, Vector3 } from "three";
import { fitLandmarks, placeHeadScan } from "./head-registration.js";
import { evaluateHuman } from "./human-surface.js";

test("three surface pairs recover scale, yaw, pitch and location of an isolated scan", () => {
  const points = [[-.034,.031,.07],[.036,.033,.072],[.001,-.07,.065]];
  const rotation = new Quaternion().setFromAxisAngle(new Vector3(.4,.8,.15).normalize(),.74);
  const transform = new Matrix4().compose(new Vector3(.13,1.55,-.08),rotation,new Vector3(.83,.83,.83));
  const move = p => new Vector3(...p).applyMatrix4(transform);
  const result = fitLandmarks(points, points.map(p => move(p).toArray()));
  assert.ok(result.rmsMm < 1e-8);
  assert.ok(Math.abs(result.scale-.83)<1e-10);
  const heldOut = [.06,.09,-.06];
  assert.ok(new Vector3(...heldOut).applyMatrix4(result.transform).distanceTo(move(heldOut)) < 1e-9);
  assert.throws(() => fitLandmarks(points, [[0,0,0],[.09,0,0],[.06,0,0]]), /separated/);
});

test("head placement ignores unused scan vertices and preserves known physical units", () => {
  const raw = {positions:Float32Array.of(-5,0,1, 5,0,1, 0,20,0, 3000,4000,0), indices:[0,1,2]};
  const head = placeHeadScan(raw,{units:"cm"},evaluateHuman({height:1.81}));
  assert.equal(head.report.stature,.2);
  assert.ok(head.positions[7]>1.72 && head.positions[7]<1.84);
  assert.ok(Math.abs(head.positions[3]-head.positions[0]-.1)<1e-6);
});
