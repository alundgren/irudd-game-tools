import * as T from "three";
import type { HumanBody } from "./body.js";

const textures = new WeakMap<HumanBody, Map<string, T.DataTexture>>();
export function studioTexture(body: HumanBody, name: "skin" | "eyes" | "hair", colour: T.Color) {
  let cache = textures.get(body);
  if (!cache) textures.set(body, (cache = new Map<string, T.DataTexture>()));
  const key = name + "-" + colour.toArray().join(",");
  const old = cache.get(key);
  if (old) return old;
  const source = body.studio.u8("paint." + name),
    side = Math.sqrt(source.length / 3);
  const bytes = new Uint8Array(4 * side * side);
  const skinTone = [0.23839757, 0.12743768, 0.05448028],
    hairTone = 0.2126 * 0.01850022 + 0.7152 * 0.01032982 + 0.0722 * 0.00604883;
  const channels = colour.toArray(),
    linear = Array.from(
      { length: 256 },
      (_, i) => new T.Color().setRGB(i / 255, 0, 0, T.SRGBColorSpace).r,
    );
  const encode = (v: number) =>
    Math.round(
      255 * T.MathUtils.clamp(v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055, 0, 1),
    );
  const tables = channels.map((value, k) =>
    Uint8Array.from(linear, (v) =>
      encode(v * T.MathUtils.clamp(value / (skinTone[k] ?? 1), 0.02, 6)),
    ),
  );
  for (let i = 0, j = 0; i < source.length; i += 3, j += 4) {
    const r = source[i] ?? 0,
      g = source[i + 1] ?? 0,
      b = source[i + 2] ?? 0;
    const light =
      name === "hair"
        ? ((0.2126 * (linear[r] ?? 0) + 0.7152 * (linear[g] ?? 0) + 0.0722 * (linear[b] ?? 0)) /
            hairTone) **
          0.85
        : Math.min(
            1.9,
            (0.299 * r + 0.587 * g + 0.114 * b) / (0.299 * 23 + 0.587 * 64 + 0.114 * 85),
          );
    const most = Math.max(r, g, b),
      share = T.MathUtils.smoothstep(most ? (most - Math.min(r, g, b)) / most : 0, 0.12, 0.3);
    for (let k = 0; k < 3; k++) {
      const c = source[i + k] ?? 0,
        value = channels[k] ?? 0;
      bytes[j + k] =
        name === "skin"
          ? (tables[k]?.[c] ?? 0)
          : name === "hair"
            ? encode(value * 0.78 * light)
            : Math.round(c + share * (Math.min(255, 255 * value * light) - c));
    }
    bytes[j + 3] = 255;
  }
  const texture = new T.DataTexture(bytes, side, side);
  texture.colorSpace = T.SRGBColorSpace;
  texture.flipY = true;
  texture.anisotropy = 4;
  texture.magFilter = T.LinearFilter;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  if (cache.size >= 16) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.get(oldest)?.dispose();
      cache.delete(oldest);
    }
  }
  cache.set(key, texture);
  return texture;
}
