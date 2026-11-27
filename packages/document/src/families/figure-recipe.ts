import { Schema } from "effect";
import { bounded, Hex } from "./family.js";
import { groomPatterns } from "./groom.js";

const opt = Schema.optionalKey;

export const figureArchetypes = ["neutral", "male", "female"] as const;
export const figureTops = ["shirt", "tee", "jacket", "hoodie", "none"] as const;
export const figureSleeves = ["long", "rolled", "short", "none"] as const;
export const figureBottoms = ["trousers", "shorts", "none"] as const;
export const figurePockets = ["none", "cargo"] as const;
export const figureShoes = ["sneakers", "boots", "none"] as const;
export const figureHair = ["Crop", "Sweep", "Coils", "Bald"] as const;

export const FigureRecipeGroom = Schema.Struct({
  pattern: opt(Schema.Literals(groomPatterns)),
  length: opt(bounded(0, 2)),
  curl: opt(bounded(0, 1)),
  gather: opt(bounded(0, 1)),
  sweep: opt(bounded(-1, 1)),
  volume: opt(bounded(0, 1)),
  nape: opt(bounded(0, 1)),
  seed: opt(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4294967295 }))),
});

export const SectionProfile = Schema.Struct({
  height: bounded(0.000001, 1000),
  stations: Schema.Array(
    Schema.Tuple([
      bounded(0.72, 1.32),
      bounded(0.72, 1.32),
      bounded(-0.038, 0.038),
      bounded(-0.038, 0.038),
    ]),
  ).check(Schema.isMinLength(14), Schema.isMaxLength(14)),
});

export const FigureRecipe = Schema.Struct({
  sectionProfile: opt(SectionProfile),
  archetype: opt(Schema.Literals(figureArchetypes)),
  height: opt(bounded(1.2, 2.2)),
  heads: opt(bounded(6, 8.4)),
  shoulderRise: opt(bounded(-0.04, 0.065)),
  shoulders: opt(bounded(0.7, 1.4)),
  chest: opt(bounded(0.7, 1.95)),
  waist: opt(bounded(0.7, 2.05)),
  hips: opt(bounded(0.7, 1.85)),
  belly: opt(bounded(0, 1)),
  chestFullness: opt(bounded(0, 1)),
  lowerAbdomen: opt(bounded(0, 1)),
  muscleRelief: opt(bounded(0, 1)),
  ribDepth: opt(bounded(0.65, 1.9)),
  pelvisDepth: opt(bounded(0.65, 1.9)),
  legBuild: opt(bounded(0.65, 1.65)),
  abdomenDepth: opt(bounded(0.65, 1.9)),
  limbs: opt(bounded(0.7, 1.6)),
  legs: opt(bounded(0.9, 1.1)),
  arms: opt(bounded(0.88, 1.12)),
  neck: opt(bounded(0.75, 1.35)),
  hands: opt(bounded(0.85, 1.2)),
  skin: opt(Hex),
  face: opt(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 }))),
  hair: opt(Schema.Literals(figureHair)),
  hairColor: opt(Hex),
  groom: opt(Schema.NullOr(FigureRecipeGroom)),
  stance: opt(
    Schema.Struct({
      arms: opt(bounded(4, 75)),
      forearmSpread: opt(bounded(0, 85)),
      elbows: opt(bounded(0, 80)),
      feet: opt(bounded(0.5, 2)),
      curl: opt(bounded(0, 1)),
    }),
  ),
  top: opt(
    Schema.Struct({
      kind: opt(Schema.Literals(figureTops)),
      sleeves: opt(Schema.Literals(figureSleeves)),
      color: opt(Hex),
      trim: opt(Hex),
      ease: opt(bounded(0, 1)),
      length: opt(bounded(0, 1)),
    }),
  ),
  bottom: opt(
    Schema.Struct({
      kind: opt(Schema.Literals(figureBottoms)),
      color: opt(Hex),
      ease: opt(bounded(0, 1)),
      belt: opt(Hex),
      rise: opt(bounded(0, 1)),
      cuffs: opt(Schema.Boolean),
      pockets: opt(Schema.Literals(figurePockets)),
    }),
  ),
  shoes: opt(
    Schema.Struct({
      kind: opt(Schema.Literals(figureShoes)),
      color: opt(Hex),
      sole: opt(Hex),
    }),
  ),
});
export type FigureRecipe = typeof FigureRecipe.Type;
