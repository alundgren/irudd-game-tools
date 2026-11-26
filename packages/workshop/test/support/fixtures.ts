import { createRegistry, frameCreature, defaultFrameCreatureParams } from "@irudd/document";
import type { Registry } from "@irudd/document";
import { Effect, Exit } from "effect";
import type { Scope } from "effect";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { CommandRequest } from "@irudd/workshop";

export const registry: Registry = createRegistry({ generators: [frameCreature] });
export const retiredRegistry: Registry = createRegistry();

export const human = { kind: "human", id: "user", name: "Person" } as const;
export const agent = { kind: "agent", id: "assistant" } as const;

export const docId = "doc-marsh01";

export const supportDir = path.dirname(fileURLToPath(import.meta.url));
export const registerHook = pathToFileURL(
  path.resolve(supportDir, "../../../document/test/support/register.ts"),
).href;

export function tempDir(name: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `irudd-workshop-${name}-`));
}

let counter = 0;
export function requestId(prefix = "req"): string {
  counter += 1;
  return `${prefix}-${process.pid}-${counter.toString().padStart(6, "0")}`;
}

export function request(
  expectedRevision: number,
  command: CommandRequest["command"],
  id: string = requestId(),
  documentId: string = docId,
): CommandRequest {
  return {
    format: "irudd.command",
    version: 1,
    requestId: id,
    documentId,
    expectedRevision,
    command,
  };
}

export function generate(id?: string, documentId: string = docId): CommandRequest {
  return request(
    0,
    {
      type: "document.generate",
      label: "Marsh walker",
      generator: "irudd.frame-creature",
      version: 1,
      params: defaultFrameCreatureParams,
    },
    id,
    documentId,
  );
}

export function rename(
  expectedRevision: number,
  part: string,
  label: string,
  id?: string,
  documentId: string = docId,
): CommandRequest {
  return request(
    expectedRevision,
    { type: "edit", ops: [{ op: "part.rename", part, label }] },
    id,
    documentId,
  );
}

export function pngBytes(size = 256): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set(randomBytes(size - 8), 8);
  return bytes;
}

export function runExit<A, E>(program: Effect.Effect<A, E, Scope.Scope>): Promise<Exit.Exit<A, E>> {
  return Effect.runPromiseExit(Effect.scoped(program));
}

export async function run<A, E>(program: Effect.Effect<A, E, Scope.Scope>): Promise<A> {
  const exit = await runExit(program);
  if (Exit.isSuccess(exit)) return exit.value;
  throw new Error("Program failed: " + String(exit.cause));
}

export async function failure<A, E>(program: Effect.Effect<A, E, Scope.Scope>): Promise<E> {
  const exit = await runExit(program);
  if (Exit.isSuccess(exit)) throw new Error("Expected a failure, got success");
  const error = exit.cause.reasons.find((reason) => reason._tag === "Fail");
  if (!error || error._tag !== "Fail")
    throw new Error("Expected a typed failure, got " + String(exit.cause));
  return error.error;
}

export function percentile(values: ReadonlyArray<number>, p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? Number.NaN;
}
