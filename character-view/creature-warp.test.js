import test from "node:test";
import assert from "node:assert/strict";
import { MeshBasicMaterial, Triangle, Vector3 } from "three";
import { blendSkin } from "./blended-skin.js";
import {
  buildCreature,
  creaturePresets,
  readCreaturePlan,
  rebuildCreature,
} from "./creature-plan.js";
import { limbCentre, moveLimbs, setGirth } from "./creature-handles.js";
import { plainModel } from "./creature-plan.test.js";
import { creatureWarp, warpSteps } from "./creature-warp.js";

const skin = new MeshBasicMaterial();
function figureOf(form, joined) {
  const { group, nodes } = plainModel(form);
  if (joined) blendSkin(form, nodes, () => skin);
  group.updateMatrixWorld(true);
  return { group, nodes };
}
function worldPoints(mesh) {
  const p = mesh.geometry.attributes.position,
    v = new Vector3(),
    out = [];
  for (let i = 0; i < p.count; i++)
    out.push(v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld).clone());
  return out;
}
const state = (group) => {
  const out = [];
  group.traverse((node) => {
    out.push(node.matrixWorld.elements.slice());
    if (node.isMesh)
      out.push(
        node.geometry.attributes.position.array.slice(),
        node.geometry.attributes.normal?.array.slice() ?? [],
      );
  });
  return out;
};
const edits = (plan) => [
  ["chest", setGirth(plan, 3, plan.spine.bulge[3] * 1.5)],
  ["belly", setGirth(plan, 2, plan.spine.bulge[2] * 0.6)],
  ...plan.limbs.map((limb, i) => [
    "limb " + i,
    moveLimbs(plan, i, limbCentre(limb) - 0.15),
  ]),
];
const presets = Object.entries(creaturePresets)
  .filter(([, raw]) => !raw.dress)
  .map(([name, raw]) => [name, buildCreature(raw)]);

test("a dressed animal is left alone by the warp and waits for the exact build", () => {
  const form = buildCreature(creaturePresets["Court envoy"]),
    plan = readCreaturePlan(form.origin.plan);
  const { group } = figureOf(form, true);
  const before = state(group),
    warp = creatureWarp();
  const wider = rebuildCreature(form, setGirth(plan, 3, plan.spine.bulge[3] * 1.5));
  assert.equal(warpSteps(form, wider), null);
  assert.ok(!warp.show(group, form, wider));
  assert.ok(!warp.warped);
  assert.deepEqual(state(group), before);
  const bare = buildCreature({ ...creaturePresets["Court envoy"], dress: undefined }),
    barePlan = readCreaturePlan(bare.origin.plan);
  assert.ok(warpSteps(bare, rebuildCreature(bare, setGirth(barePlan, 3, barePlan.spine.bulge[3] * 1.5))));
});

test("a warp puts every separate region where the new plan builds it", () => {
  let overall = 0;
  for (const [name, form] of presets) {
    const plan = readCreaturePlan(form.origin.plan);
    const { group, nodes } = figureOf(form, false);
    const warp = creatureWarp();
    for (const [label, edit] of edits(plan)) {
      if (JSON.stringify(edit) === JSON.stringify(plan)) continue;
      const next = rebuildCreature(form, edit);
      assert.ok(warp.show(group, form, next), name + " " + label);
      const exact = figureOf(next, false);
      let worst = 0;
      for (const part of next.parts) {
        const live = worldPoints(nodes.get(part.id)),
          built = worldPoints(exact.nodes.get(part.id));
        assert.equal(live.length, built.length);
        for (let i = 0; i < live.length; i++)
          worst = Math.max(worst, live[i].distanceTo(built[i]));
      }
      assert.ok(worst < 0.004 * plan.scale, name + " " + label + " is off by " + worst);
      overall = Math.max(overall, worst / plan.scale);
    }
  }
  assert.ok(overall > 0);
});

test("a warp is undone exactly, and a change it cannot show leaves the figure alone", () => {
  for (const [name, form] of presets) {
    const plan = readCreaturePlan(form.origin.plan);
    const { group } = figureOf(form, true);
    const before = state(group),
      warp = creatureWarp();
    for (const [, edit] of edits(plan))
      warp.show(group, form, rebuildCreature(form, edit));
    assert.ok(warp.warped, name);
    assert.notDeepEqual(state(group), before, name);
    warp.restore();
    assert.ok(!warp.warped);
    assert.deepEqual(state(group), before, name);
    warp.show(group, form, rebuildCreature(form, edits(plan)[0][1]));
    assert.ok(warp.show(group, form, rebuildCreature(form, plan)), name);
    assert.deepEqual(state(group), before, name);
    const more = {
      ...plan,
      limbs: [...plan.limbs, { ...plan.limbs[0], kind: "arm", pairs: 1, from: 0.6, to: 0.6 }],
    };
    let grown;
    try {
      grown = rebuildCreature(form, more);
    } catch {
      continue;
    }
    assert.equal(warpSteps(form, grown), null, name);
    assert.ok(!warp.show(group, form, grown), name);
    assert.deepEqual(state(group), before, name);
  }
});

