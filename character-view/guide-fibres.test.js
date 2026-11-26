import test from "node:test";
import assert from "node:assert/strict";
import { Mesh, MeshStandardMaterial, PlaneGeometry, Vector3 } from "three";
import { sweepGeometry } from "./surface.js";
import { surfaceIndex } from "./surface-join.js";
import {
  fibreDefaults,
  validFibres,
  fibreGeometry,
  gameFibreDetail,
} from "./guide-fibres.js";

test("a comb draw replays, follows a reshaped guide and retains the guide's binding", () => {
  const knots = [
    [0, 0, 0, 0.014, 0.018],
    [0.03, 0.06, 0.02, 0.018, 0.02],
    [0.08, 0.09, 0.01, 0.005, 0.008],
  ];
  const strand = new Mesh(sweepGeometry(knots));
  const count = strand.geometry.attributes.position.count;
  strand.blendOwners = {
    ids: ["neck", "crest"],
    first: new Uint8Array(count),
    second: new Uint8Array(count).fill(1),
    weight: Float32Array.from({ length: count }, (_, i) => i / (count - 1)),
  };
  const style = { ...fibreDefaults, seed: 19, count: 12 };
  assert.ok(validFibres(style));
  assert.equal(validFibres({ ...style, count: 3 }), false);
  const grow = (mesh, settings) => fibreGeometry(mesh, settings, "#473222");
  const original = grow(strand, style),
    repeat = grow(strand, style);
  assert.deepEqual(
    original.geometry.attributes.position.array,
    repeat.geometry.attributes.position.array,
  );
  assert.deepEqual(
    original.geometry.attributes.color.array,
    repeat.geometry.attributes.color.array,
  );
  assert.notDeepEqual(
    grow(strand, { ...style, seed: 20 }).geometry.attributes.position.array,
    original.geometry.attributes.position.array,
  );
  assert.equal(
    original.owners.weight.length,
    original.geometry.attributes.position.count,
  );
  assert.ok(original.owners.weight.some((v) => v > 0 && v < 1));
  assert.ok(original.geometry.attributes.normal.array.every(Number.isFinite));
  const changed = grow(
    new Mesh(
      sweepGeometry([...knots.slice(0, -1), [0.24, 0.12, 0.03, 0.005, 0.008]]),
    ),
    style,
  );
  assert.ok(
    changed.geometry.boundingBox.max.x >
      original.geometry.boundingBox.max.x + 0.065,
  );
});

test("every strand root seats at the measured world depth on a scaled and rotated guide", () => {
  const carrier = new Mesh(new PlaneGeometry(4, 4), new MeshStandardMaterial());
  carrier.rotation.y = 0.35;
  carrier.position.set(0.3, 0.15, 0.4);
  carrier.updateMatrixWorld();
  const strand = new Mesh(
    sweepGeometry([
      [0, 0, 0.08, 0.016, 0.02],
      [0.12, 0.1, 0.11, 0.01, 0.016],
    ]),
  );
  strand.position.copy(carrier.position);
  strand.scale.set(1.3, 0.7, 0.9);
  strand.rotation.z = 0.42;
  strand.updateMatrixWorld();
  const style = { ...fibreDefaults, count: 8, seed: 902 };
  const nearest = surfaceIndex(carrier);
  const { geometry } = fibreGeometry(strand, style, "#227565", nearest);
  const attr = geometry.attributes.position,
    verticesPerStrand = attr.count / style.count;
  const normal = new Vector3(0, 0, 1).transformDirection(carrier.matrixWorld);
  for (let strandId = 0; strandId < style.count; strandId++) {
    const center = new Vector3();
    for (let j = 0; j < 5; j++)
      center.add(
        new Vector3().fromBufferAttribute(
          attr,
          strandId * verticesPerStrand + j,
        ),
      );
    center.divideScalar(5).applyMatrix4(strand.matrixWorld);
    assert.ok(
      Math.abs(center.sub(carrier.position).dot(normal) + 0.0006) < 1e-6,
    );
  }
});

test("reduced fibre detail budgets complete strands and keeps the same roots and tips", () => {
  const guide = new Mesh(
    sweepGeometry([
      [0, 0, 0, 0.02, 0.02],
      [0.02, 0.08, 0.02, 0.015, 0.014],
      [0.08, 0.14, 0.04, 0.003, 0.006],
    ]),
  );
  const settings = { ...fibreDefaults, count: 20, seed: 123 };
  const many = Array.from({ length: 60 }, (_, i) => ({
    id: String(i),
    fibres: { ...settings, count: 60 },
  }));
  const plan = gameFibreDetail(many, 9600);
  assert.equal(
    [...plan.values()].reduce((n, p) => n + p.count, 0),
    300,
  );
  assert.deepEqual(plan, gameFibreDetail([...many].reverse(), 9600));
  const full = fibreGeometry(guide, settings, "#553522").geometry;
  const lod = fibreGeometry(guide, settings, "#553522", null, {
    count: 20,
    spans: 5,
  }).geometry;
  assert.equal(lod.index.count / 3, 20 * 32);
  function center(mesh, strand, sides, atTip) {
    const pos = mesh.attributes.position,
      perStrand = pos.count / settings.count;
    const i = strand * perStrand + (atTip ? perStrand - (sides + 1) : 0),
      v = new Vector3();
    for (let j = 0; j < sides; j++)
      v.add(new Vector3().fromBufferAttribute(pos, i + j));
    return v.divideScalar(sides);
  }
  for (let i = 0; i < 20; i++)
    for (const tip of [false, true])
      assert.ok(
        center(full, i, 5, tip).distanceTo(center(lod, i, 3, tip)) < 1e-6,
      );
});
