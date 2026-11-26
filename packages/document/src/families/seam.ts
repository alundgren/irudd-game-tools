// Classic figure surfaces: joined seam groups, local surface pulls and foot
// sections. Ported from the seamGroup, pulls and footSection checks of
// validateForm in character-view/recipe.js at 2761eb1, with the same bounds.
//
//   figure.seam   part  join this sweep with the other sweeps of its group
//   figure.pulls  part  bounded local offsets of the part's own surface
//   figure.foot   part  a sweep's ground-contact cross section
//
// The builders check what spans families: a seam or foot section needs a
// sweep, a bare foot four knots, and a group at most 48 regions.

import { Schema } from "effect";
import { bounded, family, Vec3Between } from "./family.js";

/**
 * The layers a classic figure is joined in: its skin, its top and bottom
 * garments, and each bare foot with its toes.
 */
export const seamGroups = ["figure", "top", "bottom", "left foot", "right foot"] as const;
export type SeamGroup = (typeof seamGroups)[number];

/** At most this many regions join in one seam group, as G0 allows. */
export const seamGroupLimit = 48;

export const FigureSeam = Schema.Struct({ group: Schema.Literals(seamGroups) });
export type FigureSeam = typeof FigureSeam.Type;

export const figureSeam = family({
  id: "figure.seam",
  version: 1,
  scope: "part",
  schema: FigureSeam,
  toJson: (v) => v,
});

/**
 * One pull in the part's own frame: points within `reach` of `at` (an
 * ellipsoid, one radius per local axis) move by up to `offset`, falling off
 * smoothly. With `mirrorX`, the pull is repeated mirrored across that plane,
 * its x offset reversed, without doubling where the two overlap.
 */
export const SurfacePull = Schema.Struct({
  at: Vec3Between(-24, 24),
  reach: Vec3Between(0.001, 20),
  offset: Vec3Between(-4, 4),
  mirrorX: Schema.optionalKey(bounded(-24, 24)),
});
export type SurfacePull = typeof SurfacePull.Type;

export const FigurePulls = Schema.Struct({
  pulls: Schema.Array(SurfacePull).check(Schema.isMinLength(1), Schema.isMaxLength(64)),
});
export type FigurePulls = typeof FigurePulls.Type;

export const figurePulls = family({
  id: "figure.pulls",
  version: 1,
  scope: "part",
  schema: FigurePulls,
  toJson: (v) => v,
});

/**
 * A bare foot is flattened underneath and, when its toes show in the same
 * seam group, ends at the ball of the foot; a shoe upper is flattened
 * underneath; a sole is flatter still all round.
 */
export const footSections = ["bare", "upper", "sole"] as const;
export type FootSectionName = (typeof footSections)[number];

export const FigureFoot = Schema.Struct({ section: Schema.Literals(footSections) });
export type FigureFoot = typeof FigureFoot.Type;

export const figureFoot = family({
  id: "figure.foot",
  version: 1,
  scope: "part",
  schema: FigureFoot,
  toJson: (v) => v,
});
