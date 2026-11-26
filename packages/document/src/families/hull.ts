import { Schema } from "effect";
import { bounded, family, Vec3Between } from "./family.js";

const Run = Schema.Tuple([bounded(-4, 4), bounded(-4, 4)]).check(
  Schema.makeFilter(([a, b]) => a <= b || "A run must not end before it starts."),
);
const Runs = Schema.Array(Run).check(Schema.isMinLength(1), Schema.isMaxLength(8));

const Row = Schema.Tuple([bounded(-4, 4), Runs, Runs]);

const Frame = Schema.Tuple([bounded(0, 4), bounded(0, 4), bounded(0, 4)]);

export const FigureHull = Schema.Struct({
  height: bounded(0.05, 12),
  rows: Schema.Array(Row).check(
    Schema.isMinLength(2),
    Schema.isMaxLength(128),
    Schema.makeFilter(
      (rows: ReadonlyArray<readonly [number, unknown, unknown]>) =>
        rows.every((r, i) => i === 0 || r[0] > (rows[i - 1]?.[0] ?? r[0])) ||
        "Hull rows must rise strictly in height.",
    ),
  ),
  pivot: Vec3Between(-4, 4),
  frames: Schema.Tuple([Frame, Frame, Frame, Frame]),
  resolution: Schema.Int.check(Schema.isBetween({ minimum: 16, maximum: 96 })),
  mirrored: Schema.optionalKey(Schema.Boolean),
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
