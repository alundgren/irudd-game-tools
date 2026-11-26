import * as T from "three";
import { MarchingCubes } from "three/addons/objects/MarchingCubes.js";
import type { Knot } from "@irudd/document";

export interface BlendEntry {
  readonly id: string;
  readonly knots: ReadonlyArray<Knot> | undefined;
  readonly mesh: T.Mesh;
}

export interface BlendOwners {
  readonly ids: ReadonlyArray<string>;
  readonly first: Uint8Array;
  readonly second: Uint8Array;
  readonly weight: Float32Array;
}

interface Layer {
  readonly offset: readonly [number, number, number];
  readonly size: readonly [number, number, number];
  readonly data: Uint8Array | Float32Array;
}

type Triple = [number, number, number];
const triple = (f: (axis: number) => number): Triple => [f(0), f(1), f(2)];

const fieldMaterial = new T.MeshBasicMaterial();

const at = (values: ArrayLike<number>, i: number): number => values[i] ?? 0;
const axisOf = (v: T.Vector3, axis: number): number => (axis === 0 ? v.x : axis === 1 ? v.y : v.z);

function blur(
  data: ArrayLike<number> & { readonly length: number },
  size: Triple,
  axis: number,
  sigma: number,
): Float32Array {
  const radius = Math.ceil(2 * sigma);
  const kernel: number[] = [];
  for (let d = -radius; d <= radius; d++) kernel.push(Math.exp((-d * d) / (2 * sigma * sigma)));
  const total = kernel.reduce((a, b) => a + b, 0);
  const out = new Float32Array(data.length);
  const stride = axis === 0 ? 1 : axis === 1 ? size[0] : size[0] * size[1];
  const extent = size[axis] ?? 0;
  for (let i = 0; i < data.length; i++) {
    const coord = Math.floor(i / stride) % extent;
    let value = 0;
    for (let d = -radius; d <= radius; d++)
      if (coord + d >= 0 && coord + d < extent)
        value += at(data, i + d * stride) * at(kernel, d + radius);
    out[i] = value / total;
  }
  return out;
}

function figureLayer(
  points: Float32Array,
  index: T.BufferAttribute | null,
  step: T.Vector3,
  size: Triple,
  offset: Triple,
  lines: number[][],
  band: number,
): Layer {
  const [w, h, depth] = size;
  const count = w * h * depth;
  const inside = new Uint8Array(count);
  lines.forEach((line, col) => {
    const crossings = line
      .sort((a, b) => a - b)
      .filter((v, i, row) => i === 0 || v - at(row, i - 1) > 1e-6);
    for (let j = 1; j < crossings.length; j += 2)
      for (
        let z = Math.max(0, Math.ceil(at(crossings, j - 1)) - offset[2]);
        z <= Math.min(depth - 1, Math.floor(at(crossings, j)) - offset[2]);
        z++
      )
        inside[col + z * w * h] = 1;
  });
  const distance = new Float32Array(count).fill(band * band);
  const triangle = new T.Triangle();
  const q = new T.Vector3();
  const hit = new T.Vector3();
  const scale: Triple = [step.x, step.y, step.z];
  const lo: Triple = [0, 0, 0];
  const hi: Triple = [0, 0, 0];
  const corners = index?.count ?? points.length / 3;
  for (let i = 0; i < corners; i += 3) {
    const { a, b, c } = triangle;
    a.fromArray(points, 3 * (index ? index.getX(i) : i));
    b.fromArray(points, 3 * (index ? index.getX(i + 1) : i + 1));
    c.fromArray(points, 3 * (index ? index.getX(i + 2) : i + 2));
    for (let axis = 0; axis < 3; axis++) {
      const av = axisOf(a, axis);
      const bv = axisOf(b, axis);
      const cv = axisOf(c, axis);
      lo[axis] = Math.max(
        0,
        Math.ceil(Math.min(av, bv, cv) - band / at(scale, axis)) - at(offset, axis),
      );
      hi[axis] = Math.min(
        at(size, axis) - 1,
        Math.floor(Math.max(av, bv, cv) + band / at(scale, axis)) - at(offset, axis),
      );
    }
    a.multiply(step);
    b.multiply(step);
    c.multiply(step);
    for (let z = lo[2]; z <= hi[2]; z++)
      for (let y = lo[1]; y <= hi[1]; y++) {
        const row = (z * h + y) * w;
        q.y = (offset[1] + y) * step.y;
        q.z = (offset[2] + z) * step.z;
        for (let x = lo[0]; x <= hi[0]; x++) {
          q.x = (offset[0] + x) * step.x;
          triangle.closestPointToPoint(q, hit);
          const squared = hit.distanceToSquared(q);
          if (squared < at(distance, row + x)) distance[row + x] = squared;
        }
      }
  }
  return {
    offset,
    size,
    data: Float32Array.from(
      distance,
      (dist, i) => 127.5 * (1 + (inside[i] ? 1 : -1) * Math.min(1, Math.sqrt(dist) / band)),
    ),
  };
}

