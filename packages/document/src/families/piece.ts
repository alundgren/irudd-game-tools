import { Schema } from "effect";
import { family } from "./family.js";
import { Appearance, FaceSculpt } from "./appearance.js";

export const pieceNames = [
  "torso",
  "head",
  "left arm",
  "right arm",
  "left leg",
  "right leg",
] as const;
export type PieceName = (typeof pieceNames)[number];

export const FigurePiece = Schema.Struct({
  piece: Schema.Literals(pieceNames),
  look: Schema.optionalKey(Appearance),
  cranialProfile: Schema.optionalKey(Schema.Literals(["adult"])),
});
export type FigurePiece = typeof FigurePiece.Type;

export const figurePiece = family({
  id: "figure.piece",
  version: 1,
  scope: "part",
  schema: FigurePiece,
  toJson: (v) => v,
});

export const FigureSculpt = Schema.Struct({ sculpt: FaceSculpt });
export type FigureSculpt = typeof FigureSculpt.Type;

export const figureSculpt = family({
  id: "figure.sculpt",
  version: 1,
  scope: "part",
  schema: FigureSculpt,
  toJson: (v) => v,
});
