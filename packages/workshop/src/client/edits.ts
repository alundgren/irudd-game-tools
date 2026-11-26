// Helpers clients share to build commands: request IDs, envelopes and
// generator steering from partial parameters.

import { randomBytes } from "node:crypto";
import { commandFormat, commandVersion, isJson, type Json } from "@irudd/document";

/** A fresh request ID. Reuse the same ID to retry a request whose reply was lost. */
export function newRequestId(prefix = "req"): string {
  return `${prefix}-${randomBytes(12).toString("hex")}`;
}

/** A command envelope without an actor: the host stamps the caller's actor. */
export function envelope(
  documentId: string,
  expectedRevision: number,
  command: Record<string, Json>,
  requestId: string,
): Record<string, Json> {
  return {
    format: commandFormat,
    version: commandVersion,
    requestId,
    documentId,
    expectedRevision,
    command,
  };
}

const isObject = (value: Json | undefined): value is { readonly [key: string]: Json } =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** RFC 7386 merge: objects merge key by key, `null` removes a key, anything else replaces. */
export function mergePatch(target: Json, patch: Json): Json {
  if (!isObject(patch)) return patch;
  const result: Record<string, Json> = isObject(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else result[key] = mergePatch(result[key] ?? null, value);
  }
  return result;
}

/**
 * Turn `a.b=value` assignments into a merge patch. A value that parses as JSON
 * is used as JSON (`2`, `true`, `"text"`, `{...}`); anything else is a string.
 */
export function assignmentsPatch(assignments: ReadonlyArray<string>): Json {
  let patch: Json = {};
  for (const assignment of assignments) {
    const equals = assignment.indexOf("=");
    if (equals <= 0) throw new Error(`Use key.path=value, not ${assignment}.`);
    const keys = assignment.slice(0, equals).split(".");
    if (keys.some((k) => k.length === 0)) throw new Error(`${assignment} has an empty key.`);
    const raw = assignment.slice(equals + 1);
    let value: Json = raw;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isJson(parsed)) value = parsed;
    } catch {
      // Plain text stays a string.
    }
    const nested = keys.reduceRight<Json>((inner, key) => ({ [key]: inner }), value);
    patch = mergePatch(patch, nested);
  }
  return patch;
}
