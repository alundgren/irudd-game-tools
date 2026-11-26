import { armAccess } from "./mantle.js";
import { MathUtils, Vector3 } from "three";

export function bindMantleArms(
  region,
  regions,
  geometry,
  indices,
  weights,
  index,
  jointWeights,
) {
  if (
    region.part.shape !== "mantle" ||
    !region.part.wearFit ||
    region.part.cut.kind === "Skirt"
  )
    return;
  const carrier = regions.get(region.part.parent)?.object;
  if (!carrier) return;
  const segments = [];
  for (const limb of regions.values()) {
    if (!["upper arm", "forearm", "hand"].includes(limb.role)) continue;
    let parent = limb.object.parent;
    while (parent && parent !== carrier) parent = parent.parent;
    if (parent !== carrier) continue;
    for (let j = 0; j < limb.points.length; j++) {
      const start = limb.points[j],
        end = limb.points[j + 1] ?? start,
        delta = end.clone().sub(start);
      segments.push({
        limb,
        start,
        delta,
        inverse: 1 / (delta.lengthSq() || 1),
      });
    }
  }
  if (!segments.length) return;
  const openSides = armAccess(region.part.cut) === "Open sides";
  const pos = geometry.attributes.position,
    uv = geometry.attributes.uv;
  const lateralAxis = new Vector3(1, 0, 0).transformDirection(
    region.object.matrixWorld,
  );
  const sample = new Vector3();
  let min = Infinity,
    max = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const x = sample.fromBufferAttribute(pos, i).dot(lateralAxis);
    min = Math.min(min, x);
    max = Math.max(max, x);
  }
  const center = (min + max) / 2,
    span = Math.max(0.03, max - min);
  const p = new Vector3(),
    offset = new Vector3(),
    nearest = new Vector3();
  const layer = pos.count / 2;
  for (let i = 0; i < layer; i++) {
    p.fromBufferAttribute(pos, i);
    const lateral = MathUtils.smoothstep(
      Math.abs(p.dot(lateralAxis) - center) / span,
      0.035,
      0.25,
    );
    const belowNeck = MathUtils.smoothstep(1 - uv.getY(i), 0.008, 0.11);
    if (!lateral || !belowNeck) continue;
    let best = Infinity,
      driver;
    for (const { limb, start, delta, inverse } of segments) {
      const t = MathUtils.clamp(
        offset.subVectors(p, start).dot(delta) * inverse,
        0,
        1,
      );
      nearest.copy(start).addScaledVector(delta, t);
      const dist = p.distanceToSquared(nearest);
      if (dist < best) {
        best = dist;
        driver = limb;
      }
    }
    const shoulder = openSides
      ? 1 - MathUtils.smoothstep(1 - uv.getY(i), 0.18, 0.4)
      : 1;
    const influence =
      0.992 *
      lateral *
      belowNeck *
      shoulder *
      (1 - MathUtils.smoothstep(Math.sqrt(best) / span, 0.24, 0.53));
    if (influence <= 0.001) continue;
    const slot = i * 4,
      [a, b, f, g] = jointWeights(p, driver.points);
    weights[slot] *= 1 - influence;
    weights[slot + 1] *= 1 - influence;
    indices[slot + 2] = f > 0 ? index.get(driver.bones[a]) : 0;
    weights[slot + 2] = influence * f;
    indices[slot + 3] = g > 0 ? index.get(driver.bones[b]) : 0;
    weights[slot + 3] = influence * g;
  }
  indices.copyWithin(layer * 4, 0, layer * 4);
  weights.copyWithin(layer * 4, 0, layer * 4);
}
