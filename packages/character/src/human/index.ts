// The editable adult human: typed data packs, the seeded draw, the surface
// evaluator and the generator. Hosts load the packs once (`humanPackFiles`,
// verified by SHA-256) and pass the decoded body to `humanAdultGenerator`.

import { digestBrand, sha256Digest, type Digest } from "@irudd/document";
import { readHumanBody, type HumanBody } from "./body.js";
import { readHumanPaint, type HumanPaint } from "./paint-data.js";

export { rocketboxLicense } from "./credits.js";

export interface HumanPackFile {
  readonly name: "body" | "captured" | "face" | "groom" | "cast" | "paint";
  /** File name in packages/character/assets/human. */
  readonly file: string;
  readonly digest: Digest;
  readonly byteLength: number;
  /** Where the packed arrays came from; each source's licence travels with exports that use it. */
  readonly sources: ReadonlyArray<string>;
}

export const humanPackFiles: ReadonlyArray<HumanPackFile> = [
  {
    name: "body",
    file: "human-body.bin",
    digest: digestBrand("sha256:5ead7233a81c08ecc540655fb4c0cde06b10eb9882f725f45f478fe44ca400bc"),
    byteLength: 5767315,
    sources: [
      "MakeHuman / MPFB2 base mesh, targets and rig weights as distributed in Anny 0.6.2 (CC0)",
      "CC0 MakeHuman community targets and authored characters (portrait foundations, head detail)",
      "Microsoft Rocketbox Avatar Library face fields (MIT, Copyright (c) 2020 Microsoft)",
      "Face identity fields fitted in this repository (MIT)",
    ],
  },
  {
    name: "captured",
    file: "human-captured.bin",
    digest: digestBrand("sha256:02868250982b196dc855e99f49c57ffc647b7676ea122d6ecd9d0c2fea7b4c5a"),
    byteLength: 251020,
    sources: ["HSRD-100 scans, Digital Reality Lab (CC BY 4.0), registered to the adult mesh"],
  },
  {
    name: "face",
    file: "human-face.bin",
    digest: digestBrand("sha256:0aaa1919aaa1cf53e82050b10ec8935d41f492af8c8a500293e4d29dac4dc6f5"),
    byteLength: 374473,
    sources: [
      "MakeHuman community system pack eyebrows and eyelashes (CC0), traced and grown as strand cards",
      "Face paint chart of the MakeHuman / MPFB2 head (CC0): lid margins, mouth patch and brow strokes",
    ],
  },
  {
    name: "groom",
    file: "human-groom.bin",
    digest: digestBrand("sha256:a1645f675a0d23a14d760029358bcff23b449c91aae009183cfef30e97e6b0a8"),
    byteLength: 2839322,
    sources: [
      "MakeHuman system asset hair (CC0 1.0, MakeHuman team): layered, receding, tied bun, long centre part, side-swept pixie and low ponytail",
      "MakeHuman community hair01 pack (CC0 1.0): bobs by MargaretToigo, loose waves by Cortu Johnstone",
      "MakeHuman community bodyparts05 pack (CC0 1.0): moustache by RehmanPolanski",
    ],
  },
  {
    name: "cast",
    file: "human-cast.bin",
    digest: digestBrand("sha256:6bbbba14111a1d6edaf91c1211bb5233ddcbc98c22be39702645045da51d3147"),
    byteLength: 7122771,
    sources: [
      "Microsoft Rocketbox Avatar Library (MIT, Copyright (c) 2020 Microsoft): the clothed cast figures, their hair cards and the outfits fitted from their garments",
    ],
  },
];

/** Verify and decode the packs. `read` returns a pack file's bytes by file name. */
export async function loadHumanPacks(
  read: (file: string) => Promise<Uint8Array> | Uint8Array,
): Promise<HumanBody> {
  const bytes = await Promise.all(
    humanPackFiles.map(async (pack) => {
      const data = await read(pack.file);
      if (data.byteLength !== pack.byteLength || sha256Digest(data) !== pack.digest)
        throw new Error(`${pack.file} does not match this build's human pack.`);
      return data;
    }),
  );
  const [body, captured, face, groom, cast] = bytes;
  if (!body || !captured || !face || !groom || !cast) throw new Error("Missing human pack.");
  return readHumanBody(body, captured, face, groom, cast);
}

