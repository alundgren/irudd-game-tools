import test from "node:test";
import assert from "node:assert/strict";
import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  SphereGeometry,
} from "three";
import {
  applyFrontFit,
  registerFrontPairs,
  validFrontFit,
} from "./front-fit.js";
test("two alignment pairs remove zoom, crop translation and in-plane rotation", () => {
  const first = [
    { at: [0, 0.2, 0.4], photo: [0.3, -0.3] },
    { at: [0, -0.25, 0.2], photo: [0.3, -0.75] },
    { at: [0.12, 0.12, 0.25], photo: [0.5, -0.39] },
  ];
  const changed = first.map((p) => ({
    ...p,
    photo: [1 - 2 * p.photo[1], 2 * p.photo[0] - 0.2],
  }));
  const a = registerFrontPairs(first),
    b = registerFrontPairs(changed);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 2; j++)
      assert.ok(Math.abs(a.pins[i].shift[j] - b.pins[i].shift[j]) < 1e-10);
  assert.deepEqual(a.pins[0].shift, [0, 0]);
  assert.throws(() => registerFrontPairs([first[0], first[0], first[2]]));
  assert.equal(
    validFrontFit({
      ...a,
      pins: [a.pins[0], a.pins[1], { at: [0, 0.2, -0.4], shift: [0, 0] }],
    }),
    false,
  );
});
test("frontal edits carry a separate attachment and both endpoints of an eye morph", () => {
  const head = new Group(),
    face = new Mesh(new SphereGeometry(0.5, 64, 64));
  head.add(face);
  const eye = new Mesh(new BufferGeometry());
  eye.userData.eyePiece = "iris";
  const pp = [0, 0.02, 0.496, 0.01, 0.02, 0.495, 0, 0.03, 0.495];
  eye.geometry.setAttribute("position", new Float32BufferAttribute(pp, 3));
  eye.geometry.computeVertexNormals();
  const delta = new Float32BufferAttribute(
    Array.from({ length: 9 }, (_, i) => (i % 3 === 0 ? 0.01 : 0)),
    3,
  );
  eye.geometry.morphTargetsRelative = true;
  eye.geometry.morphAttributes.position = [delta];
  face.add(eye);
  const temple = new Mesh(new BoxGeometry(0.02, 0.02, 0.02));
  temple.position.set(0, 0.02, 0.49);
  head.add(temple);
  const old = temple.geometry;
  const pass = {
    radius: 0.3,
    amount: 1,
    pins: [
      { at: [-0.2, 0.25, 0.3], shift: [0, 0] },
      { at: [0, -0.3, 0.3], shift: [0, 0] },
      { at: [0, 0.02, 0.496], shift: [0.05, 0.025] },
    ],
  };
  applyFrontFit(face, pass, false, head);
  const ep = eye.geometry.attributes.position;
  assert.ok(
    Math.abs(ep.getX(0) - 0.05) < 0.001 && Math.abs(ep.getY(0) - 0.045) < 0.001,
  );
  assert.ok(Math.abs(ep.getX(0) + delta.getX(0) - ep.getX(1)) < 0.001);
  assert.notEqual(temple.geometry, old);
  assert.ok(
    temple.geometry.attributes.position.getX(0) -
      old.attributes.position.getX(0) >
      0.04,
  );
});
