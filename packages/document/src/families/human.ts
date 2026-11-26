// Parts an adult human carries beyond its generated regions.
//
//   figure.scapula-mount  part  a limb root seated on one shoulder blade of the
//                               adult's chest, as G0's attachCreatureLimbs seats
//                               a pair of wings (character-view/human-creature-mount.js
//                               at 2761eb1): `side` 1 is the left blade, -1 the right.
//
// A steer of the adult's measurements moves the root with its blade, so the
// wings stay seated on the back (reseatCreatureLimbs in the same file).
//
//   figure.native-portrait  part  a baked photographic skin layer on the
//                                  adult's own head (below)

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

/**
 * figure.native-portrait  part  the skin layer G0's editor baked onto an
 * adult's own head from a front and a profile photograph (bakeNativePortrait in
 * character-view/native-portrait.js at 2761eb1). The plate is that bake: a
 * 1024 × 1120 raster in the face paint's layout whose colour is the photos'
 * variation around a neutral 128 and whose alpha is its mask. The textured
 * presets add it over the adult's painted face in the current skin tone, so it
 * follows a change of skin; the head's shape and eyes are unchanged.
 */
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
