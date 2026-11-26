// figure.mantle: a fitted, cut fabric panel worn over the shoulders, or a
// skirt sewn at the waist.
//
// Ported from validCut and mantleGeometry in character-view/mantle.js and
// validSkirtOutline in skirt-pattern.js at 2761eb1. A shoulder cut is one
// two-sided panel that wraps an open neckline and falls to its hem, its sides
// covered, open or cut with armholes. A skirt follows its outline from the
// waist to the hem, with folds, pleats, tiers and a train.

import { Schema } from "effect";
import { bounded, family } from "./family.js";

/** Cuts worn over the shoulders. */
export const shoulderCuts = ["Cape", "Poncho", "Tabard"] as const;
/** Every mantle cut, as the legacy editor offers them. */
export const mantleCuts = [...shoulderCuts, "Skirt"] as const;
export const armAccessOptions = ["Covered", "Open sides", "Armholes"] as const;

export const ShoulderCut = Schema.Struct({
  kind: Schema.Literals(shoulderCuts),
  /** Shoulder width in metres. */
  width: bounded(0.025, 8),
  /** Front-to-back depth at the shoulders in metres. */
  depth: bounded(0.025, 8),
  /** Length from neckline to hem in metres. */
  drop: bounded(0.025, 8),
  /** How far the hem widens beyond the shoulders. */
  flare: bounded(0.65, 2.2),
  /** Angle of the front opening at the neckline, in degrees. */
  opening: bounded(2, 150),
  /** Raised folds around the hem. */
  folds: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 24 })),
  /** How the arms come through. Defaults by cut: Cape covered, Tabard open sides, Poncho armholes. */
  armAccess: Schema.optionalKey(Schema.Literals(armAccessOptions)),
});
export type ShoulderCut = typeof ShoulderCut.Type;

/** A point of a skirt outline: [height from waist 0 to hem 1, radius relative to the waist]. */
const OutlinePoint = Schema.Tuple([Schema.Finite, bounded(0.32, 4)]);

/** A skirt's side, from the waist [0, 1] down to the hem at height 1, strictly descending. */
export const SkirtOutline = Schema.Array(OutlinePoint).check(
  Schema.makeFilter(
    (points: ReadonlyArray<readonly [number, number]>) =>
      (points.length >= 3 &&
        points.length <= 64 &&
        points[0]?.[0] === 0 &&
        points[0]?.[1] === 1 &&
        points.at(-1)?.[0] === 1 &&
        points.every((p, i) => i === 0 || p[0] > (points[i - 1]?.[0] ?? Infinity))) ||
      "A skirt outline runs in 3 to 64 points from [0, 1] at the waist to height 1 at the hem, each lower than the last.",
  ),
);

export const SkirtCut = Schema.Struct({
  kind: Schema.Literal("Skirt"),
  /** Waist width in metres. */
  width: bounded(0.025, 8),
  /** Front-to-back waist depth in metres. */
  depth: bounded(0.025, 8),
  /** Length from waist to hem in metres. */
  drop: bounded(0.025, 8),
  /** How far the hem widens beyond the outline. */
  flare: bounded(0.65, 2.2),
  /** Fold waves around the hem. */
  folds: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 24 })),
  outline: SkirtOutline,
  /** Folds lean towards one side (-1) or the other (1). */
  bias: bounded(-1, 1),
  /** How deep the gathered folds stand out. */
  gather: bounded(0, 0.3),
  /** How far the back hem trails. */
  train: bounded(0, 2),
  /** Flounced tiers on the lower third. */
  tiers: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 })),
  /** Metres of ease at the sewn waist; without it the waist sits 7 mm out in its own frame. */
  waistClearance: Schema.optionalKey(bounded(0, 0.06)),
  pleats: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 24 }))),
  pleatDepth: Schema.optionalKey(bounded(0, 0.35)),
});
export type SkirtCut = typeof SkirtCut.Type;

export const MantleCut = Schema.Union([ShoulderCut, SkirtCut]);
export type MantleCut = typeof MantleCut.Type;

export const FigureMantle = Schema.Struct({ cut: MantleCut });
export type FigureMantle = typeof FigureMantle.Type;

export type ArmAccess = (typeof armAccessOptions)[number];

const defaultAccess: Record<ShoulderCut["kind"], ArmAccess> = {
  Cape: "Covered",
  Tabard: "Open sides",
  Poncho: "Armholes",
};

/** The cut's arm access, or its kind's default. */
export function armAccess(cut: ShoulderCut): ArmAccess {
  return cut.armAccess ?? defaultAccess[cut.kind];
}

export const figureMantle = family({
  id: "figure.mantle",
  version: 2,
  // Version 1 used the same representation for its three shoulder cuts.
  upgrades: [(payload) => payload],
  scope: "part",
  schema: FigureMantle,
  toJson: (v) => v,
});
