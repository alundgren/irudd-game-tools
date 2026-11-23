import * as T from "three";
import jacketUrl from "./work-jacket.webp";
import swatchesUrl from "./surfaces.atlas.webp";

const surfaces = new Map();
export async function loadSurfaces() {
  const [image, jacket] = await Promise.all(
    [swatchesUrl, jacketUrl].map((url) => new T.ImageLoader().loadAsync(url)),
  );
  for (const [index, name] of [
    "canvas",
    "leather",
    "metal",
    "scales",
  ].entries()) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
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
    // Retain grain as a neutral value map so the artist controls the dye colour.
    for (let i = 0; i < data.data.length; i += 4) {
      const l =
        0.21 * data.data[i] + 0.72 * data.data[i + 1] + 0.07 * data.data[i + 2];
      const value = Math.min(255, Math.max(138, 211 + (l - 136) * 0.58));
      data.data[i] = data.data[i + 1] = data.data[i + 2] = value;
    }
    ctx.putImageData(data, 0, 0);
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    texture.wrapS = texture.wrapT = T.RepeatWrapping;
    texture.repeat.set(2, 1);
    texture.anisotropy = 4;
    surfaces.set(name, texture);
  }
  // Unwrap the front panel around a vertical garment loft. Back and side
  // samples use a plain area of the same cloth with the sewing details omitted.
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const src = document.createElement("canvas");
  src.width = jacket.width;
  src.height = jacket.height;
  const sc = src.getContext("2d", { willReadFrequently: true });
  sc.drawImage(jacket, 0, 0);
  const pixels = sc.getImageData(0, 0, src.width, src.height).data;
  const buffer = ctx.createImageData(canvas.width, canvas.height);
  for (let x = 0; x < canvas.width; x++) {
    const theta = (x / canvas.width) * 2 * Math.PI,
      front = -Math.sin(theta);
    const w = T.MathUtils.smoothstep(front, -0.1, 0.5);
    const pos = 0.5 + Math.cos(theta) * 0.49;
    for (let y = 0; y < canvas.height; y++) {
      const u = y / (canvas.height - 1);
      const frontIx =
        4 *
        (Math.floor(u * (src.height - 1)) * src.width +
          Math.floor(pos * (src.width - 1)));
      const backIx =
        4 *
        (Math.floor((0.33 + 0.16 * u) * (src.height - 1)) * src.width +
          Math.floor((0.74 + 0.06 * Math.cos(3 * theta)) * (src.width - 1)));
      const off = (y * canvas.width + x) * 4;
      for (let k = 0; k < 3; k++) {
        const value = T.MathUtils.lerp(
          pixels[backIx + k],
          pixels[frontIx + k],
          w,
        );
        buffer.data[off + k] = Math.min(255, 73 + value);
      }
      buffer.data[off + 3] = 255;
    }
  }
  ctx.putImageData(buffer, 0, 0);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;
  surfaces.set("jacket", texture);
}
export function surfaceMaterial(color, kind = "plain") {
  const texture = surfaces.get(kind);
  return new T.MeshStandardMaterial({
    color,
    map: texture ?? null,
    roughness: kind === "metal" ? 0.47 : kind === "leather" ? 0.66 : 0.88,
    metalness: kind === "metal" ? 0.38 : 0,
    ...(texture
      ? { bumpMap: texture, bumpScale: kind === "scales" ? 0.003 : 0.0007 }
      : {}),
  });
}
