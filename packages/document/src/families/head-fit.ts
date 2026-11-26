// figure.front-fit, figure.profile-fit and figure.head-layer: the fits that
// match a face to a portrait, and hair laid over a head.
//
// Ported from validFrontFit in character-view/front-fit.js, validProfile in
// character-view/profile-fit.js and the headLayer field of
// character-view/recipe.js at 2761eb1.
//
// A front fit warps a face (a built-in head's or a face sweep's) by up to six
// successive passes. Each pass pairs landmarks `at` in head-height units,
// centred on the face's bounds (+X to the character's left, +Y up, +Z
// forward), with the shift that moves each to its traced place. A pass with a
// view is measured on a head-centred orthographic orbit; in depth mode it
// corrects only anatomical depth. A profile fit traces the side contour from
// the brow (t = 0) down to the lower chin (t = 1), as forward depth from the
// brow in units of brow-to-chin height. A head layer of hair hides when the
// head it is laid on grows a groom. Face hardware such as spectacles shares a
// rigid anchor, in the same head-height units, and follows that point
// through each fit; a front piece with a clearance is lifted clear of the
// fitted face, its supports tapering back to where they rest on the head.
//
// Portrait plates (version 2 of both fits) are raster assets of the
// `portrait-plate` role, from the overlay and profileFit.paint fields of
// character-view/recipe.js. A front pass's plate is a paint layer in the
// face's UV layout, drawn over the face in pass order once the fits are done.
// A finishing profile's side plate is a side photograph registered by its
// brow, ear and chin, sampled onto the face's sides and the ears after the
// side contour is fitted. Version 1 payloads are the same without plates.

import { Schema } from "effect";
import { Digest } from "../schema.js";
import type { FeatureReference } from "../registry.js";
import { bounded, family, Hex, Vec3Between } from "./family.js";

const coordinate = bounded(-6, 6);
const correction = bounded(-0.35, 0.35);

export const FrontFitView = Schema.Struct({
  yaw: bounded(-180, 180),
  pitch: bounded(-80, 80),
  mode: Schema.Literals(["plane", "depth"]),
  /** In depth mode, mirror each correction across anatomical X. */
  symmetric: Schema.optionalKey(Schema.Boolean),
}).check(
  Schema.makeFilter((v) => {
    if (v.symmetric !== undefined && v.mode !== "depth")
      return "Only a depth pass can be symmetric.";
    if (v.mode !== "depth") return true;
    const yaw = (v.yaw * Math.PI) / 180;
    const pitch = (v.pitch * Math.PI) / 180;
    const rightZ = -Math.sin(yaw);
    const upZ = -Math.cos(yaw) * Math.sin(pitch);
    return (
      Math.hypot(rightZ, upZ) >= 0.34 ||
      "Turn the head at least 20 degrees from the front to measure depth."
    );
  }),
);
export type FrontFitView = typeof FrontFitView.Type;

export const FrontFitPin = Schema.Struct({
  at: Schema.Tuple([coordinate, coordinate, coordinate]),
  shift: Schema.Tuple([correction, correction]),
});
export type FrontFitPin = typeof FrontFitPin.Type;

export const FrontFitPass = Schema.Struct({
  pins: Schema.Array(FrontFitPin).check(
    Schema.isMinLength(3),
    Schema.isMaxLength(32),
    Schema.makeFilter(
      (pins) =>
        pins.every((p, i) =>
          pins.slice(0, i).every((q) => Math.hypot(q.at[0] - p.at[0], q.at[1] - p.at[1]) > 0.008),
        ) || "Space the landmarks apart.",
    ),
  ),
  radius: bounded(0.1, 0.65),
  amount: bounded(0, 1),
  view: Schema.optionalKey(FrontFitView),
  /** A front portrait plate: a paint layer in the face's UV layout. */
  plate: Schema.optionalKey(Digest),
});
export type FrontFitPass = typeof FrontFitPass.Type;

export const FigureFrontFit = Schema.Struct({
  passes: Schema.Array(FrontFitPass).check(Schema.isMinLength(1), Schema.isMaxLength(6)),
});
export type FigureFrontFit = typeof FigureFrontFit.Type;

const plate = (id: Digest, path: FeatureReference["path"]): FeatureReference => ({
  kind: "asset",
  id,
  path,
  role: "portrait-plate",
});

export const figureFrontFit = family({
  id: "figure.front-fit",
  version: 2,
  // Version 2 adds the optional front plate; version 1 passes read unchanged.
  upgrades: [(payload) => payload],
  scope: "part",
  schema: FigureFrontFit,
  toJson: (v) => v,
  references: (v) =>
    v.passes.flatMap((pass, i) => (pass.plate ? [plate(pass.plate, ["passes", i, "plate"])] : [])),
});

const unit = bounded(0, 1);

/** A side photograph registered by its brow, ear and lower chin, in image fractions. */
export const SidePlate = Schema.Struct({
  plate: Digest,
  /** The way the photographed face looks. */
  facing: Schema.Literals(["right", "left"]),
  brow: Schema.Tuple([unit, unit]),
  ear: Schema.Tuple([unit, unit]),
  chinY: unit,
}).check(
  Schema.makeFilter((p) => {
    if (!(p.chinY > p.brow[1] + 0.025)) return "Mark the chin below the brow.";
    return (
      (p.facing === "right" ? 1 : -1) * (p.brow[0] - p.ear[0]) > 0.02 ||
      "Mark the ear behind the brow, in the direction the face looks."
    );
  }),
);
export type SidePlate = typeof SidePlate.Type;

