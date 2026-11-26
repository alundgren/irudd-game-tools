// The adult's paint sources: the images and tables the textured presets paint
// the face and body skin from (character-view/human-complexion.js and its data
// at 2761eb1). Encoded images keep G0's exact bytes, so a browser decodes the
// same pixels G0 read; tables are typed. Only what an adult the generator can
// describe paints with is packed: its complexions are the Portrait and
// Captured skins, or by age Fine, Weathered or Soft lines.

import { castPaintEntries } from "./cast-data.js";
import { capturedAxes, type CapturedAxis } from "./catalogue.js";
import { groomNames } from "./groom.js";
import { readPack, type EntrySpec, type PackSpec } from "./pack.js";

/** The donor faces "Portrait NAME" complexions paint from (Microsoft Rocketbox, MIT). */
export const castSkinNames = ["Rose", "Honey", "Ruddy", "Umber", "Sunworn", "Fair"] as const;
export type CastSkinName = (typeof castSkinNames)[number];
export const paintBrowNames = [
  "eyebrow001",
  "eyebrow003",
  "eyebrow005",
  "eyebrow006",
  "eyebrow009",
  "eyebrow011",
  "eyebrow012",
] as const;
export type PaintBrowName = (typeof paintBrowNames)[number];

/** Images stored as PNG; every other image is WebP. */
const pngImages = new Set<string>([
  "field.visibility",
  ...paintBrowNames.map((name) => `brow.${name}`),
]);

/** Every image entry, in pack order. */
export const paintImageNames: ReadonlyArray<string> = [
  ...[0, 1, 2, 3].map((k) => `detail.${k}`),
  "field.tone",
  "field.zones",
  "field.eyes",
  "field.visibility",
  "dermal.0",
  "dermal.1",
  ...paintBrowNames.map((name) => `brow.${name}`),
  "body.normal",
  "body.roughness",
  ...Array.from({ length: 20 }, (_, k) => `finish.donor.${k}`),
  "finish.micro",
  "finish.meso",
  "finish.gloss",
  "finish.lips",
  ...castSkinNames.flatMap((name) => [`cast.${name}.paint`, `cast.${name}.surface`]),
  ...capturedAxes.flatMap((axis) => [`captured.${axis}.paint`, `captured.${axis}.surface`]),
  // Each authored groom's strand picture and its normal map.
  ...groomNames.flatMap((name) => [`groom.${name}.texture`, `groom.${name}.normal`]),
];

export function paintMediaType(name: string): "image/png" | "image/webp" {
  return pngImages.has(name) ? "image/png" : "image/webp";
}

function paintSpec(): PackSpec {
  const spec: Record<string, EntrySpec> = {};
  for (const name of paintImageNames) spec[name] = { kind: "u8" };
  for (const name of paintBrowNames) spec[`brow.${name}.at`] = { kind: "u16", elements: 2 };
  // Age band, deep skin and broad frame of each donor.
  spec["finish.donors"] = { kind: "u8", elements: 60 };
  // Darker, lighter, micro, meso and gloss scales of the finish bytes.
  spec["finish.encoding"] = { kind: "f64", elements: 5 };
  // Left, top, right and bottom of the mouth lining's island in the 2048 px skin layout.
  spec["layout.mouthIsland"] = { kind: "u16", elements: 4 };
  // Per smooth-surface vertex: darker and redder than the skin around it.
  spec["tone"] = { kind: "u8", elements: 53514 * 2 };
  // Tone and warm range of those bytes.
  spec["tone.range"] = { kind: "f64", elements: 2 };
  for (let k = 0; k < 3; k++) spec[`skinPigment.${k}`] = { kind: "u8", elements: 74 * 74 * 3 };
  // The iris stroma: three 192 × 72 fibre maps, angle by radius.
  for (let k = 0; k < 3; k++) spec[`iris.${k}`] = { kind: "u8", elements: 192 * 72 };
  // Each captured scan's iris photograph, 96 × 96.
  for (const axis of capturedAxes)
    spec[`captured.${axis}.iris`] = { kind: "u8", elements: 96 * 96 };
  // Whether a captured skin's photograph carries its own brows.
  spec["captured.brows"] = { kind: "u8", elements: capturedAxes.length };
  // The clothed cast's pictures, garment art and surface maps, as raw bytes.
  for (const [name, entry] of castPaintEntries()) spec[name] = entry;
  // The clipped buzz cut painted on the scalp: its smooth-surface vertices, their texture coordinates in
  // whole numbers of 1/65535, its triangles, the hair density at each vertex, and the 512 × 768 picture
  // of density and grain.
  spec["buzz.vertices"] = { kind: "u32", elements: buzzVertices };
  spec["buzz.uv"] = { kind: "u16", elements: buzzVertices * 2 };
  spec["buzz.indices"] = { kind: "u16", elements: buzzTriangles * 3 };
  spec["buzz.density"] = { kind: "u8", elements: buzzVertices };
  spec["buzz.pixels"] = { kind: "u8", elements: buzzSize[0] * buzzSize[1] * 2 };
  // The combed tone of the painted scalp under drawn-back hair, one byte a pixel.
  spec["swept.tone"] = { kind: "u8", elements: sweptScalpSize * sweptScalpSize };
  return spec;
}
/** The vertices and triangles of the painted buzz cut, and its picture's width and height. */
const buzzVertices = 2017,
  buzzTriangles = 3715;
