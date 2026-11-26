// Game and Portrait detail: one material, one compact atlas and a triangle
// budget. Ported from optimizeForGame in character-view/game-export.js, with
// game-surface.js, game-contact.js, game-face-relief.js and the grid
// raycaster of human-style-kit.js, at 2761eb1.
//
// Every source material gets a tile on a shared page sized by how much
// surface it covers. Its colour, emission, roughness/metalness/occlusion and
// relief are drawn into that tile through the host raster, so the atlas is
// resampled by the browser exactly as the reference workshop's was. Meshes
// are welded, simplified with meshoptimizer toward the budget while keeping
// UVs, normals, colours and joint influence, and remapped into their tiles.
// A short-range contact term in the second UV set darkens creases.

import * as T from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { MeshoptSimplifier, type Flags } from "meshoptimizer/simplifier";
import { context2d, type Raster, type RasterImage } from "../raster.js";
import { isMesh } from "../mesh.js";
import { leatherHeightImage } from "../materials/surfaces.js";
import { bakeFaceOcclusion, transferFaceNormals } from "./face-relief.js";
import { raycaster } from "./raycast.js";

export const gameTriangleTarget = 24000;
const restShare = 0.085;
const restLimit = 0.45;
const keptFloor = 0.3;
const pooledFloor = 0.7;

type Std = T.MeshStandardMaterial;

function std(material: T.Material | undefined): Std {
  if (!(material instanceof T.MeshStandardMaterial))
    throw new Error("Game detail packs standard materials only.");
  return material;
}

function imageOf(texture: T.Texture | null | undefined): RasterImage | undefined {
  const image: unknown = texture?.image;
  if (
    image instanceof HTMLCanvasElement ||
    image instanceof HTMLImageElement ||
    (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap)
  )
    return image;
  return undefined;
}

const flag = (m: T.Material, key: string): boolean => Boolean(m.userData[key]);

interface Batch {
  readonly start: number;
  readonly count: number;
  readonly material: Std;
  ratio?: number | undefined;
  result?: Indices;
}

/** Triangle indices as geometry stores them. */
type Indices = Uint16Array | Uint32Array;

interface UVScale {
  u: number;
  v: number;
  area: number;
}

interface Tile {
  readonly material: Std;
  weight: number;
  readonly uvScale: UVScale;
  /** One sampled texel for the whole material, when every corner shares it. undefined: not yet seen. */
  sampleUV: readonly [number, number] | null | undefined;
  rect?: [number, number, number, number];
  uv?: [number, number, number, number];
}

function batches(mesh: T.Mesh): Batch[] {
  const g = mesh.geometry;
  const materials: T.Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  if (materials.length === 1)
    return [
      {
        start: 0,
        count: g.index?.count ?? g.getAttribute("position").count,
        material: std(materials[0]),
      },
    ];
  return g.groups.map((b) => ({
    start: b.start,
    count: b.count,
    material: std(materials[b.materialIndex ?? 0]),
  }));
}

interface SimplifyInput {
  readonly p: T.BufferAttribute;
  readonly attr: Float32Array;
  readonly stride: number;
  readonly weights: number[];
}

function attribute(g: T.BufferGeometry, name: string): T.BufferAttribute | undefined {
  const a = g.getAttribute(name);
  return a instanceof T.BufferAttribute ? a : undefined;
}

function arrayOf(a: T.BufferAttribute): ArrayLike<number> & { length: number } {
  return a.array;
}

function simplifyInputs(g: T.BufferGeometry): SimplifyInput {
  const p = attribute(g, "position");
  const n = attribute(g, "normal");
  const u = attribute(g, "uv");
  if (!p || !n || !u) throw new Error("A game mesh needs positions, normals and UVs.");
  const w = attribute(g, "skinWeight");
  const bones = attribute(g, "skinIndex");
  const color = attribute(g, "color");
  const colorOffset = w ? 12 : 5;
  const stride = colorOffset + (color ? 3 : 0);
  const attr = new Float32Array(stride * p.count);
  const wa = w && arrayOf(w);
  const ba = bones && arrayOf(bones);
  for (let i = 0; i < p.count; i++) {
    const out = i * stride;
    attr[out] = n.getX(i);
    attr[out + 1] = n.getY(i);
    attr[out + 2] = n.getZ(i);
    attr[out + 3] = u.getX(i);
    attr[out + 4] = u.getY(i);
    if (color) {
      attr[out + colorOffset] = color.getX(i);
      attr[out + colorOffset + 1] = color.getY(i);
      attr[out + colorOffset + 2] = color.getZ(i);
    }
    if (!wa || !ba) continue;
    for (let j = 0; j < 4; j++) {
      const influence = wa[4 * i + j] ?? 0;
      const bone = ba[4 * i + j] ?? 0;
      attr[out + 5 + j] = influence;
      if (!influence) continue;
      // Identify which joints carry the weights. A rigid toe and a rigid
      // shin otherwise have the same attribute vector, [1, 0, 0, 0].
      attr[out + 9] = (attr[out + 9] ?? 0) + influence * Math.sin(2.13 * bone);
      attr[out + 10] = (attr[out + 10] ?? 0) + influence * Math.cos(1.81 * bone);
      attr[out + 11] = (attr[out + 11] ?? 0) + influence * Math.sin(3.61 * bone);
    }
  }
  return {
    p,
    attr,
    stride,
    weights: [
      ...(w
        ? [0.1, 0.1, 0.1, 0.13, 0.13, 0.35, 0.35, 0.35, 0.35, 0.22, 0.22, 0.22]
        : [0.1, 0.1, 0.1, 0.13, 0.13]),
      ...(color ? [0.25, 0.25, 0.25] : []),
    ],
  };
}

function positionsOf(p: T.BufferAttribute): Float32Array {
  const array: unknown = p.array;
  if (!(array instanceof Float32Array)) throw new Error("Game positions must be 32-bit floats.");
  return array;
}

