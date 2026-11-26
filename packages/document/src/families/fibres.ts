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
