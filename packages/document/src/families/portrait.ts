// figure.portrait-depth and figure.hair-cap: a traced portrait's depth and the
// hair painted on it. Ported from validPins in character-view/depth-pins.js,
// validDepth in character-view/portrait-depth.js, validHairCap in
// character-view/portrait-hair.js and their checks in
// character-view/recipe.js at 2761eb1.
//
// A portrait depth refines a painted sweep's traced front by up to 24 paired
// depth landmarks, each [x, y, z, radius] in metres in the sweep's frame, and,
// on a traced face (or the source hair cut from one), by a fitted grayscale
// depth field: 144 by 160 bytes from the binding's left edge to its right and
// from its feet upward, base64 encoded, blended in by `mix`. The binding the
// paint bakes from carries the same depth, so the texture stays registered.
//
// A hair cap separates the hair painted on a face: `mask` gives the hair's
// coverage and `relief` its locks, each 128 by 96 bytes over the surface's
// UV layout, base64 encoded. The head beneath recedes; the hair becomes a
// removable shell over it, and the textured scalp under the hairline takes
// the `scalp` colour. A cap marked `sourceOnly` sits on a hair layer of the
// same trace instead: that part keeps only the hair, seated on the head it
// lies over.

import { Schema } from "effect";
import { bounded, family, Hex } from "./family.js";

/** Base64 of exactly `bytes` bytes, as the legacy editor writes it: no padding, no line breaks. */
const packed = (bytes: number) =>
  Schema.String.check(
    Schema.makeFilter(
      (s: string) =>
        (s.length === (bytes * 4) / 3 && /^[A-Za-z0-9+/]+$/.test(s)) ||
        `Use base64 of exactly ${bytes} bytes.`,
    ),
  );

/** Width and height in samples of a fitted depth field. */
export const depthFieldSize = [144, 160] as const;
/** Width and height in samples of a hair cap's mask and relief. */
export const hairCapSize = [128, 96] as const;

const place = bounded(-12, 12);
export const DepthPin = Schema.Tuple([place, place, place, bounded(0.001, 2)]);
export type DepthPin = typeof DepthPin.Type;

export const DepthField = Schema.Struct({
  mix: bounded(0, 1),
  values: packed(depthFieldSize[0] * depthFieldSize[1]),
});
export type DepthField = typeof DepthField.Type;

export const PortraitDepth = Schema.Struct({
  pins: Schema.optionalKey(Schema.Array(DepthPin).check(Schema.isMaxLength(24))),
  field: Schema.optionalKey(DepthField),
}).check(
  Schema.makeFilter(
    (d) => d.pins !== undefined || d.field !== undefined || "Give depth pins, a field or both.",
  ),
);
export type PortraitDepth = typeof PortraitDepth.Type;

export const figurePortraitDepth = family({
  id: "figure.portrait-depth",
  version: 1,
  scope: "part",
  schema: PortraitDepth,
  toJson: (v) => v,
});

export const HairCap = Schema.Struct({
  scalp: Hex,
  mask: packed(hairCapSize[0] * hairCapSize[1]),
  relief: packed(hairCapSize[0] * hairCapSize[1]),
  sourceOnly: Schema.optionalKey(Schema.Literal(true)),
});
export type HairCap = typeof HairCap.Type;

export const figureHairCap = family({
  id: "figure.hair-cap",
  version: 1,
  scope: "part",
  schema: HairCap,
  toJson: (v) => v,
});