function reduce(
  idx: Indices,
  ratio: number,
  input: SimplifyInput,
  lock: Uint8Array | null,
  hair = false,
): Indices {
  const target = 3 * Math.min(idx.length / 3, Math.max(12, Math.ceil((idx.length / 3) * ratio)));
  if (target >= idx.length) return idx;
  const { p, attr, stride, weights } = input;
  // The simplifier widens 16-bit indices itself; doing it first changes only
  // the width of the array it returns, never the triangles.
  const wide = idx instanceof Uint32Array ? idx : Uint32Array.from(idx);
  const run = (error: number, flags: Flags[]) =>
    MeshoptSimplifier.simplifyWithAttributes(
      wide,
      positionsOf(p),
      3,
      attr,
      stride,
      weights,
      lock,
      target,
      error,
      flags,
    )[0];
  let result = run(0.011, ["Sparse"]);
  // A fitted garment can have a normal seam at each source triangle.
  // Permit seam collapses for materials that miss the target and retain
  // UVs, surface normals and joint influence in the error metric.
  if (result.length > target * (hair ? 1.5 : 1.12)) result = run(0.035, ["Sparse", "Permissive"]);
  if (result.length > target * (hair ? 1.5 : 1.25)) result = run(0.085, ["Sparse", "Permissive"]);
  return result;
}

function indexArray(g: T.BufferGeometry): Indices {
  const array: unknown = g.index?.array;
  if (!(array instanceof Uint32Array) && !(array instanceof Uint16Array))
    throw new Error("Game meshes must be indexed.");
  return array;
}

function lockOf(g: T.BufferGeometry): Uint8Array | null {
  const array: unknown = g.getAttribute("lodAnchor")?.array;
  return array instanceof Uint8Array ? array : null;
}

function simplify(g: T.BufferGeometry, b: Batch, ratio: number, input: SimplifyInput): Indices {
  return reduce(
    indexArray(g).subarray(b.start, b.start + b.count),
    ratio,
    input,
    lockOf(g),
    flag(b.material, "hairCards"),
  );
}

// Materials without a share of their own are reduced as one surface. The
// triangles then go where the shape needs them.
function together(
  g: T.BufferGeometry,
  pool: ReadonlyArray<Batch>,
  ratio: number,
  input: SimplifyInput,
): Uint32Array[] {
  const count = g.getAttribute("position").count;
  const owner = new Int32Array(count).fill(-1);
  const shared = new Uint8Array(count);
  const lock = Uint8Array.from(lockOf(g) ?? shared);
  const idx = new Uint32Array(pool.reduce((n, b) => n + b.count, 0));
  const index = indexArray(g);
  let at = 0;
  pool.forEach((b, k) => {
    const part = index.subarray(b.start, b.start + b.count);
    idx.set(part, at);
    at += b.count;
    // A point used by two materials stays where it is, so no triangle is left spanning both.
    for (const i of part)
      if ((owner[i] ?? -1) < 0) owner[i] = k;
      else if (owner[i] !== k) shared[i] = lock[i] = 1;
  });
  const result = reduce(idx, ratio, input, lock);
  const parts: number[][] = pool.map(() => []);
  for (let t = 0; t < result.length; t += 3) {
    const corners = [result[t] ?? 0, result[t + 1] ?? 0, result[t + 2] ?? 0];
    const own = corners.find((i) => !shared[i]) ?? corners[0] ?? 0;
    parts[owner[own] ?? 0]?.push(...corners);
  }
  return parts.map((p) => Uint32Array.from(p));
}

function simplifyPool(
  g: T.BufferGeometry,
  pool: Batch[],
  budget: number,
  input: SimplifyInput,
): void {
  const size = (list: ReadonlyArray<Batch>) => list.reduce((n, b) => n + b.count / 3, 0);
  const kept = (list: ReadonlyArray<Batch>) =>
    list.reduce((n, b) => n + (b.result?.length ?? 0) / 3, 0);
  const even = Math.min(1, budget / Math.max(1, size(pool)));
  const floor = (b: Batch) =>
    Math.min(b.count / 3, Math.max(12, Math.floor((b.count / 3) * even * pooledFloor)));
  const alone = (b: Batch, triangles: number) =>
    simplify(g, b, Math.min(1, triangles / (b.count / 3)), input);
  const held: Batch[] = [];
  let open = pool.slice();
  for (let pass = 0; open.length; pass++) {
    const share = Math.max(0, budget - kept(held));
    const first = open[0];
    const parts =
      open.length > 1
        ? together(g, open, share / size(open), input)
        : first
          ? [alone(first, share)]
          : [];
    const short = pass < 5 ? open.filter((b, k) => (parts[k]?.length ?? 0) / 3 < floor(b)) : [];
    if (!short.length) {
      open.forEach((b, k) => {
        const r = parts[k];
        if (r) b.result = r;
      });
      break;
    }
    for (const b of short) b.result = alone(b, floor(b));
    held.push(...short);
    open = open.filter((b) => !short.includes(b));
  }
  // What the others had no use for goes back to the materials held at their floor.
  const spare = budget - kept(pool);
  if (held.length && spare > 0.01 * budget)
    for (const b of held)
      b.result = alone(b, (b.result?.length ?? 0) / 3 + (spare * b.count) / 3 / size(held));
}

function pack(entries: Tile[], rect: [number, number, number, number]): void {
  const head = entries[0];
  if (!head) return;
  if (entries.length === 1) {
    head.rect = rect;
    return;
  }
  const total = entries.reduce((n, e) => n + e.weight, 0);
  let first = head.weight;
  let i = 1;
  while (
    i < entries.length - 1 &&
    Math.abs(first + (entries[i]?.weight ?? 0) - total * 0.5) < Math.abs(first - total * 0.5)
  )
    first += entries[i++]?.weight ?? 0;
  const [x, y, w, h] = rect;
  const frac = Math.max(0.12, Math.min(0.88, first / total));
  if (w >= h) {
    const s = Math.round(w * frac);
    pack(entries.slice(0, i), [x, y, s, h]);
    pack(entries.slice(i), [x + s, y, w - s, h]);
  } else {
    const s = Math.round(h * frac);
    pack(entries.slice(0, i), [x, y, w, s]);
    pack(entries.slice(i), [x, y + s, w, h - s]);
  }
}

