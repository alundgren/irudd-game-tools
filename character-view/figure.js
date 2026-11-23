import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import { bindParts } from "./rig.js";

// A measured two-arm human built from editable sweeps. Each limb segment
// starts and ends in a rounded cap at a real joint, so shoulders, elbows and
// knees stay closed when a clip turns them. The body is bare skin. Everyday
// clothes are separate child parts with their own cut, shown in Work clothes.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rad = Math.PI / 180;
const hex = (v, fallback) =>
  typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)
    ? v.toLowerCase()
    : fallback;
const number = (v, a, b, fallback) =>
  Number.isFinite(v) ? clamp(v, a, b) : fallback;
const pick = (v, options) => (options.includes(v) ? v : options[0]);

export const figureTops = ["shirt", "tee", "jacket", "hoodie", "none"];
export const figureSleeves = ["long", "rolled", "short", "none"];
export const figureBottoms = ["trousers", "shorts", "none"];
export const figureShoes = ["sneakers", "boots", "none"];
export const figureHair = ["Crop", "Sweep", "Coils", "Bald"];
export const figureGrooms = ["Locks", "Side part", "Coils", "Braids", "Locs"];

// Every number is clamped, so an artist or agent can send a partial figure.
export function readFigure(raw = {}) {
  const f = raw && typeof raw === "object" ? raw : {};
  const top = f.top ?? {},
    bottom = f.bottom ?? {},
    shoes = f.shoes ?? {},
    stance = f.stance ?? {};
  return {
    height: number(f.height, 1.2, 2.2, 1.72),
    heads: number(f.heads, 6, 8.4, 7.4),
    shoulders: number(f.shoulders, 0.7, 1.4, 1),
    chest: number(f.chest, 0.7, 1.5, 1),
    waist: number(f.waist, 0.7, 1.8, 1),
    hips: number(f.hips, 0.7, 1.5, 1),
    belly: number(f.belly, 0, 1, 0),
    limbs: number(f.limbs, 0.7, 1.6, 1),
    legs: number(f.legs, 0.9, 1.1, 1),
    arms: number(f.arms, 0.88, 1.12, 1),
    neck: number(f.neck, 0.75, 1.35, 1),
    hands: number(f.hands, 0.85, 1.2, 1),
    skin: hex(f.skin, "#b98566"),
    face: Number.isInteger(f.face) ? clamp(f.face, 0, 3) : 0,
    hair: pick(f.hair, figureHair),
    hairColor: hex(f.hairColor, "#3a2e28"),
    // Rooted strands replace the plain hair shell when a groom is given.
    groom:
      f.groom && typeof f.groom === "object"
        ? {
            pattern: pick(f.groom.pattern, figureGrooms),
            length: number(f.groom.length, 0, 2, 0.3),
            curl: number(f.groom.curl, 0, 1, 0.4),
            gather: number(f.groom.gather, 0, 1, 0),
            sweep: number(f.groom.sweep, -1, 1, 0.2),
            volume: number(f.groom.volume, 0, 1, 0.4),
            nape: number(f.groom.nape, 0, 1, 0),
            seed: Number.isInteger(f.groom.seed)
              ? clamp(f.groom.seed, 0, 4294967295)
              : 1,
          }
        : null,
    stance: {
      arms: number(stance.arms, 4, 75, 13),
      elbows: number(stance.elbows, 0, 80, 14),
      feet: number(stance.feet, 0.5, 2, 1),
      curl: number(stance.curl, 0, 1, 0.34),
    },
    top: {
      kind: pick(top.kind, figureTops),
      sleeves: pick(top.sleeves, figureSleeves),
      color: hex(top.color, "#5d7d86"),
      trim: hex(top.trim, "#e8e2d2"),
      ease: number(top.ease, 0, 1, 0.35),
      length: number(top.length, 0, 1, 0.45),
    },
    bottom: {
      kind: pick(bottom.kind, figureBottoms),
      color: hex(bottom.color, "#3c4656"),
      ease: number(bottom.ease, 0, 1, 0.4),
      belt: hex(bottom.belt, "#4a3a2c"),
      rise: number(bottom.rise, 0, 1, 0.45),
      cuffs: bottom.cuffs === true,
    },
    shoes: {
      kind: pick(shoes.kind, figureShoes),
      color: hex(shoes.color, "#d8d4c8"),
      sole: hex(shoes.sole, "#f2efe6"),
    },
  };
}

