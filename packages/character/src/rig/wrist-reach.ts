import * as T from "three";
import type { JointBinding } from "./poses.js";
import type { Region } from "./region.js";

const at = (bone: T.Object3D) => bone.getWorldPosition(new T.Vector3());
const orientation = (bone: T.Object3D | null) =>
  bone ? bone.getWorldQuaternion(new T.Quaternion()) : new T.Quaternion();
function setWorldRotation(bone: T.Object3D, rotation: T.Quaternion) {
  bone.quaternion.copy(orientation(bone.parent).invert().multiply(rotation));
  bone.updateWorldMatrix(false, true);
}
function aim(bone: T.Object3D, end: T.Object3D, toward: T.Vector3) {
  const origin = at(bone);
  const turn = new T.Quaternion().setFromUnitVectors(
    at(end).sub(origin).normalize(),
    toward.clone().sub(origin).normalize(),
  );
  setWorldRotation(bone, turn.multiply(orientation(bone)));
}

export interface ArmRegions {
  readonly upper: Region;
  readonly lower: Region;
  readonly hand: Region;
}

export function armRegions(
  regions: ReadonlyMap<string, Region>,
  id: string,
): ArmRegions | undefined {
  const all = [...regions.values()];
  const part = regions.get(id);
  const child = (p: Region | undefined, wanted: string) =>
    p && all.find((c) => c.part.parent === p.part.id && c.role === wanted);
  const parent = (p: Region | undefined) =>
    p?.part.parent === null || !p ? undefined : regions.get(p.part.parent);
  const lower =
    part?.role === "forearm"
      ? part
      : part?.role === "hand"
        ? parent(part)
        : part?.role === "upper arm"
          ? child(part, "forearm")
          : undefined;
  if (!lower || lower.role !== "forearm") return undefined;
  const upper = parent(lower),
    hand = child(lower, "hand");
  return upper?.role === "upper arm" && hand ? { upper, lower, hand } : undefined;
}

export type ElbowDirection = "original" | "clear" | "down" | "left" | "right" | "back";

const elbowDirections: Partial<Record<ElbowDirection, readonly [number, number, number]>> = {
  down: [0, -1, 0],
  left: [1, 0, 0],
  right: [-1, 0, 0],
  back: [0, 0, -1],
};

function clearanceGuide(
  regions: ReadonlyMap<string, Region>,
  root: (r: Region) => T.Bone | undefined,
  chain: ArmRegions,
) {
  interface Span {
    readonly from: T.Vector3;
    readonly axis: T.Vector3;
    readonly squared: number;
    readonly radius: number;
  }
  const spans: Span[] = [],
    point = new T.Vector3(),
    nearest = new T.Vector3();
  function radius(region: Region, length: number) {
    const radii = region.part.sweep?.knots.map((k) => (k[3] + k[4]) * 0.5).sort((a, b) => a - b);
    return T.MathUtils.clamp(
      radii?.[Math.floor(radii.length / 2)] ?? length * 0.17,
      length * 0.07,
      length * 0.4,
    );
  }
  function segment(region: Region, end: Region): Span | undefined {
    const a = root(region),
      b = root(end);
    if (!a || !b) return undefined;
    const from = at(a),
      axis = at(b).sub(from);
    return { from, axis, squared: axis.lengthSq(), radius: radius(region, axis.length()) };
  }
  for (const hand of regions.values()) {
    if (hand.role !== "hand" || hand.part.id === chain.hand.part.id) continue;
    const other = armRegions(regions, hand.part.id);
    if (!other) continue;
    const first = segment(other.upper, other.lower),
      second = segment(other.lower, other.hand);
    if (first && second) spans.push(first, second);
  }
  const widths = [
    segment(chain.upper, chain.lower)?.radius ?? 0,
    segment(chain.lower, chain.hand)?.radius ?? 0,
  ];
  const torso = chain.upper.part.parent === null ? undefined : regions.get(chain.upper.part.parent);
  const torsoBox = torso && !torso.bounds.isEmpty() && torso.role === "torso" ? torso.bounds : null;
  const center = torsoBox?.getCenter(new T.Vector3()) ?? new T.Vector3(),
    radii = torsoBox?.getSize(new T.Vector3()).multiplyScalar(0.49) ?? new T.Vector3();
  let bodyTransform: ((p: T.Vector3) => T.Vector3) | undefined;
  const torsoBone = torso && root(torso);
  const bindAt = torso?.points[0];
  if (torsoBox && torsoBone && bindAt) {
    const pivot = at(torsoBone),
      inverse = orientation(torsoBone).invert();
    bodyTransform = (p) => nearest.copy(p).sub(pivot).applyQuaternion(inverse).add(bindAt);
  }
  return (shoulder: T.Vector3, elbow: T.Vector3, wrist: T.Vector3) => {
    let penalty = 0;
    const points = [shoulder, elbow, wrist];
    for (const [index, width] of widths.entries()) {
      const from = points[index] ?? shoulder,
        to = points[index + 1] ?? wrist;
      for (let i = 1; i <= 8; i++) {
        point.lerpVectors(from, to, i / 8);
        for (const s of spans) {
          const t = T.MathUtils.clamp(
            nearest.copy(point).sub(s.from).dot(s.axis) / (s.squared || 1),
            0,
            1,
          );
          nearest.copy(s.from).addScaledVector(s.axis, t);
          const overlap = Math.max(0, width + s.radius + 0.008 - point.distanceTo(nearest));
          penalty += overlap * overlap;
        }
        if (torsoBox && (index === 1 || i >= 4)) {
          const offset = bodyTransform ? bodyTransform(point) : nearest.copy(point);
          offset.sub(center);
          const depth =
            1 -
            Math.hypot(
              offset.x / Math.max(0.01, radii.x + width),
              offset.y / Math.max(0.01, radii.y + width),
              offset.z / Math.max(0.01, radii.z + width),
            );
          if (depth > 0) penalty += (depth * Math.min(radii.x, radii.y, radii.z)) ** 2;
        }
      }
    }
    return penalty;
  };
}

