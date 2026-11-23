import test from "node:test";
import assert from "node:assert/strict";
import { Group, Mesh, BoxGeometry } from "three";
import { spatialGuide } from "./spatial-guide.js";
test("metric guide separates attached cargo from its carrier and reports hidden attachments", () => {
  const root = new Group(),
    trunk = new Mesh(new BoxGeometry(2, 1, 1)),
    cargo = new Mesh(new BoxGeometry(0.2, 0.2, 0.2)),
    strap = new Mesh(new BoxGeometry(0.1, 0.3, 0.1)),
    hidden = new Mesh(new BoxGeometry(5, 5, 5));
  trunk.userData.partId = "trunk";
  trunk.position.y = 1;
  root.add(trunk);
  cargo.userData.partId = "pannier";
  cargo.position.set(1, 0, -0.5);
  trunk.add(cargo);
  strap.position.y = 0.1;
  cargo.add(strap);
  hidden.userData.partId = "packed sail";
  hidden.visible = false;
  cargo.add(hidden);
  const r = spatialGuide(root).regions;
  assert.deepEqual(r[0], {
    id: "trunk",
    pivot: [0, 1, 0],
    bounds: [
      [-1, 0.5, -0.5],
      [1, 1.5, 0.5],
    ],
  });
  assert.deepEqual(r[1], {
    id: "pannier",
    pivot: [1, 1, -0.5],
    bounds: [
      [0.9, 0.9, -0.6],
      [1.1, 1.25, -0.4],
    ],
  });
  assert.equal(r[2].bounds, null);
});
