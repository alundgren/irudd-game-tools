// figure.anatomy: a swept part that is a recognised anatomical region.
//
// Ported from the anatomy field character-view/model.js reads at 2761eb1. A
// face is built from denser cross sections, sculpted against the portrait
// landmarks of its paint binding, and exported as its own skinned mesh with
// Blink, Smile and BrowLift expressions. A neck has no effect on a sweep; it
// tells a built-in head above it to drop its own neck. Builders require a
// figure.sweep.

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
