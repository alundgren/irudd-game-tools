import { billChart } from "./creature-bill.js";
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCreature,
  freeCreaturePlan,
  randomCreaturePlan,
  rebuildCreature,
  steerCreaturePlan,
} from "./creature-plan.js";
import { validateForm } from "./recipe.js";
import { checkCage } from "./control-cage.js";
import { beakCage, footCage } from "./creature-anatomy.js";

test("the six foot families build closed, editable soles at every digit count", () => {
  for (const end of ["paw", "hoof", "talons", "point", "pad", "paddle"])
    for (let digits = 0; digits <= 5; digits++) {
      const cage = footCage(end, "insect", digits, 3.5);
      checkCage(cage);
      const edges = new Map();
      for (const f of cage.faces)
        for (let i = 0; i < f.length; i++) {
          const a = f[i],
            b = f[(i + 1) % f.length],
            k = [Math.min(a, b), Math.max(a, b)].join("/");
          edges.set(k, (edges.get(k) ?? 0) + (a < b ? 1 : -1));
        }
      assert.ok(
        [...edges.values()].every((v) => v === 0),
        end + " " + digits,
      );
    }
  assert.deepEqual(
    footCage("talons", "bird", 0, 2),
    footCage("pad", "bird", 0, 2),
  );
  assert.notDeepEqual(
    footCage("paddle", "bird", 3, 2),
    footCage("paddle", "bird", 4, 2),
  );
});

test("the current anatomy uses ordinary local plan controls and preserves old saved plans", () => {
  const plan = freeCreaturePlan(8715);
  const form = validateForm(buildCreature(plan)),
    part = (f, id) => f.parts.find((p) => p.id === id);
  assert.equal(part(form, "head").shape, "cage");
  assert.equal(part(form, "lower beak").parent, "head");
  const open = validateForm(
    rebuildCreature(form, steerCreaturePlan(plan, { head: { jaw: 0.83 } })),
  );
  assert.notDeepEqual(
    part(open, "lower beak").cage,
    part(form, "lower beak").cage,
  );
  assert.deepEqual(part(open, "head"), part(form, "head"));
  const end = validateForm(
    rebuildCreature(
      form,
      steerCreaturePlan(plan, {
        setLimbs: [{ index: 0, end: "paddle", digits: 5 }],
      }),
    ),
  );
  assert.notDeepEqual(
    part(end, "left leg 1 toes").cage,
    part(form, "left leg 1 toes").cage,
  );
  assert.deepEqual(part(end, "head"), part(form, "head"));
  const old = structuredClone(plan);
  delete old.anatomyRevision;
  const legacy = validateForm(buildCreature(old));
  assert.equal(part(legacy, "head").shape, "ellipsoid");
  assert.deepEqual(rebuildCreature(legacy, legacy.origin.plan), legacy);
  assert.equal(
    part(buildCreature(steerCreaturePlan(old, { anatomyRevision: 2 })), "head")
      .shape,
    "cage",
  );
});

test("thin long ankles stay inside the editable cage coordinate range", () => {
  const form = buildCreature({
    anatomyRevision: 2,
    scale: 4,
    spine: { length: 0.6, girth: 0.04 },
    limbs: [{ kind: "leg", style: "insect", end: "point", girth: 0.3 }],
  });
  validateForm(form);
  const foot = form.parts.find((p) => p.id === "left leg 1 foot");
  assert.ok(foot.cage.vertices.every((v) => v.every((x) => Math.abs(x) <= 12)));
});

