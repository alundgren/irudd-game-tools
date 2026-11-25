// How an adult stands and walks, as a rest pose of the rig.
//
// The body, its clothes, hair and eyewear are built and fitted in the fitting pose. A posture
// turns the joints of the finished rig, so everything that is skinned to the skull, an arm or the
// pelvis follows, and no measurement of the head or body ever sees the pose. The same solver
// writes the Idle, Walk, Reach and Crouch clips of a figure that has a posture.
import {
  AnimationClip,
  MathUtils,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
} from "three";
import { randomStream } from "./random.js";

const rad = MathUtils.degToRad,
  clamp = MathUtils.clamp,
  tau = 2 * Math.PI;
const X = new Vector3(1, 0, 0),
  Y = new Vector3(0, 1, 0),
  Z = new Vector3(0, 0, 1);

// Every control, its range and the value an unnamed control takes.
export const postureRanges = {
  weight: [-1, 1, 0], // the leg that carries the body: left above zero
  hip: [0, 1, 0.5], // how far the pelvis drops on the free side
  lean: [-1, 1, 0], // hips forward and shoulders back, or leaning into a step
  slouch: [-1, 1, 0], // chest lifted, or the upper back rounded
  twist: [-1, 1, 0], // shoulders turned against the hips, to the left above zero
  shoulders: [-1, 1, 0], // left shoulder carried higher above zero
  shrug: [-1, 1, 0], // both shoulders dropped or raised
  arms: [0, 1, 0.95], // from the fitting pose to hanging as close as the body allows
  elbows: [0, 1, 0.3],
  hands: [0, 1, 0.55], // fingers falling into a loose curl
  headTilt: [-1, 1, 0], // toward the left shoulder above zero
  headTurn: [-1, 1, 0], // looking to the left above zero
  chin: [-1, 1, 0],
  feet: [-1, 1, 0], // narrow to wide
  toes: [-1, 1, 0.2], // turned in or out
  step: [-1, 1, 0], // free foot behind or ahead
  stride: [-1, 1, 0], // length of the walking step
  handAtWaist: [-1, 1, 0], // support the right or left hand on the dressed hip
  swing: [-1, 1, 0], // how freely the arms and shoulders swing in the walk
};
export const postureAxes = Object.keys(postureRanges);
export const postureLabels = {
  weight: "Weight on right or left leg",
  hip: "Hip drop",
  lean: "Sway back to forward lean",
  slouch: "Lifted chest to slouch",
  twist: "Shoulder turn",
  shoulders: "Shoulder tilt",
  shrug: "Shoulders dropped to raised",
  arms: "Arms hanging",
  elbows: "Elbow bend",
  hands: "Relaxed fingers",
  headTilt: "Head tilt",
  headTurn: "Head turn",
  chin: "Chin down to up",
  feet: "Feet narrow to wide",
  toes: "Toes in to out",
  step: "Free foot back to forward",
  stride: "Walking stride",
  swing: "Walking arm swing",
  handAtWaist: "Right or left hand on hip",
};
// Controls that change sign when a posture is mirrored.
const sided = ["weight", "twist", "shoulders", "headTilt", "headTurn", "handAtWaist"];

// Ways of standing, written with the weight on the left leg.
export const postureStyles = {
  Easy: { weight: 0.5, hip: 0.45, slouch: 0.15, elbows: 0.35, toes: 0.25, step: 0.15, headTilt: 0.1 },
  "Hip-shot": { weight: 0.95, hip: 0.9, slouch: 0.05, twist: 0.2, shoulders: 0.25, hands: 0.6, feet: 0.1, toes: 0.55, step: 0.45, headTilt: 0.3, headTurn: -0.2 },
  Upright: { weight: 0.12, hip: 0.2, slouch: -0.6, shrug: -0.2, arms: 1, elbows: 0.15, hands: 0.35, feet: -0.35, toes: 0.1, chin: 0.2, stride: 0.25, swing: 0.2 },
  Slouched: { weight: 0.55, hip: 0.5, slouch: 0.75, lean: -0.2, shrug: -0.35, arms: 1, elbows: 0.2, hands: 0.75, feet: 0.05, toes: 0.3, chin: -0.15, headTilt: -0.15, stride: -0.4, swing: -0.45 },
  Planted: { weight: 0, hip: 0, slouch: -0.15, arms: 0.8, elbows: 0.45, hands: 0.45, feet: 0.7, toes: 0.45, stride: 0.1, swing: 0.1 },
  Guarded: { weight: 0.6, hip: 0.4, slouch: 0.25, twist: 0.55, shrug: 0.35, arms: 0.9, elbows: 0.6, hands: 0.8, feet: 0.1, toes: 0.2, step: -0.5, headTurn: -0.45, chin: -0.2, stride: -0.2, swing: -0.5 },
  Weary: { weight: 0.75, hip: 0.6, slouch: 0.45, lean: 0.3, shrug: -0.5, arms: 1, elbows: 0.1, hands: 0.7, feet: -0.1, toes: 0.25, step: 0.1, chin: -0.3, headTilt: 0.25, stride: -0.6, swing: -0.6 },
  Poised: { weight: 0.7, hip: 0.55, slouch: -0.35, twist: -0.2, elbows: 0.4, hands: 0.4, feet: -0.45, toes: 0.35, step: 0.6, headTilt: 0.2, headTurn: 0.25, chin: 0.1, stride: 0.15, swing: -0.1 },
  "Sway-back": { weight: 0.3, hip: 0.3, lean: -0.7, slouch: 0.3, hands: 0.6, feet: 0.25, toes: 0.5, chin: 0.1, stride: -0.2, swing: 0.2 },
  Brisk: { weight: 0.25, hip: 0.3, slouch: -0.25, lean: 0.25, elbows: 0.5, hands: 0.7, feet: -0.1, toes: 0.1, step: 0.3, chin: 0.05, stride: 0.7, swing: 0.7 },
};
export const postureStyleNames = Object.keys(postureStyles);

export function validPosture(p) {
  return (
    Boolean(p) &&
    typeof p === "object" &&
    !Array.isArray(p) &&
    Object.entries(p).every(([key, value]) =>
      key === "style"
        ? postureStyleNames.includes(value)
        : Object.hasOwn(postureRanges, key) &&
          Number.isFinite(value) &&
          value >= postureRanges[key][0] &&
          value <= postureRanges[key][1],
    )
  );
}
const read = (p, key) => p[key] ?? postureRanges[key][2];
const round = (v) => Math.round(v * 100) / 100;
function tidy(values) {
  const out = {};
  if (values.style) out.style = values.style;
  for (const key of postureAxes) {
    if (values[key] === undefined) continue;
    const [lo, hi] = postureRanges[key];
    out[key] = round(clamp(values[key], lo, hi)) || 0;
  }
  return out;
}
/** A named way of standing, with the weight on the left leg or mirrored onto the right. */
export function posturePreset(style, mirrored = false) {
  if (!Object.hasOwn(postureStyles, style)) throw new Error("Unknown standing posture.");
  const p = tidy({ style, ...postureStyles[style] });
  return mirrored ? mirrorPosture(p) : p;
}
export function mirrorPosture(p) {
  const out = { ...p };
  for (const key of sided) if (out[key]) out[key] = -out[key];
  return out;
}
/** One adult's own way of standing and walking. Age and build weigh the choice, the seed decides. */
export function drawPosture(seed, human = {}) {
  const draw = randomStream((seed ^ 0x9c2f41d7) >>> 0);
  const age = human.age ?? 0,
    mass = Math.max(0, human.weight ?? 0),
    muscle = Math.max(0, human.muscle ?? 0);
  const odds = {
    Easy: 3,
    "Hip-shot": 1.6 - 0.6 * age,
    Upright: 1.3 + muscle,
    Slouched: 1 + 0.8 * age,
    Planted: 0.8 + 1.2 * mass + 0.7 * muscle,
    Guarded: 0.8,
    Weary: 0.4 + 1.8 * age,
    Poised: 1.3 - 0.7 * mass,
    "Sway-back": 0.4 + 1.3 * mass + 0.5 * age,
    Brisk: 1.1 - 0.6 * age,
  };
  let at = draw() * Object.values(odds).reduce((n, v) => n + Math.max(0.05, v), 0),
    style = "Easy";
  for (const [name, weight] of Object.entries(odds)) {
    at -= Math.max(0.05, weight);
    if (at <= 0) {
      style = name;
      break;
    }
  }
  const values = { style };
  for (const key of postureAxes) {
    if (key === "handAtWaist") continue;
    const [lo, hi, initial] = postureRanges[key];
    const base = postureStyles[style][key] ?? initial;
    // Each person departs from the type. The fitting arm angle stays near the body.
    const spread = key === "arms" ? 0.05 : key === "headTurn" || key === "headTilt" ? 0.22 : 0.16;
    values[key] = clamp(base + (draw() * 2 - 1) * spread * (hi - lo) * 0.5, lo, hi);
  }
  values.arms = Math.max(0.78, values.arms);
  const mirrored = draw() < 0.5;
  const gestureShare = { "Hip-shot": 0.68, Easy: 0.24, Brisk: 0.28, Poised: 0.28, Planted: 0.26 };
  if (draw() < (gestureShare[style] ?? 0)) values.handAtWaist = 1;
  return mirrored ? mirrorPosture(tidy(values)) : tidy(values);
}

