import {
  boneNames,
  boneParents,
  capturedAxes,
  castShapeAxes,
  identityAxes,
  portraitAxes,
  portraitFrames,
  type BoneName,
} from "./catalogue.js";
import type { HumanBody } from "./body.js";
import { castDonor, drawCastIdentity, drawCastSkin } from "./cast.js";
import { drawCapturedPortrait } from "./captured.js";
import { drawIdentity, randomStream, skinLightness, type Spec } from "./identity.js";
import { drawIdentityMarks, type FaceMark } from "./marks.js";
import { drawPosture, type Posture } from "./posture.js";
import {
  evaluateHuman,
  humanAxes,
  malarBend,
  restLipProfile,
  type HumanMeasurements,
  type HumanSurface,
} from "./surface.js";

const castShapeShare = 0.45,
  castShapeFrame = 0.2;

function item<T>(list: ReadonlyArray<T>, i: number): T {
  const v = list[i];
  if (v === undefined) throw new Error("Draw outside its list.");
  return v;
}

export type Archetype = "any" | "male" | "female" | "neutral";

export function randomHuman(
  body: HumanBody,
  seed: number,
  archetype: Archetype = "any",
  { relaxed = true, fitRestingLips = true }: { relaxed?: boolean; fitRestingLips?: boolean } = {},
): Spec {
  const draw = (key: string) => {
    let hash = seed >>> 0;
    for (const c of key) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
    return randomStream(hash)();
  };
  const between = (key: string, lo: number, hi: number) => +(lo + (hi - lo) * draw(key)).toFixed(3);
  const spec: Spec = Object.fromEntries(humanAxes.map((key) => [key, between(key, -0.79, 0.79)]));
  const g = (key: string) => spec[key] ?? 0;
  spec["age"] = +(draw("age") ** 1.4 * 0.92).toFixed(2);
  spec["frame"] =
    { male: 0.9, female: -0.9, neutral: 0, any: undefined }[archetype] ?? between("frame", -1, 1);
  const stature = 1.705 + 0.075 * g("frame");
  spec["height"] =
    archetype === "any"
      ? between("height", 1.52, 1.99)
      : between("height", stature - 0.14, stature + 0.14);
  spec["earTip"] = g("earTip") * 0.28;
  for (const key of [
    "shoulderLine",
    "upperBack",
    "armLead",
    "footLead",
    "leftArmLift",
    "rightArmLift",
  ])
    spec[key] = 0;
  for (const key of [
    "earLevel",
    "earSetback",
    "earLength",
    "craniumDepth",
    "faceHeight",
    "noseTipAngle",
    "noseTipWidth",
    "nostrilWidth",
  ])
    spec[key] = g(key) * 0.45;
  spec["mouthCorners"] = g("mouthCorners") * 0.55;
  spec["mouthProjection"] = g("mouthProjection") * 0.65;
  spec["lipParting"] = g("lipParting") * 0.18;
  spec["mouthLevel"] = g("mouthLevel") * 0.35;
  if (relaxed) {
    spec["mouthProjection"] = 0.42 * g("mouthProjection") + Math.min(0, 0.32 * g("chin")) - 0.2;
    spec["chin"] = 0.8 * g("chin") + Math.max(0, 0.26 * g("jawProjection"));
    spec["lipBalance"] = g("lipBalance") * 0.55;
  }
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  const spread = (x: number) => Math.sign(x) * Math.pow(Math.abs(x), 0.59);
  spec["weight"] = spread(between("mass", -1, 1));
  spec["muscle"] = spread(between("definition", -1, 1));
  const taper = between("torso taper", -1, 1);
  spec["shoulders"] = clamp(0.63 * g("shoulders") + 0.43 * taper + 0.25 * g("muscle"));
  spec["hips"] = clamp(0.64 * g("hips") - 0.46 * taper + 0.19 * g("weight"));
  spec["waist"] = clamp(0.64 * g("waist") + 0.55 * g("weight"));
  spec["belly"] = clamp(0.58 * g("belly") + 0.67 * g("weight") - 0.15 * g("muscle"));
  const lowerMass = 0.75 * g("weight") + 0.45 * g("belly") - 0.22 * g("muscle");
  spec["abdominalApron"] = Math.max(
    0,
    Math.min(1, (lowerMass - 0.36) * (0.45 + 0.7 * draw("lower abdomen"))),
  );
  if (relaxed) {
    const fullness = 0.72 * g("weight") + 0.12 * g("belly") - 0.2 * g("muscle");
    spec["cheekFullness"] = clamp(0.74 * g("cheekFullness") + 0.32 * fullness);
    spec["malarHeight"] = clamp(0.72 * g("malarHeight") + 0.12 * g("muscle") - 0.19 * g("age"));
    spec["jowlFullness"] = clamp(0.52 * g("jowlFullness") + 0.69 * fullness + 0.26 * g("age"));
    spec["submentalFullness"] = clamp(
      0.42 * g("submentalFullness") + 0.87 * fullness + 0.17 * g("age"),
    );
  }
  drawIdentity(spec, draw, { relaxed });
  for (const key of portraitAxes) spec[key] = 0;
  for (const key of castShapeAxes) spec[key] = 0;
  for (const key of capturedAxes) spec[key] = 0;
  const foundation =
    archetype === "any"
      ? (portraitAxes[Math.floor(draw("portrait foundation") * portraitAxes.length)] ??
        portraitAxes[0])
      : framedPortrait(g("frame"), draw("portrait foundation"));
  spec[foundation] = between("portrait strength", 0.62, 0.98);
  if (g("frame") > castShapeFrame && draw("cast foundation") < castShapeShare) {
    spec[foundation] = 0;
    const cast =
      castShapeAxes[Math.floor(draw("cast pick") * castShapeAxes.length)] ?? castShapeAxes[0];
    spec[cast] = between("cast strength", 0.7, 1);
  }
  spec["orbitalRim"] = Math.min(
    1,
    Math.max(0, between("orbital relief", 0.12, 0.8) + 0.18 * g("browRidge")),
  );
  spec["zygomaticArch"] = Math.min(
    1,
    Math.max(0, between("zygomatic arch", 0.16, 0.83) + 0.22 * g("cheekHollow")),
  );
  spec["lidDefinition"] = between("lid relief", 0.28, 0.83);
  spec["earDefinition"] = between("ear relief", 0.28, 0.89);
  spec["alarCrease"] = between("alar relief", 0.26, 0.87);
  for (const name of ["orbitCreases", "foreheadCreases", "mouthCreases"])
    spec[name] = +(g("age") ** 1.22 * between(name, 0.38, 1)).toFixed(3);
  spec["arms"] = clamp(0.59 * g("arms") + 0.41 * g("muscle") + 0.19 * g("weight"));
  spec["calves"] = clamp(0.65 * g("calves") + 0.29 * g("muscle") + 0.16 * g("weight"));
  spec["stance"] = relaxed ? 0.98 : between("stance", 0.36, 1);
  const rest: Readonly<Record<string, number>> = {
    armForward: -0.12,
    elbowBend: -0.49,
    legSpread: 0,
    handTwist: 0.05,
  };
  for (const key of ["armForward", "elbowBend", "legSpread", "handTwist"])
    spec[key] = relaxed ? (rest[key] ?? 0) : between(key, -0.5, 0.4);
  spec["wristFlex"] = relaxed ? 0.44 : between("wristFlex", -0.28, 0.52);
  spec["smileOpenness"] = relaxed ? between("smile opening", -0.88, 0.78) : 0;
  spec["smileBias"] = relaxed ? between("smile bias", -0.78, 0.78) : 0;
  spec["fingerCurl"] = relaxed ? 0.3 : between("fingerCurl", 0.02, 0.7);
  for (const key of ["upperArmLength", "forearmLength", "shinLength", "torsoLength", "neckLength"])
    spec[key] = g(key) * 0.5;
  if (relaxed && fitRestingLips) {
    const surface = evaluateHuman(body, spec);
    balanceCheekDraw(spec, surface);
    const profile = restLipProfile(surface);
    const forward = Math.max(0, Math.max(profile.upper, profile.lower) - 1.4);
    spec["mouthProjection"] = clamp(g("mouthProjection") - 0.1 * forward);
    spec["chin"] = clamp(g("chin") + 0.072 * forward);
    spec["lipBalance"] = clamp(
      g("lipBalance") + 0.18 * Math.max(0, profile.lower - profile.upper - 2.2),
    );
  }
  return spec;
}

