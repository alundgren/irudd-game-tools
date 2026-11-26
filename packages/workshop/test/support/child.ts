import { Effect } from "effect";
import fs from "node:fs";
import { openProjectWithHooks } from "../../src/service/project.js";
import type { CommandRequest } from "@irudd/workshop";
import { docId, human, registry, rename, request, requestId } from "./fixtures.js";

interface Options {
  readonly path: string;
  readonly mode: "hold" | "crash-before" | "crash-after" | "stream";
  readonly request?: CommandRequest;
  readonly durability?: "full" | "normal";
}

const raw: unknown = JSON.parse(process.argv[2] ?? "{}");
if (typeof raw !== "object" || raw === null) throw new Error("child: expected JSON options");
const options: Options = {
  path: String(Reflect.get(raw, "path")),
  mode: parseMode(Reflect.get(raw, "mode")),
  ...requestOption(Reflect.get(raw, "request")),
  ...(Reflect.get(raw, "durability") === "normal" ? { durability: "normal" as const } : {}),
};

function parseMode(value: unknown): Options["mode"] {
  if (value === "hold" || value === "crash-before" || value === "crash-after" || value === "stream")
    return value;
  throw new Error("child: unknown mode " + String(value));
}

function requestOption(value: unknown): { request?: CommandRequest } {
  if (typeof value !== "object" || value === null) return {};
  const format: unknown = Reflect.get(value, "format");
  const version: unknown = Reflect.get(value, "version");
  const id: unknown = Reflect.get(value, "requestId");
  const documentId: unknown = Reflect.get(value, "documentId");
  const expectedRevision: unknown = Reflect.get(value, "expectedRevision");
  const command: unknown = Reflect.get(value, "command");
  if (
    format !== "irudd.command" ||
    version !== 1 ||
    typeof id !== "string" ||
    typeof documentId !== "string" ||
    typeof expectedRevision !== "number" ||
    typeof command !== "object" ||
    command === null
  )
    throw new Error("child: malformed request");
  return {
    request: {
      format,
      version,
      requestId: id,
      documentId,
      expectedRevision,
      command: forward(command),
    },
  };
}

function forward(command: object): CommandRequest["command"] {
  const type: unknown = Reflect.get(command, "type");
  if (type === "policy.set")
    return { type, agentDirectEdit: Reflect.get(command, "agentDirectEdit") === true };
  if (type === "edit") {
    const ops: unknown = Reflect.get(command, "ops");
    const first: unknown = Array.isArray(ops) ? ops[0] : undefined;
    if (typeof first === "object" && first !== null)
      return {
        type,
        ops: [
          {
            op: "part.rename",
            part: String(Reflect.get(first, "part")),
            label: String(Reflect.get(first, "label")),
          },
        ],
      };
  }
  throw new Error("child: only edit and policy.set requests are forwarded");
}

function say(event: Record<string, unknown>): void {
  fs.writeSync(1, JSON.stringify(event) + "\n");
}

function die(): never {
  process.kill(process.pid, "SIGKILL");
  throw new Error("unreachable");
}

const hooks =
  options.mode === "crash-before"
    ? { beforeCommit: () => die() }
    : options.mode === "crash-after"
      ? { afterCommit: () => die() }
      : {};

const program = Effect.gen(function* () {
  const project = yield* openProjectWithHooks(
    {
      path: options.path,
      registry,
      ...(options.durability ? { durability: options.durability } : {}),
    },
    hooks,
  );
  const session = yield* project.session({ actor: human });
  say({ event: "ready", pid: process.pid });
  if (options.mode === "hold") {
    setInterval(() => undefined, 60_000);
    return yield* Effect.never;
  }
  if (options.mode === "crash-before" || options.mode === "crash-after") {
    const result = yield* session.apply(options.request);
    say({ event: "returned", result: result.kind });
    return;
  }
  const current = yield* project.current(docId);
  let revision = current.revision;
  let policy = current.policy.agentDirectEdit;
  const part = current.document?.parts[0]?.id ?? "p-missing";
  for (let i = 0; ; i++) {
    const id = requestId("stream");
    const next: CommandRequest =
      i % 5 === 4
        ? request(revision, { type: "policy.set", agentDirectEdit: !policy }, id)
        : rename(revision, part, `Trunk ${i}`, id);
    say({ event: "sent", request: next });
    const started = performance.now();
    const result = yield* session.apply(next);
    if (result.kind !== "committed") {
      say({ event: "unexpected", result });
      return;
    }
    revision = result.receipt.revision;
    if (next.command.type === "policy.set") policy = next.command.agentDirectEdit;
    say({
      event: "ack",
      requestId: id,
      sequence: result.entry.sequence,
      revision,
      ms: performance.now() - started,
    });
  }
});

Effect.runPromise(Effect.scoped(program)).then(
  () => process.exit(0),
  (error: unknown) => {
    say({ event: "error", message: String(error) });
    process.exit(1);
  },
);