function indexOf(geometry: T.BufferGeometry): T.BufferAttribute | null {
  return geometry.index;
}

function voxelize(
  entry: BlendEntry,
  min: T.Vector3,
  step: T.Vector3,
  n: number,
  initialSigma: Triple,
  band: number | null,
): Layer | null {
  const { mesh, knots } = entry;
  const p = mesh.geometry.getAttribute("position");
  const idx = indexOf(mesh.geometry);
  const points = new Float32Array(p.count * 3);
  const v = new T.Vector3();
  const low: Triple = [n, n, n];
  const high: Triple = [0, 0, 0];
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld).sub(min).divide(step);
    v.toArray(points, i * 3);
    for (let a = 0; a < 3; a++) {
      const t = axisOf(v, a);
      low[a] = Math.min(at(low, a), t);
      high[a] = Math.max(at(high, a), t);
    }
  }
  const steps: Triple = [step.x, step.y, step.z];
  const margin = steps.map((s, i) => Math.ceil(band ? band / s : 2 * at(initialSigma, i)) + 2);
  const offset = triple((i) => Math.max(0, Math.floor(at(low, i)) - at(margin, i)));
  const size = triple(
    (i) => Math.min(n - 1, Math.ceil(at(high, i)) + at(margin, i)) - at(offset, i) + 1,
  );
  const [w, h, depth] = size;
  const lines: number[][] = Array.from({ length: w * h }, () => []);
  const corners = idx?.count ?? p.count;
  for (let k = 0; k < corners; k += 3) {
    const a = 3 * (idx ? idx.getX(k) : k);
    const b = 3 * (idx ? idx.getX(k + 1) : k + 1);
    const c = 3 * (idx ? idx.getX(k + 2) : k + 2);
    const ax = at(points, a);
    const ay = at(points, a + 1);
    const bx = at(points, b);
    const by = at(points, b + 1);
    const cx = at(points, c);
    const cy = at(points, c + 1);
    const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(det) < 1e-7) continue;
    const xa = Math.max(offset[0], Math.floor(Math.min(ax, bx, cx)));
    const xb = Math.min(offset[0] + w - 1, Math.ceil(Math.max(ax, bx, cx)));
    const ya = Math.max(offset[1], Math.floor(Math.min(ay, by, cy)));
    const yb = Math.min(offset[1] + h - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = ya; y <= yb; y++)
      for (let x = xa; x <= xb; x++) {
        const dx = x + 0.00013 - ax;
        const dy = y + 0.00009 - ay;
        const s = (dx * (cy - ay) - dy * (cx - ax)) / det;
        const t = ((bx - ax) * dy - (by - ay) * dx) / det;
        if (s < 0 || t < 0 || s + t > 1) continue;
        lines[x - offset[0] + w * (y - offset[1])]?.push(
          at(points, a + 2) +
            s * (at(points, b + 2) - at(points, a + 2)) +
            t * (at(points, c + 2) - at(points, a + 2)),
        );
      }
  }
  if (band) return figureLayer(points, idx, step, size, offset, lines, band);
  let data: Float32Array = new Float32Array(w * h * depth);
  lines.forEach((line, col) => {
    line.sort((a, b) => a - b);
    const hits = line.filter((z, i) => !i || z - at(line, i - 1) > 0.0001);
    for (let k = 1; k < hits.length; k += 2) {
      const lowZ = Math.max(0, Math.ceil(at(hits, k - 1)) - offset[2]);
      const highZ = Math.min(depth - 1, Math.floor(at(hits, k)) - offset[2]);
      for (let z = lowZ; z <= highZ; z++) data[col + z * w * h] = 1;
    }
  });
  let sigma = initialSigma;
  if (knots) {
    const scale = mesh.getWorldScale(new T.Vector3());
    const widths = knots
      .map((k) => Math.min(k[3], k[4]) * Math.min(scale.x, scale.y, scale.z))
      .sort((a, b) => a - b);
    const narrow = at(widths, Math.floor(widths.length * 0.25));
    if (narrow < Math.max(...steps) * 1.45) return null;
    sigma = triple((i) =>
      Math.min(at(initialSigma, i), Math.max(0.45, (narrow * 0.48) / at(steps, i))),
    );
  }
  for (let axis = 0; axis < 3; axis++) data = blur(data, size, axis, at(sigma, axis));
  let peak = 0;
  for (const value of data) peak = Math.max(peak, value);
  if (peak < 0.18) return null;
  const gain = Math.max(1, 0.7 / peak);
  const layer: Layer = {
    offset,
    size,
    data: Uint8Array.from(data, (value) => Math.min(255, Math.round(value * gain * 255))),
  };
  if (knots) {
    const path = knots.map((k) =>
      new T.Vector3(k[0], k[1], k[2]).applyMatrix4(mesh.matrixWorld).sub(min).divide(step),
    );
    const point = new T.Vector3();
    for (let j = 0; j < path.length - 1; j++)
      for (const t of [0.2, 0.5, 0.8]) {
        const u = (j + t) / (path.length - 1);
        if (u < 0.07 || u > 0.94) continue;
        const from = path[j];
        const to = path[j + 1];
        if (!from || !to) continue;
        point.lerpVectors(from, to, t);
        if (sample(layer, point.x, point.y, point.z) < 129) return null;
      }
  }
  return layer;
}

