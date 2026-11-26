// figure.plate-field, figure.plate-site and figure.horn-swatch: overlapping
// horn plates grown over a sweep. Ported from validPlateGrowth,
// validPlateGrowthRest and validPlateSite in character-view/plate-growth.js
// and the hornSwatch check in character-view/recipe.js at 2761eb1.
//
// A plate field on a carrier sweep records how its plates were laid out:
// `rows` by `columns` sites over one `face`, from `start` to `end` of its
// length, wrapping `wrap` degrees around it, overlapping by `overlap`, with a
// `crest` and `rise` of relief, tips pointing along `direction`, and the
// seeds of the layout and the tips. `rest` is the carrier's shape when the
// field was grown, so a refit to edited knots moves the plates with it. Each
// plate is its own editable cage part under the carrier, at its own site; a
// site's `tipSeed` pins its tip through field rerolls. On a carrier whose
// axis animates (a tail or an axial spine), a game build keeps every ring of
// the carrier and each plate's socket through simplification.
//
// A horn swatch picks one of the four tiles of the bundled horn sheet. A
// grown plate (a horn cage with the plate layout) takes its tile, its UVs
// following the plate's swept ridges.

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
