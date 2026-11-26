// Where parts are in the world, and how world-space gestures become part edits.
//
// A part's position and rotation are stored in its parent's child basis. The
// core basis is the parent's rigid metric frame. A family feature may declare
// a scaled basis (`FeatureDefinition.childBasis`), which the registry passed
// here resolves. Renderers, world picks and edit directions all go through
// these placements, so a builder's scene graph, a sculpt pick and a drag agree
// on one geometry, including sheared nesting under non-uniform scale.

import {
  affineAxisLengths,
  affineDirection,
  affineFromTrs,
  affinePoint,
  affineNear,
  affineScaled,
  composeAffine,
  decomposeAffine,
  identityAffine,
  invertAffine,
  mul,
  type Affine,
  type Quat,
  type Vec3,
} from "./geometry.js";
import type { Registry } from "./registry.js";
import type { CharacterDocument, Part } from "./schema.js";

export interface PartPlacement {
  /** The part's frame in the world: its parent's child basis ∘ T(position) · R(rotation). */
  readonly frame: Affine;
  /** Where the part's unit primitive (extent ±0.5) lands: frame · S(size). */
  readonly node: Affine;
  /** The basis the part's children are placed in: frame · S(child basis). */
  readonly children: Affine;
  /** Metres one unit of the children's basis spans along the part's axes. */
  readonly childBasis: Vec3;
}

const rigid: Vec3 = [1, 1, 1];

/** The child basis a part's features declare, or the rigid metric frame. */
export function childBasisOf(part: Part, registry?: Registry): Vec3 {
  if (!registry) return rigid;
  for (const [id, payload] of Object.entries(part.features)) {
    const basis = registry.features.get(id)?.childBasis?.(payload, part.size);
    if (basis) return basis;
  }
  return rigid;
}

/**
 * Every part's placement. Without a registry, or for parts whose features
 * declare no basis, children attach rigidly; this matches `partFrame`.
 */
export function partPlacements(
  doc: CharacterDocument,
  registry?: Registry,
): ReadonlyMap<string, PartPlacement> {
  const byId = new Map<string, Part>(doc.parts.map((p) => [p.id, p]));
  const placed = new Map<string, PartPlacement>();
  const place = (part: Part, depth: number): PartPlacement | undefined => {
    const done = placed.get(part.id);
    if (done) return done;
    if (depth > doc.parts.length) return undefined;
    const parent = part.parent === null ? undefined : byId.get(part.parent);
    const base = parent ? place(parent, depth + 1)?.children : identityAffine;
    if (!base) return undefined;
    const frame = composeAffine(base, affineFromTrs(part.position, part.rotation));
    const childBasis = childBasisOf(part, registry);
    const placement: PartPlacement = {
      frame,
      node: affineScaled(frame, part.size),
      children: affineScaled(frame, childBasis),
      childBasis,
    };
    placed.set(part.id, placement);
    return placement;
  };
  for (const part of doc.parts) place(part, 0);
  return placed;
}

export function partPlacement(
  doc: CharacterDocument,
  id: string,
  registry?: Registry,
): PartPlacement | undefined {
  return partPlacements(doc, registry).get(id);
}

/** The basis a part is placed in: its parent's child basis, or the world. */
export function parentBasis(
  doc: CharacterDocument,
  part: Part,
  registry?: Registry,
): Affine | undefined {
  if (part.parent === null) return identityAffine;
  return partPlacement(doc, part.parent, registry)?.children;
}

const halves = (a: Affine): Affine => affineScaled(a, [0.5, 0.5, 0.5]);

/** Normalised part coordinates (fractions of the half-extents) of a world point. */
export function worldToNormalized(placement: PartPlacement, world: Vec3): Vec3 | undefined {
  const inverse = invertAffine(halves(placement.node));
  return inverse && affinePoint(inverse, world);
}

/** A world-space offset in normalised part coordinates. */
export function worldOffsetToNormalized(placement: PartPlacement, offset: Vec3): Vec3 | undefined {
  const inverse = invertAffine(halves(placement.node));
  return inverse && affineDirection(inverse, offset);
}

export function normalizedToWorld(placement: PartPlacement, local: Vec3): Vec3 {
  return affinePoint(halves(placement.node), local);
}

export function normalizedOffsetToWorld(placement: PartPlacement, local: Vec3): Vec3 {
  return affineDirection(halves(placement.node), local);
}

/** The part's largest half-extent in metres, for converting a world radius. */
export function worldHalfExtent(placement: PartPlacement): number {
  const [x, y, z] = mul(affineAxisLengths(placement.node), [0.5, 0.5, 0.5]);
  return Math.max(x, y, z);
}

/**
 * The `part.transform` translation that moves a part's origin by a world-space
 * delta: the delta expressed in its parent's child basis.
 */
export function worldDeltaInParent(
  doc: CharacterDocument,
  id: string,
  delta: Vec3,
  registry?: Registry,
): Vec3 | undefined {
  const part = doc.parts.find((p) => p.id === id);
  const basis = part && parentBasis(doc, part, registry);
  const inverse = basis && invertAffine(basis);
  return inverse && affineDirection(inverse, delta);
}

export interface Reattachment {
  readonly parent: string | null;
  readonly position: Vec3;
  readonly rotation: Quat;
  readonly size: Vec3;
}

export type ReattachResult =
  | { readonly ok: true; readonly value: Reattachment }
  | {
      readonly ok: false;
      /** `shear`: the part cannot be stored under that basis. `children`: its children would move. */
      readonly reason: "missing" | "shear" | "children";
    };

/**
 * The stored values that keep a part exactly where it is in the world under a
 * new parent (or the world for null), with its children following unchanged.
 * Refused when the new basis would need a shear the part cannot store, for
 * example a rotated part leaving a non-uniformly scaled one, or when the
 * part's own child basis would change in the world.
 */
export function reattachInPlace(
  doc: CharacterDocument,
  id: string,
  parent: string | null,
  registry?: Registry,
  tolerance = 1e-9,
): ReattachResult {
  const placements = partPlacements(doc, registry);
  const part = doc.parts.find((p) => p.id === id);
  const here = placements.get(id);
  const basis = parent === null ? identityAffine : placements.get(parent)?.children;
  const inverse = basis && invertAffine(basis);
  if (!part || !here || !basis || !inverse) return { ok: false, reason: "missing" };
  const local = decomposeAffine(composeAffine(inverse, here.node), tolerance);
  if (!local) return { ok: false, reason: "shear" };
  if (doc.parts.some((p) => p.parent === id)) {
    const frame = composeAffine(basis, affineFromTrs(local.position, local.rotation));
    const children = affineScaled(frame, childBasisOf({ ...part, size: local.size }, registry));
    const scale = Math.max(1, ...affineAxisLengths(here.children));
    if (!affineNear(children, here.children, tolerance * scale))
      return { ok: false, reason: "children" };
  }
  return { ok: true, value: { parent, ...local } };
}
