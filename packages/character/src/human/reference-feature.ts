import { Triangle, Vector3 } from "three";
import { skinStroke } from "./brush.js";
import { fittingSkin, type FittedAdult } from "./fit-surface.js";
import type { HumanBody } from "./body.js";
import { refineFaceForm } from "./anatomy.js";
import { smoothHumanSurface } from "./smooth.js";

export function matchReferenceFeature(
  body: HumanBody,
  adult: FittedAdult,
  face: number,
  point: Vector3,
  target: Vector3,
  reach: number,
  mirror: boolean,
) {
  const surface = fittingSkin(body, adult);
  const smooth = refineFaceForm(body, smoothHumanSurface(body, surface));
  if (!Number.isInteger(face) || face < 0 || face >= smooth.bodyTriangles)
    throw new Error("Click directly on bare editable skin.");
  const quad = smooth.parentFaces[face] ?? 0;
  const vertices = Array.from(smooth.quadIds.subarray(4 * quad, 4 * quad + 4));
  const corners = Array.from(smooth.indices.subarray(3 * face, 3 * face + 3));
  const triangle = new Triangle(
    ...corners.map((v) => new Vector3().fromArray(smooth.positions, 3 * v)),
  );
  const shares = triangle.getBarycoord(point, new Vector3());
  if (!shares) throw new Error("That face has no measurable area.");
  const blend = (positions: Float32Array) =>
    corners.reduce(
      (p, v, k) =>
        p.addScaledVector(new Vector3().fromArray(positions, 3 * v), shares.getComponent(k)),
      new Vector3(),
    );
  const start = blend(smooth.positions),
    delta = target.clone().sub(start),
    requested = delta.length();
  if (requested > 0.05)
    throw new Error("Those points are more than 50 mm apart. Improve alignment first.");
  if (requested < 0.0001) throw new Error("Those two points already meet.");
  const stroke = skinStroke(
    body,
    surface,
    adult.corrections,
    vertices,
    start.toArray(),
    reach,
    mirror,
  );
  const limit = Math.min((0.05 * surface.height) / 1.72, 0.22 * stroke.radius);
  const aim = delta.clone().clampLength(0, limit),
    offset = aim.clone();
  let result = adult,
    moved = new Vector3();
  for (let i = 0; i < 4; i++) {
    const next = { ...adult, corrections: stroke.apply(offset.toArray()) };
    const fitted = refineFaceForm(body, smoothHumanSurface(body, fittingSkin(body, next)));
    const displacement = blend(fitted.positions).sub(start);
    if (displacement.distanceTo(aim) >= moved.distanceTo(aim)) break;
    result = next;
    moved = displacement;
    const missing = aim.clone().sub(moved);
    if (missing.length() < 0.00005) break;
    offset.add(missing);
  }
  return {
    adult: result,
    requestedMm: 1000 * requested,
    achievedMm: 1000 * moved.length(),
    leftMm: 1000 * moved.distanceTo(delta),
    limitMm: 1000 * limit,
    limited: requested > limit,
  };
}
