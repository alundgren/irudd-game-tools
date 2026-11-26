import {
  canonicalJson,
  diagnostic,
  documentDigest,
  documentJson,
  journalJson,
  utf8Encode,
  type Diagnostic,
  type DocumentState,
  type Json,
} from "@irudd/document";
import { Result, Schema } from "effect";
import { ArchiveRejected } from "../contract/errors.js";
import { packageFormat, packageVersion } from "../contract/project.js";
import { checkBlob, maxBlobBytes } from "./blobs.js";
import { decodeArchive, type ArchiveBlob, type DecodedArchive } from "./archive.js";
import { isZip, readZipDirectory, readZipEntry, writeZip, ZipError, type ZipEntry } from "./zip.js";

const extensions: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "model/gltf-binary": "glb",
};

export const assetPath = (digest: string, mediaType: string): string =>
  `assets/${digest.slice("sha256:".length)}.${extensions[mediaType] ?? "bin"}`;

const byDigest = (a: ArchiveBlob, b: ArchiveBlob) =>
  a.digest < b.digest ? -1 : a.digest > b.digest ? 1 : 0;

export function encodePackage(state: DocumentState, blobs: ReadonlyArray<ArchiveBlob>): Uint8Array {
  const doc = state.document;
  const last = state.journal[state.journal.length - 1];
  if (!doc || !last) throw new Error("Only a created document can be packaged.");
  const assets = [...blobs].sort(byDigest);
  const head = documentJson(doc);
  const manifest: Json = {
    format: packageFormat,
    version: packageVersion,
    documentId: state.documentId,
    label: doc.label,
    revision: state.head,
    digest: documentDigest(doc),
    last: { sequence: last.sequence, digest: last.digest },
    document: "document.json",
    history: { path: "history.jsonl", entries: state.journal.length },
    requires: doc.requires.map((r) => ({ feature: r.feature, version: r.version })),
    catalog: doc.catalog.map((c) => ({ id: c.id, digest: c.digest })),
    metadata: Object.keys(doc.extensions).sort(),
    assets: assets.map((blob) => ({
      path: assetPath(blob.digest, blob.mediaType),
      digest: blob.digest,
      mediaType: blob.mediaType,
      byteLength: blob.bytes.length,
    })),
  };
  const history = state.journal.map((e) => canonicalJson(journalJson(e)) + "\n").join("");
  return writeZip([
    { name: "manifest.json", bytes: utf8Encode(canonicalJson(manifest) + "\n"), deflate: true },
    { name: "document.json", bytes: utf8Encode(canonicalJson(head) + "\n"), deflate: true },
    { name: "history.jsonl", bytes: utf8Encode(history), deflate: true },
    ...assets.map((blob) => ({
      name: assetPath(blob.digest, blob.mediaType),
      bytes: blob.bytes,
      deflate: false,
    })),
  ]);
}

const Header = Schema.Struct({ format: Schema.String, version: Schema.Number });
const Manifest = Schema.Struct({
  format: Schema.Literal(packageFormat),
  version: Schema.Literal(packageVersion),
  documentId: Schema.String,
  label: Schema.String,
  revision: Schema.Number,
  digest: Schema.String,
  last: Schema.Struct({ sequence: Schema.Number, digest: Schema.String }),
  document: Schema.Literal("document.json"),
  history: Schema.Struct({ path: Schema.Literal("history.jsonl"), entries: Schema.Number }),
  requires: Schema.Array(Schema.Struct({ feature: Schema.String, version: Schema.Number })),
  catalog: Schema.Array(Schema.Struct({ id: Schema.String, digest: Schema.String })),
  metadata: Schema.Array(Schema.String),
  assets: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      digest: Schema.String,
      mediaType: Schema.String,
      byteLength: Schema.Number,
    }),
  ),
});
export type PackageManifest = typeof Manifest.Type;

const maxJsonBytes = 256 * 1024 * 1024;

const where = (path: ReadonlyArray<string | number>): string =>
  path.map((p, i) => (typeof p === "number" ? `[${p}]` : i === 0 ? p : `.${p}`)).join("");

export function summarize(lead: string, diagnostics: ReadonlyArray<Diagnostic>): string {
  const shown = diagnostics
    .slice(0, 3)
    .map((d) => (d.path.length ? `${where(d.path)}: ${d.message}` : d.message));
  const more = diagnostics.length - shown.length;
  return `${lead} ${shown.join(" ")}${more > 0 ? ` (${more} more)` : ""}`;
}

const reject = (
  path: ReadonlyArray<string | number>,
  diagnostics: ReadonlyArray<Diagnostic>,
  lead: string,
) =>
  Result.fail(
    new ArchiveRejected({
      path,
      diagnostics,
      message:
        diagnostics.length > 1 || diagnostics[0]?.message !== lead
          ? summarize(lead, diagnostics)
          : lead,
    }),
  );

const one = (
  path: ReadonlyArray<string | number>,
  message: string,
  code: Diagnostic["code"] = "schema",
) => reject(path, [diagnostic(code, path, message)], message);

function parseJson(bytes: Uint8Array): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch {
    return { ok: false };
  }
}

export interface DecodedPackage extends DecodedArchive {
  readonly manifest: PackageManifest;
  readonly document: unknown;
}

