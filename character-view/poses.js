import {
  AnimationClip,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
} from "three";

const key = (joint) =>
  JSON.stringify([joint.part, joint.station, joint.digit ?? ""]);
export const poseClipName = (name) => "Pose · " + name;
const vector = (a, n, max) =>
  Array.isArray(a) &&
  a.length === n &&
  a.every((x) => Number.isFinite(x) && Math.abs(x) <= max);
export function validPoses(poses) {
  if (!Array.isArray(poses) || poses.length > 32) return false;
  const names = new Set();
  return poses.every((p) => {
    if (
      !p ||
      typeof p.name !== "string" ||
      !p.name.trim() ||
      p.name !== p.name.trim() ||
      p.name.length > 60 ||
      /[\x00-\x1f]/.test(p.name) ||
      names.has(p.name.toLowerCase())
    )
      return false;
    names.add(p.name.toLowerCase());
    if (!Array.isArray(p.joints) || p.joints.length > 2048) return false;
    const joints = new Set();
    return p.joints.every((j) => {
      if (
        !j ||
        typeof j.part !== "string" ||
        j.part.length > 64 ||
        (!j.part && (j.station !== 0 || j.digit !== undefined)) ||
        !Number.isInteger(j.station) ||
        j.station < 0 ||
        j.station > 255 ||
        (j.digit !== undefined &&
          (typeof j.digit !== "string" ||
            !j.digit.length ||
            j.digit.length > 32)) ||
        (j.turn === undefined && j.shift === undefined) ||
        (j.turn !== undefined &&
          (!vector(j.turn, 4, 1.001) ||
            Math.abs(Math.hypot(...j.turn) - 1) > 0.002)) ||
        (j.shift !== undefined && !vector(j.shift, 3, 32)) ||
        joints.has(key(j))
      )
        return false;
      joints.add(key(j));
      return true;
    });
  });
}

// Skeleton array indices and exported node names depend on the current outfit.
// Address each joint through the persistent region ID and its place in that region.
export function bindPoseJoints(skeleton) {
  const bindings = new Map();
  for (const bone of skeleton.bones) {
    const { region: part = "", digit, station = 0, segment } = bone.userData;
    const address = {
      part,
      station: digit ? segment : station,
      ...(digit ? { digit } : {}),
    };
    bindings.set(key(address), {
      address,
      bone,
      position: bone.position.clone(),
      rotation: bone.quaternion.clone(),
    });
  }
  return bindings;
}
export function inactiveJoints(bindings, records) {
  return records.filter((record) => !bindings.has(key(record)));
}
export function captureJoints(bindings, previous = []) {
  const result = inactiveJoints(bindings, previous);
  for (const { address, bone, position, rotation } of bindings.values()) {
    const shift = bone.position.clone().sub(position);
    const turn = rotation
      .clone()
      .invert()
      .multiply(bone.quaternion)
      .normalize();
    const row = { ...address };
    if (shift.lengthSq() > 1e-12) row.shift = rounded(shift);
    if (Math.abs(turn.w) < 1 - 1e-9) row.turn = rounded(turn);
    if (row.turn || row.shift) result.push(row);
  }
  return result;
}
function rounded(value) {
  return value.toArray().map((n) => Number(n.toFixed(7)));
}
export function applyJointPose(bindings, records) {
  for (const { bone, position, rotation } of bindings.values()) {
    bone.position.copy(position);
    bone.quaternion.copy(rotation);
  }
  for (const record of records) {
    const binding = bindings.get(key(record));
    if (!binding) continue;
    if (record.shift) binding.bone.position.add(new Vector3(...record.shift));
    if (record.turn)
      binding.bone.quaternion.multiply(
        new Quaternion(...record.turn).normalize(),
      );
  }
}
export function authoredClips(bindings, poses = []) {
  return poses.map((p) => {
    const tracks = [];
    for (const record of p.joints) {
      const b = bindings.get(key(record));
      if (!b) continue;
      if (record.turn) {
        const q = b.rotation
          .clone()
          .multiply(new Quaternion(...record.turn).normalize())
          .toArray();
        tracks.push(
          new QuaternionKeyframeTrack(
            b.bone.name + ".quaternion",
            [0, 1],
            [...q, ...q],
          ),
        );
      }
      if (record.shift) {
        const v = b.position
          .clone()
          .add(new Vector3(...record.shift))
          .toArray();
        tracks.push(
          new VectorKeyframeTrack(
            b.bone.name + ".position",
            [0, 1],
            [...v, ...v],
          ),
        );
      }
    }
    if (!tracks.length) {
      const root = bindings.values().next().value;
      const v = root.position.toArray();
      tracks.push(
        new VectorKeyframeTrack(
          root.bone.name + ".position",
          [0, 1],
          [...v, ...v],
        ),
      );
    }
    return new AnimationClip(poseClipName(p.name), 1, tracks);
  });
}
