import * as T from "three";
import {
  creatureClips,
  floorSwing,
  placeFootInSpace,
  spatialLeg,
  standardMoves,
  type LegChain,
} from "./creature-motion.js";
import type { Region } from "./region.js";

const tau = 2 * Math.PI;
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const angle = (a: T.Vector3, b: T.Vector3) => Math.atan2(b.z - a.z, a.y - b.y);
const length = (a: T.Vector3, b: T.Vector3) => Math.hypot(b.z - a.z, b.y - a.y);

function legChains(regions: ReadonlyMap<string, Region>): LegChain[] {
  const result: LegChain[] = [];
  const all = [...regions.values()];
  for (const s of all) {
    if (s.role !== "thigh" || s.bones.length < 3) continue;
    const shin = all.find(
      (r) => r.part.parent === s.part.id && r.role === "shin" && r.bones.length > 1,
    );
    const knee = shin ? shin.points[0] : s.points[1];
    const ankle = shin ? shin.points.at(-1) : s.points[2];
    const hip = s.points[0];
    const a = s.bones[0];
    const b = shin ? shin.bones[0] : s.bones[1];
    const c = shin ? shin.bones.at(-1) : s.bones[2];
    if (!knee || !ankle || !hip || !a || !b || !c) continue;
    const spatial = spatialLeg(hip, knee, ankle);
    const upper = spatial ? hip.distanceTo(knee) : length(hip, knee);
    const lower = spatial ? knee.distanceTo(ankle) : length(knee, ankle);
    if (upper < 0.01 || lower < 0.01) continue;
    result.push({
      hip,
      knee,
      ankle,
      upper,
      lower,
      spatial,
      span: spatial ? hip.distanceTo(ankle) : upper + lower,
      a,
      b,
      c,
      phase: 0,
    });
  }
  const left = result.filter((l) => l.hip.x >= 0).sort((a, b) => a.hip.z - b.hip.z);
  const right = result.filter((l) => l.hip.x < 0).sort((a, b) => a.hip.z - b.hip.z);
  [left, right].forEach((sideLegs, i) =>
    sideLegs.forEach((leg, j) => {
      leg.phase = (i * 0.5 + (j % 2) * 0.5 + (j > 1 ? 0.08 : 0)) % 1;
    }),
  );
  return result;
}

type Write = (bone: T.Bone | undefined, x: number, y: number, z: number) => void;

function placeFoot(leg: LegChain, dz: number, lift: number, drop: number, write: Write): void {
  const { hip, knee, ankle, upper, lower } = leg;
  const z = ankle.z - hip.z + dz;
  const y = hip.y + drop - ankle.y - lift;
  const reach = clamp(Math.hypot(z, y), Math.abs(upper - lower) + 0.00001, upper + lower - 0.00001);
  const line = Math.atan2(z, y);
  const sign = knee.z - (hip.z + ankle.z) * 0.5 < -0.026 ? -1 : 1;
  const upperAngle =
    line +
    sign *
      Math.acos(
        clamp((upper * upper + reach * reach - lower * lower) / (2 * upper * reach), -1, 1),
      );
  const lowerAngle =
    line -
    sign *
      Math.acos(
        clamp((lower * lower + reach * reach - upper * upper) / (2 * lower * reach), -1, 1),
      );
  const restA = angle(hip, knee);
  const restB = angle(knee, ankle);
  const a = restA - upperAngle;
  const b = restB - restA - (lowerAngle - upperAngle);
  write(leg.a, a, 0, 0);
  write(leg.b, b, 0, 0);
  write(leg.c, -a - b, 0, 0);
}

interface Elbow {
  readonly bone: T.Bone | undefined;
  readonly axis: T.Vector3;
  readonly hand: Region | undefined;
  readonly implicit?: boolean;
}

interface ArmMovement {
  readonly reach: number;
  readonly swing: number;
  readonly phase: number;
  readonly natural?: boolean;
  readonly loaded?: boolean;
}

interface PairedAxis {
  readonly axis: T.Vector3;
  readonly side: number;
  readonly spread: T.Quaternion;
}