test("joined skin follows a warp close to where the exact build puts it", () => {
  const near = (corners, cell) => {
    const grid = new Map(),
      key = (x, y, z) => x + "," + y + "," + z,
      at = (v) => Math.floor(v / cell);
    for (let i = 0; i < corners.length; i += 3) {
      const [a, b, c] = [corners[i], corners[i + 1], corners[i + 2]];
      for (let x = at(Math.min(a.x, b.x, c.x)); x <= at(Math.max(a.x, b.x, c.x)); x++)
        for (let y = at(Math.min(a.y, b.y, c.y)); y <= at(Math.max(a.y, b.y, c.y)); y++)
          for (let z = at(Math.min(a.z, b.z, c.z)); z <= at(Math.max(a.z, b.z, c.z)); z++) {
            const k = key(x, y, z);
            if (!grid.has(k)) grid.set(k, []);
            grid.get(k).push(new Triangle(a, b, c));
          }
    }
    const hit = new Vector3();
    return (p) => {
      let least = cell;
      for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++)
          for (let k = -1; k <= 1; k++)
            for (const triangle of grid.get(key(at(p.x) + i, at(p.y) + j, at(p.z) + k)) ?? [])
              least = Math.min(least, triangle.closestPointToPoint(p, hit).distanceTo(p));
      return least;
    };
  };
  const joinedPoints = (figure) => {
    const out = [];
    for (const node of figure.nodes.values())
      if (node.blendOwners) out.push(...worldPoints(node));
    return out;
  };
  for (const name of ["Six-legged crawler", "Four-legged grazer", "Upright four-armed trader"]) {
    const form = buildCreature({ ...creaturePresets[name], dress: null }),
      plan = readCreaturePlan(form.origin.plan);
    const figure = figureOf(form, true),
      warp = creatureWarp();
    const still = joinedPoints(figure);
    assert.ok(still.length > 5000, name);
    for (const [label, edit] of edits(plan)) {
      const next = rebuildCreature(form, edit);
      assert.ok(warp.show(figure.group, form, next), name + " " + label);
      const exact = joinedPoints(figureOf(next, true)),
        gap = near(exact, 0.04 * plan.scale);
      const mean = (points) => {
        let sum = 0,
          count = 0;
        for (let i = 0; i < points.length; i += 7, count++) sum += gap(points[i]);
        return sum / count;
      };
      const live = mean(joinedPoints(figure)),
        stale = mean(still);
      const girth = label === "chest" || label === "belly";
      assert.ok(
        stale < 0.002 * plan.scale
          ? live <= stale + 1e-9
          : live < (girth ? 0.4 : 0.7) * stale,
        name + " " + label + ": warp " + live + " against unmoved " + stale,
      );
    }
  }
});

test("a region added by hand rides the region that carries it", () => {
  const built = buildCreature(creaturePresets["Four-legged grazer"]),
    plan = readCreaturePlan(built.origin.plan);
  const carrier = built.parts.find((p) => p.motionRole === "thigh");
  const form = {
    ...built,
    parts: [
      ...built.parts,
      {
        id: "saddle bag",
        shape: "ellipsoid",
        parent: carrier.id,
        position: [0.05, -0.02, 0.01],
        size: [0.08, 0.1, 0.06],
        rotation: [0, 20, 0],
        color: "#775533",
        surface: "plain",
        motionRole: "rigid",
      },
    ],
  };
  const next = rebuildCreature(form, moveLimbs(plan, 0, limbCentre(plan.limbs[0]) - 0.1));
  const kept = next.parts.find((p) => p.id === "saddle bag");
  assert.deepEqual(kept, form.parts.at(-1));
  const figure = figureOf(form, true),
    warp = creatureWarp();
  assert.ok(warp.show(figure.group, form, next));
  const exact = figureOf(next, true);
  const live = worldPoints(figure.nodes.get("saddle bag")),
    built2 = worldPoints(exact.nodes.get("saddle bag"));
  for (let i = 0; i < live.length; i++)
    assert.ok(live[i].distanceTo(built2[i]) < 1e-6);
  assert.ok(live[0].distanceTo(worldPoints(figureOf(form, true).nodes.get("saddle bag"))[0]) > 0.02);
});
