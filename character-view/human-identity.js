
const clamp = (x, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, x));

export const faceOutlines = [
  [20, "oval", { faceSquare: -0.5, faceRound: 0.12, jaw: -0.2, chinPoint: 0.15, jawAngle: -0.15 }],
  [15, "round", { faceRound: 0.6, faceFlesh: 0.25, jaw: 0.2, chinHeight: -0.3, chin: -0.2, jawAngle: -0.3, cheekFullness: 0.3, faceHeight: -0.2, chinPoint: -0.3 }],
  [15, "square", { faceSquare: 0.7, jawAngle: 0.6, jaw: 0.5, chinHeight: -0.1, temples: 0.3, chinPoint: -0.4, jawDrop: 0.3 }],
  [14, "oblong", { faceRound: -0.42, faceHeight: 0.28, chinHeight: 0.35, forehead: 0.25, headWidth: -0.3, cheekHollow: 0.2, jawAngle: 0.15 }],
  [14, "heart", { faceTaper: 0.7, chinPoint: 0.5, jaw: -0.5, cheeks: 0.4, temples: 0.3, jawAngle: -0.35, chinHeight: 0.1 }],
  [11, "pear", { faceTaper: -0.6, jaw: 0.5, jawAngle: 0.4, temples: -0.4, faceFlesh: 0.15, jowlFullness: 0.2, forehead: -0.2 }],
  [11, "diamond", { faceDiamond: 0.5, cheeks: 0.6, temples: -0.4, chinPoint: 0.35, jaw: -0.3, cheekHollow: 0.3, malarHeight: 0.3 }],
];
const noses = [
  [22, "straight", { noseRoot: 0.2 }],
  [13, "aquiline", { noseCurve: 0.7, noseHump: 0.6, noseLength: 0.35, noseTipAngle: -0.35, noseBridge: 0.45, noseRoot: 0.3, noseBridgeWidth: -0.2 }],
  [12, "snub", { noseCurve: -0.6, noseTipAngle: 0.5, noseLength: -0.45, noseBridge: -0.25, noseBase: 0.3, noseHump: -0.4 }],
  [13, "broad", { nose: 0.7, nostrilWidth: 0.6, nostrilFlare: 0.5, noseBridgeWidth: 0.5, noseBridge: -0.3, noseVolume: 0.3, noseRoot: -0.2 }],
  [11, "narrow", { nose: -0.6, nostrilWidth: -0.5, noseBridgeWidth: -0.5, noseBridge: 0.35, noseTipWidth: -0.4, nostrilFlare: -0.4 }],
  [10, "bulbous", { noseVolume: 0.6, noseTipWidth: 0.55, nostrilFlare: 0.3, nose: 0.3, noseTipAngle: -0.1 }],
  [10, "long", { noseLength: 0.55, noseHeight: 0.25, noseTipAngle: -0.2, noseBridge: 0.3, noseVolume: 0.1 }],
  [9, "button", { noseLength: -0.5, noseVolume: -0.5, noseTipAngle: 0.3, nose: -0.2, noseBridge: -0.2, noseCurve: -0.25 }],
];
const eyes = [
  [22, "almond", {}],
  [12, "round", { eyeOpening: 0.3, eyeSize: 0.5, eyeInner: 0.3, eyeOuter: 0.3 }],
  [12, "narrow", { eyeOpening: -0.42, eyeOuter: -0.2, eyeSize: -0.15 }],
  [12, "hooded", { eyeFold: -0.6, brow: -0.35, eyeOuter: -0.4, eyeOpening: -0.25 }],
  [12, "deep-set", { eyeDepth: -0.7, browRidge: 0.35, brow: -0.3 }],
  [8, "prominent", { eyeDepth: 0.6, eyeOpening: 0.15, lidBag: 0.2, eyeSize: 0.3 }],
  [11, "upturned", { eyeTilt: 0.7, eyeOuter: 0.2 }],
  [11, "downturned", { eyeTilt: -0.6, eyeOuter: -0.3, lidBag: 0.15 }],
];
const mouths = [
  [22, "even", {}],
  [14, "full", { lipFullness: 0.7, lips: 0.2, mouthHeight: 0.4 }],
  [14, "thin", { lipFullness: -0.7, mouthHeight: -0.4, lips: 0.2 }],
  [12, "small", { lips: -0.6, cupidsBow: 0.4, lipFullness: 0.2 }],
  [14, "wide", { lips: 0.7, mouthHeight: 0.1 }],
  [12, "heavy lower lip", { lipBalance: -0.6, lipFullness: 0.3 }],
  [12, "long upper lip", { upperLipHeight: 0.6, mouthLevel: -0.3, cupidsBow: -0.2 }],
];
const brows = [
  [28, "level", {}],
  [18, "arched", { brow: 0.55, browAngle: 0.3 }],
  [18, "heavy", { brow: -0.55, browRidge: 0.45, foreheadSlope: -0.25 }],
  [18, "stern", { browAngle: -0.42, brow: -0.2 }],
  [18, "open", { browAngle: 0.5, brow: 0.2 }],
];
const moods = [[34, "neutral"], [26, "gentle"], [10, "warm"], [11, "stern"], [9, "wry"], [6, "weary"], [4, "alert"]];