const arc = (from, to) => new Quaternion().setFromUnitVectors(from, to);
const turn = (axis, angle) => new Quaternion().setFromAxisAngle(axis, angle);
// A joint turn from a forward pitch, a turn to the left and a roll that lifts the left side.
function joint(pitch, yaw = 0, roll = 0) {
  return turn(Y, yaw).multiply(turn(Z, roll)).multiply(turn(X, pitch));
}
function frame(along, hinge) {
  const h = hinge.clone().addScaledVector(along, -hinge.dot(along)).normalize();
  const third = new Vector3().crossVectors(along, h);
  // Columns of a rotation matrix, as a quaternion.
  const m = [along.x, h.x, third.x, along.y, h.y, third.y, along.z, h.z, third.z];
  const trace = m[0] + m[4] + m[8];
  const q = new Quaternion();
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    q.set((m[7] - m[5]) * s, (m[2] - m[6]) * s, (m[3] - m[1]) * s, 0.25 / s);
  } else if (m[0] > m[4] && m[0] > m[8]) {
    const s = 2 * Math.sqrt(1 + m[0] - m[4] - m[8]);
    q.set(0.25 * s, (m[1] + m[3]) / s, (m[2] + m[6]) / s, (m[7] - m[5]) / s);
  } else if (m[4] > m[8]) {
    const s = 2 * Math.sqrt(1 + m[4] - m[0] - m[8]);
    q.set((m[1] + m[3]) / s, 0.25 * s, (m[5] + m[7]) / s, (m[2] - m[6]) / s);
  } else {
    const s = 2 * Math.sqrt(1 + m[8] - m[0] - m[4]);
    q.set((m[2] + m[6]) / s, (m[5] + m[7]) / s, 0.25 * s, (m[3] - m[1]) / s);
  }
  return q.normalize();
}
// World turn that carries the bind frame (along0, hinge0) onto (along, hinge).
function carry(along0, hinge0, along, hinge) {
  return frame(along, hinge).multiply(frame(along0, hinge0).invert());
}
const smooth = (t) => t * t * (3 - 2 * t);
const smoother = (t) => t * t * t * (t * (6 * t - 15) + 10);

const needed = [
  "pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "head",
  ...["clavicle", "upperarm", "lowerarm", "hand", "thigh", "calf", "foot", "ball"].flatMap((n) => [n + "_l", n + "_r"]),
];
const digits = { index: 0.72, middle: 0.86, ring: 1, pinky: 1.1, thumb: 0.3 };

/**
 * The joints of an adult rig that a posture turns. Returns null for a rig without the adult
 * skeleton, such as a creature or an adult whose limbs were replaced.
 */
export function postureRig(regions, root, skeleton, mesh, handProp) {
  const byBone = new Map();
  for (const r of regions.values())
    if (r.part.humanBone && !r.part.humanSource && !byBone.has(r.part.humanBone))
      byBone.set(r.part.humanBone, r);
  if (!needed.every((name) => byBone.has(name))) return null;
  const bone = (name) => byBone.get(name).bones[0],
    at = (name) => byBone.get(name).points[0].clone();
  for (const name of needed)
    if (bone(name).quaternion.lengthSq() < 0.99 || Math.abs(bone(name).quaternion.w) < 0.999999) return null;
  const sides = [
    ["_l", 1],
    ["_r", -1],
  ].map(([suffix, side]) => {
    const hip = at("thigh" + suffix),
      knee = at("calf" + suffix),
      ankle = at("foot" + suffix),
      ball = at("ball" + suffix);
    const shoulder = at("upperarm" + suffix),
      elbow = at("lowerarm" + suffix),
      wrist = at("hand" + suffix);
    const heading = new Vector3(ball.x - ankle.x, 0, ball.z - ankle.z);
    const reach = heading.length();
    heading.normalize();
    // The knee hinges square to the leg and the foot, whatever small bow the fitted leg has.
    const line = ankle.clone().sub(hip).normalize();
    const pole = heading.clone().addScaledVector(line, -heading.dot(line)).normalize();
    const kneeHinge = new Vector3().crossVectors(line, pole).normalize();
    const upper = elbow.clone().sub(shoulder).normalize(),
      lower = wrist.clone().sub(elbow).normalize();
    // The elbow folds the forearm forward, as in the generated reach.
    const elbowAxis = new Vector3().crossVectors(upper, lower);
    if (elbowAxis.lengthSq() < 0.025) elbowAxis.crossVectors(lower, Z);
    if (elbowAxis.lengthSq() < 0.001) elbowAxis.set(-1, 0, 0);
    elbowAxis.normalize();
    if (new Vector3().crossVectors(elbowAxis, lower).z < 0) elbowAxis.negate();
    const fingers = [];
    const index = byBone.get("index_01" + suffix),
      pinky = byBone.get("pinky_01" + suffix);
    if (index && pinky) {
      const across = pinky.points[0].clone().sub(index.points[0]).normalize().multiplyScalar(side);
      const along = (digit) => {
        const a = byBone.get(digit + "_01" + suffix),
          b = byBone.get(digit + "_02" + suffix);
        return a && b ? b.points[0].clone().sub(a.points[0]).normalize() : null;
      };
      const middle = along("middle");
      for (const [digit, bend] of Object.entries(digits)) {
        const axis = across.clone();
        if (digit === "thumb") axis.lerp(new Vector3(side, 0, 0), 0.7).normalize();
        // A relaxed hand closes the fan the fitted fingers are spread in.
        const own = digit === "thumb" || digit === "middle" ? null : along(digit);
        [0.64, 1, 0.63].forEach((factor, i) => {
          const r = byBone.get(digit + "_0" + (i + 1) + suffix);
          if (r) fingers.push({ bone: r.bones[0], axis, bend: bend * factor, gather: i === 0 && own && middle ? arc(own, middle) : null });
        });
      }
    }
    return {
      side, suffix,
      fanGrip: side === -1 && handProp === "Painted folding fan" && ["index_01", "index_02", "thumb_01", "thumb_02", "thumb_03"].every(id => byBone.has(id + "_r")) ? makeFanGrip(byBone) : null,
      hipBone: bone("thigh" + suffix), kneeBone: bone("calf" + suffix), footBone: bone("foot" + suffix), toeBone: bone("ball" + suffix),
      clavicle: bone("clavicle" + suffix), shoulderBone: bone("upperarm" + suffix), elbowBone: bone("lowerarm" + suffix), wristBone: bone("hand" + suffix),
      hip, knee, ankle, ball, shoulder, elbow, wrist,
      palm: byBone.get("middle_01" + suffix)?.points[0].clone().sub(wrist),
      acrossPalm: index && pinky ? pinky.points[0].clone().sub(index.points[0]).normalize() : null,
      thigh: hip.distanceTo(knee), shin: knee.distanceTo(ankle),
      thighDir: knee.clone().sub(hip).normalize(), shinDir: ankle.clone().sub(knee).normalize(),
      kneeHinge, heading, yaw: Math.atan2(heading.x, heading.z), footReach: reach,
      upper, lower, elbowAxis, upperLength: shoulder.distanceTo(elbow), fingers,
      elbowBend: Math.acos(clamp(upper.dot(lower), -1, 1)),
      // How far off the body the arm was fitted. A hanging arm never stands further out.
      fitted: Math.atan2(Math.hypot(upper.x, upper.z), -upper.y),
    };
  });
  const pelvis = at("pelvis");
  const rig = {
    root, skeleton, mesh, regions, sides, left: sides[0], right: sides[1],
    pelvisBone: bone("pelvis"), pelvis,
    spine: ["spine_01", "spine_02", "spine_03"].map(bone),
    neckBone: bone("neck_01"), headBone: bone("head"),
    neck: at("neck_01"), head: at("head"),
    floor: Math.min(sides[0].ankle.y, sides[1].ankle.y),
    rootRest: root.position.clone(),
    pelvisRest: bone("pelvis").position.clone(),
    limb: Math.min(...sides.map((s) => s.thigh + s.shin)),
  };
  rig.half = (sides[0].ankle.x - sides[1].ankle.x) / 2;
  rig.hipHalf = (sides[0].hip.x - sides[1].hip.x) / 2;
  rig.bones = [
    rig.pelvisBone, ...rig.spine, rig.neckBone, rig.headBone,
    ...sides.flatMap((s) => [s.clavicle, s.shoulderBone, s.elbowBone, s.wristBone, s.hipBone, s.kneeBone, s.footBone, s.toeBone, ...s.fingers.map((f) => f.bone)]),
  ];
  rig.narrowest = legRoom(rig);
  rig.skirted = skirtDepth(rig);
  rig.arms = sides.map((s) => armSamples(rig, s));
  return rig;
}

