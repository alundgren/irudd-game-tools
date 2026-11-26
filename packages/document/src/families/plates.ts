import { Schema } from "effect";
import { bounded, family, Hex, Vec3Between } from "./family.js";
import { Knot } from "./figure.js";

const seed = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 0xffffffff }));

export const plateFaces = ["Back", "Front", "Left", "Right", "Top"] as const;

export const PlateFieldRest = Schema.Struct({
  knots: Schema.Array(Knot).check(
    Schema.isMinLength(2),
    Schema.isMaxLength(48),
    Schema.makeFilter(
      (knots: ReadonlyArray<Knot>) =>
        knots.every((k, i) => {
          const prev = knots[i - 1];
          return !prev || [0, 1, 2].some((j) => Math.abs((k[j] ?? 0) - (prev[j] ?? 0)) > 0.00001);
        }) || "Consecutive rest knots must be distinct.",
    ),
  ),
  horizontal: Schema.Boolean,
  frameSize: Vec3Between(0.005, 12),
});
export type PlateFieldRest = typeof PlateFieldRest.Type;

export const PlateField = Schema.Struct({
  seed,
  tipSeed: seed,
  rows: Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 12 })),
  columns: Schema.Literals([1, 3, 5, 7]),
  face: Schema.Literals(plateFaces),
  direction: Schema.Literals(["first", "last"]),
  start: bounded(0, 1),
  end: bounded(0, 1),
  wrap: bounded(20, 165),
  overlap: bounded(0, 0.8),
  crest: bounded(0, 1),
  rise: Schema.optionalKey(bounded(0.5, 3)),
  color: Hex,
  mirrored: Schema.Boolean,
  rest: Schema.optionalKey(PlateFieldRest),
}).check(
  Schema.makeFilter(
    (f) => f.end - f.start >= 0.04 - 1e-9 || "A plate field spans at least 4 % of its carrier.",
  ),
);
export type PlateField = typeof PlateField.Type;

export const figurePlateField = family({
  id: "figure.plate-field",
  version: 1,
  scope: "part",
  schema: PlateField,
  toJson: (v) => v,
});

export const PlateSite = Schema.Struct({
  row: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 11 })),
  column: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 })),
  tipSeed: Schema.optionalKey(seed),
});
export type PlateSite = typeof PlateSite.Type;

export const figurePlateSite = family({
  id: "figure.plate-site",
  version: 1,
  scope: "part",
  schema: PlateSite,
  toJson: (v) => v,
});

export const HornSwatch = Schema.Struct({
  swatch: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 })),
});
export type HornSwatch = typeof HornSwatch.Type;

export const figureHornSwatch = family({
  id: "figure.horn-swatch",
  version: 1,
  scope: "part",
  schema: HornSwatch,
  toJson: (v) => v,
});
