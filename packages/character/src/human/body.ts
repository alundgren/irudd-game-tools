// The adult body pack: the MakeHuman / MPFB2 skin cage (CC0), its targets,
// rig weights and subdivision, the identity and portrait fields, the
// Rocketbox cast face fields (MIT) and the CC0 head-detail targets.

import {
  ancestryMorphs,
  bodyAxes,
  buildMorphs,
  castShapeAxes,
  castShapeLayout,
  capturedAxes,
  expressionNames,
  identityAxes,
  packedVertices,
  portraitAxes,
  portraitLayout,
  sculptAxes,
  surfaceVertices,
  type CapturedAxis,
} from "./catalogue.js";
import { readHumanCast, type HumanCast } from "./cast-data.js";
import { readHumanGrooms, type HumanGrooms } from "./groom.js";
import { readPack, type EntrySpec, type Pack, type PackSpec } from "./pack.js";

const field = (layout: { readonly shape: readonly [number, number, number] }) =>
  layout.shape[0] * layout.shape[1] * layout.shape[2] * 3;

/** Names of every vertex target in the body pack. */
export const bodyMorphNames: ReadonlyArray<string> = [
  ...bodyAxes.flatMap((a) => [`${a}0`, `${a}1`]),
  ...ancestryMorphs,
  ...buildMorphs,
  ...expressionNames,
  ...identityAxes.flatMap((a) => [`${a}0`, `${a}1`]),
];

function bodySpec(): PackSpec {
  const spec: Record<string, EntrySpec> = {
    base: { kind: "f32", elements: packedVertices * 3 },
    indices: { kind: "u16" },
    uv: { kind: "u16" },
    uvFaces: { kind: "u16" },
    ids: { kind: "u16", elements: surfaceVertices },
    bones: { kind: "u8", elements: surfaceVertices * 4 },
    weights: { kind: "u16", elements: surfaceVertices * 4 },
    subParent: { kind: "u16" },
    quadIds: { kind: "u16" },
    subOffsets: { kind: "u32" },
    subRefs: { kind: "u16" },
    subFactors: { kind: "f32" },
    subIndices: { kind: "u32" },
    subUV: { kind: "u16" },
    subFaceUV: { kind: "u32" },
    subBones: { kind: "u8" },
    subWeights: { kind: "u16" },
    subPigments: { kind: "u8" },
    controlIds: { kind: "u16" },
    controlRefs: { kind: "u16" },
    controlWeights: { kind: "u16" },
    softIds: { kind: "u16" },
    softOffsets: { kind: "u32" },
    softNeighbours: { kind: "u16" },
    softWeights: { kind: "f32" },
    softMix: { kind: "f32" },
    "patch.inner": { kind: "u16" },
    "patch.ring": { kind: "u16" },
    "patch.matrix": { kind: "f64" },
    "eyes.left": { kind: "u16", elements: 72 },
    "eyes.right": { kind: "u16", elements: 72 },
  };
  for (const name of bodyMorphNames)
    spec[`m:${name}`] = { kind: "i16", elements: packedVertices * 3 };
  for (const axis of portraitAxes)
    spec[`m:${axis}`] = { kind: "i16", elements: field(portraitLayout) };
  for (const axis of castShapeAxes)
    spec[`m:${axis}`] = { kind: "i16", elements: field(castShapeLayout) };
  for (const axis of sculptAxes) spec[`sculpt:${axis}`] = { kind: "i32" };
  return spec;
}
export const humanBodySpec = bodySpec();

function capturedSpec(): PackSpec {
  const spec: Record<string, EntrySpec> = {};
  for (const axis of capturedAxes) {
    spec[`${axis}.ids`] = { kind: "u16" };
    spec[`${axis}.delta`] = { kind: "i16" };
  }
  return spec;
}
export const humanCapturedSpec = capturedSpec();

