import test from "node:test";
import assert from "node:assert/strict";
import { OrthographicCamera, Vector3 } from "three";
import {
  buildCreature,
  creaturePresets,
  readCreaturePlan,
  rebuildCreature,
  spineFrame,
} from "./creature-plan.js";
import {
  creatureHandles,
  girthAxis,
  girthPoint,
  girthRange,
  girthStations,
  limbCentre,
  limbRail,
  limbRoot,
  limbStations,
  lineLength,
  moveLimbs,
  nearestAlong,
  pullGirth,
  viewOf,
} from "./creature-handles.js";
import { plainModel } from "./creature-plan.test.js";
import { validateForm } from "./recipe.js";
import { skinCharacter } from "./skin.js";

const width = 900,
  height = 700;
function viewer(from = [2.1, 1.36, 4.25], target = [0, 0.6, 0]) {
  const frame = 2.65,
    aspect = width / height;
  const camera = new OrthographicCamera(
    (-frame * aspect) / 2,
    (frame * aspect) / 2,
    frame / 2,
    -frame / 2,
    0.05,
    50,
  );
  camera.position.set(...target).add(new Vector3(...from));
  camera.lookAt(...target);
  camera.updateMatrixWorld();
  const px = (point) => {
    const p = point.clone().project(camera);
    return [((1 + p.x) / 2) * width, ((1 - p.y) / 2) * height];
  };
  return { camera, px, view: viewOf(camera) };
}
const views = { "three-quarter": [2.1, 1.36, 4.25], side: [4.8, 0, 0], back: [0, 0, -4.8] };
const plans = Object.entries(creaturePresets).map(([name, raw]) => [
  name,
  readCreaturePlan(raw),
]);
const part = (form, id) => form.parts.find((p) => p.id === id);

test("every preset offers a thickness handle at five stations and one handle for each limb group", () => {
  for (const [name, plan] of plans)
    for (const from of Object.values(views)) {
      const { view } = viewer(from);
      const { frame, handles } = creatureHandles(plan, view);
      const girths = handles.filter((h) => h.kind === "girth"),
        limbs = handles.filter((h) => h.kind === "limb");
      assert.equal(girths.length, 5, name);
      assert.equal(limbs.length, plan.limbs.length, name);
      assert.equal(new Set(handles.map((h) => h.key)).size, handles.length);
      for (const h of girths) {
        const at = frame.at(h.station),
          away = h.point.clone().sub(at.centre);
        const across = away.x / at.radius[0],
          back = away.dot(at.dorsal) / at.radius[1];
        assert.ok(Math.abs(Math.hypot(across, back) - 1) < 1e-6, name);
        assert.ok(Math.abs(away.dot(at.tangent)) < 1e-9, name);
      }
      for (const h of limbs) {
        const limb = plan.limbs[h.index];
        assert.equal(h.station, limbCentre(limb));
        if (limb.side !== "both")
          assert.equal(h.side, limb.side === "left" ? 1 : -1, name);
        else if (Math.abs(view.forward.x) > 0.1)
          assert.equal(h.side, view.forward.x < 0 ? 1 : -1, name);
      }
    }
});

test("a thickness drag puts the outline of the trunk under the pointer", () => {
  let checked = 0;
  for (const [name, plan] of plans)
    for (const [angle, from] of Object.entries(views)) {
      const { px, view } = viewer(from);
      const { handles } = creatureHandles(plan, view);
      for (const h of handles.filter((x) => x.kind === "girth")) {
        const axis = girthAxis(h, px),
          spot = px(h.point),
          centre = px(h.centre);
        const reach = Math.hypot(spot[0] - centre[0], spot[1] - centre[1]);
        if (reach < 8) continue;
        for (const pull of [-0.35, 0.3, 0.8]) {
          const goal = [spot[0] + axis[0] * reach * pull, spot[1] + axis[1] * reach * pull];
          const next = pullGirth(plan, h, axis, goal, px);
          const value = next.spine.bulge[h.index];
          assert.deepEqual(
            next.spine.bulge.filter((_, i) => i !== h.index),
            plan.spine.bulge.filter((_, i) => i !== h.index),
          );
          assert.deepEqual({ ...next, spine: 0 }, { ...plan, spine: 0 });
          assert.equal(
            Math.sign(value - plan.spine.bulge[h.index]),
            Math.sign(pull),
            name + " " + angle + " station " + h.index,
          );
          if (value > girthRange[0] && value < girthRange[1]) {
            const now = px(
              girthPoint(spineFrame(next), h.station, h.direction).point,
            );
            const off =
              (now[0] - goal[0]) * axis[0] + (now[1] - goal[1]) * axis[1];
            assert.ok(
              Math.abs(off) < 1,
              name + " " + angle + " station " + h.index + " is " + off.toFixed(2) + " px off",
            );
            checked++;
          }
          assert.deepEqual(readCreaturePlan(next), next);
        }
      }
    }
  assert.ok(checked > 200, "only " + checked + " drags stayed in range");
});

