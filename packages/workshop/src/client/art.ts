// Client helpers for art requests: stage a picture in chunks, read a
// request's files back with their digests checked, and recognise a picture
// file's media type from its bytes. Shared by the CLI, the MCP server and
// desktop main.

import { createHash } from "node:crypto";
import { artImageTypes, artLimits, type ArtPutResult } from "../wire/art.js";
import type { MethodName, MethodParams, MethodResults } from "../wire/protocol.js";

interface Caller {
  call<M extends MethodName>(method: M, params: MethodParams[M]): Promise<MethodResults[M]>;
}

export type ArtImageType = (typeof artImageTypes)[number];

export const artDigest = (bytes: Uint8Array): string =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");

/** PNG, JPEG or WebP by signature; undefined for anything else. */
export function sniffArtImage(bytes: Uint8Array): ArtImageType | undefined {
  const at = (i: number) => bytes[i] ?? -1;
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => at(i) === b))
    return "image/png";
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  const text = (i: number, n: number) => String.fromCharCode(...bytes.subarray(i, i + n));
  if (text(0, 4) === "RIFF" && text(8, 4) === "WEBP") return "image/webp";
  return undefined;
}

/** Stage a picture with art.put, in order, and return the host's verified record. */
export async function uploadArt(
  client: Caller,
  bytes: Uint8Array,
  mediaType: ArtImageType = sniffArtImage(bytes) ?? "image/png",
): Promise<NonNullable<ArtPutResult["stored"]>> {
  const digest = artDigest(bytes);
  let last: ArtPutResult | undefined;
  for (let offset = 0; offset < bytes.length; offset += artLimits.chunkBytes) {
    const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + artLimits.chunkBytes));
    last = await client.call("art.put", {
      digest,
      mediaType,
      offset,
      total: bytes.length,
      base64: Buffer.from(chunk).toString("base64"),
    });
  }
  if (!last?.stored) throw new Error(`The host did not store ${digest}.`);
  return last.stored;
}

/** Every byte of one file of an art request; the digest of what arrived must match. */
export async function readArtFile(
  client: Caller,
  artId: string,
  digest: string,
): Promise<{ readonly bytes: Uint8Array; readonly mediaType: string }> {
  const parts: Buffer[] = [];
  let offset = 0;
  let mediaType = "application/octet-stream";
  for (;;) {
    const chunk = await client.call("art.read", { artId, digest, offset });
    const bytes = Buffer.from(chunk.base64, "base64");
    mediaType = chunk.mediaType;
    parts.push(bytes);
    offset += bytes.byteLength;
    if (chunk.done || bytes.byteLength === 0) break;
  }
  const bytes = new Uint8Array(Buffer.concat(parts));
  const actual = artDigest(bytes);
  if (actual !== digest) throw new Error(`${digest} arrived as ${actual}.`);
  return { bytes, mediaType };
}

/** A file extension for a picture's media type. */
export const artExtension = (mediaType: string): string =>
  mediaType === "image/jpeg" ? "jpg" : mediaType === "image/webp" ? "webp" : "png";
