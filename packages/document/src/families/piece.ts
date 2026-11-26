// figure.piece and figure.sculpt: the built-in figure's body pieces, and face
// sculpt multipliers.
//
// Ported from baseParts and createCharacter in character-view/model.js at
// 2761eb1. A piece is one of the legacy editor's six anatomical regions, built
// from the document's appearance (or the piece's own look) in place of the
// primitive: the torso, a head with its neck, ears, painted face and hair, an
// arm with its hand, or a leg with its boot. Its position is an anatomical
// pivot and its size a local scale. An adult cranial profile sets the ears and
// hair back and gives the skull a longer rear.
//
// A sculpt moves a built-in head's face, or a swept face's, by the
// appearance's multipliers and then the part's own.

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
  /** Appearance of this piece instead of the document's. */
  look: Schema.optionalKey(Appearance),
  /** A head's skull and the placement of its ears and hair. */
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