/** Brow and lash strand cards from the CC0 MakeHuman system pack, traced and grown in G0. */
export const strandNames = [
  "eyebrow001",
  "eyebrow003",
  "eyebrow005",
  "eyebrow006",
  "eyebrow009",
  "eyebrow011",
  "eyebrow012",
  "eyelashes01",
] as const;
export type StrandName = (typeof strandNames)[number];
const strandFields = {
  refs: "u16",
  weights: "f32",
  offsets: "f32",
  triRefs: "u16",
  triWeights: "f32",
  triIndices: "u32",
  along: "u8",
  root: "u16",
} as const;
function faceSpec(): PackSpec {
  const spec: Record<string, EntrySpec> = {};
  for (const name of strandNames) {
    for (const [key, kind] of Object.entries(strandFields)) spec[`${name}.${key}`] = { kind };
    spec[`${name}.points`] = { kind: "u8", elements: 1 };
  }
  spec["eyelashes01.lower"] = { kind: "u8" };
  // The face paint chart: the stored face rectangle, the four lid margins (upper
  // left, upper right, lower left, lower right, as whole numbers of 1/65535 of the
  // rectangle), the mouth lining's patch and each brow's strokes.
  spec["chart.rect"] = { kind: "u16", elements: 4 };
  spec["chart.mouthPatch"] = { kind: "f64", elements: 3 };
  for (let k = 0; k < 4; k++) spec[`chart.lid${k}`] = { kind: "u16" };
  spec["chart.lidLower"] = { kind: "u8", elements: 4 };
  for (const name of strandNames)
    if (name !== "eyelashes01") spec[`chart.strokes.${name}`] = { kind: "u16" };
  return spec;
}
export const humanFaceSpec = faceSpec();

export type BrowName = Exclude<StrandName, "eyelashes01">;
export interface FaceChartData {
  /** Left, top, right and bottom of the stored face rectangle, in 2048 px texture pixels. */
  readonly rect: readonly [number, number, number, number];
  /** Centre x, centre y and half size of the mouth lining's square, in rectangle pixels. */
  readonly mouthPatch: readonly [number, number, number];
  /** The lid margins as x, y pairs in shares of the rectangle, with whether each is a lower lid. */
  readonly lids: ReadonlyArray<{ readonly lower: boolean; readonly points: Float32Array }>;
  /** A brow's strokes: three x, y points each, in shares of the rectangle. */
  readonly strokes: (name: BrowName) => Float32Array;
}

/** One strand card: proxy points bound to three skin vertices, and the strands' triangles over them. */
export interface StrandCard {
  readonly refs: Uint16Array;
  readonly weights: Float32Array;
  readonly offsets: Float32Array;
  readonly triRefs: Uint16Array;
  readonly triWeights: Float32Array;
  readonly triIndices: Uint32Array;
  /** How far along its strand each vertex lies, 0 at the root to 255 at the tip. */
  readonly along: Uint8Array;
  /** The first vertex of each vertex's strand. */
  readonly root: Uint16Array;
  /** Lashes only: 1 on the lower lid. */
  readonly lower: Uint8Array | null;
  /** Points along each strand's centre line. */
  readonly points: number;
}

/** The decoded body: typed arrays read once and shared by every evaluation. */
export interface HumanBody {
  readonly arrays: Pack;
  /** A vertex target, as whole numbers of 0.1 mm. */
  readonly morph: (name: string) => Int16Array;
  readonly patch: {
    readonly inner: Uint16Array;
    readonly ring: Uint16Array;
    readonly matrix: Float64Array;
  };
  readonly eyeGroups: readonly [Uint16Array, Uint16Array];
  readonly sculpt: (axis: (typeof sculptAxes)[number]) => Int32Array;
  readonly captured: (axis: CapturedAxis) => {
    readonly ids: Uint16Array;
    readonly delta: Int16Array;
  };
  readonly strands: (name: StrandName) => StrandCard;
  /** The face paint chart's inputs. */
  readonly chart: FaceChartData;
  /** Skin weights as shares of one, as the reference workshop derives them. */
  readonly floatWeights: Float32Array;
  readonly subFloatWeights: Float32Array;
  /** The authored hair and facial hair grooms. */
  readonly grooms: HumanGrooms;
  /** The clothed Rocketbox cast. */
  readonly cast: HumanCast;
}