const linear = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
const recode = (v: number, m: number) =>
  Math.round(
    255 * (v <= 0.04045 ? linear((v / 12.92) * m) : linear(((v + 0.055) / 1.055) ** 2.4 * m)),
  );

function tileBounds(
  rect: readonly [number, number, number, number],
): [number, number, number, number] {
  const [x, y, w, h] = rect;
  const pad = Math.min(4, Math.floor((Math.min(w, h) - 1) / 3));
  return [x + pad, y + pad, w - 2 * pad, h - 2 * pad];
}

// A material can occur on many merged meshes. A single differing coordinate requires its full texture.
function noteSampledUV(
  entry: Tile,
  geometry: T.BufferGeometry,
  group: Batch,
  defaultUV: number,
): void {
  if (entry.sampleUV === null) return;
  const uv = geometry.getAttribute("uv");
  const end = group.start + (uv ? group.count : 1);
  for (let c = group.start; c < end; c++) {
    const v = geometry.index ? geometry.index.getX(c) : c;
    const u = uv ? T.MathUtils.clamp(uv.getX(v), 0, 1) : defaultUV;
    const y = uv ? T.MathUtils.clamp(uv.getY(v), 0, 1) : defaultUV;
    // Corners have an unambiguous source texel even when maps have different dimensions.
    if ((u !== 0 && u !== 1) || (y !== 0 && y !== 1)) {
      entry.sampleUV = null;
      return;
    }
    if (!entry.sampleUV) entry.sampleUV = [u, y];
    else if (u !== entry.sampleUV[0] || y !== entry.sampleUV[1]) {
      entry.sampleUV = null;
      return;
    }
  }
}

function drawMap(
  c: CanvasRenderingContext2D,
  map: T.Texture,
  width: number,
  height: number,
  sampleUV: readonly [number, number] | null | undefined,
  image = imageOf(map),
): void {
  if (!image) return;
  const repeatX = Math.max(1, map.repeat.x);
  const repeatY = Math.max(1, map.repeat.y);
  if (sampleUV) {
    const x = sampleUV[0] * (image.width - 1);
    const y = (1 - sampleUV[1]) * (image.height - 1);
    c.drawImage(image, x, y, 1, 1, 0, 0, width, height);
    return;
  }
  for (let j = 0; j < Math.ceil(repeatY); j++)
    for (let i = 0; i < Math.ceil(repeatX); i++)
      c.drawImage(
        image,
        (i * width) / repeatX,
        (j * height) / repeatY,
        width / repeatX,
        height / repeatY,
      );
}

function writeTile(
  ctx: CanvasRenderingContext2D,
  rect: readonly [number, number, number, number],
  tile: HTMLCanvasElement,
): [number, number, number, number] {
  const [x, y, w, h] = rect;
  const { width, height } = tile;
  const pad = (w - width) / 2;
  // Extrude edge texels into the gutter for bilinear filtering.
  ctx.drawImage(tile, 0, 0, 1, 1, x, y, pad, pad);
  ctx.drawImage(tile, width - 1, 0, 1, 1, x + w - pad, y, pad, pad);
  ctx.drawImage(tile, 0, height - 1, 1, 1, x, y + h - pad, pad, pad);
  ctx.drawImage(tile, width - 1, height - 1, 1, 1, x + w - pad, y + h - pad, pad, pad);
  ctx.drawImage(tile, 0, 0, width, 1, x + pad, y, width, pad);
  ctx.drawImage(tile, 0, height - 1, width, 1, x + pad, y + h - pad, width, pad);
  ctx.drawImage(tile, 0, 0, 1, height, x, y + pad, pad, height);
  ctx.drawImage(tile, width - 1, 0, 1, height, x + w - pad, y + pad, pad, height);
  ctx.drawImage(tile, x + pad, y + pad);
  return [x + pad, y + pad, width, height];
}

function fillTile(
  raster: Raster,
  ctx: CanvasRenderingContext2D,
  rect: readonly [number, number, number, number],
  material: Std,
  emission: boolean,
  sampleUV: readonly [number, number] | null | undefined,
): [number, number, number, number] {
  const [, , width, height] = tileBounds(rect);
  const tile = raster.canvas(width, height);
  const c = context2d(tile, { willReadFrequently: true });
  const map = emission ? material.emissiveMap : material.map;
  const colour = emission ? material.emissive : material.color;
  const cutout = !emission && imageOf(map) !== undefined && material.alphaTest > 0;
  if (!cutout) {
    c.fillStyle = "white";
    c.fillRect(0, 0, width, height);
  }
  if (map && imageOf(map)) drawMap(c, map, width, height, sampleUV);
  const pixels = c.getImageData(0, 0, width, height);
  const strength = emission ? material.emissiveIntensity : 1;
  const factors = [colour.r, colour.g, colour.b].map((v) => v * strength);
  const lut = factors.map((f) =>
    Uint8ClampedArray.from({ length: 256 }, (_, i) => recode(i / 255, f)),
  );
  for (let i = 0; i < pixels.data.length; i += 4) {
    for (let k = 0; k < 3; k++) pixels.data[i + k] = lut[k]?.[pixels.data[i + k] ?? 0] ?? 0;
    // A single GLB atlas has one cutoff. Map each original material's
    // threshold to its midpoint while keeping soft edge coverage for mipmaps.
    if (cutout) {
      const a = (pixels.data[i + 3] ?? 0) / 255;
      const threshold = material.alphaTest;
      pixels.data[i + 3] = Math.round(
        255 *
          (a <= threshold
            ? (0.5 * a) / threshold
            : 0.5 + (0.5 * (a - threshold)) / (1 - threshold)),
      );
    }
  }
  c.putImageData(pixels, 0, 0);
  return writeTile(ctx, rect, tile);
}