// Vertices of the bound surface that follow the given regions and everything attached to them.
function owners(rig, ids) {
  const wanted = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const r of rig.regions.values())
      if (!wanted.has(r.part.id) && wanted.has(r.part.parent)) {
        wanted.add(r.part.id);
        grew = true;
      }
  }
  const bones = new Set();
  for (const r of rig.regions.values()) if (wanted.has(r.part.id)) for (const b of r.bones) bones.add(rig.skeleton.bones.indexOf(b));
  return bones;
}
function dominant(mesh, i) {
  const ids = mesh.geometry.attributes.skinIndex.array,
    w = mesh.geometry.attributes.skinWeight.array;
  let best = 0;
  for (let j = 1; j < 4; j++) if (w[4 * i + j] > w[4 * i + best]) best = j;
  return ids[4 * i + best];
}
// How near the midline each ankle may come before the legs or their clothes meet.
function legRoom(rig) {
  if (!rig.mesh) return rig.half;
  const p = rig.mesh.geometry.attributes.position;
  let limit = 0;
  for (const s of rig.sides) {
    const bones = owners(rig, [...rig.regions.values()].filter((r) => ["thigh", "calf"].some((n) => r.part.humanBone === n + s.suffix)).map((r) => r.part.id));
    // Above this the thighs meet anyway, in the flesh and in the seat of the trousers.
    const high = s.hip.y - 0.62 * (s.hip.y - s.knee.y);
    let slope = Infinity;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y > high || y < s.ankle.y || !bones.has(dominant(rig.mesh, i))) continue;
      slope = Math.min(slope, (s.side * p.getX(i) - 0.004) / (s.hip.y - y));
    }
    const drop = s.hip.y - s.ankle.y;
    limit = Math.max(limit, s.side * s.ankle.x - (Number.isFinite(slope) ? Math.max(0, slope) : 0) * drop);
  }
  return clamp(limit, 0.045, Math.max(0.045, rig.half));
}
// How far below the knees cloth hangs between the legs: 0 for trousers, 1 for a hem at the ankles.
function skirtDepth(rig) {
  if (!rig.mesh) return 0;
  const p = rig.mesh.geometry.attributes.position;
  const band = clamp(rig.half - 0.09, 0, 0.02),
    knee = (rig.left.knee.y + rig.right.knee.y) / 2;
  let low = knee,
    found = 0;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y >= knee || Math.abs(p.getX(i)) >= band) continue;
    found++;
    low = Math.min(low, y);
  }
  return found < 12 ? 0 : clamp((knee - low) / Math.max(0.01, knee - rig.floor), 0, 1);
}
// Points on the lower arm and hand, and the points of the body they must not sink into.
function armSamples(rig, s) {
  if (!rig.mesh) return null;
  const mesh = rig.mesh,
    p = mesh.geometry.attributes.position;
  const arm = owners(rig, [...rig.regions.values()].filter((r) => ["upperarm", "lowerarm", "hand"].some((n) => r.part.humanBone === n + s.suffix)).map((r) => r.part.id));
  const girdle = owners(rig, [...rig.regions.values()].filter((r) => /^(clavicle|upperarm)_[lr]$/.test(r.part.humanBone ?? "")).map((r) => r.part.id));
  const hand = owners(rig, [...rig.regions.values()].filter((r) => r.part.humanBone === "hand" + s.suffix).map((r) => r.part.id));
  const sleeve = [],
    palm = [],
    body = [];
  const v = new Vector3(),
    outer = new Map(),
    rest = [];
  // The forearm and hand are tested against the body from the lower ribs down. Skin around the
  // armpit belongs to both and says nothing about where the arm may hang.
  for (let i = 0; i < p.count; i++) {
    const owner = dominant(mesh, i);
    v.fromBufferAttribute(p, i);
    if (arm.has(owner)) {
      const k = flankKey(v.y, v.z);
      if (!(outer.get(k) >= s.side * v.x)) outer.set(k, s.side * v.x);
      if (v.distanceTo(s.shoulder) > 0.9 * s.upperLength) (hand.has(owner) ? palm : sleeve).push(i);
    } else if (!girdle.has(owner) && s.side * v.x > -0.01 && v.y < s.shoulder.y - 0.7 * s.upperLength && v.y > s.knee.y) rest.push(i);
  }
  // A cloak that hangs over the fitted arm is no obstacle: the arm is free to move under it.
  for (const i of rest) if (!(s.side * p.getX(i) > outer.get(flankKey(p.getY(i), p.getZ(i))) - 0.005)) body.push(i);
  const thin = (list, most) => (list.length > most ? list.filter((_, k) => k % Math.ceil(list.length / most) === 0) : list);
  const kept = [thin(sleeve, 260), thin(palm, 160)];
  // Cloth gives where a sleeve rests against it. A hand stays outside what it hangs beside.
  return { points: kept.flat(), give: [...kept[0].map(() => 0.022), ...kept[1].map(() => 0.009)], body: thin(body, 6000), waist: waistContact(body, p, s) };
}
function skinned(rig, list) {
  const mesh = rig.mesh,
    out = new Float32Array(list.length * 3),
    v = new Vector3();
  rig.root.parent?.updateMatrixWorld(true);
  rig.root.updateMatrixWorld(true);
  mesh.skeleton.update();
  list.forEach((i, k) => mesh.getVertexPosition(i, v).toArray(out, k * 3));
  return out;
}

