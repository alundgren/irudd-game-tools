import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCreature,
  drawCreatureEquipment,
  freeCreaturePlan,
  randomCreaturePlan,
  rebuildCreature,
  steerCreaturePlan,
} from "./creature-plan.js";
import { equipmentRegionCount, readEquipment } from "./creature-equipment.js";
import { validateForm } from "./recipe.js";
import { applyOperations } from "./variations.js";

const worn = (p) => p.id.startsWith("gear ");
const gear = (f, id) => f.parts.find((p) => p.id === id);

test("ordinary equipped draws carry editable gear without removing or reshaping animal regions", () => {
  const kinds = new Set();
  for (let seed = 8700; seed < 8730; seed++) {
    const plan = randomCreaturePlan(seed);
    const dressed = validateForm(buildCreature(plan));
    const barePlan = structuredClone(plan);
    delete barePlan.equipment;
    const bare = buildCreature(barePlan);
    assert.deepEqual(
      dressed.parts.filter((p) => !worn(p)),
      bare.parts,
    );
    assert.equal(
      dressed.parts.filter(worn).length,
      equipmentRegionCount(plan.equipment),
    );
    assert.deepEqual(randomCreaturePlan(seed), plan);
    kinds.add(plan.equipment?.kind ?? "none");
    for (const p of dressed.parts.filter(worn)) {
      assert.equal(p.shape, "cage");
      assert.ok(dressed.parts.some((parent) => parent.id === p.parent));
    }
  }
  assert.deepEqual([...kinds].sort(), [
    "courier satchel",
    "none",
    "survey kit",
    "trader panniers",
  ]);
});

test("equipment operations keep artist edits on independent regions and allow removal", () => {
  const plan = steerCreaturePlan(freeCreaturePlan(8716), {
    equipment: { kind: "courier satchel", station: 0.4, seed: 10 },
  });
  const src = buildCreature(plan);
  gear(src, "gear flap").color = "#792651";
  const repacked = validateForm(
    applyOperations(src, [
      { op: "steerCreature", set: { equipment: { seed: 99 } } },
    ]),
  );
  assert.equal(gear(repacked, "gear flap").color, "#792651");
  assert.deepEqual(gear(src, "gear harness"), gear(repacked, "gear harness"));
  assert.notDeepEqual(
    gear(src, "gear dispatch tube"),
    gear(repacked, "gear dispatch tube"),
  );
  const moved = rebuildCreature(
    repacked,
    steerCreaturePlan(repacked.origin.plan, {
      equipment: { station: 0.73, side: "right" },
    }),
  );
  assert.notDeepEqual(
    gear(moved, "gear harness").position,
    gear(src, "gear harness").position,
  );
  assert.deepEqual(
    moved.parts.filter((p) => !worn(p)),
    src.parts.filter((p) => !worn(p)),
  );
  const bare = validateForm(
    applyOperations(moved, [{ op: "steerCreature", set: { equipment: null } }]),
  );
  assert.deepEqual(
    bare.parts,
    src.parts.filter((p) => !worn(p)),
  );
});

test("a crowded upright courier gets a full-size rear mount and a scoped draw considers only the original body", () => {
  const p = freeCreaturePlan(8804);
  assert.equal(p.equipment.mount, "back");
  assert.ok(p.equipment.size > 0.85);
  const bare = steerCreaturePlan(p, { equipment: null });
  assert.deepEqual(
    drawCreatureEquipment(p, 8804),
    drawCreatureEquipment(bare, 8804),
  );
  assert.deepEqual(
    readEquipment({
      kind: "invalid",
      size: -10,
      station: 99,
      hang: 42,
      side: "up",
      color: "bad",
    }),
    {
      kind: "none",
      station: 0.85,
      hang: 0.85,
      size: 0.55,
      side: "left",
      mount: "flank",
      color: "#ca884a",
      seed: 1,
    },
  );
});


test("a courier sling keeps both edges at the extreme shoulder station", () => {
  const plan=steerCreaturePlan(freeCreaturePlan(1117),{equipment:{kind:"courier satchel",station:.85}});
  validateForm(buildCreature(plan));
});