test("a limb drag moves the whole group, both sides and every pair together", () => {
  for (const [name, plan] of plans) {
    const { px, view } = viewer(views.side);
    const { frame, handles } = creatureHandles(plan, view);
    for (const h of handles.filter((x) => x.kind === "limb")) {
      const limb = plan.limbs[h.index];
      const rail = limbRail(frame, limb.kind, h.side, px);
      assert.ok(lineLength(rail) > 24, name);
      const spot = px(h.point);
      assert.ok(Math.abs(nearestAlong(rail, spot) - h.station) < 0.01, name);
      for (const wanted of [0, 0.31, 0.5, 0.77, 1]) {
        const goal = px(limbRoot(frame, limb.kind, wanted, h.side));
        const next = moveLimbs(plan, h.index, nearestAlong(rail, goal));
        const moved = next.limbs[h.index];
        assert.ok(Math.abs(moved.to - moved.from - (limb.to - limb.from)) < 0.002, name);
        assert.ok(Math.min(moved.from, moved.to) >= 0 && Math.max(moved.from, moved.to) <= 1);
        const room = [
          limbCentre(limb) - Math.min(limb.from, limb.to),
          limbCentre(limb) + 1 - Math.max(limb.from, limb.to),
        ];
        const expected = Math.min(room[1], Math.max(room[0], wanted));
        assert.ok(
          Math.abs(limbCentre(moved) - expected) < 0.01,
          name + " group " + h.index + " went to " + limbCentre(moved) + " for " + expected,
        );
        assert.deepEqual(
          next.limbs.filter((_, i) => i !== h.index),
          plan.limbs.filter((_, i) => i !== h.index),
        );
        assert.deepEqual(readCreaturePlan(next), next);
        assert.equal(limbStations(moved).length, limb.pairs);
      }
    }
  }
});

test("moved limbs stay mirrored and keep their regions, joints and clips", () => {
  for (const [name, plan] of plans) {
    const before = buildCreature(plan);
    plan.limbs.forEach((limb, index) => {
      const next = moveLimbs(plan, index, limbCentre(limb) > 0.5 ? 0.3 : 0.7);
      if (JSON.stringify(next) === JSON.stringify(plan)) return;
      const after = validateForm(rebuildCreature(before, next));
      assert.deepEqual(
        after.parts.map((p) => p.id).sort(),
        before.parts.map((p) => p.id).sort(),
        name + ": a limb move changed the set of regions",
      );
      for (const left of after.parts.filter(
        (p) => p.id.startsWith("left ") && p.parent === "body" && p.shape === "sweep",
      )) {
        const right = part(after, left.id.replace("left ", "right "));
        if (!right || limb.side !== "both") continue;
        assert.ok(Math.abs(left.position[0] + right.position[0]) < 1e-9, name + " " + left.id);
        assert.ok(Math.abs(left.position[1] - right.position[1]) < 1e-9, name + " " + left.id);
        assert.ok(Math.abs(left.position[2] - right.position[2]) < 1e-9, name + " " + left.id);
      }
    });
  }
  const plan = readCreaturePlan(creaturePresets["Four-legged grazer"]);
  const edited = structuredClone(buildCreature(plan));
  part(edited, "tail").knots[1][3] *= 1.7;
  part(edited, "head").color = "#aa3344";
  edited.parts.push({
    id: "brow horn",
    shape: "cone",
    parent: "head",
    position: [0, 0.08, 0.02],
    size: [0.03, 0.12, 0.03],
    rotation: [0, 0, 0],
    frameSize: [1, 1, 1],
    color: "#f0e8d0",
  });
  edited.poses = [
    {
      name: "Bow",
      joints: [
        { part: "neck", station: 0, turn: [0.2588, 0, 0, 0.9659] },
        { part: "left leg 2 thigh", station: 0, turn: [0, 0, 0.1736, 0.9848] },
      ],
    },
  ];
  validateForm(edited);
  const rigOf = (form) => {
    const rig = skinCharacter(form, plainModel(form).group);
    return {
      clips: rig.clips.map((c) => c.name),
      joints: [...rig.bindings.keys()].sort(),
    };
  };
  const was = rigOf(edited);
  const { px, view } = viewer();
  const { frame, handles } = creatureHandles(plan, view);
  const legs = handles.find((h) => h.kind === "limb"),
    chest = handles.find((h) => h.key === "girth 3"),
    limb = plan.limbs[legs.index];
  const rail = limbRail(frame, limb.kind, legs.side, px);
  const slid = moveLimbs(plan, legs.index, nearestAlong(rail, px(frame.at(0.4).centre)));
  const axis = girthAxis(chest, px),
    spot = px(chest.point);
  const fat = pullGirth(slid, chest, axis, [spot[0] + axis[0] * 30, spot[1] + axis[1] * 30], px);
  assert.ok(fat.spine.bulge[3] > plan.spine.bulge[3]);
  let form = edited;
  for (const next of [slid, fat]) {
    form = validateForm(rebuildCreature(form, next));
    assert.deepEqual(form.origin.plan, next);
    assert.deepEqual(part(form, "tail"), part(edited, "tail"), "the sculpted tail changed");
    assert.equal(part(form, "head").color, "#aa3344");
    assert.ok(part(form, "brow horn"));
    assert.deepEqual(form.poses, edited.poses, "the saved pose changed");
    const now = rigOf(form);
    assert.deepEqual(now.clips, was.clips);
    assert.deepEqual(now.joints, was.joints);
    assert.ok(now.clips.some((c) => c.includes("Bow")));
  }
  assert.equal(girthStations.length, 5);
});