function worldQuat(bone, root) {
  const chain = [];
  for (let b = bone; b; b = b.parent) {
    chain.push(b);
    if (b === root) break;
  }
  const q = new Quaternion();
  for (let i = chain.length - 1; i >= 0; i--) q.multiply(chain[i].quaternion);
  return q;
}
function worldPoint(bone, root) {
  const chain = [];
  for (let b = bone; b; b = b.parent) {
    chain.push(b);
    if (b === root) break;
  }
  const q = new Quaternion(),
    p = new Vector3(),
    v = new Vector3();
  for (let i = chain.length - 1; i >= 0; i--) {
    p.add(v.copy(chain[i].position).applyQuaternion(q));
    q.multiply(chain[i].quaternion);
  }
  return p;
}
function setWorld(bone, root, q) {
  bone.quaternion.copy(worldQuat(bone.parent, root).invert().multiply(q)).normalize();
}

// Place a foot: turn the thigh, shin and foot so the ankle meets its target with the knee
// folding toward the toes. Pitch tips the toes down and `toe` bends them back to the floor.
function placeLeg(rig, s, target) {
  const hip = worldPoint(s.hipBone, rig.root);
  const to = target.ankle.clone().sub(hip);
  const full = s.thigh + s.shin,
    most = full * 0.9993,
    least = Math.abs(s.thigh - s.shin) + 0.01;
  let d = to.length();
  // A walking leg eases into full extension, so the knee never snaps straight.
  const soft = full * 0.9955;
  if (target.eased && d > soft) d = soft + (most - soft) * (1 - Math.exp(-(d - soft) / (most - soft)));
  d = clamp(d, least, most);
  const line = to.normalize();
  const yaw = target.yaw,
    ahead = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const pole = ahead.addScaledVector(line, -ahead.dot(line)).normalize();
  const a = (s.thigh * s.thigh - s.shin * s.shin + d * d) / (2 * d),
    h = Math.sqrt(Math.max(0, s.thigh * s.thigh - a * a));
  const knee = hip.clone().addScaledVector(line, a).addScaledVector(pole, h),
    ankle = hip.clone().addScaledVector(line, d);
  const hinge = new Vector3().crossVectors(line, pole).normalize();
  const upper = carry(s.thighDir, s.kneeHinge, knee.clone().sub(hip).normalize(), hinge),
    lower = carry(s.shinDir, s.kneeHinge, ankle.clone().sub(knee).normalize(), hinge);
  setWorld(s.hipBone, rig.root, upper);
  s.kneeBone.quaternion.copy(upper.clone().invert().multiply(lower)).normalize();
  const foot = turn(Y, yaw - s.yaw).multiply(turn(X, target.pitch ?? 0));
  s.footBone.quaternion.copy(lower.invert().multiply(foot)).normalize();
  s.toeBone.quaternion.copy(turn(X, -(target.toe ?? 0)));
  return hip.y + line.y * d - target.ankle.y;
}
// Height of the hips that leaves the given leg just short of straight over its foot.
function hipHeight(rig, s, pelvisQ, pelvisAt, ankle, ease) {
  const offset = s.hip.clone().sub(rig.pelvis).applyQuaternion(pelvisQ);
  const dx = pelvisAt.x + offset.x - ankle.x,
    dz = pelvisAt.z + offset.z - ankle.z;
  const length = (s.thigh + s.shin) * (1 - ease);
  return ankle.y + Math.sqrt(Math.max(0.0001, length * length - dx * dx - dz * dz)) - offset.y;
}
function setPelvis(rig, at, q) {
  // The pelvis hangs from the root, whose own turn stays as built.
  rig.pelvisBone.quaternion.copy(q);
  rig.pelvisBone.position.copy(rig.pelvisRest).add(at.clone().sub(rig.pelvis));
}
// Let an arm fall from where the shoulder carries it toward a hanging line, as far as `hang`
// says, then swing it and fold the joints. `ease` is how far the joints below the shoulder
// leave the fitting pose, and `release` lets go of a forearm that was fitted raised.
function placeArm(rig, s, arm) {
  const parent = worldQuat(s.clavicle, rig.root);
  const carried = s.upper.clone().applyQuaternion(parent);
  const a = arm.abduct,
    f = arm.forward,
    ease = arm.ease ?? arm.hang;
  const down = new Vector3(s.side * Math.sin(a), -Math.cos(a) * Math.cos(f), Math.cos(a) * Math.sin(f));
  const world = new Quaternion().slerp(arc(carried, down), arm.hang).multiply(parent);
  // The hanging arm turns in about its own length, so the hand rests against the thigh.
  if (arm.roll) world.premultiply(turn(s.upper.clone().applyQuaternion(world), s.side * arm.roll * arm.hang));
  if (arm.swing) world.premultiply(turn(X.clone().applyQuaternion(parent), -arm.swing));
  s.shoulderBone.quaternion.copy(parent.invert().multiply(world)).normalize();
  // A forearm fitted in a raised gesture keeps it. Any other elbow takes the bend asked for.
  const free = Math.max(arm.release ?? 0, 1 - MathUtils.smoothstep(s.elbowBend, rad(42), rad(62)));
  s.elbowBone.quaternion.copy(turn(s.elbowAxis, (arm.elbow - s.elbowBend) * free * ease + (arm.bend ?? 0)));
  s.wristBone.quaternion.copy(turn(s.elbowAxis, (arm.wrist ?? 0) * ease));
  if (s.fanGrip && arm.showFan>0) holdFan(rig,s,arm.showFan);
  else if (arm.waist > 0) restHandAtWaist(rig, s, arm.waist);
  const curl = arm.fingers ?? 0,
    still = new Quaternion();
  for (const f of s.fingers) {
    f.bone.quaternion.copy(turn(f.axis, f.bend * curl));
    if (f.gather) f.bone.quaternion.premultiply(still.identity().slerp(f.gather, clamp(curl * 0.9, 0, 0.8)));
  }
  if (s.fanGrip) for (const [bone,rotation] of s.fanGrip) bone.quaternion.copy(rotation);
}
// Locate the hand on this figure's dressed flank. The palm rests on the
// anterolateral hip; the wrist stands above it and the elbow points out and back.
function waistContact(points, positions, side) {
  const y = side.hip.y + 0.25 * (side.shoulder.y - side.hip.y);
  const normal = new Vector3(side.side * 0.86, 0, 0.51);
  let best = -Infinity, contact = null;
  const point = new Vector3();
  for (const i of points) {
    point.fromBufferAttribute(positions, i);
    const dy = Math.abs(point.y - y);
    if (dy > 0.055) continue;
    const extent = point.dot(normal) - 2 * dy;
    if (extent > best) {
      best = extent;
      contact = point.clone();
    }
  }
  return contact?.addScaledVector(normal, 0.018);
}

// Pinch the guard between thumb and forefinger. The pin lies close to the
// middle joint of the forefinger. All rotations below the wrist remain local.
function makeFanGrip(regions) {
  const at=id=>regions.get(id+"_r").points[0];
  const bone=id=>regions.get(id+"_r").bones[0];
  const grip=at("index_02").clone();
  const a=at("thumb_01"), b=at("thumb_02"), c=at("thumb_03");
  grip.addScaledVector(c.clone().sub(grip).normalize(), .012);
  const line=grip.sub(a), ab=b.distanceTo(a), bc=c.distanceTo(b);
  const distance=clamp(line.length(),Math.abs(ab-bc)+.0001,ab+bc-.0001);
  line.normalize();
  const pole=b.clone().sub(a);pole.addScaledVector(line,-pole.dot(line)).normalize();
  const proj=(ab*ab-bc*bc+distance*distance)/(2*distance);
  const mid=line.clone().multiplyScalar(proj).addScaledVector(pole,Math.sqrt(Math.max(0,ab*ab-proj*proj)));
  const first=arc(b.clone().sub(a).normalize(),mid.clone().normalize());
  const distal=arc(c.clone().sub(b).normalize(),line.multiplyScalar(distance).sub(mid).normalize());
  return [[bone("index_01"),new Quaternion()],[bone("thumb_01"),first],
    [bone("thumb_02"),first.clone().invert().multiply(distal)],[bone("thumb_03"),new Quaternion()]];
}