function sample(layer: Layer, px: number, py: number, pz: number): number {
  const [w, h, d] = layer.size;
  const x = px - layer.offset[0];
  const y = py - layer.offset[1];
  const z = pz - layer.offset[2];
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  if (ix < 0 || ix >= w - 1 || iy < 0 || iy >= h - 1 || iz < 0 || iz >= d - 1) return 0;
  const dx = x - ix;
  const dy = y - iy;
  const dz = z - iz;
  let v = 0;
  for (let k = 0; k < 2; k++)
    for (let j = 0; j < 2; j++)
      for (let i = 0; i < 2; i++)
        v +=
          at(layer.data, ix + i + w * (iy + j + h * (iz + k))) *
          (i ? dx : 1 - dx) *
          (j ? dy : 1 - dy) *
          (k ? dz : 1 - dz);
  return v;
}

interface Patch {
  readonly indices: Uint32Array | null;
  readonly pos: Float32Array;
  readonly norm: Float32Array;
  readonly uv: Float32Array;
  readonly first: Uint8Array;
  readonly second: Uint8Array;
  readonly weight: Float32Array;
}

interface PatchBuilder {
  readonly pos: number[];
  readonly norm: number[];
  readonly uv: number[];
  readonly first: number[];
  readonly second: number[];
  readonly weight: number[];
  readonly vertices: Map<number, number> | null;
  readonly indices: number[] | null;
}

interface Corner {
  readonly p: T.Vector3;
  readonly n: T.Vector3;
  key: number;
  first: number;
  second: number;
  weight: number;
  u: number;
  v: number;
}