function framedPortrait(frame: number, pick: number): (typeof portraitAxes)[number] {
  const weights = portraitAxes.map((axis) => Math.exp(-2.8 * (frame - portraitFrames[axis]) ** 2));
  let at = pick * weights.reduce((a, b) => a + b, 0);
  for (const [i, axis] of portraitAxes.entries()) {
    at -= weights[i] ?? 0;
    if (at <= 0) return axis;
  }
  return portraitAxes.at(-1) ?? portraitAxes[0];
}

function balanceCheekDraw(spec: Spec, surface: HumanSurface): void {
  const excess = Math.max(0, Math.min(1, (malarBend(surface) - 15) / 13));
  if (!excess) return;
  for (const [key, direction, share] of [
    ["cheeks", 1, 0.83],
    ["cheekHollow", 1, 0.5],
    ["faceFlesh", -1, 0.52],
    ["jowlFullness", -1, 0.52],
  ] as const) {
    const value = spec[key] ?? 0;
    if (direction * value > 0) spec[key] = value * (1 - share * excess);
  }
}

export const adultColourRanges = ["Mixed", "Natural", "Fantasy"] as const;
export type ColourRange = (typeof adultColourRanges)[number];

const fantasyTones = [
  ["#705069", "#b891b1", "green"],
  ["#415f55", "#a4bb9c", "amber"],
  ["#804e45", "#cb8e79", "hazel"],
  ["#414c6b", "#a0afc9", "grey"],
] as const;