// Present the fan just outside the chest. Its face follows the pinch while the
// wrist and bent elbow track the performing character's upper-body turn.
function holdFan(rig,s,amount) {
  if(!s.palm||!s.acrossPalm) return;
  const upperWorld=worldQuat(rig.spine.at(-1),rig.root);
  const shoulder=worldPoint(s.shoulderBone,rig.root);
  const scale=s.upperLength/.28;
  const wrist=new Vector3(-.047,-.225,.205).multiplyScalar(scale).applyQuaternion(upperWorld).add(shoulder);
  const forward=new Vector3(.88,.34,.27).normalize().applyQuaternion(upperWorld);
  const across=new Vector3(.27,-.95,-.14).normalize().applyQuaternion(upperWorld);
  const pole=new Vector3(-.74,-.80,-.30).applyQuaternion(upperWorld);
  placeHand(rig,s,amount,wrist,pole,forward,across);
}

function restHandAtWaist(rig, s, amount) {
  const contact = rig.arms[rig.sides.indexOf(s)]?.waist;
  if (!contact || !s.palm || !s.acrossPalm) return;
  const pelvis = worldPoint(rig.pelvisBone, rig.root);
  const waistTurn = worldQuat(rig.pelvisBone, rig.root);
  const wrist = contact.clone().sub(rig.pelvis).applyQuaternion(waistTurn).add(pelvis);
  const down = new Vector3(-s.side * 0.22, -0.85, 0.48).normalize().applyQuaternion(waistTurn);
  wrist.addScaledVector(down, -s.palm.length());
  const pole = new Vector3(s.side * 0.9, -0.28, -0.64).applyQuaternion(waistTurn);
  const across = new Vector3(s.side * 0.48, 0, -0.86).applyQuaternion(waistTurn);
  placeHand(rig,s,amount,wrist,pole,down,across);
}

function placeHand(rig,s,amount,wrist,pole,down,across) {
  const shoulder = worldPoint(s.shoulderBone, rig.root);
  const line = wrist.sub(shoulder);
  const upperLength = s.upperLength, lowerLength = s.elbow.distanceTo(s.wrist);
  const length = clamp(line.length(), Math.abs(upperLength - lowerLength) + 0.001, upperLength + lowerLength - 0.001);
  line.normalize();
  pole.addScaledVector(line, -pole.dot(line)).normalize();
  const along = (upperLength ** 2 - lowerLength ** 2 + length ** 2) / (2 * length);
  const elbow = line.clone().multiplyScalar(along).addScaledVector(pole, Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2)));
  const forearm = line.multiplyScalar(length).sub(elbow).normalize();
  elbow.normalize();
  const hinge = new Vector3().crossVectors(elbow, forearm).normalize();
  if (new Vector3().crossVectors(s.upper, s.lower).dot(s.elbowAxis) < 0) hinge.negate();
  const armTurn = carry(s.upper, s.elbowAxis, elbow, hinge);
  const lowerTurn = carry(s.lower, s.elbowAxis, forearm, hinge);
  const handTurn = carry(s.palm.clone().normalize(), s.acrossPalm, down, across);
  const shoulderTurn = worldQuat(s.clavicle, rig.root).invert().multiply(armTurn);
  s.shoulderBone.quaternion.slerp(shoulderTurn, amount);
  s.elbowBone.quaternion.slerp(armTurn.invert().multiply(lowerTurn), amount);
  s.wristBone.quaternion.slerp(lowerTurn.invert().multiply(handTurn), amount);
}

// The body seen from one side: how far out it reaches at each height and depth. An arm point
// nearer the midline than that, at its own height and depth, is inside the body or its clothes.
const flankCell = 0.018;
const flankKey = (y, z) => (Math.floor(y / flankCell) + 4096) * 8192 + Math.floor(z / flankCell) + 4096;
function flank(rig, s) {
  const samples = rig.arms[rig.sides.indexOf(s)];
  if (!samples?.body.length) return null;
  const p = skinned(rig, samples.body),
    reach = new Map();
  for (let i = 0; i < p.length; i += 3) {
    const k = flankKey(p[i + 1], p[i + 2]),
      x = s.side * p[i];
    if (!(reach.get(k) >= x)) reach.set(k, x);
  }
  return reach;
}
// How far the arm may fall before the lower arm and hand sink into the trunk, the hips, a
// skirt or something carried at the waist. The fitted arm is the measure of what is clear.
function armRoom(rig, s, arm, reach) {
  const samples = rig.arms[rig.sides.indexOf(s)];
  if (!samples?.points.length || !reach) return arm.hang;
  function sunk(hang) {
    placeArm(rig, s, { ...arm, hang });
    const p = skinned(rig, samples.points);
    let hits = 0;
    for (let i = 0; i < p.length; i += 3) if (s.side * p[i] < (reach.get(flankKey(p[i + 1], p[i + 2])) ?? -Infinity) - samples.give[i / 3]) hits++;
    return hits;
  }
  const allowed = sunk(0) + Math.max(3, samples.points.length * 0.04);
  for (let k = 12; k > 0; k--) if (sunk((arm.hang * k) / 12) <= allowed) return (arm.hang * k) / 12;
  return 0;
}
// Where the body's mass sits, from the usual shares of each segment.
export function massCentre(rig) {
  const at = (b) => worldPoint(b, rig.root),
    sum = new Vector3();
  let total = 0;
  const add = (a, b, t, share) => {
    sum.addScaledVector(a.clone().lerp(b, t), share);
    total += share;
  };
  const pelvis = at(rig.pelvisBone),
    neck = at(rig.neckBone),
    head = at(rig.headBone);
  add(pelvis, neck, 0.42, 0.5);
  add(neck, head, 1.25, 0.08);
  for (const s of rig.sides) {
    const elbow = at(s.elbowBone),
      wrist = at(s.wristBone),
      knee = at(s.kneeBone),
      ankle = at(s.footBone);
    add(at(s.shoulderBone), elbow, 0.45, 0.027);
    add(elbow, wrist, 0.68, 0.022);
    add(at(s.hipBone), knee, 0.43, 0.1);
    add(knee, ankle, 0.43, 0.046);
    add(ankle, at(s.toeBone), 0.5, 0.014);
  }
  return sum.multiplyScalar(1 / total);
}

/**
 * Pose the whole figure. `body` holds the pelvis (offset from its fitted place and turn), the
 * feet, the local turns of spine, neck and head, and both arms. Every joint the posture owns
 * is written, so one call fully replaces the last.
 */
function pose(rig, body) {
  setPelvis(rig, body.pelvis.at, body.pelvis.turn);
  rig.sides.forEach((s, i) => placeLeg(rig, s, body.feet[i]));
  body.spine.forEach((q, i) => rig.spine[i].quaternion.copy(q));
  rig.sides.forEach((s, i) => s.clavicle.quaternion.copy(body.clavicles[i]));
  rig.neckBone.quaternion.copy(body.neck);
  rig.headBone.quaternion.copy(body.head);
  rig.sides.forEach((s, i) => placeArm(rig, s, body.arms[i]));
}

