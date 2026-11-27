import * as T from "three";
import { context2d, type Raster } from "../raster.js";
import { capturedSkinNames } from "./captured.js";
import { capturedAxes } from "./catalogue.js";
import { randomStream } from "./identity.js";
import type { HumanPaint } from "./paint-data.js";

type Rgb = [number, number, number];
const irisTones: Readonly<Record<string, readonly [Rgb, Rgb, Rgb]>> = {
  "dark brown": [
    [66, 40, 25],
    [88, 54, 33],
    [32, 20, 14],
  ],
  brown: [
    [126, 76, 38],
    [130, 83, 47],
    [50, 32, 21],
  ],
  hazel: [
    [172, 119, 55],
    [134, 123, 73],
    [56, 56, 39],
  ],
  amber: [
    [192, 131, 52],
    [170, 118, 57],
    [84, 53, 27],
  ],
  green: [
    [168, 142, 79],
    [114, 140, 96],
    [47, 66, 54],
  ],
  grey: [
    [168, 161, 142],
    [146, 159, 168],
    [62, 75, 86],
  ],
  blue: [
    [178, 176, 152],
    [120, 159, 194],
    [47, 71, 103],
  ],
};
const irisRadius = 0.7;
const white: Rgb = [224, 218, 211];
const smooth = (v: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const at = (a: ArrayLike<number>, i: number) => a[i] ?? 0;

export function defaultEyeColor(skinColour: string, seed: number): string {
  const skin = new T.Color(skinColour),
    light = 0.299 * skin.r + 0.587 * skin.g + 0.114 * skin.b;
  const draw = randomStream((seed >>> 0) ^ 0x51ed27)();
  const pale = T.MathUtils.smoothstep(light, 0.16, 0.42);
  const table: Array<[string, number]> = [
    ["dark brown", 0.42 - 0.3 * pale],
    ["brown", 0.4 - 0.12 * pale],
    ["hazel", 0.1 + 0.06 * pale],
    ["amber", 0.03],
    ["green", 0.03 + 0.09 * pale],
    ["grey", 0.01 + 0.08 * pale],
    ["blue", 0.01 + 0.19 * pale],
  ];
  let total = 0;
  for (const [, w] of table) total += w;
  let left = draw * total;
  for (const [name, w] of table) {
    left -= w;
    if (left <= 0) return name;
  }
  return "brown";
}

function stromaSampler(map: Uint8Array, rotation: number) {
  const width = 192,
    height = 72;
  return (radius: number, angle: number) => {
    const u = (angle / (2 * Math.PI) + rotation + 2) * width;
    const v = Math.min(1, Math.max(0, (radius - 0.31) / 0.69)) * (height - 1);
    const x = Math.floor(u) % width,
      y = Math.floor(v);
    const next = (x + 1) % width,
      top = y * width,
      bottom = Math.min(y + 1, height - 1) * width;
    const fx = u - Math.floor(u),
      fy = v - y;
    const low = at(map, top + x) + fx * (at(map, top + next) - at(map, top + x));
    const high = at(map, bottom + x) + fx * (at(map, bottom + next) - at(map, bottom + x));
    return (low + fy * (high - low) - 128) / 110;
  };
}

export function irisSwatch(paint: HumanPaint, name: string): T.Color {
  const side = 32,
    pixels = irisPixels(paint, name, 0, side),
    i = (side * 16 + Math.round(side * 0.76)) * 4;
  return new T.Color(
    (pixels[i] ?? 0) / 255,
    (pixels[i + 1] ?? 0) / 255,
    (pixels[i + 2] ?? 0) / 255,
  );
}

function irisPixels(
  paint: HumanPaint,
  name: string,
  seed: number,
  size: number,
): Uint8ClampedArray {
  const tones = irisTones[name] ?? irisTones["brown"],
    next = randomStream(seed ^ 0x9e3779b9);
  if (!tones) throw new Error("No iris tones.");
  const map = paint.stroma[Math.floor(next() * paint.stroma.length)] ?? new Uint8Array(0);
  const sample = stromaSampler(map, next());
  const pupil = irisRadius * (0.31 + 0.05 * next()),
    out = new Uint8ClampedArray(size * size * 4);
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const x = ((i + 0.5) / size) * 2 - 1,
        y = 1 - ((j + 0.5) / size) * 2,
        r = Math.hypot(x, y),
        angle = Math.atan2(y, x),
        q = r / irisRadius;
      let c: number[] = white.slice();
      if (q < 1.12) {
        const fibres = sample(q, angle);
        const body = smooth(q, 0.36, 0.66),
          rim = smooth(q, 0.66, 0.98),
          ring = Math.exp(-(((q - 0.46) / 0.09) ** 2)),
          bowl = 1 - 0.2 * smooth(q, 0.5, 0.92);
        const iris = [0, 1, 2].map((k) => {
          let v = at(tones[0], k) + (at(tones[1], k) - at(tones[0], k)) * body;
          v *= (1 + 0.47 * fibres * smooth(q, 0.29, 0.39) * (1 - 0.56 * rim) + 0.12 * ring) * bowl;
          return v + (at(tones[2], k) - v) * rim * 0.88;
        });
        const hole = 1 - smooth(r, pupil - 0.035, pupil + 0.03);
        for (let k = 0; k < 3; k++) iris[k] = at(iris, k) * (1 - hole) + at([9, 8, 9], k) * hole;
        const inside = 1 - smooth(q, 0.9, 1.08),
          halo = 0.1 * (1 - smooth(q, 1, 1.1));
        c = c.map(
          (v, k) => v * (1 - halo * at([1, 0.9, 0.75], k)) * (1 - inside) + at(iris, k) * inside,
        );
      }
      out.set(c.concat(255), (j * size + i) * 4);
    }
  return out;
}

