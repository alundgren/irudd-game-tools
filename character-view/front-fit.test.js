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
  portraitAxes,
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

test("a tilted depth-only portrait fit retracts the nose while retaining front-plane coordinates and rigid mounts", () => {
  const root = new Group(),
    head = new Mesh(new SphereGeometry(0.5, 48, 40)),
    frame = new Mesh(new BoxGeometry(0.12, 0.04, 0.015));
  root.add(head, frame);
  frame.position.set(0, 0, 0.48);
  frame.userData.rigidFaceAnchor = [0, 0, 0.5];
  const view = { yaw: -38, pitch: -12, mode: "depth" },
    basis = portraitAxes(view.yaw, view.pitch);
  const pin = ([x, y, z], dz) => ({
    at: [basis.right, basis.up, basis.out].map(
      (v) => v.x * x + v.y * y + v.z * z,
    ),
    shift: [dz * basis.right.z, dz * basis.up.z],
  });
  const pass = {
    view,
    radius: 0.22,
    amount: 1,
    pins: [
      pin([-0.18, 0.16, 0.43], 0),
      pin([0.18, 0.16, 0.43], 0),
      pin([0, 0, 0.5], -0.07),
    ],
  };
  assert.ok(validFrontFit(pass));
  assert.ok(
    !validFrontFit({ ...pass, view: { yaw: 0, pitch: 4, mode: "depth" } }),
  );
  const p = head.geometry.attributes.position,
    original = p.array.slice(),
    rigid = frame.geometry;
  applyFrontFit(head, pass, false, root);
  let greatest = 0;
  for (let i = 0; i < p.count; i++) {
    assert.equal(p.getX(i), original[3 * i]);
    assert.equal(p.getY(i), original[3 * i + 1]);
    greatest = Math.max(greatest, original[3 * i + 2] - p.getZ(i));
  }
  assert.ok(Math.abs(greatest - 0.07) < 0.001);
  assert.equal(frame.geometry, rigid);
  assert.ok(Math.abs(frame.position.z - 0.41) < 1e-5);
});

test("an oblique image-plane correction changes model depth without changing camera-space depth", () => {
  const face = new Mesh(new SphereGeometry(0.5, 48, 40)),
    view = { yaw: 41, pitch: 17, mode: "plane" };
  const { right, up, out } = portraitAxes(view.yaw, view.pitch);
  const projected = ([x, y, z]) =>
    [right, up, out].map((v) => v.x * x + v.y * y + v.z * z);
  const pins = [
    { at: projected([-0.24, 0.15, 0.38]), shift: [0, 0] },
    { at: projected([0.21, -0.12, 0.42]), shift: [0, 0] },
    { at: projected([0, 0, 0.5]), shift: [0.04, -0.02] },
  ];
  const p = face.geometry.attributes.position,
    original = p.array.slice();
  applyFrontFit(face, { view, radius: 0.2, amount: 1, pins });
  let movedForward = 0;
  for (let i = 0; i < p.count; i++) {
    const shift = projected([
      p.getX(i) - original[3 * i],
      p.getY(i) - original[3 * i + 1],
      p.getZ(i) - original[3 * i + 2],
    ]);
    assert.ok(Math.abs(shift[2]) < 1e-6);
    movedForward = Math.max(
      movedForward,
      Math.abs(p.getZ(i) - original[3 * i + 2]),
    );
  }
  assert.ok(movedForward > 0.015);
});
