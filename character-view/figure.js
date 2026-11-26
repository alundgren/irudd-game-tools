import { validSectionProfile } from "./section-profile.js";
import { Vector3 } from "three";
import { eyeDefaults } from "./ocular.js";
import { restingWrist } from "./resting-wrist.js";
import { bindParts } from "./rig.js";

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

export const figureArchetypes = {
  neutral: {
    shoulders: 1,
    chest: 1,
    waist: 1,
    hips: 1,
    limbs: 1,
    neck: 1,
    hands: 1,
    pectoral: 0.014,
  },
  male: {
    shoulders: 1.07,
    chest: 1.045,
    waist: 1.035,
    hips: 0.97,
    limbs: 1.045,
    neck: 1.06,
    hands: 1.035,
    pectoral: 0.01,
  },
  female: {
    shoulders: 0.94,
    chest: 0.97,
    waist: 0.96,
    hips: 1.09,
    limbs: 0.955,
    neck: 0.95,
    hands: 0.965,
    pectoral: 0.025,
  },
};

export const figureTops = ["shirt", "tee", "jacket", "hoodie", "none"];
export const figureSleeves = ["long", "rolled", "short", "none"];
export const figureBottoms = ["trousers", "shorts", "none"];
export const figurePockets = ["none", "cargo"];
export const figureShoes = ["sneakers", "boots", "none"];
export const figureHair = ["Crop", "Sweep", "Coils", "Bald"];
export const figureGrooms = ["Locks", "Side part", "Coils", "Braids", "Locs"];