/** Decode the body, captured-face, face strand, groom and cast packs. */
export async function readHumanBody(
  body: Uint8Array,
  captured: Uint8Array,
  face: Uint8Array,
  groom: Uint8Array,
  castBytes: Uint8Array,
): Promise<HumanBody> {
  const grooms = readHumanGrooms(groom);
  const cast = readHumanCast(castBytes);
  const arrays = await readPack(body, humanBodySpec, "human-body.bin");
  const faces = await readPack(captured, humanCapturedSpec, "human-captured.bin");
  const strandPack = await readPack(face, humanFaceSpec, "human-face.bin");
  const share = (values: Uint16Array) => Float32Array.from(values, (v) => v / 65535);
  const rect = strandPack.u16("chart.rect"),
    mouthPatch = strandPack.f64("chart.mouthPatch"),
    lower = strandPack.u8("chart.lidLower");
  const strokes = new Map<string, Float32Array>();
  const chart: FaceChartData = {
    rect: [rect[0] ?? 0, rect[1] ?? 0, rect[2] ?? 0, rect[3] ?? 0],
    mouthPatch: [mouthPatch[0] ?? 0, mouthPatch[1] ?? 0, mouthPatch[2] ?? 0],
    lids: [0, 1, 2, 3].map((k) => ({
      lower: lower[k] === 1,
      points: share(strandPack.u16(`chart.lid${k}`)),
    })),
    strokes: (name) => {
      let found = strokes.get(name);
      if (!found) strokes.set(name, (found = share(strandPack.u16(`chart.strokes.${name}`))));
      return found;
    },
  };
  const cards = new Map<StrandName, StrandCard>();
  for (const name of strandNames)
    cards.set(name, {
      refs: strandPack.u16(`${name}.refs`),
      weights: strandPack.f32(`${name}.weights`),
      offsets: strandPack.f32(`${name}.offsets`),
      triRefs: strandPack.u16(`${name}.triRefs`),
      triWeights: strandPack.f32(`${name}.triWeights`),
      triIndices: strandPack.u32(`${name}.triIndices`),
      along: strandPack.u8(`${name}.along`),
      root: strandPack.u16(`${name}.root`),
      lower: strandPack.has(`${name}.lower`) ? strandPack.u8(`${name}.lower`) : null,
      points: strandPack.u8(`${name}.points`)[0] ?? 0,
    });
  const patch = {
    inner: arrays.u16("patch.inner"),
    ring: arrays.u16("patch.ring"),
    matrix: arrays.f64("patch.matrix"),
  };
  if (patch.matrix.length !== patch.inner.length * patch.ring.length)
    throw new Error("Human pack patch matrix does not match its rings.");
  return {
    arrays,
    morph: (name) => arrays.i16(`m:${name}`),
    patch,
    eyeGroups: [arrays.u16("eyes.left"), arrays.u16("eyes.right")],
    sculpt: (axis) => arrays.i32(`sculpt:${axis}`),
    captured: (axis) => ({ ids: faces.u16(`${axis}.ids`), delta: faces.i16(`${axis}.delta`) }),
    chart,
    strands: (name) => {
      const card = cards.get(name);
      if (!card) throw new Error(`No strand card ${name}.`);
      return card;
    },
    floatWeights: Float32Array.from(arrays.u16("weights"), (w) => w / 65535),
    subFloatWeights: Float32Array.from(arrays.u16("subWeights"), (w) => w / 65535),
    grooms: await grooms,
    cast: await cast,
  };
}
