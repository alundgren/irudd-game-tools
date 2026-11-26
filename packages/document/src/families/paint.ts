// Paint family: turnaround painting of swept parts.
//
//   figure.paint      part      how a painted part was traced on its sheet
//   figure.occluders  document  traced regions that still occlude after their parts are gone
//
// A painted part names its sheet in the core `paint.atlas` field, a content
// digest declared in `assets`; `figure.paint` holds the rest binding the
// texture is baked from. The binding is the traced rest pose, not the part's
// current geometry, so moving, resizing or re-knotting the part keeps its
// paint attached. Repainting replaces only the atlas digest.
//
// Regional visibility on a sheet is computed from every binding of that
// sheet: painted parts and occluders. An occluder keeps a removed or replaced
// part's region claiming its pixels, so its neighbours never sample them.
// Occluders are listed once per sheet and region, ordered by sheet digest and
// then region name (code-unit order), so a document has one form: the order
// never affects the build, which sorts regions itself.

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

/**
 * Facial landmarks registered on the front view, in head heights from the
 * chin row: the eye line, nose tip, lip centre and chin, the face's centre
 * and half width across. Ported from the checks in character-view/recipe.js.
 */
export const PortraitLandmarks = Schema.Struct({
  center: bounded(-0.4, 0.4),
  width: bounded(0.08, 0.8),
  eyes: Schema.Finite.check(Schema.isLessThan(1)),
  nose: Schema.Finite,
  mouth: Schema.Finite,
  chin: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  /**
   * The head's span within the traced region, as fractions of the binding
   * height: its base, its height and its centre across. Absent: the landmarks
   * use the binding's own height and offset.
   */
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
  /** The traced region's name on its sheet. Absent: the part samples the sheet without regional visibility. */
  region: Schema.optionalKey(Region),
  /** Standing height in metres that one sheet span represents. */
  height: bounded(0.05, 12),
  /** Rest pivot of the traced sections, in metres from the sheet's feet and centre. */
  offset: Vec3Between(-12, 12),
  /** Rest cross sections relative to `offset`: [x, y, z, width radius, depth radius]. */
  rest: Schema.Array(Knot).check(Schema.isMinLength(2), Schema.isMaxLength(96)),
  /** Weight of the side views against the front and back. Defaults to 1. */
  profile: Schema.optionalKey(bounded(0, 4)),
  /**
   * Cross sections follow the sweep's path, as a tail traced along its curve
   * is. Absent: level sections, as a body traced standing is.
   */
  frame: Schema.optionalKey(Schema.Literal("path")),
  /** A traced face: its landmarks. Only a part with figure.anatomy face may carry them. */
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

/** Canonical occluder order: by sheet digest, then region name, in code units. */
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
