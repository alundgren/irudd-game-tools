import { boneNames } from "./catalogue.js";
import type { HumanSurface } from "./surface.js";
import type { Controls } from "./fit-topology.js";
import type { FitTargetTree } from "./fit-target.js";
import { Vector3 } from "three";
import { fitOffsetLimit, type headFitSupport } from "./fit-head.js";

export function refineFaceSurface(
  surface: HumanSurface,
  normals: Float32Array,
  controls: Controls,
  vectors: Float32Array,
  active: number[],
  support: ReturnType<typeof headFitSupport>,
  visible: (v: number) => boolean,
  query: FitTargetTree["query"],
  scale: number,
) {
  const slots = new Map(active.map((id, i) => [id, i]));
  if (!active.length) return;
  const rows: { ids: number[]; coefficients: number[] }[] = [],
    rhs = new Float64Array(3 * active.length),
    diagonal = new Float64Array(rhs.length);
  const p = new Vector3(),
    n = new Vector3(),
    targetNormal = new Vector3();
  const observations = new Map<number, { influence: [number, number][]; normal: Vector3 }>();
  function addRow(ids: number[], coefficients: number[], distance: number) {
    if (!ids.length) return;
    rows.push({ ids, coefficients });
    for (let j = 0; j < ids.length; j++) {
      rhs[ids[j] ?? 0] = (rhs[ids[j] ?? 0] ?? 0) + (coefficients[j] ?? 0) * distance;
      diagonal[ids[j] ?? 0] = (diagonal[ids[j] ?? 0] ?? 0) + (coefficients[j] ?? 0) ** 2;
    }
  }
  const head = boneNames.indexOf("head");
  for (let v = 0; v < surface.bodyVertices; v++) {
    if ((surface.boneIndices[v * 4] ?? 0) !== head || !visible(v)) continue;
    p.fromArray(surface.positions, v * 3);
    n.fromArray(normals, v * 3);
    const target = query(p, n, 0.014 * scale, true, targetNormal);
    if (!target) continue;
    const distance =
      ((target.x - p.x) * n.x + (target.y - p.y) * n.y + (target.z - p.z) * n.z) / scale;
    const ids = [],
      coefficients = [],
      influence: [number, number][] = [];
    let total = 0;
    for (let j = 4 * v; j < 4 * v + 4; j++) total += controls.weights[j] ?? 0;
    for (let j = 4 * v; j < 4 * v + 4; j++) {
      const index = slots.get(controls.refs[j] ?? 0);
      if (index === undefined || !(controls.weights[j] ?? 0)) continue;
      const weight = (controls.weights[j] ?? 0) / total;
      influence.push([index, weight]);
      for (let axis = 0; axis < 3; axis++) {
        ids.push(3 * index + axis);
        coefficients.push(weight * n.getComponent(axis));
      }
    }
    addRow(ids, coefficients, distance);
    if (ids.length) observations.set(v, { influence, normal: targetNormal.clone() });
  }
  const edges = new Set<number>();
  for (let i = 0; i < surface.bodyTriangles * 3; i += 3) {
    for (let j = 0; j < 3; j++) {
      const a = surface.indices[i + j] ?? 0,
        b = surface.indices[i + ((j + 1) % 3)] ?? 0;
      const left = observations.get(a),
        right = observations.get(b);
      if (!left || !right || left.normal.dot(right.normal) < 0.8) continue;
      const key = Math.min(a, b) * surface.bodyVertices + Math.max(a, b);
      if (edges.has(key)) continue;
      edges.add(key);
      n.copy(left.normal).add(right.normal).normalize();
      p.fromArray(surface.positions, 3 * b).sub(targetNormal.fromArray(surface.positions, 3 * a));
      const length = p.length() / scale;
      if (length < 0.001 || length > 0.015) continue;
      const strength = Math.min(3, 0.01 / length);
      const weights = new Map(left.influence);
      for (const [slot, w] of right.influence) weights.set(slot, (weights.get(slot) ?? 0) - w);
      const ids = [],
        coefficients = [];
      for (const [slot, w] of weights)
        for (let axis = 0; axis < 3; axis++) {
          ids.push(3 * slot + axis);
          coefficients.push(strength * w * n.getComponent(axis));
        }
      addRow(ids, coefficients, (strength * p.dot(n)) / scale);
    }
  }
  const penalty = diagonal.map((value) => 1.8 + 0.3 * value);
  const links: [number, number, number][] = [];
  for (const { i, near, total } of support) {
    const a = slots.get(i);
    if (a === undefined) continue;
    for (const [j, weight] of near) {
      const b = slots.get(j);
      if (b !== undefined && b > a) links.push([3 * a, 3 * b, (20 * weight) / total]);
    }
  }
  const dot = (a: Float64Array, b: Float64Array) => {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += (a[i] ?? 0) * (b[i] ?? 0);
    return sum;
  };
  const step = new Float64Array(rhs.length),
    direction = rhs.map((v, i) => v / ((diagonal[i] ?? 0) + (penalty[i] ?? 0)));
  let energy = dot(rhs, direction);
  for (let iteration = 0; iteration < 14 && energy > 1e-14; iteration++) {
    const projected = direction.map((v, i) => v * (penalty[i] ?? 0));
    for (const [a, b, k] of links) {
      for (let axis = 0; axis < 3; axis++) {
        const delta = k * ((direction[a + axis] ?? 0) - (direction[b + axis] ?? 0));
        projected[a + axis] = (projected[a + axis] ?? 0) + delta;
        projected[b + axis] = (projected[b + axis] ?? 0) - delta;
      }
    }
    for (const { ids, coefficients } of rows) {
      let delta = 0;
      for (let j = 0; j < ids.length; j++)
        delta += (coefficients[j] ?? 0) * (direction[ids[j] ?? 0] ?? 0);
      for (let j = 0; j < ids.length; j++)
        projected[ids[j] ?? 0] = (projected[ids[j] ?? 0] ?? 0) + (coefficients[j] ?? 0) * delta;
    }
    const alpha = energy / dot(direction, projected);
    for (let i = 0; i < rhs.length; i++) {
      step[i] = (step[i] ?? 0) + alpha * (direction[i] ?? 0);
      rhs[i] = (rhs[i] ?? 0) - alpha * (projected[i] ?? 0);
    }
    const next = rhs.map((v, i) => v / ((diagonal[i] ?? 0) + (penalty[i] ?? 0))),
      nextEnergy = dot(rhs, next);
    for (let i = 0; i < rhs.length; i++)
      direction[i] = (next[i] ?? 0) + (nextEnergy / energy) * (direction[i] ?? 0);
    energy = nextEnergy;
  }
  for (const [id, slot] of slots) {
    const d = p.fromArray(step, 3 * slot).clampLength(0, 0.003);
    n.fromArray(vectors, 3 * id)
      .add(d)
      .clampLength(0, fitOffsetLimit)
      .toArray(vectors, 3 * id);
  }
}
