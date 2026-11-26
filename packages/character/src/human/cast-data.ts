import { readPack, type EntrySpec, type Pack, type PackKind, type PackSpec } from "./pack.js";

export const castPoseNames = [
  "Blink",
  "Smile",
  "BrowLift",
  "LookLeft",
  "LookRight",
  "LookUp",
  "LookDown",
] as const;
export type CastPoseName = (typeof castPoseNames)[number];
export const castCardExpressions = ["Blink", "Smile", "BrowLift"] as const;

export const castBones = [
  "ball_l",
  "ball_r",
  "calf_l",
  "calf_r",
  "clavicle_l",
  "clavicle_r",
  "foot_l",
  "foot_r",
  "hand_l",
  "hand_r",
  "head",
  "index_01_l",
  "index_01_r",
  "index_02_l",
  "index_02_r",
  "index_03_l",
  "index_03_r",
  "lowerarm_l",
  "lowerarm_r",
  "middle_01_l",
  "middle_01_r",
  "middle_02_l",
  "middle_02_r",
  "middle_03_l",
  "middle_03_r",
  "neck_01",
  "pelvis",
  "pinky_01_l",
  "pinky_01_r",
  "pinky_02_l",
  "pinky_02_r",
  "pinky_03_l",
  "pinky_03_r",
  "ring_01_l",
  "ring_01_r",
  "ring_02_l",
  "ring_02_r",
  "ring_03_l",
  "ring_03_r",
  "spine_01",
  "spine_02",
  "spine_03",
  "thigh_l",
  "thigh_r",
  "thumb_01_l",
  "thumb_01_r",
  "thumb_02_l",
  "thumb_02_r",
  "thumb_03_l",
  "thumb_03_r",
  "upperarm_l",
  "upperarm_r",
] as const;

export interface CastFigureEntry {
  readonly faceTriangles: number;
  readonly reach: number;
  readonly tone: readonly [number, number, number];
  readonly cards: number | null;
  readonly donor: string | null;
  readonly skirt: boolean;
}

const figure = (
  faceTriangles: number,
  tone: readonly [number, number, number],
  cards: number | null,
  donor: string | null = null,
  skirt = false,
): CastFigureEntry => ({ faceTriangles, reach: 8, tone, cards, donor, skirt });

export const castFigures = {
  Gardener: figure(3008, [0.55834, 0.283149, 0.181164], 432, "Adults/Male_Adult_01"),
  "Cropped jacket": figure(3218, [0.617207, 0.304987, 0.187821], 987, "Adults/Female_Adult_08"),
  "Striped polo": figure(2936, [0.533276, 0.283149, 0.181164], 530),
  "Pink shirt": figure(3202, [0.603827, 0.313989, 0.191202], 680),
  "Grey tee": figure(2747, [0.564712, 0.291771, 0.171441], 732),
  "Denim jacket": figure(3088, [0.539479, 0.258183, 0.141263], 726),
  "Blue shirt": figure(2982, [0.533276, 0.258183, 0.147027], 354),
  "Long tunic": figure(3102, [0.381326, 0.171441, 0.07036], null, "Adults/Male_Adult_01", true),
} as const satisfies Readonly<Record<string, CastFigureEntry>>;
export type CastFigureName = keyof typeof castFigures;
export const castFigureNames: ReadonlyArray<CastFigureName> = [
  "Gardener",
  "Cropped jacket",
  "Striped polo",
  "Pink shirt",
  "Grey tee",
  "Denim jacket",
  "Blue shirt",
  "Long tunic",
];
export const isCastFigureName = (name: string): name is CastFigureName =>
  Object.hasOwn(castFigures, name);
export const castSlug = (name: string): string => name.replaceAll(" ", "_");
export const castFromSlug = (slug: string): CastFigureName | undefined =>
  castFigureNames.find((name) => castSlug(name) === slug);
export const castPictureSide = 1024,
  castCardSide = 512;

