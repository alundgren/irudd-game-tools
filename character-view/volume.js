import {
  BufferGeometry,
  Float32BufferAttribute,
  MeshBasicMaterial,
  Vector3,
  MathUtils,
} from "three";
import { MarchingCubes } from "three/addons/objects/MarchingCubes.js";
const material = new MeshBasicMaterial(),
  cache = new Map();
export function volumeBounds(hull) {
  let x0 = Infinity,
    x1 = -Infinity,
    z0 = Infinity,
    z1 = -Infinity;
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
  return [
    [x0, hull.rows[0][0], z0],
    [x1, hull.rows.at(-1)[0], z1],
  ].map((p) => p.map((v, i) => (v - hull.pivot[i]) * hull.height));
}
function radial(runs, x) {
  let distance = 4;
  for (const [a, b] of runs)
    distance = Math.min(
      distance,
      Math.abs(2 * x - a - b) / Math.max(0.0001, b - a),
    );
  return distance;
}
function section(front, side, ix, iz) {
  return Math.max(-2, 1 - Math.hypot(front[ix], side[iz]));
}
function build(h) {
  const res = h.resolution,
    box = volumeBounds(h),
    lo = box[0].map((v, i) => v / h.height + h.pivot[i]),
    hi = box[1].map((v, i) => v / h.height + h.pivot[i]);
  const spans = hi.map((v, i) => Math.max(0.018, v - lo[i])),
    pad = 4 / res;
  const min = lo.map((v, i) => v - spans[i] * pad),
    span = spans.map((v) => v * (1 + 2 * pad));
  const step = span.map((v) => v / res);
  const source = h.rows.map(([y, front, side]) => ({
    y,
    x: Float32Array.from({ length: res }, (_, i) =>
      radial(front, min[0] + i * step[0]),
    ),
    z: Float32Array.from({ length: res }, (_, i) =>
      radial(side, min[2] + i * step[2]),
    ),
  }));
  const limit = Math.max(16000, 24 * res * res);
  const mc = new MarchingCubes(res, material, false, false, limit);
  mc.isolation = 0;
  mc.field.fill(-2);
  let index = 0;
  for (let iy = 1; iy < res - 1; iy++) {
    const y = min[1] + iy * step[1];
    if (y < source[0].y - step[1] || y > source.at(-1).y + step[1]) continue;
    while (index < source.length - 2 && source[index + 1].y < y) index++;
    const a = source[index],
      b = source[index + 1],
      t = MathUtils.clamp((y - a.y) / (b.y - a.y), 0, 1);
    for (let iz = 1; iz < res - 1; iz++)
      for (let ix = 1; ix < res - 1; ix++) {
        let v = MathUtils.lerp(
          section(a.x, a.z, ix, iz),
          section(b.x, b.z, ix, iz),
          t,
        );
        v = Math.min(
          v,
          (y - source[0].y) / step[1] + 0.4,
          (source.at(-1).y - y) / step[1] + 0.4,
        );
        mc.field[ix + res * (iy + res * iz)] = v;
      }
  }
  mc.update();
  if (!mc.count || mc.count / 3 > limit) {
    mc.geometry.dispose();
    throw new Error(
      "The volume could not be resolved. Widen the thinnest region.",
    );
  }
  const positions = new Float32Array(mc.count * 3),
    normals = new Float32Array(mc.count * 3),
    uv = new Float32Array(mc.count * 2);
  const p = new Vector3(),
    n = new Vector3(),
    sum = new Vector3();
  for (let i = 0; i < mc.count; i++) {
    p.fromArray(mc.positionArray, i * 3);
    positions[3 * i] =
      (min[0] + (p.x + 1) * 0.5 * span[0] - h.pivot[0]) * h.height;
    positions[3 * i + 1] =
      (min[1] + (p.y + 1) * 0.5 * span[1] - h.pivot[1]) * h.height;
    positions[3 * i + 2] =
      (min[2] + (p.z + 1) * 0.5 * span[2] - h.pivot[2]) * h.height;
    n.fromArray(mc.normalArray, 3 * i);
    n.set(n.x / span[0], n.y / span[1], n.z / span[2])
      .normalize()
      .toArray(normals, 3 * i);
  }
  // One UV projection per triangle permits independent side and back paint
  // and a real untextured opening through the mesh.
  for (let i = 0; i < mc.count; i += 3) {
    sum.set(0, 0, 0);
    for (let j = 0; j < 3; j++) sum.add(n.fromArray(normals, (i + j) * 3));
    const view =
      Math.abs(sum.z) >= Math.abs(sum.x)
        ? sum.z >= 0
          ? 0
          : 2
        : sum.x >= 0
          ? 1
          : 3;
    const [cx, base, ratio] = h.frames[view];
    for (let j = 0; j < 3; j++) {
      p.fromArray(positions, (i + j) * 3).multiplyScalar(1 / h.height);
      p.x += h.pivot[0];
      p.y += h.pivot[1];
      p.z += h.pivot[2];
      const across = [p.x, -p.z, -p.x, p.z][view];
      uv[(i + j) * 2] =
        ((view % 2) + MathUtils.clamp(cx + across * ratio, 0.001, 0.999)) * 0.5;
      uv[(i + j) * 2 + 1] =
        1 -
        (Math.floor(view / 2) +
          MathUtils.clamp(base - p.y * ratio, 0.001, 0.999)) *
          0.5;
    }
  }
  mc.geometry.dispose();
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(positions, 3));
  g.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.computeBoundingBox();
  return g;
}
export function volumeGeometry(hull) {
  const key = JSON.stringify(hull);
  let g = cache.get(key);
  if (!g) {
    g = build(hull);
    if (cache.size >= 8) {
      const first = cache.keys().next().value;
      cache.get(first).dispose();
      cache.delete(first);
    }
    cache.set(key, g);
  }
  const result = g.clone();
  if (hull.mirrored) {
    result.scale(-1, 1, 1);
    const indices = [];
    for (let i = 0; i < result.attributes.position.count; i += 3)
      indices.push(i, i + 2, i + 1);
    result.setIndex(indices);
  }
  return result;
}
