import test from "node:test";
import assert from "node:assert/strict";
import { BoxGeometry, Group, Mesh, Vector3 } from "three";
import { startingForm } from "./recipe.js";
import { sculptBuild } from "./body-sculpt.js";
import { bodyFrame } from "./graft.js";
import { measureFigure, resizeInMetres } from "./dimensions.js";
const pack = {
  id: "pack",
  shape: "box",
  position: [0, 0.36, -0.45],
  size: [0.4, 0.66, 0.48],
  rotation: [0, 0, 0],
  parent: "torso",
  color: "#998866",
  outfitRole: "accessory",
};
function measuringFixture(form, includePack) {
  const root = new Group(),
    head = new Group();
  head.userData.partId = "head";
  head.position.y = 1.55;
  const surface = new Mesh(new BoxGeometry(0.2, 0.36, 0.22));
  surface.userData.faceSurface = true;
  head.add(surface);
  root.add(head);
  const foot = new Mesh(new BoxGeometry(0.2, 0.1, 0.23));
  foot.position.y = 0.05;
  foot.userData.partId = "left leg";
  root.add(foot);
  if (includePack) {
    const load = new Mesh(new BoxGeometry(0.4, 0.66, 0.45));
    load.position.set(0, 1.68, -0.54);
    load.userData.partId = "pack";
    root.add(load);
  }
  sculptBuild(root, form);
  root.updateMatrixWorld(true);
  return {
    root,
    points: Array.from(surface.geometry.attributes.position.array),
    headMatrix: head.matrixWorld.toArray(),
  };
}
test("wearing a large pack leaves all registered face vertices and the head pivot unchanged", () => {
  const base = {
    ...startingForm(() => 0.41),
    build: { mass: 1.6, shoulders: 1.35, belly: 1.75 },
  };
  const equipped = { ...base, parts: [...base.parts, pack] };
  const a = measuringFixture(base, false),
    b = measuringFixture(equipped, true);
  assert.deepEqual(a.points, b.points);
  assert.deepEqual(a.headMatrix, b.headMatrix);
  const x = measureFigure(a.root, base),
    y = measureFigure(b.root, equipped);
  assert.equal(x.head, y.head);
  assert.ok(y.overall > x.overall);
  const grown = resizeInMetres(equipped, y.head, 1.9);
  assert.equal(
    grown.parts.find((p) => p.id === "pack"),
    pack,
  );
  assert.ok(
    Math.abs(grown.parts[0].size[0] / base.parts[0].size[0] - 1.9 / y.head) <
      1e-10,
  );
});
test("a horizontal body has a finite body frame and explicit hidden gear is excluded from physical readings", () => {
  const body = {
    id: "eel",
    shape: "sweep",
    motionRole: "axial spine",
    position: [0, 0.2, 0],
    size: [1, 1, 1],
    rotation: [0, 0, 0],
    knots: [
      [0, 0, 0, 0.1, 0.12],
      [0, 0, 1, 0.12, 0.16],
    ],
  };
  const b = bodyFrame({ parts: [body] });
  assert.ok(b.getSize(new Vector3()).y > 0.25);
  const { root } = measuringFixture({ parts: [], build: undefined }, true),
    form = startingForm(() => 0.41);
  root.children.at(-1).visible = false;
  const r = measureFigure(root, form);
  assert.ok(Math.abs(r.overall - r.head) < 1e-9);
  assert.throws(() => resizeInMetres(form, 0, 2));
  assert.throws(() => resizeInMetres(form, 1, 0));
});
