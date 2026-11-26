import * as T from "three";
import type { Region, RigRole } from "./region.js";

export function standardMoves(roles: ReadonlyArray<RigRole>): string[] {
  const set = new Set(roles);
  return set.has("axial spine") && !(["thigh", "shin", "foot"] as const).some((r) => set.has(r))
    ? ["Idle", "Reach"]
    : ["Idle", "Walk", "Crouch", "Reach"];
}

export function creatureMoves(roles: ReadonlyArray<RigRole>): string[] {
  const set = new Set(roles);
  const moves: string[] = [];
  if (set.has("wing")) moves.push("Fly");
  if ((["tail", "fin", "axial spine"] as const).some((r) => set.has(r))) moves.push("Swim");
  if (set.has("axial spine")) moves.push("Slither", "Coil");
  return moves;
}

const up = new T.Vector3(0, 1, 0);
const side = new T.Vector3(1, 0, 0);
const forward = new T.Vector3(0, 0, 1);

function bendAxis(direction: T.Vector3, toward: T.Vector3): T.Vector3 {
  const axis = new T.Vector3().crossVectors(direction, toward);
  return axis.lengthSq() < 1e-6 ? forward : axis.normalize();
}

export function spatialLeg(hip: T.Vector3, knee: T.Vector3, ankle: T.Vector3): boolean {
  const upper = hip.distanceTo(knee);
  const lower = knee.distanceTo(ankle);
  return knee.y > hip.y + 0.04 * (upper + lower);
}

export interface LegChain {
  readonly hip: T.Vector3;
  readonly knee: T.Vector3;
  readonly ankle: T.Vector3;
  readonly upper: number;
  readonly lower: number;
  readonly spatial: boolean;
  readonly span: number;
  readonly a: T.Bone;
  readonly b: T.Bone;
  readonly c: T.Bone;
  phase: number;
}

const ahead = new T.Vector3(0, 0, 1);

export function placeFootInSpace(
  leg: LegChain,
  dz: number,
  lift: number,
  drop: number,
  write: (bone: T.Bone, q: T.Quaternion) => void,
): void {
  const { hip, knee, ankle } = leg;
  const thigh = knee.clone().sub(hip);
  const shin = ankle.clone().sub(knee);
  const rest = ankle.clone().sub(hip);
  const upper = thigh.length();
  const lower = shin.length();
  const goal = rest.clone().add(new T.Vector3(0, lift - drop, dz));
  const reach = T.MathUtils.clamp(
    goal.length(),
    Math.abs(upper - lower) + 1e-5,
    upper + lower - 1e-5,
  );
  const normal = new T.Vector3().crossVectors(thigh, shin);
  if (normal.lengthSq() < 1e-10) normal.crossVectors(ahead, rest);
  if (normal.lengthSq() < 1e-10) normal.set(1, 0, 0);
  normal.normalize();
  const swing = new T.Quaternion().setFromUnitVectors(
    rest.clone().normalize(),
    goal.clone().normalize(),
  );
  const interior = (a: number, b: number, c: number) =>
    Math.acos(T.MathUtils.clamp((a * a + b * b - c * c) / (2 * a * b), -1, 1));
  const hipAngle = interior(upper, reach, lower) - thigh.angleTo(rest);
  const first = new T.Quaternion()
    .setFromAxisAngle(normal.clone().negate().applyQuaternion(swing), hipAngle)
    .multiply(swing);
  const second = new T.Quaternion().setFromAxisAngle(
    normal,
    Math.PI - interior(upper, lower, reach) - thigh.angleTo(shin),
  );
  write(leg.a, first);
  write(leg.b, second);
  write(leg.c, first.clone().multiply(second).invert());
}

export function floorSwing(
  shoulder: T.Vector3,
  hand: Region | undefined,
  floor: number,
  sink = 0,
): readonly [number, number] {
  if (!hand || hand.bounds.isEmpty()) return [-Infinity, Infinity];
  const z = (hand.bounds.min.z + hand.bounds.max.z) / 2 - shoulder.z;
  const y = hand.bounds.min.y - shoulder.y;
  const reach = Math.hypot(z, y);
  const room = (shoulder.y - sink - floor - 0.01) / Math.max(reach, 1e-6);
  if (room >= 1) return [-Infinity, Infinity];
  const rest = Math.atan2(z, -y);
  const closest = Math.acos(T.MathUtils.clamp(room, -1, 1));
  if (Math.abs(rest) <= closest) return [0, 0];
  return rest > 0 ? [-Infinity, rest - closest] : [rest + closest, Infinity];
}