function eulerFromBasis(x, y, z) {
  const q = new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(x, y, z),
  );
  const e = new Euler().setFromQuaternion(q);
  return [e.x, e.y, e.z].map((v) => v / rad || 0);
}

// Stations are [t, halfWidth, halfDepth, sideOffset, forwardOffset]. Both
// ends close with a hemisphere whose centre is the joint itself.
function limbKnots(origin, pivot, direction, length, stations, caps = [1, 1]) {
  const knots = [];
  const point = (distance, w, d, dx = 0, dz = 0) => {
    const p = pivot.clone().addScaledVector(direction, distance);
    knots.push([
      p.x + dx - origin.x,
      p.y - origin.y,
      p.z + dz - origin.z,
      Math.max(0.0012, w),
      Math.max(0.0012, d),
    ]);
  };
  const dome = (station, sign) => {
    const [t, w, d, dx, dz] = station,
      r = Math.min(w, d);
    const steps = [0.96, 0.8, 0.45];
    for (const s of sign < 0 ? steps : [...steps].reverse()) {
      const k = Math.sqrt(1 - s * s);
      point(t * length + sign * s * r, w * k, d * k, dx, dz);
    }
  };
  if (caps[0]) dome(stations[0], -1);
  for (const [t, w, d, dx, dz] of stations) point(t * length, w, d, dx, dz);
  if (caps[1]) dome(stations.at(-1), 1);
  return knots;
}