function characterPalette(seed: number, range: ColourRange) {
  const draw = randomStream(seed ^ 0x76802da3);
  const rare = draw() < 0.085;
  if (range === "Natural" || (range === "Mixed" && !rare)) return null;
  const tone = fantasyTones[Math.floor(draw() * fantasyTones.length)] ?? fantasyTones[0];
  const [dark, light, eyeColor] = tone;
  const t = 0.12 + 0.78 * draw();
  const rgb = [1, 3, 5].map((i) => {
    const a = parseInt(dark.slice(i, i + 2), 16),
      b = parseInt(light.slice(i, i + 2), 16);
    return Math.round(a + (b - a) * t)
      .toString(16)
      .padStart(2, "0");
  });
  return { skin: "#" + rgb.join(""), eyeColor, earTip: 0.48 + 0.46 * draw() };
}

export const armInkStyles = [
  "Diving swift",
  "Fern frond",
  "Botanical sleeve",
  "Engraved sleeve",
  "Cartographic sleeve",
] as const;
export const browStyleDraws = [
  "Soft taper",
  "Lifted arch",
  "Straight",
  "Feathered",
  "Feathered",
  "Fine arch",
  "Full and brushed",
  "Untrimmed",
] as const;

export interface DrawnStyle {
  armInk?: string;
  browStyle?: string;
  cast?: string;
  castShape?: number;
  castPigment?: number;
  castSkin?: string;
}

export interface HumanDraw {
  readonly seed: number;
  readonly human: HumanMeasurements;
  readonly posture: Posture;
  readonly skin: string;
  readonly style: DrawnStyle;
  readonly eyeColor?: string;
  readonly complexion?: string;
  readonly faceMarks?: ReadonlyArray<FaceMark>;
}

