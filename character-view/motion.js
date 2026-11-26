import {
  creatureClips,
  standardMoves,
  spatialLeg,
  placeFootInSpace,
  floorSwing,
} from "./creature-motion.js";
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
    const spatial = spatialLeg(hip, knee, ankle);
    const upper = spatial ? hip.distanceTo(knee) : length(hip, knee),
      lower = spatial ? knee.distanceTo(ankle) : length(knee, ankle);
    if (upper < 0.01 || lower < 0.01) continue;
    result.push({
      hip,
      knee,
      ankle,
      upper,
      lower,
      spatial,
      span: spatial ? hip.distanceTo(ankle) : upper + lower,
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
function pairShoulderAxes(arms, elbowMap, regions) {
  const pairs = [];
  for (let i = 0; i < arms.length; i++) {
    const a = arms[i],
      elbowA = elbowMap.get(a);
    if (!elbowA?.hand) continue;
    const center =
      regions.get(a.part.parent)?.bounds.getCenter(new Vector3()).x ?? 0;
    for (const b of arms.slice(i + 1)) {
      const elbowB = elbowMap.get(b);
      if (!elbowB?.hand || a.part.parent !== b.part.parent) continue;
      const start = a.points[0],
        end = b.points[0];
      if ((start.x - center) * (end.x - center) <= 0) continue;
      const distance = start.distanceTo(end);
      const reach = Math.min(
        start.distanceTo(elbowA.hand.points[0]),
        end.distanceTo(elbowB.hand.points[0]),
      );
      if (distance < 0.001 || distance > reach) continue;
      pairs.push({ a, b, distance, side: start.x < center ? -1 : 1 });
    }
  }
  const paired = new Map();
  for (const { a, b, side } of pairs.sort((p, q) => p.distance - q.distance)) {
    if (paired.has(a) || paired.has(b)) continue;
    const axis = b.points[0].clone().sub(a.points[0]).normalize();
    const arm = elbowMap.get(a).hand.points[0].clone().sub(a.points[0]);
    if (new Vector3().crossVectors(axis, arm).z < 0) axis.negate();
    if (
      [a, b].some((s) => {
        const offset = elbowMap.get(s).hand.points[0].clone().sub(s.points[0]);
        return axis.clone().cross(offset).length() < offset.length() * 0.22;
      })
    )
      continue;
    const higher = a.points[0].y >= b.points[0].y ? a : b;
    const hangsDown =
      elbowMap.get(higher).hand.points[0].y <= higher.points[0].y;
    for (const [limb, neighbour] of [
      [a, b],
      [b, a],
    ]) {
      const span = limb.points[0].distanceTo(limb.points.at(-1));
      const scale = limb.object.getWorldScale(new Vector3());
      const width = limb.part.knots?.length
        ? Math.max(...limb.part.knots.map((k) => Math.max(k[3], k[4]))) *
          Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z))
        : span * 0.17;
      const clearance = limb.points[0].y >= neighbour.points[0].y ? 1.5 : 0.38;
      const angle = Math.min(0.48, Math.atan2(width * clearance, span));
      const spread = new Quaternion().setFromAxisAngle(
        new Vector3(0, 0, 1),
        (hangsDown ? side : -side) * angle,
      );
      paired.set(limb, { axis, side, spread });
    }
  }
  return paired;
}