function canvasTexture(c: HTMLCanvasElement, srgb: boolean): T.CanvasTexture {
  const t = new T.CanvasTexture(c);
  if (srgb) t.colorSpace = T.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ── game-surface.js ─────────────────────────────────────────────────────────

// Recover metres per unit of U and V for a material's height field. Weight
// by UV triangle area so tiny, distorted islands do not dominate the scale.
function measureTileScale(mesh: T.Mesh, batch: Batch, totals: UVScale): void {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  if (!uv) return;
  const a = new T.Vector3();
  const b = new T.Vector3();
  const c = new T.Vector3();
  const scratch = new T.Vector3();
  for (let i = batch.start; i < batch.start + batch.count; i += 3) {
    const ia = geometry.index?.getX(i) ?? i;
    const ib = geometry.index?.getX(i + 1) ?? i + 1;
    const ic = geometry.index?.getX(i + 2) ?? i + 2;
    const du1 = uv.getX(ib) - uv.getX(ia);
    const du2 = uv.getX(ic) - uv.getX(ia);
    const dv1 = uv.getY(ib) - uv.getY(ia);
    const dv2 = uv.getY(ic) - uv.getY(ia);
    const area = Math.abs(du1 * dv2 - du2 * dv1);
    if (area < 1e-9) continue;
    a.fromBufferAttribute(position, ia).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(position, ib).applyMatrix4(mesh.matrixWorld).sub(a);
    c.fromBufferAttribute(position, ic).applyMatrix4(mesh.matrixWorld).sub(a);
    totals.u += scratch.copy(b).multiplyScalar(dv2).addScaledVector(c, -dv1).length();
    totals.v += scratch.copy(c).multiplyScalar(du1).addScaledVector(b, -du2).length();
    totals.area += area;
  }
}

function packSurfaceChannels(
  out: Uint8ClampedArray,
  rough: Uint8ClampedArray | null,
  metal: Uint8ClampedArray | null,
  roughness: number,
  metalness: number,
  ambient: Uint8ClampedArray | null = null,
  strength = 1,
): void {
  for (let i = 0; i < out.length; i += 4) {
    out[i] = ambient ? Math.round(255 + strength * ((ambient[i] ?? 0) - 255)) : 255;
    out[i + 3] = 255;
    out[i + 1] = Math.round(roughness * (rough ? (rough[i + 1] ?? 0) : 255));
    out[i + 2] = Math.round(metalness * (metal ? (metal[i + 2] ?? 0) : 255));
  }
}

function packNormals(out: Uint8ClampedArray, pixels: Uint8ClampedArray, scale: T.Vector2): void {
  for (let i = 0; i < out.length; i += 4) {
    const x = ((pixels[i] ?? 0) / 127.5 - 1) * scale.x;
    const y = ((pixels[i + 1] ?? 0) / 127.5 - 1) * scale.y;
    const z = (pixels[i + 2] ?? 0) / 127.5 - 1;
    const length = Math.hypot(x, y, z) || 1;
    out[i] = Math.round(127.5 + (127.5 * x) / length);
    out[i + 1] = Math.round(127.5 + (127.5 * y) / length);
    out[i + 2] = Math.round(127.5 + (127.5 * z) / length);
    out[i + 3] = 255;
  }
}

// Bake the slope of the height actually sampled at this detail level; a constant height stays flat.
function heightNormals(
  out: Uint8ClampedArray,
  heights: Uint8ClampedArray,
  w: number,
  h: number,
  scale: number,
  totals: UVScale,
  srgb: boolean,
): void {
  const lin = Float64Array.from({ length: 256 }, (_, i) => {
    const v = i / 255;
    return srgb ? (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4) : v;
  });
  const at = (i: number) => lin[heights[i] ?? 0] ?? 0;
  const strengthU = totals.u > 0 ? (scale * w * totals.area) / totals.u : 0;
  const strengthV = totals.v > 0 ? (scale * h * totals.area) / totals.v : 0;
  for (let y = 0; y < h; y++) {
    const top = Math.max(0, y - 1);
    const bottom = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const left = Math.max(0, x - 1);
      const right = Math.min(w - 1, x + 1);
      const i = 4 * (y * w + x);
      const nx =
        (strengthU * (at(4 * (y * w + left)) - at(4 * (y * w + right)))) /
        Math.max(1, right - left);
      const ny =
        (strengthV * (at(4 * (bottom * w + x)) - at(4 * (top * w + x)))) /
        Math.max(1, bottom - top);
      const length = Math.hypot(nx, ny, 1);
      out[i] = Math.round(127.5 + (127.5 * nx) / length);
      out[i + 1] = Math.round(127.5 + (127.5 * ny) / length);
      out[i + 2] = Math.round(127.5 + 127.5 / length);
      out[i + 3] = 255;
    }
  }
}

