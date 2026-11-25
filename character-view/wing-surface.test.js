import test from "node:test";
import assert from "node:assert/strict";
import { AnimationMixer, Box3, Vector3 } from "three";
import {
  buildCreature,
  creaturePresets,
  randomCreaturePlan,
  readCreaturePlan,
  rebuildCreature,
  steerCreaturePlan,
} from "./creature-plan.js";
import { plainModel } from "./creature-plan.test.js";
import { validateForm } from "./recipe.js";
import { skinCharacter } from "./skin.js";
import {
  validWing,
  wingArmKnots,
  wingCounts,
  wingGeometry,
  wingPatterns,
  wingStructures,
} from "./wing-surface.js";

const built = wingStructures.filter((s) => s !== "plain");
const glider = creaturePresets["Winged glider"];
const withWings = (plan, change) => ({
  ...plan,
  limbs: plan.limbs.map((l) => (l.kind === "wing" ? { ...l, ...change } : l)),
});
const surfaces = (form) => form.parts.filter((p) => p.shape === "wing");

test("a body plan saved before wings had a structure builds the wing it had", () => {
  const old = {
    ...glider,
    limbs: glider.limbs.map((l) => {
      if (l.kind !== "wing") return l;
      const { structure, ribs, bend, notch, point, pattern, seed, ...rest } = l;
      return rest;
    }),
  };
  const read = readCreaturePlan(old).limbs.find((l) => l.kind === "wing");
  assert.equal(read.structure, "plain");
  for (const key of ["ribs", "bend", "notch", "point", "pattern", "seed"])
    assert.ok(!(key in read), key);
  const form = buildCreature(old);
  assert.equal(surfaces(form).length, 0);
  // The two sweeps of a plain wing: a spar and its membrane.
  for (const id of ["left wing 1", "left wing 1 membrane", "right wing 1", "right wing 1 membrane"]) {
    const part = form.parts.find((p) => p.id === id);
    assert.equal(part?.shape, "sweep", id);
    assert.equal(part.motionRole, "wing", id);
  }
  assert.deepEqual(buildCreature(withWings(glider, { structure: "plain" })).parts, form.parts);
  // An edit that leaves the wing alone keeps it plain.
  const taller = rebuildCreature(form, { ...form.origin.plan, scale: 1.2 });
  assert.equal(surfaces(taller).length, 0);
});

test("each wing structure builds a valid, mirrored, repeatable surface on its arm", () => {
  for (const structure of built) {
    const plan = withWings(glider, { structure, ribs: undefined, pattern: "bars" });
    const form = buildCreature(plan);
    validateForm(form);
    assert.deepEqual(buildCreature(plan), form, structure);
    const [left, right] = ["left", "right"].map((side) =>
      surfaces(form).find((p) => p.id.startsWith(side)),
    );
    assert.ok(left && right, structure);
    assert.equal(surfaces(form).length, 2);
    for (const part of [left, right]) {
      const arm = form.parts.find((p) => p.id === part.parent);
      assert.equal(arm.shape, "sweep");
      assert.equal(arm.motionRole, "wing");
      assert.equal(part.motionRole, "rigid");
      assert.ok(validWing(part.wing));
      // The arm of the body plan is the arm the surface is built on.
      const knots = wingArmKnots(part.wing);
      assert.equal(arm.knots.length, knots.length);
    }
    const [a, b] = [left, right].map((part) => wingGeometry(part.wing, part.color));
    for (const g of [a, b]) {
      for (const name of ["position", "normal", "uv", "color"]) {
        const array = g.attributes[name].array;
        assert.ok(array.every(Number.isFinite), structure + " " + name);
      }
      assert.ok(g.index.count / 3 > 1500 && g.index.count / 3 < 40000, structure + " " + g.index.count / 3);
      const count = g.attributes.position.count;
      for (let i = 0; i < g.index.count; i++) assert.ok(g.index.getX(i) < count);
      assert.ok(g.attributes.color.array.every((v) => v >= 0 && v <= 1.0001));
    }
    // The right wing is the left wing in a mirror, and still faces outward.
    assert.equal(a.attributes.position.count, b.attributes.position.count);
    const pa = a.attributes.position,
      pb = b.attributes.position;
    for (let i = 0; i < pa.count; i += 37) {
      assert.ok(Math.abs(pa.getX(i) + pb.getX(i)) < 1e-6, structure);
      assert.ok(Math.abs(pa.getY(i) - pb.getY(i)) < 1e-6, structure);
      assert.ok(Math.abs(pa.getZ(i) - pb.getZ(i)) < 1e-6, structure);
    }
    const up = (g) => {
      let lift = 0;
      const n = g.attributes.normal;
      for (let i = 0; i < n.count; i++) lift += n.getY(i);
      return lift / n.count;
    };
    assert.ok(Math.abs(up(a) - up(b)) < 1e-4, structure + " " + up(a) + " " + up(b));
    // Another seed is another individual with the same anatomy.
    const other = wingGeometry({ ...left.wing, seed: left.wing.seed + 1 }, left.color);
    assert.notDeepEqual(
      [other.attributes.position.count, ...other.attributes.position.array.slice(0, 60000)],
      [a.attributes.position.count, ...a.attributes.position.array.slice(0, 60000)],
      structure,
    );
    const again = wingGeometry(left.wing, left.color);
    assert.deepEqual(again.attributes.position.array, a.attributes.position.array);
    assert.deepEqual(again.attributes.color.array, a.attributes.color.array);
  }
});

