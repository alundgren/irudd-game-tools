import { sha256Digest, type AssetAttribution } from "@irudd/document";
import type { ArtKind, AttachmentRole, MethodParams, MethodResults } from "@irudd/workshop/wire";

export type BriefDraft = MethodParams["art.request"]["brief"];

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

const chunkBytes = 3 * 1024 * 1024;
const imageTypes = ["image/png", "image/jpeg", "image/webp"] as const;
export type ImageType = (typeof imageTypes)[number];

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
  return { ...last.stored, digest, mediaType };
}

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

export function undelivered(r: RequestView): boolean {
  return r.steering === null && r.closed === null && r.submissions.length === 0;
}

export function resendRequest(r: RequestView): MethodParams["art.request"] {
  return { agent: r.agent, requestId: r.requestId, brief: r.brief };
}

export function undeliveredRequestId(
  requests: ReadonlyArray<RequestView>,
  agent: string,
  brief: MethodParams["art.request"]["brief"],
): string | undefined {
  const wanted = stableJson(brief);
  return requests.find((r) => undelivered(r) && r.agent === agent && stableJson(r.brief) === wanted)
    ?.requestId;
}

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