/** The paint pack the textured presets need; the clay preset and the generator never read it. */
export const humanPaintFile: HumanPackFile = {
  name: "paint",
  file: "human-paint.bin",
  digest: digestBrand("sha256:302c0ba159bb6ae6d0ff8a461bcda9b104ba39671b7372dccc31a12f5c6f9286"),
  byteLength: 23010837,
  sources: [
    "MakeHuman system skins (20 adult skins, CC0): portrait finish donors and local skin tone",
    "MakeHuman system skin young_darkskinned_male (CC0): the clipped buzz cut's hair density and grain, traced from its scalp",
    "Brushed scalp painting generated for this project with OpenAI ImageGen, packed as grayscale samples (human-swept-scalp-data.json and docs/human-grooms.md at 2761eb14)",
    "Mindfront skin maps (CC0): body relief and dermal relief",
    "MakeHuman / MPFB2 head (CC0): face detail, tone, zone and visibility fields and brow paint",
    "MakeHuman eye textures (CC0): iris stroma, brightness and hue removed",
    "Microsoft Rocketbox Avatar Library donor skins (MIT, Copyright (c) 2020 Microsoft)",
    "HSRD-100 face and iris photographs, Digital Reality Lab (CC BY 4.0), registered to the adult layout",
    "MakeHuman system and community grooms (CC0 1.0): strand pictures and normal maps of the authored hair and facial hair",
    "Microsoft Rocketbox Avatar Library (MIT, Copyright (c) 2020 Microsoft): the clothed cast's pictures, hair card pictures, garment art and surface maps",
  ],
};

/** Verify and decode the paint pack. `read` returns its bytes by file name. */
export async function loadHumanPaint(
  read: (file: string) => Promise<Uint8Array> | Uint8Array,
): Promise<HumanPaint> {
  const data = await read(humanPaintFile.file);
  if (data.byteLength !== humanPaintFile.byteLength || sha256Digest(data) !== humanPaintFile.digest)
    throw new Error(`${humanPaintFile.file} does not match this build's human pack.`);
  return readHumanPaint(data);
}

export {
  humanBodySpec,
  humanCapturedSpec,
  humanFaceSpec,
  strandNames,
  type HumanBody,
  type BrowName,
  type FaceChartData,
  type StrandCard,
  type StrandName,
} from "./body.js";
export {
  authoredHair,
  groomedHair,
  groomNames,
  grooms,
  humanGroomSpec,
  isGroomName,
  type Groom,
  type GroomCredit,
  type GroomName,
  type HumanGrooms,
} from "./groom.js";
export {
  castSkinNames,
  humanPaintSpec,
  buzzSize,
  sweptScalpSize,
  paintBrowNames,
  paintImageNames,
  paintMediaType,
  readHumanPaint,
  type CastSkinName,
  type FinishDonor,
  type HumanPaint,
  type PaintBrowName,
  type PaintImage,
} from "./paint-data.js";
export * from "./cast-data.js";
/** The pack format, for the one-off converter of the reference data. */
export { readPack, writePack, type PackKind, type PackSpec } from "./pack.js";
export * from "./catalogue.js";
export {
  evaluateHuman,
  expressionDisplacements,
  humanAxes,
  humanRange,
  isHumanAxis,
  validHuman,
  type HumanAxis,
  type HumanMeasurements,
  type HumanSurface,
} from "./surface.js";
export {
  adultColourRanges,
  drawAdult,
  randomHuman,
  regionName,
  surfaceRegions,
  type Archetype,
  type ColourRange,
  type DrawnStyle,
  type HumanDraw,
  type Region,
} from "./draw.js";
export { postureAxes, postureRanges, postureStyleNames, type Posture } from "./posture.js";
export {
  defaultTailor,
  readTailor,
  tailorLayer,
  tailorLimit,
  tailorPieces,
  tailorProblems,
  type Tailor,
  type TailorField,
  type TailorLayer,
  type TailorPiece,
} from "./dress/tailor-data.js";
export { faceMarkKinds, faceMarkLimit, faceMarkSides, type FaceMark } from "./marks.js";
export { randomStream } from "./identity.js";
export * from "./generator.js";
export * from "./starter.js";
export { dressedAdult, humanLooks, look491, unbraidedLook8950, type HumanLook } from "./looks.js";