function choose(table, at) {
  let left = at * table.reduce((sum, row) => sum + row[0], 0);
  for (const row of table) if ((left -= row[0]) < 0) return row;
  return table[table.length - 1];
}

export function drawIdentity(spec, u, { relaxed = true } = {}) {
  const bell = (key) => ((u(key + "/a") + u(key + "/b") + u(key + "/c")) * 2) / 3 - 1;
  const between = (key, lo, hi) => lo + (hi - lo) * u(key);
  const add = (key, amount) => (spec[key] = (spec[key] ?? 0) + amount);
  const age = spec.age ?? 0, frame = spec.frame ?? 0;
  const fullness = 0.72 * (spec.weight ?? 0) + 0.12 * (spec.belly ?? 0) - 0.2 * (spec.muscle ?? 0);

  const lead = Math.floor(u("ancestry") * 3), second = (lead + 1 + Math.floor(u("ancestry second") * 2)) % 3;
  const share = [0.07, 0.07, 0.07];
  if (u("ancestry mixed") < 0.3) {
    const part = between("ancestry part", 0.3, 0.7);
    share[lead] += 0.79 * part;
    share[second] += 0.79 * (1 - part);
  } else {
    const trace = 0.79 * between("ancestry part", 0.02, 0.28) * u("ancestry trace");
    share[lead] += 0.79 - trace;
    share[second] += trace;
  }
  spec.faceA = +clamp(Math.log(share[0] / share[2]) / 2.6).toFixed(3);
  spec.faceB = +clamp(Math.log(share[1] / share[2]) / 2.6).toFixed(3);

  const quiet = {
    jaw: 0.65, chin: 0.7, chinHeight: 0.55, jawProjection: 0.7, cheeks: 0.65, temples: 0.6, forehead: 0.6,
    nose: 0.6, noseBridge: 0.75, noseLength: 0.6, noseHump: 0.5, noseTipWidth: 1.2, nostrilWidth: 1.2, noseTipAngle: 1,
    lips: 0.6, lipFullness: 0.55, upperLipHeight: 0.7, cupidsBow: 0.7, eyeSize: 0.7, eyeTilt: 0.5, eyeFold: 0.6,
    brow: 0.5, underEye: 0.6, eyeSpacing: 1, headWidth: 0.9, craniumDepth: 1.25, faceHeight: 1,
  };
  for (const [key, keep] of Object.entries(quiet)) spec[key] = (spec[key] ?? 0) * keep;
  const small = {
    faceTaper: 0.14, faceRound: 0.14, faceSquare: 0.14, faceDiamond: 0.1, faceFlesh: 0.14,
    nasolabialFold: 0.22, cheekHollow: 0.25, lidBag: 0.25, jawAngle: 0.25, jawDrop: 0.3, chinCleft: 0.12, chinPoint: 0.25,
    noseVolume: 0.3, noseCurve: 0.3, noseRoot: 0.3, noseBridgeWidth: 0.35, nostrilFlare: 0.3, noseBase: 0.3, noseHeight: 0.45,
    eyeOpening: 0.22, eyeInner: 0.25, eyeOuter: 0.25, eyeDepth: 0.35, eyeLevel: 0.45, epicanthus: 0.2,
    browAngle: 0.2, browRidge: 0.15, foreheadSlope: 0.35, mouthHeight: 0.25,
  };
  for (const [key, size] of Object.entries(small)) spec[key] = size * bell("id " + key);

  const chosen = {};
  function wear(name, table, lo, hi) {
    const [, label, controls] = choose(table, u(name));
    const strength = between(name + " strength", lo, hi);
    for (const [key, amount] of Object.entries(controls)) add(key, amount * strength);
    chosen[name] = label;
    return label;
  }
  wear("outline", faceOutlines, 0.55, 1);
  wear("second outline", faceOutlines, 0, 0.3);
  wear("nose", noses, 0.55, 1);
  wear("eyes", eyes, 0.55, 1);
  wear("mouth", mouths, 0.55, 1);
  wear("brow", brows, 0.5, 1);
  if (u("cleft") < 0.14) add("chinCleft", between("cleft depth", 0.45, 1));
  add("epicanthus", 0.5 * (share[1] - 0.33));

  add("nasolabialFold", 1.05 * age - 0.12 + 0.15 * Math.max(0, fullness));
  add("lidBag", 0.75 * age - 0.1);
  add("underEye", 0.45 * age);
  add("cheekHollow", 0.45 * age - 0.5 * fullness);
  add("lipFullness", -0.35 * age);
  add("mouthHeight", -0.2 * age);
  add("noseVolume", 0.3 * age + 0.15 * frame);
  add("ears", 0.25 * age);
  add("eyeOpening", -0.22 * age - 0.1 * frame);
  add("brow", -0.18 * age);
  add("faceFlesh", 0.55 * fullness);
  add("browRidge", 0.3 * frame);
  add("jawAngle", 0.25 * frame - 0.2 * Math.max(0, fullness));
  add("chin", 0.12 * frame);
  add("lipFullness", -0.1 * frame);

  const skews = ["jawSkew", "noseSkew", "mouthSkew", "eyeSkew", "browSkew", "cheekSkew"];
  for (const key of skews) spec[key] = (key === "eyeSkew" ? 0.14 : 0.3) * bell("id " + key);
  if (u("lean") < 0.3) {
    const key = ["jawSkew", "noseSkew", "mouthSkew", "browSkew", "cheekSkew"][Math.floor(u("lean where") * 5)];
    add(key, (u("lean side") < 0.5 ? -1 : 1) * between("lean size", 0.3, 0.6));
  }

  if (relaxed) {
    const mood = choose(moods, u("mood"))[1], tilt = between("mood tilt", -0.08, 0.08);
    let smile = between("mood smile", -0.08, 0.14), corners = 0.14 + 0.2 * bell("mood corners");
    if (mood === "gentle") { smile = between("mood smile", 0.2, 0.5); corners += 0.15; }
    else if (mood === "warm") { smile = between("mood smile", 0.55, 0.85); corners += 0.3; add("eyeOpening", -0.12); }
    else if (mood === "stern") {
      smile = between("mood smile", -0.15, 0); corners = between("mood set", -0.28, -0.08);
      add("lipParting", -0.2); add("browAngle", -0.25); add("brow", -0.15);
    } else if (mood === "weary") {
      smile = -0.05; corners = between("mood set", -0.22, -0.06);
      add("eyeOpening", -0.2); add("lidBag", 0.2); add("brow", -0.1);
    } else if (mood === "alert") { add("lipParting", between("mood set", 0.3, 0.7)); add("eyeOpening", 0.15); add("brow", 0.2); }
    spec.smileLeft = smile + tilt;
    spec.smileRight = smile - tilt;
    if (mood === "wry") {
      const side = u("mood side") < 0.5 ? "smileLeft" : "smileRight", lift = between("mood set", 0.4, 0.75);
      spec[side] = lift;
      add("browSkew", (side === "smileLeft" ? 1 : -1) * 0.3);
      corners += 0.1;
    }
    spec.mouthCorners = corners - 0.12 * age;
    chosen.mood = mood;
  }

  if (spec.faceSquare > 0.3) spec.faceRound = Math.max(spec.faceRound, -0.15);
  const filled = ["faceFlesh", "jowlFullness", "cheekFullness", "submentalFullness"];
  const wide = 0.7 * Math.max(0, -Math.max(spec.faceTaper, -0.7)), full = filled.reduce((sum, key) => sum + Math.max(0, spec[key] ?? 0), 0);
  if (full + wide > 1.5) for (const key of filled) if (spec[key] > 0) spec[key] *= (1.5 - wide) / full;

  const outline = 0.8 * Math.max(0, Math.min(spec.faceSquare, 0.7)) + 0.8 * wide / 0.7, corners = Math.max(0, spec.jaw) + Math.max(0, spec.jawAngle);
  if (outline + corners > 1.35 && corners > 0)
    for (const key of ["jaw", "jawAngle"]) if (spec[key] > 0) spec[key] *= Math.max(0.25, (1.35 - outline) / corners);

  const ridge = Math.min(spec.noseHump, spec.noseCurve, spec.noseBridge);
  const overlap = clamp((ridge - 0.26) / 0.3, 0, 1);
  spec.noseBridgeWidth += 0.5 * overlap;
  spec.noseCurve *= 1 - 0.50 * overlap;
  spec.noseHump *= 1 - 0.50 * overlap;
  spec.noseBridge *= 1 - 0.24 * overlap;

  const limits = {
    faceRound: [-0.4, 0.8], faceDiamond: [-0.5, 0.65], faceSquare: [-0.8, 0.7], faceTaper: [-0.7, 0.85], noseVolume: [-0.8, 0.75],
    eyeOpening: [-0.36, 0.3], forehead: [-0.6, 0.5], eyeDepth: [-0.8, 0.6], browRidge: [-0.4, 0.8], eyeSkew: [-0.3, 0.3],
  };
  for (const key of Object.keys(spec)) {
    if (!Number.isFinite(spec[key]) || key === "height" || key === "age") continue;
    const [lo, hi] = limits[key] ?? [-1, 1];
    spec[key] = +clamp(spec[key], lo, hi).toFixed(3);
  }
  return { ...chosen, share };
}

export function skinLightness(share, at) {
  const lean = (0.2 * share[0] + 0.62 * share[1] + 0.74 * share[2]) / (share[0] + share[1] + share[2]);
  return clamp(lean + (at - 0.5) * 0.6, 0, 1);
}
