// Minimal PNG decoder for comparing exported textures by pixels: 8-bit
// greyscale, RGB, palette-free RGBA and grey-alpha, non-interlaced, as browser
// canvases encode them.

import { inflateSync } from "node:zlib";

export interface Pixels {
  readonly width: number;
  readonly height: number;
  /** RGBA, 8 bits per channel. */
  readonly rgba: Uint8Array;
}

const channelsFor: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

export function decodePng(bytes: Uint8Array): Pixels {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== 0x89504e47) throw new Error("Not a PNG.");
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const data: Uint8Array[] = [];
  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      const header = new DataView(body.buffer, body.byteOffset, body.byteLength);
      width = header.getUint32(0);
      height = header.getUint32(4);
      const depth = header.getUint8(8);
      colorType = header.getUint8(9);
      if (depth !== 8 || header.getUint8(12) !== 0)
        throw new Error("Only 8-bit non-interlaced PNGs are supported.");
    } else if (type === "IDAT") data.push(body);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  const channels = channelsFor[colorType];
  if (!channels) throw new Error(`PNG colour type ${colorType} is not supported.`);
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const src = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const value = raw[src + x] ?? 0;
      const left = x >= channels ? (pixels[y * stride + x - channels] ?? 0) : 0;
      const up = y ? (pixels[(y - 1) * stride + x] ?? 0) : 0;
      const corner = y && x >= channels ? (pixels[(y - 1) * stride + x - channels] ?? 0) : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - corner;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - corner);
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      }
      pixels[y * stride + x] = (value + predicted) & 0xff;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    const g = pixels[s] ?? 0;
    if (channels === 1 || channels === 2) {
      rgba.set([g, g, g, channels === 2 ? (pixels[s + 1] ?? 255) : 255], i * 4);
    } else {
      rgba.set(
        [g, pixels[s + 1] ?? 0, pixels[s + 2] ?? 0, channels === 4 ? (pixels[s + 3] ?? 255) : 255],
        i * 4,
      );
    }
  }
  return { width, height, rgba };
}
