// Marks on an adult face (character-view/human-face-marks.js): what each kind
// offers and the seeded draw of the marks that belong to the person.

import { randomStream } from "./identity.js";

export const faceMarkKindTable = {
  Freckles: {
    places: ["Nose and cheeks", "Cheeks", "Nose", "Whole face", "Forehead"],
    worn: false,
    side: "Both",
    strength: 0.5,
    size: 0.5,
  },
  "Sun spots": {
    places: ["Cheekbones", "Temples", "Forehead", "Whole face"],
    worn: false,
    side: "Both",
    strength: 0.5,
    size: 0.5,
  },
  "Beauty mark": {
    places: ["Cheek", "Above lip", "Under eye", "Chin", "Temple", "Jaw"],
    worn: false,
    side: "Left",
    strength: 0.6,
    size: 0.4,
  },
  Scar: {
    places: ["Brow", "Cheek", "Above lip", "Chin", "Forehead", "Nose bridge", "Across the eye"],
    worn: false,
    side: "Left",
    strength: 0.55,
    size: 0.5,
  },
  Eyeliner: {
    places: ["Lash line", "Winged", "Smoked"],
    worn: true,
    side: "Both",
    strength: 0.45,
    size: 0.35,
  },
  "Paint band": {
    places: ["Eyes", "Nose bridge", "Cheek", "Forehead", "Chin"],
    worn: true,
    side: "Both",
    strength: 0.8,
    size: 0.45,
  },
  "Paint streaks": {
    places: ["Cheek", "Under eye", "Forehead", "Chin"],
    worn: true,
    side: "Both",
    strength: 0.8,
    size: 0.45,
  },
  "Paint dots": {
    places: ["Under eye", "Brow", "Nose bridge", "Forehead", "Chin"],
    worn: true,
    side: "Both",
    strength: 0.85,
    size: 0.45,
  },
} as const;
export type FaceMarkKind = keyof typeof faceMarkKindTable;
export const faceMarkKinds: ReadonlyArray<FaceMarkKind> = [
  "Freckles",
  "Sun spots",
  "Beauty mark",
  "Scar",
  "Eyeliner",
  "Paint band",
  "Paint streaks",
  "Paint dots",
];
export const faceMarkSides = ["Both", "Left", "Right"] as const;
export type FaceMarkSide = (typeof faceMarkSides)[number];
export const faceMarkLimit = 8;

export interface FaceMark {
  readonly kind: FaceMarkKind;
  readonly place: string;
  readonly side: FaceMarkSide;
  readonly strength: number;
  readonly size: number;
  readonly seed: number;
  readonly tone?: string;
  readonly across?: number;
  readonly up?: number;
  readonly turn?: number;
}

function faceMark(
  kind: FaceMarkKind,
  seed: number,
  set: Partial<Omit<FaceMark, "kind" | "seed">>,
): FaceMark {
  const k = faceMarkKindTable[kind];
  const mark: FaceMark = {
    kind,
    place: k.places[0],
    side: k.side,
    strength: k.strength,
    size: k.size,
    seed: seed >>> 0,
    ...set,
  };
  const places: ReadonlyArray<string> = k.places;
  if (!places.includes(mark.place)) throw new Error("Invalid " + kind.toLowerCase() + " settings.");
  return mark;
}

// sRGB bytes to linear light, held as Float32 as the reference table holds them.
const decode = Float32Array.from({ length: 256 }, (_, i) => {
  const v = i / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
});
const linear = (text: string) =>
  [1, 3, 5].map((at) => decode[parseInt(text.slice(at, at + 2), 16)] ?? 0);
const luminance = (c: ReadonlyArray<number>) =>
  0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
const smooth = (v: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Marks that belong to the person, drawn from a seed. Most faces have none or one. */
export function drawIdentityMarks(
  seed: number,
  { skin = "#b08566", age = 0 }: { skin?: string; age?: number } = {},
): FaceMark[] {
  const next = randomStream((seed ^ 0x7a3c91e5) >>> 0);
  const pick = <T>(list: ReadonlyArray<T>): T => {
    const v = list[Math.floor(next() * list.length)];
    if (v === undefined) throw new Error("Empty list.");
    return v;
  };
  const own = () => Math.floor(next() * 4294967296),
    between = (lo: number, hi: number) => Math.round((lo + (hi - lo) * next()) * 100) / 100,
    fair = smooth(luminance(linear(skin)), 0.03, 0.4),
    marks: FaceMark[] = [];
  const rolls = [next(), next(), next(), next()];
  const freckles = faceMark("Freckles", own(), {
    place: pick(["Nose and cheeks", "Nose and cheeks", "Cheeks", "Whole face", "Nose"]),
    strength: between(0.25, 0.8),
    size: between(0.3, 0.8),
  });
  const spots = faceMark("Sun spots", own(), {
    place: pick(["Cheekbones", "Cheekbones", "Temples", "Whole face", "Forehead"]),
    strength: between(0.3, 0.75),
    size: between(0.3, 0.7),
  });
  const mole = faceMark("Beauty mark", own(), {
    place: pick(["Cheek", "Above lip", "Under eye", "Chin", "Temple", "Jaw"]),
    side: pick(["Left", "Right"] as const),
    strength: between(0.45, 0.85),
    size: between(0.2, 0.6),
  });
  const scar = faceMark("Scar", own(), {
    place: pick(["Brow", "Brow", "Cheek", "Chin", "Above lip", "Forehead", "Across the eye"]),
    side: pick(["Left", "Right"] as const),
    strength: between(0.4, 0.75),
    size: between(0.3, 0.7),
  });
  if ((rolls[0] ?? 1) < 0.1 + 0.22 * fair) marks.push(freckles);
  if ((rolls[1] ?? 1) < 0.04 + 0.32 * smooth(age, 0.35, 0.8)) marks.push(spots);
  if ((rolls[2] ?? 1) < 0.16) marks.push(mole);
  if ((rolls[3] ?? 1) < 0.07) marks.push(scar);
  return marks;
}
