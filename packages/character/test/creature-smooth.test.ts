import assert from "node:assert/strict";
import { test } from "node:test";
import type { Knot } from "@irudd/document";
import { resampleKnots } from "../src/creature/knots.js";
import { sweepRings } from "../src/surfaces/sweep.js";
import { creatureSlots } from "../src/creature/body.js";
import { randomCreature } from "../src/creature/draw.js";

const limb: Knot[] = [
  [0, 0, 0, 0.05, 0.05],
  [0.03, -0.12, 0.04, 0.07, 0.06],
  [0.05, -0.3, 0.02, 0.03, 0.035],
];

test("resampled creature knots follow the sweep's own curve and radius", () => {
  const dense = resampleKnots(limb, 11);
  assert.equal(dense.length, 11);
  const rings = sweepRings(limb);
  assert.equal(rings.length, 11);
  for (let j = 0; j < dense.length; j++) {
    const ring = rings[j];
    const knot = dense[j];
    assert.ok(ring && knot);
    assert.ok(ring.center.distanceTo({ x: knot[0], y: knot[1], z: knot[2] }) < 1e-9);
    assert.ok(Math.abs(ring.w - knot[3]) < 1e-9);
    assert.ok(Math.abs(ring.d - knot[4]) < 1e-9);
  }
  assert.deepEqual(resampleKnots(limb, 3), limb);
});

test("creature limbs, tail and neck carry as many rings as the browser's organic parts", () => {
  let checked = 0;
  for (const seed of [3, 17, 33, 41]) {
    const plan = randomCreature(seed);
    const slots = creatureSlots(plan);
    const organic = slots.filter((s) =>
      /^((leg|arm)\.\d+\.\d+\.[lr](\.shin)?|tail|head\.\d+\.neck)$/.test(s.slot),
    );
    for (const slot of organic) {
      const sweep: unknown = Reflect.get(Object(slot.features ?? {}), "figure.sweep");
      const knots: unknown = Reflect.get(Object(sweep), "knots");
      if (!Array.isArray(knots)) continue;
      assert.ok(knots.length >= 7, slot.slot + " has " + knots.length + " knots");
      checked++;
    }
  }
  assert.ok(checked >= 8, "checked " + checked + " organic sweeps");
});

test("a blended creature plan joins its trunk, limbs, tail and head", () => {
  const plan = randomCreature(5);
  const blended = creatureSlots({ ...plan, skin: { ...plan.skin, blend: true } });
  const plain = creatureSlots({ ...plan, skin: { ...plan.skin, blend: false } });
  const joined = (slots: typeof plain) =>
    slots.filter((s) => Reflect.get(Object(s.features ?? {}), "creature.blend")).map((s) => s.slot);
  assert.deepEqual(joined(plain), []);
  const names = joined(blended);
  assert.ok(names.includes("body"));
  assert.ok(names.some((n) => n.endsWith(".neck")));
  assert.ok(names.length > 4, names.join(", "));
});
