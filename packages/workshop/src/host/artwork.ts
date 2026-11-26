import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Effect, Exit } from "effect";
import { isJsonArray, isJsonObject, type Json } from "@irudd/document";
import type { Project, Session } from "../contract/project.js";

export interface ArtworkOrigin {
  readonly kind: "project" | "credited";
  readonly license: string;
  readonly source: string;
  readonly credit?: string;
}

export interface FormArtwork {
  readonly digest: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
  readonly origin: ArtworkOrigin;
}

export const formArtworkFile = "artwork.json";
export const formArtworkFormat = "irudd.form-artwork";
export const formArtworkVersion = 1;

export interface ArtworkRecord {
  readonly digest: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly file: string;
  readonly origin: ArtworkOrigin;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function originOf(value: unknown): ArtworkOrigin | undefined {
  if (!isObject(value)) return undefined;
  const { kind, license, source, credit } = value;
  if (
    (kind !== "project" && kind !== "credited") ||
    typeof license !== "string" ||
    typeof source !== "string" ||
    (kind === "credited" && typeof credit !== "string")
  )
    return undefined;
  return { kind, license, source, ...(typeof credit === "string" ? { credit } : {}) };
}

function recordOf(value: unknown): ArtworkRecord | undefined {
  if (!isObject(value)) return undefined;
  const { digest, mediaType, byteLength, file } = value;
  const origin = originOf(value["origin"]);
  if (
    typeof digest !== "string" ||
    !/^sha256:[0-9a-f]{64}$/.test(digest) ||
    typeof mediaType !== "string" ||
    typeof byteLength !== "number" ||
    typeof file !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/.test(file) ||
    file.split("/").includes("..") ||
    !origin
  )
    return undefined;
  return { digest, mediaType, byteLength, file, origin };
}

const sha256 = (bytes: Uint8Array): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export function readFormArtwork(
  directory: string,
  problems: string[],
): ReadonlyMap<string, FormArtwork> {
  const found = new Map<string, FormArtwork>();
  const manifest = path.join(directory, formArtworkFile);
  if (!fs.existsSync(manifest)) return found;
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(manifest, "utf8"));
  } catch {
    problems.push(`${manifest} is not JSON.`);
    return found;
  }
  const files = isObject(value) ? value["files"] : undefined;
  if (!isObject(value) || value["format"] !== formArtworkFormat || !Array.isArray(files)) {
    problems.push(`${manifest} is not an ${formArtworkFormat} manifest.`);
    return found;
  }
  for (const entry of files) {
    const record = recordOf(entry);
    if (!record) {
      problems.push(`${manifest} has an entry without digest, media type, file and origin.`);
      continue;
    }
    const file = path.join(directory, ...record.file.split("/"));
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(fs.readFileSync(file));
    } catch {
      problems.push(`${file} is listed in ${formArtworkFile} but missing.`);
      continue;
    }
    if (sha256(bytes) !== record.digest || bytes.byteLength !== record.byteLength) {
      problems.push(`${file} does not match its digest ${record.digest}; it is not offered.`);
      continue;
    }
    found.set(record.digest, {
      digest: record.digest,
      mediaType: record.mediaType,
      bytes,
      origin: record.origin,
    });
  }
  return found;
}

export function declaredAssets(document: Json): ReadonlyArray<string> {
  if (!isJsonObject(document)) return [];
  const assets = document["assets"];
  if (!isJsonArray(assets)) return [];
  const out: string[] = [];
  for (const asset of assets)
    if (isJsonObject(asset) && typeof asset["digest"] === "string") out.push(asset["digest"]);
  return out;
}

export interface StagedArtwork {
  readonly digest: string;
  readonly stored: "new" | "existing";
  readonly origin: ArtworkOrigin | null;
}

export type StageOutcome =
  | { readonly ok: true; readonly staged: ReadonlyArray<StagedArtwork> }
  | {
      readonly ok: false;
      readonly tag: "ArtworkUnresolved" | "BlobRejected";
      readonly message: string;
      readonly digests: ReadonlyArray<string>;
    };

export async function stageFormArtwork(
  project: Project,
  session: Session,
  formId: string,
  document: Json,
  artwork: ReadonlyArray<FormArtwork>,
): Promise<StageOutcome> {
  const digests = declaredAssets(document);
  const plan: { digest: string; shipped: FormArtwork | undefined; present: boolean }[] = [];
  for (const digest of digests) {
    const info = await Effect.runPromise(project.blobInfo(digest)).catch(() => undefined);
    plan.push({
      digest,
      shipped: artwork.find((a) => a.digest === digest),
      present: info !== undefined,
    });
  }
  const unresolved = plan.filter((p) => !p.present && !p.shipped).map((p) => p.digest);
  if (unresolved.length)
    return {
      ok: false,
      tag: "ArtworkUnresolved",
      digests: unresolved,
      message: `Starter ${formId} declares artwork this host cannot supply: ${unresolved.join(", ")}. Ship the bytes in the forms directory's ${formArtworkFile} with their origin, or import them into the project first. Nothing was written.`,
    };
  const staged: StagedArtwork[] = [];
  for (const p of plan) {
    if (!p.shipped) {
      staged.push({ digest: p.digest, stored: "existing", origin: null });
      continue;
    }
    const exit = await Effect.runPromiseExit(
      session.putBlob({ bytes: p.shipped.bytes, mediaType: p.shipped.mediaType, digest: p.digest }),
    );
    if (!Exit.isSuccess(exit))
      return {
        ok: false,
        tag: "BlobRejected",
        digests: [p.digest],
        message: `The project refused the artwork ${p.digest} for ${formId}: ${String(exit.cause)}`,
      };
    staged.push({ digest: p.digest, stored: exit.value.stored, origin: p.shipped.origin });
  }
  return { ok: true, staged };
}
