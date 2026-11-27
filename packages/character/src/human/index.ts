import { headwearPack } from "./headwear-library.js";
import { digestBrand, sha256Digest, type Digest } from "@irudd/document";
import { readHumanBody, type HumanBody } from "./body.js";
import { readHumanPaint, type HumanPaint } from "./paint-data.js";

export { rocketboxLicense } from "./credits.js";

export interface HumanPackFile {
  readonly name:
    | "body"
    | "captured"
    | "face"
    | "groom"
    | "cast"
    | "paint"
    | "studio"
    | "field-clothes"
    | "headwear";
  readonly file: string;
  readonly digest: Digest;
  readonly byteLength: number;
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
  {
    name: "studio",
    file: "studio-rain.bin",
    digest: digestBrand("sha256:d70eaf77bd76c76168b20871f217c13bde12ef5d8c8c81cc7f95fd2955087ee4"),
    byteLength: 374896,
    sources: [
      "Rain Rig, Blender Foundation (CC BY 4.0), fitted head, hair, expressions and vertex colour derived from the workshop Rain asset",
    ],
  },
  {
    name: "field-clothes",
    file: "human-field-clothes.bin",
    digest: digestBrand("sha256:64a63f2c33efde33755ac7f1fd2afb8db3c15ee1174258c9dd661860a6167af8"),
    byteLength: 57868966,
    sources: [
      "MakeHuman system clothing, shoes and community clothing adapted from the browser wardrobe (CC0).",
      "Einar Rig, Blender Foundation (CC BY 4.0), coat, trousers and boots adapted for the adult rig. https://studio.blender.org/characters/einar/v1/",
      "Scanned garments adapted from HSRD-100, Digital Reality Lab (CC BY 4.0). https://huggingface.co/datasets/digitalrealitylab/HSRD-100",
    ],
  },
  {
    name: "headwear",
    file: "human-headwear.bin",
    byteLength: headwearPack.byteLength,
    digest: digestBrand(headwearPack.digest),
    sources: [
      "Fitted hairstyles and headwear from the browser workshop. MakeHuman community and FlightHelmet from Microsoft (CC0), Rocketbox Avatar Library (MIT, Copyright (c) 2020 Microsoft), Rain and Einar from the Blender Foundation (CC BY 4.0), and HSRD-100 from Digital Reality Lab (CC BY 4.0). See the bundled artwork notices.",
    ],
  },
];

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
  const [body, captured, face, groom, cast, studio, clothes, headwear] = bytes;
  if (!body || !captured || !face || !groom || !cast || !studio || !clothes || !headwear)
    throw new Error("Missing human pack.");
  return readHumanBody(body, captured, face, groom, cast, studio, clothes, headwear);
}

export const humanPaintFile: HumanPackFile = {
  name: "paint",
  file: "human-paint.bin",
  digest: digestBrand("sha256:c95363989dbd61855435d736e37472960f1e793780d558cbc9d363ef07fbf30b"),
  byteLength: 23175056,
  sources: [
    "MakeHuman system skins (20 adult skins, CC0): portrait finish donors and local skin tone",
    "MakeHuman system skin young_darkskinned_male (CC0): the clipped buzz cut's hair density and grain, traced from its scalp",
    "Brushed scalp painting generated for this project with OpenAI ImageGen, packed as grayscale samples (human-swept-scalp-data.json and docs/human-grooms.md at 2761eb14)",
    "Mindfront skin maps (CC0): body relief and dermal relief",
    "MakeHuman / MPFB2 head (CC0): face detail, tone, zone and visibility fields and brow paint",
    "MakeHuman eye textures (CC0): iris stroma, brightness and hue removed",
    "Microsoft Rocketbox Avatar Library donor skins, including Male_Adult_05 clipped beard density, grain and relief (MIT, Copyright (c) 2020 Microsoft)",
    "HSRD-100 face and iris photographs, Digital Reality Lab (CC BY 4.0), registered to the adult layout",
    "MakeHuman system and community grooms (CC0 1.0): strand pictures and normal maps of the authored hair and facial hair",
    "Microsoft Rocketbox Avatar Library (MIT, Copyright (c) 2020 Microsoft): the clothed cast's pictures, hair card pictures, garment art and surface maps",
  ],
};

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
export {
  drawPosture,
  mirrorPosture,
  postureStyles,
  postureAxes,
  postureRanges,
  postureStyleNames,
  type Posture,
} from "./posture.js";
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
export {
  faceMark,
  faceMarkKindTable,
  faceMarkKinds,
  faceMarkLimit,
  faceMarkSides,
  type FaceMark,
} from "./marks.js";
export { randomStream } from "./identity.js";
export * from "./generator.js";
export * from "./starter.js";
export { dressedAdult, humanLooks, look491, unbraidedLook8950, type HumanLook } from "./looks.js";
export * from "./edit.js";
export * from "./reference-fit.js";
export * from "./measurements.js";
export * from "./wardrobe.js";
export { castDonor, castSkin } from "./cast.js";
export { castOutfits } from "./cast-wardrobe.js";

export { armourLooks, armourSet } from "./dress/armour-set.js";
