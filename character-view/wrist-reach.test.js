import test from "node:test";
import assert from "node:assert/strict";
import {
  AnimationMixer,
  Bone,
  Group,
  Quaternion,
  Skeleton,
  Vector3,
} from "three";
import {
  bindPoseJoints,
  captureJoints,
  authoredClips,
  applyJointPose,
} from "./poses.js";
import { wristReach } from "./wrist-reach.js";

function fourArms(straight = false) {
  const actor = new Group(),
    spine = new Bone(),
    bones = [spine],
    parts = [];
  actor.add(spine);
  spine.position.set(0.12, 0.83, 0.2);
  spine.rotation.set(0.35, -0.22, 0.17);
  for (let i = 0; i < 4; i++) {
    const upper = new Bone(),
      lower = new Bone(),
      wrist = new Bone();
    spine.add(upper);
    upper.add(lower);
    lower.add(wrist);
    upper.position.set(i % 2 ? -0.17 : 0.17, i < 2 ? 0.52 : 0.29, 0);
    lower.position.set(0, -0.25, 0);
    wrist.position.set(0, -0.2, straight ? 0 : 0.085);
    for (const [part, role, parent] of [
      [upper, "upper arm", spine],
      [lower, "forearm", upper],
      [wrist, "hand", lower],
    ]) {
      part.name = role + i;
      part.userData = { region: part.name, station: 0 };
      parts.push({ id: part.name, motionRole: role, parent: parent.name });
      bones.push(part);
    }
  }
  actor.updateMatrixWorld(true);
  return { actor, parts, bones, bindings: bindPoseJoints(new Skeleton(bones)) };
}
const at = (b) => b.getWorldPosition(new Vector3());
test("aiming a wrist turns a bent, rotated chain, preserves the jar orientation and all three sibling wrists, and bakes a replayable pose", () => {
  const { actor, parts, bones, bindings } = fourArms();
  const [a, b, c] = bones.slice(1, 4),
    siblings = bones.filter((b) => b.name.startsWith("hand") && b !== c);
  const rest = siblings.map(at),
    lengths = [at(a).distanceTo(at(b)), at(b).distanceTo(at(c))];
  const facing = c.getWorldQuaternion(new Quaternion());
  const target = at(a).add(new Vector3(0.09, -0.16, 0.18));
  const solver = wristReach(parts, bindings, c.name);
  assert.ok(solver.solve(target, 42) < 1e-8);
  assert.ok(Math.abs(at(a).distanceTo(at(b)) - lengths[0]) < 1e-8);
  assert.ok(Math.abs(at(b).distanceTo(at(c)) - lengths[1]) < 1e-8);
  assert.ok(facing.angleTo(c.getWorldQuaternion(new Quaternion())) < 1e-7);
  const pose = { name: "Offer", joints: captureJoints(bindings) };
  assert.ok(
    pose.joints.every(
      (j) => [a.name, b.name, c.name].includes(j.part) && !j.shift,
    ),
  );
  const [clip] = authoredClips(bindings, [pose]);
  applyJointPose(bindings, []);
  const mixer = new AnimationMixer(actor);
  mixer.clipAction(clip).play();
  mixer.setTime(0.5);
  assert.ok(at(c).distanceTo(target) < 1e-6);
  siblings.forEach((b, i) => assert.ok(at(b).distanceTo(rest[i]) < 1e-9));
});
test("an unreachable goal stops at arm length and a near-shoulder goal on a straight arm remains finite", () => {
  const { parts, bones, bindings } = fourArms(true),
    [a, b, c] = bones.slice(1, 4);
  const solver = wristReach(parts, bindings, b.name),
    target = at(a).add(new Vector3(0, 0, 2));
  assert.ok(Math.abs(solver.solve(target) - 1.55) < 1e-5);
  assert.ok(Math.abs(solver.solve(at(a)) - 0.05) < 1e-5);
  assert.ok(
    [a, b, c].every((j) => j.quaternion.toArray().every(Number.isFinite)),
  );
  assert.equal(wristReach(parts, bindings, "missing"), null);
});

test("a crowded elbow can take another path to the same wrist target", () => {
  const { parts, bones, bindings } = fourArms();
  const [a, b, c] = bones.slice(1, 4),
    neighbour = bones[7];
  const target = at(a).add(new Vector3(0.08, -0.19, 0.19));
  const trial = wristReach(parts, bindings, c.name);
  trial.solve(target);
  const obstructed = at(b);
  applyJointPose(bindings, []);
  neighbour.position.copy(neighbour.parent.worldToLocal(obstructed.clone()));
  const guided = wristReach(parts, bindings, c.name);
  assert.ok(guided.solve(target, 0, "clear") < 1e-7);
  assert.ok(at(b).distanceTo(obstructed) > 0.025);
  const first = at(b);
  guided.solve(target, 0, "clear");
  assert.ok(at(b).distanceTo(first) < 1e-7);
});