export function buildFigure(raw = {}) {
  const f = readFigure(raw);
  const H = f.height,
    k = H / 1.75,
    m = f.limbs;
  const parts = [],
    links = {};
  const work = ["Work clothes"];
  function sweep(id, origin, knots, color, extra = {}, parent) {
    parts.push({
      id,
      shape: "sweep",
      position: origin.toArray(),
      size: [1, 1, 1],
      rotation: [0, 0, 0],
      color,
      surface: "plain",
      knots,
      ...extra,
    });
    if (parent) links[id] = parent;
  }
  const garment = (surface = "canvas") => ({
    surface,
    motionRole: "rigid",
    visibleIn: work,
  });
  const body = (role) => ({ outfitRole: role, bare: true });
  // Vertical rings are authored in standing space: [y, halfWidth, halfDepth, z].
  const rings = (origin, rows) =>
    rows.map(([y, w, d, z = 0, x = 0]) => [
      x - origin.x,
      y - origin.y,
      z - origin.z,
      w,
      d,
    ]);

  const headHeight = H / f.heads;
  const chin = H - headHeight,
    neckBase = chin - 0.05 * k * f.neck - 0.012 * k,
    shoulderY = neckBase - 0.036 * k,
    crotch = 0.468 * H * f.legs,
    hipY = crotch + 0.088 * k,
    waistY = lerp(hipY, shoulderY, 0.4),
    chestY = lerp(hipY, shoulderY, 0.72),
    kneeY = crotch * 0.585 + 0.012 * k,
    ankleY = 0.078 * k;
  const sw = 0.192 * k * f.shoulders,
    chestW = 0.158 * k * f.chest,
    waistW = 0.134 * k * f.waist,
    hipW = 0.168 * k * f.hips,
    bellyOut = f.belly * 0.11 * k;
  const chestD = 0.108 * k * lerp(1, f.chest, 0.7),
    waistD = 0.094 * k * lerp(1, f.waist, 0.8) + bellyOut * 0.5,
    hipD = 0.106 * k * lerp(1, f.hips, 0.6);
  const torsoRows = [
    [crotch - 0.018 * k, 0.062 * k * f.hips, 0.062 * k, -0.004 * k],
    [crotch + 0.022 * k, 0.128 * k * f.hips, 0.099 * k, -0.004 * k],
    [hipY, hipW, hipD + bellyOut * 0.25, -0.008 * k + bellyOut * 0.2],
    [
      lerp(hipY, waistY, 0.55),
      lerp(hipW, waistW, 0.62) + bellyOut * 0.25,
      lerp(hipD, waistD, 0.6) + bellyOut * 0.35,
      -0.003 * k + bellyOut * 0.48,
    ],
    [waistY, waistW + bellyOut * 0.22, waistD, 0.002 * k + bellyOut * 0.44],
    [
      lerp(waistY, chestY, 0.55),
      lerp(waistW, chestW, 0.6) + bellyOut * 0.1,
      lerp(waistD, chestD, 0.7) + bellyOut * 0.12,
      0.005 * k + bellyOut * 0.2,
    ],
    [chestY, chestW, chestD, 0.008 * k],
    [
      lerp(chestY, shoulderY, 0.62),
      lerp(chestW, sw, 0.55),
      chestD * 0.95,
      0.002 * k,
    ],
    [shoulderY - 0.03 * k, sw * 0.97, 0.09 * k, -0.006 * k],
    [shoulderY - 0.008 * k, sw * 0.84, 0.082 * k, -0.009 * k],
    [lerp(shoulderY, neckBase, 0.55), sw * 0.5, 0.072 * k, -0.013 * k],
    [neckBase, 0.062 * k * f.neck, 0.064 * k * f.neck, -0.014 * k],
    [neckBase + 0.03 * k, 0.05 * k * f.neck, 0.054 * k * f.neck, -0.01 * k],
  ];
  const bodyOrigin = new Vector3(0, hipY, 0);
  sweep(
    "body",
    bodyOrigin,
    rings(bodyOrigin, torsoRows),
    f.skin,
    body("torso"),
  );

  // The built-in head is authored around a 0.25 m skull above a 1.42 m pivot.
  const headScale = headHeight / 0.262;
  parts.push({
    id: "head",
    shape: "head",
    position: [0, chin - 0.085 * headScale, -0.012 * k],
    size: [headScale, headScale, headScale],
    rotation: [0, 0, 0],
  });
  if (f.groom) parts.at(-1).groom = { ...f.groom, color: f.hairColor };
  links.head = "body";

  const armLength = f.arms * H;
  for (const side of [1, -1]) {
    const name = side > 0 ? "left " : "right ";
    const spread = f.stance.arms * rad,
      bend = f.stance.elbows * rad;
    // The joint sits one arm radius inside the shoulder line, so a heavier
    // arm fills the same shoulder instead of standing proud of it.
    const armRadius = 0.046 * k * m;
    const shoulder = new Vector3(
      side * (sw + 0.024 * k - armRadius),
      shoulderY - 0.006 * k - armRadius,
      -0.01 * k,
    );
    const upperDir = new Vector3(
      side * Math.sin(spread),
      -Math.cos(spread),
      -0.03,
    ).normalize();
    const lowerSpread = spread * 0.72;
    const lowerDir = new Vector3(
      side * Math.sin(lowerSpread) * Math.cos(bend),
      -Math.cos(lowerSpread) * Math.cos(bend),
      Math.sin(bend),
    ).normalize();
    const upperLength = 0.172 * armLength,
      lowerLength = 0.146 * armLength;
    const elbow = shoulder.clone().addScaledVector(upperDir, upperLength),
      wrist = elbow.clone().addScaledVector(lowerDir, lowerLength);
    const a = (v) => v * k * m;
    const upperStations = [
      [0, a(0.046), a(0.052)],
      [0.16, a(0.052), a(0.057), side * 0.004 * k],
      [0.36, a(0.046), a(0.052)],
      [0.6, a(0.042), a(0.049), 0, 0.003 * k],
      [0.84, a(0.038), a(0.043)],
      [1, a(0.036), a(0.039)],
    ];
    const lowerStations = [
      [0, a(0.036), a(0.039)],
      [0.2, a(0.039), a(0.043)],
      [0.45, a(0.035), a(0.039)],
      [0.75, a(0.027), a(0.032)],
      [1, a(0.0215), a(0.028)],
    ];
    sweep(
      name + "upper arm",
      shoulder,
      limbKnots(shoulder, shoulder, upperDir, upperLength, upperStations),
      f.skin,
      body("upper arm"),
      "body",
    );
    sweep(
      name + "forearm",
      elbow,
      limbKnots(elbow, elbow, lowerDir, lowerLength, lowerStations),
      f.skin,
      body("forearm"),
      name + "upper arm",
    );
    // The palm faces the thigh and turns a little to the rear, as a relaxed
    // hand does. Local -Y runs along the forearm; local +Z is the palm.
    const down = lowerDir.clone().negate();
    const palm = new Vector3(-side, 0, -0.42)
      .addScaledVector(down, -new Vector3(-side, 0, -0.42).dot(down))
      .normalize();
    const across = new Vector3().crossVectors(down, palm).normalize();
    const handSize = [0.082, 0.182, 0.04].map((v) => v * k * f.hands);
    parts.push({
      id: name + "hand",
      shape: "hand",
      position: wrist
        .clone()
        .addScaledVector(lowerDir, 0.004 * k)
        .toArray(),
      size: handSize,
      frameSize: [...handSize],
      rotation: eulerFromBasis(across, down, palm),
      color: f.skin,
      outfitRole: "hand",
      motionRole: "hand",
      grip: {
        side: -side,
        fingers: 4,
        curl: f.stance.curl,
        spread: 0.18,
      },
    });
    links[name + "hand"] = name + "forearm";

    const top = f.top;
    if (top.kind !== "none") {
      const heavy = top.kind === "jacket" || top.kind === "hoodie";
      const ease = (0.004 + top.ease * 0.011 + (heavy ? 0.009 : 0)) * k;
      // The sleeve head is set into the shoulder seam, so it carries less
      // ease there than along the arm.
      const cloth = (stations, more = 0, seam = true) =>
        stations.map(([t, w, d, dx, dz]) => {
          const add =
            (ease + more) * (seam ? lerp(0.45, 1, clamp(t / 0.3, 0, 1)) : 1);
          return [t, w + add, d + add, dx, dz];
        });
      const sleeves =
        top.kind === "tee" && top.sleeves === "long" ? "short" : top.sleeves;
      if (sleeves === "none") {
        // A sleeveless cut still closes over the shoulder joint.
      } else if (sleeves === "short") {
        const cut = cloth(
          upperStations.filter(([t]) => t <= 0.4),
          0.002 * k,
        );
        cut.push([
          0.52,
          a(0.045) + ease + 0.006 * k,
          a(0.05) + ease + 0.006 * k,
        ]);
        sweep(
          name + "sleeve",
          shoulder,
          limbKnots(shoulder, shoulder, upperDir, upperLength, cut, [1, 0]),
          top.color,
          garment(),
          name + "upper arm",
        );
      } else {
        sweep(
          name + "sleeve",
          shoulder,
          limbKnots(
            shoulder,
            shoulder,
            upperDir,
            upperLength,
            cloth(upperStations, 0.002 * k),
          ),
          top.color,
          garment(),
          name + "upper arm",
        );
        const rolled = sleeves === "rolled";
        const lower = cloth(
          rolled
            ? lowerStations.filter(([t]) => t <= 0.3)
            : lowerStations.map(([t, w, d]) => [
                t,
                lerp(w, a(0.034), t * 0.55),
                lerp(d, a(0.037), t * 0.55),
              ]),
          0.002 * k,
          false,
        );
        if (rolled)
          lower.push([
            0.36,
            a(0.039) + ease + 0.004 * k,
            a(0.043) + ease + 0.004 * k,
          ]);
        else lower[lower.length - 1][0] = 0.97;
        sweep(
          name + "cuff sleeve",
          elbow,
          limbKnots(elbow, elbow, lowerDir, lowerLength, lower, [1, 0]),
          top.color,
          garment(),
          name + "forearm",
        );
        const end = lower.at(-1);
        const bandAt = end[0] * lowerLength;
        const band = [
          [
            bandAt - (rolled ? 0.034 : 0.03) * k,
            end[1] + 0.004 * k,
            end[2] + 0.004 * k,
          ],
          [bandAt + 0.004 * k, end[1] + 0.0045 * k, end[2] + 0.0045 * k],
        ];
        sweep(
          name + "cuff",
          elbow,
          band.map(([d, w, depth]) => {
            const p = elbow.clone().addScaledVector(lowerDir, d).sub(elbow);
            return [p.x, p.y, p.z, w, depth];
          }),
          rolled || heavy ? top.color : top.trim,
          garment(),
          name + "forearm",
        );
      }
    }

    // Legs
    const hipJoint = new Vector3(
      side * 0.086 * k * lerp(1, f.hips, 0.7),
      hipY,
      -0.004 * k,
    );
    const foot = side * 0.098 * k * f.stance.feet;
    const knee = new Vector3(lerp(hipJoint.x, foot, 0.56), kneeY, 0.012 * k),
      ankle = new Vector3(foot, ankleY, -0.012 * k);
    const thighDir = knee.clone().sub(hipJoint),
      thighLength = thighDir.length();
    thighDir.normalize();
    const shinDir = ankle.clone().sub(knee),
      shinLength = shinDir.length();
    shinDir.normalize();
    const l = (v) => v * k * lerp(1, m, 0.85) * lerp(1, f.hips, 0.3);
    const thighStations = [
      [0, l(0.08), l(0.082), 0, -0.01 * k],
      [0.2, l(0.083), l(0.089), 0, -0.007 * k],
      [0.5, l(0.071), l(0.08)],
      [0.8, l(0.057), l(0.063)],
      [1, l(0.051), l(0.055)],
    ];
    const shinStations = [
      [0, l(0.051), l(0.055)],
      [0.14, l(0.049), l(0.054), 0, -0.003 * k],
      [0.33, l(0.05), l(0.058), side * 0.003 * k, -0.013 * k],
      [0.62, l(0.039), l(0.044), 0, -0.007 * k],
      [0.88, l(0.03), l(0.035)],
      [1, l(0.03), l(0.036)],
    ];
    sweep(
      name + "thigh",
      hipJoint,
      limbKnots(hipJoint, hipJoint, thighDir, thighLength, thighStations),
      f.skin,
      body("thigh"),
      "body",
    );
    sweep(
      name + "shin",
      knee,
      limbKnots(knee, knee, shinDir, shinLength, shinStations),
      f.skin,
      body("shin"),
      name + "thigh",
    );
    const toe = side * 0.13; // outward turn in radians
    const footPath = (rows, lift = 0) =>
      rows.map(([z, y, w, d]) => [
        Math.sin(toe) * z * k,
        y * k + lift - ankleY,
        Math.cos(toe) * z * k + 0.012 * k,
        w * k,
        d * k,
      ]);
    sweep(
      name + "foot",
      ankle,
      footPath([
        [-0.062, 0.03, 0.012, 0.012],
        [-0.054, 0.033, 0.027, 0.028],
        [-0.02, 0.043, 0.033, 0.042],
        [0.03, 0.04, 0.038, 0.039],
        [0.085, 0.03, 0.045, 0.028],
        [0.135, 0.022, 0.046, 0.02],
        [0.172, 0.017, 0.037, 0.015],
        [0.19, 0.015, 0.018, 0.009],
      ]),
      f.skin,
      body("foot"),
      name + "shin",
    );
    if (f.shoes.kind !== "none") {
      const boot = f.shoes.kind === "boots";
      sweep(
        name + "shoe",
        ankle,
        footPath([
          [-0.08, 0.046, 0.014, 0.018],
          [-0.073, 0.05, 0.035, 0.041],
          [-0.035, 0.062, 0.042, 0.057],
          [0.025, 0.062, 0.046, 0.055],
          [0.08, 0.05, 0.052, 0.042],
          [0.135, 0.04, 0.054, 0.031],
          [0.185, 0.034, 0.047, 0.025],
          [0.212, 0.03, 0.024, 0.016],
        ]),
        f.shoes.color,
        garment("leather"),
        name + "foot",
      );
      sweep(
        name + "sole",
        ankle,
        footPath([
          [-0.084, 0.016, 0.02, 0.014],
          [-0.074, 0.016, 0.038, 0.016],
          [-0.02, 0.015, 0.044, 0.015],
          [0.01, 0.012, 0.046, 0.012],
          [0.07, 0.012, 0.052, 0.012],
          [0.15, 0.012, 0.056, 0.012],
          [0.2, 0.013, 0.044, 0.012],
          [0.218, 0.014, 0.022, 0.01],
        ]),
        f.shoes.sole,
        garment("leather"),
        name + "foot",
      );
      const collarTop = boot ? 0.2 : 0.098;
      sweep(
        name + "shoe collar",
        ankle,
        rings(ankle, [
          [0.05 * k, l(0.04), l(0.05), ankle.z + 0.004 * k, ankle.x],
          [collarTop * k * 0.6, l(0.038), l(0.046), ankle.z, ankle.x],
          [
            collarTop * k,
            l(boot ? 0.047 : 0.039),
            l(boot ? 0.052 : 0.045),
            ankle.z - (boot ? 0.004 : 0) * k,
            ankle.x,
          ],
        ]),
        f.shoes.color,
        garment("leather"),
        name + (boot ? "shin" : "foot"),
      );
    }
    const bottom = f.bottom;
    if (bottom.kind !== "none") {
      const ease = (0.009 + bottom.ease * 0.022) * k;
      // Cloth hangs from the seat in front, so the leg below the seam is
      // deeper than the thigh. The cap at the hip stays a sphere about the
      // joint and remains inside the seat until the leg lifts.
      const upper = thighStations.map(([t, w, d, dx = 0, dz = 0], i) => {
        const hang = t < 0.2 ? t / 0.2 : clamp(1 - (t - 0.2) / 0.3, 0, 1);
        return [
          t,
          Math.max(w, i > 2 ? l(0.058) + bottom.ease * 0.012 * k : 0) + ease,
          Math.max(d, i > 2 ? l(0.063) + bottom.ease * 0.012 * k : 0) +
            ease +
            hang * 0.011 * k,
          dx,
          dz + hang * 0.007 * k,
        ];
      });
      if (bottom.kind === "shorts") {
        const cut = upper.filter(([t]) => t <= 0.5);
        cut.push([0.62, cut.at(-1)[1] + 0.004 * k, cut.at(-1)[2] + 0.004 * k]);
        sweep(
          name + "short leg",
          hipJoint,
          limbKnots(hipJoint, hipJoint, thighDir, thighLength, cut, [1, 0]),
          bottom.color,
          garment(),
          name + "thigh",
        );
      } else {
        sweep(
          name + "trouser thigh",
          hipJoint,
          limbKnots(hipJoint, hipJoint, thighDir, thighLength, upper),
          bottom.color,
          garment(),
          name + "thigh",
        );
        // A trouser leg hangs from the knee and calf. It does not follow the ankle.
        const kneeW = upper.at(-1)[1],
          kneeD = upper.at(-1)[2];
        const hemW = l(0.046) + ease + bottom.ease * 0.02 * k,
          hemD = l(0.052) + ease + bottom.ease * 0.022 * k;
        const lowerLeg = [
          [0, kneeW, kneeD],
          [
            0.3,
            lerp(kneeW, hemW, 0.25) + 0.002 * k,
            Math.max(lerp(kneeD, hemD, 0.25), l(0.058) + ease * 0.8),
            0,
            -0.01 * k,
          ],
          [0.62, lerp(kneeW, hemW, 0.7), lerp(kneeD, hemD, 0.7), 0, -0.006 * k],
          [f.shoes.kind === "boots" ? 0.8 : 0.93, hemW, hemD, 0, 0.002 * k],
        ];
        if (bottom.cuffs) {
          // A turn-up is a short band outside the hem.
          const [t, w, d, , dz] = lowerLeg.at(-1);
          const at = (u) =>
            knee.clone().addScaledVector(shinDir, u * shinLength);
          sweep(
            name + "trouser cuff",
            knee,
            [t - 0.11, t + 0.004].map((u) => {
              const q = at(u).sub(knee);
              return [q.x, q.y, q.z + dz, w + 0.005 * k, d + 0.005 * k];
            }),
            bottom.color,
            garment(),
            name + "shin",
          );
        }
        sweep(
          name + "trouser shin",
          knee,
          limbKnots(knee, knee, shinDir, shinLength, lowerLeg, [1, 0]),
          bottom.color,
          garment(),
          name + "shin",
        );
      }
    }
  }

  // Trunk garments use the same rings as the body with ease added.
  const fitted = (rows, ease, depthEase = ease) =>
    rows.map(([y, w, d, z, x]) => [y, w + ease, d + depthEase, z, x]);
  const beltY = lerp(hipY, waistY, 0.35 + 0.62 * f.bottom.rise);
  if (f.bottom.kind !== "none") {
    const ease = (0.009 + f.bottom.ease * 0.012) * k;
    // The seat keeps its full width down to the crotch seam and loses depth
    // on the way. Both legs come forward of it there, so the front closes in
    // a crease between them instead of a panel.
    const legScale = k * lerp(1, m, 0.85) * lerp(1, f.hips, 0.3);
    const legEase = f.bottom.ease * 0.01 * k + 0.003 * k;
    const seamW = 0.086 * k * lerp(1, f.hips, 0.7) + 0.083 * legScale + legEase;
    const seamD = 0.089 * legScale + 0.007 * k + legEase;
    // The gusset between the legs covers the body and stays behind the front
    // of both thighs, so it closes the gap without showing as its own panel.
    const gusset = [
      [crotch - 0.046 * k, seamW * 0.1, 0.034 * k, -0.008 * k],
      [crotch - 0.034 * k, seamW * 0.26, 0.058 * k, -0.008 * k],
      [crotch - 0.014 * k, seamW * 0.48, 0.07 * k, -0.008 * k],
    ];
    const seat = fitted(
      [
        [
          crotch + 0.004 * k,
          Math.max(seamW, hipW * 0.97),
          Math.max(seamD * 0.64, 0.092 * k),
          -0.005 * k,
        ],
        [
          lerp(crotch, hipY, 0.5),
          Math.max(seamW, hipW * 0.99),
          Math.max(seamD * 0.86, hipD * 0.94) + bellyOut * 0.1,
          -0.006 * k + bellyOut * 0.1,
        ],
        ...torsoRows
          .slice(2, 5)
          .filter(([y]) => y < beltY - 0.01 * k)
          .map(([y, w, d, z]) => [
            y,
            Math.max(
              w,
              lerp(seamW + 0.002 * k, w, clamp((y - hipY) / (0.06 * k), 0, 1)),
            ),
            d,
            z,
          ]),
        [
          beltY,
          lerp(hipW, waistW, 0.7) + bellyOut * 0.25,
          lerp(hipD, waistD, 0.72) + bellyOut * 0.36,
          bellyOut * 0.47,
        ],
      ],
      ease,
    );
    sweep(
      "trouser seat",
      bodyOrigin,
      rings(bodyOrigin, [...gusset, ...seat]),
      f.bottom.color,
      garment(),
      "body",
    );
    const [, bw, bd, bz] = seat.at(-1);
    sweep(
      "belt",
      bodyOrigin,
      rings(bodyOrigin, [
        [beltY - 0.034 * k, bw + 0.004 * k, bd + 0.004 * k, bz],
        [beltY + 0.004 * k, bw + 0.0035 * k, bd + 0.004 * k, bz],
      ]),
      f.bottom.belt,
      garment("leather"),
      "body",
    );
  }
  if (f.top.kind !== "none") {
    const top = f.top,
      heavy = top.kind === "jacket" || top.kind === "hoodie";
    const ease = (0.008 + top.ease * 0.016 + (heavy ? 0.012 : 0)) * k;
    const worn = f.bottom.kind !== "none";
    const seatEase = worn ? (0.009 + f.bottom.ease * 0.012) * k : 0;
    // A tucked shirt ends inside the waistband. Any longer hem hangs over it.
    const tucked = worn && !heavy && top.length < 0.12;
    const hem = tucked
      ? beltY - 0.012 * k
      : lerp(beltY - 0.035 * k, crotch + 0.004 * k, top.length);
    const rows = torsoRows.filter(
      ([y]) => y > hem + 0.015 * k && y <= neckBase + 0.001,
    );
    const widest = Math.max(...rows.slice(0, 3).map((r) => r[1])),
      deepest = Math.max(...rows.slice(0, 3).map((r) => r[2]));
    // Loose cloth falls straight from the chest instead of following the waist.
    const straight = clamp(0.45 + top.ease * 0.6 + (heavy ? 0.2 : 0), 0, 1);
    const draped = rows.map(([y, w, d, z]) => {
      const lower = clamp((chestY - y) / Math.max(0.01, chestY - hem), 0, 1);
      return [
        y,
        lerp(w, Math.max(w, lerp(chestW, widest, 0.5)), lower * straight),
        lerp(d, Math.max(d, deepest * 0.96), lower * straight),
        z,
      ];
    });
    const first = draped[0];
    const hang = tucked ? 0 : (top.ease * 0.01 + (heavy ? 0.006 : 0)) * k;
    const shell = [
      [hem, first[1] + hang, first[2] + hang, first[3]],
      ...draped,
    ].map(([y, w, d, z]) => {
      const over = clamp((beltY + 0.03 * k - y) / (0.03 * k), 0, 1);
      const add = tucked
        ? lerp(ease, Math.min(ease, seatEase - 0.005 * k), over)
        : ease + over * (seatEase + 0.004 * k);
      return [y, w + add, d + add, z];
    });
    // Close the neckline around the base of the neck.
    const collarRow = shell.at(-1);
    collarRow[1] = 0.066 * k * f.neck + 0.006 * k + ease * 0.3;
    collarRow[2] = 0.068 * k * f.neck + 0.006 * k + ease * 0.3;
    sweep(
      "shirt body",
      bodyOrigin,
      rings(bodyOrigin, shell),
      top.color,
      garment(),
      "body",
    );
    const [cy, cw, cd, cz] = collarRow;
    const collar =
      top.kind === "hoodie"
        ? [
            [cy - 0.02 * k, cw + 0.028 * k, cd + 0.03 * k, cz - 0.014 * k],
            [cy + 0.012 * k, cw + 0.034 * k, cd + 0.04 * k, cz - 0.024 * k],
            [cy + 0.04 * k, cw + 0.02 * k, cd + 0.03 * k, cz - 0.03 * k],
          ]
        : top.kind === "tee"
          ? [
              [cy - 0.01 * k, cw + 0.006 * k, cd + 0.006 * k, cz],
              [cy + 0.006 * k, cw + 0.003 * k, cd + 0.004 * k, cz],
            ]
          : [
              [cy - 0.012 * k, cw + 0.007 * k, cd + 0.007 * k, cz],
              [cy + 0.012 * k, cw + 0.002 * k, cd + 0.003 * k, cz - 0.002 * k],
              [cy + 0.03 * k, cw + 0.008 * k, cd + 0.008 * k, cz - 0.004 * k],
            ];
    sweep(
      "collar",
      bodyOrigin,
      rings(bodyOrigin, collar),
      top.kind === "shirt" ? top.trim : top.color,
      garment(),
      "body",
    );
    if (top.kind === "shirt" || top.kind === "jacket") {
      // A raised front placket with buttons gives the cloth a readable front.
      const front = (y) => {
        const upper = shell.findIndex((r) => r[0] >= y),
          a = shell[Math.max(0, upper - 1)],
          b = shell[Math.max(0, upper)];
        const t = b === a ? 0 : clamp((y - a[0]) / (b[0] - a[0]), 0, 1);
        return lerp(a[3] + a[2], b[3] + b[2], t);
      };
      const from = hem + 0.012 * k,
        to = cy - 0.03 * k;
      const rowsUp = Array.from({ length: 6 }, (_, i) => lerp(from, to, i / 5));
      sweep(
        "placket",
        bodyOrigin,
        rowsUp.map((y) => [
          0,
          y - hipY,
          front(y) - 0.004 * k,
          0.014 * k,
          0.006 * k,
        ]),
        top.kind === "jacket" ? top.trim : top.color,
        garment(),
        "body",
      );
      for (let i = 0; i < 4; i++) {
        const y = lerp(from + 0.04 * k, to - 0.02 * k, i / 3);
        parts.push({
          id: "button " + (i + 1),
          shape: "ellipsoid",
          position: [0, y, front(y) + 0.002 * k],
          size: [0.013 * k, 0.013 * k, 0.006 * k],
          frameSize: [0.013 * k, 0.013 * k, 0.006 * k],
          rotation: [0, 0, 0],
          color: top.trim,
          ...garment("plain"),
        });
        links["button " + (i + 1)] = "body";
      }
    }
  }
  return {
    outfit: "Work clothes",
    appearance: {
      palette: "Tide",
      face: f.face,
      skin: f.skin,
      hairColor: f.hairColor,
      hair: f.hair,
    },
    origin: { generator: 2, kind: "figure", figure: f },
    ...bindParts({ parts }, links),
  };
}

