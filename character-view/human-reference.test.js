import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { evaluateHuman } from "./human-surface.js";
import {
  alignReference,
  bakeScene,
  bodyColumn,
  poseReadings,
  summarise,
  surfaceIndex,
} from "./human-reference-align.js";

const body = (parameters) => {
  const s = evaluateHuman(parameters);
  return {
    positions: s.positions.slice(0, s.bodyVertices * 3),
    indices: Uint32Array.from(s.indices.subarray(0, s.bodyTriangles * 3)),
  };
};

test("a centimetre, Z-up body facing sideways returns to the workshop's metres and axes", () => {
  const upright = body({ height: 1.66, stance: 0.3 }),
    raw = upright.positions.slice();
  for (let i = 0; i < raw.length; i += 3) {
    const [x, y, z] = upright.positions.subarray(i, i + 3);
    raw.set([-z * 100 + 30, -x * 100 - 12, y * 100 + 7], i);
  }
  const column = bodyColumn(upright.positions);
  const { positions, report } = alignReference({ positions: raw }, {}, { stature: 1.72, column });
  assert.deepEqual([report.up, report.unit, report.turn], ["Z", "cm", 90]);
  assert.ok(Math.abs(report.stature - 1.66) < 1e-4);
  let worst = 0;
  for (let i = 0; i < raw.length; i++)
    worst = Math.max(worst, Math.abs(positions[i] - upright.positions[i]));
  assert.ok(worst < 1e-4, "largest position error " + worst);
  const back = upright.positions.slice();
  for (let i = 0; i < back.length; i += 3) {
    back[i] *= -1;
    back[i + 2] *= -1;
  }
  const turned = alignReference({ positions: back }, {}, { column }).report;
  assert.deepEqual([turned.turn, turned.turnReason, turned.unit], [180, "feet", "m"]);
  assert.equal(turned.notes.length, 0);
  const kept = alignReference({ positions: back }, { turn: "0" }, { column }).report;
  assert.match(kept.notes[0], /facing away/);
  assert.match(alignReference({ positions: back }, { turn: "90" }, { column }).report.notes[0], /sideways/);
});

test("unknown units fall back to the template stature and say so", () => {
  const raw = body({}).positions.map((x) => x * 17);
  const { report } = alignReference({ positions: raw }, {}, { stature: 1.8 });
  assert.equal(report.unit, "stature");
  assert.ok(Math.abs(report.stature - 1.8) < 1e-4);
  assert.equal(report.notes.length, 1);
  const inches = alignReference({ positions: body({}).positions.map((x) => x / 0.0254) }).report;
  assert.equal(inches.unit, "in");
});

test("pose readings follow the arm rest angle and stay level across statures", () => {
  const read = (parameters) => poseReadings(body(parameters).positions);
  const open = read({ stance: -0.5 }),
    rest = read({ stance: 0.76 });
  assert.ok(rest.armsBelowHorizontal - open.armsBelowHorizontal > 30);
  assert.ok(open.armDifference < 0.01 && open.footSpacing > 0.2 && open.footSpacing < 0.6);
  assert.ok(Math.abs(read({ height: 1.5 }).armsBelowHorizontal - read({ height: 2 }).armsBelowHorizontal) < 1);
});

test("signed surface distances agree with a direct search", () => {
  const { positions, indices } = body({});
  const distance = surfaceIndex(positions, indices),
    tri = new T.Triangle(),
    hit = new T.Vector3(),
    p = new T.Vector3();
  for (const point of [[0.02, 1.2, 0.5], [0.6, 0.4, -0.3], [0, 1.1, 0], [0.1, 0.5, 0.02]]) {
    p.fromArray(point);
    let best = Infinity;
    for (let f = 0; f < indices.length; f += 3) {
      tri.a.fromArray(positions, indices[f] * 3);
      tri.b.fromArray(positions, indices[f + 1] * 3);
      tri.c.fromArray(positions, indices[f + 2] * 3);
      best = Math.min(best, tri.closestPointToPoint(p, hit).distanceTo(p));
    }
    assert.ok(Math.abs(Math.abs(distance(p)) - best) < 1e-6);
  }
  assert.ok(distance(p.set(0.02, 1.2, 0.5)) > 0, "in front of the chest is outside");
  assert.ok(distance(p.set(0, 1.1, 0)) < 0, "the middle of the trunk is inside");
  const stats = summarise([0.001, -0.003, 0.002]);
  assert.ok(Math.abs(stats.meanMm - 2) < 1e-4 && Math.abs(stats.biasMm) < 1e-4 && stats.samples === 3);
});

test("baking applies node transforms and skinning, and keeps faces outward under mirroring", () => {
  const box = new T.Mesh(new T.BoxGeometry(1, 1, 1));
  const holder = new T.Group();
  holder.scale.set(-0.01, 0.01, 0.01);
  holder.position.set(0, 3, 0);
  holder.add(box);
  const bone = new T.Bone(),
    geometry = new T.BoxGeometry(1, 1, 1),
    n = geometry.attributes.position.count;
  geometry.setAttribute("skinIndex", new T.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
  geometry.setAttribute("skinWeight", new T.Float32BufferAttribute(Float32Array.from({ length: n * 4 }, (_, i) => +(i % 4 === 0)), 4));
  const skinned = new T.SkinnedMesh(geometry);
  skinned.add(bone);
  skinned.bind(new T.Skeleton([bone]));
  bone.position.x = 5;
  const root = new T.Group();
  root.add(holder, skinned);
  const baked = bakeScene(root);
  assert.equal(baked.meshes, 2);
  const first = baked.positions.subarray(0, n * 3),
    second = baked.positions.subarray(n * 3);
  assert.ok(Math.abs(Math.max(...first.filter((_, i) => i % 3 === 1)) - 3.005) < 1e-6);
  assert.ok(Math.abs(Math.min(...second.filter((_, i) => i % 3 === 0)) - 4.5) < 1e-6);
  const distance = surfaceIndex(baked.positions, baked.indices);
  assert.ok(distance(new T.Vector3(0, 3.02, 0)) > 0);
  assert.ok(distance(new T.Vector3(0, 3, 0)) < 0);
});
