import test from "node:test";
import assert from "node:assert/strict";
import { BoxGeometry, Group, Mesh, Vector3 } from "three";
import { cageGeometry, cubeCage } from "./control-cage.js";
import { sweepGeometry } from "./surface.js";
import { fitSurfaceJoins, validSurfaceJoin } from "./surface-join.js";
test("both ends of an arched fastening can be seated while the middle spans the gap", () => {
  const parent = new Mesh(new BoxGeometry(1, 1, 1));
  const child = new Mesh(
    sweepGeometry(
      [
        [-0.3, 0.57, 0, 0.01, 0.01],
        [0, 0.9, 0, 0.01, 0.01],
        [0.3, 0.57, 0, 0.01, 0.01],
      ],
      false,
    ),
  );
  parent.userData.partId = "coat";
  child.userData.partId = "loop";
  parent.add(child);
  const part = {
    id: "loop",
    parent: "coat",
    shape: "sweep",
    surfaceJoin: { end: "both", depth: 0.003 },
  };
  assert.ok(validSurfaceJoin(part));
  fitSurfaceJoins(
    { parts: [{ id: "coat" }, part] },
    new Map([
      ["coat", parent],
      ["loop", child],
    ]),
  );
  const { uv, position } = child.geometry.attributes;
  let middle = 0;
  for (let i = 0; i < uv.count; i++) {
    if (uv.getY(i) === 0 || uv.getY(i) === 1)
      assert.ok(Math.abs(position.getY(i) - 0.497) < 1e-5);
    else middle = Math.max(middle, position.getY(i));
  }
  assert.ok(middle > 0.85);
});
test("a selected cage face seats on the parent's real triangles in world metres", () => {
  const root = new Group(),
    carrier = new Mesh(new BoxGeometry(1, 1, 1)),
    cage = cubeCage(),
    child = new Mesh(cageGeometry(cage));
  root.rotation.z = 0.32;
  root.scale.set(1.2, 1.35, 0.8);
  root.position.set(-0.45, 1, 0.28);
  root.add(carrier);
  carrier.add(child);
  carrier.userData.partId = "body";
  child.userData.partId = "fin";
  child.scale.set(0.32, 0.5, 0.22);
  child.position.y = 0.77;
  const record = {
    id: "fin",
    parent: "body",
    shape: "cage",
    cage,
    surfaceJoin: { faces: [5], depth: 0.01 },
  };
  assert.ok(validSurfaceJoin(record));
  assert.equal(
    validSurfaceJoin({ ...record, surfaceJoin: { faces: [6], depth: 0.01 } }),
    false,
  );
  root.updateMatrixWorld(true);
  const pos = child.geometry.attributes.position,
    original = pos.clone();
  fitSurfaceJoins(
    { parts: [{ id: "body" }, record] },
    new Map([
      ["body", carrier],
      ["fin", child],
    ]),
  );
  let fixed = 0,
    free = 0;
  for (let i = 0; i < pos.count; i++) {
    const table = child.blendOwners;
    const w =
      (table.ids[table.first[i]] === "fin" ? table.weight[i] : 0) +
      (table.ids[table.second[i]] === "fin" ? 1 - table.weight[i] : 0);
    if (w < 1e-5) {
      fixed++;
      const local = carrier.worldToLocal(
        child.localToWorld(new Vector3().fromBufferAttribute(pos, i)),
      );
      assert.ok(Math.abs(local.y - (0.5 - 0.01 / 1.35)) < 1e-5);
    } else if (w === 1) {
      free++;
      assert.ok(
        new Vector3()
          .fromBufferAttribute(pos, i)
          .distanceTo(new Vector3().fromBufferAttribute(original, i)) < 1e-6,
      );
    }
  }
  assert.ok(fixed > 2 && free > 2, JSON.stringify({ fixed, free }));
  assert.deepEqual(child.blendOwners.ids, ["fin", "body"]);
});
test("surface piping keeps its volume and transfers ownership to the carrier", () => {
  const body = new Mesh(new BoxGeometry(1, 1, 1));
  body.userData.partId = "fin";
  const knots = [
      [-0.3, 0.62, 0, 0.025, 0.025],
      [0, 0.63, 0, 0.025, 0.025],
      [0.3, 0.59, 0, 0.025, 0.025],
    ],
    pipe = new Mesh(sweepGeometry(knots));
  pipe.userData.partId = "rib";
  body.add(pipe);
  const record = {
    id: "rib",
    parent: "fin",
    shape: "sweep",
    knots,
    surfaceJoin: { end: "along", depth: 0.01 },
  };
  fitSurfaceJoins(
    { parts: [{ id: "fin" }, record] },
    new Map([
      ["fin", body],
      ["rib", pipe],
    ]),
  );
  const g = pipe.geometry;
  assert.ok(g.boundingBox.min.y < 0.5 && g.boundingBox.max.y > 0.53);
  assert.ok(Math.abs(g.boundingBox.max.y - g.boundingBox.min.y - 0.05) < 0.003);
  assert.deepEqual(pipe.blendOwners.ids, ["fin"]);
  assert.ok([...pipe.blendOwners.weight].every((v) => v === 1));
});

test("a strip on an already skinned carrier inherits both regional weights", () => {
  const carrier = new Mesh(new BoxGeometry(1, 1, 1));
  carrier.userData.partId = "blade";
  const count = carrier.geometry.attributes.position.count;
  carrier.blendOwners = {
    ids: ["blade", "tail"],
    first: new Uint8Array(count),
    second: new Uint8Array(count).fill(1),
    weight: new Float32Array(count).fill(0.25),
  };
  const knots = [
    [-0.2, 0.57, 0, 0.02, 0.02],
    [0.2, 0.57, 0, 0.02, 0.02],
  ];
  const strip = new Mesh(sweepGeometry(knots));
  strip.userData.partId = "stripe";
  carrier.add(strip);
  const part = {
    id: "stripe",
    parent: "blade",
    shape: "sweep",
    knots,
    surfaceJoin: { end: "along", depth: 0.008 },
  };
  fitSurfaceJoins(
    { parts: [{ id: "blade" }, part] },
    new Map([
      ["blade", carrier],
      ["stripe", strip],
    ]),
  );
  const b = strip.blendOwners;
  for (let i = 0; i < b.weight.length; i++) {
    assert.equal(b.ids[b.first[i]], "tail");
    assert.equal(b.ids[b.second[i]], "blade");
    assert.ok(Math.abs(b.weight[i] - 0.75) < 1e-6);
  }
});
