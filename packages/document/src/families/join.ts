// figure.join: a part's root seated inside its parent's surface.
//
// Ported from validSurfaceJoin in character-view/surface-join.js at 2761eb1.
// The selected patch is moved to sit `depth` metres inside the parent and
// takes the parent's joint weights, so the joint stays closed when the
// skeleton moves. Which patch depends on the part's geometry: listed cage
// faces, a sweep's ends or its whole path, or a scute's base. Builders check
// that pairing, since it spans families.

import { Schema } from "effect";
import { bounded, family } from "./family.js";

export const joinEnds = ["first", "last", "both", "along", "base"] as const;

const Face = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 }));

export const FigureJoin = Schema.Struct({
  /** How far the seated patch sits inside the parent, in metres. */
  depth: bounded(0.001, 0.08),
  /**
   * A sweep's first or last end, both ends, or its whole path ("along",
   * translated section by section to keep its thickness); "base" for a scute.
   */
  end: Schema.optionalKey(Schema.Literals(joinEnds)),
  /** Cage faces, by index into the part's figure.cage faces, that form the root. */
  faces: Schema.optionalKey(
    Schema.Array(Face).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(32),
      Schema.makeFilter(
        (faces: ReadonlyArray<number>) =>
          new Set(faces).size === faces.length || "Join faces must be distinct.",
      ),
    ),
  ),
}).check(
  Schema.makeFilter(
    (join) =>
      (join.end === undefined) !== (join.faces === undefined) ||
      "A join names either cage faces or an end.",
  ),
);
export type FigureJoin = typeof FigureJoin.Type;

export const figureJoin = family({
  id: "figure.join",
  version: 1,
  scope: "part",
  schema: FigureJoin,
  toJson: (v) => v,
});