export interface CastPiece {
  readonly subject: string;
  readonly figure: CastFigureName | null;
  readonly top: string;
  readonly bottom: string;
}
export const castPieces = {
  m106: {
    subject: "Professions/Gardener_Male_01",
    figure: "Gardener",
    top: "Work shirt",
    bottom: "Work trousers and boots",
  },
  m002: {
    subject: "Adults/Male_Adult_01",
    figure: "Striped polo",
    top: "Striped polo",
    bottom: "Shorts and shoes",
  },
  m007: {
    subject: "Adults/Male_Adult_12",
    figure: null,
    top: "Denim jacket",
    bottom: "Jeans and shoes",
  },
  f004: {
    subject: "Adults/Female_Adult_04",
    figure: "Cropped jacket",
    top: "Hooded jacket",
    bottom: "Trousers and boots",
  },
  f001: {
    subject: "Adults/Female_Adult_01",
    figure: "Pink shirt",
    top: "Pink shirt",
    bottom: "Fitted jeans and shoes",
  },
} as const satisfies Readonly<Record<string, CastPiece>>;
export type CastPieceCode = keyof typeof castPieces;
export const castPieceCodes: ReadonlyArray<CastPieceCode> = [
  "m106",
  "m002",
  "m007",
  "f004",
  "f001",
];

export interface CastVariant {
  readonly top: CastPieceCode;
  readonly bottom: CastPieceCode;
  readonly faceTriangles: number;
  readonly reach: number;
  readonly cards: number;
}
const variant = (
  top: CastPieceCode,
  bottom: CastPieceCode,
  faceTriangles: number,
  cards: number,
): CastVariant => ({ top, bottom, faceTriangles, reach: 8, cards });

export const castReceivers: Readonly<
  Partial<
    Record<
      CastFigureName,
      { readonly own: CastPieceCode; readonly variants: ReadonlyArray<CastVariant> }
    >
  >
> = {
  Gardener: {
    own: "m106",
    variants: [
      variant("m106", "m002", 3008, 432),
      variant("m106", "m007", 3008, 432),
      variant("m002", "m106", 3010, 432),
      variant("m002", "m002", 3010, 432),
      variant("m002", "m007", 3010, 432),
      variant("m007", "m106", 3012, 432),
      variant("m007", "m002", 3012, 432),
      variant("m007", "m007", 3012, 432),
    ],
  },
  "Cropped jacket": { own: "f004", variants: [variant("f001", "f001", 3228, 987)] },
  "Pink shirt": { own: "f001", variants: [variant("f004", "f004", 3184, 680)] },
};
export const castVariantKey = (v: { readonly top: string; readonly bottom: string }): string =>
  `${v.top}/${v.bottom}`;

export const castBodySkin: Readonly<Record<string, readonly [number, number, number] | null>> = {
  Gardener: null,
  "Cropped jacket": [0.63569, 0.34053, 0.23604],
  "Striped polo": [0.45117, 0.2092, 0.14158],
  "Pink shirt": [0.61666, 0.33386, 0.22102],
  "Grey tee": [0.6234, 0.33254, 0.21171],
  "Denim jacket": [0.62869, 0.33622, 0.21589],
  "Blue shirt": [0.49629, 0.23488, 0.15154],
  "Long tunic": [0.31449, 0.1307, 0.06503],
  m007: [0.31896, 0.14226, 0.08533],
};

export const castSurfaceSide = 384;
export const castSurfaceSubjects: Readonly<Record<string, ReadonlyArray<"body" | "head">>> = {
  "Adults/Female_Adult_01": ["body", "head"],
  "Adults/Female_Adult_04": ["body", "head"],
  "Adults/Female_Adult_08": ["body", "head"],
  "Adults/Female_Adult_13": ["body", "head"],
  "Adults/Male_Adult_01": ["body", "head"],
  "Adults/Male_Adult_08": ["body", "head"],
  "Adults/Male_Adult_12": ["body"],
  "Adults/Male_Adult_15": ["body", "head"],
  "Professions/Gardener_Male_01": ["body", "head"],
};

type Kinds = Readonly<Record<string, PackKind>>;
const cardKinds: Kinds = {
  "cards.points": "f32",
  "cards.uv": "f32",
  "cards.index": "u16",
  "cards.ties": "u16",
  "cards.shares": "f32",
  ...Object.fromEntries(castCardExpressions.map((name) => [`cards.expr.${name}`, "f32"])),
};
const poseKinds = (prefix: string): Kinds =>
  Object.fromEntries(castPoseNames.map((name) => [`${prefix}${name}`, "f32"]));