function fillSurface(
  raster: Raster,
  surface: CanvasRenderingContext2D,
  normals: CanvasRenderingContext2D | null | undefined,
  entry: Tile,
): void {
  const m = entry.material;
  const rect = entry.rect;
  if (!rect) return;
  const [, , w, h] = tileBounds(rect);
  const hasProperties = Boolean(
    imageOf(m.roughnessMap) || imageOf(m.metalnessMap) || imageOf(m.aoMap),
  );
  if (!hasProperties) {
    surface.fillStyle =
      "rgb(255," + Math.round(255 * m.roughness) + "," + Math.round(255 * m.metalness) + ")";
    surface.fillRect(...rect);
  }
  if (!hasProperties && !imageOf(m.bumpMap) && !imageOf(m.normalMap)) return;
  const tile = raster.canvas(w, h);
  const c = context2d(tile, { willReadFrequently: true });
  const read = (map: T.Texture | null, image = imageOf(map)): Uint8ClampedArray | null => {
    if (!map || !image) return null;
    c.clearRect(0, 0, w, h);
    drawMap(c, map, w, h, entry.sampleUV, image);
    return c.getImageData(0, 0, w, h).data;
  };
  const pixels = c.createImageData(w, h);
  if (hasProperties) {
    const rough = read(m.roughnessMap);
    const metal = m.metalnessMap === m.roughnessMap ? rough : read(m.metalnessMap);
    const ambient =
      m.aoMap === m.roughnessMap ? rough : m.aoMap === m.metalnessMap ? metal : read(m.aoMap);
    packSurfaceChannels(
      pixels.data,
      rough,
      metal,
      m.roughness,
      m.metalness,
      ambient,
      m.aoMapIntensity,
    );
    c.putImageData(pixels, 0, 0);
    writeTile(surface, rect, tile);
  }
  if (normals && (imageOf(m.normalMap) || imageOf(m.bumpMap))) {
    if (m.normalMap && imageOf(m.normalMap))
      packNormals(pixels.data, read(m.normalMap) ?? pixels.data, m.normalScale);
    else if (m.bumpMap)
      heightNormals(
        pixels.data,
        read(m.bumpMap, leatherHeightImage.get(m.bumpMap)) ?? pixels.data,
        w,
        h,
        m.bumpScale,
        entry.uvScale,
        m.bumpMap.colorSpace === T.SRGBColorSpace,
      );
    c.putImageData(pixels, 0, 0);
    writeTile(normals, rect, tile);
  }
}

// ── game-contact.js ─────────────────────────────────────────────────────────

const directions = Array.from({ length: 32 }, (_, i) => {
  const y = 1 - (2 * (i + 0.5)) / 32;
  const r = Math.sqrt(1 - y * y);
  const angle = Math.PI * (3 - Math.sqrt(5)) * i;
  return [r * Math.cos(angle), y, r * Math.sin(angle)] as const;
});

const contactRampRows = (size: number) => Math.min(16, Math.floor(size / 8));

function drawContactRamp(context: CanvasRenderingContext2D, size: number): void {
  const rows = contactRampRows(size);
  for (let x = 0; x < size; x++) {
    const shade = Math.round((255 * x) / (size - 1));
    context.fillStyle = "rgb(" + shade + ",255,0)";
    context.fillRect(x, size - rows, 1, rows);
  }
}

const casts = (material: Std) =>
  !(material.alphaTest || material.transparent || flag(material, "fibreLOD"));

interface Work {
  readonly mesh: T.Mesh;
  readonly groups: Batch[];
  readonly joined: T.BufferGeometry;
  readonly input: SimplifyInput;
}

/** Short-range visibility in the bind pose, stored as a second UV set into the contact ramp. */
function bakeContact(work: ReadonlyArray<Work>, size: number): void {
  const positions: number[] = [];
  const triangles: number[] = [];
  const bounds = new T.Box3();
  const p = new T.Vector3();
  const n = new T.Vector3();
  for (const { mesh, groups } of work) {
    const geometry = mesh.geometry;
    const offset = positions.length / 3;
    const position = geometry.getAttribute("position");
    for (let i = 0; i < position.count; i++) {
      p.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      positions.push(p.x, p.y, p.z);
      bounds.expandByPoint(p);
    }
    let start = 0;
    for (const group of groups) {
      const end = start + (group.result?.length ?? 0);
      if (casts(group.material))
        for (let j = start; j < end; j++) triangles.push(offset + (geometry.index?.getX(j) ?? j));
      start = end;
    }
  }
  const span = bounds.getSize(p);
  const radius = 0.033 * Math.max(span.x, span.y, span.z);
  const query = raycaster(positions, triangles, Math.max(radius * 0.65, 0.0001));
  const origin = [0, 0, 0];
  const rampV = contactRampRows(size) / (2 * size);
  for (const { mesh, groups } of work) {
    const g = mesh.geometry;
    const position = g.getAttribute("position");
    const normal = g.getAttribute("normal");
    const uv = g.getAttribute("uv");
    const normalTransform = new T.Matrix3().getNormalMatrix(mesh.matrixWorld);
    const values = new Float32Array(position.count * 2);
    const visited = new Uint8Array(position.count);
    let offset = 0;
    for (const { material, result } of groups) {
      const end = offset + (result?.length ?? 0);
      for (; offset < end; offset++) {
        const i = g.index?.getX(offset) ?? offset;
        if (visited[i]) continue;
        visited[i] = 1;
        // Existing texture AO retains its full texel resolution in the atlas red.
        if (imageOf(material.aoMap)) {
          values[2 * i] = uv.getX(i);
          values[2 * i + 1] = uv.getY(i);
          continue;
        }
        let visibility = 1;
        if (
          radius > 0 &&
          casts(material) &&
          !mesh.userData["eyePiece"] &&
          !mesh.userData["fittedEyes"]
        ) {
          p.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
          n.fromBufferAttribute(normal, i).applyNormalMatrix(normalTransform);
          p.addScaledVector(n, radius * 0.025).toArray(origin);
          let blocked = 0;
          let total = 0;
          for (const dir of directions) {
            const weight = n.x * dir[0] + n.y * dir[1] + n.z * dir[2];
            if (weight <= 0) continue;
            total += weight;
            const hit = query(origin, dir, radius);
            if (hit < radius) blocked += weight * (1 - hit / radius) ** 2;
          }
          if (total) visibility -= (0.82 * blocked) / total;
        }
        values[2 * i] = (0.5 + (size - 1) * visibility) / size;
        values[2 * i + 1] = rampV;
      }
    }
    g.setAttribute("uv1", new T.Float32BufferAttribute(values, 2));
  }
}

// ── the atlas page ──────────────────────────────────────────────────────────

interface Page {
  readonly material: T.MeshStandardMaterial;
  dispose(): void;
}

