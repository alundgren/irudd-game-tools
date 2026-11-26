// The recipe a legacy figure was generated from: proportions, stance, face,
// hair and everyday clothes. Ported from readFigure in character-view/figure.js
// at 2761eb1, with the same bounds. Each field is optional, as an artist or an
// agent may send a partial figure; the generator fills the rest. The built
// parts carry the result, so builders never read the recipe; it is kept so
// the figure can be regenerated from what made it.

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

/** A recipe groom takes the figure's hair colour. */
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

export const FigureRecipe = Schema.Struct({
  archetype: opt(Schema.Literals(figureArchetypes)),
  /** Standing height in metres. */
  height: opt(bounded(1.2, 2.2)),
  /** Height in head lengths. */
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
  /** Built-in face paint, as `character.appearance` face. */
  face: opt(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 }))),
  hair: opt(Schema.Literals(figureHair)),
  hairColor: opt(Hex),
  /** Rooted strands instead of the plain hair shell; null for none. */
  groom: opt(Schema.NullOr(FigureRecipeGroom)),
  stance: opt(
    Schema.Struct({
      /** Arm angle from the body, in degrees. */
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
