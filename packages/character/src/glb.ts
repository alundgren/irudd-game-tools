const magic = 0x46546c67;
const jsonChunk = 0x4e4f534a;

export interface GlbParts {
  readonly json: unknown;
  readonly rest: Uint8Array;
}

export function readGlb(bytes: Uint8Array): GlbParts {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== magic) throw new Error("Not a binary glTF.");
  const length = view.getUint32(12, true);
  if (view.getUint32(16, true) !== jsonChunk) throw new Error("The first glTF chunk is not JSON.");
  const text = new TextDecoder().decode(bytes.subarray(20, 20 + length));
  const json: unknown = JSON.parse(text);
  return { json, rest: bytes.slice(20 + length) };
}

export function writeGlb(json: unknown, rest: Uint8Array): Uint8Array {
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const padded = Math.ceil(encoded.length / 4) * 4;
  const total = 12 + 8 + padded + rest.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, magic, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, padded, true);
  view.setUint32(16, jsonChunk, true);
  out.set(encoded, 20);
  out.fill(0x20, 20 + encoded.length, 20 + padded);
  out.set(rest, 20 + padded);
  return out;
}

const binChunk = 0x004e4942;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function canonicalImages(parts: GlbParts): GlbParts {
  const { json, rest } = parts;
  if (!isRecord(json) || !Array.isArray(json["images"]) || !Array.isArray(json["bufferViews"]))
    return parts;
  const images: unknown[] = json["images"];
  const views: unknown[] = json["bufferViews"];
  const buffers: unknown = json["buffers"];
  const chunks = new DataView(rest.buffer, rest.byteOffset, rest.byteLength);
  if (!Array.isArray(buffers) || buffers.length !== 1 || rest.byteLength < 8) return parts;
  if (chunks.getUint32(4, true) !== binChunk) return parts;
  const binLength = chunks.getUint32(0, true);
  const bin = rest.subarray(8, 8 + binLength);
  const after = rest.subarray(8 + binLength);
  const imageViews = images.map((image) =>
    isRecord(image) && typeof image["bufferView"] === "number" ? image["bufferView"] : -1,
  );
  if (imageViews.some((v) => v < 0) || new Set(imageViews).size !== imageViews.length) return parts;
  const slots = [...imageViews].sort((a, b) => a - b);
  const source = views.map((_view, index) => index);
  slots.forEach((slot, i) => (source[slot] = imageViews[i] ?? slot));
  const placed: { view: Record<string, unknown>; bytes: Uint8Array }[] = [];
  for (const from of source) {
    const view = views[from];
    if (!isRecord(view) || (view["buffer"] ?? 0) !== 0) return parts;
    const offset = typeof view["byteOffset"] === "number" ? view["byteOffset"] : 0;
    const length = typeof view["byteLength"] === "number" ? view["byteLength"] : -1;
    if (length < 0 || offset + length > bin.byteLength) return parts;
    placed.push({ view, bytes: bin.subarray(offset, offset + length) });
  }
  let size = 0;
  for (const { bytes } of placed) size = Math.ceil(size / 4) * 4 + bytes.byteLength;
  const padded = Math.ceil(size / 4) * 4;
  const out = new Uint8Array(8 + padded + after.byteLength);
  const header = new DataView(out.buffer);
  header.setUint32(0, padded, true);
  header.setUint32(4, binChunk, true);
  let at = 0;
  const rewritten = placed.map(({ view, bytes }) => {
    at = Math.ceil(at / 4) * 4;
    out.set(bytes, 8 + at);
    const next = { ...view, byteOffset: at };
    at += bytes.byteLength;
    return next;
  });
  out.set(after, 8 + padded);
  const buffer: unknown = buffers[0];
  return {
    json: {
      ...json,
      bufferViews: rewritten,
      images: images.map((image, i) => ({
        ...(isRecord(image) ? image : {}),
        bufferView: slots[i],
      })),
      buffers: [{ ...(isRecord(buffer) ? buffer : {}), byteLength: padded }],
    },
    rest: out,
  };
}