function atlas(raster: Raster, entries: Tile[], size: number, contact: boolean): Page {
  // Large untextured meshes only need a patch of constant colour.
  for (const entry of entries) {
    const m = entry.material;
    const maps = [
      m.map,
      m.emissiveMap,
      m.aoMap,
      m.bumpMap,
      m.normalMap,
      m.roughnessMap,
      m.metalnessMap,
    ];
    if (
      entry.sampleUV &&
      maps.some(
        (map) =>
          map &&
          imageOf(map) &&
          (!Number.isInteger(Math.max(1, map.repeat.x)) ||
            !Number.isInteger(Math.max(1, map.repeat.y))),
      )
    )
      entry.sampleUV = null;
    if (entry.sampleUV) entry.weight = Math.min(4, entry.weight);
    if (flag(m, "bodySkin")) entry.weight = Math.min(100, entry.weight);
    if (!maps.some((map) => imageOf(map))) entry.weight = Math.min(16, entry.weight);
  }
  const page: [number, number, number, number] = [
    0,
    0,
    size,
    size - (contact ? contactRampRows(size) : 0),
  ];
  const body = entries.find((entry) => flag(entry.material, "castBodySheet"));
  const hair = entries.find((entry) => flag(entry.material, "castHairSheet"));
  const usesHairQuarter = size >= 64 && entries.length === 2 && body && hair;
  if (usesHairQuarter) {
    body.rect = page;
    const [x, y, width, height] = tileBounds(page);
    const left = Math.ceil(width / 2) + 2;
    const top = Math.ceil(height / 2) + 2;
    hair.rect = [x + left, y + top, width - left - 2, height - top - 2];
    entries = [body, hair];
  } else
    pack(
      entries.sort((a, b) => b.weight - a.weight),
      page,
    );
  const color = raster.canvas(size, size);
  const emit = raster.canvas(size, size);
  const surface = raster.canvas(size, size);
  const ctx = context2d(surface);
  const relief = entries.some((e) => imageOf(e.material.normalMap) || imageOf(e.material.bumpMap))
    ? raster.canvas(size, size)
    : null;
  const normals = relief && context2d(relief);
  if (normals) {
    normals.fillStyle = "rgb(128,128,255)";
    normals.fillRect(0, 0, size, size);
  }
  const base = context2d(color);
  let anyEmission = false;
  for (const e of entries) {
    const m = e.material;
    const rect = e.rect;
    if (!rect) continue;
    if (usesHairQuarter && e === hair) {
      base.clearRect(...rect);
      normals?.fillRect(...rect);
    }
    e.uv = fillTile(raster, base, rect, m, false, e.sampleUV);
    if (m.emissive.getHex() !== 0) {
      fillTile(raster, context2d(emit), rect, m, true, e.sampleUV);
      anyEmission = true;
    } else {
      const ec = context2d(emit);
      ec.fillStyle = "#000";
      ec.fillRect(...rect);
    }
    fillSurface(raster, ctx, normals, e);
  }
  if (contact) drawContactRamp(ctx, size);
  const map = canvasTexture(color, true);
  const orm = canvasTexture(surface, false);
  const emissiveMap = anyEmission ? canvasTexture(emit, true) : null;
  const hasAo = entries.some((e) => imageOf(e.material.aoMap));
  const occlusion = contact ? orm.clone() : hasAo ? orm : null;
  if (contact && occlusion) occlusion.channel = 1;
  const material = new T.MeshStandardMaterial({
    map,
    roughness: 1,
    metalness: 1,
    roughnessMap: orm,
    metalnessMap: orm,
    aoMap: occlusion,
    normalMap: relief ? canvasTexture(relief, false) : null,
    emissive: anyEmission ? 0xffffff : 0,
    emissiveMap,
  });
  if (entries.some(({ material: m }) => m.alphaTest > 0 && imageOf(m.map))) {
    material.alphaTest = 0.5;
    material.alphaToCoverage = true;
    if (entries.some(({ material: m }) => m.alphaTest > 0 && m.side === T.DoubleSide))
      material.side = T.DoubleSide;
  }
  material.name = "Character atlas";
  return {
    material,
    dispose() {
      map.dispose();
      orm.dispose();
      if (contact) occlusion?.dispose();
      material.normalMap?.dispose();
      emissiveMap?.dispose();
      material.dispose();
    },
  };
}

function canonicalizeGameAttributes(geometry: T.BufferGeometry): void {
  // Keep authored colour and skin data available to the simplifier. Only
  // clamp the resulting colours and clear unused joint slots in the file.
  const color = attribute(geometry, "color");
  if (color && !color.normalized) {
    const data = color.array;
    for (let i = 0; i < data.length; i++) data[i] = T.MathUtils.clamp(data[i] ?? 0, 0, 1);
  }
  const joints = attribute(geometry, "skinIndex")?.array;
  const weights = attribute(geometry, "skinWeight")?.array;
  if (joints && weights)
    for (let i = 0; i < joints.length; i++) if (weights[i] === 0) joints[i] = 0;
}

type TypedArrayCtor = new (values: ArrayLike<number>) => T.TypedArray;

function ctorOf(array: T.TypedArray): TypedArrayCtor {
  if (array instanceof Float32Array) return Float32Array;
  if (array instanceof Uint16Array) return Uint16Array;
  if (array instanceof Uint8Array) return Uint8Array;
  if (array instanceof Uint32Array) return Uint32Array;
  if (array instanceof Int16Array) return Int16Array;
  if (array instanceof Int8Array) return Int8Array;
  if (array instanceof Int32Array) return Int32Array;
  throw new Error("Unsupported attribute array in a game mesh.");
}

