import type { FigureHull } from "@irudd/document";
import * as T from "three";
import { MarchingCubes } from "three/addons/objects/MarchingCubes.js";

type Vec3 = [number, number, number];
type Runs = FigureHull["rows"][number][1];

const at = (v: ArrayLike<number>, i: number): number => v[i] ?? 0;

export function volumeBounds(hull: FigureHull): [Vec3, Vec3] {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const [, front, side] of hull.rows) {
    for (const [a, b] of front) {
      x0 = Math.min(x0, a);
      x1 = Math.max(x1, b);
    }
    for (const [a, b] of side) {
      z0 = Math.min(z0, a);
      z1 = Math.max(z1, b);
    }
  }
  const first = hull.rows[0]?.[0] ?? 0;
  const last = hull.rows.at(-1)?.[0] ?? 0;
  const metres = (p: Vec3): Vec3 => [
    (p[0] - hull.pivot[0]) * hull.height,
    (p[1] - hull.pivot[1]) * hull.height,
    (p[2] - hull.pivot[2]) * hull.height,
  ];
  return [metres([x0, first, z0]), metres([x1, last, z1])];
}

function radial(runs: Runs, x: number): number {
  let distance = 4;
  for (const [a, b] of runs)
    distance = Math.min(distance, Math.abs(2 * x - a - b) / Math.max(0.0001, b - a));
  return distance;
}

function section(front: Float32Array, side: Float32Array, ix: number, iz: number): number {
  return Math.max(-2, 1 - Math.hypot(at(front, ix), at(side, iz)));
}

interface Source {
  readonly y: number;
  readonly x: Float32Array;
  readonly z: Float32Array;
}

const fieldMaterial = new T.MeshBasicMaterial();

