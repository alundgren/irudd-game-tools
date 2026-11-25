import test from "node:test";
import assert from "node:assert/strict";
import { Mesh, MeshStandardMaterial, PlaneGeometry, Texture } from "three";
import { hairLockTips } from "./human-lock-tips.js";

test("fitted hair edges grow finite cutout tips on the coloured renderer path", t => {
  const context = { beginPath() {}, moveTo() {}, quadraticCurveTo() {}, fill() {} };
  const original = globalThis.document;
  t.after(() => {
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  });
  globalThis.document = { createElement: () => ({ getContext: () => context }) };
  const card = new Mesh(new PlaneGeometry(.03,.03), new MeshStandardMaterial({map:new Texture()}));
  const frame = { k:1, centre:[0,0,-.1], eye:[0,-.05,0], aim:() => ({eps:0, phi:.2}) };
  const tips = hairLockTips(card, frame, "#443026", "Sleek bob");
  assert.ok(tips?.geometry.index.count > 0);
  assert.ok(tips.geometry.attributes.position.array.every(Number.isFinite));
  assert.ok(tips.material.alphaTest > 0);
});