function castSpec(): PackSpec {
  const spec: Record<string, EntrySpec> = {};
  const add = (prefix: string, kinds: Kinds) => {
    for (const [key, kind] of Object.entries(kinds)) spec[`${prefix}/${key}`] = { kind };
  };
  for (const name of castFigureNames) {
    const entry: CastFigureEntry = castFigures[name],
      at = `figure/${castSlug(name)}`;
    add(at, {
      positions: "f32",
      source: "u16",
      uv: "f32",
      index: "u16",
      smooth: "u16",
      weights: "f32",
      joints: "u8",
      "field.starts": "u16",
      "field.vertices": "u16",
      "field.weights": "f32",
      "field.rest": "f32",
      "field.near": "u16",
      "field.pull": "f32",
      ...poseKinds("pose."),
    });
    if (entry.cards !== null) add(at, cardKinds);
    if (entry.donor !== null) add(at, { "blend.shape": "f32", ...poseKinds("blend.pose.") });
    if (entry.skirt) add(at, { skirt: "u16" });
  }
  for (const name of castFigureNames)
    for (const v of castReceivers[name]?.variants ?? []) {
      const at = `variant/${castSlug(name)}/${castVariantKey(v)}`;
      add(at, {
        positions: "f32",
        source: "u16",
        uv: "u16",
        index: "u16",
        smooth: "u16",
        weights: "u8",
        joints: "u8",
        "field.starts": "u16",
        "field.vertices": "u16",
        "field.weights": "u16",
        "field.rest": "f32",
        "field.near": "u16",
        "field.pull": "u8",
        like: "u16",
        ...poseKinds("pose."),
        ...cardKinds,
      });
    }
  return spec;
}
export const humanCastSpec = castSpec();

export function castPaintEntries(): ReadonlyArray<readonly [string, EntrySpec]> {
  const out: Array<readonly [string, EntrySpec]> = [];
  for (const name of castFigureNames) {
    const entry: CastFigureEntry = castFigures[name];
    out.push([
      `castFigure.${castSlug(name)}.pixels`,
      { kind: "u8", elements: castPictureSide ** 2 * 3 },
    ]);
    out.push([`castFigure.${castSlug(name)}.mask`, { kind: "u8", elements: castPictureSide ** 2 }]);
    if (entry.cards !== null)
      out.push([
        `castFigure.${castSlug(name)}.cards`,
        { kind: "u8", elements: castCardSide ** 2 * 4 },
      ]);
    if (entry.donor !== null)
      out.push([
        `castFigure.${castSlug(name)}.pixelDelta`,
        { kind: "u8", elements: (castPictureSide / 2) ** 2 * 3 },
      ]);
  }
  out.push([
    `castArt.m007.pixels`,
    { kind: "u8", elements: (castPictureSide / 2) * castPictureSide * 3 },
  ]);
  out.push([
    `castArt.m007.mask`,
    { kind: "u8", elements: (castPictureSide / 2) * castPictureSide },
  ]);
  for (const [subject, regions] of Object.entries(castSurfaceSubjects))
    for (const region of regions)
      out.push([
        `castSurface.${subject}.${region}`,
        {
          kind: "u8",
          elements:
            (region === "body" ? castSurfaceSide : castSurfaceSide / 2) * (castSurfaceSide / 2) * 3,
        },
      ]);
  return out;
}

export interface CastFigureData {
  readonly name: CastFigureName;
  readonly positions: Float32Array;
  readonly surface: {
    readonly source: Uint16Array;
    readonly uv: Float32Array;
    readonly index: Uint16Array;
    readonly smooth: Uint16Array;
  };
  readonly weights: Float32Array;
  readonly joints: Uint8Array;
  readonly field: {
    readonly starts: Uint16Array;
    readonly vertices: Uint16Array;
    readonly weights: Float32Array;
    readonly rest: Float32Array;
    readonly near: Uint16Array;
    readonly pull: Float32Array;
    readonly reach: number;
  };
  readonly faceTriangles: number;
  readonly poses: ReadonlyMap<CastPoseName, Float32Array>;
  readonly cards: {
    readonly points: Float32Array;
    readonly uv: Float32Array;
    readonly index: Uint16Array;
    readonly ties: Uint16Array;
    readonly shares: Float32Array;
    readonly expressions: ReadonlyMap<string, Float32Array>;
  } | null;
  readonly blend: {
    readonly donor: string;
    readonly shape: Float32Array;
    readonly poses: ReadonlyMap<CastPoseName, Float32Array>;
  } | null;
  readonly skirt: Uint16Array | null;
}

