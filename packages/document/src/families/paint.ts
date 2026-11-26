import { Schema } from "effect";
import { Digest } from "../schema.js";
import { bounded, family, Vec3Between } from "./family.js";
import { Knot } from "./figure.js";

const Region = Schema.String.check(
  Schema.makeFilter(
    (s: string) =>
      (s.length >= 1 && s.length <= 120 && s.trim() === s) ||
      "Use a region name of 1 to 120 characters without surrounding spaces.",
  ),
);

export const PortraitLandmarks = Schema.Struct({
  center: bounded(-0.4, 0.4),
  width: bounded(0.08, 0.8),
  eyes: Schema.Finite.check(Schema.isLessThan(1)),
  nose: Schema.Finite,
  mouth: Schema.Finite,
  chin: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  frame: Schema.optionalKey(
    Schema.Struct({
      base: bounded(-0.05, 1),
      span: bounded(0.018, 1.1),
      centerX: bounded(-4, 4),
    }),
  ),
}).check(
  Schema.makeFilter(
    (f) =>
      (f.chin < f.mouth && f.mouth < f.nose && f.nose < f.eyes) ||
      "Facial landmarks must rise from chin to mouth, nose and eyes.",
  ),
);
export type PortraitLandmarks = typeof PortraitLandmarks.Type;

const bindingFields = {
  region: Schema.optionalKey(Region),
  height: bounded(0.05, 12),
  offset: Vec3Between(-12, 12),
  rest: Schema.Array(Knot).check(Schema.isMinLength(2), Schema.isMaxLength(96)),
  profile: Schema.optionalKey(bounded(0, 4)),
  frame: Schema.optionalKey(Schema.Literal("path")),
  portrait: Schema.optionalKey(PortraitLandmarks),
};

export const FigurePaint = Schema.Struct(bindingFields);
export type FigurePaint = typeof FigurePaint.Type;

export const figurePaint = family({
  id: "figure.paint",
  version: 1,
  scope: "part",
  schema: FigurePaint,
  toJson: (v) => v,
});

export const PaintSource = Schema.Struct({
  atlas: Digest,
  ...bindingFields,
  region: Region,
});
export type PaintSource = typeof PaintSource.Type;

export function occluderOrder(
  a: { readonly atlas: string; readonly region: string },
  b: { readonly atlas: string; readonly region: string },
): number {
  if (a.atlas !== b.atlas) return a.atlas < b.atlas ? -1 : 1;
  if (a.region !== b.region) return a.region < b.region ? -1 : 1;
  return 0;
}

export const FigureOccluders = Schema.Struct({
  sources: Schema.Array(PaintSource).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(256),
    Schema.makeFilter(
      (sources: ReadonlyArray<PaintSource>) =>
        sources.every((s, i) => i === 0 || occluderOrder(sources[i - 1] ?? s, s) < 0) ||
        "List each sheet and region once, ordered by sheet digest and then region name.",
    ),
  ),
});
export type FigureOccluders = typeof FigureOccluders.Type;

export const figureOccluders = family({
  id: "figure.occluders",
  version: 1,
  scope: "document",
  schema: FigureOccluders,
  toJson: (v) => v,
  references: (v) =>
    v.sources.map((s, i) => ({
      kind: "asset" as const,
      id: s.atlas,
      path: ["sources", i, "atlas"],
    })),
});
