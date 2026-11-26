// How an adult stands and walks (character-view/human-posture.js): the
// controls, the named ways of standing and the seeded draw. The solver that
// turns a posture into joint rotations is in the rig.

import { randomStream } from "./identity.js";

/** Every control: [minimum, maximum, value an unnamed control takes]. */
export const postureRanges = {
  weight: [-1, 1, 0],
  hip: [0, 1, 0.5],
  lean: [-1, 1, 0],
  slouch: [-1, 1, 0],
  twist: [-1, 1, 0],
  shoulders: [-1, 1, 0],
  shrug: [-1, 1, 0],
  arms: [0, 1, 0.95],
  elbows: [0, 1, 0.3],
  hands: [0, 1, 0.55],
  headTilt: [-1, 1, 0],
  headTurn: [-1, 1, 0],
  chin: [-1, 1, 0],
  feet: [-1, 1, 0],
  toes: [-1, 1, 0.2],
  step: [-1, 1, 0],
  stride: [-1, 1, 0],
  handAtWaist: [-1, 1, 0],
  swing: [-1, 1, 0],
} as const satisfies Record<string, readonly [number, number, number]>;
export type PostureAxis = keyof typeof postureRanges;
const isPostureAxis = (k: string): k is PostureAxis => Object.hasOwn(postureRanges, k);
export const postureAxes: ReadonlyArray<PostureAxis> =
  Object.keys(postureRanges).filter(isPostureAxis);

const sided: ReadonlyArray<PostureAxis> = [
  "weight",
  "twist",
  "shoulders",
  "headTilt",
  "headTurn",
  "handAtWaist",
];

export const postureStyles = {
  Easy: {
    weight: 0.5,
    hip: 0.45,
    slouch: 0.15,
    elbows: 0.35,
    toes: 0.25,
    step: 0.15,
    headTilt: 0.1,
  },
  "Hip-shot": {
    weight: 0.95,
    hip: 0.9,
    slouch: 0.05,
    twist: 0.2,
    shoulders: 0.25,
    hands: 0.6,
    feet: 0.1,
    toes: 0.55,
    step: 0.45,
    headTilt: 0.3,
    headTurn: -0.2,
  },
  Upright: {
    weight: 0.12,
    hip: 0.2,
    slouch: -0.6,
    shrug: -0.2,
    arms: 1,
    elbows: 0.15,
    hands: 0.35,
    feet: -0.35,
    toes: 0.1,
    chin: 0.2,
    stride: 0.25,
    swing: 0.2,
  },
  Slouched: {
    weight: 0.55,
    hip: 0.5,
    slouch: 0.75,
    lean: -0.2,
    shrug: -0.35,
    arms: 1,
    elbows: 0.2,
    hands: 0.75,
    feet: 0.05,
    toes: 0.3,
    chin: -0.15,
    headTilt: -0.15,
    stride: -0.4,
    swing: -0.45,
  },
  Planted: {
    weight: 0,
    hip: 0,
    slouch: -0.15,
    arms: 0.8,
    elbows: 0.45,
    hands: 0.45,
    feet: 0.7,
    toes: 0.45,
    stride: 0.1,
    swing: 0.1,
  },
  Guarded: {
    weight: 0.6,
    hip: 0.4,
    slouch: 0.25,
    twist: 0.55,
    shrug: 0.35,
    arms: 0.9,
    elbows: 0.6,
    hands: 0.8,
    feet: 0.1,
    toes: 0.2,
    step: -0.5,
    headTurn: -0.45,
    chin: -0.2,
    stride: -0.2,
    swing: -0.5,
  },
  Weary: {
    weight: 0.75,
    hip: 0.6,
    slouch: 0.45,
    lean: 0.3,
    shrug: -0.5,
    arms: 1,
    elbows: 0.1,
    hands: 0.7,
    feet: -0.1,
    toes: 0.25,
    step: 0.1,
    chin: -0.3,
    headTilt: 0.25,
    stride: -0.6,
    swing: -0.6,
  },
  Poised: {
    weight: 0.7,
    hip: 0.55,
    slouch: -0.35,
    twist: -0.2,
    elbows: 0.4,
    hands: 0.4,
    feet: -0.45,
    toes: 0.35,
    step: 0.6,
    headTilt: 0.2,
    headTurn: 0.25,
    chin: 0.1,
    stride: 0.15,
    swing: -0.1,
  },
  "Sway-back": {
    weight: 0.3,
    hip: 0.3,
    lean: -0.7,
    slouch: 0.3,
    hands: 0.6,
    feet: 0.25,
    toes: 0.5,
    chin: 0.1,
    stride: -0.2,
    swing: 0.2,
  },
  Brisk: {
    weight: 0.25,
    hip: 0.3,
    slouch: -0.25,
    lean: 0.25,
    elbows: 0.5,
    hands: 0.7,
    feet: -0.1,
    toes: 0.1,
    step: 0.3,
    chin: 0.05,
    stride: 0.7,
    swing: 0.7,
  },
} as const satisfies Record<string, Partial<Record<PostureAxis, number>>>;
export type PostureStyle = keyof typeof postureStyles;
const isPostureStyle = (k: string): k is PostureStyle => Object.hasOwn(postureStyles, k);
export const postureStyleNames: ReadonlyArray<PostureStyle> =
  Object.keys(postureStyles).filter(isPostureStyle);

