import * as T from "three";
import type { Digest } from "@irudd/document";
import { bundledAssetNamed, type AssetResolver } from "../assets.js";
import { context2d, type Raster } from "../raster.js";
import { randomStream } from "../random.js";
import { prepareFacePaint, type FacePaint } from "../paint/faces.js";

export type SurfaceKind =
  | "plain"
  | "canvas"
  | "satin"
  | "leather"
  | "metal"
  | "scales"
  | "horn"
  | "fur"
  | "jacket"
  | "strands"
  | "scalp"
  | "wing"
  | "feathered wing";

export const swatchSheet = new WeakMap<T.Texture, Digest>();

export const leatherHeightImage = new WeakMap<T.Texture, HTMLCanvasElement>();

function drawnFrom(texture: T.Texture, sheet: string): void {
  const asset = bundledAssetNamed(sheet);
  if (!asset) throw new Error(`This build does not ship the ${sheet} sheet.`);
  swatchSheet.set(texture, asset.digest);
}

export interface SurfaceKit {
  readonly raster: Raster;
  readonly textures: Map<SurfaceKind, T.Texture>;
  readonly roughness: ReadonlyMap<SurfaceKind, T.Texture>;
  readonly faces: FacePaint;
  dispose(): void;
}

function shortFur(raster: Raster): T.Texture {
  const size = 384;
  const canvas = raster.canvas(size, size);
  const ctx = context2d(canvas);
  ctx.fillStyle = "#b4b4b4";
  ctx.fillRect(0, 0, size, size);
  const draw = randomStream(0x7b19037a);
  for (let i = 0; i < 14500; i++) {
    const x = draw() * size;
    const y = draw() * size;
    const sweep = Math.sin(((x / size) * 4 + y / size) * Math.PI * 2);
    const dx = sweep * 4.2 + (draw() - 0.5) * 8;
    const dy = 4 + 13 * draw();
    const radius = 0.3 + draw() * 0.8;
    const value = Math.round(136 + draw() * 105);
    ctx.fillStyle = `rgb(${value},${value},${value})`;
    const xs = [x];
    if (Math.min(x, x + dx) - radius < 0) xs.push(x + size);
    if (Math.max(x, x + dx) + radius > size) xs.push(x - size);
    const ys = y + dy > size ? [y, y - size] : [y];
    for (const px of xs)
      for (const py of ys) {
        ctx.beginPath();
        ctx.moveTo(px - radius, py);
        ctx.quadraticCurveTo(px + dx * 0.35 - radius, py + dy * 0.7, px + dx, py + dy);
        ctx.quadraticCurveTo(px + dx * 0.55 + radius, py + dy * 0.55, px + radius, py);
        ctx.closePath();
        ctx.fill();
      }
  }
  const map = new T.CanvasTexture(canvas);
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}

async function bundledImage(raster: Raster, assets: AssetResolver, name: string) {
  const asset = bundledAssetNamed(name);
  const resolved = asset && assets.resolve(asset.digest);
  if (!resolved) throw new Error(`The bundled ${name} surface sheet is not available.`);
  return raster.image(resolved.bytes, resolved.mediaType);
}

