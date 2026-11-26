import { Schema } from "effect";
import { bounded, family, Vec3Between } from "./family.js";

export const seamGroups = ["figure", "top", "bottom", "left foot", "right foot"] as const;
export type SeamGroup = (typeof seamGroups)[number];

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

export const figureLocations = family({
  id: "figure.locations",
  version: 1,
  scope: "part",
  schema: Schema.Struct({
    marks: Schema.Array(
      Schema.Struct({
        name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(48)),
        at: Vec3Between(-24, 24),
      }),
    ).check(Schema.isMaxLength(12)),
  }),
  toJson: (v) => v,
});

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