test("reduced feather geometry keeps the span and chord", () => {
  const [part] = surfaces(buildCreature(withWings(glider, { structure: "feather", ribs: 9 })));
  const full = wingGeometry(part.wing, part.color);
  const reduced = wingGeometry(part.wing, part.color, { game: true });
  assert.ok(reduced.index.count < full.index.count * .55);
  for (const geometry of [full, reduced]) geometry.computeBoundingBox();
  assert.ok(full.boundingBox.min.distanceTo(reduced.boundingBox.min) < .025);
  assert.ok(full.boundingBox.max.distanceTo(reduced.boundingBox.max) < .025);
  assert.ok(reduced.attributes.normal.array.every(Number.isFinite));
});

test("fingers, feathers and veins are counted, bounded and steerable", () => {
  for (const structure of built) {
    const [least, most] = wingCounts[structure];
    const sizes = [least, most].map((ribs) => {
      const form = buildCreature(withWings(glider, { structure, ribs }));
      const part = surfaces(form)[0];
      assert.equal(part.wing.count, ribs);
      return wingGeometry(part.wing, part.color).index.count;
    });
    assert.ok(sizes[1] > sizes[0] * 1.15, structure + " " + sizes);
    const read = (ribs) =>
      readCreaturePlan(withWings(glider, { structure, ribs })).limbs.find((l) => l.kind === "wing").ribs;
    assert.equal(read(99), most);
    assert.equal(read(0), least);
    // Every control at both ends of its range still builds.
    for (const pattern of wingPatterns)
      for (const edge of [0, 1]) {
        const form = buildCreature(
          withWings(glider, { structure, pattern, bend: edge, notch: edge, point: edge, ribs: edge ? most : least }),
        );
        validateForm(form);
        for (const part of surfaces(form)) {
          const g = wingGeometry(part.wing, part.color);
          assert.ok(g.attributes.position.array.every(Number.isFinite), structure + " " + pattern + " " + edge);
        }
      }
  }
  const part = surfaces(buildCreature(glider))[0];
  for (const wrong of [
    { structure: "plain" },
    { structure: "leaf" },
    { count: 99 },
    { side: 0 },
    { span: [0, 0, 0] },
    { bone: -1 },
    { pattern: "plaid" },
    { dark: "red" },
    { seed: -1 },
  ])
    assert.ok(!validWing({ ...part.wing, ...wrong }), JSON.stringify(wrong));
  const form = buildCreature(glider);
  const broken = structuredClone(form);
  surfaces(broken)[0].wing.count = 99;
  assert.throws(() => validateForm(broken), /wing/i);
  const stray = structuredClone(form);
  stray.parts.find((p) => p.id === "body").wing = part.wing;
  assert.throws(() => validateForm(stray), /wing/i);
});

test("an assistant chooses and steers a wing structure through the body plan", () => {
  const index = glider.limbs.findIndex((l) => l.kind === "wing");
  let plan = steerCreaturePlan(glider, {
    setLimbs: [{ index, structure: "bat", bend: 0.7, notch: 0.9, pattern: "eyespot", seed: 44 }],
  });
  let wing = plan.limbs[index];
  // The feathers of the old wing are not the fingers of the new one.
  assert.equal(wing.structure, "bat");
  assert.equal(wing.ribs, 4);
  assert.equal(wing.bend, 0.7);
  assert.equal(wing.pattern, "eyespot");
  assert.equal(wing.seed, 44);
  plan = steerCreaturePlan(plan, { setLimbs: [{ index, ribs: 5 }] });
  assert.equal(plan.limbs[index].ribs, 5);
  assert.equal(plan.limbs[index].structure, "bat");
  const form = buildCreature(plan);
  validateForm(form);
  assert.equal(surfaces(form)[0].wing.count, 5);
  // A rebuild swaps the surface and keeps what was made by hand elsewhere.
  const before = buildCreature(glider);
  before.parts.find((p) => p.id === "body").color = "#123456";
  const after = rebuildCreature(before, plan);
  assert.equal(after.parts.find((p) => p.id === "body").color, "#123456");
  assert.equal(surfaces(after)[0].wing.structure, "bat");
  assert.ok(!after.parts.some((p) => p.id.endsWith(" feathers")));
  // Wings added to a body that had none.
  const crawler = steerCreaturePlan(creaturePresets["Six-legged crawler"], {
    addLimbs: [{ kind: "wing", from: 0.6, length: 0.9, chord: 0.3, structure: "insect", ribs: 6 }],
  });
  const flying = buildCreature(crawler);
  validateForm(flying);
  assert.equal(surfaces(flying).length, 2);
  assert.equal(surfaces(flying)[0].wing.structure, "insect");
});

