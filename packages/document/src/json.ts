export type Json = null | boolean | number | string | JsonArray | JsonObject;
export type JsonArray = ReadonlyArray<Json>;
export interface JsonObject {
  readonly [key: string]: Json;
}

const maxDepth = 64;

function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function isJson(value: unknown, depth = 0): value is Json {
  if (depth > maxDepth) return false;
  if (value === null) return true;
  switch (typeof value) {
    case "boolean":
    case "string":
      return true;
    case "number":
      return Number.isFinite(value);
    case "object": {
      if (Array.isArray(value)) {
        const items: ReadonlyArray<unknown> = value;
        for (let i = 0; i < items.length; i++) {
          if (!Object.hasOwn(items, i) || !isJson(items[i], depth + 1)) return false;
        }
        return true;
      }
      if (!isPlainObject(value)) return false;
      for (const item of Object.values(value)) {
        if (!isJson(item, depth + 1)) return false;
      }
      return true;
    }
    default:
      return false;
  }
}

export function isJsonObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isJsonArray(value: Json | undefined): value is JsonArray {
  return Array.isArray(value);
}

export function canonicalJson(value: Json): string {
  if (!isJsonObject(value)) {
    if (isJsonArray(value)) {
      const items: string[] = [];
      for (let i = 0; i < value.length; i++) {
        const item = value[i];
        if (item === undefined || !Object.hasOwn(value, i))
          throw new TypeError("JSON arrays must have a value at every index.");
        items.push(canonicalJson(item));
      }
      return "[" + items.join(",") + "]";
    }
    return JSON.stringify(value);
  }
  const keys = Object.keys(value).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const item = value[key];
    if (item === undefined) continue;
    parts.push(JSON.stringify(key) + ":" + canonicalJson(item));
  }
  return "{" + parts.join(",") + "}";
}

export function jsonEqual(a: Json | undefined, b: Json | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return typeof a === "number" && typeof b === "number" ? a === b : false;
  }
  if (isJsonArray(a) || isJsonArray(b)) {
    if (!isJsonArray(a) || !isJsonArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!jsonEqual(a[i], b[i])) return false;
    return true;
  }
  if (!isJsonObject(a) || !isJsonObject(b)) return false;
  const ak = Object.keys(a).filter((k) => a[k] !== undefined);
  const bk = Object.keys(b).filter((k) => b[k] !== undefined);
  if (ak.length !== bk.length) return false;
  for (const key of ak) if (!jsonEqual(a[key], b[key])) return false;
  return true;
}

export function canonicalSize(value: Json): number {
  return utf8Length(canonicalJson(value));
}

export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && isLowSurrogate(text.charCodeAt(i + 1))) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

function isLowSurrogate(c: number): boolean {
  return c >= 0xdc00 && c <= 0xdfff;
}

export function utf8Encode(text: string): Uint8Array {
  const out = new Uint8Array(utf8Length(text));
  let o = 0;
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && isLowSurrogate(text.charCodeAt(i + 1))) {
      c = 0x10000 + ((c - 0xd800) << 10) + (text.charCodeAt(i + 1) - 0xdc00);
      i++;
    } else if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
    if (c < 0x80) out[o++] = c;
    else if (c < 0x800) {
      out[o++] = 0xc0 | (c >> 6);
      out[o++] = 0x80 | (c & 63);
    } else if (c < 0x10000) {
      out[o++] = 0xe0 | (c >> 12);
      out[o++] = 0x80 | ((c >> 6) & 63);
      out[o++] = 0x80 | (c & 63);
    } else {
      out[o++] = 0xf0 | (c >> 18);
      out[o++] = 0x80 | ((c >> 12) & 63);
      out[o++] = 0x80 | ((c >> 6) & 63);
      out[o++] = 0x80 | (c & 63);
    }
  }
  return out;
}
