// irudd.human-adult version 1: an ordinary adult human body as a generator.
//
// The parameters are the explicit values the reference workshop's seeded
// adult draw decides (character-view/human-form.js generatedHuman at 2761eb1):
// the measurements, the posture, the skin and eye colours, the personal style,
// the complexion and the face marks. The draw itself runs once, in the
// starter, so a document stores values a person or an agent can read and
// steer, never a seed to replay.
//
// The generator materialises the 52 regions of the evaluated body as slots:
// each region's joint relative to its parent's joint, at unit size, in the
// skin colour. The builder reads the body from these parameters and the
// regions' transforms from the parts, so a manual edit of a region survives a
// steer of the measurements by the ordinary three-way merge.

import { Schema } from "effect";
import {
  Color,
  defineGenerator,
  figureScapulaMount,
  type Reseat,
  type BaseSlotInput,
  type GeneratorDefinition,
} from "@irudd/document";
import type { HumanBody } from "./body.js";
import { boneNames, boneParents, castNames, type BoneName } from "./catalogue.js";
import { capturedSkinNames } from "./captured.js";
import {
  armInkStyles,
  browStyleDraws,
  drawAdult,
  regionName,
  surfaceRegions,
  type HumanDraw,
} from "./draw.js";
import { faceMarkKindTable, faceMarkKinds, faceMarkLimit, faceMarkSides } from "./marks.js";
import { makeupStyles } from "./makeup.js";
import { isCastFigureName, type CastFigureName } from "./cast-data.js";
import { castBottomNames, castOutfitProblems, castTopNames } from "./cast-wardrobe.js";
import { presetOutfitNames } from "./dress/outfit-names.js";
import { tailorProblems } from "./dress/tailor-data.js";
import {
  eyewearStyles,
  fittedHairStyles,
  fringeStyles,
  grownHairStyles,
  necklaceStyles,
  secondClothDesigns,
  tailoredClothDesigns,
} from "./dress/styles.js";
import { postureRanges, postureStyleNames } from "./posture.js";
import { scapulaSocket } from "./sockets.js";
import {
  evaluateHuman,
  humanAxes,
  humanRange,
  isHumanAxis,
  type HumanMeasurements,
} from "./surface.js";

export const humanAdultId = "irudd.human-adult";
export const humanAdultVersion = 1;

const range = (minimum: number, maximum: number) =>
  Schema.Finite.check(Schema.isBetween({ minimum, maximum }));
const unsigned32 = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 0xffffffff }));

const axisFits = (values: { readonly [axis: string]: number }) => {
  for (const [axis, value] of Object.entries(values)) {
    if (!isHumanAxis(axis)) return `There is no adult measurement ${axis}.`;
    const [lo, hi] = humanRange(axis);
    if (value < lo || value > hi) return `Keep ${axis} between ${lo} and ${hi}.`;
  }
  return true;
};

/** Measurements by name, each within the reference editor's own limits. Unset ones rest. */
export const HumanMeasurementsSchema = Schema.Record(Schema.String, Schema.Finite).check(
  Schema.makeFilter(axisFits),
);

const posture = (key: keyof typeof postureRanges) =>
  Schema.optionalKey(range(postureRanges[key][0], postureRanges[key][1]));
export const HumanPostureSchema = Schema.Struct({
  style: Schema.optionalKey(Schema.Literals(postureStyleNames)),
  weight: posture("weight"),
  hip: posture("hip"),
  lean: posture("lean"),
  slouch: posture("slouch"),
  twist: posture("twist"),
  shoulders: posture("shoulders"),
  shrug: posture("shrug"),
  arms: posture("arms"),
  elbows: posture("elbows"),
  hands: posture("hands"),
  headTilt: posture("headTilt"),
  headTurn: posture("headTurn"),
  chin: posture("chin"),
  feet: posture("feet"),
  toes: posture("toes"),
  step: posture("step"),
  stride: posture("stride"),
  handAtWaist: posture("handAtWaist"),
  swing: posture("swing"),
});