export type Posture = { style?: PostureStyle } & Partial<Record<PostureAxis, number>>;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round = (v: number) => Math.round(v * 100) / 100;

function tidy(values: Posture): Posture {
  const out: Posture = {};
  if (values.style) out.style = values.style;
  for (const key of postureAxes) {
    const value = values[key];
    if (value === undefined) continue;
    const [lo, hi] = postureRanges[key];
    out[key] = round(clamp(value, lo, hi)) || 0;
  }
  return out;
}

export function mirrorPosture(p: Posture): Posture {
  const out = { ...p };
  for (const key of sided) {
    const value = out[key];
    if (value) out[key] = -value;
  }
  return out;
}

/** One adult's own way of standing and walking. Age and build weigh the choice, the seed decides. */
export function drawPosture(
  seed: number,
  human: { readonly age?: number; readonly weight?: number; readonly muscle?: number } = {},
): Posture {
  const draw = randomStream((seed ^ 0x9c2f41d7) >>> 0);
  const age = human.age ?? 0,
    mass = Math.max(0, human.weight ?? 0),
    muscle = Math.max(0, human.muscle ?? 0);
  const odds: ReadonlyArray<readonly [PostureStyle, number]> = [
    ["Easy", 3],
    ["Hip-shot", 1.6 - 0.6 * age],
    ["Upright", 1.3 + muscle],
    ["Slouched", 1 + 0.8 * age],
    ["Planted", 0.8 + 1.2 * mass + 0.7 * muscle],
    ["Guarded", 0.8],
    ["Weary", 0.4 + 1.8 * age],
    ["Poised", 1.3 - 0.7 * mass],
    ["Sway-back", 0.4 + 1.3 * mass + 0.5 * age],
    ["Brisk", 1.1 - 0.6 * age],
  ];
  let at = draw() * odds.reduce((n, [, v]) => n + Math.max(0.05, v), 0),
    style: PostureStyle = "Easy";
  for (const [name, weight] of odds) {
    at -= Math.max(0.05, weight);
    if (at <= 0) {
      style = name;
      break;
    }
  }
  const values: Posture = { style };
  const typeValues: Partial<Record<PostureAxis, number>> = postureStyles[style];
  for (const key of postureAxes) {
    if (key === "handAtWaist") continue;
    const [lo, hi, initial] = postureRanges[key];
    const base = typeValues[key] ?? initial;
    const spread = key === "arms" ? 0.05 : key === "headTurn" || key === "headTilt" ? 0.22 : 0.16;
    values[key] = clamp(base + (draw() * 2 - 1) * spread * (hi - lo) * 0.5, lo, hi);
  }
  values.arms = Math.max(0.78, values.arms ?? 0);
  const mirrored = draw() < 0.5;
  const gestureShare: Partial<Record<PostureStyle, number>> = {
    "Hip-shot": 0.68,
    Easy: 0.24,
    Brisk: 0.28,
    Poised: 0.28,
    Planted: 0.26,
  };
  if (draw() < (gestureShare[style] ?? 0)) values.handAtWaist = 1;
  return mirrored ? mirrorPosture(tidy(values)) : tidy(values);
}
