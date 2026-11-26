import {
  canonicalJson,
  diagnostic,
  journalJson,
  utf8Encode,
  type DocumentState,
  type Json,
} from "@irudd/document";
import { Result, Schema } from "effect";
import { ArchiveRejected } from "../contract/errors.js";
import { archiveFormat, archiveVersion } from "../contract/project.js";
import { checkBlob } from "./blobs.js";

export interface ArchiveBlob {
  readonly digest: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

export function encodeArchive(state: DocumentState, blobs: ReadonlyArray<ArchiveBlob>): Uint8Array {
  const last = state.journal[state.journal.length - 1];
  const archive: Json = {
    format: archiveFormat,
    version: archiveVersion,
    documentId: state.documentId,
    last: last ? { sequence: last.sequence, digest: last.digest } : null,
    journal: state.journal.map(journalJson),
    blobs: [...blobs]
      .sort((a, b) => (a.digest < b.digest ? -1 : a.digest > b.digest ? 1 : 0))
      .map((blob) => ({
        digest: blob.digest,
        mediaType: blob.mediaType,
        byteLength: blob.bytes.length,
        data: Buffer.from(blob.bytes).toString("base64"),
      })),
  };
  return utf8Encode(canonicalJson(archive));
}

const Header = Schema.Struct({ format: Schema.String, version: Schema.Number });
const Archive = Schema.Struct({
  format: Schema.Literal(archiveFormat),
  version: Schema.Literal(archiveVersion),
  documentId: Schema.String,
  last: Schema.Struct({ sequence: Schema.Number, digest: Schema.String }),
  journal: Schema.Array(Schema.Unknown),
  blobs: Schema.Array(
    Schema.Struct({
      digest: Schema.String,
      mediaType: Schema.String,
      byteLength: Schema.Number,
      data: Schema.String,
    }),
  ),
});

export interface DecodedArchive {
  readonly format: string;
  readonly documentId: string;
  readonly last: { readonly sequence: number; readonly digest: string };
  readonly journal: ReadonlyArray<unknown>;
  readonly blobs: ReadonlyArray<ArchiveBlob>;
}

const base64 = /^[A-Za-z0-9+/]*={0,2}$/;

function rejected(
  path: ReadonlyArray<string | number>,
  message: string,
  code: "schema" | "unsupported-format" = "schema",
) {
  return new ArchiveRejected({ path, diagnostics: [diagnostic(code, path, message)], message });
}

export function decodeArchive(bytes: Uint8Array): Result.Result<DecodedArchive, ArchiveRejected> {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return Result.fail(rejected([], "A document archive is UTF-8 JSON."));
  }
  const header = Schema.decodeUnknownResult(Header)(raw);
  if (Result.isFailure(header) || header.success.format !== archiveFormat)
    return Result.fail(
      rejected(["format"], `Expected a ${archiveFormat} file.`, "unsupported-format"),
    );
  if (header.success.version > archiveVersion)
    return Result.fail(
      rejected(
        ["version"],
        `Archive version ${header.success.version} needs a newer build; this build reads version ${archiveVersion}.`,
        "unsupported-format",
      ),
    );
  const decoded = Schema.decodeUnknownResult(Archive)(raw);
  if (Result.isFailure(decoded))
    return Result.fail(
      rejected([], `The archive does not match its format: ${decoded.failure.message}`),
    );
  const archive = decoded.success;
  const blobs: ArchiveBlob[] = [];
  for (let i = 0; i < archive.blobs.length; i++) {
    const item = archive.blobs[i];
    if (!item) continue;
    if (!base64.test(item.data) || item.data.length % 4 !== 0)
      return Result.fail(rejected(["blobs", i, "data"], "Blob data is standard padded base64."));
    const content = new Uint8Array(Buffer.from(item.data, "base64"));
    const check = checkBlob({
      bytes: content,
      mediaType: item.mediaType,
      digest: item.digest,
      byteLength: item.byteLength,
    });
    if (!check.ok)
      return Result.fail(
        new ArchiveRejected({
          path: ["blobs", i],
          diagnostics: check.diagnostics.map((d) => ({ ...d, path: ["blobs", i, ...d.path] })),
          message: `Archive blob ${item.digest} failed verification.`,
        }),
      );
    blobs.push({ digest: check.digest, mediaType: check.mediaType, bytes: content });
  }
  return Result.succeed({
    format: archiveFormat,
    documentId: archive.documentId,
    last: archive.last,
    journal: archive.journal,
    blobs,
  });
}
