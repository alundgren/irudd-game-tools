// figure.hull: a painted volume traced from a turnaround sheet.
//
// Ported from the hull data character-view/volume.js and turnaround.js build
// at 2761eb1. The part names its sheet in the core `paint.atlas` field; the
// hull is the traced silhouette: for each height, the intervals the front and
// side views cover. The builder fills that field with marching cubes and
// projects each triangle onto the view that faces it most.

import { Schema } from "effect";
import { bounded, family, Vec3Between } from "./family.js";

/** One covered interval [from, to] across a view, in sheet units. */
const Run = Schema.Tuple([bounded(-4, 4), bounded(-4, 4)]).check(
  Schema.makeFilter(([a, b]) => a <= b || "A run must not end before it starts."),
);
const Runs = Schema.Array(Run).check(Schema.isMinLength(1), Schema.isMaxLength(8));

/** [height, front runs, side runs] in sheet units. */
const Row = Schema.Tuple([bounded(-4, 4), Runs, Runs]);

/** [centre, feet, scale] of one view panel, as fractions of the panel. */
const Frame = Schema.Tuple([bounded(0, 4), bounded(0, 4), bounded(0, 4)]);

export const FigureHull = Schema.Struct({
  /** Standing height in metres that one sheet span represents. */
  height: bounded(0.05, 12),
  /** Traced rows, ascending in height. */
  rows: Schema.Array(Row).check(
    Schema.isMinLength(2),
    Schema.isMaxLength(128),
    Schema.makeFilter(
      (rows: ReadonlyArray<readonly [number, unknown, unknown]>) =>
        rows.every((r, i) => i === 0 || r[0] > (rows[i - 1]?.[0] ?? r[0])) ||
        "Hull rows must rise strictly in height.",
    ),
  ),
  /** The volume's origin in sheet units. */
  pivot: Vec3Between(-4, 4),
  /** Front, side, back and other side view frames. */
  frames: Schema.Tuple([Frame, Frame, Frame, Frame]),
  /** Marching-cubes cells along each axis. */
  resolution: Schema.Int.check(Schema.isBetween({ minimum: 16, maximum: 96 })),
  /** Mirrored across x, as a copied left or right side is. */
  mirrored: Schema.optionalKey(Schema.Boolean),
  /** A thin continuous sheet along the longer axis instead of per-row depth. */
  membrane: Schema.optionalKey(
    Schema.Struct({
      slope: Schema.Literals([-1, 1]),
      thickness: bounded(0.001, 0.2),
    }),
  ),
});
export type FigureHull = typeof FigureHull.Type;

export const figureHull = family({
  id: "figure.hull",
  version: 1,
  scope: "part",
  schema: FigureHull,
  toJson: (v) => v,
});
