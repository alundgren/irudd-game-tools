import { Schema } from "effect";
import { bounded, family, Hex } from "./family.js";

const packed = (bytes: number) =>
  Schema.String.check(
    Schema.makeFilter(
      (s: string) =>
        (s.length === (bytes * 4) / 3 && /^[A-Za-z0-9+/]+$/.test(s)) ||
        `Use base64 of exactly ${bytes} bytes.`,
    ),
  );

export const depthFieldSize = [144, 160] as const;
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