// The trunk above the pelvis for a posture: spine, shoulders and head.
// `turned` is how far the pelvis already leans and turns, which the trunk partly answers.
function trunk(rig, p, { tilt = 0, yaw = 0, pitch = 0, keep = 1, headYaw = null, extraPitch = 0, extraYaw = 0, extraRoll = 0 } = {}) {
  const slouch = read(p, "slouch") * keep,
    lean = read(p, "lean") * keep,
    twist = read(p, "twist") * keep;
  const round = Math.max(0, slouch),
    lift = Math.max(0, -slouch);
  // Forward pitch of each spine joint, low to high.
  const pitches = [
    rad(3 * round - 2 * lift + 2 * Math.max(0, lean) - 3 * Math.max(0, -lean)),
    rad(7 * round - 3 * lift + 2 * Math.max(0, lean) - 3 * Math.max(0, -lean)),
    rad(7 * round - 3 * lift + 1 * Math.max(0, lean) - 2 * Math.max(0, -lean)),
  ].map((v, i) => v + extraPitch * [0.3, 0.4, 0.3][i]);
  // The shoulders lean back over the standing foot, a little past level.
  const answer = -tilt * 1.32 + extraRoll,
    turnTotal = rad(13) * twist - yaw + extraYaw;
  const chestYaw = yaw + turnTotal;
  const spine = [0.42, 0.36, 0.22].map((share, i) => joint(pitches[i], turnTotal * [0.3, 0.4, 0.3][i], answer * share));
  const shoulders = read(p, "shoulders") * keep,
    shrug = read(p, "shrug") * keep;
  const clavicles = rig.sides.map((s) =>
    // Raising a shoulder leans its collarbone up, and a rounded back draws both forward.
    turn(Z, s.side * rad(5 * shrug + s.side * 4 * shoulders - 2 * round)).multiply(turn(Y, -s.side * rad(7 * round - 4 * lift))),
  );
  const chestPitch = pitch + pitches[0] + pitches[1] + pitches[2],
    chestRoll = tilt + answer;
  // The eyes stay near level: the head undoes most of what the spine leans and turns.
  const tiltWorld = -rad(9) * read(p, "headTilt") * keep + 0.3 * chestRoll,
    yawWorld = headYaw ?? rad(20) * read(p, "headTurn") * keep + 0.35 * chestYaw,
    pitchWorld = rad(4 * round - 2 * lift - 9 * read(p, "chin") * keep + 2 * Math.max(0, lean)) + extraPitch * 0.25;
  const neckPitch = rad(8 * round - 2 * lift + 3 * Math.max(0, -lean));
  const roll = tiltWorld - chestRoll,
    turnHead = yawWorld - chestYaw,
    nod = pitchWorld - chestPitch;
  return {
    spine,
    clavicles,
    neck: joint(neckPitch + (nod - neckPitch) * 0.25, turnHead * 0.35, roll * 0.4),
    head: joint((nod - neckPitch) * 0.75, turnHead * 0.65, roll * 0.6),
  };
}
function hangingArms(rig, p) {
  const elbows = read(p, "elbows"),
    weight = read(p, "weight");
  return rig.sides.map((s) => ({
    waist: Math.max(0, s.side * read(p, "handAtWaist")),
    showFan: s.fanGrip ? 1 : 0,
    hang: read(p, "arms"),
    ease: read(p, "arms"),
    abduct: rad(4.5),
    // The arm on the free side hangs a little ahead of the other.
    forward: rad(2 + 3 * elbows - 3 * s.side * weight),
    roll: rad(8),
    elbow: rad(6 + 22 * elbows),
    wrist: rad(4 + 6 * read(p, "hands")),
    fingers: 0.3 + 0.5 * read(p, "hands"),
  }));
}
function footTurn(rig, p, s, extra = 0) {
  return s.side * rad(7 + 11 * read(p, "toes") + extra);
}

/** Solve the standing posture and leave it on the joints. Returns what the clips build on. */
export function stand(rig, posture) {
  const p = posture,
    weight = read(p, "weight"),
    load = Math.abs(weight),
    lead = weight < 0 ? -1 : 1;
  const support = lead > 0 ? rig.left : rig.right,
    free = lead > 0 ? rig.right : rig.left;
  // Ankles under the hips, wider or narrower by choice, never closer than the legs allow.
  const wanted = rig.hipHalf * (0.92 + 0.5 * read(p, "feet") - 0.1 * load);
  const half = clamp(Math.max(wanted, rig.narrowest * (1 - 0.12 * load)), 0.045, Math.max(rig.half * 1.3, 0.05));
  const lean = read(p, "lean"),
    slouch = read(p, "slouch");
  const tilt = lead * rad(1 + 7.5 * read(p, "hip")) * load;
  // The hip of a foot set forward comes forward with it.
  const pelvisYaw = lead * rad(5) * read(p, "step") * load;
  const pelvisPitch = rad(-4 * Math.max(0, slouch) + 3 * Math.max(0, -slouch) - 4 * Math.max(0, -lean) + 2 * Math.max(0, lean));
  const turnPelvis = joint(pelvisPitch, pelvisYaw, tilt);
  const stepAhead = read(p, "step") * 0.13 * (0.35 + 0.65 * load) * (1 - 0.5 * rig.skirted);
  const feet = rig.sides.map((s) => {
    const own = s === support || load < 0.02;
    const z = (rig.left.ankle.z + rig.right.ankle.z) / 2 + (s === free ? stepAhead : -stepAhead * 0.25);
    return {
      // The free foot rests a little wider and turned out.
      ankle: new Vector3(s.side * (half + (own ? 0 : 0.018 * load)), s.ankle.y, z),
      yaw: footTurn(rig, p, s, own ? 0 : 9 * load),
      pitch: 0,
      toe: 0,
    };
  });
  const upper = trunk(rig, p, { tilt, yaw: pelvisYaw, pitch: pelvisPitch });
  const arms = hangingArms(rig, p);
  const body = { pelvis: { at: rig.pelvis.clone(), turn: turnPelvis }, feet, ...upper, arms };
  // Carry the weight: the mass centre moves over the standing foot, and over mid-foot.
  const supportFoot = feet[rig.sides.indexOf(support)],
    freeFoot = feet[rig.sides.indexOf(free)];
  const middle = (f, s) => f.ankle.z + 0.34 * s.footReach;
  const share = 0.5 + 0.44 * load;
  const aim = {
    // However wide the feet, the hips travel no further than a hand's breadth.
    x: clamp(supportFoot.ankle.x * share + freeFoot.ankle.x * (1 - share), -0.085, 0.085),
    z: middle(supportFoot, support) * share + middle(freeFoot, free) * (1 - share) + 0.012 * lean,
  };
  let shift = new Vector3(lead * load * half * 0.7, 0, -0.03 * Math.min(0, lean));
  for (let pass = 0; pass < 4; pass++) {
    const at = rig.pelvis.clone().add(shift);
    const ease = 0.0015 + 0.002 * (1 - load);
    at.y = hipHeight(rig, support, turnPelvis, at, supportFoot.ankle, ease);
    if (load < 0.02) at.y = Math.min(at.y, hipHeight(rig, free, turnPelvis, at, freeFoot.ankle, ease));
    else {
      // The free leg is slack: its foot rests where the bent knee lets it, not at full stretch.
      const hip = free.hip.clone().sub(rig.pelvis).applyQuaternion(turnPelvis).add(at);
      const length = (free.thigh + free.shin) * (1 - 0.004 - 0.012 * load),
        drop = hip.y - freeFoot.ankle.y,
        most = Math.sqrt(Math.max(0.0001, length * length - drop * drop));
      const dx = freeFoot.ankle.x - hip.x,
        dz = freeFoot.ankle.z - hip.z,
        flat = Math.hypot(dx, dz);
      if (flat > most) {
        freeFoot.ankle.x = hip.x + (dx * most) / flat;
        freeFoot.ankle.z = hip.z + (dz * most) / flat;
      }
    }
    body.pelvis.at = at;
    pose(rig, body);
    if (pass === 3) break;
    const centre = massCentre(rig);
    shift.x += aim.x - centre.x;
    shift.z += aim.z - centre.z;
  }
  // Let each arm fall as near the posed body as its sleeve, the hips and the skirt allow.
  rig.sides.forEach((s, i) => {
    arms[i].hang = armRoom(rig, s, arms[i], flank(rig, s));
    placeArm(rig, s, arms[i]);
  });
  return { body, half, lead, load, support, free, posture: p, tilt, yaw: pelvisYaw, pitch: pelvisPitch, hang: arms.map((arm) => arm.hang) };
}

