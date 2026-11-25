import { Vector3 } from "three";
import { fitOffsetLimit } from "./human-fit-head.js";

// Each skin vertex follows four controls. Use their actual interpolation
// weights to distribute a measured surface residual across the editable cage.
export function refineFaceSurface(
  surface,
  normals,
  controls,
  vectors,
  active,
  support,
  visible,
  query,
  scale,
) {
  const slots = new Map(active.map((id, i) => [id, i]));
  if (!active.length) return;
  const rows = [],
    rhs = new Float64Array(3 * active.length),
    diagonal = new Float64Array(rhs.length);
  const p = new Vector3(),
    n = new Vector3(),
    targetNormal = new Vector3();
  const observations = new Map();
  function addRow(ids, coefficients, distance) {
    if (!ids.length) return;
    rows.push({ ids, coefficients });
    for (let j = 0; j < ids.length; j++) {
      rhs[ids[j]] += coefficients[j] * distance;
      diagonal[ids[j]] += coefficients[j] ** 2;
    }
  }
  const head = surface.names.indexOf("head");
  for (let v = 0; v < surface.bodyVertices; v++) {
    if (surface.boneIndices[v * 4] !== head || !visible(v)) continue;
    p.fromArray(surface.positions, v * 3);
    n.fromArray(normals, v * 3);
    const target = query(p, n, 0.014 * scale, true, targetNormal);
    if (!target) continue;
    const distance =
      ((target.x - p.x) * n.x +
        (target.y - p.y) * n.y +
        (target.z - p.z) * n.z) /
      scale;
    const ids = [],
      coefficients = [],
      influence = [];
    let total = 0;
    for (let j = 4 * v; j < 4 * v + 4; j++) total += controls.weights[j];
    for (let j = 4 * v; j < 4 * v + 4; j++) {
      const index = slots.get(controls.refs[j]);
      if (index === undefined || !controls.weights[j]) continue;
      const weight = controls.weights[j] / total;
      influence.push([index, weight]);
      for (let axis = 0; axis < 3; axis++) {
        ids.push(3 * index + axis);
        coefficients.push(weight * n.getComponent(axis));
      }
    }
    addRow(ids, coefficients, distance);
    if (ids.length)
      observations.set(v, { influence, normal: targetNormal.clone() });
  }
  // Adjacent points on a smooth reference have an edge perpendicular to their
  // average normal. Match that slope too, so lowering one cheek sample does
  // not leave a corrugated surface between the measured points.
  const edges = new Set();
  for (let i = 0; i < surface.bodyTriangles * 3; i += 3) {
    for (let j = 0; j < 3; j++) {
      const a = surface.indices[i + j],
        b = surface.indices[i + ((j + 1) % 3)];
      const left = observations.get(a),
        right = observations.get(b);
      if (!left || !right || left.normal.dot(right.normal) < 0.8) continue;
      const key = Math.min(a, b) * surface.bodyVertices + Math.max(a, b);
      if (edges.has(key)) continue;
      edges.add(key);
      n.copy(left.normal).add(right.normal).normalize();
      p.fromArray(surface.positions, 3 * b).sub(
        targetNormal.fromArray(surface.positions, 3 * a),
      );
      const length = p.length() / scale;
      if (length < 0.001 || length > 0.015) continue;
      const strength = Math.min(3, 0.01 / length);
      const weights = new Map(left.influence);
      for (const [slot, w] of right.influence)
        weights.set(slot, (weights.get(slot) ?? 0) - w);
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
  // Tikhonov regularisation limits drift in tangential or unobserved directions.
  const penalty = diagonal.map((value) => 1.8 + 0.3 * value);
  // Regularise nearby control displacements together to keep cheek and skull
  // contours smooth where a scan has no matching lid opening or ear fold.
  const links = [];
  for (const { i, near, total } of support) {
    const a = slots.get(i);
    if (a === undefined) continue;
    for (const [j, weight] of near) {
      const b = slots.get(j);
      if (b !== undefined && b > a)
        links.push([3 * a, 3 * b, (20 * weight) / total]);
    }
  }
  const dot = (a, b) => {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
    return sum;
  };
  const step = new Float64Array(rhs.length),
    direction = rhs.map((v, i) => v / (diagonal[i] + penalty[i]));
  let energy = dot(rhs, direction);
  for (let iteration = 0; iteration < 14 && energy > 1e-14; iteration++) {
    const projected = direction.map((v, i) => v * penalty[i]);
    for (const [a, b, k] of links) {
      for (let axis = 0; axis < 3; axis++) {
        const delta = k * (direction[a + axis] - direction[b + axis]);
        projected[a + axis] += delta;
        projected[b + axis] -= delta;
      }
    }
    for (const { ids, coefficients } of rows) {
      let delta = 0;
      for (let j = 0; j < ids.length; j++)
        delta += coefficients[j] * direction[ids[j]];
      for (let j = 0; j < ids.length; j++)
        projected[ids[j]] += coefficients[j] * delta;
    }
    const alpha = energy / dot(direction, projected);
    for (let i = 0; i < rhs.length; i++) {
      step[i] += alpha * direction[i];
      rhs[i] -= alpha * projected[i];
    }
    const next = rhs.map((v, i) => v / (diagonal[i] + penalty[i])),
      nextEnergy = dot(rhs, next);
    for (let i = 0; i < rhs.length; i++)
      direction[i] = next[i] + (nextEnergy / energy) * direction[i];
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
