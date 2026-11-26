import * as T from "three";
import type { Raster, RasterImage } from "../../raster.js";
import type { DressMesh } from "./kit.js";

const drawable = (image: unknown): RasterImage | undefined =>
  (typeof HTMLCanvasElement !== "undefined" && image instanceof HTMLCanvasElement) ||
  (typeof HTMLImageElement !== "undefined" && image instanceof HTMLImageElement) ||
  (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap)
    ? image
    : undefined;

interface Panels {
  readonly geom: T.BufferGeometry;
  readonly boneIndices: Uint8Array;
  readonly weights: Float32Array;
  readonly indices: ReadonlyArray<number>;
  readonly panels: ReadonlyArray<number>;
  readonly source: ReadonlyArray<number>;
}

function foldPanels(piece: DressMesh): Panels | null {
  const g = piece.mesh.geometry,
    p = g.getAttribute("position"),
    uv = g.getAttribute("uv"),
    index = g.getIndex();
  if (!index) return null;
  const groups = [new Map<number, number>(), new Map<number, number>()],
    source: number[] = [],
    panels: number[] = [],
    indices: number[] = [];
  const t = index.array;
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] ?? 0,
      b = t[i + 1] ?? 0,
      c = t[i + 2] ?? 0;
    const side =
      (p.getX(b) - p.getX(a)) * (p.getY(c) - p.getY(a)) -
        (p.getY(b) - p.getY(a)) * (p.getX(c) - p.getX(a)) <
      0
        ? 1
        : 0;
    const group = groups[side];
    if (!group) continue;
    for (let j = i; j < i + 3; j++) {
      const original = t[j] ?? 0;
      let at = group.get(original);
      if (at === undefined) {
        group.set(original, (at = source.length));
        source.push(original);
        panels.push(side);
      }
      indices.push(at);
    }
  }
  const geom = new T.BufferGeometry();
  for (const [key, attr] of Object.entries(g.attributes)) {
    const width = attr.itemSize,
      from = attr.array;
    if (!(from instanceof Float32Array) || attr instanceof T.InterleavedBufferAttribute)
      throw new Error(`A garment's ${key} attribute is not a plain float array.`);
    const arr = new Float32Array(source.length * width);
    for (let i = 0; i < source.length; i++) {
      const s = source[i] ?? 0;
      arr.set(from.subarray(s * width, (s + 1) * width), i * width);
    }
    geom.setAttribute(key, new T.BufferAttribute(arr, width, attr.normalized));
  }
  const joined = geom.getAttribute("uv");
  for (let i = 0; i < source.length; i++)
    joined.setX(i, ((panels[i] ?? 0) + uv.getX(source[i] ?? 0)) * 0.5);
  geom.setIndex(indices);
  const boneIndices = new Uint8Array(source.length * 4),
    weights = new Float32Array(source.length * 4);
  for (let i = 0; i < source.length; i++) {
    const s = source[i] ?? 0;
    boneIndices.set(piece.boneIndices.subarray(4 * s, 4 * s + 4), 4 * i);
    weights.set(piece.weights.subarray(4 * s, 4 * s + 4), 4 * i);
  }
  return { geom, boneIndices, weights, indices, panels, source };
}

function rasterFolds(
  panel: Panels,
  source: T.BufferGeometry,
  heights: Float32Array,
  w: number,
  h: number,
): Float32Array {
  const { indices, panels } = panel,
    pos = source.getAttribute("position"),
    uv = source.getAttribute("uv");
  const zbuf = new Float32Array(2 * w * h).fill(-Infinity),
    folds = new Float32Array(2 * w * h);
  const height = (v: number) => heights[v] ?? 0;
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] ?? 0,
      a = panel.source[ia] ?? 0,
      b = panel.source[indices[i + 1] ?? 0] ?? 0,
      c = panel.source[indices[i + 2] ?? 0] ?? 0;
    const side = panels[ia] ?? 0,
      sx = uv.getX(a) * w,
      sy = (1 - uv.getY(a)) * h;
    const bx = uv.getX(b) * w - sx,
      by = (1 - uv.getY(b)) * h - sy;
    const cx = uv.getX(c) * w - sx,
      cy = (1 - uv.getY(c)) * h - sy;
    const area = bx * cy - cx * by;
    if (Math.abs(area) < 1e-7) continue;
    const loX = Math.max(0, Math.floor(sx + Math.min(0, bx, cx))),
      hiX = Math.min(w - 1, Math.ceil(sx + Math.max(0, bx, cx)));
    const loY = Math.max(0, Math.floor(sy + Math.min(0, by, cy))),
      hiY = Math.min(h - 1, Math.ceil(sy + Math.max(0, by, cy)));
    for (let y = loY; y <= hiY; y++)
      for (let x = loX; x <= hiX; x++) {
        const dx = x + 0.5 - sx,
          dy = y + 0.5 - sy,
          v = (dx * cy - dy * cx) / area,
          k = (dy * bx - dx * by) / area,
          u = 1 - v - k;
        if (Math.min(u, v, k) < -0.0001) continue;
        const z = (u * pos.getZ(a) + v * pos.getZ(b) + k * pos.getZ(c)) * (side ? -1 : 1);
        const at = y * 2 * w + side * w + x;
        if (z >= (zbuf[at] ?? -Infinity)) {
          zbuf[at] = z;
          folds[at] = u * height(a) + v * height(b) + k * height(c);
        }
      }
  }
  for (let pass = 0; pass < 2; pass++) {
    const from = zbuf.slice();
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < 2 * w - 1; x++) {
        const at = y * 2 * w + x;
        if (from[at] !== -Infinity) continue;
        for (const off of [-1, 1, -2 * w, 2 * w])
          if (from[at + off] !== -Infinity) {
            zbuf[at] = from[at + off] ?? 0;
            folds[at] = folds[at + off] ?? 0;
            break;
          }
      }
  }
  return folds;
}

