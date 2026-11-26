import { Schema } from "effect";
import { bounded, family } from "./family.js";

export const FigureHand = Schema.Struct({
  fingers: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 6 }))),
  curl: Schema.optionalKey(bounded(0, 1)),
  spread: Schema.optionalKey(bounded(0, 1)),
  side: Schema.optionalKey(Schema.Literals([-1, 1])),
  relaxed: Schema.optionalKey(Schema.Boolean),
  cylindrical: Schema.optionalKey(Schema.Boolean),
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
