import assert from "node:assert/strict";
import test from "node:test";
import { buildCreature, freeCreaturePlan } from "./creature-plan.js";
import { applyOperations } from "./variations.js";
import { dispatchHand, hasDispatchAction } from "./dispatch-pose.js";
import { validateForm } from "./recipe.js";

const steer = (form, equipment) =>
  validateForm(
    applyOperations(form, [{ op: "steerCreature", set: { equipment } }]),
  );
const tube = (form) => form.parts.find((p) => p.id === "gear dispatch tube");
const kit = { kind: "courier satchel", handling: "offer" };
test("a digitally opposed courier offers its own tube, keeps artist work and packs it again", () => {
  const packed = buildCreature(freeCreaturePlan(8716));
  const body = packed.parts.find((p) => p.id === "body");
  body.color = "#764336";
  packed.poses = [
    {
      name: "Look back",
      joints: [{ part: "body", station: 0, turn: [0, 0, 0, 1] }],
    },
  ];
  const offered = steer(packed, kit);
  const hand = dispatchHand(offered);
  assert.equal(tube(offered).parent, hand.id);
  assert.equal(hand.grip.cylindrical, true);
  assert.equal(
    offered.parts.filter((p) => p.id === tube(offered).id).length,
    1,
  );
  assert.equal(
    offered.parts.find((p) => p.id === "gear dispatch seal").parent,
    "gear tube fittings",
  );
  assert.ok(hasDispatchAction(offered));
  assert.equal(
    offered.poses.find((p) => p.name === "Present dispatch").joints.length,
    3,
  );
  assert.equal(tube(packed).parent, "gear bag");
  const again = steer(offered, { handling: "packed" });
  assert.deepEqual(again.parts, packed.parts);
  assert.deepEqual(again.poses, packed.poses);
  assert.equal(
    again.parts.some((p) => p.id === "gear dispatch handle"),
    false,
  );
});
test("a hand-edited presentation persists across repacking content and the same pose plays in another body", () => {
  const made = steer(buildCreature(freeCreaturePlan(8965)), kit);
  const pose = made.poses.find((p) => p.name === "Present dispatch");
  pose.joints[0].turn = [0, 0.6, 0, 0.8];
  const revised = steer(made, { seed: 999 });
  assert.deepEqual(revised.poses, made.poses);
  assert.equal(tube(revised).parent, "right arm 1 hand");
  const transferred = steer(buildCreature(freeCreaturePlan(8994)), kit);
  assert.equal(tube(transferred).parent, "left arm 1 hand");
  assert.ok(hasDispatchAction(transferred));
  assert.deepEqual(buildCreature(transferred.origin.plan), transferred);
});
test("a pincer or an animal without digits keeps the sealed dispatch in its pack", () => {
  for (const s of [8715, 8804, 8822]) {
    const animal = steer(buildCreature(freeCreaturePlan(s)), kit);
    assert.equal(tube(animal).parent, "gear bag");
    assert.equal(animal.origin.plan.equipment.handling, undefined);
    assert.ok(!hasDispatchAction(animal));
    assert.deepEqual(buildCreature(animal.origin.plan), animal);
  }
});

test("removing the preferred hand uses the remaining grip, and removing both stows the tube", () => {
  const source = buildCreature(freeCreaturePlan(8716));
  source.parts = source.parts.filter((p) => p.id !== "left arm 1 hand");
  const other = steer(source, kit);
  assert.equal(tube(other).parent, "right arm 1 hand");
  const noHands = {
    ...source,
    parts: source.parts.filter((p) => p.id !== "right arm 1 hand"),
  };
  const packed = steer(noHands, kit);
  assert.equal(tube(packed).parent, "gear bag");
  assert.ok(!hasDispatchAction(packed));
});
