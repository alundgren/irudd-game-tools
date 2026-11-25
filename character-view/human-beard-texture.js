import * as T from "three";
import { unzlibSync } from "three/addons/libs/fflate.module.js";
import grain from "./human-beard-grain-data.json" with { type: "json" };

// The left half of the second row contains transparent edge fibres. The right
// half holds dense short hairs. Both are monochrome so the wearer can dye them.
let cachedPixels = null;
let cachedTexture = null;

/** The four drawn bunches and their thinner edges share one dyeable cutout map. */
export function beardStrandPixels() {
  if (cachedPixels) return cachedPixels;
  const size = grain.size;
  const packed = unzlibSync(
    Uint8Array.from(atob(grain.toneAlpha), (c) => c.charCodeAt(0)),
  );
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const tone = packed[2 * i];
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = tone;
    data[i * 4 + 3] = packed[2 * i + 1];
  }
  return (cachedPixels = { width: size, height: size, data });
}

/** Shared procedural beard strand texture (CanvasTexture in browser, DataTexture in Node). */
export function beardStrandMap() {
  if (cachedTexture) return cachedTexture;
  const { width, height, data } = beardStrandPixels();
  return (cachedTexture = beardTexture(
    data,
    width,
    height,
    "Beard strands",
    T.SRGBColorSpace,
  ));
}

export function beardTexture(data, width, height, name, colourSpace) {
  let texture;
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas
      .getContext("2d")
      .putImageData(new ImageData(data, width, height), 0, 0);
    texture = new T.CanvasTexture(canvas);
  } else {
    const flipped = new Uint8Array(data.length);
    for (let y = 0; y < height; y++) {
      flipped.set(
        data.subarray(y * width * 4, (y + 1) * width * 4),
        (height - 1 - y) * width * 4,
      );
    }
    texture = new T.DataTexture(flipped, width, height, T.RGBAFormat);
    texture.magFilter = T.LinearFilter;
    texture.minFilter = T.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
  }
  texture.name = name;
  texture.colorSpace = colourSpace;
  texture.anisotropy = 4;
  return texture;
}

let beardSurface;
export function beardSurfaceMaps() {
  if (beardSurface) return beardSurface;
  const { width, height, data } = beardStrandPixels();
  const normal = new Uint8ClampedArray(data.length),
    rough = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = 4 * (y * width + x),
        tone = data[i] / 255;
      const at = (xx, yy) => {
        const j = 4 * (yy * width + xx);
        return data[j + 3] > 96 ? data[j] / 255 : tone;
      };
      const nx =
        1.15 * (at(Math.max(0, x - 1), y) - at(Math.min(width - 1, x + 1), y));
      const ny =
        1.15 * (at(x, Math.min(height - 1, y + 1)) - at(x, Math.max(0, y - 1)));
      const scale = 127.5 / Math.hypot(nx, ny, 1);
      normal.set(
        [127.5 + scale * nx, 127.5 + scale * ny, 127.5 + scale, 255],
        i,
      );
      rough.set([255, 255 * (0.88 - 0.35 * tone), 0, 255], i);
    }
  return (beardSurface = {
    normalMap: beardTexture(
      normal,
      width,
      height,
      "Beard fibres",
      T.NoColorSpace,
    ),
    roughnessMap: beardTexture(
      rough,
      width,
      height,
      "Beard roughness",
      T.NoColorSpace,
    ),
  });
}

const clamp = (x) => Math.max(0, Math.min(1, x));
// Coordinates in the dense patch, in pixels with the origin at the top left.
// The face chart runs from forehead to chin along x and from ear to ear along y.
export const bedColumn = (faceY) => 130 + 122 * clamp(faceY);
export const bedRow = (faceX) => 132 + 119 * clamp((faceX - 0.46) / 0.54);

const rootTone = Float32Array.from({ length: 256 }, (_, i) => {
  const value = i / 255;
  return (
    1.72 * (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  );
});
export function beardRootTone(faceX, faceY) {
  const { width, data } = beardStrandPixels();
  return rootTone[
    data[4 * (Math.round(bedRow(faceX)) * width + Math.round(bedColumn(faceY)))]
  ];
}

// Skin paint under a short beard. The growth value rises slowly from bare skin, so the paint
// tapers into the cheek, and is nearly solid in the core where the roots shade each other.
const ease = (v, a, b) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const shortBeardCover = (growth) => 0.94 * ease(growth, 0.05, 0.62);
const lattice = (i, j) => ((Math.imul(i + 911, 374761393) ^ Math.imul(j + 7, 668265263) ^ Math.imul(i * j + 13, 2246822519)) >>> 0) / 4294967296;
function valueNoise(x, y) {
  const i = Math.floor(x), j = Math.floor(y), a = x - i, b = y - j, u = a * a * (3 - 2 * a), v = b * b * (3 - 2 * b);
  return (lattice(i, j) * (1 - u) + lattice(i + 1, j) * u) * (1 - v) + (lattice(i, j + 1) * (1 - u) + lattice(i + 1, j + 1) * u) * v;
}
/**
 * Shade of the roots at a point of the face chart: dark undergrowth with lighter streaks that
 * run the way the hair grows. The chart lies on its side, so growth runs along x.
 */
export function shortBeardRoot(faceX, faceY, moustache = 0, deepen = 0.22) {
  // Over the lip the hair runs out from the middle, which is across the chart.
  const down = valueNoise(faceX * 70, faceY * 260), out = valueNoise(faceX * 250, faceY * 80);
  return (0.34 + 0.46 * (down + (out - down) * clamp(moustache * 1.6)) + 0.12 * valueNoise(faceX * 9, faceY * 40)) * (1 - deepen * clamp(moustache * 1.6));
}
/**
 * How much short-beard hair grows at a point of the face chart, from the moustache, chin and side
 * growth there: 0 bare, 1 full. The skin paint and the hair cards both read this, so no card
 * grows where the skin is bare. The cheek thins over a wide band, a thin strip of stubble joins
 * the cheek to the hair in front of the ear, and the moustache parts under the nose.
 */
export function shortBeardGrowth(faceX, faceY, growth) {
  const lateral = Math.abs(faceY - 0.5) * 2;
  const line = 0.635 - 0.085 * ease(lateral, 0.28, 0.74);
  const wobble = (valueNoise(faceX * 23 + 3, faceY * 23) - 0.5) * 0.05 + (valueNoise(faceX * 61, faceY * 61 + 9) - 0.5) * 0.024;
  const cheek = ease(faceX + wobble, line - 0.085, line + 0.085);
  const link = 0.32 * ease(lateral, 0.74, 0.83) * (1 - ease(lateral, 0.86, 0.92)) * ease(faceX, 0.4, 0.45) * (1 - ease(faceX, 0.56, 0.62));
  const philtrum = 1 - 0.75 * Math.exp(-(((faceY - 0.5) / 0.009) ** 2));
  return Math.max(growth[0] * philtrum, growth[1], growth[2] * cheek, link);
}
