import assert from "node:assert/strict";
import test from "node:test";
import { BufferGeometry, Float32BufferAttribute, Mesh, SphereGeometry, MeshStandardMaterial, Vector3 } from "three";
import {
  validMarkings,
  markingKinds,
  markingField,
  paintMarkings,
  paintJoinedCoat,
} from "./markings.js";
import { applyOperations } from "./variations.js";

test("upper and lower limb patches share pigment at a welded boundary", () => {
  const coat = {kind:"Countershade", color:"#000000", spacing:0.2, coverage:0.9, angle:0, seed:7};
  const parts = new Map([["thigh",{}], ["shin",{undercoat:coat}]]);
  function samples(ids) {
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(Array(9).fill(0),3));
    geo.setAttribute("normal",new Float32BufferAttribute([0,-1,0,0,-1,0,0,-1,0],3));
    const mesh = new Mesh(geo,new MeshStandardMaterial({color:0xffffff}));
    mesh.blendOwners = {ids,first:[0,0,1],second:[1,1,0],weight:[1,0.5,1]};
    paintJoinedCoat(mesh,parts);
    return [0,1,2].map(i=>geo.attributes.color.getX(i));
  }
  assert.deepEqual(samples(["thigh","shin"]),[1,0.5,0]);
  assert.deepEqual(samples(["shin","thigh"]),[0,0.5,1]);
});

test("surface markings replay in metres and an agent can change them without moving the body", () => {
  const part = {
    id: "body",
    shape: "ellipsoid",
    position: [0, 0.4, 0],
    rotation: [0, 0, 0],
    size: [0.6, 0.8, 0.9],
    color: "#476f69",
  };
  const m = {
    kind: "Bands",
    color: "#d99a54",
    spacing: 0.18,
    angle: 25,
    coverage: 0.5,
    seed: 43,
  };
  const form = { parts: [part] };
  const changed = applyOperations(form, [
    { op: "setPart", id: "body", set: { markings: m } },
  ]);
  assert.equal(form.parts[0].markings, undefined);
  assert.deepEqual(changed.parts[0].position, part.position);
  assert.deepEqual(changed.parts[0].markings, m);
  assert.equal(validMarkings({ ...m, spacing: 0 }), false);
  const shape = new SphereGeometry(0.5, 18, 12);
  const mesh = new Mesh(shape, new MeshStandardMaterial({ color: part.color }));
  mesh.scale.fromArray(part.size);
  mesh.position.fromArray(part.position);
  mesh.updateMatrixWorld();
  shape.computeBoundingBox();
  const bounds = shape.boundingBox.clone();
  paintMarkings(mesh, m);
  mesh.geometry.computeBoundingBox();
  assert.ok(mesh.geometry.boundingBox.min.distanceTo(bounds.min) < 1e-5);
  assert.ok(mesh.geometry.boundingBox.max.distanceTo(bounds.max) < 1e-5);
  for (const kind of markingKinds) {
    const field = markingField({ ...m, kind }),
      repeat = markingField({ ...m, kind }),
      values = [];
    for (let i = 0; i < 96; i++) {
      const p = new Vector3(i * 0.03, Math.sin(i * 0.11), Math.cos(i * 0.21)),
        n = p.clone().normalize(),
        v = field(p, n);
      assert.equal(v, repeat(p, n));
      assert.ok(v >= 0 && v <= 1);
      values.push(v);
    }
    assert.ok(Math.max(...values) - Math.min(...values) > 0.7);
  }
  assert.ok(
    mesh.material.vertexColors &&
      mesh.geometry.attributes.color.count ===
        mesh.geometry.attributes.position.count,
  );
  mesh.geometry.dispose();
  mesh.material.dispose();
});