export async function loadSurfaces(raster: Raster, assets: AssetResolver): Promise<SurfaceKit> {
  const textures = new Map<SurfaceKind, T.Texture>();
  const roughness = new Map<SurfaceKind, T.Texture>();
  for (const [key, frequency] of [
    ["strands", 11],
    ["scalp", 108],
  ] as const) {
    const c = raster.canvas(key === "scalp" ? 1024 : 192, 128);
    const ctx = context2d(c);
    const im = ctx.createImageData(c.width, c.height);
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++) {
        const u = x / c.width;
        const v = y / c.height;
        const w = 2 * Math.PI * (u * frequency + 0.085 * Math.sin(2 * Math.PI * (2 * v + u)));
        const fiber =
          0.52 * Math.sin(w) + 0.32 * Math.sin(3 * w + 1.1) + 0.16 * Math.sin(5 * w + 0.6);
        const level = Math.round(218 + 31 * fiber + 5 * Math.sin(2 * Math.PI * (v + 3 * u)));
        const i = (x + y * c.width) * 4;
        im.data[i] = im.data[i + 1] = im.data[i + 2] = level;
        im.data[i + 3] = 255;
      }
    ctx.putImageData(im, 0, 0);
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace;
    t.wrapS = T.RepeatWrapping;
    t.anisotropy = 4;
    textures.set(key, t);
  }
  const [image, jacket, horn, faceSheet] = await Promise.all(
    ["surfaces", "jacket", "horn", "faces"].map((name) => bundledImage(raster, assets, name)),
  );
  if (!image || !jacket || !horn || !faceSheet) throw new Error("The surface sheets did not load.");
  const hornCanvas = raster.canvas(horn.width, horn.height);
  const hornContext = context2d(hornCanvas, { willReadFrequently: true });
  hornContext.drawImage(horn, 0, 0);
  const hornData = hornContext.getImageData(0, 0, horn.width, horn.height);
  for (let i = 0; i < hornData.data.length; i += 4) {
    const r = hornData.data[i] ?? 0;
    const g = hornData.data[i + 1] ?? 0;
    const b = hornData.data[i + 2] ?? 0;
    const value = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    for (let j = 0; j < 3; j++)
      hornData.data[i + j] = Math.min(
        255,
        28 + 0.92 * value + 0.26 * ((hornData.data[i + j] ?? 0) - value),
      );
  }
  hornContext.putImageData(hornData, 0, 0);
  const hornMap = new T.CanvasTexture(hornCanvas);
  hornMap.name = "Keratin growth rings";
  hornMap.colorSpace = T.SRGBColorSpace;
  hornMap.anisotropy = 4;
  drawnFrom(hornMap, "horn");
  textures.set("horn", hornMap);
  for (const [index, name] of (["canvas", "leather", "metal", "scales"] as const).entries()) {
    const canvas = raster.canvas(256, 256);
    const ctx = context2d(canvas, { willReadFrequently: true });
    ctx.drawImage(
      image,
      ((index % 2) * image.width) / 2,
      (Math.floor(index / 2) * image.height) / 2,
      image.width / 2,
      image.height / 2,
      0,
      0,
      256,
      256,
    );
    const data = ctx.getImageData(0, 0, 256, 256);
    const roughCanvas = name === "leather" ? raster.canvas(256, 256) : null;
    const roughCtx = roughCanvas && context2d(roughCanvas);
    const roughData = roughCtx?.createImageData(256, 256);
    for (let i = 0; i < data.data.length; i += 4) {
      const l =
        0.21 * (data.data[i] ?? 0) +
        0.72 * (data.data[i + 1] ?? 0) +
        0.07 * (data.data[i + 2] ?? 0);
      const value = Math.min(255, Math.max(138, 211 + (l - 136) * 0.58));
      data.data[i] = data.data[i + 1] = data.data[i + 2] = value;
      if (roughData) {
        const norm = (value - 138) / (255 - 138);
        const r = i === 0 ? 0.79 : Math.max(0.64, Math.min(0.98, 0.96 - 0.3 * norm));
        roughData.data[i] = 255;
        roughData.data[i + 1] = Math.round(255 * r);
        roughData.data[i + 2] = 0;
        roughData.data[i + 3] = 255;
      }
    }
    ctx.putImageData(data, 0, 0);
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    texture.wrapS = texture.wrapT = T.RepeatWrapping;
    texture.repeat.set(2, 1);
    texture.anisotropy = 4;
    drawnFrom(texture, "surfaces");
    textures.set(name, texture);
    if (roughCanvas && roughCtx && roughData) {
      const height = raster.canvas(canvas.width, canvas.height);
      context2d(height, { willReadFrequently: false }).putImageData(data, 0, 0);
      leatherHeightImage.set(texture, height);
      roughCtx.putImageData(roughData, 0, 0);
      const roughTex = new T.CanvasTexture(roughCanvas);
      roughTex.wrapS = roughTex.wrapT = T.RepeatWrapping;
      roughTex.repeat.set(2, 1);
      roughTex.anisotropy = 4;
      drawnFrom(roughTex, "surfaces");
      roughness.set(name, roughTex);
    }
  }
  const canvas = raster.canvas(1024, 512);
  const ctx = context2d(canvas, { willReadFrequently: true });
  const src = raster.canvas(jacket.width, jacket.height);
  const sc = context2d(src, { willReadFrequently: true });
  sc.drawImage(jacket, 0, 0);
  const pixels = sc.getImageData(0, 0, src.width, src.height).data;
  const buffer = ctx.createImageData(canvas.width, canvas.height);
  for (let x = 0; x < canvas.width; x++) {
    const theta = (x / canvas.width) * 2 * Math.PI;
    const front = -Math.sin(theta);
    const w = T.MathUtils.smoothstep(front, -0.1, 0.5);
    const pos = 0.5 + Math.cos(theta) * 0.49;
    for (let y = 0; y < canvas.height; y++) {
      const u = y / (canvas.height - 1);
      const frontIx =
        4 * (Math.floor(u * (src.height - 1)) * src.width + Math.floor(pos * (src.width - 1)));
      const backIx =
        4 *
        (Math.floor((0.33 + 0.16 * u) * (src.height - 1)) * src.width +
          Math.floor((0.74 + 0.06 * Math.cos(3 * theta)) * (src.width - 1)));
      const off = (y * canvas.width + x) * 4;
      for (let k = 0; k < 3; k++) {
        const value = T.MathUtils.lerp(pixels[backIx + k] ?? 0, pixels[frontIx + k] ?? 0, w);
        buffer.data[off + k] = Math.min(255, 73 + value);
      }
      buffer.data[off + 3] = 255;
    }
  }
  ctx.putImageData(buffer, 0, 0);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;
  drawnFrom(texture, "jacket");
  textures.set("jacket", texture);
  const faces = prepareFacePaint(raster, faceSheet);
  return {
    raster,
    textures,
    roughness,
    faces,
    dispose() {
      for (const t of textures.values()) t.dispose();
      for (const t of roughness.values()) t.dispose();
      for (const c of faces.cells) c.texture.dispose();
      for (const t of faces.tinted.values()) t.dispose();
    },
  };
}