export interface CastVariantData {
  readonly positions: Float32Array;
  readonly source: Uint16Array;
  readonly uv: Uint16Array;
  readonly index: Uint16Array;
  readonly smooth: Uint16Array;
  readonly weights: Uint8Array;
  readonly joints: Uint8Array;
  readonly field: {
    readonly starts: Uint16Array;
    readonly vertices: Uint16Array;
    readonly weights: Uint16Array;
    readonly rest: Float32Array;
    readonly near: Uint16Array;
    readonly pull: Uint8Array;
    readonly reach: number;
  };
  readonly faceTriangles: number;
  readonly poses: ReadonlyMap<CastPoseName, Float32Array>;
  readonly like: Uint16Array;
  readonly cards: NonNullable<CastFigureData["cards"]>;
}

export interface HumanCast {
  figure(name: CastFigureName): CastFigureData;
  variant(name: CastFigureName, v: CastVariant): CastVariantData;
}

const cards = (pack: Pack, at: string): NonNullable<CastFigureData["cards"]> => ({
  points: pack.f32(`${at}/cards.points`),
  uv: pack.f32(`${at}/cards.uv`),
  index: pack.u16(`${at}/cards.index`),
  ties: pack.u16(`${at}/cards.ties`),
  shares: pack.f32(`${at}/cards.shares`),
  expressions: new Map(castCardExpressions.map((n) => [n, pack.f32(`${at}/cards.expr.${n}`)])),
});
const poses = (pack: Pack, prefix: string): ReadonlyMap<CastPoseName, Float32Array> =>
  new Map(castPoseNames.map((n) => [n, pack.f32(`${prefix}${n}`)]));

function figureOf(pack: Pack, name: CastFigureName): CastFigureData {
  const entry: CastFigureEntry = castFigures[name],
    at = `figure/${castSlug(name)}`;
  return {
    name,
    positions: pack.f32(`${at}/positions`),
    surface: {
      source: pack.u16(`${at}/source`),
      uv: pack.f32(`${at}/uv`),
      index: pack.u16(`${at}/index`),
      smooth: pack.u16(`${at}/smooth`),
    },
    weights: pack.f32(`${at}/weights`),
    joints: pack.u8(`${at}/joints`),
    field: {
      starts: pack.u16(`${at}/field.starts`),
      vertices: pack.u16(`${at}/field.vertices`),
      weights: pack.f32(`${at}/field.weights`),
      rest: pack.f32(`${at}/field.rest`),
      near: pack.u16(`${at}/field.near`),
      pull: pack.f32(`${at}/field.pull`),
      reach: entry.reach,
    },
    faceTriangles: entry.faceTriangles,
    poses: poses(pack, `${at}/pose.`),
    cards: entry.cards === null ? null : cards(pack, at),
    blend:
      entry.donor === null
        ? null
        : {
            donor: entry.donor,
            shape: pack.f32(`${at}/blend.shape`),
            poses: poses(pack, `${at}/blend.pose.`),
          },
    skirt: entry.skirt ? pack.u16(`${at}/skirt`) : null,
  };
}

function variantOf(pack: Pack, name: CastFigureName, v: CastVariant): CastVariantData {
  const at = `variant/${castSlug(name)}/${castVariantKey(v)}`;
  return {
    positions: pack.f32(`${at}/positions`),
    source: pack.u16(`${at}/source`),
    uv: pack.u16(`${at}/uv`),
    index: pack.u16(`${at}/index`),
    smooth: pack.u16(`${at}/smooth`),
    weights: pack.u8(`${at}/weights`),
    joints: pack.u8(`${at}/joints`),
    field: {
      starts: pack.u16(`${at}/field.starts`),
      vertices: pack.u16(`${at}/field.vertices`),
      weights: pack.u16(`${at}/field.weights`),
      rest: pack.f32(`${at}/field.rest`),
      near: pack.u16(`${at}/field.near`),
      pull: pack.u8(`${at}/field.pull`),
      reach: v.reach,
    },
    faceTriangles: v.faceTriangles,
    poses: poses(pack, `${at}/pose.`),
    like: pack.u16(`${at}/like`),
    cards: cards(pack, at),
  };
}

export async function readHumanCast(bytes: Uint8Array): Promise<HumanCast> {
  const pack = await readPack(bytes, humanCastSpec, "human-cast.bin");
  const figures = new Map<CastFigureName, CastFigureData>(),
    variants = new Map<string, CastVariantData>();
  return {
    figure(name) {
      let found = figures.get(name);
      if (!found) figures.set(name, (found = figureOf(pack, name)));
      return found;
    },
    variant(name, v) {
      const key = `${name}/${castVariantKey(v)}`;
      let found = variants.get(key);
      if (!found) variants.set(key, (found = variantOf(pack, name, v)));
      return found;
    },
  };
}
