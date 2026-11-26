import { Schema } from "effect";
import { family } from "./family.js";

export const FigureAnatomy = Schema.Struct({
  region: Schema.Literals(["face", "neck"]),
});
export type FigureAnatomy = typeof FigureAnatomy.Type;

export const figureAnatomy = family({
  id: "figure.anatomy",
  version: 1,
  scope: "part",
  schema: FigureAnatomy,
  toJson: (v) => v,
});
