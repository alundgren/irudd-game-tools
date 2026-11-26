// Portrait plates painted onto a fitted face. Ported from rasterTriangles and
// backdropOpacity in character-view/portrait-plate.js and from
// paintSidePortrait and applyPortraitPlates in character-view/side-portrait.js
// at 2761eb1, arithmetic in the same order so the textures match.
//
// A side plate is a photograph registered in head space by its brow, ear and
// chin, then sampled into the face's and ears' existing UV layout. A front
// plate is already in the face's UV layout and is drawn over it. Both survive
// an ordinary glTF export without a shader.

import * as T from "three";
import { rasterMediaTypes, type Digest, type SidePlate } from "@irudd/document";
import type { AssetResolver } from "../assets.js";
import { isMesh } from "../mesh.js";
import { context2d, drawable, type Raster, type RasterImage } from "../raster.js";

type Visit = (
  pixel: number,
  a: number,
  b: number,
  c: number,
  l: number,
  s: number,
  t: number,
) => void;

const at = (list: ArrayLike<number>, i: number): number => list[i] ?? 0;

/**
 * Visit each pixel centre inside each triangle of `geometry` at the pixel-edge
 * coordinates `xy`, with the vertices and their barycentric weights.
 */
export function rasterTriangles(
  geometry: T.BufferGeometry,
  xy: ArrayLike<number>,
  width: number,
  height: number,
  visit: Visit,
): void {
  const indices = geometry.index;
  const total = indices?.count ?? geometry.getAttribute("position").count;
  for (let f = 0; f < total; f += 3) {
    const a = indices ? indices.getX(f) : f;
    const b = indices ? indices.getX(f + 1) : f + 1;
    const c = indices ? indices.getX(f + 2) : f + 2;
    const ax = at(xy, 2 * a);
    const ay = at(xy, 2 * a + 1);
    const bx = at(xy, 2 * b);
    const by = at(xy, 2 * b + 1);
    const cx = at(xy, 2 * c);
    const cy = at(xy, 2 * c + 1);
    const ux = bx - ax;
    const uy = by - ay;
    const vx = cx - ax;
    const vy = cy - ay;
    const det = ux * vy - uy * vx;
    if (Math.abs(det) < 1e-8) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const x1 = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const y1 = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const rx = x + 0.5 - ax;
        const ry = y + 0.5 - ay;
        const s = (rx * vy - ry * vx) / det;
        const t = (ry * ux - rx * uy) / det;
        const l = 1 - s - t;
        if (Math.min(s, t, l) >= -1e-6) visit(y * width + x, a, b, c, l, s, t);
      }
  }
}

/**
 * The opacity of pixel `j` against its scanline's backdrop, whose ends are
 * `first` and `last`. A plain or transparent backdrop keeps its boundary; on a
 * chroma key its dominant colour is suppressed even in mixed edge pixels.
 */
export function backdropOpacity(
  rgb: ArrayLike<number>,
  j: number,
  first: number,
  last: number,
): number {
  const delta = (a: number, b: number) =>
    Math.max(
      Math.abs(at(rgb, a) - at(rgb, b)),
      Math.abs(at(rgb, a + 1) - at(rgb, b + 1)),
      Math.abs(at(rgb, a + 2) - at(rgb, b + 2)),
    );
  if (delta(first, last) > 38) return 1;
  const distance = Math.min(delta(j, first), delta(j, last));
  let channel = 0;
  for (let k = 1; k < 3; k++) if (at(rgb, first + k) > at(rgb, first + channel)) channel = k;
  const other1 = (channel + 1) % 3;
  const other2 = (channel + 2) % 3;
  const chroma = (i: number) =>
    at(rgb, i + channel) - Math.max(at(rgb, i + other1), at(rgb, i + other2));
  const key = chroma(first);
  const spill = key > 18 ? T.MathUtils.smoothstep(chroma(j) / key, 0.1, 0.57) : 0;
  return T.MathUtils.smoothstep(distance, 28, 66) * (1 - spill);
}

interface SidePixels {
  readonly rgba: Uint8ClampedArray;
  readonly left: Int32Array;
  readonly right: Int32Array;
  readonly w: number;
  readonly h: number;
}

