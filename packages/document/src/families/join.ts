import { Schema } from "effect";
import { bounded, family } from "./family.js";

export const joinEnds = ["first", "last", "both", "along", "base"] as const;

const Face = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 }));

export const FigureJoin = Schema.Struct({
  depth: bounded(0.001, 0.08),
  end: Schema.optionalKey(Schema.Literals(joinEnds)),
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
