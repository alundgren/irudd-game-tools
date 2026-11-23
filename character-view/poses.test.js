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
  applyJointPose,
  authoredClips,
  bindPoseJoints,
  captureJoints,
  validPoses,
} from "./poses.js";

function madeRig(reorder = false) {
  const actor = new Group(),
    root = new Bone(),
    upper = new Bone(),
    wrist = new Bone(),
    other = new Bone();
  actor.add(root);
  root.add(upper, other);
  upper.add(wrist);
  [root, upper, wrist, other].forEach(
    (b, i) => (b.name = "J" + (reorder ? 10 - i : i)),
  );
  upper.userData = { region: "working arm", station: 0 };
  wrist.userData = { region: "working arm", station: 1 };
  other.userData = { region: "idle arm", station: 0 };
  upper.position.set(0.15, 0.8, 0);
  wrist.position.set(0.35, -0.08, 0.02);
  other.position.set(-0.15, 0.8, 0);
  actor.updateMatrixWorld(true);
  const bones = reorder
    ? [root, other, upper, wrist]
    : [root, upper, wrist, other];
  return {
    actor,
    upper,
    wrist,
    other,
    bindings: bindPoseJoints(new Skeleton(bones)),
  };
}
test("captured stance replays on a renamed and reordered skeleton and survives clip playback", () => {
  const a = madeRig();
  a.upper.rotateZ(0.8);
  a.wrist.translateZ(0.04);
  const dormant = { part: "hidden cuff", station: 0, shift: [0.01, 0, 0] };
  const joints = captureJoints(a.bindings, [dormant]);
  assert.equal(joints.length, 3);
  assert.equal(joints[0], dormant);
  const b = madeRig(true),
    before = b.other.getWorldPosition(new Vector3());
  applyJointPose(b.bindings, joints);
  const expected = a.wrist.getWorldPosition(new Vector3());
  assert.ok(
    expected.distanceTo(b.wrist.getWorldPosition(new Vector3())) < 1e-6,
  );
  applyJointPose(b.bindings, []);
  const [clip] = authoredClips(b.bindings, [{ name: "Gesture", joints }]);
  const mixer = new AnimationMixer(b.actor);
  mixer.clipAction(clip).play();
  mixer.setTime(0.75);
  assert.ok(
    expected.distanceTo(b.wrist.getWorldPosition(new Vector3())) < 1e-6,
  );
  assert.ok(before.distanceTo(b.other.getWorldPosition(new Vector3())) < 1e-8);
  assert.equal(clip.name, "Pose · Gesture");
});
test("validates stored pose addresses, normalized rotations and unique names", () => {
  const joint = { part: "tail", station: 2, turn: new Quaternion().toArray() },
    pose = { name: "Look up", joints: [joint] };
  assert.ok(validPoses([pose]));
  for (const poses of [
    [pose, { ...pose, name: "look UP" }],
    [{ ...pose, joints: [joint, joint] }],
    [{ ...pose, joints: [{ ...joint, turn: [2, 0, 0, 0] }] }],
    [{ name: "", joints: [] }],
  ])
    assert.equal(validPoses(poses), false);
});
