// figure.wing: the lifting surface of a wing, grown from one short
// description. Ported from validWing in character-view/wing-surface.js at
// 2761eb1.
//
// `structure` says what carries the surface: a bat wing is skin between an
// arm and `count` long fingers, a feathered wing `count` primaries on a
// folded arm, an insect wing a pleated film on `count` branching veins. The
// surface is drawn in its own flat frame: `span` runs from the shoulder to
// the tip, `back` back along the body, and `side` (1 left, -1 right)
// mirrors it. `bone` is the arm's radius in metres; `bend`, `notch` and
// `point` shape the arm, the trailing edge and the tip; `pattern` lays
// `dark` and `pale` pigment over it and `limb` colours its bones and
// coverts. The same description, seed included, always grows the same wing.
// The part's own colour is the surface's main colour.

import { Schema } from "effect";
import { family, Hex } from "./family.js";

export const wingSurfaceStructures = ["bat", "feather", "insect"] as const;
export const wingSurfacePatterns = ["none", "tips", "bars", "eyespot"] as const;

const direction = (least: number) =>
  Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite]).check(
    Schema.makeFilter(
      (v: readonly [number, number, number]) =>
        (v.every((n) => Math.abs(n) <= 12) && Math.hypot(...v) >= least) ||
        `Each coordinate is within 12 m and the vector is at least ${least} m long.`,
    ),
  );
const unit = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }));

export const FigureWing = Schema.Struct({
  structure: Schema.Literals(wingSurfaceStructures),
  side: Schema.Literals([1, -1]),
  span: direction(0.01),
  back: direction(0.005),
  bone: Schema.Finite.check(Schema.isBetween({ minimum: 0.0005, maximum: 1 })),
  bend: unit,
  notch: unit,
  point: unit,
  count: Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 12 })),
  pattern: Schema.Literals(wingSurfacePatterns),
  seed: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 0xffffffff })),
  dark: Hex,
  pale: Hex,
  limb: Hex,
});
export type FigureWing = typeof FigureWing.Type;

export const figureWing = family({
  id: "figure.wing",
  version: 1,
  scope: "part",
  schema: FigureWing,
  toJson: (v) => v,
});
