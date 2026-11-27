import { required } from "./required.js";
import type { HumanMeasurements, HumanSurface } from "./surface.js";
import type { FitTargetTree } from "./fit-target.js";
import { Vector3 } from "three";

const rims: readonly [number, number][] = [
  [425, 426],
  [416, 438],
  [469, 475],
  [470, 481],
  [472, 487],
  [474, 523],
  [7228, 7242],
  [7226, 7236],
  [7225, 7230],
  [7176, 7198],
  [7185, 7186],
];
const front = new Vector3(0, 0, 1),
  up = new Vector3(0, 1, 0);

export function lipCreaseSamples(surface: HumanSurface, tree: FitTargetTree) {
  if (tree.observedDirection && tree.observedDirection.dot(front) < 0.7) return [];
  const scale = surface.height / 1.72,
    step = 0.00065 * scale;
  const top = new Vector3(),
    bottom = new Vector3(),
    point = new Vector3();
  point.fromArray(surface.positions, 3 * 297);
  const noseY = point.y,
    nose: { y: number; z: number }[] = [];
  for (let k = -33; k <= 33; k++) {
    point.y = noseY + k * 0.0015 * scale;
    const hit = tree.fromView(point, front, 0.064 * scale);
    if (hit) nose.push({ y: point.y, z: hit.point.z });
  }
  const peaks = nose.filter(({ y, z }, i) => {
    const below = nose.filter((p) => p.y < y - 0.005 * scale && p.y > y - 0.02 * scale);
    const above = nose.filter((p) => p.y > y + 0.005 * scale && p.y < y + 0.02 * scale);
    return (
      i > 0 &&
      i + 1 < nose.length &&
      z >= required(nose[i - 1]).z &&
      z >= required(nose[i + 1]).z &&
      below.length >= 4 &&
      above.length >= 4 &&
      z - Math.min(...below.map((p) => p.z)) > 0.007 * scale &&
      z - Math.min(...above.map((p) => p.z)) > 0.002 * scale
    );
  });
  const peak = peaks.reduce<{ y: number; z: number } | null>(
    (best, p) => (!best || p.z > best.z ? p : best),
    null,
  );
  const tip = peak?.y ?? null;
  const results = [];
  for (const [upper, lower] of rims) {
    top.fromArray(surface.positions, 3 * upper);
    bottom.fromArray(surface.positions, 3 * lower);
    point.addVectors(top, bottom).multiplyScalar(0.5);
    const mid =
      tip === null
        ? point.y
        : Math.max(tip - 0.038 * scale, Math.min(tip - 0.026 * scale, point.y));
    const samples = [];
    for (let i = -23; i <= 23; i++) {
      point.y = mid + i * step;
      const hit = tree.fromView(point, front, 0.045 * scale);
      samples.push(hit ? hit.point.z : NaN);
    }
    let strongest = 0.0009 * scale,
      row = -1,
      open = false;
    for (let i = 7; i < samples.length - 7; i++) {
      const lowerLip = Math.max(...samples.slice(i - 7, i - 1));
      const upperLip = Math.max(...samples.slice(i + 2, i + 8));
      const relief = Math.min(lowerLip, upperLip) - (samples[i] ?? 0);
      if (
        relief > 0.009 * scale ||
        (!Number.isFinite(samples[i] ?? 0) &&
          Number.isFinite(lowerLip) &&
          Number.isFinite(upperLip))
      )
        open = true;
      const y = mid + (i - 23) * step;
      if (tip !== null && (tip - y < 0.017 * scale || tip - y > 0.042 * scale)) continue;
      if (relief < 0.008 * scale && relief > strongest) {
        strongest = relief;
        row = i;
      }
    }
    if (open || row < 0) continue;
    const y = mid + (row - 23) * step;
    results.push({ upper, lower, y });
  }
  if (results.length < 7) return [];
  const hits = [];
  for (let i = 0; i < results.length; i++) {
    const { upper, lower, y } = required(results[i]);
    const neighbors = results.slice(Math.max(0, i - 1), i + 2);
    if (neighbors.some((r) => Math.abs(r.y - y) > 0.005 * scale)) continue;
    for (const [index, clearance] of [
      [upper, 0.00018],
      [lower, -0.00018],
    ] as const) {
      const error = y + clearance * scale - (surface.positions[3 * index + 1] ?? 0);
      hits.push({ index, normal: up, error, weight: 15 });
    }
  }
  return hits;
}

export function fitLipContact(
  params: HumanMeasurements,
  surface: HumanSurface,
  tree: FitTargetTree,
  evaluate: (p: HumanMeasurements) => HumanSurface,
) {
  const samples = lipCreaseSamples(surface, tree).map(({ index, error }) => ({
    index,
    y: (surface.positions[index * 3 + 1] ?? 0) + error,
  }));
  if (samples.length < 14) return surface;
  const keys = ["mouthLevel", "mouthCorners", "lipParting"] as const;
  const start = Object.fromEntries(keys.map((k) => [k, params[k] ?? 0]));
  function cost(trial: HumanMeasurements, next: HumanSurface) {
    let sum = 0;
    for (const { index, y } of samples) sum += ((next.positions[index * 3 + 1] ?? 0) - y) ** 2;
    const prior = keys.reduce((s, k) => s + ((trial[k] ?? 0) - (start[k] ?? 0)) ** 2, 0);
    return sum / samples.length + prior * ((0.0004 * surface.height) / 1.72) ** 2;
  }
  let best = cost(params, surface);
  for (const step of [0.4, 0.2, 0.1]) {
    for (const key of keys) {
      const center = params[key] ?? 0;
      for (const value of [Math.max(-1, center - step), Math.min(1, center + step)]) {
        if (value === center) continue;
        const trial = { ...params, [key]: value },
          next = evaluate(trial);
        const score = cost(trial, next);
        if (score < best) {
          best = score;
          params[key] = value;
          surface = next;
        }
      }
    }
  }
  return surface;
}