export function readFigure(raw = {}) {
  const f = raw && typeof raw === "object" ? raw : {};
  const top = f.top ?? {},
    bottom = f.bottom ?? {},
    shoes = f.shoes ?? {},
    stance = f.stance ?? {};
  const archetype = Object.hasOwn(figureArchetypes, f.archetype)
    ? f.archetype
    : "neutral";
  const base = figureArchetypes[archetype];
  return {
    archetype,
    ...(validSectionProfile(f.sectionProfile)
      ? { sectionProfile: structuredClone(f.sectionProfile) }
      : {}),
    height: number(f.height, 1.2, 2.2, 1.72),
    heads: number(f.heads, 6, 8.4, 7.4),
    shoulderRise: number(f.shoulderRise, -.04, .065, 0),
    shoulders: number(f.shoulders, 0.7, 1.4, base.shoulders),
    chest: number(f.chest, 0.7, 1.95, base.chest),
    waist: number(f.waist, 0.7, 2.05, base.waist),
    hips: number(f.hips, 0.7, 1.85, base.hips),
    belly: number(f.belly, 0, 1, 0),
    chestFullness: number(f.chestFullness, 0, 1, 0),
    lowerAbdomen: number(f.lowerAbdomen, 0, 1, 0),
    muscleRelief: number(f.muscleRelief, 0, 1, 0),
    ribDepth: number(f.ribDepth, 0.65, 1.9, 1),
    pelvisDepth: number(f.pelvisDepth, 0.65, 1.9, 1),
    legBuild: number(f.legBuild, 0.65, 1.65, 1),
    abdomenDepth: number(f.abdomenDepth, 0.65, 1.9, 1),
    limbs: number(f.limbs, 0.7, 1.6, base.limbs),
    legs: number(f.legs, 0.9, 1.1, 1),
    arms: number(f.arms, 0.88, 1.12, 1),
    neck: number(f.neck, 0.75, 1.35, base.neck),
    hands: number(f.hands, 0.85, 1.2, base.hands),
    skin: hex(f.skin, "#b98566"),
    face: Number.isInteger(f.face) ? clamp(f.face, 0, 3) : 0,
    hair: pick(f.hair, figureHair),
    hairColor: hex(f.hairColor, "#3a2e28"),
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
      ...(Number.isFinite(stance.forearmSpread) ? {forearmSpread:number(stance.forearmSpread, 0, 85, 0)} : {}),
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
      pockets: pick(bottom.pockets, figurePockets),
    },
    shoes: {
      kind: pick(shoes.kind, figureShoes),
      color: hex(shoes.color, "#d8d4c8"),
      sole: hex(shoes.sole, "#f2efe6"),
    },
  };
}

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
  const body = (role) => ({
    outfitRole: role,
    bare: true,
    ...(role === "foot" ? {} : { seamGroup: "figure" }),
  });
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
    neckBase = chin - 0.05 * k * f.neck - 0.012 * k + f.shoulderRise*k,
    shoulderY = neckBase - 0.036 * k,
    crotch = 0.468 * H * f.legs,
    hipY = crotch + 0.088 * k,
    waistY = lerp(hipY, shoulderY, 0.4),
    chestY = lerp(hipY, shoulderY, 0.72),
    kneeY = crotch * 0.585 + 0.012 * k,
    ankleY = 0.078 * k;
  const sw = 0.194 * k * f.shoulders,
    chestW = 0.158 * k * f.chest,
    waistW = 0.134 * k * f.waist,
    hipW = 0.168 * k * f.hips,
    bellyOut = f.belly * 0.11 * k;
  const chestD = 0.105 * k * lerp(1, f.chest, 0.7) * f.ribDepth,
    waistD =
      0.094 * k * lerp(1, f.waist, 0.8) * f.abdomenDepth + bellyOut * 0.5,
    hipD = 0.106 * k * lerp(1, f.hips, 0.6) * f.pelvisDepth;
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
    [waistY, waistW + bellyOut * 0.22, waistD, 0.012 * k + bellyOut * 0.44],
    [
      lerp(waistY, chestY, 0.55),
      lerp(waistW, chestW, 0.6) + bellyOut * 0.1,
      lerp(waistD, chestD, 0.7) + bellyOut * 0.12,
      -0.003 * k + bellyOut * 0.2,
    ],
    [chestY, chestW, chestD, -0.013 * k],
    [
      lerp(chestY, shoulderY, 0.39),
      lerp(chestW, sw, 0.45),
      chestD * 0.98,
      -0.022 * k,
    ],
    [shoulderY - 0.037 * k, sw * 0.965, chestD * 0.88, -0.026 * k],
    [shoulderY - 0.008 * k, sw * 0.875, chestD * 0.79, -0.024 * k],
    [lerp(shoulderY, neckBase, 0.28), sw * 0.68, 0.084 * k, -0.022 * k],
    [lerp(shoulderY, neckBase, 0.65), sw * 0.44, 0.073 * k, -0.016 * k],
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

  const headScale = headHeight / 0.294;
  const neckOrigin = new Vector3(0, neckBase, -0.012 * k);
  const neckRows = [
    [neckBase - 0.031 * k, 0.093, 0.073, -0.019],
    [neckBase - 0.006 * k, 0.068, 0.065, -0.016],
    [neckBase + 0.019 * k, 0.056, 0.057, -0.011],
    [lerp(neckBase, chin, 0.74), 0.05, 0.055, -0.011],
    [chin + 0.006 * k, 0.049, 0.053, -0.008],
    [chin + 0.04 * k, 0.054, 0.058, -0.004],
    [chin + 0.071 * k, 0.056, 0.064, -0.005],
    [chin + 0.099 * k, 0.049, 0.06, -0.007],
    [chin + 0.12 * k, 0.037, 0.047, -0.002],
  ].map(([y, w, d, z]) => [y, w * k * f.neck, d * k * f.neck, z * k]);
  const neckPulls = [0.24, 0.52, 0.79].map((t) => ({
    at: [
      (0.018 + 0.029 * t) * k,
      (chin - neckBase + 0.045 * k) * t,
      (0.053 - 0.028 * t) * k,
    ],
    reach: [0.014 * k, 0.032 * k, 0.032 * k],
    offset: [0.002 * k, 0, 0.0035 * k],
    mirrorX: 0,
  }));
  sweep(
    "neck",
    neckOrigin,
    rings(neckOrigin, neckRows),
    f.skin,
    {
      anatomy: "neck",
      motionRole: "rigid",
      seamGroup: "figure",
      pulls: neckPulls,
    },
    "body",
  );
  parts.push({
    id: "head",
    shape: "head",
    cranialProfile: "adult",
    eyesRig: { ...eyeDefaults },
    position: [0, chin - 0.046 * headScale, 0.014 * k],
    size: [headScale, headScale, headScale],
    rotation: [0, 0, 0],
  });
  if (f.groom) parts.at(-1).groom = { ...f.groom, color: f.hairColor };
  links.head = "neck";

  const armLength = f.arms * H;
  for (const side of [1, -1]) {
    const name = side > 0 ? "left " : "right ";
    const spread = f.stance.arms * rad,
      bend = f.stance.elbows * rad;
    const armRadius = 0.046 * k * m;
    const shoulder = new Vector3(
      side * (sw + 0.024 * k - armRadius),
      shoulderY + 0.007 * k - armRadius,
      -0.018 * k,
    );
    const upperDir = new Vector3(
      side * Math.sin(spread),
      -Math.cos(spread),
      -0.105,
    ).normalize();
    const lowerSpread = f.stance.forearmSpread === undefined ? spread*.72 : f.stance.forearmSpread*rad;
    const lowerDir = new Vector3(
      side * Math.sin(lowerSpread) * Math.cos(bend),
      -Math.cos(lowerSpread) * Math.cos(bend),
      Math.sin(bend),
    ).normalize();
    const upperLength = 0.169 * armLength,
      lowerLength = 0.14 * armLength;
    const elbow = shoulder.clone().addScaledVector(upperDir, upperLength),
      wrist = elbow.clone().addScaledVector(lowerDir, lowerLength);
    const a = (v) => v * k * m;
    const upperStations = [
      [0, a(0.046), a(0.052)],
      [0.13, a(0.054), a(0.06), side * 0.006 * k],
      [0.27, a(0.05), a(0.055), side * 0.005 * k, -0.002 * k],
      [0.4, a(0.044), a(0.051), -side * 0.001 * k, 0.002 * k],
      [0.57, a(0.046), a(0.054), -side * 0.003 * k, 0.005 * k],
      [0.83, a(0.035), a(0.039), -side * 0.002 * k, -0.007 * k],
      [1, a(0.036), a(0.039)],
    ];
    const lowerStations = [
      [0, a(0.036), a(0.039)],
      [0.2, a(0.042), a(0.044), side * 0.005 * k, -0.005 * k],
      [0.45, a(0.037), a(0.037), side * 0.003 * k, -0.002 * k],
      [0.76, a(0.029), a(0.026)],
      [1, a(0.022), a(0.024)],
    ];
    for (const station of upperStations) {
      const t = station[0];
      const peak = Math.sin(Math.PI * t);
      station[3] = (station[3] ?? 0) + side * k * f.muscleRelief * 0.006 * peak;
      station[4] = (station[4] ?? 0) + k * f.muscleRelief * 0.008 * peak;
      station[2] *= 1 + f.muscleRelief * 0.14 * peak;
    }
    for (const station of lowerStations) {
      const t = station[0];
      const wrist = f.lowerAbdomen * Math.max(0, m - 1) * t * t;
      station[1] *= 1 - 0.5 * wrist;
      station[2] *=
        1 + 0.1 * f.muscleRelief * Math.sin(Math.PI * t) - 0.45 * wrist;
    }
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
    const handSize = [0.082, 0.182, 0.04].map((v) => v * k * f.hands);
    parts.push({
      id: name + "hand",
      shape: "hand",
      position: wrist
        .clone()
        .addScaledVector(lowerDir, -0.004 * k)
        .toArray(),
      size: handSize,
      frameSize: [...handSize],
      rotation: restingWrist(lowerDir, new Vector3(-side, 0, -0.2)),
      color: f.skin,
      outfitRole: "hand",
      motionRole: "hand",
      grip: {
        side: -side,
        fingers: 4,
        relaxed: true,
        curl: f.stance.curl,
        spread: 0.18,
      },
    });
    links[name + "hand"] = name + "forearm";

    const top = f.top;
    if (top.kind !== "none") {
      const heavy = top.kind === "jacket" || top.kind === "hoodie";
      const ease = (0.004 + top.ease * 0.011 + (heavy ? 0.009 : 0)) * k;
      const cloth = (stations, more = 0, seam = true) =>
        stations.map(([t, w, d, dx, dz]) => {
          const add = Math.max(
            (ease + more) * (seam ? lerp(0.45, 1, clamp(t / 0.3, 0, 1)) : 1),
            0.0055 * k,
          );
          return [t, w + add, d + add, dx, dz];
        });
      const sleeves =
        top.kind === "tee" && top.sleeves === "long" ? "short" : top.sleeves;
      if (sleeves === "none") {
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

    const hipJoint = new Vector3(
      side * 0.086 * k * lerp(1, f.hips, 0.7),
      hipY,
      -0.004 * k,
    );
    const foot = side * 0.098 * k * f.stance.feet;
    const knee = new Vector3(lerp(hipJoint.x, foot, 0.56), kneeY, 0.026 * k),
      ankle = new Vector3(foot, ankleY, -0.038 * k);
    const thighDir = knee.clone().sub(hipJoint),
      thighLength = thighDir.length();
    thighDir.normalize();
    const shinDir = ankle.clone().sub(knee),
      shinLength = shinDir.length();
    shinDir.normalize();
    const l = (v) =>
      v * k * lerp(1, m, 0.85) * lerp(1, f.hips, 0.3) * f.legBuild;
    const thighStations = [
      [0, l(0.08), l(0.088), 0, -0.017 * k],
      [0.2, l(0.085), l(0.097), side * 0.003 * k, -0.009 * k],
      [0.5, l(0.074), l(0.083), side * 0.003 * k, 0.007 * k],
      [0.8, l(0.057), l(0.062), -side * 0.004 * k, 0.005 * k],
      [1, l(0.051), l(0.055)],
    ];
    const shinStations = [
      [0, l(0.051), l(0.055)],
      [0.14, l(0.045), l(0.048), 0, -0.004 * k],
      [0.32, l(0.052), l(0.061), side * 0.004 * k, -0.014 * k],
      [0.6, l(0.04), l(0.045), -side * 0.002 * k, -0.007 * k],
      [0.84, l(0.0275), l(0.032), 0, -0.003 * k],
      [1, l(0.03), l(0.036)],
    ];
    for (const station of thighStations) {
      const t = station[0],
        arc = Math.sin(Math.PI * t);
      station[1] *= 1 + 0.13 * f.muscleRelief * arc;
      station[2] *= 1 + 0.1 * f.muscleRelief * arc;
      station[3] =
        (station[3] ?? 0) +
        side * 0.012 * k * f.muscleRelief * Math.sin(2 * Math.PI * t);
    }
    for (const station of shinStations) {
      const t = station[0],
        arc = Math.sin(Math.PI * t);
      station[2] *= 1 + 0.13 * f.muscleRelief * arc;
      station[4] = (station[4] ?? 0) - 0.008 * k * f.muscleRelief * arc;
    }
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
    const toe = side * 0.105;
    const footPath = (rows) =>
      rows.map(([z, y, w, d, across = 0]) => {
        const medial =
          side * (across - 0.012 * clamp((z - 0.055) / 0.125, 0, 1));
        return [
          (Math.sin(toe) * z + Math.cos(toe) * medial) * k,
          y * k - ankleY,
          (Math.cos(toe) * z - Math.sin(toe) * medial) * k + 0.012 * k,
          w * k,
          d * k,
        ];
      });
    sweep(
      name + "foot",
      ankle,
      footPath([
        [-0.062, 0.03, 0.012, 0.012],
        [-0.054, 0.033, 0.027, 0.028],
        [-0.02, 0.044, 0.031, 0.042],
        [0.03, 0.044, 0.034, 0.039],
        [0.085, 0.033, 0.042, 0.028],
        [0.135, 0.022, 0.046, 0.02],
        [0.17, 0.017, 0.034, 0.012],
        [0.19, 0.015, 0.018, 0.009],
      ]),
      f.skin,
      {
        ...body("foot"),
        footSection: "bare",
        seamGroup: name + "foot",
      },
      name + "shin",
    );
    {
      const digits = {
        motionRole: "rigid",
        visibleIn:
          f.shoes.kind === "none" ? ["Work clothes", "Anatomy"] : ["Anatomy"],
        seamGroup: name + "foot",
      };
      sweep(
        name + "heel",
        ankle,
        [
          [0, -0.047 * k, 0, 0.029 * k, 0.033 * k],
          [0, -0.025 * k, -0.004 * k, 0.032 * k, 0.037 * k],
          [0, 0, -0.002 * k, 0.03 * k, 0.035 * k],
          [0, 0.022 * k, 0, 0.025 * k, 0.029 * k],
          [0, 0.046 * k, 0.002 * k, 0.014 * k, 0.018 * k],
        ],
        f.skin,
        digits,
        name + "foot",
      );
      const toes = [
        [-0.031, 0.198, 0.013],
        [-0.01, 0.193, 0.0095],
        [0.0075, 0.182, 0.0087],
        [0.023, 0.168, 0.0077],
        [0.036, 0.151, 0.007],
      ];
      toes.forEach(([x, tip, r], i) => {
        const root = 0.123 - i * 0.003;
        sweep(
          name + "toe " + (i + 1),
          ankle,
          footPath([
            [root, 0.018, r * 1.13, r * 1.13, x * 0.8],
            [lerp(root, tip, 0.4), 0.016, r, r, x * 0.94],
            [lerp(root, tip, 0.75), 0.013, r * 0.89, r * 0.86, x],
            [tip, 0.012, r * 0.55, r * 0.61, x],
          ]),
          f.skin,
          digits,
          name + "foot",
        );
      });
    }
    if (f.shoes.kind !== "none") {
      const boot = f.shoes.kind === "boots";
      sweep(
        name + "shoe",
        ankle,
        footPath([
          [-0.07, 0.043, 0.015, 0.022],
          [-0.062, 0.047, 0.033, 0.039],
          [-0.032, 0.054, 0.041, 0.048],
          [0.017, 0.054, 0.043, 0.048],
          [0.067, 0.042, 0.044, 0.036],
          [0.116, 0.032, 0.053, 0.026],
          [0.162, 0.027, 0.048, 0.021],
          [0.191, 0.026, 0.036, 0.017],
          [0.202, 0.028, 0.015, 0.012],
        ]),
        f.shoes.color,
        { ...garment("leather"), footSection: "upper" },
        name + "foot",
      );
      sweep(
        name + "sole",
        ankle,
        footPath([
          [-0.074, 0.013, 0.019, 0.009],
          [-0.064, 0.011, 0.036, 0.011],
          [-0.028, 0.011, 0.042, 0.011],
          [0.015, 0.014, 0.04, 0.009],
          [0.072, 0.012, 0.045, 0.009],
          [0.124, 0.01, 0.054, 0.01],
          [0.174, 0.011, 0.046, 0.01],
          [0.198, 0.015, 0.03, 0.009],
          [0.205, 0.019, 0.015, 0.007],
        ]),
        f.shoes.sole,
        { ...garment("leather"), footSection: "sole" },
        name + "foot",
      );
      sweep(
        name + "shoe tongue",
        ankle,
        footPath([
          [0, 0.099, 0.016, 0.008],
          [0.04, 0.089, 0.018, 0.008],
          [0.09, 0.072, 0.019, 0.007],
          [0.128, 0.056, 0.016, 0.006],
        ]),
        f.shoes.color,
        garment("leather"),
        name + "foot",
      );
      const across = (z, a, y) => [
        (Math.sin(toe) * z + Math.cos(toe) * a) * k,
        y * k - ankleY,
        (Math.cos(toe) * z - Math.sin(toe) * a) * k + 0.012 * k,
        0.0034 * k,
        0.0034 * k,
      ];
      [
        [0.03, 0.105, 0.021],
        [0.06, 0.086, 0.023],
        [0.09, 0.074, 0.024],
        [0.118, 0.065, 0.023],
      ].forEach(([z, y, a], i) =>
        sweep(
          `${name}lace ${i + 1}`,
          ankle,
          [across(z, -a, y - 0.009), across(z, 0, y), across(z, a, y - 0.009)],
          f.shoes.sole,
          garment("leather"),
          name + "foot",
        ),
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
          [f.shoes.kind === "boots" ? 0.86 : 0.93, hemW, hemD, 0, 0.002 * k],
        ];
        if (bottom.cuffs) {
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
      if (bottom.pockets === "cargo") {
        const shorts = bottom.kind === "shorts",
          from = shorts ? 0.27 : 0.44,
          to = shorts ? 0.5 : 0.72;
        const out = (t, proud) => {
          const i = upper.findIndex((row) => row[0] >= t),
            a = upper[Math.max(0, i - 1)],
            b = upper[i < 0 ? upper.length - 1 : i];
          const w = lerp(
            a[1],
            b[1],
            b[0] > a[0] ? clamp((t - a[0]) / (b[0] - a[0]), 0, 1) : 0,
          );
          return side * (w + proud * k);
        };
        const pouch = (id, rows) =>
          sweep(
            name + id,
            hipJoint,
            limbKnots(
              hipJoint,
              hipJoint,
              thighDir,
              thighLength,
              rows.map(([t, w, d, proud]) => [
                t,
                w * k,
                d * k,
                out(t, proud),
                0.004 * k,
              ]),
              [0, 0],
            ),
            bottom.color,
            garment(),
            name + "thigh",
          );
        pouch("cargo pocket", [
          [from, 0.007, 0.04, -0.002],
          [from + 0.03, 0.014, 0.047, -0.003],
          [to - 0.03, 0.016, 0.049, -0.003],
          [to, 0.008, 0.043, -0.003],
        ]);
        pouch("pocket flap", [
          [from - 0.012, 0.008, 0.049, 0.002],
          [from + 0.05, 0.01, 0.051, 0.006],
          [from + 0.065, 0.004, 0.047, 0.006],
        ]);
      }
    }
  }

  const fitted = (rows, ease, depthEase = ease) =>
    rows.map(([y, w, d, z, x]) => [y, w + ease, d + depthEase, z, x]);
  const beltY = lerp(hipY, waistY, 0.35 + 0.62 * f.bottom.rise);
  if (f.bottom.kind !== "none") {
    const ease = (0.009 + f.bottom.ease * 0.012) * k;
    const legScale = k * lerp(1, m, 0.85) * lerp(1, f.hips, 0.3) * f.legBuild;
    const legEase = f.bottom.ease * 0.01 * k + 0.003 * k;
    const seamW = 0.086 * k * lerp(1, f.hips, 0.7) + 0.083 * legScale + legEase;
    const seamD = 0.089 * legScale + 0.007 * k + legEase;
    const gusset = [
      [crotch - 0.046 * k, seamW * 0.1, 0.034 * k, -0.008 * k],
      [crotch - 0.034 * k, seamW * 0.26, 0.058 * k, -0.008 * k],
      [crotch - 0.018 * k, seamW * 0.5, 0.076 * k, -0.007 * k],
      [crotch - 0.006 * k, seamW * 0.78, 0.092 * k, -0.006 * k],
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
    const tucked = worn && !heavy && top.length < 0.12;
    const hem = tucked
      ? beltY - 0.012 * k
      : lerp(beltY - 0.035 * k, crotch + 0.004 * k, top.length);
    const rows = torsoRows.filter(
      ([y]) => y > hem + 0.015 * k && y <= neckBase + 0.001,
    );
    const widest = Math.max(...rows.slice(0, 3).map((r) => r[1])),
      deepest = Math.max(...rows.slice(0, 3).map((r) => r[2]));
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
              [cy - 0.009 * k, cw + 0.004 * k, cd + 0.004 * k, cz],
              [cy - 0.001 * k, cw + 0.001 * k, cd + 0.001 * k, cz],
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
  const paired = (x, y, z, rx, ry, rz, dx, dy, dz) => ({
    at: [x, y - hipY, z],
    reach: [rx, ry, rz],
    offset: [dx, dy, dz],
    mirrorX: 0,
  });
  for (const part of parts) {
    const id = part.id;
    if (id === "shirt body" || / (?:cuff sleeve|sleeve)$/.test(id))
      part.seamGroup = "top";
    if (
      id === "trouser seat" ||
      / (?:short leg|trouser thigh|trouser shin)$/.test(id)
    )
      part.seamGroup = "bottom";
    const side = id.startsWith("left ") ? 1 : -1;
    if (/ (upper arm|forearm|sleeve|cuff sleeve)$/.test(id) && part.knots) {
      const upper =
        id.endsWith("upper arm") ||
        id === (side > 0 ? "left sleeve" : "right sleeve");
      const under = parts.find(
        (p) =>
          p.id ===
          (side > 0 ? "left " : "right ") + (upper ? "upper arm" : "forearm"),
      );
      const stations = under.knots.slice(3, -3);
      const landmark = (station, face, reach, offset) => {
        const [x, y, z, w, d] = stations[station];
        return {
          at: [x + face[0] * w, y, z + face[1] * d],
          reach: reach.map((v) => v * k),
          offset: offset.map((v) => v * k),
        };
      };
      part.pulls = upper
        ? [
            landmark(
              2,
              [side * 0.76, -0.56],
              [0.052, 0.086, 0.052],
              [side * 0.004, 0.003, -0.009],
            ),
            landmark(
              4,
              [-side * 0.28, 0.9],
              [0.048, 0.066, 0.043],
              [-side * 0.004, 0.003, 0.007],
            ),
            landmark(6, [0, -1], [0.033, 0.039, 0.038], [0, -0.004, -0.009]),
          ]
        : [
            landmark(0, [0, -1], [0.033, 0.039, 0.038], [0, -0.004, -0.009]),
            landmark(
              1,
              [side * 0.8, 0.24],
              [0.04, 0.067, 0.048],
              [side * 0.006, 0.003, 0.003],
            ),
            landmark(
              3,
              [-side * 0.65, -0.5],
              [0.031, 0.054, 0.032],
              [-side * 0.002, 0, -0.003],
            ),
          ];
    }
    if (id.endsWith(" shin") && part.bare) {
      const stations = part.knots.slice(3, -3);
      const stroke = (index, x, z, reach, offset) => {
        const knot = stations[index];
        return {
          at: [knot[0] + side * x * knot[3], knot[1], knot[2] + z * knot[4]],
          reach: reach.map((v) => v * k),
          offset: [side * offset[0] * k, offset[1] * k, offset[2] * k],
        };
      };
      part.pulls = [
        stroke(0, 0, 0.84, [0.036, 0.05, 0.034], [0, 0.001, 0.012]),
        stroke(1, -0.2, 0.88, [0.024, 0.074, 0.033], [0, 0, 0.006]),
        stroke(2, -0.63, -0.7, [0.042, 0.074, 0.043], [-0.007, -0.014, -0.006]),
        stroke(2, 0.66, -0.62, [0.038, 0.064, 0.047], [0.005, 0.013, -0.005]),
        stroke(5, 0.88, 0.05, [0.025, 0.035, 0.033], [0.006, -0.004, 0]),
      ];
    }
    if (id === "body" || id === "shirt body") {
      part.pulls = [
        paired(
          0.48 * chestW,
          chestY - 0.008 * k,
          0.78 * chestD - 0.013 * k,
          0.7 * chestW,
          0.102 * k,
          0.094 * k,
          0.005 * k,
          -0.005 * k,
          figureArchetypes[f.archetype].pectoral * k,
        ),
        paired(
          0.65 * chestW,
          chestY - 0.03 * k,
          0.65 * chestD - 0.013 * k,
          0.073 * k,
          0.048 * k,
          0.082 * k,
          0.003 * k,
          -0.003 * k,
          0.01 * k,
        ),
        paired(
          0.5 * chestW,
          chestY - 0.073 * k,
          0.86 * chestD - 0.012 * k,
          0.085 * k,
          0.032 * k,
          0.066 * k,
          0,
          0,
          -0.008 * k,
        ),
        paired(
          0.74 * sw,
          shoulderY - 0.025 * k,
          0.029 * k,
          0.078 * k,
          0.029 * k,
          0.063 * k,
          0,
          0.005 * k,
          0.006 * k,
        ),
        paired(
          0.59 * waistW,
          waistY - 0.033 * k,
          0.76 * waistD,
          0.062 * k,
          0.079 * k,
          0.067 * k,
          -0.002 * k,
          0,
          0.006 * k,
        ),
        paired(
          0,
          lerp(hipY, waistY, 0.61),
          -waistD,
          0.036 * k,
          0.115 * k,
          0.063 * k,
          0,
          0,
          0.008 * k,
        ),
        paired(
          0.58 * chestW,
          lerp(waistY, chestY, 0.43),
          0.068 * k,
          0.071 * k,
          0.057 * k,
          0.073 * k,
          0.003 * k,
          0,
          -0.01 * k,
        ),
        paired(
          0,
          shoulderY + 0.004 * k,
          0.053 * k,
          0.037 * k,
          0.041 * k,
          0.053 * k,
          0,
          -0.003 * k,
          -0.008 * k,
        ),
        paired(
          0.43 * sw,
          shoulderY - 0.009 * k,
          0.074 * k,
          0.073 * k,
          0.026 * k,
          0.055 * k,
          0,
          0.003 * k,
          0.007 * k,
        ),
        paired(
          0,
          chestY + 0.025 * k,
          chestD,
          0.028 * k,
          0.103 * k,
          0.067 * k,
          0,
          0,
          -0.006 * k,
        ),
        paired(
          0.38 * waistW,
          waistY + 0.03 * k,
          waistD,
          0.094 * k,
          0.12 * k,
          0.08 * k,
          0,
          0,
          0.009 * k,
        ),
        paired(
          0.53 * chestW,
          chestY + 0.015 * k,
          -0.076 * k,
          0.082 * k,
          0.105 * k,
          0.066 * k,
          0.003 * k,
          0,
          -0.022 * k,
        ),
        paired(
          0.68 * hipW,
          hipY + 0.055 * k,
          0.045 * k,
          0.064 * k,
          0.066 * k,
          0.094 * k,
          0.011 * k,
          0.005 * k,
          0.004 * k,
        ),
      ];
    }
    if (f.top.kind === "tee" && (id === "shirt body" || id === "collar")) {
      part.pulls ??= [];
      part.pulls.push(
        paired(
          0,
          neckBase,
          0.056 * k,
          0.11 * k,
          0.04 * k,
          0.072 * k,
          0,
          -0.028 * k,
          0.003 * k,
        ),
      );
    }
    if (id === "body" || id === "shirt body") {
      const relief = (across, y, rx, ry, rz, dy, dz, back = false) => {
        const hi = torsoRows.findIndex((row) => row[0] >= y);
        if (hi < 1) return;
        const lo = torsoRows[hi - 1],
          topRow = torsoRows[hi];
        const t = (y - lo[0]) / (topRow[0] - lo[0]);
        const w = lerp(lo[1], topRow[1], t),
          d = lerp(lo[2], topRow[2], t);
        const z =
          lerp(lo[3], topRow[3], t) +
          (back ? -1 : 1) * d * Math.sqrt(1 - across * across);
        (part.pulls ??= []).push(
          paired(across * w, y, z, rx * w, ry * k, rz * d, 0, dy * k, dz * k),
        );
      };
      if (f.chestFullness) {
        const fullness = f.chestFullness;
        const level = chestY - fullness * 0.042 * k;
        relief(
          0.47,
          level,
          0.6,
          0.112,
          0.95,
          -0.049 * fullness,
          0.094 * fullness,
        );
        relief(
          0.49,
          level - 0.082 * k,
          0.52,
          0.032,
          0.8,
          0.006 * fullness,
          -0.019 * fullness,
        );
      }
      if (f.lowerAbdomen) {
        const weight = f.lowerAbdomen;
        relief(
          0.25,
          hipY + 0.067 * k,
          0.9,
          0.117,
          1,
          -0.031 * weight,
          0.069 * weight,
        );
        relief(0.25, hipY + 0.158 * k, 0.91, 0.048, 0.82, 0, -0.019 * weight);
        relief(
          0.48,
          hipY + 0.002 * k,
          0.69,
          0.104,
          0.84,
          -0.013 * weight,
          -0.026 * weight,
          true,
        );
      }
      if (f.muscleRelief) {
        const strength = f.muscleRelief;
        relief(
          0.45,
          chestY + 0.016 * k,
          0.62,
          0.078,
          0.75,
          0,
          0.053 * strength,
        );
        relief(0.3, waistY + 0.102 * k, 0.33, 0.047, 0.72, 0, 0.014 * strength);
        relief(
          0.29,
          waistY + 0.039 * k,
          0.32,
          0.041,
          0.72,
          0,
          0.011 * strength,
        );
        relief(
          0.62,
          chestY + 0.042 * k,
          0.54,
          0.117,
          0.76,
          0,
          -0.032 * strength,
          true,
        );
      }
    }
    if (id === "body" || id === "trouser seat") {
      part.pulls ??= [];
      part.pulls.push(
        paired(
          0.53 * hipW,
          hipY - 0.012 * k,
          -hipD * 0.84,
          0.121 * k,
          0.141 * k,
          0.105 * k,
          0.006 * k,
          0.002 * k,
          -0.048 * k,
        ),
        paired(
          0,
          hipY - 0.025 * k,
          -hipD,
          0.031 * k,
          0.07 * k,
          0.055 * k,
          0,
          0,
          0.012 * k,
        ),
      );
    }
  }
  return {
    ...(f.sectionProfile
      ? { sectionProfile: { ...f.sectionProfile, height: H } }
      : {}),
    outfit: "Anatomy",
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

export function randomFigure(draw, preferredArchetype = "any") {
  const between = (a, b) => a + (b - a) * draw(),
    choose = (items) => items[Math.floor(draw() * items.length)];
  const heavy = draw() < 0.3 ? between(0.15, 0.7) : 0;
  const figure = {
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
  figure.bottom.pockets = draw() < 0.25 ? "cargo" : "none";
  const archetype = Object.hasOwn(figureArchetypes, preferredArchetype)
    ? preferredArchetype
    : choose(Object.keys(figureArchetypes));
  const base = figureArchetypes[archetype];
  figure.archetype = archetype;
  for (const key of ["shoulders", "chest", "waist", "hips", "limbs"])
    figure[key] *= base[key];
  return figure;
}
