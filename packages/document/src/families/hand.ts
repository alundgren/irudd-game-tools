// figure.hand: a hand or paw with jointed digits.
//
// Ported from the grip handGeometry reads in character-view/hands.js at
// 2761eb1. The builder fills a palm and digit chains into one surface and
// gives every digit three joints of its own.

import { Schema } from "effect";
import { bounded, family } from "./family.js";

export const FigureHand = Schema.Struct({
  /** Digits besides the thumb. Defaults to 4. */
  fingers: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 6 }))),
  /** How far the digits bend toward the palm, 0 open to 1 closed. Defaults to 0.15. */
  curl: Schema.optionalKey(bounded(0, 1)),
  /** How far the digits fan apart. Defaults to 0.2. */
  spread: Schema.optionalKey(bounded(0, 1)),
  /** 1 for a left hand, -1 for a right one, mirrored across x. Defaults to 1. */
  side: Schema.optionalKey(Schema.Literals([-1, 1])),
  /** A hanging human hand: staggered knuckles and more flexion toward the little finger. */
  relaxed: Schema.optionalKey(Schema.Boolean),
  /** Closed around a handle that crosses the palm. */
  cylindrical: Schema.optionalKey(Schema.Boolean),
  /** A padded paw or a raptor's curled talons instead of a hand. */
  pad: Schema.optionalKey(Schema.Literals(["hand", "paw", "talon"])),
});
export type FigureHand = typeof FigureHand.Type;

export const figureHand = family({
  id: "figure.hand",
  version: 1,
  scope: "part",
  schema: FigureHand,
  toJson: (v) => v,
});