/** The brow artwork names the reference workshop offers. */
export const browStyles = ["As drawn", ...new Set(browStyleDraws)] as const;
export const eyeColors = [
  "dark brown",
  "brown",
  "hazel",
  "amber",
  "green",
  "grey",
  "blue",
] as const;
/** Complexions a seeded adult draw can choose. */
export const drawnComplexions: ReadonlyArray<string> = [
  "Portrait Rose",
  "Portrait Honey",
  "Portrait Fair",
  "Portrait Umber",
  "Portrait Ruddy",
  "Portrait Sunworn",
  ...capturedSkinNames,
];

/**
 * An outfit tailored piece by piece: layers in dressing order, each a piece
 * and any of its fields (unset fields take the piece's starting values).
 */
export const HumanTailorSchema = Schema.Struct({
  layers: Schema.Array(Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Finite]))),
}).check(
  Schema.makeFilter((tailor) => {
    const problems = tailorProblems(tailor);
    return problems.length ? problems.join(" ") : true;
  }),
);

/** What the adult wears: the bare anatomy, or the work clothes its style tailors or its cast member wears. */
export const humanOutfits = ["Anatomy", "Work clothes"] as const;

export const HumanStyleSchema = Schema.Struct({
  armInk: Schema.optionalKey(Schema.Literals(armInkStyles)),
  browStyle: Schema.optionalKey(Schema.Literals(browStyles)),
  cast: Schema.optionalKey(Schema.Literals(castNames)),
  castShape: Schema.optionalKey(range(0, 1)),
  castPigment: Schema.optionalKey(range(0, 1)),
  castSkin: Schema.optionalKey(Color),
  /** The cast member's top and bottom, from the pieces fitted to it; unset is its own. */
  castTop: Schema.optionalKey(Schema.Literals(castTopNames)),
  castBottom: Schema.optionalKey(Schema.Literals(castBottomNames)),
  /** Everyday makeup painted into the face. */
  makeup: Schema.optionalKey(Schema.Literals(makeupStyles)),
  tailor: Schema.optionalKey(HumanTailorSchema),
  /** A preset outfit worn in work clothes when no outfit is tailored. */
  outfit: Schema.optionalKey(Schema.Literals(["None", ...presetOutfitNames])),
  /** The outfit's cloth colour, which every other tone of its palette is drawn from. */
  clothColor: Schema.optionalKey(Color),
  /** Tones of the outfit named outright: the second and pale cloth, the accent, leather and soles. */
  clothSecond: Schema.optionalKey(Color),
  clothLight: Schema.optionalKey(Color),
  accentColor: Schema.optionalKey(Color),
  leatherColor: Schema.optionalKey(Color),
  soleColor: Schema.optionalKey(Color),
  /** Hair: library hair, an authored groom fitted to the head, or a cut grown as strands on the scalp. */
  hair: Schema.optionalKey(Schema.Literals([...fittedHairStyles, ...grownHairStyles])),
  /** How the hair over the forehead is worn. */
  fringe: Schema.optionalKey(Schema.Literals(fringeStyles)),
  hairColor: Schema.optionalKey(Color),
  eyewear: Schema.optionalKey(Schema.Literals(eyewearStyles)),
  necklace: Schema.optionalKey(Schema.Literals(necklaceStyles)),
  /** The enamel of a teardrop pendant. */
  clothAccent: Schema.optionalKey(Color),
  /** The metal of jewellery settings. */
  metalColor: Schema.optionalKey(Color),
  /** The weave of a tailored outfit's outermost top. */
  clothDesign: Schema.optionalKey(Schema.Literals(tailoredClothDesigns)),
  /** The weave of tailored trousers or shorts. */
  secondDesign: Schema.optionalKey(Schema.Literals(secondClothDesigns)),
}).check(
  Schema.makeFilter((style) => {
    if (style.castTop === undefined && style.castBottom === undefined) return true;
    if (style.cast === undefined || !isCastFigureName(style.cast))
      return "A cast top or bottom needs a cast member.";
    const problems = castOutfitProblems(style.cast, style);
    return problems.length ? problems.join(" ") : true;
  }),
);