export function creatureClips(
  root: T.Bone,
  regions: ReadonlyMap<string, Region>,
): T.AnimationClip[] {
  const values = [...regions.values()];
  const box = new T.Box3();
  for (const s of values) box.union(s.bounds);
  const size = box.getSize(new T.Vector3());
  const span = Math.max(size.x, size.y, size.z);
  let wingClearance = 0;
  for (const region of values) {
    const { points, bounds } = region;
    const base = points[0];
    if (region.role !== "wing" || points.length < 2 || !base) continue;
    let reach = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i];
      const b = points[i - 1];
      if (a && b) reach += a.distanceTo(b);
    }
    const sectionDepth = Math.max(0, Math.min(...points.map((p) => p.y)) - bounds.min.y);
    wingClearance = Math.max(wingClearance, reach + sectionDepth - base.y);
  }
  return creatureMoves(values.map((s) => s.role)).map((name) => {
    const period = T.MathUtils.clamp(
      (name === "Fly" ? 0.83 : name === "Swim" ? 1.45 : 1.76) *
        Math.sqrt(Math.max(0.15, span) / 1.4),
      0.55,
      3.2,
    );
    const time: number[] = [];
    const position: number[] = [];
    const tracks = new Map<T.Bone, number[]>();
    const q = new T.Quaternion();
    function rotate(bone: T.Bone | undefined, axis: T.Vector3, angle: number): void {
      if (!bone) return;
      q.setFromAxisAngle(axis, angle);
      const data = tracks.get(bone) ?? [];
      data.push(q.x, q.y, q.z, q.w);
      tracks.set(bone, data);
    }
    for (let frame = 0; frame <= 40; frame++) {
      const t = frame / 40;
      const phase = t * Math.PI * 2;
      const sin = Math.sin(phase);
      time.push(t * period);
      const lift =
        name === "Fly"
          ? Math.max(size.y * 0.24, wingClearance) +
            span * 0.05 +
            size.y * 0.035 * (1 + Math.cos(phase))
          : name === "Swim"
            ? Math.max(0.065 * span, 0.12 * size.y) + 0.025 * size.y * Math.sin(phase)
            : 0;
      position.push(0, lift, 0);
      for (const s of values) {
        const { points, bones, role } = s;
        const n = bones.length;
        if ((role === "axial spine" || role === "tail") && n > 1) {
          const amplitude = name === "Slither" ? 0.64 : name === "Swim" ? 0.52 : 0.17;
          const cycles = role === "tail" ? 0.72 : 1.16;
          const lag = role === "tail" ? 0.62 : 0;
          for (let j = 0; j < n; j++) {
            const station = j / (n - 1);
            const previous = (j - 1) / (n - 1);
            const to = points[Math.min(n - 1, j + 1)];
            const from = points[Math.min(n - 2, j)];
            const direction = to && from ? to.clone().sub(from).normalize() : new T.Vector3();
            if (name === "Coil") {
              rotate(
                bones[j],
                up,
                j ? (1.48 * Math.PI * (1 - Math.cos(phase)) * 0.5) / (n - 1) : 0,
              );
              continue;
            }
            const heading = (v: number) =>
              amplitude *
              (0.44 + 0.56 * Math.max(0, v)) *
              Math.sin(phase - v * cycles * 2 * Math.PI - lag);
            rotate(
              bones[j],
              bendAxis(direction, side),
              heading(station) - (j ? heading(previous) : 0),
            );
          }
        } else if ((role === "wing" || role === "fin") && n > 1) {
          const tip = points.at(-1);
          const base = points[0];
          const appendage = tip && base ? tip.clone().sub(base).normalize() : new T.Vector3();
          const axis = bendAxis(appendage, up);
          const strength = name === "Fly" ? 0.69 : name === "Swim" ? 0.31 : 0.06;
          for (let j = 0; j < n; j++)
            rotate(
              bones[j],
              axis,
              strength * (j === 0 ? 1 : 0.4) * Math.sin(phase - j * 0.72) -
                (name === "Fly" && j === 0 ? 0.08 : 0),
            );
        } else if (role === "thigh" || role === "shin") {
          if (name === "Fly") rotate(bones[0], side, role === "thigh" ? -0.28 + 0.065 * sin : 0.52);
          if (name === "Swim")
            rotate(bones[0], side, ((points[0]?.x ?? 0) >= 0 ? 1 : -1) * 0.28 * sin);
        } else if (role === "torso" && name !== "Slither")
          rotate(bones[0], side, (name === "Fly" ? -0.045 : -0.1) + 0.045 * sin);
      }
    }
    const animation: T.KeyframeTrack[] = [
      new T.VectorKeyframeTrack(root.name + ".position", time, position),
    ];
    for (const [bone, v] of tracks)
      animation.push(new T.QuaternionKeyframeTrack(bone.name + ".quaternion", time, v));
    const clip = new T.AnimationClip(name, period, animation);
    clip.optimize();
    return clip;
  });
}
