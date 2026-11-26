import {
  AnimationClip,
  Bone,
  Euler,
  Matrix4,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
} from "three";
import { tipReach } from "./limb-pose.js";
import { gripCentre, gripRadius, palmDimensions } from "./cylindrical-grip.js";

export const dispatchPoseName = "Present dispatch";
const radians = Math.PI / 180;
export function dispatchHand(form, side = "left", unavailable) {
  const hands = form.parts.filter(
    (p) =>
      !unavailable?.has(p.id) &&
      p.shape === "hand" &&
      p.motionRole === "hand" &&
      p.grip?.fingers >= 2 &&
      /^(left|right) arm /.test(p.id),
  );
  return hands.find((p) => p.id.startsWith(side + " ")) ?? hands[0];
}
function restFrames(parts) {
  const by = new Map(parts.map((p) => [p.id, p])),
    cache = new Map();
  const get = (id) => {
    if (cache.has(id)) return cache.get(id);
    const p = by.get(id),
      parent = p.parent ? get(p.parent) : null;
    const at = new Vector3(...p.position),
      q = new Quaternion().setFromEuler(
        new Euler(...p.rotation.map((d) => d * radians)),
      );
    if (parent) {
      at.applyQuaternion(parent.q).add(parent.at);
      q.premultiply(parent.q);
    }
    const frame = { at, q };
    cache.set(id, frame);
    return frame;
  };
  return get;
}
function orientation(axis, normal) {
  const z = new Vector3().crossVectors(axis, normal).normalize();
  return new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(axis, z.clone().cross(axis), z),
  );
}
export function handHandle(hand) {
  const scale = hand.size.map((n, i) => n / palmDimensions[i]);
  return {
    centre: new Vector3(...gripCentre.map((n, i) => n * scale[i])),
    radius: gripRadius * 0.5 * (scale[1] + scale[2]),
    length: hand.size[0] * 1.48,
  };
}

export function placeInHand(form, hand, tube, sourceGrip, axis, radial) {
  const fingers = handHandle(hand),
    source = orientation(axis, radial),
    side = hand.id.startsWith("left") ? 1 : -1;
  const target = orientation(new Vector3(side, 0, 0), new Vector3(0, 0, -1));
  const rot = target.multiply(source.invert());
  const frames = restFrames(form.parts),
    tubeOrigin = frames(tube.id).at;
  tube.parent = hand.id;
  tube.position = tubeOrigin
    .sub(sourceGrip)
    .applyQuaternion(rot)
    .add(fingers.centre)
    .toArray();
  tube.rotation = new Euler()
    .setFromQuaternion(rot)
    .toArray()
    .slice(0, 3)
    .map((d) => d / radians);
  hand.grip = { ...hand.grip, cylindrical: true, spread: 0 };
  const carry = dispatchArmPose(form, hand, false);
  if (carry) bindCarry(form, carry);
  const pose = dispatchArmPose(
    form,
    form.parts.find((p) => p.id === hand.id),
    true,
  );
  if (pose)
    form.poses = [
      ...(form.poses ?? []).filter((p) => p.name !== dispatchPoseName),
      pose,
    ];
}
function dispatchArmPose(form, hand, present) {
  const fore = form.parts.find((p) => p.id === hand.parent),
    upper = form.parts.find((p) => p.id === fore?.parent);
  if (!fore || !upper) return null;
  const frames = restFrames(form.parts),
    shoulder = frames(upper.id).at,
    elbow = frames(fore.id).at,
    wrist = frames(hand.id);
  const carrier = new Bone(),
    a = new Bone(),
    b = new Bone(),
    c = new Bone();
  carrier.add(a);
  a.add(b);
  b.add(c);
  a.position.copy(shoulder);
  b.position.subVectors(elbow, shoulder);
  c.position.subVectors(wrist.at, elbow);
  carrier.updateMatrixWorld(true);
  const solve = tipReach({ chain: [a, b, c], kind: "arm" });
  if (!solve) return null;
  const side = hand.id.startsWith("left") ? 1 : -1,
    reach = shoulder.distanceTo(elbow) + elbow.distanceTo(wrist.at);
  const aim = present
    ? new Vector3(0.46 * side, -0.025, 1)
    : new Vector3(0.35 * side, -0.49, 0.11);
  solve.solve(
    shoulder
      .clone()
      .addScaledVector(aim.normalize(), reach * (present ? 0.97 : 0.52)),
  );
  const cap = present
    ? new Vector3(side * 0.35, 0.08, 0.94)
    : new Vector3(side * 0.14, 0.78, -0.57);
  const across = cap.normalize().multiplyScalar(side);
  const palmUp = present
    ? new Vector3(side * 0.45, 0.92, 0)
    : new Vector3(side, 0, 0.24);
  const fingerDirection = new Vector3()
    .crossVectors(palmUp, across)
    .normalize();
  const palm = new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(
      across,
      fingerDirection,
      across.clone().cross(fingerDirection).normalize(),
    ),
  );
  const total = palm.multiply(wrist.q.clone().invert());
  c.quaternion.copy(
    b.getWorldQuaternion(new Quaternion()).invert().multiply(total),
  );
  return {
    name: dispatchPoseName,
    joints: [
      [upper, a],
      [fore, b],
      [hand, c],
    ].map(([p, bone]) => ({
      part: p.id,
      station: 0,
      turn: bone.quaternion.toArray(),
    })),
  };
}

