import { creatureClips, standardMoves } from "./creature-motion.js";
import {
  AnimationClip,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
  Quaternion,
  Vector3,
  Euler,
  MathUtils,
  Box3,
} from "three";

const tau = 2 * Math.PI;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const angle = (a, b) => Math.atan2(b.z - a.z, a.y - b.y);
const length = (a, b) => Math.hypot(b.z - a.z, b.y - a.y);
function legChains(regions) {
  const result = [];
  for (const s of regions.values()) {
    if (s.role !== "thigh" || s.bones.length < 3) continue;
    const shin = [...regions.values()].find(
      (r) =>
        r.part.parent === s.part.id && r.role === "shin" && r.bones.length > 1,
    );
    const knee = shin ? shin.points[0] : s.points[1],
      ankle = shin ? shin.points.at(-1) : s.points[2],
      hip = s.points[0];
    const upper = length(hip, knee),
      lower = length(knee, ankle);
    if (upper < 0.01 || lower < 0.01) continue;
    result.push({
      hip,
      knee,
      ankle,
      upper,
      lower,
      a: s.bones[0],
      b: shin ? shin.bones[0] : s.bones[1],
      c: shin ? shin.bones.at(-1) : s.bones[2],
    });
  }
  const left = result
    .filter((l) => l.hip.x >= 0)
    .sort((a, b) => a.hip.z - b.hip.z);
  const right = result
    .filter((l) => l.hip.x < 0)
    .sort((a, b) => a.hip.z - b.hip.z);
  for (const [i, side] of [left, right].entries())
    side.forEach((leg, j) => {
      leg.phase = (i * 0.5 + (j % 2) * 0.5 + (j > 1 ? 0.08 : 0)) % 1;
    });
  return result;
}
// Solve a sagittal two-link chain at each key. On stance the sole stays at
// its standing floor height. On swing it follows a lifted forward arc.
function placeFoot(leg, dz, lift, drop, write) {
  const { hip, knee, ankle, upper, lower } = leg;
  const z = ankle.z - hip.z + dz,
    y = hip.y + drop - ankle.y - lift;
  const reach = clamp(
    Math.hypot(z, y),
    Math.abs(upper - lower) + 0.00001,
    upper + lower - 0.00001,
  );
  const line = Math.atan2(z, y);
  const sign = knee.z - (hip.z + ankle.z) * 0.5 < -0.026 ? -1 : 1;
  const upperAngle =
    line +
    sign *
      Math.acos(
        clamp(
          (upper * upper + reach * reach - lower * lower) / (2 * upper * reach),
          -1,
          1,
        ),
      );
  const lowerAngle =
    line -
    sign *
      Math.acos(
        clamp(
          (lower * lower + reach * reach - upper * upper) / (2 * lower * reach),
          -1,
          1,
        ),
      );
  const restA = angle(hip, knee),
    restB = angle(knee, ankle);
  const a = restA - upperAngle,
    b = restB - restA - (lowerAngle - upperAngle);
  write(leg.a, a, 0, 0);
  write(leg.b, b, 0, 0);
  write(leg.c, -a - b, 0, 0);
}
export function buildClips(root, regions) {
  const legs = legChains(regions),
    bounds = new Box3().makeEmpty();
  for (const region of regions.values()) bounds.union(region.bounds);
  // Without grasping arms, a creature reaches toward a sample with its head.
  // Rotate only the first head/neck joint of each chain.
  const hasArms = [...regions.values()].some(
    (s) => s.role === "upper arm" || s.fingers?.size,
  );
  function startsHeadChain(region) {
    if (hasArms || region.role !== "head") return false;
    for (
      let parent = regions.get(region.part.parent);
      parent;
      parent = regions.get(parent.part.parent)
    ) {
      if (parent.role === "head") return false;
    }
    return true;
  }
  const elbows = new Map();
  for (const lower of regions.values()) {
    const upper = regions.get(lower.part.parent);
    if (lower.role !== "forearm" || upper?.role !== "upper arm") continue;
    const down = lower.points.at(-1).clone().sub(lower.points[0]).normalize();
    const upperDirection = lower.points[0]
      .clone()
      .sub(upper.points[0])
      .normalize();
    const axis = new Vector3().crossVectors(upperDirection, down);
    if (axis.lengthSq() < 0.025) axis.crossVectors(down, new Vector3(0, 0, 1));
    if (axis.lengthSq() < 0.001) axis.set(-1, 0, 0);
    axis.normalize();
    if (new Vector3().crossVectors(axis, down).z < 0) axis.negate();
    elbows.set(upper, { bone: lower.bones[0], axis });
  }
  const armMovement = new Map();
  const arms = [...regions.values()].filter((s) => s.role === "upper arm");
  // Give additional pairs independent work. A hand carrying a separate object
  // stays close to its rest pose while a free arm performs the reach.
  if (arms.length > 2) {
    const ordered = [...arms].sort(
      (a, b) => b.points[0].y - a.points[0].y || a.points[0].x - b.points[0].x,
    );
    let free = 0;
    for (const [i, arm] of ordered.entries()) {
      const forearm = [...regions.values()].find(
        (s) => s.part.parent === arm.part.id && s.role === "forearm",
      );
      const hand =
        forearm &&
        [...regions.values()].find(
          (s) => s.part.parent === forearm.part.id && s.role === "hand",
        );
      const loaded =
        hand &&
        [...regions.values()].some(
          (s) =>
            s.part.parent === hand.part.id &&
            (s.role === "accessory" || (s.role === "rigid" && !s.part.visibleIn)),
        );
      armMovement.set(arm, {
        reach: loaded ? 0.12 : [1, 0.57, 0.36][Math.min(free++, 2)],
        swing: loaded ? 0.18 : 0.85,
        phase: i < 2 ? 0 : Math.PI,
      });
    }
  }
  const reachingHeads = new Set([...regions.values()].filter(startsHeadChain));
  const size = bounds.getSize(new Vector3()),
    limb = legs.length
      ? Math.min(...legs.map((l) => l.upper + l.lower))
      : size.y * 0.42;
  const duration = clamp(
    1.24 * Math.sqrt(Math.max(0.1, limb) / 0.8),
    0.72,
    2.2,
  );
  const clips = [];
  for (const name of standardMoves([...regions.values()].map((s) => s.role))) {
    const period = name === "Walk" ? duration : name === "Idle" ? 3.2 : 2.6;
    const tracks = new Map(),
      translations = new Map(),
      time = [],
      positions = [];
    function add(bone, x, y, z) {
      if (!bone) return;
      const q = new Quaternion().setFromEuler(new Euler(x, y, z));
      if (!tracks.has(bone)) tracks.set(bone, []);
      const data = tracks.get(bone);
      data.push(q.x, q.y, q.z, q.w);
    }
    for (let i = 0; i <= 32; i++) {
      const t = i / 32,
        sin = Math.sin(t * tau),
        wave = (1 - Math.cos(t * tau)) * 0.5;
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
          const step = (t + leg.phase) % 1,
            stance = 0.6,
            swing = (step - stance) / (1 - stance);
          const stride = limb * 0.44;
          const dz =
            name === "Crouch"
              ? 0
              : step < stance
                ? stride * (0.5 - step / stance)
                : stride * (-0.5 + MathUtils.smoothstep(swing, 0, 1));
          const lift =
            name === "Walk" && step >= stance
              ? limb * 0.16 * Math.sin(Math.PI * swing) ** 1.5
              : 0;
          placeFoot(leg, dz, lift, drop, add);
        }
      for (const s of regions.values()) {
        if (name === "Reach" && s.fingers?.size) {
          for (const fingers of s.fingers.values())
            for (const digit of fingers)
              for (const [j, bone] of digit.chain.entries()) {
                const angle =
                  -(j === 0 ? 0.34 : j === 1 ? 0.55 : 0.42) *
                  wave *
                  (digit.name === "Thumb" ? 0.68 : 1);
                const q = new Quaternion().setFromAxisAngle(digit.axis, angle);
                if (!tracks.has(bone)) tracks.set(bone, []);
                tracks.get(bone).push(q.x, q.y, q.z, q.w);
              }
        }
        const side = s.points[0].x >= 0 ? 1 : -1;
        if (
          s.role === "skirt" &&
          s.bones.length === 3 &&
          (name === "Walk" || name === "Crouch")
        ) {
          // Keep the hem above its rest floor while the hips lower. Splitting
          // displacement across two joints gathers fabric toward the waist.
          const correction = Math.max(
            0,
            -drop - Math.max(0, s.bounds.min.y - 0.012),
          );
          const hemSwing = name === "Walk" ? limb * 0.052 * sin : 0;
          for (let j = 1; j <= 2; j++) {
            const bone = s.bones[j],
              rest = bone.position;
            if (!translations.has(bone)) translations.set(bone, []);
            const weight = j === 1 ? 0.34 : 0.66;
            translations
              .get(bone)
              .push(
                rest.x,
                rest.y + correction * weight,
                rest.z + hemSwing * weight,
              );
          }
        } else if (s.role === "upper arm") {
          const motion = armMovement.get(s);
          if (name === "Walk") {
            const stride = motion
              ? motion.swing * Math.sin(t * tau + motion.phase)
              : sin;
            add(s.bones[0], side * 0.37 * stride, 0, side * 0.035);
          } else if (name === "Reach") {
            const lift = wave * (motion?.reach ?? 1);
            add(
              s.bones[0],
              -1.06 * lift,
              side * 0.08 * lift,
              side * 0.24 * lift,
            );
            const elbow = elbows.get(s);
            if (elbow) {
              const q = new Quaternion().setFromAxisAngle(
                elbow.axis,
                0.67 * lift,
              );
              if (!tracks.has(elbow.bone)) tracks.set(elbow.bone, []);
              tracks.get(elbow.bone).push(q.x, q.y, q.z, q.w);
            } else add(s.bones[1], -0.42 * lift, 0, 0);
          } else if (name === "Idle")
            add(s.bones[0], 0.015 * sin, 0, side * 0.009 * sin);
          else if (name === "Crouch")
            add(s.bones[0], -0.32 * wave, 0, side * 0.09 * wave);
        } else if (s.role === "head" && name === "Idle")
          add(s.bones[0], 0.019 * sin, 0.048 * sin, 0);
        else if (name === "Reach" && reachingHeads.has(s))
          add(s.bones[0], 0.46 * wave, 0.08 * wave, 0);
        else if (s.role === "torso" && name === "Idle")
          add(s.bones[0], 0.011 * sin, 0, 0.006 * sin);
        else if (s.role === "tail" || s.role === "wing") {
          const magnitude = s.role === "wing" ? 0.12 : 0.16;
          for (let j = 0; j < s.bones.length; j++) {
            const beat =
              Math.sin(t * tau - j * 0.64) *
              magnitude *
              (name === "Walk" ? 1 : 0.4);
            if (s.role === "wing") add(s.bones[j], 0, 0, side * beat);
            else add(s.bones[j], 0, beat, 0);
          }
        }
      }
    }
    const animation = [
      new VectorKeyframeTrack(root.name + ".position", time, positions),
    ];
    for (const [bone, values] of translations)
      animation.push(
        new VectorKeyframeTrack(bone.name + ".position", time, values),
      );
    for (const [bone, values] of tracks)
      animation.push(
        new QuaternionKeyframeTrack(bone.name + ".quaternion", time, values),
      );
    const clip = new AnimationClip(name, period, animation);
    clip.optimize();
    clips.push(clip);
  }
  return [...clips, ...creatureClips(root, regions)];
}