/** What the posture leaves on every joint it owns, for the rest of the file and for tests. */
export function capture(rig) {
  return rig.bones.map((bone) => ({ bone, turn: bone.quaternion.clone(), place: bone.position.clone() }));
}
export function restore(state) {
  for (const { bone, turn: q, place } of state) {
    bone.quaternion.copy(q);
    bone.position.copy(place);
  }
}
function record(rig, tracks) {
  for (const bone of rig.bones) {
    if (!tracks.has(bone)) tracks.set(bone, { turns: [], places: [] });
    const t = tracks.get(bone);
    t.turns.push(...bone.quaternion.toArray());
    if (bone === rig.pelvisBone) t.places.push(...bone.position.toArray());
  }
}
function cloneBody(body) {
  return {
    pelvis: { at: body.pelvis.at.clone(), turn: body.pelvis.turn.clone() },
    feet: body.feet.map((f) => ({ ...f, ankle: f.ankle.clone() })),
    spine: body.spine.map((q) => q.clone()),
    clavicles: body.clavicles.map((q) => q.clone()),
    neck: body.neck.clone(),
    head: body.head.clone(),
    arms: body.arms.map((a) => ({ ...a })),
  };
}

// Stance and swing of one walking foot at phase 0 to 1, with 0 the heel strike.
function walkingFoot(rig, s, phase, gait) {
  const { travel, half, toeOut, stance } = gait;
  const heel = 0.42 * s.footReach,
    base = s.ankle.y,
    // Height of the ankle joint above the sole decides how far a tipped foot lifts it.
    rise = s.ankle.y - s.ball.y + 0.008;
  const flat = (u) => gait.origin + travel * (0.5 - u);
  // Ankle of a foot tipped about its heel (toes up) or about the ball (heel up).
  const onHeel = (z, up) => ({ z: z - heel + heel * Math.cos(up) + rise * Math.sin(up), y: base + heel * Math.sin(up) - rise * (1 - Math.cos(up)) });
  const onBall = (z, down) => ({ z: z + s.footReach - s.footReach * Math.cos(down) + rise * Math.sin(down), y: base + s.footReach * Math.sin(down) - rise * (1 - Math.cos(down)) });
  const strike = gait.strike,
    push = gait.push;
  let z, y, pitch, toe = 0;
  if (phase < stance) {
    const u = phase / stance;
    if (u < 0.14) {
      const up = strike * (1 - smooth(u / 0.14));
      ({ z, y } = onHeel(flat(u), up));
      pitch = -up;
    } else if (u < 0.52) {
      z = flat(u);
      y = base;
      pitch = 0;
    } else {
      const down = push * smooth((u - 0.52) / 0.48);
      ({ z, y } = onBall(flat(u), down));
      pitch = down;
      toe = down;
    }
  } else {
    const v = (phase - stance) / (1 - stance),
      from = onBall(flat(1), push),
      to = onHeel(flat(0), strike);
    const e = smoother(v);
    z = from.z + (to.z - from.z) * e;
    // The foot clears the ground early in the swing and reaches out low before the heel lands.
    y = from.y + (to.y - from.y) * e + gait.lift * Math.sin(Math.PI * v) ** 1.3 * (1 - 0.35 * v);
    pitch = push + (-strike - push) * smooth(Math.min(1, v * 1.25));
    toe = push * (1 - smooth(Math.min(1, v * 3)));
  }
  return { ankle: new Vector3(s.side * half, y, z), yaw: s.side * toeOut, pitch, toe, eased: true };
}

/**
 * Rewrite the generated clips of an adult with a posture. Each key is solved on the rig, so the
 * feet are placed by the legs rather than slid, and whatever a clip leaves alone keeps the
 * standing posture.
 */
export function postureClips(rig, standing, clips, { skirted = rig.skirted } = {}) {
  const p = standing.posture,
    rest = capture(rig),
    base = standing.body;
  const owned = new Set(rig.bones.map((b) => b.name));
  const keys = 32;
  for (const clip of clips) {
    if (!["Idle", "Walk", "Reach", "Crouch"].includes(clip.name)) continue;
    const tracks = new Map(),
      times = [];
    let duration = clip.duration;
    let plan = null;
    if (clip.name === "Walk") {
      duration = clamp(1.16 * Math.sqrt(Math.max(0.1, rig.limb) / 0.8) * (1 - 0.07 * read(p, "stride")), 0.7, 2.1);
      plan = planWalk(rig, standing, keys, skirted);
    }
    for (let i = 0; i <= keys; i++) {
      const t = i / keys,
        wave = (1 - Math.cos(t * tau)) * 0.5;
      times.push(t * duration);
      const body = cloneBody(base);
      if (clip.name === "Idle") idle(rig, standing, body, t);
      else if (clip.name === "Reach") reach(rig, standing, body, wave);
      else if (clip.name === "Crouch") crouch(rig, standing, body, wave);
      else walk(rig, standing, body, t, plan, keys);
      pose(rig, body);
      record(rig, tracks);
    }
    const kept = clip.tracks.filter((track) => {
      const name = track.name.slice(0, track.name.lastIndexOf("."));
      return !owned.has(name) || !/\.(quaternion|position)$/.test(track.name);
    });
    // The root keeps its place: the hips carry every rise and fall, and ground contact is
    // measured on the finished clip.
    const rootTrack = rig.root.name + ".position";
    const made = [new VectorKeyframeTrack(rootTrack, [0, duration], [...rig.root.position.toArray(), ...rig.root.position.toArray()])];
    for (const [bone, { turns, places }] of tracks) {
      made.push(new QuaternionKeyframeTrack(bone.name + ".quaternion", times, turns));
      if (places.length) made.push(new VectorKeyframeTrack(bone.name + ".position", times, places));
    }
    // Tracks made for the old stride keep their rhythm on the new length of the loop.
    const scale = duration / clip.duration;
    for (const track of kept) {
      if (track.name === rootTrack) continue;
      if (scale !== 1) for (let k = 0; k < track.times.length; k++) track.times[k] *= scale;
      made.push(track);
    }
    clip.tracks = made;
    clip.duration = duration;
    clip.resetDuration();
    clip.optimize();
  }
  restore(rest);
}

function idle(rig, standing, body, t) {
  const p = standing.posture,
    breath = Math.sin(t * tau),
    drift = Math.sin(t * tau + 1.1);
  // Breathing lifts the chest and shoulders. The weight drifts a few millimetres over the feet.
  const upper = trunk(rig, p, {
    tilt: standing.tilt,
    yaw: standing.yaw,
    pitch: standing.pitch,
    extraPitch: rad(-0.9) * breath,
    extraRoll: rad(0.5) * drift,
  });
  Object.assign(body, upper);
  body.head = body.head.clone().multiply(joint(rad(0.6) * breath, rad(2.2) * drift, 0));
  body.pelvis.at.x += 0.004 * drift * (0.4 + standing.load);
  body.pelvis.at.y -= 0.0015 * (1 - Math.cos(t * tau * 2)) * 0.5;
  body.clavicles = body.clavicles.map((q, i) => q.clone().multiply(turn(Z, rig.sides[i].side * rad(0.7) * (breath * 0.5 + 0.5))));
  body.arms.forEach((arm, i) => {
    arm.swing = rad(0.9) * Math.sin(t * tau + i * 2.1);
    arm.bend = rad(1.2) * (breath * 0.5 + 0.5);
  });
}
function reach(rig, standing, body, wave) {
  const p = standing.posture;
  // The right hand leads, the trunk follows it a little and the other arm comes part of the way.
  const upper = trunk(rig, p, {
    tilt: standing.tilt,
    yaw: standing.yaw,
    pitch: standing.pitch,
    extraPitch: rad(7) * wave,
    extraYaw: rad(9) * wave,
  });
  Object.assign(body, upper);
  body.arms.forEach((arm, i) => {
    const lift = wave * (rig.sides[i].side < 0 ? 1 : 0.42);
    arm.waist *= 1 - wave;
    arm.showFan *= 1 - wave;
    arm.swing = rad(74) * lift;
    arm.bend = rad(12) * lift;
    arm.release = lift;
    arm.roll *= 1 - lift;
    arm.wrist *= 1 - 0.6 * lift;
    arm.fingers *= 1 - 0.5 * lift;
  });
  body.pelvis.at.z += 0.012 * wave;
}