function remap(
  g: T.BufferGeometry,
  groups: ReadonlyArray<Batch>,
  tiles: ReadonlyMap<T.Material, Tile>,
  size: number,
): T.BufferGeometry {
  const attributes = Object.entries(g.attributes).flatMap(
    ([name, a]): [string, T.BufferAttribute][] =>
      name !== "lodAnchor" && a instanceof T.BufferAttribute ? [[name, a]] : [],
  );
  const out = new Map(attributes.map(([k]): [string, number[]] => [k, []]));
  const indices: number[] = [];
  const sourceOrder: number[] = [];
  const positions = out.get("position") ?? [];
  for (const b of groups) {
    const tile = tiles.get(b.material);
    if (!tile?.uv) throw new Error("A game material has no atlas tile.");
    const lookup = new Map<number, number>();
    const [x, y, w, h] = tile.uv;
    for (const i of b.result ?? []) {
      let dest = lookup.get(i);
      if (dest === undefined) {
        dest = positions.length / 3;
        lookup.set(i, dest);
        sourceOrder.push(i);
        for (const [key, a] of attributes) {
          const values = out.get(key) ?? [];
          if (key === "uv")
            values.push(
              (x + (tile.sampleUV ? 0.5 : T.MathUtils.clamp(a.getX(i), 0, 1)) * w) / size,
              1 - (y + (tile.sampleUV ? 0.5 : 1 - T.MathUtils.clamp(a.getY(i), 0, 1)) * h) / size,
            );
          else for (let j = 0; j < a.itemSize; j++) values.push(a.array[a.itemSize * i + j] ?? 0);
        }
      }
      indices.push(dest);
    }
  }
  const geo = new T.BufferGeometry();
  geo.setIndex(indices);
  for (const [key, a] of attributes) {
    const Ctor = ctorOf(a.array);
    geo.setAttribute(
      key,
      new T.BufferAttribute(new Ctor(out.get(key) ?? []), a.itemSize, a.normalized),
    );
  }
  canonicalizeGameAttributes(geo);
  geo.morphTargetsRelative = g.morphTargetsRelative;
  for (const key of ["position", "normal", "color"] as const) {
    const targets = g.morphAttributes[key];
    if (!targets) continue;
    geo.morphAttributes[key] = targets.map((target) => {
      const data = new Float32Array(sourceOrder.length * target.itemSize);
      const array: unknown = target.array;
      if (!(array instanceof Float32Array)) throw new Error("Morph targets must be 32-bit floats.");
      sourceOrder.forEach((source, dest) =>
        data.set(
          array.subarray(source * target.itemSize, (source + 1) * target.itemSize),
          dest * target.itemSize,
        ),
      );
      const attr = new T.Float32BufferAttribute(data, target.itemSize);
      attr.name = target.name;
      return attr;
    });
  }
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

function whiteVertexColors(geometry: T.BufferGeometry): void {
  if (!geometry.getAttribute("color"))
    geometry.setAttribute(
      "color",
      new T.Float32BufferAttribute(
        new Float32Array(geometry.getAttribute("position").count * 3).fill(1),
        3,
      ),
    );
}

export interface GameResult {
  readonly material: T.MeshStandardMaterial;
  readonly initial: number;
  readonly triangles: number;
  readonly shares: ReadonlyArray<{
    readonly material: T.Material;
    readonly initial: number;
    readonly triangles: number;
  }>;
  dispose(): void;
}

export interface GameOptions {
  readonly raster: Raster;
  readonly triangles?: number;
  /** Atlas edge in pixels: 1024 for Game, 2048 for Portrait. */
  readonly size?: number;
  readonly contact?: boolean;
}

/** Pack every visible mesh under `root` onto one atlas material within a triangle budget. */
export async function optimizeForGame(root: T.Object3D, options: GameOptions): Promise<GameResult> {
  const { raster, triangles = gameTriangleTarget, size = 1024, contact = true } = options;
  await MeshoptSimplifier.ready;
  root.updateMatrixWorld(true);
  const meshes: [T.Mesh, Batch[]][] = [];
  const tiles = new Map<T.Material, Tile>();
  let initial = 0;
  let eyeTriangles = 0;
  let fittedFaceTriangles = 0;
  let foldedClothTriangles = 0;
  let carrierTriangles = 0;
  let trimTriangles = 0;
  let hairTriangles = 0;
  let retainedTriangles = 0;
  const retainsGeometry = (m: Std) => flag(m, "fibreLOD") || flag(m, "wingLOD");
  const portraitFace = (mesh: T.Mesh) =>
    Boolean(mesh.userData["fittedEyes"]) ||
    (Boolean(mesh.userData["faceSurface"]) &&
      !Array.isArray(mesh.material) &&
      flag(mesh.material, "portraitPlate"));
  root.traverseVisible((m) => {
    if (!isMesh(m)) return;
    const groups = batches(m);
    const defaultUV = groups.some(({ material }) => material.map || material.emissiveMap) ? 0 : 0.5;
    for (const b of groups) {
      initial += b.count / 3;
      const detail: unknown = b.material.userData["attachmentDetail"];
      if (retainsGeometry(b.material)) retainedTriangles += b.count / 3;
      else if (detail === "carrier") carrierTriangles += b.count / 3;
      else if (detail === "trim") trimTriangles += b.count / 3;
      else if (flag(b.material, "hairCards")) hairTriangles += b.count / 3;
      else if (m.userData["eyePiece"]) eyeTriangles += b.count / 3;
      else if (portraitFace(m)) fittedFaceTriangles += b.count / 3;
      else if (flag(b.material, "foldedCloth")) foldedClothTriangles += b.count / 3;
      const e: Tile = tiles.get(b.material) ?? {
        material: b.material,
        weight: 0,
        uvScale: { u: 0, v: 0, area: 0 },
        sampleUV: undefined,
      };
      noteSampledUV(e, m.geometry, b, defaultUV);
      if (imageOf(b.material.bumpMap)) measureTileScale(m, b, e.uvScale);
      e.weight +=
        Math.sqrt(b.count) *
        (flag(b.material, "creatureHide")
          ? 3.2
          : flag(b.material, "portrait")
            ? 2.2
            : flag(b.material, "hairCards")
              ? 1.85
              : 1);
      tiles.set(b.material, e);
    }
    meshes.push([m, groups]);
  });
  if (!meshes.length) throw new Error("The selected wardrobe has no visible mesh.");
  const available = Math.max(0, triangles - retainedTriangles);
  const carriers = Math.min(carrierTriangles, available * 0.065);
  const trim = Math.min(trimTriangles, available * 0.085);
  const hair = Math.min(hairTriangles, available * 0.11);
  const shared = available - carriers - trim - hair;
  const eyes = Math.min(eyeTriangles, shared * 0.22);
  const faces = Math.min(fittedFaceTriangles * 0.55, shared * 0.34);
  const cloth = Math.min(foldedClothTriangles * 0.6, (shared - eyes - faces) * 0.32);
  const useContact = contact && size >= 32;
  const page = atlas(raster, [...tiles.values()], size, useContact);
  const rest =
    initial -
    retainedTriangles -
    carrierTriangles -
    trimTriangles -
    hairTriangles -
    eyeTriangles -
    fittedFaceTriangles -
    foldedClothTriangles;
  const want = Math.min(rest * restShare, triangles * restLimit);
  const thinned = T.MathUtils.clamp(
    want - (shared - eyes - faces - cloth),
    0,
    Math.max(0, retainedTriangles - triangles * keptFloor),
  );
  const kept = retainedTriangles - thinned;
  page.material.vertexColors = meshes.some(([mesh]) =>
    Boolean(mesh.geometry.getAttribute("color")),
  );
  let count = 0;
  let pooled = 0;
  const work: Work[] = [];
  const shares: { material: T.Material; initial: number; triangles: number }[] = [];
  for (const [mesh, groups] of meshes) {
    const share = mesh.userData["eyePiece"]
      ? eyes / eyeTriangles
      : portraitFace(mesh)
        ? faces / fittedFaceTriangles
        : undefined;
    for (const batch of groups) {
      const detail: unknown = batch.material.userData["attachmentDetail"];
      if (initial <= triangles) batch.ratio = 1;
      else if (retainsGeometry(batch.material)) batch.ratio = kept / retainedTriangles;
      else if (detail === "carrier") batch.ratio = carriers / carrierTriangles;
      else if (detail === "trim") batch.ratio = trim / trimTriangles;
      else if (flag(batch.material, "hairCards")) batch.ratio = hair / hairTriangles;
      else if (flag(batch.material, "foldedCloth") && foldedClothTriangles)
        batch.ratio = cloth / foldedClothTriangles;
      else batch.ratio = share;
    }
    if (page.material.vertexColors) whiteVertexColors(mesh.geometry);
    const original = mesh.geometry;
    const joined = mergeVertices(original, 1e-5);
    if (!joined.getAttribute("normal")) joined.computeVertexNormals();
    if (!joined.getAttribute("uv")) {
      const coordinate = groups.some(({ material }) => material.map || material.emissiveMap)
        ? 0
        : 0.5;
      const uvs = new Float32Array(joined.getAttribute("position").count * 2).fill(coordinate);
      joined.setAttribute("uv", new T.BufferAttribute(uvs, 2));
    }
    const input = simplifyInputs(joined);
    for (const batch of groups)
      if (batch.ratio === undefined) pooled += batch.count / 3;
      else {
        batch.result = simplify(joined, batch, batch.ratio, input);
        count += batch.result.length / 3;
      }
    original.dispose();
    work.push({ mesh, groups, joined, input });
  }
  const left = Math.min(0.55 * pooled, Math.max(0, triangles - count));
  for (const { mesh, groups, joined, input } of work) {
    const pool = groups.filter((batch) => !batch.result);
    if (pool.length)
      simplifyPool(
        joined,
        pool,
        (left * pool.reduce((n, batch) => n + batch.count / 3, 0)) / pooled,
        input,
      );
    for (const batch of pool) count += (batch.result?.length ?? 0) / 3;
    for (const batch of groups)
      shares.push({
        material: batch.material,
        initial: batch.count / 3,
        triangles: (batch.result?.length ?? 0) / 3,
      });
    // Human complexion faces transfer their normals and occlusion into the
    // atlas; a traced portrait face has no face layout and needs neither.
    if (mesh.userData["faceSurface"]) {
      const normalCanvas = imageOf(page.material.normalMap);
      const occlusionCanvas = useContact ? imageOf(page.material.aoMap) : undefined;
      const normalAtlas =
        normalCanvas instanceof HTMLCanvasElement
          ? context2d(normalCanvas, { willReadFrequently: true })
          : undefined;
      const occlusionAtlas =
        occlusionCanvas instanceof HTMLCanvasElement
          ? context2d(occlusionCanvas, { willReadFrequently: true })
          : undefined;
      const index = joined.getIndex();
      for (const batch of groups) {
        if (!flag(batch.material, "faceLayout") || !index) continue;
        const tile = tiles.get(batch.material)?.uv;
        if (!tile) throw new Error("A game material has no atlas tile.");
        const [x, y, w, h] = tile;
        const original = index.array.subarray(batch.start, batch.start + batch.count);
        const result = batch.result ?? original;
        if (normalAtlas && result.length !== batch.count) {
          const region = normalAtlas.getImageData(x, y, w, h);
          transferFaceNormals(region.data, w, h, joined, original, result);
          normalAtlas.putImageData(region, x, y);
        }
        if (occlusionAtlas && imageOf(batch.material.aoMap)) {
          const region = occlusionAtlas.getImageData(x, y, w, h);
          bakeFaceOcclusion(region.data, w, h, joined, original);
          occlusionAtlas.putImageData(region, x, y);
        }
      }
    }
    mesh.geometry = remap(joined, groups, tiles, size);
    mesh.material = page.material;
    joined.dispose();
  }
  if (useContact) bakeContact(work, size);
  return { ...page, initial, triangles: count, shares };
}