export const buzzSize: readonly [number, number] = [512, 768];
/** The width and height of the painted scalp under drawn-back hair. */
export const sweptScalpSize = 512;
export const humanPaintSpec = paintSpec();

/** The clipped buzz cut's scalp, as G0 paints it (human-buzz-data.json at 2761eb1). */
export interface BuzzScalp {
  readonly vertices: Uint32Array;
  readonly uv: Uint16Array;
  readonly indices: Uint16Array;
  readonly density: Uint8Array;
  /** Density and grain of each pixel, rows from the top. */
  readonly pixels: Uint8Array;
}

export interface PaintImage {
  readonly bytes: Uint8Array;
  readonly mediaType: "image/png" | "image/webp";
}
export interface FinishDonor {
  readonly age: number;
  readonly deep: boolean;
  readonly male: boolean;
}

export interface HumanPaint {
  image(name: string): PaintImage;
  readonly brows: Readonly<Record<PaintBrowName, { readonly x: number; readonly y: number }>>;
  readonly donors: ReadonlyArray<FinishDonor>;
  readonly finish: {
    readonly darker: number;
    readonly lighter: number;
    readonly micro: number;
    readonly meso: number;
    readonly gloss: number;
  };
  readonly mouthIsland: readonly [number, number, number, number];
  readonly tone: Uint8Array;
  readonly toneRange: number;
  readonly warmRange: number;
  readonly skinPigment: ReadonlyArray<Uint8Array>;
  capturedBrows(axis: CapturedAxis): boolean;
  /** The iris stroma maps, 192 × 72 each. */
  readonly stroma: ReadonlyArray<Uint8Array>;
  /** A captured scan's iris photograph, 96 × 96. */
  capturedIris(axis: CapturedAxis): Uint8Array;
  /** A clothed cast picture's raw bytes (castPaintEntries). */
  castPicture(name: string): Uint8Array;
  readonly buzz: BuzzScalp;
  /** The combed tone of the painted scalp under drawn-back hair (human-swept-scalp-data.json at 2761eb1). */
  readonly sweptTone: Uint8Array;
}

/** Decode the paint pack. */
export async function readHumanPaint(bytes: Uint8Array): Promise<HumanPaint> {
  const pack = await readPack(bytes, humanPaintSpec, "human-paint.bin");
  const images = new Map<string, PaintImage>(
    paintImageNames.map((name) => [
      name,
      { bytes: pack.u8(name), mediaType: paintMediaType(name) },
    ]),
  );
  const at = (name: PaintBrowName) => {
    const xy = pack.u16(`brow.${name}.at`);
    return { x: xy[0] ?? 0, y: xy[1] ?? 0 };
  };
  const donorBytes = pack.u8("finish.donors"),
    finish = pack.f64("finish.encoding"),
    island = pack.u16("layout.mouthIsland"),
    ranges = pack.f64("tone.range"),
    brows = pack.u8("captured.brows");
  return {
    image(name) {
      const found = images.get(name);
      if (!found) throw new Error(`The paint pack has no image ${name}.`);
      return found;
    },
    brows: {
      eyebrow001: at("eyebrow001"),
      eyebrow003: at("eyebrow003"),
      eyebrow005: at("eyebrow005"),
      eyebrow006: at("eyebrow006"),
      eyebrow009: at("eyebrow009"),
      eyebrow011: at("eyebrow011"),
      eyebrow012: at("eyebrow012"),
    },
    donors: Array.from({ length: 20 }, (_, k) => ({
      age: donorBytes[k * 3] ?? 0,
      deep: donorBytes[k * 3 + 1] === 1,
      male: donorBytes[k * 3 + 2] === 1,
    })),
    finish: {
      darker: finish[0] ?? 0,
      lighter: finish[1] ?? 0,
      micro: finish[2] ?? 0,
      meso: finish[3] ?? 0,
      gloss: finish[4] ?? 0,
    },
    mouthIsland: [island[0] ?? 0, island[1] ?? 0, island[2] ?? 0, island[3] ?? 0],
    tone: pack.u8("tone"),
    toneRange: ranges[0] ?? 0,
    warmRange: ranges[1] ?? 0,
    skinPigment: [0, 1, 2].map((k) => pack.u8(`skinPigment.${k}`)),
    capturedBrows: (axis) => brows[capturedAxes.indexOf(axis)] === 1,
    stroma: [0, 1, 2].map((k) => pack.u8(`iris.${k}`)),
    capturedIris: (axis) => pack.u8(`captured.${axis}.iris`),
    buzz: {
      vertices: pack.u32("buzz.vertices"),
      uv: pack.u16("buzz.uv"),
      indices: pack.u16("buzz.indices"),
      density: pack.u8("buzz.density"),
      pixels: pack.u8("buzz.pixels"),
    },
    sweptTone: pack.u8("swept.tone"),
    castPicture: (name) => {
      if (!name.startsWith("cast") || !Object.hasOwn(humanPaintSpec, name))
        throw new Error(`The paint pack has no cast picture ${name}.`);
      return pack.u8(name);
    },
  };
}
