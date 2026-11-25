import test from "node:test";
import assert from "node:assert/strict";
import { Color, Mesh, SphereGeometry, Vector3 } from "three";
import {
  clumpTriangles,
  peltGameDetail,
  peltGuideIds,
  tuftTriangles,
  undercoatTufts,
} from "./creature-pelt.js";

const lock = (id, parent, count) => ({
  id,
  parent,
  shape: "sweep",
  fibres: { count, wave: 0.3, fall: 0.09, grey: 0.1, rooted: true, seed: 7 },
});

test("only rooted locks on a fur undercoat take the pelt detail", () => {
  const form = {
    parts: [
      { id: "ruff undercoat", surface: "fur" },
      { id: "scalp", surface: "plain" },
      lock("ruff lock 1.1", "ruff undercoat", 38),
      lock("braid", "scalp", 32),
      { ...lock("loose", "ruff undercoat", 32), fibres: { ...lock().fibres, rooted: false } },
    ],
  };
  const guides = form.parts.filter((p) => p.fibres);
  assert.deepEqual([...peltGuideIds(form, guides)], ["ruff lock 1.1"]);
});

test("pelt clumps and tufts stay inside the triangles the strands were given", () => {
  const guides = Array.from({ length: 25 }, (_, i) => lock(`l${i}`, "u", 32 + (i % 13)));
  for (const triangles of [9600, 4800, 2000]) {
    const { detail, tufts } = peltGameDetail(guides, triangles);
    const clumps = [...detail.values()];
    assert.equal(clumps.length, guides.length);
    assert.ok(clumps.every((d) => d.count >= 1 && d.clump >= 1));
    const used =
      clumps.reduce((n, d) => n + d.count * clumpTriangles(d.spans), 0) +
      tufts * tuftTriangles;
    assert.ok(used <= triangles, `${used} > ${triangles}`);
    assert.ok(triangles - used < tuftTriangles + clumpTriangles(7) * 2);
  }
});

test("densely divided coats keep their guard hairs within the shared budget", () => {
  const guides = Array.from({ length: 220 }, (_, i) => lock(`l${i}`, "u", 10));
  const { detail, tufts } = peltGameDetail(guides, 9600);
  const guards = [...detail.values()].reduce((sum, d) => sum + d.count * clumpTriangles(d.spans), 0);
  assert.equal(detail.size, guides.length);
  assert.ok(guards + tufts * tuftTriangles <= 9600);
});

test("undercoat tufts root on the exposed coat, lean with the locks and replay", () => {
  const coat = new Mesh(new SphereGeometry(0.2, 24, 12));
  coat.updateMatrixWorld(true);
  const target = new Mesh();
  target.position.set(0.05, 0.1, 0);
  target.updateMatrixWorld(true);
  const locks = [
    { mesh: target, root: new Vector3(0, 0.2, 0), flow: new Vector3(0, 0, -1), length: 0.3, colour: new Color("#8060c0") },
  ];
  const draw = () => undercoatTufts(coat, locks, 120, 99, new Color("#402080")).get(target);
  const a = draw(),
    b = draw();
  assert.deepEqual(a.pos, b.pos);
  assert.equal(a.pos.length, 120 * 7 * 3);
  assert.equal(a.idx.length, 120 * tuftTriangles * 3);
  // Tips sit above the lower half of the sphere, which a trunk would hide,
  // and trail along the lock direction from their roots.
  let along = 0;
  for (let t = 0; t < 120; t++) {
    const ring = [0, 3, 6].map((k) => new Vector3(...a.pos.slice(t * 21 + k, t * 21 + k + 3)));
    const root = ring[0].add(ring[1]).add(ring[2]).divideScalar(3).add(target.position),
      tip = new Vector3(...a.pos.slice(t * 21 + 18, t * 21 + 21)).add(target.position);
    assert.ok(root.y > -0.08, `root ${root.y}`); // one facet band below the equator at most
    along += tip.z - root.z < 0 ? 1 : 0;
  }
  assert.ok(along > 90, `${along} tufts lean with the locks`);
});