export const FigureProfileFit = Schema.Struct({
  curve: Schema.Array(Schema.Tuple([Schema.Finite, bounded(-1, 1)])).check(
    Schema.isMinLength(4),
    Schema.isMaxLength(96),
    Schema.makeFilter((c) => {
      const first = c[0];
      const last = c.at(-1);
      return (
        (first !== undefined &&
          last !== undefined &&
          first[0] === 0 &&
          first[1] === 0 &&
          last[0] === 1 &&
          c.every((p, i) => i === 0 || p[0] > (c[i - 1]?.[0] ?? Infinity))) ||
        "Trace the profile downwards from the brow at [0, 0] to the chin at t = 1."
      );
    }),
  ),
  amount: bounded(0, 1),
  /** "finish": the side contour is the final depth constraint, after the front fits. */
  stage: Schema.optionalKey(Schema.Literals(["finish"])),
  /** A finishing trace's rebuild of nose and cheek depth against the contour. */
  relief: Schema.optionalKey(bounded(0, 1)),
  /** A finishing trace's side portrait plate. */
  side: Schema.optionalKey(SidePlate),
}).check(
  Schema.makeFilter(
    (f) => f.relief === undefined || f.stage === "finish" || "Only a finishing trace has relief.",
  ),
  Schema.makeFilter(
    (f) =>
      f.side === undefined || f.stage === "finish" || "Only a finishing trace has a side plate.",
  ),
);
export type FigureProfileFit = typeof FigureProfileFit.Type;

export const figureProfileFit = family({
  id: "figure.profile-fit",
  version: 2,
  // Version 2 adds the optional side plate; version 1 traces read unchanged.
  upgrades: [(payload) => payload],
  scope: "part",
  schema: FigureProfileFit,
  toJson: (v) => v,
  references: (v) => (v.side ? [plate(v.side.plate, ["side", "plate"])] : []),
});

export const FigureHeadLayer = Schema.Struct({ layer: Schema.Literals(["hair"]) });
export type FigureHeadLayer = typeof FigureHeadLayer.Type;

export const figureHeadLayer = family({
  id: "figure.head-layer",
  version: 1,
  scope: "part",
  schema: FigureHeadLayer,
  toJson: (v) => v,
});

export const FigureFaceAnchor = Schema.Struct({
  anchor: Vec3Between(-6, 6),
  /** Metres a rigid front piece keeps clear of the face. */
  clearance: Schema.optionalKey(bounded(0.001, 0.025)),
});
export type FigureFaceAnchor = typeof FigureFaceAnchor.Type;

export const figureFaceAnchor = family({
  id: "figure.face-anchor",
  version: 1,
  scope: "part",
  schema: FigureFaceAnchor,
  toJson: (v) => v,
});

const contour = (sign: 1 | -1) =>
  Schema.Array(bounded(-0.07, 0.07)).check(
    Schema.isMinLength(9),
    Schema.isMaxLength(9),
    Schema.makeFilter(
      (c) => c.every((n) => n * sign >= 0) || "Upper lid contours rise and lower ones fall.",
    ),
  );

/**
 * figure.eyes: fitted eyes over a face, from validEyes in
 * character-view/ocular.js at 2761eb1. Ocular surfaces, lids that blink and
 * an iris with four gaze morphs, placed on the face's eye line and scaled by
 * the settings. With `source` the painted iris itself moves inside the
 * measured opening; the measured pupil offsets and lid contours keep clay and
 * textured geometry the same.
 */
export const FigureEyes = Schema.Struct({
  color: Hex,
  opening: bounded(0.42, 1.8),
  width: bounded(0.62, 1.6),
  spacing: bounded(0.7, 1.3),
  lift: bounded(-0.1, 0.1),
  iris: bounded(0.55, 1.45),
  /** "finish": the eyes are fitted after the face's other fits. */
  stage: Schema.optionalKey(Schema.Literals(["finish"])),
  source: Schema.optionalKey(Schema.Boolean),
  /** Each eye's measured lid edges, nine samples across, upper then lower. */
  contours: Schema.optionalKey(
    Schema.Tuple([
      Schema.Struct({ upper: contour(1), lower: contour(-1) }),
      Schema.Struct({ upper: contour(1), lower: contour(-1) }),
    ]),
  ),
  /** Each pupil's measured offset in head heights, right eye first. */
  offsets: Schema.optionalKey(
    Schema.Tuple([
      Schema.Tuple([bounded(-0.09, 0.09), bounded(-0.09, 0.09)]),
      Schema.Tuple([bounded(-0.09, 0.09), bounded(-0.09, 0.09)]),
    ]),
  ),
});
export type FigureEyes = typeof FigureEyes.Type;

export const figureEyes = family({
  id: "figure.eyes",
  version: 1,
  scope: "part",
  schema: FigureEyes,
  toJson: (v) => v,
});