function roughnessOf(kind: SurfaceKind, hasMap: boolean): number {
  if (kind === "satin") return 0.34;
  if (kind === "metal") return 0.47;
  if (kind === "leather") return hasMap ? 0.56 : 0.44;
  if (kind === "strands" || kind === "scalp") return 0.64;
  return 0.88;
}

function bumpOf(kind: SurfaceKind): number {
  if (kind === "scales") return 0.003;
  if (kind === "leather") return 0.0026;
  if (kind === "canvas") return 0.0022;
  return 0.0007;
}

export function surfaceMaterial(
  kit: SurfaceKit,
  color: string,
  kind: SurfaceKind,
): T.MeshStandardMaterial {
  if (kind === "fur" && !kit.textures.has(kind)) kit.textures.set(kind, shortFur(kit.raster));
  const texture = kit.textures.get(kind);
  const roughMap = kit.roughness.get(kind);
  return new T.MeshStandardMaterial({
    color,
    map: texture ?? null,
    roughness: roughnessOf(kind, Boolean(roughMap)),
    metalness: kind === "metal" ? 0.38 : 0,
    ...(roughMap ? { roughnessMap: roughMap } : {}),
    ...(texture ? { bumpMap: texture, bumpScale: bumpOf(kind) } : {}),
  });
}

export function surfaceMaterials(
  kit: SurfaceKit,
): (color: string, finish: SurfaceKind) => T.Material {
  const cache = new Map<string, T.Material>();
  return (color, finish) => {
    const key = color + finish;
    let material = cache.get(key);
    if (!material) {
      material = surfaceMaterial(kit, color, finish);
      cache.set(key, material);
    }
    return material;
  };
}