test("drawn body plans give their wings a structure from their own seed", () => {
  const seen = new Set();
  let winged = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const plan = randomCreaturePlan(seed);
    const wing = plan.limbs.find((l) => l.kind === "wing");
    if (!wing) continue;
    winged++;
    assert.ok(built.includes(wing.structure), seed + " " + wing.structure);
    seen.add(wing.structure);
    assert.deepEqual(randomCreaturePlan(seed), plan);
    if (winged <= 25) validateForm(buildCreature(plan));
  }
  assert.ok(winged > 40, String(winged));
  assert.deepEqual([...seen].sort(), [...built].sort());
});

test("the surface of a wing is skinned to its arm and flies with it above the floor", () => {
  for (const structure of built) {
    const form = buildCreature(withWings(glider, { structure }));
    const { group, nodes } = plainModel(form);
    const rig = skinCharacter(form, group);
    try {
      const bones = rig.skeleton.bones,
        armRegion = rig.regions.get("left wing 1");
      const armBones = new Set(armRegion.bones.map((bone) => bones.indexOf(bone)));
      assert.ok(armBones.size >= 3 && !armBones.has(-1), structure + " arm bones " + armBones.size);
      const names = form.parts.map((p) => p.id),
        mine = names.indexOf(surfaces(form).find((p) => p.id.startsWith("left")).id),
        armPart = names.indexOf("left wing 1");
      // Every vertex of the surface hangs from the joints of its own arm.
      const tips = [];
      let checked = 0;
      rig.actor.traverse((mesh) => {
        if (!mesh.isSkinnedMesh) return;
        const { skinIndex, skinWeight, position, _region } = mesh.geometry.attributes;
        const far = new Map();
        for (let i = 0; i < position.count; i++) {
          const region = _region.getX(i);
          if (region !== mine && region !== armPart) continue;
          if (!far.has(region) || position.getX(i) > position.getX(far.get(region))) far.set(region, i);
          if (region !== mine) continue;
          checked++;
          let total = 0;
          for (let k = 0; k < 4; k++) {
            const weight = skinWeight.getComponent(i, k);
            total += weight;
            if (weight > 1e-4)
              assert.ok(armBones.has(skinIndex.getComponent(i, k)), structure + " vertex " + i);
          }
          assert.ok(Math.abs(total - 1) < 1e-3, structure + " weight " + total);
        }
        const v = new Vector3();
        for (const region of [mine, armPart])
          if (far.has(region))
            tips[region === mine ? 0 : 1] = () =>
              mesh.getVertexPosition(far.get(region), v).applyMatrix4(mesh.matrixWorld).clone();
      });
      assert.ok(checked > 1500, structure + " " + checked);
      assert.ok(tips[0] && tips[1], structure);
      const fly = rig.clips.find((clip) => clip.name === "Fly");
      assert.ok(fly, structure);
      const mixer = new AnimationMixer(rig.actor);
      mixer.clipAction(fly).play();
      const box = new Box3();
      let low = Infinity,
        high = -Infinity,
        apart = [Infinity, -Infinity];
      for (let frame = 0; frame <= 40; frame++) {
        mixer.setTime((frame / 40) * fly.duration);
        rig.actor.updateMatrixWorld(true);
        box.setFromObject(rig.actor, true);
        assert.ok(box.min.y > 0, structure + " floor at frame " + frame + ": " + box.min.y);
        const [a, b] = tips.map((tip) => tip());
        low = Math.min(low, a.y);
        high = Math.max(high, a.y);
        const gap = a.distanceTo(b);
        apart = [Math.min(apart[0], gap), Math.max(apart[1], gap)];
      }
      const span = glider.limbs.find((l) => l.kind === "wing").length;
      assert.ok(high - low > 0.3 * span, structure + " stroke " + (high - low));
      assert.ok(apart[1] - apart[0] < 0.04 * span, structure + " tip drift " + apart);
      assert.ok(nodes.size === form.parts.length);
    } finally {
      rig.dispose();
    }
  }
});
