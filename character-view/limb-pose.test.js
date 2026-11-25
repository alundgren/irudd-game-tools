import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import { buildCreature, creaturePresets } from "./creature-plan.js";
import { plainModel } from "./creature-plan.test.js";
import {
  carry,
  followers,
  plantFeet,
  poseLimbs,
  spread,
  tipReach,
} from "./limb-pose.js";
import { skinCharacter } from "./skin.js";

function rigged(name) {
  const plan = creaturePresets[name];
  const form = buildCreature({ ...plan, skin: { ...plan.skin, blend: false } });
  const rig = skinCharacter(form, plainModel(form).group);
  rig.actor.updateMatrixWorld(true);
  return { form, rig, limbs: poseLimbs(rig.regions, rig.bindings) };
}
const joint = (rig, part, station = 0) =>
  rig.bindings.get(JSON.stringify([part, station, ""]));
const tip = (limb) => limb.chain[2].getWorldPosition(new Vector3());
const before = (binding) => ({
  turn: binding.bone.quaternion.clone(),
  place: binding.bone.position.clone(),
});

test("limbs are found with their kind, side and mirror twin on every body plan", () => {
  const counts = {
    "Four-legged grazer": { leg: 4 },
    "Upright four-armed trader": { leg: 2, arm: 4 },
    "Six-legged crawler": { leg: 6 },
    "Radial many-legged walker": { leg: 10, arm: 2 },
    "Winged glider": { leg: 2, wing: 2 },
  };
  for (const [name, wanted] of Object.entries(counts)) {
    const { rig, limbs } = rigged(name);
    for (const [kind, count] of Object.entries(wanted)) {
      const kin = limbs.filter((l) => l.kind === kind);
      assert.equal(kin.length, count, name + " " + kind);
      for (const limb of kin) {
        assert.ok(limb.twin, name + " " + limb.id + " has no twin");
        assert.equal(limb.twin.twin, limb);
        assert.equal(limb.twin.side, -limb.side);
        // Every joint of a limb has a matching joint on its twin.
        assert.deepEqual(
          [...limb.joints.keys()].sort(),
          [...limb.twin.joints.keys()].sort(),
        );
        if (kind === "leg" || kind === "arm")
          assert.ok(limb.chain, name + " " + limb.id + " cannot be guided");
      }
    }
    rig.dispose();
  }
});

test("a turn on one leg is mirrored on its twin and carried around a radial body", () => {
  const { rig, limbs } = rigged("Radial many-legged walker");
  const hip = joint(rig, "left leg 2 thigh"),
    legs = limbs.filter((l) => l.kind === "leg");
  const rest = new Map(legs.map((l) => [l, tip(l)]));
  // Lift the selected leg about the axis across its own direction.
  const out = rest.get(hip.limb).clone().sub(hip.limb.hip).setY(0).normalize(),
    across = new Vector3(0, 1, 0).cross(out);
  const was = before(hip);
  hip.bone.quaternion.premultiply(
    new Quaternion().setFromAxisAngle(across, -0.3),
  );
  assert.equal(
    spread(rig.bindings, hip, was, followers(limbs, hip.limb, "pair")),
    1,
  );
  rig.actor.updateMatrixWorld(true);
  const mine = tip(hip.limb),
    twin = tip(hip.limb.twin);
  assert.ok(mine.y > rest.get(hip.limb).y + 0.03);
  assert.ok(
    twin.distanceTo(new Vector3(-mine.x, mine.y, mine.z)) < 1e-6,
    "the twin is not a mirror image",
  );
  const others = legs.filter((l) => l !== hip.limb && l !== hip.limb.twin);
  for (const leg of others)
    assert.ok(tip(leg).distanceTo(rest.get(leg)) < 1e-9, "a third leg moved");
  // The same change again for all ten legs: every foot rises alike and moves
  // out from the body alike, whichever way its leg points.
  const again = before(hip);
  hip.bone.quaternion.premultiply(
    new Quaternion().setFromAxisAngle(across, -0.2),
  );
  assert.equal(
    spread(rig.bindings, hip, again, followers(limbs, hip.limb, "kind")),
    9,
  );
  rig.actor.updateMatrixWorld(true);
  const rise = tip(hip.limb).y - mine.y;
  assert.ok(rise > 0.02);
  for (const leg of others) {
    const now = tip(leg),
      then = rest.get(leg);
    assert.ok(
      Math.abs(now.y - then.y - rise) < 0.35 * rise,
      leg.id + " rose " + (now.y - then.y) + " not " + rise,
    );
    const outward = (p) => Math.hypot(p.x - leg.hip.x, p.z - leg.hip.z);
    assert.ok(outward(now) > outward(then), leg.id + " did not swing out");
  }
  rig.dispose();
});

