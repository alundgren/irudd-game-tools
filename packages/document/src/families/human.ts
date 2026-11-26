import { Schema } from "effect";
import { Digest } from "../schema.js";
import { family } from "./family.js";

export const FigureScapulaMount = Schema.Struct({
  side: Schema.Literals([1, -1]),
});
export type FigureScapulaMount = typeof FigureScapulaMount.Type;

export const figureScapulaMount = family({
  id: "figure.scapula-mount",
  version: 1,
  scope: "part",
  schema: FigureScapulaMount,
  toJson: (v) => v,
});

export const FigureNativePortrait = Schema.Struct({
  layer: Digest,
});
export type FigureNativePortrait = typeof FigureNativePortrait.Type;

export const figureNativePortrait = family({
  id: "figure.native-portrait",
  version: 1,
  scope: "part",
  schema: FigureNativePortrait,
  toJson: (v) => v,
  references: (v) => [
    { kind: "asset" as const, id: v.layer, path: ["layer"], role: "portrait-plate" },
  ],
});