export function drawAdult(
  body: HumanBody,
  seed: number,
  archetype: Archetype = "any",
  colourRange: ColourRange = "Mixed",
): HumanDraw {
  const gesture = randomStream(seed ^ 0xaef228d3);
  const side = gesture() < 0.5 ? -1 : 1;
  const params = randomHuman(body, seed, archetype, { fitRestingLips: true });
  if (gesture() < 0.2) params[side > 0 ? "leftArmLift" : "rightArmLift"] = 0.2 + 0.48 * gesture();
  const draw = randomStream(seed ^ 0x2631894b);
  const tones = [
    [72, 48, 41],
    [108, 73, 56],
    [146, 101, 76],
    [177, 132, 105],
    [206, 166, 139],
    [231, 198, 177],
  ] as const;
  const { faceA = 0, faceB = 0 } = params;
  const at =
    skinLightness([Math.exp(2.6 * faceA), Math.exp(2.6 * faceB), 1], draw()) *
    (tones.length - 1) *
    0.9999;
  const i = Math.floor(at);
  const t = at - i;
  const warmth = (draw() * 2 - 1) * 5;
  const undertone = [warmth, 0, -warmth];
  const low = tones[i] ?? tones[0],
    high = tones[i + 1] ?? low;
  const rgb = low.map((v, channel) =>
    Math.round(v + ((high[channel] ?? v) - v) * t + (undertone[channel] ?? 0)),
  );
  const palette = characterPalette(seed, colourRange);
  if (palette) params["earTip"] = palette.earTip;
  const skin = palette?.skin ?? "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
  const age = params["age"] ?? 0;
  const faceMarks = drawIdentityMarks(seed, { skin, age });
  const personal = randomStream(seed ^ 0xb53042af);
  const style: DrawnStyle = {};
  if (personal() < 0.14)
    style.armInk = item(armInkStyles, Math.floor(personal() * armInkStyles.length));
  const browDraw = randomStream(seed ^ 0x3ab057ce);
  style.browStyle = item(browStyleDraws, Math.floor(browDraw() * browStyleDraws.length));
  const posture = drawPosture(seed, params);
  const eyeColor = palette?.eyeColor;

  const cast = drawCastIdentity(params, (seed ^ 0x1e18ae83) >>> 0);
  if (cast) {
    style.cast = cast;
    if (castDonor(cast)) {
      const vary = randomStream(seed ^ 0xb661e8af);
      style.castShape = Math.round(vary() * 100) / 100;
      style.castPigment = Math.round((0.65 * style.castShape + 0.35 * vary()) * 100) / 100;
    }
  }
  const artist = randomStream(seed ^ 0x620ddbf1);
  const finishes =
    age < 0.42
      ? ["Portrait Rose", "Portrait Honey", "Portrait Fair", "Portrait Umber"]
      : ["Portrait Ruddy", "Portrait Sunworn"];
  let complexion: string | undefined =
    age < 0.68 && artist() < 0.29
      ? item(finishes, Math.floor(artist() * finishes.length))
      : undefined;
  const capture = drawCapturedPortrait(params, randomStream(seed ^ 0x61e3be17));
  if (capture) {
    for (const axis of [...portraitAxes, ...castShapeAxes]) params[axis] = 0;
    for (const axis of identityAxes) params[axis] = (params[axis] ?? 0) * 0.55;
    params[capture.axis] = capture.amount;
    complexion = capture.complexion;
    style.browStyle = "As drawn";
  }
  if (cast) {
    const castSkin = eyeColor ? skin : drawCastSkin(cast, skin, seed);
    if (!castSkin) throw new Error(`Cast ${cast} has no photographed skin.`);
    style.castSkin = castSkin;
  }
  return {
    seed,
    human: params,
    posture,
    skin,
    style,
    ...(eyeColor ? { eyeColor } : {}),
    ...(complexion ? { complexion } : {}),
    ...(faceMarks.length ? { faceMarks } : {}),
  };
}

const label: Readonly<Record<string, string>> = {
  pelvis: "pelvis",
  spine_01: "abdomen",
  spine_02: "rib cage",
  spine_03: "chest",
  neck_01: "neck",
  upperarm: "upper arm",
  lowerarm: "forearm",
  calf: "shin",
  ball: "toes",
  clavicle: "collarbone",
};
export function regionName(bone: string): string {
  const side = /_([lr])$/.exec(bone);
  if (!side) return label[bone] ?? bone;
  const base = bone.slice(0, -2);
  return (side[1] === "l" ? "left " : "right ") + (label[base] ?? base.replace("_0", " "));
}

export interface Region {
  readonly bone: BoneName;
  readonly parent: BoneName | null;
  readonly position: readonly [number, number, number];
  readonly bounds: readonly [readonly [number, number, number], readonly [number, number, number]];
}

export function surfaceRegions(surface: HumanSurface): Region[] {
  const low = boneNames.map(() => [Infinity, Infinity, Infinity]);
  const high = boneNames.map(() => [-Infinity, -Infinity, -Infinity]);
  for (let v = 0; v < surface.bodyVertices; v++) {
    const k = surface.boneIndices[v * 4] ?? 0,
      lo = low[k],
      hi = high[k];
    if (!lo || !hi) continue;
    for (let d = 0; d < 3; d++) {
      const x = (surface.positions[v * 3 + d] ?? 0) - (surface.joints[k * 3 + d] ?? 0);
      lo[d] = Math.min(lo[d] ?? 0, x);
      hi[d] = Math.max(hi[d] ?? 0, x);
    }
  }
  const names: ReadonlyArray<string> = boneNames;
  const triple = (v: ReadonlyArray<number> | undefined) =>
    [v?.[0] ?? 0, v?.[1] ?? 0, v?.[2] ?? 0] as const;
  return boneNames.map((bone, i) => {
    const parentName = boneParents[i];
    const pi = parentName === undefined ? -1 : names.indexOf(parentName);
    const delta = (d: number) =>
      (surface.joints[i * 3 + d] ?? 0) - (pi < 0 ? 0 : (surface.joints[pi * 3 + d] ?? 0));
    const lo = low[i],
      hi = high[i];
    return {
      bone,
      parent: pi < 0 ? null : (boneNames[pi] ?? null),
      position: [delta(0), delta(1), delta(2)],
      bounds:
        lo && Number.isFinite(lo[0])
          ? [triple(lo), triple(hi)]
          : [
              [-0.002, -0.002, -0.002],
              [0.002, 0.002, 0.002],
            ],
    };
  });
}