function scleraPixels(seed: number, size: number): Uint8ClampedArray {
  const next = randomStream(seed ^ 0x2c1b3c6d),
    out = new Uint8ClampedArray(size * size * 4);
  const vessels = Array.from({ length: 14 }, (_, k) => {
    const from = k % 2 ? 1 : -1,
      y = (next() - 0.5) * 0.7;
    return {
      from,
      y,
      slope: (next() - 0.5) * 0.5,
      reach: 0.25 + 0.4 * next(),
      wave: 3 + 5 * next(),
      phase: 6.283 * next(),
      gain: 0.5 + 0.5 * next(),
    };
  });
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const x = ((i + 0.5) / size) * 2 - 1,
        y = 1 - ((j + 0.5) / size) * 2;
      const mottle =
        0.012 * (Math.sin(7.3 * x + 2.1 * y + seed) + Math.sin(5.1 * y - 3.7 * x + 1.3 * seed));
      let red = 0;
      for (const v of vessels) {
        const along = v.from > 0 ? 1 - x : x + 1,
          centre = v.y + v.slope * along + 0.03 * Math.sin(v.wave * along + v.phase);
        red = Math.max(
          red,
          v.gain *
            (1 - smooth(along, 0.6 * v.reach, v.reach)) *
            (1 - smooth(Math.abs(y - centre), 0.004, 0.02)),
        );
      }
      out.set(
        [
          white[0] * (1 + mottle),
          white[1] * (1 + mottle - 0.07 * red),
          white[2] * (1 + mottle - 0.09 * red),
          255,
        ],
        (j * size + i) * 4,
      );
    }
  return out;
}

function texture(
  raster: Raster,
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  srgb: boolean,
): T.CanvasTexture {
  const canvas = raster.canvas(width, height);
  context2d(canvas).putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
  const map = new T.CanvasTexture(canvas);
  if (srgb) map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = 4;
  map.needsUpdate = true;
  return map;
}

const caches = new WeakMap<HumanPaint, Map<string, T.CanvasTexture>>();
function cached(paint: HumanPaint, key: string, make: () => T.CanvasTexture): T.CanvasTexture {
  let cache = caches.get(paint);
  if (!cache) caches.set(paint, (cache = new Map<string, T.CanvasTexture>()));
  let found = cache.get(key);
  if (!found) cache.set(key, (found = make()));
  return found;
}

export function eyeTexture(
  raster: Raster,
  paint: HumanPaint,
  name: string,
  seed: number,
  complexion: string | undefined,
): T.CanvasTexture {
  const k = complexion === undefined ? -1 : capturedSkinNames.indexOf(complexion);
  const axis = k >= 0 ? capturedAxes[k] : undefined;
  const key = "eye/" + name + "/" + seed + (axis ? "/" + (complexion ?? "") : "");
  return cached(paint, key, () => {
    const size = 256,
      pixels = new Uint8ClampedArray(2 * size * size * 4);
    const front = irisPixels(paint, name, seed, size),
      back = scleraPixels(seed, size);
    if (axis) {
      const values = paint.capturedIris(axis),
        captureSize = 96;
      const tint = (irisTones[name] ?? irisTones["brown"])?.[1] ?? [0, 0, 0];
      const sclera = [0.9, 0.88, 0.87];
      const sample = (value: number) =>
        Math.min(captureSize - 1, Math.max(0, Math.floor(((value + 1) * captureSize) / 2)));
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const u = (((x + 0.5) / size) * 2 - 1) / irisRadius,
            v = (((y + 0.5) / size) * 2 - 1) / irisRadius;
          const radius = Math.hypot(u, v),
            coverage = 1 - smooth(radius, 0.86, 1.04);
          const grain = Math.min(1.45, at(values, sample(v) * captureSize + sample(u)) / 142);
          const offset = 4 * (y * size + x);
          for (let c = 0; c < 3; c++) {
            const iris =
              (radius < 0.29 ? 12 : at(tint, c) * (0.4 + 0.5 * smooth(radius, 0.29, 0.46))) * grain;
            front[offset + c] =
              coverage * iris + (1 - coverage) * at(front, offset + c) * at(sclera, c);
            back[offset + c] = at(back, offset + c) * at(sclera, c);
          }
        }
    }
    for (let j = 0; j < size; j++) {
      pixels.set(front.subarray(j * size * 4, (j + 1) * size * 4), j * 2 * size * 4);
      pixels.set(back.subarray(j * size * 4, (j + 1) * size * 4), (j * 2 + 1) * size * 4);
    }
    return texture(raster, pixels, 2 * size, size, true);
  });
}

const eyeRoughness = { cornea: 0.26, white: 0.5 };
export function eyeRoughnessTexture(raster: Raster, paint: HumanPaint): T.CanvasTexture {
  return cached(paint, "eye/roughness", () => {
    const size = 128,
      pixels = new Uint8ClampedArray(2 * size * size * 4);
    for (let j = 0; j < size; j++)
      for (let i = 0; i < 2 * size; i++) {
        const x = ((i + 0.5) / size) * 2 - 1,
          y = 1 - ((j + 0.5) / size) * 2,
          q = Math.hypot(x, y) / irisRadius;
        const meniscus = i >= size && (j + 0.5) / size < 0.13;
        const wet = i < size ? 1 - smooth(q, 1, 1.1) : 0,
          value = meniscus
            ? 0.15
            : eyeRoughness.white + (eyeRoughness.cornea - eyeRoughness.white) * wet;
        pixels.set([255, Math.round(255 * value), 0, 255], (j * 2 * size + i) * 4);
      }
    return texture(raster, pixels, 2 * size, size, false);
  });
}

export const irisBaseTone = (name: string): Rgb | undefined => irisTones[name]?.[1];
