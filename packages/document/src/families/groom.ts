// figure.groom: rooted hair grown over a part's scalp.
//
// Ported from validGroom and groomGeometry in character-view/groom.js at
// 2761eb1. A cap follows the head's own bounds; locks, a side part, coils,
// braids or locs grow from it, drawn from a seeded sequence so the same
// groom always gives the same strands. A groom replaces any hair layer the
// part's children carry.

import { Schema } from "effect";
import { bounded, family, Hex } from "./family.js";

export const groomPatterns = ["Locks", "Side part", "Coils", "Braids", "Locs"] as const;

export const FigureGroom = Schema.Struct({
  /** How the strands are laid. Locks when absent. */
  pattern: Schema.optionalKey(Schema.Literals(groomPatterns)),
  /** Fall below the hairline, as a share of the head's height. */
  length: bounded(0, 2),
  curl: bounded(0, 1),
  /** How far the strands draw together behind the head. */
  gather: bounded(0, 1),
  /** Sideways sweep of the strands, negative to the right. */
  sweep: bounded(-1, 1),
  volume: bounded(0, 1),
  /** Where a side part or the spiral of locs and coils starts. */
  part: Schema.optionalKey(bounded(-1, 1)),
  /** How far a cropped hairline comes down the back of the skull. */
  nape: Schema.optionalKey(bounded(0, 1)),
  seed: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4294967295 })),
  color: Hex,
});
export type FigureGroom = typeof FigureGroom.Type;

export const figureGroom = family({
  id: "figure.groom",
  version: 1,
  scope: "part",
  schema: FigureGroom,
  toJson: (v) => v,
});
