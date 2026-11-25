import * as T from "three";
import { randomStream } from "./random.js";
import { setArmourDeviceArtwork } from "./human-armour-surface.js";
import armourDevicesUrl from "./armour-devices.webp";
import jacketUrl from "./work-jacket.webp";
import hornUrl from "./horn-growth.atlas.webp";
import swatchesUrl from "./surfaces.atlas.webp";

const surfaces = new Map();
const surfaceRoughness = new Map();

// Short, overlapping filaments remain visible between the collar's long
// geometric guard hairs. Draw pigment only, so lighting follows the mesh.
function shortFur() {
  const size = 384, canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#b4b4b4";
  ctx.fillRect(0, 0, size, size);
  const draw = randomStream(0x7b19037a);
  for (let i = 0; i < 14500; i++) {
    const x = draw() * size, y = draw() * size;
    const sweep = Math.sin((x / size * 4 + y / size) * Math.PI * 2);
    const dx = sweep * 4.2 + (draw() - 0.5) * 8;
    const dy = 4 + 13 * draw(), radius = 0.3 + draw() * 0.8;
    const value = Math.round(136 + draw() * 105);
    ctx.fillStyle = `rgb(${value},${value},${value})`;
    // Wrap only the strokes that meet the boundary.
    const xs = [x];
    if (Math.min(x, x + dx) - radius < 0) xs.push(x + size);
    if (Math.max(x, x + dx) + radius > size) xs.push(x - size);
    const ys = y + dy > size ? [y, y - size] : [y];
    for (const px of xs)
      for (const py of ys) {
        ctx.beginPath();
        ctx.moveTo(px-radius,py);
        ctx.quadraticCurveTo(px+dx*0.35-radius,py+dy*0.7,px+dx,py+dy);
        ctx.quadraticCurveTo(px+dx*0.55+radius,py+dy*0.55,px+radius,py);
        ctx.closePath();
        ctx.fill();
      }
  }
  const map = new T.CanvasTexture(canvas);
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}

export async function loadSurfaces() {
  for (const [key, frequency] of [
    ["strands", 11],
    ["scalp", 108],
  ]) {
    const c = document.createElement("canvas");
    c.width = key === "scalp" ? 1024 : 192;
    c.height = 128;
    const ctx = c.getContext("2d"),
      im = ctx.createImageData(c.width, c.height);
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++) {
        const u = x / c.width,
          v = y / c.height;
        const w =
          2 *
          Math.PI *
          (u * frequency + 0.085 * Math.sin(2 * Math.PI * (2 * v + u)));
        const fiber =
          0.52 * Math.sin(w) +
          0.32 * Math.sin(3 * w + 1.1) +
          0.16 * Math.sin(5 * w + 0.6);
        const level = Math.round(
          218 + 31 * fiber + 5 * Math.sin(2 * Math.PI * (v + 3 * u)),
        );
        const i = (x + y * c.width) * 4;
        im.data[i] = im.data[i + 1] = im.data[i + 2] = level;
        im.data[i + 3] = 255;
      }
    ctx.putImageData(im, 0, 0);
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace;
    t.wrapS = T.RepeatWrapping;
    t.anisotropy = 4;
    surfaces.set(key, t);
  }
  const [image, jacket, horn, devices] = await Promise.all(
    [swatchesUrl, jacketUrl, hornUrl, armourDevicesUrl].map((url) => new T.ImageLoader().loadAsync(url)),
  );
  // Keep the intrinsic value variation while allowing every site to be tinted.
  setArmourDeviceArtwork(devices);
  const hornCanvas = document.createElement("canvas");
  hornCanvas.width = horn.width;
  hornCanvas.height = horn.height;
  const hornContext = hornCanvas.getContext("2d", { willReadFrequently: true });
  hornContext.drawImage(horn, 0, 0);
  const hornData = hornContext.getImageData(0, 0, horn.width, horn.height);
  for (let i = 0; i < hornData.data.length; i += 4) {
    const value = .2126 * hornData.data[i] + .7152 * hornData.data[i+1] + .0722 * hornData.data[i+2];
    for (let j=0;j<3;j++) hornData.data[i+j]=Math.min(255,28+.92*value+.26*(hornData.data[i+j]-value));
  }
  hornContext.putImageData(hornData, 0, 0);
  const hornMap = new T.CanvasTexture(hornCanvas);
  hornMap.name = "Keratin growth rings";
  hornMap.colorSpace = T.SRGBColorSpace;
  hornMap.anisotropy = 4;
  surfaces.set("horn", hornMap);
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
    const roughCanvas = name === "leather" ? document.createElement("canvas") : null;
    if (roughCanvas) {
      roughCanvas.width = 256;
      roughCanvas.height = 256;
    }
    const roughCtx = roughCanvas?.getContext("2d");
    const roughData = roughCtx?.createImageData(256, 256);
    // Retain grain as a neutral value map so the artist controls the dye colour.
    for (let i = 0; i < data.data.length; i += 4) {
      const l =
        0.21 * data.data[i] + 0.72 * data.data[i + 1] + 0.07 * data.data[i + 2];
      const value = Math.min(255, Math.max(138, 211 + (l - 136) * 0.58));
      data.data[i] = data.data[i + 1] = data.data[i + 2] = value;
      if (roughData) {
        // Satin-oiled grain crowns (lower roughness ~0.36) vs deeper leather pores (~0.56).
        const norm = (value - 138) / (255 - 138);
        const r = i === 0 ? 0.79 : Math.max(0.64, Math.min(0.98, 0.96 - 0.30 * norm));
        const g = Math.round(255 * r);
        roughData.data[i] = 255;
        roughData.data[i + 1] = g;
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
    surfaces.set(name, texture);
    if (roughData) {
      roughCtx.putImageData(roughData, 0, 0);
      const roughTex = new T.CanvasTexture(roughCanvas);
      roughTex.wrapS = roughTex.wrapT = T.RepeatWrapping;
      roughTex.repeat.set(2, 1);
      roughTex.anisotropy = 4;
      surfaceRoughness.set(name, roughTex);
    }
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
  if (kind === "fur" && !surfaces.has(kind) && typeof document !== "undefined")
    surfaces.set(kind, shortFur());
  const texture = surfaces.get(kind);
  const roughMap = surfaceRoughness.get(kind);
  return new T.MeshStandardMaterial({
    color,
    map: texture ?? null,
    roughness:
      kind === "satin"
        ? 0.34
        : kind === "metal"
          ? 0.47
          : kind === "leather"
            ? (roughMap ? 0.56 : 0.44)
            : ["strands", "scalp"].includes(kind)
              ? 0.64
              : 0.88,
    metalness: kind === "metal" ? 0.38 : 0,
    ...(roughMap ? { roughnessMap: roughMap } : {}),
    ...(texture
      ? {
          bumpMap: texture,
          bumpScale:
            kind === "scales"
              ? 0.003
              : kind === "leather"
                ? 0.0026
                : kind === "canvas"
                  ? 0.0022
                  : 0.0007,
        }
      : {}),
  });
}