export interface WristReach {
  readonly wrist: T.Bone;
  readonly initial: T.Vector3;
  solve(goal: T.Vector3, roll?: number, elbow?: ElbowDirection): number;
}

export function wristReach(
  regions: ReadonlyMap<string, Region>,
  bindings: ReadonlyMap<string, JointBinding>,
  id: string,
): WristReach | undefined {
  const chain = armRegions(regions, id);
  if (!chain) return undefined;
  const root = (r: Region) => bindings.get(JSON.stringify([r.part.id, 0, ""]))?.bone;
  const shoulder = root(chain.upper),
    elbow = root(chain.lower),
    wrist = root(chain.hand);
  if (!shoulder || !elbow || !wrist) return undefined;
  shoulder.updateWorldMatrix(true, true);
  const a = at(shoulder),
    b = at(elbow),
    c = at(wrist);
  const upper = a.distanceTo(b),
    lower = b.distanceTo(c);
  if (Math.min(upper, lower) < 0.001) return undefined;
  const originalAxis = c.clone().sub(a);
  if (originalAxis.lengthSq() < 1e-12) originalAxis.copy(b).sub(a);
  originalAxis.normalize();
  const pole = b.clone().sub(a);
  pole.addScaledVector(originalAxis, -pole.dot(originalAxis));
  if (pole.lengthSq() < 1e-6 * upper * upper) {
    pole.set(0, 0, -1).applyQuaternion(orientation(shoulder.parent));
    if (Math.abs(pole.dot(originalAxis)) > 0.92)
      pole.set(1, 0, 0).applyQuaternion(orientation(shoulder.parent));
    pole.addScaledVector(originalAxis, -pole.dot(originalAxis));
  }
  pole.normalize();
  const clearance = clearanceGuide(regions, root, chain);
  const joints = [shoulder, elbow, wrist];
  const original = joints.map((j) => j.quaternion.clone());
  const handFacing = orientation(wrist),
    epsilon = Math.min(upper, lower) * 0.00001;
  return {
    wrist,
    initial: c,
    solve(goal, roll = 0, elbowDirection = "original") {
      joints.forEach((joint, i) => joint.quaternion.copy(original[i] ?? joint.quaternion));
      shoulder.updateWorldMatrix(true, true);
      const direction = goal.clone().sub(a),
        requested = direction.length();
      if (requested < 1e-8) direction.copy(originalAxis);
      else direction.divideScalar(requested);
      const distance = T.MathUtils.clamp(
        requested,
        Math.abs(upper - lower) + epsilon,
        upper + lower - epsilon,
      );
      const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
      const side = Math.sqrt(Math.max(0, upper * upper - along * along));
      const bend = pole
        .clone()
        .applyQuaternion(new T.Quaternion().setFromUnitVectors(originalAxis, direction));
      const wristGoal = a.clone().addScaledVector(direction, distance);
      const preferred = elbowDirections[elbowDirection];
      if (elbowDirection === "clear") {
        const initial = bend.clone(),
          test = new T.Vector3(),
          trial = new T.Vector3();
        let best = Infinity;
        for (let i = 0; i < 36; i++) {
          test.copy(initial).applyAxisAngle(direction, (i * Math.PI) / 18);
          trial.copy(a).addScaledVector(direction, along).addScaledVector(test, side);
          const score = clearance(a, trial, wristGoal) + (1 - test.dot(initial)) * 0.00001;
          if (score < best) {
            best = score;
            bend.copy(test);
          }
        }
      } else if (preferred) {
        const wanted = new T.Vector3(...preferred);
        wanted.addScaledVector(direction, -wanted.dot(direction));
        if (wanted.lengthSq() > 1e-8) bend.copy(wanted.normalize());
      }
      bend.applyAxisAngle(direction, T.MathUtils.degToRad(roll));
      const elbowGoal = a.clone().addScaledVector(direction, along).addScaledVector(bend, side);
      aim(shoulder, elbow, elbowGoal);
      aim(elbow, wrist, wristGoal);
      setWorldRotation(wrist, handFacing.clone());
      return at(wrist).distanceTo(goal);
    },
  };
}
