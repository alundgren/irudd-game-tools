import { Schema } from "effect";
import { PartId } from "../schema.js";
import { bounded, family, Vec3Between } from "./family.js";

export const motionRoles = [
  "rigid",
  "torso",
  "head",
  "upper arm",
  "forearm",
  "hand",
  "thigh",
  "shin",
  "foot",
  "tail",
  "wing",
  "fin",
  "axial spine",
  "skirt",
] as const;
export const MotionRoleName = Schema.Literals(motionRoles);
export type MotionRoleName = typeof MotionRoleName.Type;

export const MotionRole = Schema.Struct({ role: MotionRoleName });
export type MotionRole = typeof MotionRole.Type;

export const motionRole = family({
  id: "motion.role",
  version: 1,
  scope: "part",
  schema: MotionRole,
  toJson: (v) => v,
});

export const MotionHold = Schema.Struct({});
export type MotionHold = typeof MotionHold.Type;

export const motionHold = family({
  id: "motion.hold",
  version: 1,
  scope: "part",
  schema: MotionHold,
  toJson: (v) => v,
});

const unit = (q: ReadonlyArray<number>) => Math.abs(Math.hypot(...q) - 1) <= 0.002;

export const PoseJoint = Schema.Struct({
  part: Schema.NullOr(PartId),
  station: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 })),
  digit: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(32))),
  turn: Schema.optionalKey(
    Schema.Tuple([
      bounded(-1.001, 1.001),
      bounded(-1.001, 1.001),
      bounded(-1.001, 1.001),
      bounded(-1.001, 1.001),
    ]).check(Schema.makeFilter((q) => unit(q) || "A turn must be a unit quaternion.")),
  ),
  shift: Schema.optionalKey(Vec3Between(-32, 32)),
}).check(
  Schema.makeFilter(
    (j) => j.turn !== undefined || j.shift !== undefined || "A joint needs a turn or a shift.",
  ),
  Schema.makeFilter(
    (j) =>
      j.part !== null ||
      (j.station === 0 && j.digit === undefined) ||
      "The root joint has station 0 and no digit.",
  ),
);
export type PoseJoint = typeof PoseJoint.Type;

const controlCharacter = (text: string): boolean => {
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) < 0x20) return true;
  return false;
};

const jointKey = (j: PoseJoint) => JSON.stringify([j.part ?? "", j.station, j.digit ?? ""]);

export const JointPose = Schema.Struct({
  name: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(60),
    Schema.makeFilter(
      (n: string) =>
        (n === n.trim() && !controlCharacter(n)) ||
        "A pose name has no surrounding spaces or control characters.",
    ),
  ),
  joints: Schema.Array(PoseJoint).check(
    Schema.isMaxLength(2048),
    Schema.makeFilter(
      (joints: ReadonlyArray<PoseJoint>) =>
        new Set(joints.map(jointKey)).size === joints.length || "Each bone appears once in a pose.",
    ),
  ),
});
export type JointPose = typeof JointPose.Type;

export const MotionPoses = Schema.Struct({
  poses: Schema.Array(JointPose).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(32),
    Schema.makeFilter(
      (poses: ReadonlyArray<JointPose>) =>
        new Set(poses.map((p) => p.name.toLowerCase())).size === poses.length ||
        "Pose names are unique, ignoring case.",
    ),
  ),
});
export type MotionPoses = typeof MotionPoses.Type;

export const motionPoses = family({
  id: "motion.poses",
  version: 1,
  scope: "document",
  schema: MotionPoses,
  toJson: (v) => v,
  references: (v) =>
    v.poses.flatMap((pose, p) =>
      pose.joints.flatMap((j, i) =>
        j.part === null
          ? []
          : [{ kind: "part" as const, id: j.part, path: ["poses", p, "joints", i, "part"] }],
      ),
    ),
});
