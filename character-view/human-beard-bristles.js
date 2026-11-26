import * as T from "three";
import { randomStream } from "./random.js";
import { beardTexture } from "./human-beard-texture.js";

const SIZE = 512;
const row = (y, w, h, n, x = 0) => Array.from({ length: n }, (_, i) => [x + i * w, y, w, h]);

export const BRISTLE_TILES = {
  dense: row(0, 64, 128, 4),
  medium: row(0, 64, 128, 2, 256),
  thatch: row(0, 64, 128, 2, 384),
  sparse: row(128, 64, 128, 4),
  single: row(128, 64, 128, 4, 256),
  fringe: [...row(256, 128, 64, 4), ...row(320, 128, 64, 4)],
  fringeSparse: [...row(384, 128, 64, 4), ...row(448, 128, 64, 4)],
};
export const BRISTLE_SIZE = SIZE;

const GUTTER = 3;
let cached = null;

export function bristlePixels() {
  if (cached) return cached;
  const tone = new Float32Array(SIZE * SIZE).fill(0.8),
    alpha = new Float32Array(SIZE * SIZE),
    height = new Float32Array(SIZE * SIZE);
  const next = randomStream(0x5b12e7a3);
  const between = (a, b) => a + (b - a) * next();
  const layerAlpha = new Float32Array(SIZE * SIZE), layerRise = new Float32Array(SIZE * SIZE);

  function hair([tx, ty, tw, th], x0, y0, angle, length, bend, rootWidth, value) {
    const x1 = tx + GUTTER, x2 = tx + tw - GUTTER, y1 = ty + GUTTER, y2 = ty + th - GUTTER;
    const dx = Math.sin(angle), dy = -Math.cos(angle);
    const cx = x0 + dx * length * 0.5 - dy * bend, cy = y0 + dy * length * 0.5 + dx * bend;
    const ex = x0 + dx * length, ey = y0 + dy * length;
    const touched = [];
    const steps = Math.ceil(length * 2.2);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps, u = 1 - t;
      const px = u * u * x0 + 2 * u * t * cx + t * t * ex, py = u * u * y0 + 2 * u * t * cy + t * t * ey;
      const radius = 0.5 * rootWidth * (1 - 0.62 * t ** 2.4) * (0.72 + 0.28 * Math.min(1, t * 9));
      const reach = Math.ceil(radius + 1);
      for (let y = Math.max(y1, Math.floor(py - reach)); y <= Math.min(y2 - 1, Math.ceil(py + reach)); y++)
        for (let x = Math.max(x1, Math.floor(px - reach)); x <= Math.min(x2 - 1, Math.ceil(px + reach)); x++) {
          const d = Math.hypot(x + 0.5 - px, y + 0.5 - py), a = Math.min(1, Math.max(0, radius - d + 0.6));
          if (a <= 0) continue;
          const i = y * SIZE + x;
          if (!layerAlpha[i]) touched.push(i);
          if (a > layerAlpha[i]) layerAlpha[i] = a;
          const rise = Math.sqrt(Math.max(0, 1 - (d / (radius + 0.6)) ** 2)) * (0.55 + 0.45 * t);
          if (rise > layerRise[i]) layerRise[i] = rise;
        }
    }
    for (const i of touched) {
      const a = layerAlpha[i], y = Math.floor(i / SIZE);
      const along = Math.min(1, Math.max(0, (y0 - y) / Math.max(1, y0 - ey)));
      const shade = value * (0.78 + 0.22 * Math.min(1, along * 2.4)) * (0.9 + 0.1 * layerRise[i]);
      tone[i] = tone[i] * (1 - a) + shade * a;
      height[i] = height[i] * (1 - a) + (0.35 + layerRise[i]) * a;
      alpha[i] = alpha[i] + (1 - alpha[i]) * a;
      layerAlpha[i] = layerRise[i] = 0;
    }
  }

  function tuft(tile, count, spread, widths, shortest = 0.42) {
    const [tx, ty, tw, th] = tile, base = ty + th - GUTTER - 1.5;
    const lean = between(-0.07, 0.07);
    const hairs = Array.from({ length: count }, (_, k) => {
      const across = count === 1 ? between(0.4, 0.6) : (k + between(0.15, 0.85)) / count;
      return { across, length: between(shortest, 0.93) * (th - 2 * GUTTER - 6) };
    }).sort((a, b) => a.length - b.length);
    for (const { across, length } of hairs) {
      const x = tx + tw * (0.5 + (across - 0.5) * spread);
      hair(tile, x, base - between(0, 7), lean + (across - 0.5) * 0.3 + between(-0.11, 0.11), length,
        between(-7, 7), between(...widths), between(0.8, 1));
    }
  }

  function fringe(tile, count, widths) {
    const [tx, ty, tw, th] = tile, base = ty + th - GUTTER - 1.5;
    const lean = between(-0.16, 0.16);
    const hairs = Array.from({ length: count }, (_, k) => ({
      x: tx + GUTTER + 5 + (tw - 2 * GUTTER - 10) * ((k + between(0.1, 0.9)) / count),
      length: (next() < 0.3 ? between(0.7, 0.96) : between(0.3, 0.68)) * (th - 2 * GUTTER - 4),
    })).sort((a, b) => a.length - b.length);
    for (const { x, length } of hairs)
      hair(tile, x, base - between(0, 3), lean + between(-0.3, 0.3), length, between(-5, 5), between(...widths), between(0.8, 1));
  }

  for (const tile of BRISTLE_TILES.dense) tuft(tile, 11, 0.74, [5.2, 7.4]);
  for (const tile of BRISTLE_TILES.medium) tuft(tile, 7, 0.7, [5, 7]);
  for (const tile of BRISTLE_TILES.thatch) tuft(tile, 26, 0.94, [5.6, 7.8], 0.72);
  for (const tile of BRISTLE_TILES.sparse) tuft(tile, 4, 0.62, [4.8, 6.6]);
  BRISTLE_TILES.single.forEach((tile, k) => tuft(tile, k < 2 ? 1 : 2, 0.4, [4.8, 6.4]));
  for (const tile of BRISTLE_TILES.fringe) fringe(tile, 15, [4.2, 5.8]);
  for (const tile of BRISTLE_TILES.fringeSparse) fringe(tile, 7, [4.2, 5.6]);

  const data = new Uint8ClampedArray(SIZE * SIZE * 4), normal = new Uint8ClampedArray(SIZE * SIZE * 4),
    rough = new Uint8ClampedArray(SIZE * SIZE * 4);
  const at = (x, y) => height[Math.min(SIZE - 1, Math.max(0, y)) * SIZE + Math.min(SIZE - 1, Math.max(0, x))];
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x, o = 4 * i, value = Math.round(255 * Math.min(1, tone[i]));
      data[o] = data[o + 1] = data[o + 2] = value;
      data[o + 3] = Math.round(255 * Math.min(1, alpha[i]));
      const nx = 0.8 * (at(x - 1, y) - at(x + 1, y)), ny = 0.8 * (at(x, y + 1) - at(x, y - 1));
      const scale = 127.5 / Math.hypot(nx, ny, 1);
      normal[o] = 127.5 + scale * nx; normal[o + 1] = 127.5 + scale * ny; normal[o + 2] = 127.5 + scale; normal[o + 3] = 255;
      rough[o] = 255; rough[o + 1] = 255 * (0.99 - 0.1 * Math.min(1, tone[i])); rough[o + 3] = 255;
    }
  return (cached = { width: SIZE, height: SIZE, data, normal, rough });
}

let maps = null;
export function bristleMaps() {
  if (maps) return maps;
  const { width, height, data, normal, rough } = bristlePixels();
  return (maps = {
    map: beardTexture(data, width, height, "Beard bristles", T.SRGBColorSpace),
    normalMap: beardTexture(normal, width, height, "Beard bristle relief", T.NoColorSpace),
    roughnessMap: beardTexture(rough, width, height, "Beard bristle roughness", T.NoColorSpace),
  });
}