const knotWidth = (s: Region): number | undefined => {
  const knots = s.part.sweep?.knots;
  return knots?.length ? Math.max(...knots.map((k) => Math.max(k[3], k[4]))) : undefined;
};

function pairShoulderAxes(
  arms: ReadonlyArray<Region>,
  elbowMap: ReadonlyMap<Region, Elbow>,
  regions: ReadonlyMap<string, Region>,
): Map<Region, PairedAxis> {
  const pairs: Array<{ a: Region; b: Region; distance: number; side: number }> = [];
  const handBase = (s: Region) => elbowMap.get(s)?.hand?.points[0];
  arms.forEach((a, i) => {
    const handA = handBase(a);
    const start = a.points[0];
    if (!handA || !start) return;
    const parent = a.part.parent === null ? undefined : regions.get(a.part.parent);
    const center = parent?.bounds.getCenter(new T.Vector3()).x ?? 0;
    for (const b of arms.slice(i + 1)) {
      const handB = handBase(b);
      const end = b.points[0];
      if (!handB || !end || a.part.parent !== b.part.parent) continue;
      if ((start.x - center) * (end.x - center) <= 0) continue;
      const distance = start.distanceTo(end);
      const reach = Math.min(start.distanceTo(handA), end.distanceTo(handB));
      if (distance < 0.001 || distance > reach) continue;
      pairs.push({ a, b, distance, side: start.x < center ? -1 : 1 });
    }
  });
  const paired = new Map<Region, PairedAxis>();
  for (const { a, b, side } of pairs.sort((p, q) => p.distance - q.distance)) {
    const startA = a.points[0];
    const startB = b.points[0];
    const handA = handBase(a);
    if (paired.has(a) || paired.has(b) || !startA || !startB || !handA) continue;
    const axis = startB.clone().sub(startA).normalize();
    const arm = handA.clone().sub(startA);
    if (new T.Vector3().crossVectors(axis, arm).z < 0) axis.negate();
    if (
      [a, b].some((s) => {
        const hand = handBase(s);
        const base = s.points[0];
        if (!hand || !base) return true;
        const offset = hand.clone().sub(base);
        return axis.clone().cross(offset).length() < offset.length() * 0.22;
      })
    )
      continue;
    const higher = startA.y >= startB.y ? a : b;
    const higherHand = handBase(higher);
    const hangsDown = (higherHand?.y ?? 0) <= (higher.points[0]?.y ?? 0);
    for (const [limb, neighbour] of [
      [a, b],
      [b, a],
    ] as const) {
      const base = limb.points[0];
      const tip = limb.points.at(-1);
      if (!base || !tip) continue;
      const span = base.distanceTo(tip);
      const scale = limb.object.getWorldScale(new T.Vector3());
      const knot = knotWidth(limb);
      const width =
        knot !== undefined
          ? knot * Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z))
          : span * 0.17;
      const clearance = base.y >= (neighbour.points[0]?.y ?? 0) ? 1.5 : 0.38;
      const turn = Math.min(0.48, Math.atan2(width * clearance, span));
      const spread = new T.Quaternion().setFromAxisAngle(
        new T.Vector3(0, 0, 1),
        (hangsDown ? side : -side) * turn,
      );
      paired.set(limb, { axis, side, spread });
    }
  }
  return paired;
}

