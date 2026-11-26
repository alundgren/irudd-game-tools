// Figure family: how authored parts assemble and which surface they carry.
//
//   figure.assembly  part  build order and the scaled basis its children attach in
//   figure.sweep     part  an organic surface swept along a centreline of knots
//   figure.finish    part  the material finish of a part
//   figure.scute     part  a curved armour plate in place of the primitive
//   figure.markings  part  a procedural coat pattern in the vertex colours
//   figure.build     doc   a whole-body build warp over the body's frame
//
// Attachment. The core attaches children in their parent's rigid metric frame.
// A part with figure.assembly instead attaches them in its scaled frame, as
// the legacy editor's builder does (a child is a Three.js child of its
// parent's mesh, whose scale is the parent's size):
//
//   child basis = size              without frameSize: one unit spans the whole part
//   child basis = size / frameSize  with frameSize: metric while size equals frameSize
//
// Either way children follow the part's shape: resizing it, by hand or through
// a generator, moves and resizes its children with it while their stored
// values stay as they were authored. A rotated child under a non-uniform basis
// is sheared, exactly as in the legacy builder and in G0's exports.

import { Schema } from "effect";
import type { Vec3 } from "../geometry.js";
import { PartId } from "../schema.js";
import { bounded, family, Hex, Vec3Between } from "./family.js";

/** Material finishes the character builders implement. */
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
  /**
   * Position in the build. Parts are built, joined, merged and given joints in
   * this order, so a rebuild names and orders its export the same way. Parts
   * without an assembly are built after the others, ordered by ID.
   */
  order: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4095 })),
  /**
   * The legacy `frameSize`: the part size at which its children's basis is
   * metric. The basis is `size / frameSize` per axis. Without it the basis is
   * `size` itself.
   */
  frameSize: Schema.optionalKey(Vec3Between(0.005, 12)),
});
export type FigureAssembly = typeof FigureAssembly.Type;

/** Metres one unit of a figure part's child basis spans along each of its axes. */
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

/** One centreline knot: position in the part frame, then its width and depth radii. */
export const Knot = Schema.Tuple([
  bounded(-8, 8),
  bounded(-8, 8),
  bounded(-8, 8),
  bounded(0.0005, 4),
  bounded(0.0005, 4),
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

/**
 * A curved armour plate in place of the part's primitive: the legacy `scute`
 * shape, spanning ±0.5 of the part frame. Its geometry depends only on the
 * part's size; plates fitted to a painted carrier (`mount`) are not ported.
 */
export const FigureScute = Schema.Struct({});
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

/**
 * A procedural coat pattern painted into a part's vertex colours, from
 * character-view/markings.js. Uniform presets (clay) never paint it.
 */
export const FigureMarkings = Schema.Struct({
  kind: Schema.Literals(markingKinds),
  color: Hex,
  /** Pattern wavelength in metres. */
  spacing: bounded(0.06, 0.8),
  /** Fraction of the surface the pattern covers. */
  coverage: bounded(0.1, 0.9),
  /** Pattern angle in degrees. */
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

/**
 * A whole-body build warp (character-view/body-sculpt.js): each axis scales
 * the body's girth around one height band of its frame, 1 leaving it alone.
 * `frame` lists the parts whose rest bounds define that frame, resolved once
 * when the document is made, so a builder never infers it from part names.
 */
export const FigureBuild = Schema.Struct({
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