export function buildClips(root, regions) {
  const legs = legChains(regions),
    bounds = new Box3().makeEmpty();
  for (const region of regions.values()) bounds.union(region.bounds);
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
    const hand = [...regions.values()].find(
      (region) =>
        region.part.parent === lower.part.id && region.role === "hand",
    );
    elbows.set(upper, { bone: lower.bones[0], axis, hand });
  }
  const armMovement = new Map();
  const arms = [...regions.values()].filter((s) => s.role === "upper arm");
  const hangs = (arm) =>
    elbows.has(arm) &&
    arm.points.at(-1).clone().sub(arm.points[0]).normalize().y < -0.78;
  if (arms.length === 2 && arms.every(hangs)) {
    for (const arm of arms)
      armMovement.set(arm, {
        reach: arm.points[0].x < 0 ? 1 : 0.42,
        swing: 1,
        phase: 0,
        natural: true,
      });
  }
  const heldHands = new Set();
  for (const region of regions.values()) {
    if (region.role !== "hand") continue;
    const parent = regions.get(region.part.parent);
    const upper =
      parent?.role === "forearm" ? regions.get(parent.part.parent) : parent;
    if (region.part.grip?.cylindrical || (upper?.role === "upper arm" && upper.part.holdArmPose))
      heldHands.add(region);
  }
  const openHands = [...armMovement.values()].some((m) => m.natural);
  if (arms.length > 2) {
    const ordered = [...arms].sort(
      (a, b) => b.points[0].y - a.points[0].y || a.points[0].x - b.points[0].x,
    );
    let free = 0;
    for (const [i, arm] of ordered.entries()) {
      const forearm = [...regions.values()].find(
        (s) => s.part.parent === arm.part.id && s.role === "forearm",
      );
      const hand = [...regions.values()].find(
        (s) => s.part.parent === (forearm ?? arm).part.id && s.role === "hand",
      );
      if (!elbows.has(arm) && hand && arm.bones.length >= 3) {
        elbows.set(arm, {
          hand,
          bone: arm.bones[1],
          axis: new Vector3(-1, 0, 0),
          implicit: true,
        });
      }
      const loaded =
        hand &&
        [...regions.values()].some(
          (s) =>
            s.part.parent === hand.part.id &&
            (s.role === "accessory" ||
              (s.role === "rigid" && !s.part.visibleIn)),
        );
      armMovement.set(arm, {
        loaded: Boolean(loaded),
        reach: loaded ? 0.12 : [1, 0.57, 0.36][Math.min(free++, 2)],
        swing: loaded ? 0.18 : 0.85,
        phase: i < 2 ? 0 : Math.PI,
      });
    }
  }
  const pairedAxes =
    arms.length > 2 ? pairShoulderAxes(arms, elbows, regions) : new Map();
  const reachingHeads = new Set([...regions.values()].filter(startsHeadChain));
  const size = bounds.getSize(new Vector3()),
    limb = legs.length
      ? Math.min(...legs.map((l) => l.span))
      : size.y * 0.42;
  const duration = clamp(
    1.24 * Math.sqrt(Math.max(0.1, limb) / 0.8),
    0.72,
    2.2,
  );
  const creatureBody = regions.get("body");
  const planAnimal = creatureBody?.part.shape === "sweep";
  const neckMotion = new Map();
  if (planAnimal && legs.length) {
    for (const region of regions.values()) {
      if (region.role !== "head") continue;
      const parent = regions.get(region.part.parent);
      const neck = parent?.role === "head" ? parent : region;
      const length = neck.points[0].distanceTo(neck.points.at(-1));
      const reach = Math.min(1, length / Math.max(.08, size.y*.40));
      neckMotion.set(region, { reach, skull: parent?.role === "head" });
    }
  }
  const clips = [];
  for (const name of standardMoves([...regions.values()].map((s) => s.role))) {
    const period = name === "Walk" ? duration : name === "Idle" ? 3.2 : 2.6;
    const tracks = new Map(),
      translations = new Map(),
      time = [],
      positions = [];
    function rotation(bone, q) {
      if (!tracks.has(bone)) tracks.set(bone, []);
      const data = tracks.get(bone);
      data.push(q.x, q.y, q.z, q.w);
    }
    function add(bone, x, y, z) {
      if (bone)
        rotation(bone, new Quaternion().setFromEuler(new Euler(x, y, z)));
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
          if (leg.spatial) placeFootInSpace(leg, dz, lift, drop, rotation);
          else placeFoot(leg, dz, lift, drop, add);
        }
      for (const s of regions.values()) {
        if (
          name === "Reach" &&
          s.fingers?.size &&
          !heldHands.has(s) &&
          !s.part.holdArmPose
        ) {
          for (const fingers of s.fingers.values())
            for (const digit of fingers)
              for (const [j, bone] of digit.chain.entries()) {
                const angle =
                  -(j === 0 ? 0.34 : j === 1 ? 0.55 : 0.42) *
                  wave *
                  (openHands ? 0.42 : 1) *
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
          if (s.part.holdArmPose) continue;
          const motion = armMovement.get(s);
          const pair = pairedAxes.get(s);
          if (pair) {
            const swing =
              name === "Walk"
                ? -pair.side * 0.48 * sin
                : (name === "Crouch" ? 0.42 : 0.95) *
                  (pair.side < 0 ? 1 : 0.64) *
                  wave;
            const shoulder = new Quaternion()
              .setFromAxisAngle(
                pair.axis,
                name === "Idle" ? 0.015 * sin : swing,
              )
              .multiply(pair.spread);
            rotation(s.bones[0], shoulder);
            const elbow = elbows.get(s);
            const bend = new Quaternion().setFromAxisAngle(
              elbow.axis,
              name === "Reach" ? 0.2 * motion.reach * wave : 0,
            );
            if (name === "Reach") rotation(elbow.bone, bend);
            if (motion.loaded)
              rotation(
                elbow.hand.bones[0],
                shoulder.clone().multiply(bend).invert(),
              );
            continue;
          }
          if (name === "Walk") {
            const stride = motion
              ? motion.swing * Math.sin(t * tau + motion.phase)
              : sin;
            const [least, most] = floorSwing(
              s.points[0],
              elbows.get(s)?.hand,
              bounds.min.y,
              limb * 0.082,
            );
            add(
              s.bones[0],
              clamp(side * 0.37 * stride, least, most),
              0,
              side * 0.035,
            );
          } else if (name === "Reach") {
            const lift = wave * (motion?.reach ?? 1);
            if (motion?.natural)
              add(
                s.bones[0],
                -1.28 * lift,
                side * 0.1 * lift,
                -side * 0.03 * lift,
              );
            else
              add(
                s.bones[0],
                -1.06 * lift,
                side * 0.08 * lift,
                side * 0.24 * lift,
              );
            const elbow = elbows.get(s);
            if (elbow && !elbow.implicit) {
              const q = new Quaternion().setFromAxisAngle(
                elbow.axis,
                (motion?.natural ? 0.2 : 0.67) * lift,
              );
              if (!tracks.has(elbow.bone)) tracks.set(elbow.bone, []);
              tracks.get(elbow.bone).push(q.x, q.y, q.z, q.w);
            } else add(s.bones[1], -0.42 * lift, 0, 0);
          } else if (name === "Idle")
            add(s.bones[0], 0.015 * sin, 0, side * 0.009 * sin);
          else if (name === "Crouch")
            add(s.bones[0], -0.32 * wave, 0, side * 0.09 * wave);
        } else if (name === "Walk" && neckMotion.has(s)) {
          const { reach, skull } = neckMotion.get(s);
          const footfall = Math.sin(2*t*tau - .45);
          const pitch = (.075 + .12*reach)*footfall;
          const yaw = (.035 + .07*reach)*sin;
          add(s.bones[0], skull ? -.55*pitch : pitch, skull ? -.33*yaw : yaw, .022*sin);
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
