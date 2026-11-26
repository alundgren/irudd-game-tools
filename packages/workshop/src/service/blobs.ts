import { diagnostic, mediaTypes, type Diagnostic } from "@irudd/document";
import { createHash } from "node:crypto";

export const maxBlobBytes = 64 * 1024 * 1024;

const digestPattern = /^sha256:[0-9a-f]{64}$/;

export function isDigest(value: string): boolean {
  return digestPattern.test(value);
}

export function sha256(bytes: Uint8Array): string {
  return "sha256:" + createHash("sha256").update(bytes).digest("hex");
}

const startsWith = (bytes: Uint8Array, at: number, signature: ReadonlyArray<number>): boolean =>
  signature.every((byte, i) => bytes[at + i] === byte);

const ascii = (text: string): number[] => Array.from(text, (c) => c.charCodeAt(0));

export function sniffMediaType(bytes: Uint8Array): string | undefined {
  if (startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, 0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, 0, ascii("RIFF")) && startsWith(bytes, 8, ascii("WEBP")))
    return "image/webp";
  if (startsWith(bytes, 0, ascii("glTF")) && startsWith(bytes, 4, [2, 0, 0, 0]))
    return "model/gltf-binary";
  return undefined;
}

export type BlobCheck =
  | { readonly ok: true; readonly digest: string; readonly mediaType: string }
  | { readonly ok: false; readonly diagnostics: ReadonlyArray<Diagnostic> };

export function checkBlob(input: {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  readonly digest?: string | undefined;
  readonly byteLength?: number | undefined;
}): BlobCheck {
  const diagnostics: Diagnostic[] = [];
  const { bytes, mediaType } = input;
  if (!(bytes instanceof Uint8Array))
    return {
      ok: false,
      diagnostics: [diagnostic("schema", ["bytes"], "Blob bytes are a Uint8Array.")],
    };
  if (bytes.length === 0 || bytes.length > maxBlobBytes)
    diagnostics.push(
      diagnostic(
        "limit",
        ["bytes"],
        `A blob holds 1 to ${maxBlobBytes} bytes, not ${bytes.length}.`,
      ),
    );
  if (!mediaTypes.some((m) => m === mediaType))
    diagnostics.push(
      diagnostic("schema", ["mediaType"], `Use one of ${mediaTypes.join(", ")}, not ${mediaType}.`),
    );
  else {
    const sniffed = sniffMediaType(bytes);
    if (sniffed !== mediaType)
      diagnostics.push(
        diagnostic(
          "asset-mismatch",
          ["mediaType"],
          sniffed
            ? `The bytes are ${sniffed}, not ${mediaType}.`
            : `The bytes do not start with a ${mediaType} signature.`,
        ),
      );
  }
  if (input.byteLength !== undefined && input.byteLength !== bytes.length)
    diagnostics.push(
      diagnostic(
        "asset-mismatch",
        ["byteLength"],
        `The blob has ${bytes.length} bytes, not ${input.byteLength}.`,
      ),
    );
  const actual = sha256(bytes);
  if (input.digest !== undefined && input.digest !== actual)
    diagnostics.push(
      diagnostic(
        "asset-mismatch",
        ["digest"],
        `The bytes hash to ${actual}, not ${input.digest}.`,
        {
          actual,
        },
      ),
    );
  return diagnostics.length ? { ok: false, diagnostics } : { ok: true, digest: actual, mediaType };
}