function triangulate(
  entries: ReadonlyArray<BlendEntry>,
  softness: number,
  band: number | null,
  n: number,
): ReadonlyArray<Patch | null> {
  const box = new T.Box3();
  for (const { mesh } of entries) {
    mesh.geometry.computeBoundingBox();
    const bounds = mesh.geometry.boundingBox;
    if (bounds) box.union(bounds.clone().applyMatrix4(mesh.matrixWorld));
  }
  const extent = box.getSize(new T.Vector3());
  const largest = Math.max(extent.x, extent.y, extent.z);
  if (largest < 0.001) return [];
  const padding = Math.max(largest * 0.08, 0.015);
  const min = box.min.clone().addScalar(-padding);
  const step = extent
    .clone()
    .addScalar(2 * padding)
    .multiplyScalar(1 / (n - 1));
  const steps: Triple = [step.x, step.y, step.z];
  const sigma = triple((i) => T.MathUtils.clamp((largest * softness) / at(steps, i), 0.65, 2.8));
  const layers = entries.map((entry) => voxelize(entry, min, step, n, sigma, band));
  if (layers.filter(Boolean).length < 2) return [];
  const limit = 22 * n * n;
  const mc = new MarchingCubes(n, fieldMaterial, false, false, limit);
  mc.isolation = band ? 0.5 : 0.47;
  for (const layer of layers) {
    if (!layer) continue;
    const [w, h, d] = layer.size;
    const [x0, y0, z0] = layer.offset;
    for (let z = 0; z < d; z++)
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const cell = x + x0 + n * (y + y0 + n * (z + z0));
          const value = at(layer.data, x + w * (y + h * z)) / 255;
          if (!band) {
            mc.field[cell] = at(mc.field, cell) + value;
            continue;
          }
          const prev = at(mc.field, cell);
          const width = Math.min(0.48, 2 * prev, 2 * value);
          const overlap = width > 0 ? Math.max(0, 1 - Math.abs(prev - value) / width) : 0;
          mc.field[cell] = Math.max(prev, value) + 0.25 * width * overlap * overlap;
        }
  }
  mc.update();
  if (!mc.count || mc.count / 3 > limit) {
    mc.geometry.dispose();
    return [];
  }
  const patches: Array<PatchBuilder | null> = layers.map((l) =>
    l
      ? {
          pos: [],
          norm: [],
          uv: [],
          first: [],
          second: [],
          weight: [],
          vertices: band ? new Map<number, number>() : null,
          indices: band ? [] : null,
        }
      : null,
  );
  const verts = new T.Vector3();
  const normal = new T.Vector3();
  const corners: Corner[] = Array.from({ length: 3 }, () => ({
    p: new T.Vector3(),
    n: new T.Vector3(),
    key: 0,
    first: 0,
    second: 0,
    weight: 0,
    u: 0,
    v: 0,
  }));
  for (let tri = 0; tri < mc.count; tri += 3) {
    const score = new Float32Array(layers.length);
    corners.forEach((c, k) => {
      verts
        .fromArray(mc.positionArray, 3 * (tri + k))
        .addScalar(1)
        .multiplyScalar(n / 2);
      let first = 0;
      let second = 0;
      let hi = -1;
      let lo = 0;
      layers.forEach((l, id) => {
        if (!l) return;
        const value = sample(l, verts.x, verts.y, verts.z);
        score[id] = at(score, id) + value;
        if (value > hi) {
          lo = Math.max(0, hi);
          second = first;
          hi = value;
          first = id;
        } else if (value > lo) {
          lo = value;
          second = id;
        }
      });
      if (band) {
        let ix = Math.round(verts.x);
        let iy = Math.round(verts.y);
        let iz = Math.round(verts.z);
        let axis = 3;
        if (Math.abs(verts.x - ix) > 1e-5) {
          ix = Math.floor(verts.x);
          axis = 0;
        } else if (Math.abs(verts.y - iy) > 1e-5) {
          iy = Math.floor(verts.y);
          axis = 1;
        } else if (Math.abs(verts.z - iz) > 1e-5) {
          iz = Math.floor(verts.z);
          axis = 2;
        }
        c.key = ix + n * (iy + n * (iz + n * axis));
      }
      c.first = first;
      c.second = second;
      c.weight = hi / (hi + lo || 1);
      c.u = verts.x / (n - 1);
      c.v = verts.y / (n - 1);
      c.p.copy(verts).multiply(step).add(min);
      c.n
        .copy(normal.fromArray(mc.normalArray, 3 * (tri + k)))
        .divide(step)
        .normalize();
    });
    let owner = 0;
    let best = -Infinity;
    score.forEach((value, i) => {
      if (value > best) {
        best = value;
        owner = i;
      }
    });
    const out = patches[owner];
    if (!out) continue;
    for (const c of corners) {
      if (out.vertices && out.indices) {
        const index = out.vertices.get(c.key);
        if (index !== undefined) {
          out.indices.push(index);
          continue;
        }
        const next = out.first.length;
        out.vertices.set(c.key, next);
        out.indices.push(next);
      }
      out.pos.push(c.p.x, c.p.y, c.p.z);
      out.norm.push(c.n.x, c.n.y, c.n.z);
      out.uv.push(c.u, c.v);
      out.first.push(c.first);
      out.second.push(c.second);
      out.weight.push(c.weight);
    }
  }
  mc.geometry.dispose();
  return patches.map(
    (p) =>
      p && {
        indices: p.indices ? Uint32Array.from(p.indices) : null,
        pos: Float32Array.from(p.pos),
        norm: Float32Array.from(p.norm),
        uv: Float32Array.from(p.uv),
        first: Uint8Array.from(p.first),
        second: Uint8Array.from(p.second),
        weight: Float32Array.from(p.weight),
      },
  );
}