test("crowded drawn limbs gain distinct stations and wide paired paddles gain a stance", () => {
  const walker = freeCreaturePlan(8712),
    axial = freeCreaturePlan(8719),
    upright = freeCreaturePlan(8721),
    paddle = freeCreaturePlan(8730);
  const stationGap = ({ spine, limbs }) => {
    const l = limbs.find((l) => l.kind === "leg");
    return ((l.to - l.from) * spine.length) / (l.pairs - 1);
  };
  assert.ok(stationGap(walker) >= 2.3 * walker.spine.girth);
  assert.equal(axial.limbs[0].pairs, 5);
  assert.ok(axial.limbs[0].to - axial.limbs[0].from > 0.65);
  assert.ok(upright.spine.rear - upright.spine.front > 15);
  assert.equal(paddle.limbs[0].end, "paddle");
  assert.ok(paddle.limbs[0].splay >= 25);
  const override = steerCreaturePlan(axial, {
    spine: { rear: 85, front: 88 },
    setLimbs: [{ index: 0, from: 0, to: 0.12 }],
  });
  assert.deepEqual(buildCreature(override).origin.plan, override);
});

test("multiple heads spread from the neck even when its pitch is vertical", () => {
  const base = freeCreaturePlan(8715);
  const head = { count: 3, neck: .08, neckPitch: 90, shape: "round", eyes: 1, crest: "none" };
  const form = validateForm(buildCreature(steerCreaturePlan(base, { head })));
  for (let i = 2; i <= 3; i++) {
    const tip = name => {
      const neck = form.parts.find(p => p.id === "neck " + name);
      return neck.position[0] + neck.knots.at(-1)[0];
    };
    const size = form.parts.find(p => p.id === "head " + i).size[0];
    assert.ok(tip(i) - tip(i-1) > size*.85);
  }
});

test("each side of a bill reads the same keratin chart from root to tip", () => {
  for (const lower of [true,false]) {
    const sides = lower ? 8 : 10;
    const part = {id: lower ? "lower beak 2" : "beak 2",shape:"cage",
      cage:{vertices:Array.from({length:7*sides+2},()=>[0,0,0])}};
    const chart = billChart(part,{snout:"bill",nostrils:true});
    assert.equal(chart.uv.length,part.cage.vertices.length);
    assert.equal(chart.nostrils,!lower);
    assert.deepEqual(chart.uv[1],chart.uv[sides-1]);
    assert.ok(chart.uv[0][0] < chart.uv[6*sides][0]);
    assert.equal(billChart({...part,id:"head 2"},{snout:"bill"}),null);
  }
});

test("feeding bills keep closed upper and lower sheaths with distinct working ends", () => {
  const shape = (profile, lower = false) => beakCage(false, lower, .3, .24, .7, .16, profile);
  const width = (cage, ring) => Math.max(...cage.vertices.slice(ring*10, (ring+1)*10).map(v => v[0]));
  for (const profile of ["spear","crusher","spoon","scythe","shear"]) {
    for (const lower of [false,true]) checkCage(shape(profile, lower));
  }
  assert.ok(width(shape("spoon"), 5) > 2 * width(shape("spoon"), 3));
  assert.ok(width(shape("spear"), 5) < .4 * width(shape("spear"), 3));
  const tip = profile => shape(profile).vertices.at(-1);
  assert.ok(tip("spear")[2] > 1.8 * tip("crusher")[2]);
  assert.ok(tip("scythe")[1] < tip("spear")[1] - .1);
  assert.deepEqual(shape("original"), shape(undefined));
});

test("a long trunk clears the ground without losing its reach on a short-legged grazer", () => {
  const plan = randomCreaturePlan(927747);
  const low = buildCreature(plan);
  const high = buildCreature({ ...plan, spine: { ...plan.spine, stance: 1.8 } });
  const trunk = form => form.parts.find(part => part.id === "trunk");
  const length = part => part.knots.slice(1).reduce((sum, knot, i) =>
    sum + Math.hypot(...knot.slice(0, 3).map((value, j) => value - part.knots[i][j])), 0);
  let height = 0;
  for (let p = trunk(low); p; p = low.parts.find(q => q.id === p.parent)) height += p.position[1];
  for (const knot of trunk(low).knots) assert.ok(height + knot[1] - knot[4] >= .01 * plan.scale);
  assert.ok(Math.abs(length(trunk(high)) - length(trunk(low))) < .0001);
});
