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

function beardTexture(data, width, height, name, colourSpace) {
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
