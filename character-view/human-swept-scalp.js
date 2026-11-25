import * as T from "three";
import { unzlibSync } from "three/addons/libs/fflate.module.js";
import paint from "./human-swept-scalp-data.json" with { type: "json" };

const charts = new Map();
const degrees = 180 / Math.PI;
const samples = 720;
const linear = Array.from({length: 256}, (_, byte) => new T.Color(byte / 255, 0, 0).convertSRGBToLinear().r);
let tones;

/** Fit the combed hair painting to the wearer's crown, ears and nape. The mesh
 * UVs follow the actual hairline. Undo that warp before sampling the painting
 * so a high ear shortens the strands without bending them over the temple. */
export function sweptScalpTexture(lines, skin, hair, reversed) {
  const boundary = Array.from({length: samples}, (_, i) => {
    const angle = i * 360 / samples - 180;
    return lines[angle > 0 ? 0 : 1](Math.abs(angle));
  });
  const key = [skin.getHexString(), hair.getHexString(), reversed, ...boundary.map(a => Math.round(a * 8))].join(",");
  if (charts.has(key)) return charts.get(key);

  tones ??= unzlibSync(Uint8Array.from(atob(paint.tone), c => c.charCodeAt(0)));
  const size = paint.size;
  const pixels = new Uint8Array(size * size * 4);
  const dye = new T.Color();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + .5) / size - .5, dy = .5 - (y + .5) / size;
      const angle = Math.atan2(dx, dy), cosine = Math.cos(angle);
      const t = ((angle * degrees + 180) / 360) * samples;
      const index = Math.floor(t);
      const edge = T.MathUtils.lerp(boundary[index % samples], boundary[(index + 1) % samples], t - index);
      const elevation = 90 - Math.hypot(dx, dy) / .495 * (96 - edge);
      const paintedEdge = 30 * cosine - 18 * Math.max(0, -cosine);
      const radius = .455 * (90 - elevation) / (90 - paintedEdge);
      // Continue the outermost painted strands a short way into a low nape.
      const r = radius < .468 ? radius : Math.max(.36, .468 - (radius - .468) * .35);
      const u = Math.floor((.5 + (reversed ? -1 : 1) * Math.sin(angle) * r) * size);
      const v = Math.floor((.5 - cosine * r) * size);
      const tone = tones[v * size + u];
      const margin = elevation - edge + .85 * Math.sin(43 * angle) + .55 * Math.sin(127 * angle) + 1.9 * (tone / 255 - .70);
      const density = T.MathUtils.smoothstep(margin, -1.6, 4.8);
      dye.copy(hair).multiplyScalar(linear[tone]).lerp(skin, 1 - density).convertLinearToSRGB();
      const i = 4 * (y * size + x);
      pixels[i] = Math.round(dye.r * 255);
      pixels[i + 1] = Math.round(dye.g * 255);
      pixels[i + 2] = Math.round(dye.b * 255);
      pixels[i + 3] = Math.round(255 * T.MathUtils.smoothstep(margin, -2.6, 1));
    }
  }

  let texture;
  if (typeof document === "undefined") {
    texture = new T.DataTexture(pixels, size, size);
    texture.flipY = true;
  } else {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const context = canvas.getContext("2d");
    const image = context.createImageData(size, size);
    image.data.set(pixels);
    context.putImageData(image, 0, 0);
    texture = new T.CanvasTexture(canvas);
  }
  texture.name = "Brushed scalp";
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.magFilter = T.LinearFilter;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  charts.set(key, texture);
  if (charts.size > 10) {
    const oldest = charts.keys().next().value;
    charts.get(oldest).dispose();
    charts.delete(oldest);
  }
  return texture;
}
