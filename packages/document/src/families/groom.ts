import { Schema } from "effect";
import { bounded, family, Hex } from "./family.js";

export const groomPatterns = ["Locks", "Side part", "Coils", "Braids", "Locs"] as const;

export const FigureGroom = Schema.Struct({
  pattern: Schema.optionalKey(Schema.Literals(groomPatterns)),
  length: bounded(0, 2),
  curl: bounded(0, 1),
  gather: bounded(0, 1),
  sweep: bounded(-1, 1),
  volume: bounded(0, 1),
  part: Schema.optionalKey(bounded(-1, 1)),
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