function bindCarry(form, pose) {
  const frames = restFrames(form.parts);
  const rotations = pose.joints.map((row) => {
    const p = form.parts.find((part) => part.id === row.part);
    const parent = frames(p.parent).q.clone(),
      local = new Quaternion().setFromEuler(
        new Euler(...p.rotation.map((n) => n * radians)),
      );
    local.premultiply(
      parent
        .clone()
        .invert()
        .multiply(new Quaternion(...row.turn))
        .multiply(parent),
    );
    return [
      p.id,
      new Euler()
        .setFromQuaternion(local)
        .toArray()
        .slice(0, 3)
        .map((n) => n / radians),
    ];
  });
  for (const [id, rotation] of rotations) {
    const index = form.parts.findIndex((p) => p.id === id);
    form.parts[index] = { ...form.parts[index], rotation };
  }
}

export function mergeDispatchPoses(previous, current, next) {
  const old = previous.poses?.find((p) => p.name === dispatchPoseName),
    fresh = next.poses?.find((p) => p.name === dispatchPoseName);
  if (!old && !fresh) return current.poses;
  const poses = (current.poses ?? []).filter(
    (p) => p.name !== dispatchPoseName,
  );
  const edited = current.poses?.find((p) => p.name === dispatchPoseName);
  if (edited && JSON.stringify(old) !== JSON.stringify(edited))
    poses.push(edited);
  else if (fresh && (edited || !old)) poses.push(fresh);
  return poses.length ? poses : undefined;
}

export function hasDispatchAction(form) {
  return (
    form.poses?.some((p) => p.name === dispatchPoseName && p.joints.length) &&
    form.parts.some(
      (p) => p.id === "gear dispatch tube" && p.parent?.endsWith(" hand"),
    )
  );
}
export function dispatchActionClip(bindings, form) {
  const pose = form.poses?.find((p) => p.name === dispatchPoseName);
  if (!hasDispatchAction(form)) return null;
  const tracks = [],
    times = [0, 0.25, 0.88, 1.38, 1.71, 2.31],
    weights = [0, 0.12, 1, 1, 0.75, 0];
  for (const row of pose.joints) {
    const b = bindings.get(
      JSON.stringify([row.part, row.station, row.digit ?? ""]),
    );
    if (!b) continue;
    if (row.turn) {
      const end = b.rotation
        .clone()
        .multiply(new Quaternion(...row.turn).normalize());
      tracks.push(
        new QuaternionKeyframeTrack(
          b.bone.name + ".quaternion",
          times,
          weights.flatMap((w) => b.rotation.clone().slerp(end, w).toArray()),
        ),
      );
    }
    if (row.shift) {
      const offset = new Vector3(...row.shift);
      tracks.push(
        new VectorKeyframeTrack(
          b.bone.name + ".position",
          times,
          weights.flatMap((w) =>
            b.position.clone().addScaledVector(offset, w).toArray(),
          ),
        ),
      );
    }
  }
  if (!tracks.length) {
    const root = bindings.values().next().value;
    if (!root) return null;
    const at = root.position.toArray();
    tracks.push(
      new VectorKeyframeTrack(
        root.bone.name + ".position",
        [0, times.at(-1)],
        [...at, ...at],
      ),
    );
  }
  return new AnimationClip("Offer dispatch", times.at(-1), tracks);
}