const placeFits = (mark: {
  readonly kind: keyof typeof faceMarkKindTable;
  readonly place: string;
}) => {
  const places: ReadonlyArray<string> = faceMarkKindTable[mark.kind].places;
  return places.includes(mark.place) || `A ${mark.kind.toLowerCase()} has no place ${mark.place}.`;
};

export const FaceMarkSchema = Schema.Struct({
  kind: Schema.Literals(faceMarkKinds),
  place: Schema.String.check(Schema.isMaxLength(64)),
  side: Schema.Literals(faceMarkSides),
  strength: range(0, 1),
  size: range(0, 1),
  seed: unsigned32,
  tone: Schema.optionalKey(Color),
  across: Schema.optionalKey(range(-1, 1)),
  up: Schema.optionalKey(range(-1, 1)),
  turn: Schema.optionalKey(range(-90, 90)),
}).check(Schema.makeFilter(placeFits));

export const HumanAdultParams = Schema.Struct({
  /** The seed the values were drawn from. Skin details (ink wear, marks) still vary with it. */
  seed: unsigned32,
  human: HumanMeasurementsSchema,
  /** How the adult stands and moves. Unset, it rests in the fitting pose with the generated clips, as G0 builds a form without one. */
  posture: Schema.optionalKey(HumanPostureSchema),
  skin: Color,
  style: HumanStyleSchema,
  /** Anatomy unless set: work clothes dress the tailored outfit, or wear the cast member. */
  outfit: Schema.optionalKey(Schema.Literals(humanOutfits)),
  eyeColor: Schema.optionalKey(Schema.Literals(eyeColors)),
  complexion: Schema.optionalKey(Schema.Literals(drawnComplexions)),
  faceMarks: Schema.optionalKey(
    Schema.Array(FaceMarkSchema).check(Schema.isMaxLength(faceMarkLimit)),
  ),
});
export type HumanAdultParams = typeof HumanAdultParams.Type;

/** The parameters a draw decides. Equal draws give equal parameters. */
export function humanAdultParams(draw: HumanDraw): HumanAdultParams {
  return Schema.decodeUnknownSync(HumanAdultParams)({
    seed: draw.seed,
    human: draw.human,
    posture: draw.posture,
    skin: draw.skin,
    style: draw.style,
    ...(draw.eyeColor ? { eyeColor: draw.eyeColor } : {}),
    ...(draw.complexion ? { complexion: draw.complexion } : {}),
    ...(draw.faceMarks ? { faceMarks: draw.faceMarks } : {}),
  });
}

/**
 * The cast member the adult is worn as: its style names one and it wears work
 * clothes with every region of the body (wornCast in
 * character-view/human-cast-looks.js at 2761eb1). Otherwise null, and the
 * adult is built from its own regions.
 */
export function humanWornCast(
  params: HumanAdultParams,
  regions: number = boneNames.length,
): CastFigureName | null {
  const name = params.style.cast;
  return params.outfit === "Work clothes" &&
    name !== undefined &&
    isCastFigureName(name) &&
    regions === boneNames.length
    ? name
    : null;
}

/** The measurements the parameters set, as the surface evaluates them. */
export function humanMeasurements(params: HumanAdultParams): HumanMeasurements {
  const out: HumanMeasurements = {};
  for (const axis of humanAxes) {
    const value = params.human[axis];
    if (value !== undefined) out[axis] = value;
  }
  return out;
}

/** A bone's slot key: "ball_l" is "ball.l", "index_01_r" is "index-01.r". */
export function humanSlot(bone: BoneName): string {
  const side = /_([lr])$/.exec(bone);
  const base = side ? bone.slice(0, -2) : bone;
  return base.replace(/_/g, "-") + (side ? "." + side[1] : "");
}

