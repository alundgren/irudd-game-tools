import { Schema } from "effect";
import { bounded, family } from "./family.js";

export const shoulderCuts = ["Cape", "Poncho", "Tabard"] as const;
export const mantleCuts = [...shoulderCuts, "Skirt"] as const;
export const armAccessOptions = ["Covered", "Open sides", "Armholes"] as const;

export const ShoulderCut = Schema.Struct({
  kind: Schema.Literals(shoulderCuts),
  width: bounded(0.025, 8),
  depth: bounded(0.025, 8),
  drop: bounded(0.025, 8),
  flare: bounded(0.65, 2.2),
  opening: bounded(2, 150),
  folds: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 24 })),
  armAccess: Schema.optionalKey(Schema.Literals(armAccessOptions)),
});
export type ShoulderCut = typeof ShoulderCut.Type;

const OutlinePoint = Schema.Tuple([Schema.Finite, bounded(0.32, 4)]);

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
  width: bounded(0.025, 8),
  depth: bounded(0.025, 8),
  drop: bounded(0.025, 8),
  flare: bounded(0.65, 2.2),
  folds: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 24 })),
  outline: SkirtOutline,
  bias: bounded(-1, 1),
  gather: bounded(0, 0.3),
  train: bounded(0, 2),
  tiers: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 })),
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

export function armAccess(cut: ShoulderCut): ArmAccess {
  return cut.armAccess ?? defaultAccess[cut.kind];
}

export const figureMantle = family({
  id: "figure.mantle",
  version: 2,
  upgrades: [(payload) => payload],
  scope: "part",
  schema: FigureMantle,
  toJson: (v) => v,
});
