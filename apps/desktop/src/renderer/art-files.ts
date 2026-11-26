// The art panel's file handling, free of the DOM so tests run it in Node:
// which views a brief needs, staging bytes in art.put chunks, reading a
// request's files back with their digests checked, turning a file the person
// imports into an art reply, and finding a brief the host stored but never
// sent, so the person can send that same request again.
//
// The renderer bundle may not load the workshop package, so the few limits it
// needs are restated here; the host checks every one of them again.

import { sha256Digest, type AssetAttribution } from "@irudd/document";
import type { ArtKind, AttachmentRole, MethodParams, MethodResults } from "@irudd/workshop/wire";

export const artKindsShown: ReadonlyArray<{ readonly kind: ArtKind; readonly label: string }> = [
  { kind: "variation", label: "Variation (geometry proposal)" },
  { kind: "turnaround", label: "Turnaround paint" },
  { kind: "trace", label: "Reference trace fit" },
  { kind: "depth", label: "Portrait depth" },
];

export const rolesShown: ReadonlyArray<AttachmentRole> = [
  "whole",
  "close-up",
  "front",
  "side",
  "back",
  "reference",
];

/** Under the host's 4 MiB chunk limit; the host checks it again. */
const chunkBytes = 3 * 1024 * 1024;
const imageTypes = ["image/png", "image/jpeg", "image/webp"] as const;
export type ImageType = (typeof imageTypes)[number];

/** What a brief of this kind still lacks before the host will take it. */
export function briefNeeds(
  kind: ArtKind,
  roles: ReadonlyArray<AttachmentRole>,
  parts: ReadonlyArray<string>,
  build = false,
): ReadonlyArray<string> {
  const have = new Set(roles);
  const needs: string[] = [];
  if (kind === "trace" || kind === "depth") {
    if (parts.length !== 1)
      needs.push(build ? "one painted part to build on" : "one painted part to fit");
    for (const role of ["front", "side"] as const)
      if (!have.has(role)) needs.push(`a ${role} view`);
  }
  if (kind === "turnaround") {
    if (parts.length === 0) needs.push("a painted region");
    if (roles.length === 0) needs.push("a view of the character");
  }
  return needs;
}

/** PNG, JPEG or WebP by signature; undefined for anything else. */
export function sniffImage(bytes: Uint8Array): ImageType | undefined {
  const at = (i: number) => bytes[i] ?? -1;
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => at(i) === b))
    return "image/png";
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  const text = (i: number, n: number) => String.fromCharCode(...bytes.subarray(i, i + n));
  if (text(0, 4) === "RIFF" && text(8, 4) === "WEBP") return "image/webp";
  return undefined;
}

export function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

export function fromBase64(text: string): Uint8Array {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

interface Caller {
  call<M extends "art.put" | "art.read">(
    method: M,
    params: MethodParams[M],
  ): Promise<MethodResults[M]>;
}

/** Stage a picture in order; the last chunk returns the host's verified record. */
export async function stagePicture(host: Caller, bytes: Uint8Array) {
  const mediaType = sniffImage(bytes);
  if (!mediaType) throw new Error("Choose a PNG, JPEG or WebP picture.");
  const digest = sha256Digest(bytes);
  let last: MethodResults["art.put"] | undefined;
  for (let offset = 0; offset < bytes.length; offset += chunkBytes)
    last = await host.call("art.put", {
      digest,
      mediaType,
      offset,
      total: bytes.length,
      base64: toBase64(bytes.subarray(offset, Math.min(bytes.length, offset + chunkBytes))),
    });
  if (!last?.stored) throw new Error(`The host did not store ${digest}.`);
  return last.stored;
}

/** Every byte of one of a request's files; what arrived must have the digest asked for. */
export async function readPicture(
  host: Caller,
  artId: string,
  digest: string,
): Promise<{ readonly bytes: Uint8Array; readonly mediaType: string }> {
  return readImageChunks(digest, (offset) => host.call("art.read", { artId, digest, offset }));
}

export async function readImageChunks(
  digest: string,
  read: (offset: number) => Promise<MethodResults["art.read"]>,
): Promise<{ readonly bytes: Uint8Array; readonly mediaType: string }> {
  const parts: Uint8Array[] = [];
  let offset = 0;
  let mediaType = "application/octet-stream";
  for (;;) {
    const chunk = await read(offset);
    if (chunk.offset !== offset || chunk.digest !== digest)
      throw new Error("The image chunk has an unexpected offset or digest.");
    const bytes = fromBase64(chunk.base64);
    mediaType = chunk.mediaType;
    parts.push(bytes);
    offset += bytes.byteLength;
    if (chunk.done || bytes.byteLength === 0) break;
  }
  const bytes = new Uint8Array(offset);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.byteLength;
  }
  const actual = sha256Digest(bytes);
  if (actual !== digest) throw new Error(`${digest} arrived as ${actual}.`);
  return { bytes, mediaType };
}