function build(h: FigureHull): T.BufferGeometry {
  const res = h.resolution;
  const box = volumeBounds(h);
  const lo = box[0].map((v, i) => v / h.height + at(h.pivot, i));
  const hi = box[1].map((v, i) => v / h.height + at(h.pivot, i));
  const spans = hi.map((v, i) => Math.max(0.018, v - at(lo, i)));
  const pad = 4 / res;
  const min = lo.map((v, i) => v - at(spans, i) * pad);
  const span = spans.map((v) => v * (1 + 2 * pad));
  const step = span.map((v) => v / res);
  const [min0, min1, min2] = [at(min, 0), at(min, 1), at(min, 2)];
  const [step0, step1, step2] = [at(step, 0), at(step, 1), at(step, 2)];
  const source: Source[] = h.rows.map(([y, front, side]) => ({
    y,
    x: Float32Array.from({ length: res }, (_, i) => radial(front, min0 + i * step0)),
    z: Float32Array.from({ length: res }, (_, i) => radial(side, min2 + i * step2)),
  }));
  const membrane = h.membrane;
  const field = (row: Source, ix: number, iz: number): number => {
    if (!membrane) return section(row.x, row.z, ix, iz);
    const x = min0 + ix * step0;
    const z = min2 + iz * step2;
    const front = at(spans, 0) >= at(spans, 2);
    let t = front ? (x - at(lo, 0)) / at(spans, 0) : (z - at(lo, 2)) / at(spans, 2);
    t = T.MathUtils.clamp(t, 0, 1);
    if (membrane.slope < 0) t = 1 - t;
    const cross = front ? z : x;
    const plane = front
      ? T.MathUtils.lerp(at(lo, 2), at(hi, 2), t)
      : T.MathUtils.lerp(at(lo, 0), at(hi, 0), t);
    const half = Math.max(
      1.8 * (front ? step2 : step0),
      membrane.thickness * (0.52 + 0.25 * Math.sin(Math.PI * t)),
    );
    return Math.max(
      -2,
      Math.min(1 - (front ? at(row.x, ix) : at(row.z, iz)), 1 - Math.abs(cross - plane) / half),
    );
  };
  const firstRow = source[0];
  const lastRow = source.at(-1);
  if (!firstRow || !lastRow) throw new Error("A hull needs at least two rows.");
  const limit = Math.max(16000, 24 * res * res);
  const mc = new MarchingCubes(res, fieldMaterial, false, false, limit);
  mc.isolation = 0;
  mc.field.fill(-2);
  let index = 0;
  for (let iy = 1; iy < res - 1; iy++) {
    const y = min1 + iy * step1;
    if (y < firstRow.y - step1 || y > lastRow.y + step1) continue;
    while (index < source.length - 2 && (source[index + 1]?.y ?? Infinity) < y) index++;
    const a = source[index];
    const b = source[index + 1];
    if (!a || !b) continue;
    const t = T.MathUtils.clamp((y - a.y) / (b.y - a.y), 0, 1);
    for (let iz = 1; iz < res - 1; iz++)
      for (let ix = 1; ix < res - 1; ix++) {
        let v = T.MathUtils.lerp(field(a, ix, iz), field(b, ix, iz), t);
        v = Math.min(v, (y - firstRow.y) / step1 + 0.4, (lastRow.y - y) / step1 + 0.4);
        mc.field[ix + res * (iy + res * iz)] = v;
      }
  }
  mc.update();
  if (!mc.count || mc.count / 3 > limit) {
    mc.geometry.dispose();
    throw new Error("The volume could not be resolved. Widen the thinnest region.");
  }
  const positions = new Float32Array(mc.count * 3);
  const normals = new Float32Array(mc.count * 3);
  const uv = new Float32Array(mc.count * 2);
  const p = new T.Vector3();
  const n = new T.Vector3();
  const sum = new T.Vector3();
  const [span0, span1, span2] = [at(span, 0), at(span, 1), at(span, 2)];
  for (let i = 0; i < mc.count; i++) {
    p.fromArray(mc.positionArray, i * 3);
    positions[3 * i] = (min0 + (p.x + 1) * 0.5 * span0 - h.pivot[0]) * h.height;
    positions[3 * i + 1] = (min1 + (p.y + 1) * 0.5 * span1 - h.pivot[1]) * h.height;
    positions[3 * i + 2] = (min2 + (p.z + 1) * 0.5 * span2 - h.pivot[2]) * h.height;
    n.fromArray(mc.normalArray, 3 * i);
    n.set(n.x / span0, n.y / span1, n.z / span2)
      .normalize()
      .toArray(normals, 3 * i);
  }
  for (let i = 0; i < mc.count; i += 3) {
    sum.set(0, 0, 0);
    for (let j = 0; j < 3; j++) sum.add(n.fromArray(normals, (i + j) * 3));
    const view = Math.abs(sum.z) >= Math.abs(sum.x) ? (sum.z >= 0 ? 0 : 2) : sum.x >= 0 ? 1 : 3;
    const [cx, base, ratio] = h.frames[view] ?? h.frames[0];
    for (let j = 0; j < 3; j++) {
      p.fromArray(positions, (i + j) * 3).multiplyScalar(1 / h.height);
      p.x += h.pivot[0];
      p.y += h.pivot[1];
      p.z += h.pivot[2];
      const across = [p.x, -p.z, -p.x, p.z][view] ?? 0;
      uv[(i + j) * 2] = ((view % 2) + T.MathUtils.clamp(cx + across * ratio, 0.001, 0.999)) * 0.5;
      uv[(i + j) * 2 + 1] =
        1 - (Math.floor(view / 2) + T.MathUtils.clamp(base - p.y * ratio, 0.001, 0.999)) * 0.5;
    }
  }
  mc.geometry.dispose();
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  g.setAttribute("normal", new T.Float32BufferAttribute(normals, 3));
  g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  g.computeBoundingBox();
  return g;
}

export function volumeGeometry(hull: FigureHull): T.BufferGeometry {
  const result = build(hull);
  if (hull.mirrored) {
    result.scale(-1, 1, 1);
    const indices: number[] = [];
    for (let i = 0; i < result.getAttribute("position").count; i += 3)
      indices.push(i, i + 2, i + 1);
    result.setIndex(indices);
  }
  return result;
}
