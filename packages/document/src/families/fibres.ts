// figure.fibres: individually rooted fibres grown along a sweep, from
// validFibres and acceptsFibres in character-view/guide-fibres.js at 2761eb1.
//
// The sweep is a guide, read after fitting and sculpting: it is replaced by
// `count` strands that follow its rings, waving by `wave`, trailing past its
// end by `fall` of its length and greying a `grey` share of strands. Rooted
// strands start on the parent's surface. The same seed always grows the same
// strands. Only an unpainted, unjoined-skin sweep that is not a garment, a
// hand or a face takes fibres.

import { Schema } from "effect";
import { bounded, family } from "./family.js";

export const FigureFibres = Schema.Struct({
  count: Schema.Int.check(Schema.isBetween({ minimum: 4, maximum: 96 })),
  wave: bounded(0, 1),
  fall: bounded(0, 1),
  grey: bounded(0, 1),
  rooted: Schema.Boolean,
  seed: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 0xffffffff })),
});
export type FigureFibres = typeof FigureFibres.Type;

export const figureFibres = family({
  id: "figure.fibres",
  version: 1,
  scope: "part",
  schema: FigureFibres,
  toJson: (v) => v,
});
