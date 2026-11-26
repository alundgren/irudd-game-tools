import type { Json } from "./json.js";

export const diagnosticCodes = [
  "schema",
  "unsupported-format",
  "unknown-feature",
  "unsupported-feature-version",
  "feature-not-declared",
  "unsupported-generator",
  "generator-failed",
  "limit",
  "duplicate-id",
  "missing-reference",
  "reference-cycle",
  "immutable-id",
  "retired-id",
  "base-mismatch",
  "missing-asset",
  "asset-mismatch",
  "catalog-missing",
  "catalog-mismatch",
  "wrong-document",
  "stale-revision",
  "request-reused",
  "proposal-required",
  "forbidden",
  "no-change",
  "conflict",
  "not-undoable",
  "already-undone",
  "unknown-revision",
  "unknown-proposal",
  "proposal-closed",
  "proposal-version",
  "already-created",
  "not-created",
  "upgrade-required",
  "read-only",
  "journal-integrity",
] as const;
export type DiagnosticCode = (typeof diagnosticCodes)[number];

export type DiagnosticPath = ReadonlyArray<string | number>;

export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly path: DiagnosticPath;
  readonly message: string;
  readonly detail?: Json;
}

export function diagnostic(
  code: DiagnosticCode,
  path: DiagnosticPath,
  message: string,
  detail?: Json,
): Diagnostic {
  return detail === undefined ? { code, path, message } : { code, path, message, detail };
}

export type Checked<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostics: ReadonlyArray<Diagnostic> };

export function ok<T>(value: T): Checked<T> {
  return { ok: true, value };
}
export function fail<T = never>(diagnostics: ReadonlyArray<Diagnostic>): Checked<T> {
  return { ok: false, diagnostics };
}

export class DocumentProblem extends Error {
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  constructor(diagnostics: ReadonlyArray<Diagnostic>) {
    super(diagnostics.map((d) => d.message).join(" "));
    this.name = "DocumentProblem";
    this.diagnostics = diagnostics;
  }
}

export function problem(
  code: DiagnosticCode,
  path: DiagnosticPath,
  message: string,
  detail?: Json,
): DocumentProblem {
  return new DocumentProblem([diagnostic(code, path, message, detail)]);
}