export function buildClips(root: T.Bone, regions: ReadonlyMap<string, Region>): T.AnimationClip[] {
  const legs = legChains(regions);
  const bounds = new T.Box3().makeEmpty();
  const all = [...regions.values()];
  for (const region of all) bounds.union(region.bounds);
  const hasArms = all.some((s) => s.role === "upper arm" || s.fingers.size > 0);
  const parentOf = (region: Region): Region | undefined =>
    region.part.parent === null ? undefined : regions.get(region.part.parent);
  function startsHeadChain(region: Region): boolean {
    if (hasArms || region.role !== "head") return false;
    for (let parent = parentOf(region); parent; parent = parentOf(parent))
      if (parent.role === "head") return false;
    return true;
  }
  const elbows = new Map<Region, Elbow>();
  for (const lower of all) {
    const upper = parentOf(lower);
    const start = lower.points[0];
    const end = lower.points.at(-1);
    const shoulder = upper?.points[0];
    if (lower.role !== "forearm" || upper?.role !== "upper arm" || !start || !end || !shoulder)
      continue;
    const down = end.clone().sub(start).normalize();
    const upperDirection = start.clone().sub(shoulder).normalize();
    const axis = new T.Vector3().crossVectors(upperDirection, down);
    if (axis.lengthSq() < 0.025) axis.crossVectors(down, new T.Vector3(0, 0, 1));
    if (axis.lengthSq() < 0.001) axis.set(-1, 0, 0);
    axis.normalize();
    if (new T.Vector3().crossVectors(axis, down).z < 0) axis.negate();
    const hand = all.find(
      (region) => region.part.parent === lower.part.id && region.role === "hand",
    );
    elbows.set(upper, { bone: lower.bones[0], axis, hand });
  }
  const armMovement = new Map<Region, ArmMovement>();
  const arms = all.filter((s) => s.role === "upper arm");
  const hangs = (arm: Region) => {
    const base = arm.points[0];
    const tip = arm.points.at(-1);
    return elbows.has(arm) && !!base && !!tip && tip.clone().sub(base).normalize().y < -0.78;
  };
  if (arms.length === 2 && arms.every(hangs)) {
    for (const arm of arms)
      armMovement.set(arm, {
        reach: (arm.points[0]?.x ?? 0) < 0 ? 1 : 0.42,
        swing: 1,
        phase: 0,
        natural: true,
      });
  }
  const regionOf = (id: string | null) => (id === null ? undefined : regions.get(id));
  const heldHands = new Set(
    all.filter((r) => {
      if (r.role !== "hand") return false;
      const parent = regionOf(r.part.parent);
      const upper = parent?.role === "forearm" ? regionOf(parent.part.parent) : parent;
      return r.part.hand?.cylindrical || (upper?.role === "upper arm" && upper.part.hold);
    }),
  );
  const openHands = [...armMovement.values()].some((m) => m.natural);
  if (arms.length > 2) {
    const ordered = [...arms].sort(
      (a, b) =>
        (b.points[0]?.y ?? 0) - (a.points[0]?.y ?? 0) ||
        (a.points[0]?.x ?? 0) - (b.points[0]?.x ?? 0),
    );
    let free = 0;
    ordered.forEach((arm, i) => {
      const forearm = all.find((s) => s.part.parent === arm.part.id && s.role === "forearm");
      const hand = all.find((s) => s.part.parent === (forearm ?? arm).part.id && s.role === "hand");
      if (!elbows.has(arm) && hand && arm.bones.length >= 3)
        elbows.set(arm, {
          hand,
          bone: arm.bones[1],
          axis: new T.Vector3(-1, 0, 0),
          implicit: true,
        });
      const loaded =
        hand &&
        all.some(
          (s) =>
            s.part.parent === hand.part.id &&
            (s.role === "accessory" || (s.role === "rigid" && !s.part.wear.visibleIn)),
        );
      armMovement.set(arm, {
        loaded: Boolean(loaded),
        reach: loaded ? 0.12 : ([1, 0.57, 0.36][Math.min(free++, 2)] ?? 0.36),
        swing: loaded ? 0.18 : 0.85,
        phase: i < 2 ? 0 : Math.PI,
      });
    });
  }
  const pairedAxes =
    arms.length > 2 ? pairShoulderAxes(arms, elbows, regions) : new Map<Region, PairedAxis>();
  const reachingHeads = new Set(all.filter(startsHeadChain));
  const size = bounds.getSize(new T.Vector3());
  const limb = legs.length ? Math.min(...legs.map((l) => l.span)) : size.y * 0.42;
  const duration = clamp(1.24 * Math.sqrt(Math.max(0.1, limb) / 0.8), 0.72, 2.2);
  const creatureBody = all.find((r) => r.part.label === "body");
  const planAnimal = creatureBody?.part.sweep !== undefined;
  const neckMotion = new Map<Region, { readonly reach: number; readonly skull: boolean }>();
  if (planAnimal && legs.length) {
    for (const region of all) {
      if (region.role !== "head") continue;
      const parent = parentOf(region);
      const neck = parent?.role === "head" ? parent : region;
      const base = neck.points[0];
      const tip = neck.points.at(-1);
      const neckLength = base && tip ? base.distanceTo(tip) : 0;
      const reach = Math.min(1, neckLength / Math.max(0.08, size.y * 0.4));
      neckMotion.set(region, { reach, skull: parent?.role === "head" });
    }
  }
  const clips: T.AnimationClip[] = [];
  for (const name of standardMoves(all.map((s) => s.role))) {
    const period = name === "Walk" ? duration : name === "Idle" ? 3.2 : 2.6;
    const tracks = new Map<T.Bone, number[]>();
    const translations = new Map<T.Bone, number[]>();
    const time: number[] = [];
    const positions: number[] = [];
    function rotation(bone: T.Bone | undefined, q: T.Quaternion): void {
      if (!bone) return;
      const data = tracks.get(bone) ?? [];
      data.push(q.x, q.y, q.z, q.w);
      tracks.set(bone, data);
    }
    const add: Write = (bone, x, y, z) => {
      if (bone) rotation(bone, new T.Quaternion().setFromEuler(new T.Euler(x, y, z)));
    };
    for (let i = 0; i <= 32; i++) {
      const t = i / 32;
      const sin = Math.sin(t * tau);
      const wave = (1 - Math.cos(t * tau)) * 0.5;
      time.push(t * period);
      const drop =
        name === "Crouch"
          ? -limb * 0.28 * wave
          : name === "Walk"
            ? -limb * (0.064 + 0.018 * Math.cos(t * tau * 2))
            : 0;
      positions.push(0, drop, 0);
      if (name === "Walk" || name === "Crouch")
        for (const leg of legs) {
          const step = (t + leg.phase) % 1;
          const stance = 0.6;
          const swing = (step - stance) / (1 - stance);
          const stride = limb * 0.44;
          const dz =
            name === "Crouch"
              ? 0
              : step < stance
                ? stride * (0.5 - step / stance)
                : stride * (-0.5 + T.MathUtils.smoothstep(swing, 0, 1));
          const lift =
            name === "Walk" && step >= stance ? limb * 0.16 * Math.sin(Math.PI * swing) ** 1.5 : 0;
          if (leg.spatial) placeFootInSpace(leg, dz, lift, drop, rotation);
          else placeFoot(leg, dz, lift, drop, add);
        }
      for (const s of all) {
        if (name === "Reach" && s.fingers.size && !heldHands.has(s) && !s.part.hold)
          for (const fingers of s.fingers.values())
            for (const digit of fingers)
              for (const [j, bone] of digit.chain.entries()) {
                const curl =
                  -(j === 0 ? 0.34 : j === 1 ? 0.55 : 0.42) *
                  wave *
                  (openHands ? 0.42 : 1) *
                  (digit.name === "Thumb" ? 0.68 : 1);
                rotation(bone, new T.Quaternion().setFromAxisAngle(digit.axis, curl));
              }
        const side = (s.points[0]?.x ?? 0) >= 0 ? 1 : -1;
        if (s.role === "skirt" && s.bones.length === 3 && (name === "Walk" || name === "Crouch")) {
          const correction = Math.max(0, -drop - Math.max(0, s.bounds.min.y - 0.012));
          const hemSwing = name === "Walk" ? limb * 0.052 * sin : 0;
          for (let j = 1; j <= 2; j++) {
            const bone = s.bones[j];
            if (!bone) continue;
            const rest = bone.position;
            const data = translations.get(bone) ?? [];
            const weight = j === 1 ? 0.34 : 0.66;
            data.push(rest.x, rest.y + correction * weight, rest.z + hemSwing * weight);
            translations.set(bone, data);
          }
        } else if (s.role === "upper arm") {
          if (s.part.hold) continue;
          const motion = armMovement.get(s);
          const pair: PairedAxis | undefined = pairedAxes.get(s);
          const elbow = elbows.get(s);
          if (pair && elbow && motion) {
            const swing =
              name === "Walk"
                ? -pair.side * 0.48 * sin
                : (name === "Crouch" ? 0.42 : 0.95) * (pair.side < 0 ? 1 : 0.64) * wave;
            const shoulder = new T.Quaternion()
              .setFromAxisAngle(pair.axis, name === "Idle" ? 0.015 * sin : swing)
              .multiply(pair.spread);
            rotation(s.bones[0], shoulder);
            const bend = new T.Quaternion().setFromAxisAngle(
              elbow.axis,
              name === "Reach" ? 0.2 * motion.reach * wave : 0,
            );
            if (name === "Reach") rotation(elbow.bone, bend);
            if (motion.loaded)
              rotation(elbow.hand?.bones[0], shoulder.clone().multiply(bend).invert());
            continue;
          }
          const shoulderPoint = s.points[0] ?? new T.Vector3();
          if (name === "Walk") {
            const stride = motion ? motion.swing * Math.sin(t * tau + motion.phase) : sin;
            const [least, most] = floorSwing(
              shoulderPoint,
              elbow?.hand,
              bounds.min.y,
              limb * 0.082,
            );
            add(s.bones[0], clamp(side * 0.37 * stride, least, most), 0, side * 0.035);
          } else if (name === "Reach") {
            const lift = wave * (motion?.reach ?? 1);
            if (motion?.natural)
              add(s.bones[0], -1.28 * lift, side * 0.1 * lift, -side * 0.03 * lift);
            else add(s.bones[0], -1.06 * lift, side * 0.08 * lift, side * 0.24 * lift);
            if (elbow && !elbow.implicit)
              rotation(
                elbow.bone,
                new T.Quaternion().setFromAxisAngle(
                  elbow.axis,
                  (motion?.natural ? 0.2 : 0.67) * lift,
                ),
              );
            else add(s.bones[1], -0.42 * lift, 0, 0);
          } else if (name === "Idle") add(s.bones[0], 0.015 * sin, 0, side * 0.009 * sin);
          else if (name === "Crouch") add(s.bones[0], -0.32 * wave, 0, side * 0.09 * wave);
        } else if (name === "Walk" && neckMotion.has(s)) {
          const { reach, skull } = neckMotion.get(s) ?? { reach: 0, skull: false };
          const footfall = Math.sin(2 * t * tau - 0.45);
          const pitch = (0.075 + 0.12 * reach) * footfall;
          const yaw = (0.035 + 0.07 * reach) * sin;
          add(s.bones[0], skull ? -0.55 * pitch : pitch, skull ? -0.33 * yaw : yaw, 0.022 * sin);
        } else if (s.role === "head" && name === "Idle")
          add(s.bones[0], 0.019 * sin, 0.048 * sin, 0);
        else if (name === "Reach" && reachingHeads.has(s))
          add(s.bones[0], 0.46 * wave, 0.08 * wave, 0);
        else if (s.role === "torso" && name === "Idle")
          add(s.bones[0], 0.011 * sin, 0, 0.006 * sin);
        else if (s.role === "tail" || s.role === "wing") {
          const magnitude = s.role === "wing" ? 0.12 : 0.16;
          s.bones.forEach((bone, j) => {
            const beat = Math.sin(t * tau - j * 0.64) * magnitude * (name === "Walk" ? 1 : 0.4);
            if (s.role === "wing") add(bone, 0, 0, side * beat);
            else add(bone, 0, beat, 0);
          });
        }
      }
    }
    const animation: T.KeyframeTrack[] = [
      new T.VectorKeyframeTrack(root.name + ".position", time, positions),
    ];
    for (const [bone, values] of translations)
      animation.push(new T.VectorKeyframeTrack(bone.name + ".position", time, values));
    for (const [bone, values] of tracks)
      animation.push(new T.QuaternionKeyframeTrack(bone.name + ".quaternion", time, values));
    const clip = new T.AnimationClip(name, period, animation);
    clip.optimize();
    clips.push(clip);
  }
  return [...clips, ...creatureClips(root, regions)];
}
