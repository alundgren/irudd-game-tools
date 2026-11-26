// The painted scalp under drawn-back hair (sweptScalpTexture in
// character-view/human-swept-scalp.js at 2761eb1). The painting of combed
// strands is fitted to the wearer's crown, ears and nape: the roots' texture
// coordinates follow the wearer's own hairline, and that warp is undone before
// the painting is sampled, so a high ear shortens the strands without bending
// them over the temple.

import * as T from "three";
import { context2d, type Raster } from "../../raster.js";
import { sweptScalpSize } from "../paint-data.js";

const degrees = 180 / Math.PI;
const samples = 720;
const linear = Array.from(
  { length: 256 },
  (_, byte) => new T.Color(byte / 255, 0, 0).convertSRGBToLinear().r,
);

// A painting fits one hairline in one pair of colours; the same wearer draws it once.
const charts = new WeakMap<Raster, Map<string, T.CanvasTexture>>();

/**
 * The painted scalp for hairlines `lines` (degrees of elevation by direction, one per side), in `hair`
 * over `skin`. `reversed` combs it the other way; `tone` is the painting's combed tone, one byte a pixel.
 */
export function sweptScalpTexture(
  raster: Raster,
  tone: Uint8Array,
  lines: ReadonlyArray<(at: number) => number>,
  skin: T.Color,
  hair: T.Color,
  reversed: boolean,
): T.CanvasTexture {
  const sideOf = (angle: number) => lines[angle > 0 ? 0 : 1] ?? (() => 0);
  const boundary = Array.from({ length: samples }, (_, i) => {
    const angle = (i * 360) / samples - 180;
    return sideOf(angle)(Math.abs(angle));
  });
  const key = [
    skin.getHexString(),
    hair.getHexString(),
    reversed,
    "",
    ...boundary.map((a) => Math.round(a * 8)),
  ].join(",");
  let drawn = charts.get(raster);
  if (!drawn) charts.set(raster, (drawn = new Map<string, T.CanvasTexture>()));
  const known = drawn.get(key);
  if (known) return known;

  const size = sweptScalpSize;
  const pixels = new Uint8Array(size * size * 4);
  const dye = new T.Color();
  const at = (i: number) => boundary[i % samples] ?? 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5,
        dy = 0.5 - (y + 0.5) / size;
      const angle = Math.atan2(dx, dy),
        cosine = Math.cos(angle);
      const t = ((angle * degrees + 180) / 360) * samples;
      const index = Math.floor(t);
      const edge = T.MathUtils.lerp(at(index), at(index + 1), t - index);
      const elevation = 90 - (Math.hypot(dx, dy) / 0.495) * (96 - edge);
      const paintedEdge = 30 * cosine - 18 * Math.max(0, -cosine);
      const radius = (0.455 * (90 - elevation)) / (90 - paintedEdge);
      // Continue the outermost painted strands a short way into a low nape.
      const r = radius < 0.468 ? radius : Math.max(0.36, 0.468 - (radius - 0.468) * 0.35);
      const u = Math.floor((0.5 + (reversed ? -1 : 1) * Math.sin(angle) * r) * size);
      const v = Math.floor((0.5 - cosine * r) * size);
      const shade = tone[v * size + u] ?? 0;
      const margin =
        elevation -
        edge +
        0.85 * Math.sin(43 * angle) +
        0.55 * Math.sin(127 * angle) +
        1.9 * (shade / 255 - 0.7);
      const density = T.MathUtils.smoothstep(margin, -1.6, 4.8);
      dye
        .copy(hair)
        .multiplyScalar(linear[shade] ?? 0)
        .lerp(skin, 1 - density)
        .convertLinearToSRGB();
      const i = 4 * (y * size + x);
      pixels[i] = Math.round(dye.r * 255);
      pixels[i + 1] = Math.round(dye.g * 255);
      pixels[i + 2] = Math.round(dye.b * 255);
      pixels[i + 3] = Math.round(255 * T.MathUtils.smoothstep(margin, -2.6, 1));
    }
  }

  const canvas = raster.canvas(size, size);
  const context = context2d(canvas);
  const image = context.createImageData(size, size);
  image.data.set(pixels);
  context.putImageData(image, 0, 0);
  const texture = new T.CanvasTexture(canvas);
  texture.name = "Brushed scalp";
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.magFilter = T.LinearFilter;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  drawn.set(key, texture);
  if (drawn.size > 10) {
    const oldest = drawn.keys().next();
    if (!oldest.done) {
      drawn.get(oldest.value)?.dispose();
      drawn.delete(oldest.value);
    }
  }
  return texture;
}
