import { SectionProfile } from "./figure-recipe.js";
import { Schema } from "effect";
import type { Vec3 } from "../geometry.js";
import { PartId, Position, Rotation, Size } from "../schema.js";
import { bounded, family, Hex, Vec3Between } from "./family.js";

export const finishes = [
  "plain",
  "canvas",
  "satin",
  "leather",
  "metal",
  "scales",
  "horn",
  "fur",
  "jacket",
] as const;
export const Finish = Schema.Literals(finishes);
export type Finish = typeof Finish.Type;

export const FigureAssembly = Schema.Struct({
  order: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4095 })),
  frameSize: Schema.optionalKey(Vec3Between(0.005, 12)),
});
export type FigureAssembly = typeof FigureAssembly.Type;

export function figureChildBasis(assembly: FigureAssembly, size: Vec3): Vec3 {
  const f = assembly.frameSize;
  return f ? [size[0] / f[0], size[1] / f[1], size[2] / f[2]] : size;
}

export const figureAssembly = family({
  id: "figure.assembly",
  version: 1,
  scope: "part",
  schema: FigureAssembly,
  toJson: (v) => v,
  childBasis: figureChildBasis,
});

export const Knot = Schema.Tuple([
  bounded(-8, 8),
  bounded(-8, 8),
  bounded(-8, 8),
  bounded(0.0001, 4),
  bounded(0.00005, 4),
]);
export type Knot = typeof Knot.Type;

const distinctKnots = (knots: ReadonlyArray<Knot>): boolean =>
  knots.every((k, i) => {
    const prev = knots[i - 1];
    return (
      prev === undefined ||
      Math.abs(k[0] - prev[0]) > 0.00001 ||
      Math.abs(k[1] - prev[1]) > 0.00001 ||
      Math.abs(k[2] - prev[2]) > 0.00001
    );
  });

export const FigureSweep = Schema.Struct({
  radialFit: Schema.optionalKey(
    Schema.Struct({
      bottom: bounded(-3, 3),
      step: bounded(0.003, 0.2),
      rows: Schema.Array(
        Schema.Array(bounded(-0.12, 0.12)).check(Schema.isMinLength(8), Schema.isMaxLength(64)),
      ).check(
        Schema.isMinLength(3),
        Schema.isMaxLength(48),
        Schema.makeFilter(
          (rows) =>
            rows.every(
              (row, i) =>
                row.length === rows[0]?.length &&
                ((i !== 0 && i !== rows.length - 1) || row.every((v) => v === 0)),
            ) || "Use equal radial rings with fixed end rows.",
        ),
      ),
    }),
  ),
  suckerRows: Schema.optionalKey(Schema.Literals([0, 1, 2])),
  retainSections: Schema.optionalKey(Schema.Boolean),
  knots: Schema.Array(Knot).check(
    Schema.isMinLength(2),
    Schema.isMaxLength(48),
    Schema.makeFilter(
      (knots: ReadonlyArray<Knot>) =>
        distinctKnots(knots) || "Successive sweep knots need distinct centreline points.",
    ),
  ),
});
export type FigureSweep = typeof FigureSweep.Type;

export const FigureDrape = Schema.Struct({
  folds: Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 32 })),
  depth: bounded(0, 0.3),
  twist: bounded(-1, 1),
  slit: bounded(0, 0.35),
  slitHeight: bounded(0.05, 1),
});
export type FigureDrape = typeof FigureDrape.Type;
export const figureDrape = family({
  id: "figure.drape",
  version: 1,
  scope: "part",
  schema: FigureDrape,
  toJson: (v) => v,
});

export const figureSweep = family({
  id: "figure.sweep",
  version: 1,
  scope: "part",
  schema: FigureSweep,
  toJson: (v) => v,
});

export const FigureFinish = Schema.Struct({ surface: Finish });
export type FigureFinish = typeof FigureFinish.Type;

export const figureFinish = family({
  id: "figure.finish",
  version: 1,
  scope: "part",
  schema: FigureFinish,
  toJson: (v) => v,
});

export const FigureScute = Schema.Struct({
  mount: Schema.optionalKey(Schema.Struct({ position: Position, rotation: Rotation, size: Size })),
});
export type FigureScute = typeof FigureScute.Type;

export const figureScute = family({
  id: "figure.scute",
  version: 1,
  scope: "part",
  schema: FigureScute,
  toJson: (v) => v,
});

export const markingKinds = [
  "Bands",
  "Spots",
  "Rosettes",
  "Countershade",
  "Reticulated",
  "Marbled",
] as const;

export const FigureMarkings = Schema.Struct({
  kind: Schema.Literals(markingKinds),
  color: Hex,
  spacing: bounded(0.06, 0.8),
  coverage: bounded(0.1, 0.9),
  angle: bounded(-180, 180),
  seed: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 0xffffffff })),
});
export type FigureMarkings = typeof FigureMarkings.Type;

export const figureMarkings = family({
  id: "figure.markings",
  version: 1,
  scope: "part",
  schema: FigureMarkings,
  toJson: (v) => v,
});

export const buildAxes = ["mass", "shoulders", "waist", "belly", "hips"] as const;
const buildAxis = Schema.optionalKey(bounded(0.4, 2.4));

export const FigureBuild = Schema.Struct({
  sectionProfile: Schema.optionalKey(SectionProfile),
  mass: buildAxis,
  shoulders: buildAxis,
  waist: buildAxis,
  belly: buildAxis,
  hips: buildAxis,
  frame: Schema.Array(PartId).check(Schema.isMinLength(1), Schema.isMaxLength(512)),
});
export type FigureBuild = typeof FigureBuild.Type;

export const figureBuild = family({
  id: "figure.build",
  version: 1,
  scope: "document",
  schema: FigureBuild,
  toJson: (v) => v,
  references: (v) => v.frame.map((id, i) => ({ kind: "part" as const, id, path: ["frame", i] })),
});
