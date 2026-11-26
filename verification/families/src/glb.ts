// Decode a binary glTF for structural comparison: its JSON and every accessor's values.

const componentTypes: Record<
  number,
  { readonly size: number; readonly read: (v: DataView, at: number) => number }
> = {
  5120: { size: 1, read: (v, at) => v.getInt8(at) },
  5121: { size: 1, read: (v, at) => v.getUint8(at) },
  5122: { size: 2, read: (v, at) => v.getInt16(at, true) },
  5123: { size: 2, read: (v, at) => v.getUint16(at, true) },
  5125: { size: 4, read: (v, at) => v.getUint32(at, true) },
  5126: { size: 4, read: (v, at) => v.getFloat32(at, true) },
};
const widths: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export const num = (value: unknown, fallback = 0): number =>
  typeof value === "number" ? value : fallback;

export interface Glb {
  readonly json: JsonRecord;
  readonly bin: DataView;
  readonly binBytes: Uint8Array;
}

export function parseGlb(bytes: Uint8Array): Glb {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error("Not a GLB.");
  let offset = 12;
  let json: unknown;
  let binBytes: Uint8Array = new Uint8Array(0);
  while (offset < bytes.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (type === 0x004e4942) binBytes = chunk;
    offset += 8 + length;
  }
  if (!isRecord(json)) throw new Error("The GLB has no JSON chunk.");
  return {
    json,
    binBytes,
    bin: new DataView(binBytes.buffer, binBytes.byteOffset, binBytes.byteLength),
  };
}

export function accessorValues(glb: Glb, index: number): Float64Array {
  const accessor = records(glb.json["accessors"])[index];
  if (!accessor) throw new Error(`No accessor ${index}.`);
  const component = componentTypes[num(accessor["componentType"])];
  const width = widths[String(accessor["type"])];
  if (!component || !width) throw new Error(`Accessor ${index} has an unknown layout.`);
  const count = num(accessor["count"]);
  const out = new Float64Array(count * width);
  const viewIndex = accessor["bufferView"];
  if (typeof viewIndex !== "number") return out;
  const bufferView = records(glb.json["bufferViews"])[viewIndex];
  if (!bufferView) throw new Error(`No buffer view ${viewIndex}.`);
  const base = num(bufferView["byteOffset"]) + num(accessor["byteOffset"]);
  const stride = num(bufferView["byteStride"], width * component.size);
  for (let i = 0; i < count; i++)
    for (let k = 0; k < width; k++) {
      const value = component.read(glb.bin, base + i * stride + k * component.size);
      if (!Number.isFinite(value))
        throw new Error(`Accessor ${index}, element ${i}, component ${k} is non-finite.`);
      out[i * width + k] = value;
    }
  return out;
}

export function imageBytes(glb: Glb, index: number): Uint8Array {
  const image = records(glb.json["images"])[index];
  const viewIndex = image?.["bufferView"];
  const bufferView =
    typeof viewIndex === "number" ? records(glb.json["bufferViews"])[viewIndex] : undefined;
  if (!bufferView) throw new Error(`Image ${index} is not embedded.`);
  const start = num(bufferView["byteOffset"]);
  return glb.binBytes.subarray(start, start + num(bufferView["byteLength"]));
}
