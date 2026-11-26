import * as T from "three";
import { context2d, type Raster, type RasterImage } from "../raster.js";
import { builtinFaces, headContour } from "../surfaces/head.js";

export interface FacePaint {
  readonly raster: Raster;
  readonly cells: ReadonlyArray<{
    readonly canvas: HTMLCanvasElement;
    readonly texture: T.CanvasTexture;
  }>;
  readonly tinted: Map<string, T.CanvasTexture>;
}

const item = <V>(list: ArrayLike<V>, i: number): V => {
  const v = list[i];
  if (v === undefined) throw new Error("Face paint index out of range.");
  return v;
};

export function prepareFacePaint(raster: Raster, image: RasterImage): FacePaint {
  const source = raster.canvas(image.width, image.height);
  const ctx = context2d(source, { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, source.width, source.height).data;
  const cells: Array<{ canvas: HTMLCanvasElement; texture: T.CanvasTexture }> = [];
  for (let cell = 0; cell < 4; cell++) {
    const canvas = raster.canvas(640, 384);
    const target = context2d(canvas);
    const result = target.createImageData(canvas.width, canvas.height);
    const ox = ((cell % 2) * source.width) / 2;
    const oy = (Math.floor(cell / 2) * source.height) / 2;
    const sample = (u: number, v: number, k: number): number => {
      const x = Math.min(source.width - 1, Math.max(0, Math.floor(ox + (u * source.width) / 2)));
      const y = Math.min(source.height - 1, Math.max(0, Math.floor(oy + (v * source.height) / 2)));
      return pixels[(y * source.width + x) * 4 + k] ?? 0;
    };
    for (let y = 0; y < canvas.height; y++) {
      const t = 1 - y / (canvas.height - 1);
      let r = 1;
      while (r < headContour.length - 1 && item(headContour, r)[0] < t) r++;
      const p = item(headContour, r - 1);
      const q = item(headContour, r);
      const width = T.MathUtils.lerp(p[1], q[1], (t - p[0]) / (q[0] - p[0]));
      for (let x = 0; x < canvas.width; x++) {
        const angle = (x / (canvas.width - 1)) * Math.PI * 2 - Math.PI;
        const front = T.MathUtils.smoothstep(Math.cos(angle), -0.05, 0.58);
        const u = 0.5 + ((width * Math.sin(angle)) / 0.195) * 0.64;
        const v = 0.958 - t * 0.949;
        const off = (y * canvas.width + x) * 4;
        for (let k = 0; k < 3; k++) {
          const rear = sample(
            0.48 + 0.052 * Math.sin(angle * 6),
            0.156 + 0.028 * Math.sin(t * 12),
            k,
          );
          result.data[off + k] = T.MathUtils.lerp(rear, sample(u, v, k), front);
        }
        result.data[off + 3] = 255;
      }
    }
    target.putImageData(result, 0, 0);
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    texture.anisotropy = 4;
    cells.push({ canvas, texture });
  }
  return { raster, cells, tinted: new Map() };
}

export function faceTexture(paint: FacePaint, cell: 0 | 1 | 2 | 3, skin: string): T.CanvasTexture {
  const study = item(paint.cells, cell);
  const reference = item(builtinFaces, cell).skin;
  if (skin.toLowerCase() === reference) return study.texture;
  const key = cell + skin;
  const cached = paint.tinted.get(key);
  if (cached) return cached;
  const image = study.canvas;
  const canvas = paint.raster.canvas(image.width, image.height);
  const ctx = context2d(canvas, { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const ref = new T.Color(reference);
  const target = new T.Color(skin);
  const ratio = [target.r / ref.r, target.g / ref.g, target.b / ref.b];
  const lut = ratio.map((f) =>
    Array.from({ length: 256 }, (_, v) => {
      const srgb = v / 255;
      const linear = srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
      const val = Math.min(1, linear * f);
      return Math.round(255 * (val <= 0.0031308 ? 12.92 * val : 1.055 * val ** (1 / 2.4) - 0.055));
    }),
  );
  for (let i = 0; i < pixels.data.length; i += 4)
    for (let k = 0; k < 3; k++) pixels.data[i + k] = item(item(lut, k), pixels.data[i + k] ?? 0);
  ctx.putImageData(pixels, 0, 0);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;
  paint.tinted.set(key, texture);
  return texture;
}