function clusters(entries: ReadonlyArray<BlendEntry>, reach: number): BlendEntry[][] {
  const boxes = entries.map(({ mesh }) => {
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox?.clone() ?? new T.Box3();
    return box.applyMatrix4(mesh.matrixWorld).expandByScalar(reach);
  });
  const root = entries.map((_, i) => i);
  const find = (i: number): number => {
    while (root[i] !== i) i = root[i] = at(root, at(root, i));
    return i;
  };
  boxes.forEach((a, i) => {
    for (let j = 0; j < i; j++) {
      const b = boxes[j];
      if (b && !a.isEmpty() && !b.isEmpty() && a.intersectsBox(b)) root[find(i)] = find(j);
    }
  });
  const grouped = new Map<number, BlendEntry[]>();
  entries.forEach((entry, i) => {
    const key = find(i);
    grouped.set(key, [...(grouped.get(key) ?? []), entry]);
  });
  return [...grouped.values()];
}

export function joinSurfaces(
  entries: ReadonlyArray<BlendEntry>,
  softness: number,
  commonMaterial: T.Material | null,
  band: number | null,
  detail = 72,
): Map<T.Mesh, BlendOwners> {
  const owners = new Map<T.Mesh, BlendOwners>();
  if (entries.length < 2) return owners;
  if (entries.length > 48) throw new Error("Join at most 48 skin regions at once.");
  for (const { mesh } of entries) mesh.updateWorldMatrix(true, false);
  for (const cluster of clusters(entries, (band ?? 0) + 4 * softness))
    if (cluster.length > 1)
      for (const [mesh, o] of joinCluster(cluster, softness, commonMaterial, band, detail))
        owners.set(mesh, o);
  return owners;
}

function joinCluster(
  entries: ReadonlyArray<BlendEntry>,
  softness: number,
  commonMaterial: T.Material | null,
  band: number | null,
  detail: number,
): Map<T.Mesh, BlendOwners> {
  const owners = new Map<T.Mesh, BlendOwners>();
  const patches = triangulate(entries, softness, band, detail);
  const ids = entries.map((e) => e.id);
  patches.forEach((patch, i) => {
    const mesh = entries[i]?.mesh;
    if (!patch || !mesh) return;
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.Float32BufferAttribute(patch.pos.slice(), 3));
    geo.setAttribute("normal", new T.Float32BufferAttribute(patch.norm.slice(), 3));
    geo.setAttribute("uv", new T.Float32BufferAttribute(patch.uv, 2));
    if (patch.indices) geo.setIndex(new T.Uint32BufferAttribute(patch.indices, 1));
    geo.applyMatrix4(mesh.matrixWorld.clone().invert());
    geo.computeBoundingBox();
    mesh.geometry.dispose();
    mesh.geometry = geo;
    if (commonMaterial) mesh.material = commonMaterial;
    owners.set(mesh, { ids, first: patch.first, second: patch.second, weight: patch.weight });
  });
  return owners;
}
