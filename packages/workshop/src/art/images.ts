export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

const u16be = (b: Uint8Array, i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
const u32be = (b: Uint8Array, i: number) => u16be(b, i) * 65536 + u16be(b, i + 2);
const u16le = (b: Uint8Array, i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
const u24le = (b: Uint8Array, i: number) => u16le(b, i) | ((b[i + 2] ?? 0) << 16);
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

function png(b: Uint8Array): ImageSize | undefined {
  if (b.length < 24 || ascii(b, 12, 4) !== "IHDR") return undefined;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

function jpeg(b: Uint8Array): ImageSize | undefined {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return undefined;
    const marker = b[i + 1] ?? 0;
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    const length = u16be(b, i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
      return { height: u16be(b, i + 5), width: u16be(b, i + 7) };
    if (length < 2) return undefined;
    i += 2 + length;
  }
  return undefined;
}

function webp(b: Uint8Array): ImageSize | undefined {
  if (b.length < 30 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") return undefined;
  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8X") return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  if (chunk === "VP8L") {
    const bits = (b[21] ?? 0) | ((b[22] ?? 0) << 8) | ((b[23] ?? 0) << 16) | ((b[24] ?? 0) << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8 ") return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  return undefined;
}

export function imageSize(bytes: Uint8Array, mediaType: string): ImageSize | undefined {
  const size =
    mediaType === "image/png"
      ? png(bytes)
      : mediaType === "image/jpeg"
        ? jpeg(bytes)
        : mediaType === "image/webp"
          ? webp(bytes)
          : undefined;
  return size && size.width > 0 && size.height > 0 ? size : undefined;
}
