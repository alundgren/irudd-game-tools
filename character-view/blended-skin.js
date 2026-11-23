import {
  Box3,
  BufferGeometry,
  Float32BufferAttribute,
  MathUtils,
  MeshBasicMaterial,
  Vector3,
} from "three";
import { MarchingCubes } from "three/addons/objects/MarchingCubes.js";

const fieldMaterial = new MeshBasicMaterial(),
  cache = new Map();
export const canBlend = (p) =>
  Boolean(
    p &&
      ["sweep", "ellipsoid"].includes(p.shape) &&
      !p.paint &&
      !p.wearFit &&
      !p.drape,
  );
export const bodyRegion = (p) =>
  canBlend(p) &&
  !["skirt", "accessory"].includes(p.outfitRole) &&
  !["canvas", "leather", "metal"].includes(p.surface) &&
  !/(eye|pupil|iris|tooth|teeth|claw|beak|plate|buckle|strap|boot|lens|saddle|sleeve|shirt|coat|robe|skirt|gown|tunic|dress|belt|pouch|vest|pack|collar|cuff|hat)/i.test(
    p.id,
  );

// Blur occupancy in physical units. Separate small grids keep fine limbs cheap.
function blur(data, size, axis, sigma) {
  const radius = Math.ceil(2 * sigma),
    kernel = [];
  for (let d = -radius; d <= radius; d++)
    kernel.push(Math.exp((-d * d) / (2 * sigma * sigma)));
  const total = kernel.reduce((a, b) => a + b, 0),
    out = new Float32Array(data.length);
  const stride = [1, size[0], size[0] * size[1]][axis];
  for (let i = 0; i < data.length; i++) {
    const coord = Math.floor(i / stride) % size[axis];
    let value = 0;
    for (let d = -radius; d <= radius; d++)
      if (coord + d >= 0 && coord + d < size[axis])
        value += data[i + d * stride] * kernel[d + radius];
    out[i] = value / total;
  }
  return out;
}
function voxelize({ mesh, part }, min, step, n, sigma) {
  const p = mesh.geometry.attributes.position,
    idx = mesh.geometry.index,
    points = new Float32Array(p.count * 3),
    v = new Vector3();
  const low = [n, n, n],
    high = [0, 0, 0];
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
      .applyMatrix4(mesh.matrixWorld)
      .sub(min)
      .divide(step);
    v.toArray(points, i * 3);
    for (let a = 0; a < 3; a++) {
      const t = v.getComponent(a);
      low[a] = Math.min(low[a], t);
      high[a] = Math.max(high[a], t);
    }
  }
  const offset = low.map((x, i) =>
    Math.max(0, Math.floor(x) - Math.ceil(2 * sigma[i]) - 2),
  );
  const size = high.map(
    (x, i) =>
      Math.min(n - 1, Math.ceil(x) + Math.ceil(2 * sigma[i]) + 2) -
      offset[i] +
      1,
  );
  const [w, h, depth] = size;
  const lines = Array.from({ length: w * h }, () => []);
  for (let k = 0; k < (idx?.count ?? p.count); k += 3) {
    const a = 3 * (idx ? idx.getX(k) : k),
      b = 3 * (idx ? idx.getX(k + 1) : k + 1),
      c = 3 * (idx ? idx.getX(k + 2) : k + 2);
    const ax = points[a],
      ay = points[a + 1],
      bx = points[b],
      by = points[b + 1],
      cx = points[c],
      cy = points[c + 1];
    const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(det) < 1e-7) continue;
    const xa = Math.max(offset[0], Math.floor(Math.min(ax, bx, cx))),
      xb = Math.min(offset[0] + w - 1, Math.ceil(Math.max(ax, bx, cx)));
    const ya = Math.max(offset[1], Math.floor(Math.min(ay, by, cy))),
      yb = Math.min(offset[1] + h - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = ya; y <= yb; y++)
      for (let x = xa; x <= xb; x++) {
        const dx = x + 0.00013 - ax,
          dy = y + 0.00009 - ay;
        const s = (dx * (cy - ay) - dy * (cx - ax)) / det,
          t = ((bx - ax) * dy - (by - ay) * dx) / det;
        if (s < 0 || t < 0 || s + t > 1) continue;
        lines[x - offset[0] + w * (y - offset[1])].push(
          points[a + 2] +
            s * (points[b + 2] - points[a + 2]) +
            t * (points[c + 2] - points[a + 2]),
        );
      }
  }
  let data = new Float32Array(w * h * depth);
  for (const [col, line] of lines.entries()) {
    line.sort((a, b) => a - b);
    const hits = line.filter((z, i) => !i || z - line[i - 1] > 0.0001);
    for (let k = 1; k < hits.length; k += 2) {
      const lowZ = Math.max(0, Math.ceil(hits[k - 1]) - offset[2]),
        highZ = Math.min(depth - 1, Math.floor(hits[k]) - offset[2]);
      for (let z = lowZ; z <= highZ; z++) data[col + z * w * h] = 1;
    }
  }
  if (part.knots) {
    const scale = mesh.getWorldScale(new Vector3());
    const widths = part.knots
      .map((k) => Math.min(k[3], k[4]) * Math.min(scale.x, scale.y, scale.z))
      .sort((a, b) => a - b);
    const narrow = widths[Math.floor(widths.length * 0.25)];
    if (narrow < Math.max(...step.toArray()) * 1.45) return null;
    sigma = sigma.map((s, i) =>
      Math.min(s, Math.max(0.45, (narrow * 0.48) / step.getComponent(i))),
    );
  }
  for (let axis = 0; axis < 3; axis++)
    data = blur(data, size, axis, sigma[axis]);
  let peak = 0;
  for (const value of data) peak = Math.max(peak, value);
  if (peak < 0.18) return null;
  const gain = Math.max(1, 0.7 / peak);
  const layer = {
    offset,
    size,
    data: Uint8Array.from(data, (v) =>
      Math.min(255, Math.round(v * gain * 255)),
    ),
  };
  // A long fine limb can fit between adjacent voxels. Keep its original mesh
  // if the reconstructed centreline would break before it reaches the foot.
  if (part.knots) {
    const path = part.knots.map((k) =>
      new Vector3(...k.slice(0, 3))
        .applyMatrix4(mesh.matrixWorld)
        .sub(min)
        .divide(step),
    );
    const point = new Vector3();
    for (let j = 0; j < path.length - 1; j++)
      for (const t of [0.2, 0.5, 0.8]) {
        const u = (j + t) / (path.length - 1);
        if (u < 0.07 || u > 0.94) continue;
        point.lerpVectors(path[j], path[j + 1], t);
        if (sample(layer, point.x, point.y, point.z) < 129) return null;
      }
  }
  return layer;
}
function sample(layer, x, y, z) {
  const [w, h, d] = layer.size;
  x -= layer.offset[0];
  y -= layer.offset[1];
  z -= layer.offset[2];
  const ix = Math.floor(x),
    iy = Math.floor(y),
    iz = Math.floor(z);
  if (ix < 0 || ix >= w - 1 || iy < 0 || iy >= h - 1 || iz < 0 || iz >= d - 1)
    return 0;
  const dx = x - ix,
    dy = y - iy,
    dz = z - iz;
  let v = 0;
  for (let k = 0; k < 2; k++)
    for (let j = 0; j < 2; j++)
      for (let i = 0; i < 2; i++)
        v +=
          layer.data[ix + i + w * (iy + j + h * (iz + k))] *
          (i ? dx : 1 - dx) *
          (j ? dy : 1 - dy) *
          (k ? dz : 1 - dz);
  return v;
}
function triangulate(entries, softness) {
  const n = 72,
    box = new Box3();
  for (const { mesh } of entries) {
    mesh.geometry.computeBoundingBox();
    box.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
  }
  const extent = box.getSize(new Vector3()),
    largest = Math.max(...extent.toArray());
  if (largest < 0.001) return [];
  const padding = Math.max(largest * 0.08, 0.015);
  const min = box.min.clone().addScalar(-padding),
    step = extent
      .clone()
      .addScalar(2 * padding)
      .multiplyScalar(1 / (n - 1));
  const sigma = step
    .toArray()
    .map((s) => MathUtils.clamp((largest * softness) / s, 0.65, 2.8));
  const layers = entries.map((entry) => voxelize(entry, min, step, n, sigma));
  if (layers.filter(Boolean).length < 2) return [];
  const limit = 22 * n * n,
    mc = new MarchingCubes(n, fieldMaterial, false, false, limit);
  mc.isolation = 0.47;
  for (const layer of layers) {
    if (!layer) continue;
    const [w, h, d] = layer.size,
      [x0, y0, z0] = layer.offset;
    for (let z = 0; z < d; z++)
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          mc.field[x + x0 + n * (y + y0 + n * (z + z0))] +=
            layer.data[x + w * (y + h * z)] / 255;
        }
  }
  mc.update();
  if (!mc.count || mc.count / 3 > limit) {
    mc.geometry.dispose();
    return [];
  }
  const patches = layers.map((l) =>
    l ? { pos: [], norm: [], uv: [], first: [], second: [], weight: [] } : null,
  );
  const verts = new Vector3(),
    normal = new Vector3();
  const corners = Array.from({ length: 3 }, () => ({
    p: new Vector3(),
    n: new Vector3(),
  }));
  for (let tri = 0; tri < mc.count; tri += 3) {
    const score = new Float32Array(layers.length);
    for (let k = 0; k < 3; k++) {
      const c = corners[k];
      verts
        .fromArray(mc.positionArray, 3 * (tri + k))
        .addScalar(1)
        .multiplyScalar(n / 2);
      let first = 0,
        second = 0,
        hi = -1,
        lo = 0;
      layers.forEach((l, id) => {
        if (!l) return;
        const value = sample(l, verts.x, verts.y, verts.z);
        score[id] += value;
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
    }
    const owner = score.indexOf(Math.max(...score)),
      out = patches[owner];
    if (!out) continue;
    for (const c of corners) {
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
        pos: Float32Array.from(p.pos),
        norm: Float32Array.from(p.norm),
        uv: Float32Array.from(p.uv),
        first: Uint8Array.from(p.first),
        second: Uint8Array.from(p.second),
        weight: Float32Array.from(p.weight),
      },
  );
}
export function blendSkin(form, objects, material) {
  const entries = form.parts
    .filter(
      (p) =>
        p.blendSkin &&
        !p.surfaceJoin &&
        canBlend(p) &&
        (!p.outfitRole || form.outfit === "Work clothes"),
    )
    .map((part) => ({ part, mesh: objects.get(part.id) }))
    .filter((e) => e.mesh?.isMesh && e.mesh.visible);
  if (entries.length < 2) return;
  if (entries.length > 48)
    throw new Error("Join at most 48 skin regions at once.");
  for (const { mesh } of entries) mesh.updateWorldMatrix(true, false);
  const softness = form.skinSoftness ?? 0.015;
  const key = JSON.stringify([
    softness,
    entries.map(({ part, mesh }) => [
      part.id,
      part.shape,
      part.knots,
      part.pulls,
      mesh.matrixWorld.elements,
    ]),
  ]);
  let patches = cache.get(key);
  if (!patches) {
    patches = triangulate(entries, softness);
    if (cache.size >= 4) cache.delete(cache.keys().next().value);
    cache.set(key, patches);
  }
  const ids = entries.map((e) => e.part.id);
  const skin = material(form.skinTint ?? entries[0].part.color, "plain");
  for (const [i, patch] of patches.entries()) {
    if (!patch) continue;
    const mesh = entries[i].mesh,
      geo = new BufferGeometry();
    geo.setAttribute(
      "position",
      new Float32BufferAttribute(patch.pos.slice(), 3),
    );
    geo.setAttribute(
      "normal",
      new Float32BufferAttribute(patch.norm.slice(), 3),
    );
    geo.setAttribute("uv", new Float32BufferAttribute(patch.uv, 2));
    geo.applyMatrix4(mesh.matrixWorld.clone().invert());
    geo.computeBoundingBox();
    mesh.geometry.dispose();
    mesh.geometry = geo;
    mesh.material = skin;
    mesh.blendOwners = {
      ids,
      first: patch.first,
      second: patch.second,
      weight: patch.weight,
    };
  }
}
