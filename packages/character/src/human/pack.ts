export const packKinds = {
  u8: 1,
  u16: 2,
  u32: 3,
  i16: 4,
  i32: 5,
  f32: 6,
  f64: 7,
} as const;
export type PackKind = keyof typeof packKinds;

export interface PackArrays {
  u8: Uint8Array;
  u16: Uint16Array;
  u32: Uint32Array;
  i16: Int16Array;
  i32: Int32Array;
  f32: Float32Array;
  f64: Float64Array;
}

type Ctor = { readonly BYTES_PER_ELEMENT: number; new (buffer: ArrayBuffer): PackArrays[PackKind] };
const ctor: { readonly [K in PackKind]: Ctor } = {
  u8: Uint8Array,
  u16: Uint16Array,
  u32: Uint32Array,
  i16: Int16Array,
  i32: Int32Array,
  f32: Float32Array,
  f64: Float64Array,
};
const kindList: ReadonlyArray<PackKind> = ["u8", "u16", "u32", "i16", "i32", "f32", "f64"];
const kindByCode = new Map<number, PackKind>(kindList.map((k) => [packKinds[k], k]));

export const packMagic = "IRHP";
export const packVersion = 1;

export interface EntrySpec {
  readonly kind: PackKind;
  readonly elements?: number;
}
export type PackSpec = Readonly<Record<string, EntrySpec>>;

export class PackError extends Error {}

export class Pack {
  readonly #entries: ReadonlyMap<string, PackArrays[PackKind]>;
  readonly #what: string;
  constructor(entries: ReadonlyMap<string, PackArrays[PackKind]>, what: string) {
    this.#entries = entries;
    this.#what = what;
  }
  #get<T>(name: string, guard: (v: unknown) => v is T, kind: PackKind): T {
    const v = this.#entries.get(name);
    if (!guard(v)) throw new PackError(`${this.#what} has no ${kind} entry ${name}.`);
    return v;
  }
  has(name: string): boolean {
    return this.#entries.has(name);
  }
  u8(name: string): Uint8Array {
    return this.#get(name, (v): v is Uint8Array => v instanceof Uint8Array, "u8");
  }
  u16(name: string): Uint16Array {
    return this.#get(name, (v): v is Uint16Array => v instanceof Uint16Array, "u16");
  }
  u32(name: string): Uint32Array {
    return this.#get(name, (v): v is Uint32Array => v instanceof Uint32Array, "u32");
  }
  i16(name: string): Int16Array {
    return this.#get(name, (v): v is Int16Array => v instanceof Int16Array, "i16");
  }
  i32(name: string): Int32Array {
    return this.#get(name, (v): v is Int32Array => v instanceof Int32Array, "i32");
  }
  f32(name: string): Float32Array {
    return this.#get(name, (v): v is Float32Array => v instanceof Float32Array, "f32");
  }
  f64(name: string): Float64Array {
    return this.#get(name, (v): v is Float64Array => v instanceof Float64Array, "f64");
  }
}

const ascii = (bytes: Uint8Array) => {
  let text = "";
  for (const b of bytes) text += String.fromCharCode(b);
  return text;
};
const codes = (text: string) =>
  Uint8Array.from({ length: text.length }, (_, i) => text.charCodeAt(i));

async function inflate(stored: Uint8Array): Promise<ArrayBuffer> {
  const copy = new Uint8Array(stored.byteLength);
  copy.set(stored);
  const stream = new Blob([copy]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Response(stream).arrayBuffer();
}

export async function readPack(bytes: Uint8Array, spec: PackSpec, what: string): Promise<Pack> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  const need = (n: number) => {
    if (at + n > bytes.byteLength) throw new PackError(`${what} is truncated.`);
  };
  need(12);
  const magic = ascii(bytes.subarray(0, 4));
  if (magic !== packMagic) throw new PackError(`${what} is not a human pack.`);
  const version = view.getUint32(4, true);
  if (version !== packVersion)
    throw new PackError(`${what} is pack version ${version}; this build reads ${packVersion}.`);
  const count = view.getUint32(8, true);
  at = 12;
  const index: { name: string; kind: PackKind; elements: number; stored: number }[] = [];
  for (let i = 0; i < count; i++) {
    need(1);
    const length = bytes[at] ?? 0;
    at += 1;
    need(length + 9);
    const name = ascii(bytes.subarray(at, at + length));
    at += length;
    const kind = kindByCode.get(bytes[at] ?? 0);
    if (!kind) throw new PackError(`${what}: entry ${name} has an unknown element type.`);
    const elements = view.getUint32(at + 1, true);
    const stored = view.getUint32(at + 5, true);
    at += 9;
    index.push({ name, kind, elements, stored });
  }
  const declared = new Set(Object.keys(spec));
  const seen = new Set<string>();
  const out = new Map<string, PackArrays[PackKind]>();
  const pending: Promise<void>[] = [];
  for (const entry of index) {
    const expected = spec[entry.name];
    if (!expected) throw new PackError(`${what} holds an undeclared entry ${entry.name}.`);
    if (seen.has(entry.name)) throw new PackError(`${what} holds ${entry.name} twice.`);
    seen.add(entry.name);
    if (expected.kind !== entry.kind)
      throw new PackError(`${what}: ${entry.name} is ${entry.kind}, declared ${expected.kind}.`);
    if (expected.elements !== undefined && expected.elements !== entry.elements)
      throw new PackError(
        `${what}: ${entry.name} has ${entry.elements} elements, declared ${expected.elements}.`,
      );
    need(entry.stored);
    const stored = bytes.subarray(at, at + entry.stored);
    at += entry.stored;
    const Type = ctor[entry.kind];
    pending.push(
      inflate(stored).then((buffer) => {
        if (buffer.byteLength !== entry.elements * Type.BYTES_PER_ELEMENT)
          throw new PackError(`${what}: ${entry.name} inflates to the wrong length.`);
        out.set(entry.name, new Type(buffer));
      }),
    );
  }
  if (at !== bytes.byteLength) throw new PackError(`${what} has trailing bytes.`);
  for (const name of declared)
    if (!seen.has(name)) throw new PackError(`${what} is missing ${name}.`);
  await Promise.all(pending);
  return new Pack(out, what);
}

export function writePack(
  entries: ReadonlyArray<{
    readonly name: string;
    readonly kind: PackKind;
    readonly data: ArrayBufferView;
  }>,
  deflate: (raw: Uint8Array) => Uint8Array,
): Uint8Array {
  const parts: Uint8Array[] = [];
  const head = new Uint8Array(12);
  head.set(codes(packMagic));
  new DataView(head.buffer).setUint32(4, packVersion, true);
  new DataView(head.buffer).setUint32(8, entries.length, true);
  parts.push(head);
  const stored = entries.map((e) =>
    deflate(new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength)),
  );
  entries.forEach((e, i) => {
    if (!/^[\x21-\x7e]{1,255}$/.test(e.name)) throw new PackError(`Bad entry name ${e.name}.`);
    const row = new Uint8Array(1 + e.name.length + 9);
    row[0] = e.name.length;
    row.set(codes(e.name), 1);
    const v = new DataView(row.buffer);
    const size = ctor[e.kind].BYTES_PER_ELEMENT;
    if (e.data.byteLength % size) throw new PackError(`${e.name} is not whole ${e.kind} values.`);
    v.setUint8(1 + e.name.length, packKinds[e.kind]);
    v.setUint32(2 + e.name.length, e.data.byteLength / size, true);
    v.setUint32(6 + e.name.length, stored[i]?.byteLength ?? 0, true);
    parts.push(row);
  });
  parts.push(...stored);
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}