// A real random draw inside ordinary adult ranges.
export function randomFigure(draw) {
  const between = (a, b) => a + (b - a) * draw(),
    choose = (items) => items[Math.floor(draw() * items.length)];
  const heavy = draw() < 0.3 ? between(0.15, 0.7) : 0;
  return {
    height: between(1.52, 1.93),
    heads: between(7, 7.8),
    shoulders: between(0.88, 1.14),
    chest: between(0.9, 1.15) + heavy * 0.2,
    waist: between(0.88, 1.12) + heavy * 0.5,
    hips: between(0.9, 1.14) + heavy * 0.2,
    belly: heavy * between(0.5, 1),
    limbs: between(0.86, 1.16) + heavy * 0.25,
    legs: between(0.96, 1.04),
    skin: choose(["#ac785a", "#c9997c", "#8d5d43", "#e0b193", "#70462f"]),
    face: Math.floor(draw() * 4),
    hair: choose(figureHair),
    hairColor: choose(["#372e2a", "#292624", "#786353", "#a9864e", "#8a8a86"]),
    groom:
      draw() < 0.75
        ? {
            pattern: choose(figureGrooms),
            length: between(0.12, 0.9),
            curl: between(0.05, 0.8),
            sweep: between(-0.5, 0.5),
            volume: between(0.2, 0.7),
            seed: Math.floor(draw() * 4294967296),
          }
        : null,
    top: {
      kind: choose(figureTops.slice(0, 4)),
      sleeves: choose(figureSleeves.slice(0, 3)),
      color: choose([
        "#5d7d86",
        "#8a4b3c",
        "#d9d2bf",
        "#4f6b4a",
        "#31465e",
        "#b98b3d",
      ]),
      ease: between(0.1, 0.8),
      length: between(0.25, 0.8),
    },
    bottom: {
      kind: draw() < 0.8 ? "trousers" : "shorts",
      color: choose(["#3c4656", "#5b5348", "#2f3532", "#7b7462", "#42506b"]),
      ease: between(0.1, 0.8),
    },
    shoes: {
      kind: choose(["sneakers", "sneakers", "boots"]),
      color: choose(["#d8d4c8", "#4a3a2c", "#2c2f33", "#a8472f"]),
    },
  };
}