/** The plate's pixels and, per row, the first and last pixels off its backdrop. */
function sidePixels(raster: Raster, image: RasterImage): SidePixels {
  const w = image.width;
  const h = image.height;
  const canvas = raster.canvas(w, h);
  const ctx = context2d(canvas, { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const left = new Int32Array(h).fill(w);
  const right = new Int32Array(h).fill(-1);
  // Compare each border to its own scanline. A plain background may have a slight gradient.
  for (let y = 0; y < h; y++) {
    const first = 4 * y * w;
    const last = first + 4 * (w - 1);
    const differs = (i: number, b: number) =>
      Math.max(
        Math.abs(at(rgba, i) - at(rgba, b)),
        Math.abs(at(rgba, i + 1) - at(rgba, b + 1)),
        Math.abs(at(rgba, i + 2) - at(rgba, b + 2)),
      ) > 38;
    for (let x = 1; x < w - 1; x++) {
      const i = first + 4 * x;
      if (at(rgba, i + 3) > 100 && differs(i, first) && differs(i, last)) {
        left[y] = x;
        break;
      }
    }
    for (let x = w - 2; x >= at(left, y); x--) {
      const i = first + 4 * x;
      if (at(rgba, i + 3) > 100 && differs(i, first) && differs(i, last)) {
        right[y] = x;
        break;
      }
    }
  }
  return { rgba, left, right, w, h };
}

function standard(mesh: T.Mesh): T.MeshStandardMaterial {
  const material: T.Material | T.Material[] = mesh.material;
  if (!(material instanceof T.MeshStandardMaterial))
    throw new Error("A portrait plate paints a single standard material.");
  return material;
}

/**
 * A canvas of `mesh`'s current colour: its map, or its plain colour. A canvas
 * that is read back asks for frequent reads, as G0's does, since that choice
 * selects how the browser resamples.
 */
function baseCanvas(raster: Raster, mesh: T.Mesh, width: number, height: number, read: boolean) {
  const material = standard(mesh);
  const canvas = raster.canvas(width, height);
  const ctx = context2d(canvas, read ? { willReadFrequently: true } : undefined);
  const source = drawable(material.map?.image);
  if (source) ctx.drawImage(source, 0, 0, width, height);
  else {
    ctx.fillStyle = "#" + material.color.getHexString();
    ctx.fillRect(0, 0, width, height);
  }
  return { canvas, ctx };
}

/** The textures plates make, for the character to dispose. */
export type PlateTextures = T.Texture[];

function usePortraitTexture(
  mesh: T.Mesh,
  canvas: HTMLCanvasElement,
  made: PlateTextures,
  ear = false,
): void {
  const material = standard(mesh);
  const oldMap = material.map;
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.name = "Registered side portrait";
  const copy = material.clone();
  if (!oldMap) copy.color.set(0xffffff);
  if (oldMap && oldMap === material.emissiveMap) copy.emissiveMap = texture;
  if (mesh.userData["ownedPortraitTexture"]) {
    oldMap?.dispose();
    material.dispose();
  }
  copy.userData["portrait"] = true;
  copy.userData["portraitPlate"] = !ear;
  copy.map = texture;
  mesh.material = copy;
  mesh.userData["ownedPortraitTexture"] = true;
  made.push(texture);
}

type Sample = (
  x: number,
  y: number,
  z: number,
  ear: boolean,
  out: Uint8ClampedArray,
  i: number,
) => void;

function bakeMesh(
  raster: Raster,
  mesh: T.Mesh,
  face: T.Mesh,
  sample: Sample,
  made: PlateTextures,
  ear = false,
): void {
  const g = mesh.geometry;
  const p = g.getAttribute("position");
  const uv = g.getAttribute("uv");
  if (!uv) return;
  const width = ear ? 256 : 896;
  const height = ear ? 256 : 640;
  const { canvas, ctx } = baseCanvas(raster, mesh, width, height, true);
  const output = ctx.getImageData(0, 0, width, height);
  const rgb = output.data;
  const toFace = new T.Matrix4().multiplyMatrices(
    face.matrixWorld.clone().invert(),
    mesh.matrixWorld,
  );
  const xy = new Float32Array(2 * p.count);
  const xyz = new Float32Array(3 * p.count);
  const v = new T.Vector3();
  for (let i = 0; i < p.count; i++) {
    xy[2 * i] = uv.getX(i) * width;
    xy[2 * i + 1] = (1 - uv.getY(i)) * height;
    v.fromBufferAttribute(p, i)
      .applyMatrix4(toFace)
      .toArray(xyz, 3 * i);
  }
  rasterTriangles(g, xy, width, height, (pixel, a, b, d, l, s, t) => {
    sample(
      l * at(xyz, 3 * a) + s * at(xyz, 3 * b) + t * at(xyz, 3 * d),
      l * at(xyz, 3 * a + 1) + s * at(xyz, 3 * b + 1) + t * at(xyz, 3 * d + 1),
      l * at(xyz, 3 * a + 2) + s * at(xyz, 3 * b + 2) + t * at(xyz, 3 * d + 2),
      ear,
      rgb,
      pixel * 4,
    );
  });
  ctx.putImageData(output, 0, 0);
  usePortraitTexture(mesh, canvas, made, ear);
}

/** The side contour a finishing profile fit measured, in face-local units. */
export interface SideFrame {
  readonly brow: number;
  readonly chin: number;
  readonly front: number;
}

/**
 * Sample the side plate `image`, registered by `plate`, onto the sides of
 * `face` and onto the ears `owner` carries.
 */
export function paintSidePortrait(
  raster: Raster,
  face: T.Mesh,
  owner: T.Object3D,
  frame: SideFrame,
  plate: SidePlate,
  image: RasterImage,
  made: PlateTextures,
): void {
  owner.updateWorldMatrix(true, true);
  const { rgba, left, right, w, h } = sidePixels(raster, image);
  const { brow, chin, front } = frame;
  const box = face.geometry.boundingBox;
  if (!box) throw new Error("A side plate needs the fitted face's bounds.");
  const minZ = box.min.z;
  const mid = (box.min.x + box.max.x) / 2;
  const half = (box.max.x - box.min.x) / 2;
  const ears = owner.children.filter((c) => c.userData["earSurface"]).filter(isMesh);
  const ear = new T.Vector3(
    mid,
    box.min.y + 0.48 * (box.max.y - box.min.y),
    minZ + 0.48 * (front - minZ),
  );
  const first = ears[0];
  if (first) {
    const wx = new T.Box3().setFromObject(first, true).getCenter(new T.Vector3());
    ear.copy(face.worldToLocal(wx));
  }
  const [bu, bv] = plate.brow;
  const [eu, ev] = plate.ear;
  const span = plate.chinY - bv;
  const earRow = T.MathUtils.clamp(Math.round(ev * (h - 1)), 0, h - 1);
  const far = (plate.facing === "right" ? at(left, earRow) + 3 : at(right, earRow) - 3) / (w - 1);
  const expectedEarV = bv + ((brow - ear.y) / (brow - chin)) * span;
  const mx = 0.5 * (front + minZ);
  const size = Math.max(front - minZ, 1e-6);
  const sample: Sample = (x, y, z, isEar, out, i) => {
    const lateral = Math.abs((x - mid) / half);
    const anterior = (z - minZ) / size;
    const weight = isEar
      ? 1
      : (1 - T.MathUtils.smoothstep(anterior, 0.67, 0.9)) *
        Math.max(
          T.MathUtils.smoothstep(lateral, 0.25, 0.72),
          1 - T.MathUtils.smoothstep(z, minZ, mx),
        );
    if (weight < 0.002) return;
    const earMix = 1 - T.MathUtils.smoothstep(z, ear.z, front);
    const v = bv + ((brow - y) / (brow - chin)) * span + earMix * (ev - expectedEarV);
    if (v <= 0 || v >= 1) return;
    const row = Math.round(v * (h - 1));
    if (at(right, row) - at(left, row) < 5) return;
    const u =
      z >= ear.z
        ? eu + ((bu - eu) * (z - ear.z)) / Math.max(1e-6, front - ear.z)
        : eu + ((far - eu) * (ear.z - z)) / Math.max(1e-6, ear.z - minZ);
    const col = Math.round(T.MathUtils.clamp(u * (w - 1), at(left, row) + 2, at(right, row) - 2));
    const j = 4 * (row * w + col);
    const alpha = weight * backdropOpacity(rgba, j, 4 * row * w, 4 * (row * w + w - 1));
    for (let k = 0; k < 3; k++)
      out[i + k] = Math.round(T.MathUtils.lerp(at(out, i + k), at(rgba, j + k), alpha));
  };
  bakeMesh(raster, face, face, sample, made);
  for (const node of ears) bakeMesh(raster, node, face, sample, made, true);
}

/** Draw the front plates `images`, in order, over `mesh`'s UV paint. */
export function applyPortraitPlates(
  raster: Raster,
  mesh: T.Mesh,
  images: ReadonlyArray<RasterImage>,
  made: PlateTextures,
): void {
  if (!images.length) return;
  const { canvas, ctx } = baseCanvas(raster, mesh, 1280, 800, false);
  for (const image of images) ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  usePortraitTexture(mesh, canvas, made);
}

/** Portrait plates loaded as individual images. */
export interface PortraitPlates {
  readonly raster: Raster;
  readonly image: (plate: Digest) => RasterImage | undefined;
  /** Plates a binding named that did not resolve to raster bytes. */
  readonly missing: ReadonlyArray<Digest>;
}

/** Resolve and decode every plate `digests` names. Unresolvable plates are listed, not thrown. */
export async function loadPortraitPlates(
  raster: Raster,
  assets: AssetResolver,
  digests: Iterable<Digest>,
): Promise<PortraitPlates> {
  const images = new Map<Digest, RasterImage>();
  const missing: Digest[] = [];
  for (const digest of new Set(digests)) {
    const resolved = assets.resolve(digest);
    if (!resolved || !rasterMediaTypes.some((t) => t === resolved.mediaType)) {
      missing.push(digest);
      continue;
    }
    images.set(digest, await raster.image(resolved.bytes, resolved.mediaType));
  }
  return { raster, image: (plate) => images.get(plate), missing };
}