const slotBones = new Map<string, BoneName>(boneNames.map((b) => [humanSlot(b), b]));
/** The bone a generated slot stands for. */
export const humanSlotBone = (slot: string): BoneName | undefined => slotBones.get(slot);

/**
 * Regions parent first, siblings in the reference form's (bone name) order,
 * so the document's order keeps the reference scene's child order.
 */
function parentFirst(): BoneName[] {
  const names: ReadonlyArray<string> = boneNames;
  const out: BoneName[] = [];
  const visit = (parent: BoneName | null) => {
    boneNames.forEach((bone, i) => {
      const p = boneParents[i];
      const pi = p === undefined ? -1 : names.indexOf(p);
      if ((pi < 0 ? null : boneNames[pi]) !== parent) return;
      out.push(bone);
      visit(bone);
    });
  };
  visit(null);
  return out;
}
const regionOrder = parentFirst();

const identity = [0, 0, 0, 1] as const;

/** The regions of the body these parameters evaluate to. */
export function humanAdultSlots(body: HumanBody, params: HumanAdultParams): BaseSlotInput[] {
  const regions = new Map(
    surfaceRegions(evaluateHuman(body, humanMeasurements(params))).map((r) => [r.bone, r]),
  );
  return regionOrder.flatMap((bone) => {
    const r = regions.get(bone);
    if (!r) return [];
    return [
      {
        slot: humanSlot(bone),
        parent: r.parent === null ? null : humanSlot(r.parent),
        label: regionName(bone),
        shape: "ellipsoid",
        position: [r.position[0], r.position[1], r.position[2]],
        rotation: [...identity],
        size: [1, 1, 1],
        color: params.skin,
      },
    ];
  });
}

/**
 * The adult generator over a loaded body pack. A reader that only checks
 * parameters can pass a getter, so the pack loads when a document is generated.
 */
export function humanAdultGenerator(body: HumanBody | (() => HumanBody)): GeneratorDefinition {
  const pack = () => (typeof body === "function" ? body() : body);
  return defineGenerator({
    id: humanAdultId,
    version: humanAdultVersion,
    label: "Adult human",
    schema: HumanAdultParams,
    toJson: (p) => p,
    generate: (p) => humanAdultSlots(pack(), p),
    reseat: (before, after) => reseatOnBlades(pack(), before, after),
  });
}

/**
 * A limb root seated on a shoulder blade of the chest moves with that blade
 * when the measurements change (reseatCreatureLimbs in
 * character-view/human-creature-mount.js at 2761eb1); other parts keep their place.
 */
function reseatOnBlades(body: HumanBody, before: HumanAdultParams, after: HumanAdultParams) {
  const chest = humanSlot("spine_03");
  const surfaces = new Map<HumanAdultParams, ReturnType<typeof evaluateHuman>>();
  const surface = (p: HumanAdultParams) => {
    let found = surfaces.get(p);
    if (!found) surfaces.set(p, (found = evaluateHuman(body, humanMeasurements(p))));
    return found;
  };
  const offsets = new Map<1 | -1, readonly [number, number, number]>();
  const reseat: Reseat = (part, parent) => {
    if (parent !== chest) return undefined;
    const mount = figureScapulaMount.read(part.features);
    if (!mount) return undefined;
    let offset = offsets.get(mount.side);
    if (!offset) {
      const old = scapulaSocket(surface(before), mount.side);
      const fresh = scapulaSocket(surface(after), mount.side);
      offsets.set(mount.side, (offset = [fresh[0] - old[0], fresh[1] - old[1], fresh[2] - old[2]]));
    }
    return [
      part.position[0] + offset[0],
      part.position[1] + offset[1],
      part.position[2] + offset[2],
    ];
  };
  return reseat;
}

/** The seeded draw a starter offers: the reference workshop's `#adult=SEED`. */
export function seededHumanAdult(body: HumanBody, seed: number): HumanAdultParams {
  return humanAdultParams(drawAdult(body, seed >>> 0));
}