export const extensionOf = (mediaType: string): string =>
  mediaType === "image/jpeg" ? "jpg" : mediaType === "image/webp" ? "webp" : "png";

/**
 * The reply a person's imported file makes for a brief of this kind: a
 * picture for turnaround and depth (staged first, named by its digest), a
 * trace map or an operation list as JSON. It stays untyped here: main checks
 * it against the wire schema and the host decodes and validates it.
 */
export function importedReply(
  kind: ArtKind,
  summary: string,
  file: { readonly digest: string } | { readonly json: unknown },
  attribution: AssetAttribution = {},
): { readonly reply: unknown } | { readonly problem: string } {
  const header = {
    format: "irudd.art-reply",
    version: 1,
    summary,
    ...(Object.keys(attribution).length ? { attribution } : {}),
  } as const;
  if (kind === "turnaround" || kind === "depth") {
    if (!("digest" in file)) return { problem: `A ${kind} reply is a picture.` };
    return { reply: { ...header, kind, image: file.digest } };
  }
  if (!("json" in file)) return { problem: `A ${kind} reply is a JSON file.` };
  const value = file.json;
  if (kind === "trace")
    return {
      reply: {
        ...header,
        kind,
        traceMap: isRecord(value) && isRecord(value["traceMap"]) ? value["traceMap"] : value,
      },
    };
  const ops = isRecord(value) && Array.isArray(value["operations"]) ? value["operations"] : value;
  if (!Array.isArray(ops)) return { problem: "A variation reply is a JSON list of operations." };
  return { reply: { ...header, kind, operations: ops } };
}

type RequestView = MethodResults["art.list"]["requests"][number];

/**
 * A request whose brief the host stored but whose steering message it never
 * wrote, because it stopped in between, and that nothing has answered. The
 * panel offers to send it; it is never sent without the person asking.
 */
export function undelivered(r: RequestView): boolean {
  return r.steering === null && r.closed === null && r.submissions.length === 0;
}

/** The request that sends an undelivered brief again: its own agent, request ID and brief. */
export function resendRequest(r: RequestView): MethodParams["art.request"] {
  return { agent: r.agent, requestId: r.requestId, brief: r.brief };
}

/**
 * The request ID to send this brief under: that of an undelivered request to
 * the same agent with the same brief, so sending it again never makes a
 * second ask; undefined when the brief is new.
 */
export function undeliveredRequestId(
  requests: ReadonlyArray<RequestView>,
  agent: string,
  brief: MethodParams["art.request"]["brief"],
): string | undefined {
  const wanted = stableJson(brief);
  return requests.find((r) => undelivered(r) && r.agent === agent && stableJson(r.brief) === wanted)
    ?.requestId;
}

/** JSON with sorted keys, so equal briefs compare equal whatever order built them. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value))
    return `{${Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
