// A small, strict ZIP container for character packages.
//
// Writing produces a plain PKWARE ZIP that any archive tool opens: UTF-8
// names, no ZIP64, no encryption, fixed timestamps (1980-01-01) so the same
// entries always give the same bytes. Each entry is stored or raw-deflated.
//
// Reading accepts what this writer and ordinary archive tools produce, and
// refuses everything else before inflating anything large: encrypted or
// ZIP64 entries, unknown methods, overlapping or out-of-bounds data, names
// that are absolute, contain `..` or a backslash, and duplicates. Every entry
// inflates into at most its declared size and must match its CRC-32.

import zlib from "node:zlib";

export interface ZipEntryInput {
  readonly name: string;
  readonly bytes: Uint8Array;
  /** Deflate this entry. Already-compressed artwork is stored. */
  readonly deflate: boolean;
}

export interface ZipEntry {
  readonly name: string;
  readonly method: 0 | 8;
  readonly compressedSize: number;
  readonly size: number;
  readonly crc32: number;
  /** Offset of the entry's data within the archive. */
  readonly dataOffset: number;
}

export class ZipError extends Error {
  readonly entry: string | undefined;
  constructor(message: string, entry?: string) {
    super(message);
    this.entry = entry;
  }
}

const localSig = 0x04034b50;
const centralSig = 0x02014b50;
const endSig = 0x06054b50;
const utf8Flag = 0x0800;
const fixedTime = 0;
const fixedDate = (0 << 9) | (1 << 5) | 1; // 1980-01-01
const maxUint32 = 0xffffffff;

export function isZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4
  );
}

