import assert from "node:assert/strict";
import { test } from "node:test";
import { creatureSlots } from "../src/creature/body.js";
import { randomCreature } from "../src/creature/draw.js";
import { buildCreature } from "../src/creature/plan/plan.js";

test("creature limbs, tail and neck carry the browser form's own knots", () => {
  let checked = 0;
  for (const seed of [3, 17, 33, 41]) {
    const plan = randomCreature(seed);
    const form = buildCreature(plan);
    const slots = new Map(creatureSlots(plan).map((s) => [s.label, s]));
    for (const part of form.parts) {
      if (part.shape !== "sweep" || !/(thigh|shin|upper|forearm|^tail|^neck)/.test(part.id))
        continue;
      const sweep: unknown = Reflect.get(
        Object(slots.get(part.id)?.features ?? {}),
        "figure.sweep",
      );
      assert.deepEqual(Reflect.get(Object(sweep), "knots"), part.knots, part.id);
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
  assert.ok(names.some((n) => /^neck(-\d+)?$/.test(n)));
  assert.ok(names.length > 4, names.join(", "));
});