export function decodePackage(bytes: Uint8Array): Result.Result<DecodedPackage, ArchiveRejected> {
  let directory: ReadonlyArray<ZipEntry>;
  try {
    directory = readZipDirectory(bytes);
  } catch (error) {
    if (!(error instanceof ZipError)) throw error;
    return one(["package", ...(error.entry ? [error.entry] : [])], error.message);
  }
  const files = new Map(directory.map((e) => [e.name, e] as const));
  const read = (name: string, limit: number): Result.Result<Uint8Array, ArchiveRejected> => {
    const entry = files.get(name);
    if (!entry) return one(["package", name], `The package lacks ${name}.`);
    if (entry.size > limit)
      return one(
        ["package", name],
        `${name} declares ${entry.size} bytes; the limit is ${limit}.`,
        "limit",
      );
    try {
      return Result.succeed(readZipEntry(bytes, entry));
    } catch (error) {
      return one(["package", name], error instanceof Error ? error.message : String(error));
    }
  };

  const manifestBytes = read("manifest.json", 16 * 1024 * 1024);
  if (Result.isFailure(manifestBytes)) return Result.fail(manifestBytes.failure);
  const raw = parseJson(manifestBytes.success);
  if (!raw.ok) return one(["manifest.json"], "manifest.json is not UTF-8 JSON.");
  const header = Schema.decodeUnknownResult(Header)(raw.value);
  if (Result.isFailure(header) || header.success.format !== packageFormat)
    return one(
      ["manifest.json", "format"],
      `Expected a ${packageFormat} manifest.`,
      "unsupported-format",
    );
  if (header.success.version > packageVersion)
    return one(
      ["manifest.json", "version"],
      `Package version ${header.success.version} needs a newer build; this build reads version ${packageVersion}.`,
      "unsupported-format",
    );
  const decoded = Schema.decodeUnknownResult(Manifest)(raw.value);
  if (Result.isFailure(decoded))
    return one(
      ["manifest.json"],
      `manifest.json does not match its format: ${decoded.failure.message}`,
    );
  const manifest = decoded.success;

  const expected = new Set(["manifest.json", "document.json", "history.jsonl"]);
  const diagnostics: Diagnostic[] = [];
  manifest.assets.forEach((asset, i) => {
    const canonical = assetPath(asset.digest, asset.mediaType);
    if (asset.path !== canonical)
      diagnostics.push(
        diagnostic(
          "schema",
          ["manifest.json", "assets", i, "path"],
          `Asset ${asset.digest} belongs at ${canonical}, not ${asset.path}.`,
        ),
      );
    if (expected.has(asset.path))
      diagnostics.push(
        diagnostic(
          "duplicate-id",
          ["manifest.json", "assets", i],
          `${asset.path} is listed twice.`,
        ),
      );
    expected.add(asset.path);
    if (!files.has(asset.path))
      diagnostics.push(
        diagnostic(
          "missing-asset",
          ["assets", asset.digest],
          `The manifest lists ${asset.path}, which the package lacks.`,
          { asset: asset.digest },
        ),
      );
  });
  for (const name of files.keys())
    if (!expected.has(name))
      diagnostics.push(
        diagnostic(
          "schema",
          ["package", name],
          `${name} is not part of a character package. Remove it or save the character again.`,
        ),
      );
  if (diagnostics.length)
    return reject(["package"], diagnostics, "The package's files do not match its manifest.");

  const blobs: ArchiveBlob[] = [];
  for (const [i, asset] of manifest.assets.entries()) {
    const content = read(asset.path, maxBlobBytes);
    if (Result.isFailure(content)) return Result.fail(content.failure);
    const check = checkBlob({
      bytes: content.success,
      mediaType: asset.mediaType,
      digest: asset.digest,
      byteLength: asset.byteLength,
    });
    if (!check.ok)
      return reject(
        ["assets", asset.digest],
        check.diagnostics.map((d) => ({ ...d, path: ["assets", asset.digest, ...d.path] })),
        `Artwork ${asset.path} (asset ${i + 1}) failed verification.`,
      );
    blobs.push({ digest: check.digest, mediaType: check.mediaType, bytes: content.success });
  }

  const documentBytes = read("document.json", maxJsonBytes);
  if (Result.isFailure(documentBytes)) return Result.fail(documentBytes.failure);
  const document = parseJson(documentBytes.success);
  if (!document.ok) return one(["document.json"], "document.json is not UTF-8 JSON.");

  const historyBytes = read("history.jsonl", maxJsonBytes);
  if (Result.isFailure(historyBytes)) return Result.fail(historyBytes.failure);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(historyBytes.success);
  } catch {
    return one(["history.jsonl"], "history.jsonl is not UTF-8.");
  }
  const lines = text.split("\n").filter((line) => line.length > 0);
  if (lines.length !== manifest.history.entries)
    return one(
      ["history.jsonl"],
      `history.jsonl holds ${lines.length} entries; the manifest lists ${manifest.history.entries}.`,
      "journal-integrity",
    );
  const journal: unknown[] = [];
  for (const [i, line] of lines.entries()) {
    try {
      journal.push(JSON.parse(line));
    } catch {
      return one(
        ["history.jsonl", i],
        `Line ${i + 1} of history.jsonl is not JSON.`,
        "journal-integrity",
      );
    }
  }
  return Result.succeed({
    format: packageFormat,
    documentId: manifest.documentId,
    last: manifest.last,
    journal,
    blobs,
    manifest,
    document: document.value,
  });
}

export function decodeAnyArchive(
  bytes: Uint8Array,
): Result.Result<DecodedPackage | DecodedArchive, ArchiveRejected> {
  return isZip(bytes) ? decodePackage(bytes) : decodeArchive(bytes);
}