export function writeZip(entries: ReadonlyArray<ZipEntryInput>): Uint8Array {
  if (entries.length > 0xffff) throw new ZipError("A package holds at most 65535 files.");
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const crc = zlib.crc32(entry.bytes) >>> 0;
    const deflated = entry.deflate ? zlib.deflateRawSync(entry.bytes, { level: 9 }) : undefined;
    const stored = deflated && deflated.length < entry.bytes.length ? deflated : entry.bytes;
    const method = stored === entry.bytes ? 0 : 8;
    if (offset > maxUint32 || stored.length > maxUint32 || entry.bytes.length > maxUint32)
      throw new ZipError("The package is too large for a ZIP without ZIP64.", entry.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(localSig, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(utf8Flag, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(fixedTime, 10);
    local.writeUInt16LE(fixedDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(entry.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(centralSig, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(utf8Flag, 8);
    head.writeUInt16LE(method, 10);
    head.writeUInt16LE(fixedTime, 12);
    head.writeUInt16LE(fixedDate, 14);
    head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(stored.length, 20);
    head.writeUInt32LE(entry.bytes.length, 24);
    head.writeUInt16LE(name.length, 28);
    head.writeUInt32LE(offset, 42);
    chunks.push(local, name, stored);
    central.push(head, name);
    offset += local.length + name.length + stored.length;
  }
  const centralSize = central.reduce((sum, c) => sum + c.length, 0);
  if (offset > maxUint32 || offset + centralSize > maxUint32)
    throw new ZipError("The package is too large for a ZIP without ZIP64.");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(endSig, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...chunks, ...central, end]));
}

function checkName(name: string): void {
  if (
    name.length === 0 ||
    name.length > 255 ||
    name.startsWith("/") ||
    name.includes("\\") ||
    name.includes("\0") ||
    /^[A-Za-z]:/.test(name) ||
    name.split("/").some((segment) => segment === ".." || segment === ".")
  )
    throw new ZipError(
      `The package holds a file with an unsafe name: ${JSON.stringify(name)}.`,
      name,
    );
}

/** The archive's directory, checked for structure. No entry is inflated yet. */
export function readZipDirectory(bytes: Uint8Array): ReadonlyArray<ZipEntry> {
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.length < 22) throw new ZipError("The file is too short to be a ZIP package.");
  // The end record is the last 22 bytes plus a comment of at most 65535.
  let end = -1;
  for (let at = view.length - 22; at >= Math.max(0, view.length - 22 - 0xffff); at--)
    if (view.readUInt32LE(at) === endSig && at + 22 + view.readUInt16LE(at + 20) === view.length) {
      end = at;
      break;
    }
  if (end < 0)
    throw new ZipError("The ZIP end record is missing; the file is cut short or not a ZIP.");
  if (view.readUInt16LE(end + 4) !== 0 || view.readUInt16LE(end + 6) !== 0)
    throw new ZipError("Multi-volume ZIP files are not packages.");
  const count = view.readUInt16LE(end + 10);
  if (count !== view.readUInt16LE(end + 8) || count === 0xffff)
    throw new ZipError("The ZIP directory count is inconsistent or needs ZIP64.");
  const size = view.readUInt32LE(end + 12);
  const start = view.readUInt32LE(end + 16);
  if (start === maxUint32 || start + size > end)
    throw new ZipError("The ZIP directory lies outside the file.");
  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  const spans: Array<readonly [number, number, string]> = [];
  let at = start;
  for (let i = 0; i < count; i++) {
    if (at + 46 > start + size || view.readUInt32LE(at) !== centralSig)
      throw new ZipError(`ZIP directory record ${i + 1} is damaged.`);
    const flags = view.readUInt16LE(at + 8);
    const method = view.readUInt16LE(at + 10);
    const crc = view.readUInt32LE(at + 16);
    const compressedSize = view.readUInt32LE(at + 20);
    const uncompressed = view.readUInt32LE(at + 24);
    const nameLength = view.readUInt16LE(at + 28);
    const extraLength = view.readUInt16LE(at + 30);
    const commentLength = view.readUInt16LE(at + 32);
    const localOffset = view.readUInt32LE(at + 42);
    const recordEnd = at + 46 + nameLength + extraLength + commentLength;
    if (recordEnd > start + size) throw new ZipError(`ZIP directory record ${i + 1} is damaged.`);
    const rawName = view.subarray(at + 46, at + 46 + nameLength);
    let name: string;
    try {
      name = new TextDecoder("utf-8", { fatal: true }).decode(rawName);
    } catch {
      throw new ZipError(`ZIP directory record ${i + 1} has a name that is not UTF-8.`);
    }
    at = recordEnd;
    if (name.endsWith("/")) continue; // A folder entry carries no data.
    checkName(name);
    if (names.has(name)) throw new ZipError(`The package holds ${name} twice.`, name);
    names.add(name);
    if (flags & 0x0001) throw new ZipError(`${name} is encrypted.`, name);
    if (method !== 0 && method !== 8)
      throw new ZipError(`${name} uses ZIP method ${method}; packages store or deflate.`, name);
    if (compressedSize === maxUint32 || uncompressed === maxUint32 || localOffset === maxUint32)
      throw new ZipError(`${name} needs ZIP64, which packages do not use.`, name);
    if (method === 0 && compressedSize !== uncompressed)
      throw new ZipError(`${name} is stored with inconsistent sizes.`, name);
    if (localOffset + 30 > start || view.readUInt32LE(localOffset) !== localSig)
      throw new ZipError(`The data of ${name} is missing or misplaced.`, name);
    const localName = view.readUInt16LE(localOffset + 26);
    const localExtra = view.readUInt16LE(localOffset + 28);
    if (!view.subarray(localOffset + 30, localOffset + 30 + localName).equals(rawName))
      throw new ZipError(`The local header of ${name} names a different file.`, name);
    const dataOffset = localOffset + 30 + localName + localExtra;
    if (dataOffset + compressedSize > start)
      throw new ZipError(`The data of ${name} runs past the ZIP directory.`, name);
    spans.push([localOffset, dataOffset + compressedSize, name]);
    entries.push({
      name,
      method: method === 0 ? 0 : 8,
      compressedSize,
      size: uncompressed,
      crc32: crc,
      dataOffset,
    });
  }
  spans.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < spans.length; i++) {
    const before = spans[i - 1];
    const after = spans[i];
    if (before && after && after[0] < before[1])
      throw new ZipError(`The data of ${after[2]} overlaps ${before[2]}.`, after[2]);
  }
  return entries;
}

/** Inflate one entry into at most its declared size, and check its CRC. */
export function readZipEntry(bytes: Uint8Array, entry: ZipEntry): Uint8Array {
  const data = bytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
  let out: Uint8Array;
  if (entry.method === 0) out = data;
  else
    try {
      out = zlib.inflateRawSync(data, { maxOutputLength: Math.max(1, entry.size) });
    } catch {
      throw new ZipError(
        `${entry.name} does not inflate to its declared ${entry.size} bytes.`,
        entry.name,
      );
    }
  if (out.length !== entry.size)
    throw new ZipError(`${entry.name} holds ${out.length} bytes, not ${entry.size}.`, entry.name);
  if (zlib.crc32(out) >>> 0 !== entry.crc32)
    throw new ZipError(`${entry.name} fails its CRC-32 check; the file is damaged.`, entry.name);
  return new Uint8Array(out);
}
