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
  readonly frame: Affine;
  readonly node: Affine;
  readonly children: Affine;
  readonly childBasis: Vec3;
}

const rigid: Vec3 = [1, 1, 1];

export function childBasisOf(part: Part, registry?: Registry): Vec3 {
  if (!registry) return rigid;
  for (const [id, payload] of Object.entries(part.features)) {
    const basis = registry.features.get(id)?.childBasis?.(payload, part.size);
    if (basis) return basis;
  }
  return rigid;
}

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

export function parentBasis(
  doc: CharacterDocument,
  part: Part,
  registry?: Registry,
): Affine | undefined {
  if (part.parent === null) return identityAffine;
  return partPlacement(doc, part.parent, registry)?.children;
}

const halves = (a: Affine): Affine => affineScaled(a, [0.5, 0.5, 0.5]);

export function worldToNormalized(placement: PartPlacement, world: Vec3): Vec3 | undefined {
  const inverse = invertAffine(halves(placement.node));
  return inverse && affinePoint(inverse, world);
}

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

export function worldHalfExtent(placement: PartPlacement): number {
  const [x, y, z] = mul(affineAxisLengths(placement.node), [0.5, 0.5, 0.5]);
  return Math.max(x, y, z);
}

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
      readonly reason: "missing" | "shear" | "children";
    };

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