export function bakeGameFolds(raster: Raster, piece: DressMesh): DressMesh {
  const mesh = piece.mesh,
    m = mesh.material,
    source = mesh.geometry,
    heights = piece.foldMetres;
  if (!heights || !(m instanceof T.MeshStandardMaterial)) return piece;
  const map = drawable(m.map?.image),
    bump = drawable(m.bumpMap?.image);
  if (
    !map ||
    !bump ||
    m.normalMap ||
    m.roughnessMap !== m.bumpMap ||
    !source.getAttribute("uv") ||
    !source.getIndex()
  )
    return piece;
  const w = Math.min(448, map.width),
    h = Math.min(560, map.height);
  if (w < 8 || h < 8) return piece;
  const color = raster.canvas(2 * w, h),
    rel = raster.canvas(2 * w, h);
  const paint = color.getContext("2d"),
    relief = rel.getContext("2d");
  if (!paint || !relief) return piece;
  const panel = foldPanels(piece);
  if (!panel) return piece;
  const fold = rasterFolds(panel, source, heights, w, h);
  for (let s = 0; s < 2; s++) {
    paint.drawImage(map, s * w, 0, w, h);
    relief.drawImage(bump, s * w, 0, w, h);
  }
  const image = paint.getImageData(0, 0, 2 * w, h),
    surface = relief.getImageData(0, 0, 2 * w, h);
  const scale = 0.034,
    yarn = m.bumpScale;
  const worn = /denim|jeans/i.test(m.name);
  const stride = 2 * w,
    reach = Math.max(2, Math.round(h / 60));
  const at = (i: number) => fold[i] ?? 0;
  for (let i = 0; i < fold.length; i++) {
    const j = 4 * i,
      delta = at(i);
    const yarnHeight = ((surface.data[j] ?? 0) / 255 - 0.5) * yarn;
    surface.data[j] = 255 * Math.max(0, Math.min(1, 0.5 + (yarnHeight + delta * 1.65) / scale));
    const x = i % w,
      y = Math.floor(i / stride);
    const left = at(i - Math.min(x, reach)),
      right = at(i + Math.min(w - 1 - x, reach));
    const up = at(i - stride * Math.min(y, reach)),
      down = at(i + stride * Math.min(h - 1 - y, reach));
    const pocket = Math.max(0, (left + right + up + down) * 0.25 - delta);
    const cavity = Math.min(1, Math.max(0, -delta) / 0.006 + pocket / 0.0035);
    const crest = worn ? Math.max(0, Math.min(1, delta / 0.004)) : 0;
    const shade = 1 - 0.23 * cavity + 0.09 * crest;
    for (let c = 0; c < 3; c++) image.data[j + c] = (image.data[j + c] ?? 0) * shade;
  }
  paint.putImageData(image, 0, 0);
  relief.putImageData(surface, 0, 0);
  const diffuse = new T.CanvasTexture(color),
    detail = new T.CanvasTexture(rel);
  diffuse.colorSpace = T.SRGBColorSpace;
  diffuse.anisotropy = detail.anisotropy = 4;
  m.map = diffuse;
  m.bumpMap = m.roughnessMap = detail;
  m.bumpScale = scale;
  m.addEventListener("dispose", () => {
    diffuse.dispose();
    detail.dispose();
  });
  mesh.geometry = panel.geom;
  source.dispose();
  return { ...piece, boneIndices: panel.boneIndices, weights: panel.weights };
}
