// A mantle rests against the shoulders and arms. Ported from bindMantleArms
// in character-view/mantle-rig.js at 2761eb1: each side of the panel takes
// movement from the nearest arm joint, fading to the fixed neckline and back.

import { armAccess } from "@irudd/document";
import * as T from "three";
import type { Region } from "./region.js";

type JointWeights = (
  point: T.Vector3,
  points: ReadonlyArray<T.Vector3>,
) => readonly [number, number, number, number];

interface Segment {
  readonly limb: Region;
  readonly start: T.Vector3;
  readonly delta: T.Vector3;
  readonly inverse: number;
}

const armRoles = new Set(["upper arm", "forearm", "hand"]);

/**
 * Blend arm joints into the third and fourth influences of a fitted
 * mantle's world-space skin geometry. Both surfaces of the sewn panel then
 * share each station's joints.
 */
export function bindMantleArms(
  region: Region,
  regions: ReadonlyMap<string, Region>,
  geometry: T.BufferGeometry,
  indices: Uint16Array,
  weights: Float32Array,
  index: ReadonlyMap<T.Bone, number>,
  jointWeights: JointWeights,
): void {
  const cut = region.part.mantle;
  if (!cut || cut.kind === "Skirt" || !region.part.fitted || region.part.parent === null) return;
  const carrier = regions.get(region.part.parent)?.object;
  if (!carrier) return;
  const segments: Segment[] = [];
  for (const limb of regions.values()) {
    if (!armRoles.has(limb.role)) continue;
    let parent = limb.object.parent;
    while (parent && parent !== carrier) parent = parent.parent;
    if (parent !== carrier) continue;
    for (let j = 0; j < limb.points.length; j++) {
      const start = limb.points[j];
      if (!start) continue;
      const end = limb.points[j + 1] ?? start;
      const delta = end.clone().sub(start);
      segments.push({ limb, start, delta, inverse: 1 / (delta.lengthSq() || 1) });
    }
  }
  if (!segments.length) return;
  const openSides = armAccess(cut) === "Open sides";
  const pos = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  const lateralAxis = new T.Vector3(1, 0, 0).transformDirection(region.object.matrixWorld);
  const sample = new T.Vector3();
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const x = sample.fromBufferAttribute(pos, i).dot(lateralAxis);
    min = Math.min(min, x);
    max = Math.max(max, x);
  }
  const center = (min + max) / 2;
  const span = Math.max(0.03, max - min);
  const p = new T.Vector3();
  const offset = new T.Vector3();
  const nearest = new T.Vector3();
  const layer = pos.count / 2;
  for (let i = 0; i < layer; i++) {
    p.fromBufferAttribute(pos, i);
    const lateral = T.MathUtils.smoothstep(
      Math.abs(p.dot(lateralAxis) - center) / span,
      0.035,
      0.25,
    );
    const belowNeck = T.MathUtils.smoothstep(1 - uv.getY(i), 0.008, 0.11);
    if (!lateral || !belowNeck) continue;
    let best = Infinity;
    let driver: Region | undefined;
    for (const { limb, start, delta, inverse } of segments) {
      const t = T.MathUtils.clamp(offset.subVectors(p, start).dot(delta) * inverse, 0, 1);
      nearest.copy(start).addScaledVector(delta, t);
      const dist = p.distanceToSquared(nearest);
      if (dist < best) {
        best = dist;
        driver = limb;
      }
    }
    if (!driver) continue;
    const shoulder = openSides ? 1 - T.MathUtils.smoothstep(1 - uv.getY(i), 0.18, 0.4) : 1;
    const influence =
      0.992 *
      lateral *
      belowNeck *
      shoulder *
      (1 - T.MathUtils.smoothstep(Math.sqrt(best) / span, 0.24, 0.53));
    if (influence <= 0.001) continue;
    const slot = i * 4;
    const [a, b, f, g] = jointWeights(p, driver.points);
    const bone = (k: number) => {
      const joint = driver.bones[k];
      return (joint && index.get(joint)) ?? 0;
    };
    weights[slot] = (weights[slot] ?? 0) * (1 - influence);
    weights[slot + 1] = (weights[slot + 1] ?? 0) * (1 - influence);
    indices[slot + 2] = f > 0 ? bone(a) : 0;
    weights[slot + 2] = influence * f;
    indices[slot + 3] = g > 0 ? bone(b) : 0;
    weights[slot + 3] = influence * g;
  }
  indices.copyWithin(layer * 4, 0, layer * 4);
  weights.copyWithin(layer * 4, 0, layer * 4);
}