function crouch(rig, standing, body, wave) {
  const p = standing.posture,
    keep = 1 - 0.85 * smooth(wave);
  // Both legs share the load on the way down: the hips level out and come back over the feet.
  const tilt = standing.tilt * keep,
    yaw = standing.yaw * keep,
    pitch = standing.pitch + rad(9) * wave;
  body.pelvis.turn = joint(pitch, yaw, tilt);
  Object.assign(body, trunk(rig, p, { tilt, yaw, pitch, extraPitch: rad(14) * wave }));
  const centre = (body.feet[0].ankle.x + body.feet[1].ankle.x) / 2;
  body.pelvis.at.x += (centre - body.pelvis.at.x) * (1 - keep) * 0.8;
  body.pelvis.at.y -= rig.limb * 0.28 * wave;
  body.pelvis.at.z -= rig.limb * 0.11 * wave;
  body.arms.forEach((arm) => {
    arm.waist *= 1 - wave;
    arm.showFan *= 1 - wave;
    arm.swing = rad(24) * wave;
    arm.bend = rad(16) * wave;
  });
}

// The stride of one figure: how far and wide the feet travel, and how high the hips ride at
// each key of the loop.
function planWalk(rig, standing, keys, skirted) {
  const p = standing.posture,
    stride = read(p, "stride"),
    swing = read(p, "swing"),
    slouch = read(p, "slouch");
  // A long skirt shortens the step it allows.
  const length = rig.limb * (1.16 + 0.2 * stride) * (1 - 0.38 * skirted);
  const gait = {
    stance: 0.62,
    travel: 0.62 * length,
    half: Math.max(0.046 + 0.03 * Math.max(0, read(p, "feet")), rig.narrowest * 0.82),
    toeOut: rad(5 + 6 * read(p, "toes")),
    strike: rad(17 + 4 * stride),
    // Under a long skirt the heel rises less, so the hem is not kicked out behind.
    push: rad(46 + 8 * stride) * (1 - 0.4 * skirted),
    lift: rig.limb * (0.035 + 0.008 * stride) * (1 - 0.4 * skirted),
    origin: (rig.left.ankle.z + rig.right.ankle.z) / 2 - 0.012,
    stride,
    swing,
    pitch: rad(2.5 + 1.5 * stride - 3 * Math.max(0, slouch) + 2 * Math.max(0, -slouch)),
  };
  const frames = [];
  for (let i = 0; i < keys; i++) {
    const t = i / keys,
      a = t * tau;
    // Left heel lands at 0 and right at one half. The hips turn with the forward leg, drop
    // toward the swinging side and ride over the standing foot.
    const yaw = -rad(4.5 + 1.5 * stride) * Math.cos(a) * (1 - 0.4 * skirted),
      list = rad(2.6 + 0.8 * swing) * Math.sin(a - 0.3);
    const turnPelvis = joint(gait.pitch, yaw, list);
    const feet = rig.sides.map((s, k) => walkingFoot(rig, s, (t + k * 0.5) % 1, gait));
    const at = rig.pelvis.clone();
    at.x = (0.3 * gait.half + 0.006) * Math.sin(a - 0.3);
    at.z = rig.pelvis.z + 0.012;
    // Ride as high as the legs allow. A foot about to land already draws the hips down.
    let height = Infinity;
    rig.sides.forEach((s, k) => {
      const phase = (t + k * 0.5) % 1;
      if (phase < gait.stance * 0.9 || phase > 0.9) height = Math.min(height, hipHeight(rig, s, turnPelvis, at, feet[k].ankle, 0.003));
    });
    frames.push({ yaw, list, turnPelvis, feet, at, height });
  }
  // Round the corners where one leg hands over to the other.
  for (let pass = 0; pass < 2; pass++) {
    const h = frames.map((f) => f.height);
    frames.forEach((f, i) => (f.height = 0.25 * h[(i + keys - 1) % keys] + 0.5 * h[i] + 0.25 * h[(i + 1) % keys]));
  }
  for (const f of frames) f.at.y = f.height - rig.limb * 0.003;
  // A forearm fitted raised comes down for the walk, as far as the standing body lets it.
  pose(rig, standing.body);
  const hangs = rig.sides.map((s, i) => {
    const arm = standing.body.arms[i];
    return arm.waist || s.elbowBend > rad(42) ? armRoom(rig, s, { ...arm, waist: 0, hang: arm.ease, release: 1 }, flank(rig, s)) : arm.hang;
  });
  return { gait, frames, hangs };
}
function walk(rig, standing, body, t, plan, keys) {
  const p = standing.posture,
    { gait } = plan,
    f = plan.frames[Math.round(t * keys) % keys],
    a = t * tau;
  body.pelvis.turn = f.turnPelvis;
  body.pelvis.at = f.at;
  body.feet = f.feet;
  // The chest turns against the hips, the head stays on the road ahead.
  const chestYaw = rad(3.4 + 2.4 * gait.swing) * Math.cos(a);
  Object.assign(body, trunk(rig, p, {
    tilt: f.list,
    yaw: f.yaw,
    pitch: gait.pitch,
    keep: 0.85,
    extraYaw: chestYaw - rad(13) * read(p, "twist") * 0.85 * 0.6,
    extraPitch: rad(2 + 2 * gait.stride),
    extraRoll: f.list * 0.45,
    headYaw: rad(20) * read(p, "headTurn") * 0.3,
  }));
  const reachOut = 1 + 0.45 * gait.swing;
  body.arms.forEach((arm, i) => {
    const s = rig.sides[i];
    // Each arm swings with the opposite leg and bends more as it comes forward.
    const lag = a + (s.side > 0 ? Math.PI : 0) - 0.25,
      c = Math.cos(lag);
    arm.release = 1;
    arm.waist = 0;
    // Carry the open fan ahead of the hip as the opposite arm swings freely.
    // A little of the stride reaches the wrist without sweeping the leaf through a long hem.
    arm.showFan = s.fanGrip ? .94 + .035*c : 0;
    arm.hang = plan.hangs[i];
    // The upper arm travels further back than forward, and the forearm folds as it comes ahead.
    arm.elbow = rad(8 + 10 * read(p, "elbows"));
    arm.swing = rad(15) * reachOut * c - rad(9);
    arm.bend = rad(12) * reachOut * (0.5 + 0.5 * Math.cos(lag - 0.45));
    arm.fingers = Math.max(arm.fingers, 0.6);
  });
  body.clavicles = body.clavicles.map((q, i) => q.clone().multiply(turn(Y, rig.sides[i].side * rad(1.5) * Math.cos(a + (rig.sides[i].side > 0 ? Math.PI : 0)))));
}

/** A one-frame clip of the standing posture, used to measure the skirt and the ground under it. */
export function standingClip(rig) {
  const tracks = [new VectorKeyframeTrack(rig.root.name + ".position", [0, 1], [...rig.root.position.toArray(), ...rig.root.position.toArray()])];
  for (const bone of rig.bones) {
    const q = bone.quaternion.toArray();
    tracks.push(new QuaternionKeyframeTrack(bone.name + ".quaternion", [0, 1], [...q, ...q]));
  }
  const v = rig.pelvisBone.position.toArray();
  tracks.push(new VectorKeyframeTrack(rig.pelvisBone.name + ".position", [0, 1], [...v, ...v]));
  return new AnimationClip("Stand", 1, tracks);
}
