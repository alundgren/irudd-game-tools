import * as T from "three";
import type { JointPose, PoseJoint } from "@irudd/document";

interface Binding {
  readonly bone: T.Bone;
  readonly position: T.Vector3;
  readonly rotation: T.Quaternion;
}

const key = (part: string, station: number, digit: string | undefined): string =>
  JSON.stringify([part, station, digit ?? ""]);
const jointKey = (j: PoseJoint): string => key(j.part ?? "", j.station, j.digit);

export const poseClipName = (name: string): string => "Pose · " + name;

export function bindPoseJoints(skeleton: T.Skeleton): Map<string, Binding> {
  const bindings = new Map<string, Binding>();
  for (const bone of skeleton.bones) {
    const region: unknown = bone.userData["region"];
    const station: unknown = bone.userData["station"];
    const digit: unknown = bone.userData["digit"];
    const segment: unknown = bone.userData["segment"];
    const part = typeof region === "string" ? region : "";
    const at = typeof digit === "string" ? segment : station;
    bindings.set(
      key(part, typeof at === "number" ? at : 0, typeof digit === "string" ? digit : undefined),
      { bone, position: bone.position.clone(), rotation: bone.quaternion.clone() },
    );
  }
  return bindings;
}

export function authoredClips(
  bindings: ReadonlyMap<string, Binding>,
  poses: ReadonlyArray<JointPose>,
): T.AnimationClip[] {
  return poses.map((p) => {
    const tracks: T.KeyframeTrack[] = [];
    for (const joint of p.joints) {
      const b = bindings.get(jointKey(joint));
      if (!b) continue;
      if (joint.turn) {
        const q = b.rotation
          .clone()
          .multiply(new T.Quaternion(...joint.turn).normalize())
          .toArray();
        tracks.push(
          new T.QuaternionKeyframeTrack(b.bone.name + ".quaternion", [0, 1], [...q, ...q]),
        );
      }
      if (joint.shift) {
        const v = b.position
          .clone()
          .add(new T.Vector3(...joint.shift))
          .toArray();
        tracks.push(new T.VectorKeyframeTrack(b.bone.name + ".position", [0, 1], [...v, ...v]));
      }
    }
    const root = bindings.values().next().value;
    if (!tracks.length && root) {
      const v = root.position.toArray();
      tracks.push(new T.VectorKeyframeTrack(root.bone.name + ".position", [0, 1], [...v, ...v]));
    }
    return new T.AnimationClip(poseClipName(p.name), 1, tracks);
  });
}

export function offerClip(
  bindings: ReadonlyMap<string, Binding>,
  pose: JointPose,
): T.AnimationClip | undefined {
  const tracks: T.KeyframeTrack[] = [];
  const times = [0, 0.25, 0.88, 1.38, 1.71, 2.31];
  const weights = [0, 0.12, 1, 1, 0.75, 0];
  const duration = 2.31;
  for (const joint of pose.joints) {
    const b = bindings.get(jointKey(joint));
    if (!b) continue;
    if (joint.turn) {
      const end = b.rotation.clone().multiply(new T.Quaternion(...joint.turn).normalize());
      tracks.push(
        new T.QuaternionKeyframeTrack(
          b.bone.name + ".quaternion",
          times,
          weights.flatMap((w) => b.rotation.clone().slerp(end, w).toArray()),
        ),
      );
    }
    if (joint.shift) {
      const offset = new T.Vector3(...joint.shift);
      tracks.push(
        new T.VectorKeyframeTrack(
          b.bone.name + ".position",
          times,
          weights.flatMap((w) => b.position.clone().addScaledVector(offset, w).toArray()),
        ),
      );
    }
  }
  if (!tracks.length) {
    const root = bindings.values().next().value;
    if (!root) return undefined;
    const at = root.position.toArray();
    tracks.push(
      new T.VectorKeyframeTrack(root.bone.name + ".position", [0, duration], [...at, ...at]),
    );
  }
  return new T.AnimationClip("Offer dispatch", duration, tracks);
}