test("a guided limb tip reaches its goal, keeps its facing and reports a goal out of reach", () => {
  for (const [name, part] of [
    ["Four-legged grazer", "left leg 1 thigh"],
    ["Six-legged crawler", "right leg 2 thigh"],
    ["Upright four-armed trader", "left arm 2 upper"],
  ]) {
    const { rig } = rigged(name);
    const limb = joint(rig, part).limb,
      reach = tipReach(limb);
    assert.ok(reach, name);
    const facing = limb.chain[2].getWorldQuaternion(new Quaternion());
    const span =
      limb.chain[0]
        .getWorldPosition(new Vector3())
        .distanceTo(limb.chain[1].getWorldPosition(new Vector3())) +
      limb.chain[1]
        .getWorldPosition(new Vector3())
        .distanceTo(reach.initial);
    for (const offset of [
      [0, 0, 0],
      [0.03, 0.05, 0.08],
      [-0.04, 0.1, -0.1],
    ]) {
      const goal = reach.initial
        .clone()
        .add(new Vector3(...offset).multiplyScalar(span));
      assert.ok(reach.solve(goal) < 1e-9);
      rig.actor.updateMatrixWorld(true);
      assert.ok(tip(limb).distanceTo(goal) < 1e-6, name + " " + offset);
      assert.ok(
        limb.chain[2]
          .getWorldQuaternion(new Quaternion())
          .angleTo(facing) < 1e-6,
      );
    }
    const far = reach.initial.clone().add(new Vector3(0, -3, 0));
    assert.ok(reach.solve(far) > 1);
    rig.dispose();
  }
});

test("feet stay planted while the body sinks, leans and turns", () => {
  for (const name of [
    "Four-legged grazer",
    "Six-legged crawler",
    "Radial many-legged walker",
    "Two-legged runner",
  ]) {
    const { rig, limbs } = rigged(name);
    const legs = limbs.filter((l) => l.kind === "leg"),
      stood = legs.map(tip),
      feet = plantFeet(limbs);
    assert.equal(feet.count, legs.length);
    const root = joint(rig, "", 0).bone,
      size = Math.min(...legs.map((l) => l.hip.y));
    root.position.y -= 0.18 * size;
    root.position.z += 0.05 * size;
    root.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), 0.12);
    assert.ok(feet.hold() < 1e-9, name + " lost a foot");
    rig.actor.updateMatrixWorld(true);
    legs.forEach((leg, i) =>
      assert.ok(tip(leg).distanceTo(stood[i]) < 1e-6, name + " " + leg.id),
    );
    rig.dispose();
  }
});

test("a move is carried unchanged between limbs that hang straight down", () => {
  const { rig, limbs } = rigged("Four-legged grazer");
  const [front, hind] = ["left leg 2 thigh", "left leg 1 thigh"].map(
    (id) => joint(rig, id).limb,
  );
  assert.equal(front.bearing, null);
  const map = carry(front, hind),
    v = new Vector3(0.1, 0.2, 0.3);
  assert.ok(map.move(v).distanceTo(v) < 1e-12);
  assert.ok(
    carry(front, front.twin)
      .move(v)
      .distanceTo(new Vector3(-0.1, 0.2, 0.3)) < 1e-12,
  );
  rig.dispose();
});
