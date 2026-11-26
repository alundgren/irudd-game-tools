// @irudd/workshop/client: connect to the host that owns a project.
//
// The CLI, the MCP server and a desktop window that finds its project already
// open all use this. It reaches no storage code: a client never opens the
// SQLite file, it talks to the project's single owner over its OS-local
// endpoint and authenticates with a per-user credential.

import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { decodeWith } from "@irudd/document";
import {
  Challenge,
  HostFrame,
  Refused,
  Welcome,
  encodeFrame,
  FrameReader,
  handshakeTimeoutMs,
  wireProtocol,
  wireVersion,
  type HostEvent,
  type MethodName,
  type MethodParams,
  type MethodResults,
  type WireErrorShape,
} from "../wire/protocol.js";
import {
  AgentCredential,
  Endpoint,
  deriveKey,
  hostFiles,
  newNonce,
  proof,
  readJsonFile,
  sameProof,
  type LocationOptions,
} from "../wire/local.js";
import { resultGuards } from "./results.js";
import { createHash } from "node:crypto";

export * from "./results.js";
export * from "./edits.js";
export * from "./art.js";

/** Tags of failures that happen on the client side of the wire. */
export const clientErrorTags = [
  "HostUnavailable",
  "CredentialMissing",
  "CredentialRejected",
  "HostImpostor",
  "ConnectionLost",
  "ProtocolError",
] as const;

/**
 * Every failure a client reports: either one of `clientErrorTags` or an error
 * the host sent (`DocumentMissing`, `Forbidden`, `InvalidArgument`, …). The
 * host's plain fields are in `detail`.
 */
export class WorkshopError extends Error {
  readonly _tag: string;
  readonly detail: WireErrorShape;
  constructor(detail: WireErrorShape) {
    super(detail.message);
    this._tag = detail._tag;
    this.detail = detail;
    this.name = `WorkshopError(${detail._tag})`;
  }
}

const failure = (
  tag: string,
  message: string,
  fields: Record<string, unknown> = {},
): WorkshopError => new WorkshopError({ ...fields, _tag: tag, message });

export type Credential =
  /** The person signed in to this OS account. Reads the host's human key. */
  | { readonly role: "human"; readonly project: string }
  /** A paired agent. The credential file names its project. */
  | { readonly role: "agent"; readonly file: string };

export interface ConnectOptions extends LocationOptions {
  readonly credential: Credential;
  readonly client?: { readonly name: string; readonly version: string };
  /** How long to wait for the handshake. */
  readonly timeoutMs?: number;
}

export interface WorkshopClient {
  readonly welcome: Welcome;
  readonly endpoint: Endpoint;
  call<M extends MethodName>(method: M, params: MethodParams[M]): Promise<MethodResults[M]>;
  /** Events: commits (and, for a person, steering changes) after `subscribe`; inbox events after `inbox.watch`. */
  onEvent(listener: (event: HostEvent) => void): () => void;
  /** Resolves when the connection ends, for any reason. */
  readonly closed: Promise<void>;
  readonly isClosed: () => boolean;
  close(): void;
}

interface Resolved {
  readonly project: string;
  readonly role: "human" | "agent";
  readonly agent?: string;
  readonly projectId?: string;
  readonly secret: string;
}

function resolveCredential(options: ConnectOptions): Resolved {
  const credential = options.credential;
  if (credential.role === "agent") {
    const read = readJsonFile(credential.file, AgentCredential);
    if (read === undefined)
      throw failure(
        "CredentialMissing",
        `No agent credential at ${credential.file}. A person creates one with "irudd pair <agent-id>".`,
      );
    if (!read.ok)
      throw failure(
        "CredentialMissing",
        `${credential.file} is not an irudd agent credential: ${read.diagnostics.map((d) => d.message).join(" ")}`,
      );
    return {
      project: read.value.project,
      role: "agent",
      agent: read.value.agent,
      projectId: read.value.projectId,
      secret: read.value.secret,
    };
  }
  const files = hostFiles(credential.project, options);
  const endpoint = readEndpoint(credential.project, options);
  let secret: string;
  try {
    secret = fs.readFileSync(files.humanKey, "utf8").trim();
  } catch {
    throw failure(
      "CredentialMissing",
      `The host for ${endpoint.project} has no human key at ${files.humanKey}. Restart the host.`,
    );
  }
  return { project: credential.project, role: "human", secret };
}

/** The endpoint of the host that owns `project`, or a `HostUnavailable` explaining what to do. */
export function readEndpoint(project: string, options: LocationOptions = {}): Endpoint {
  const files = hostFiles(project, options);
  const read = readJsonFile(files.endpoint, Endpoint);
  if (read === undefined)
    throw failure(
      "HostUnavailable",
      `No workshop host is running for ${path.resolve(project)}. Start one with: irudd host "${path.resolve(project)}", or open the project in the desktop app.`,
      { project },
    );
  if (!read.ok)
    throw failure(
      "HostUnavailable",
      `The endpoint file ${files.endpoint} is damaged. Restart the host.`,
      {
        project,
      },
    );
  return read.value;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

/** Connect and authenticate. Fails with a `WorkshopError` whose message says what to do next. */
export async function connect(options: ConnectOptions): Promise<WorkshopClient> {
  const resolved = resolveCredential(options);
  const endpoint = readEndpoint(resolved.project, options);
  if (resolved.projectId !== undefined && resolved.projectId !== endpoint.projectId)
    throw failure(
      "CredentialRejected",
      `This credential was issued for project ${resolved.projectId}, but ${endpoint.project} now holds project ${endpoint.projectId}. Pair the agent again.`,
    );
  const socket = await open(endpoint);
  const reader = new Queue();
  const frames = new FrameReader(
    (frame) => reader.push(frame),
    (message) => reader.fail(failure("ProtocolError", message)),
  );
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => frames.push(chunk));
  socket.on("close", () =>
    reader.fail(failure("ConnectionLost", "The host closed the connection.")),
  );
  socket.on("error", () => undefined);

  const key = deriveKey(resolved.secret);
  const clientNonce = newNonce();
  const timeout = options.timeoutMs ?? handshakeTimeoutMs;
  let welcome: Welcome;
  try {
    socket.write(
      encodeFrame({
        t: "hello",
        wire: wireProtocol,
        version: wireVersion,
        role: resolved.role,
        ...(resolved.agent === undefined ? {} : { agent: resolved.agent }),
        nonce: clientNonce,
        client: options.client ?? { name: "irudd-client", version: "1" },
      }),
    );
    const first = await reader.next(timeout);
    const refusedFirst = decodeWith(Refused, first);
    if (refusedFirst.ok) throw new WorkshopError(refusedFirst.value.error);
    const challenge = decodeWith(Challenge, first);
    if (!challenge.ok)
      throw failure("ProtocolError", "The host sent an unexpected handshake frame.");
    if (!sameProof(challenge.value.proof, proof(key, "host", clientNonce, challenge.value.nonce)))
      throw failure(
        "HostImpostor",
        `The process answering at ${endpoint.address} could not prove it holds this credential's key. Either the credential is out of date (pair the agent again) or another program is answering on the endpoint (stop it and restart the host).`,
      );
    socket.write(
      encodeFrame({ t: "auth", proof: proof(key, "client", challenge.value.nonce, clientNonce) }),
    );
    const second = await reader.next(timeout);
    const refused = decodeWith(Refused, second);
    if (refused.ok) throw new WorkshopError(refused.value.error);
    const decoded = decodeWith(Welcome, second);
    if (!decoded.ok) throw failure("ProtocolError", "The host sent an unexpected handshake frame.");
    welcome = decoded.value;
  } catch (error) {
    socket.destroy();
    throw error instanceof WorkshopError ? error : failure("ProtocolError", String(error));
  }
  return session(socket, reader, welcome, endpoint);
}

function open(endpoint: Endpoint): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ path: endpoint.address });
    socket.once("connect", () => {
      socket.removeAllListeners("error");
      resolve(socket);
    });
    socket.once("error", (error) => {
      const alive = processAlive(endpoint.host.pid);
      reject(
        failure(
          "HostUnavailable",
          alive
            ? `The workshop host for ${endpoint.project} (pid ${endpoint.host.pid}) is not accepting connections (${error.message}). Try again, or restart it.`
            : `The workshop host for ${endpoint.project} (pid ${endpoint.host.pid}) has stopped. Start it again with: irudd host "${endpoint.project}"`,
          { project: endpoint.project, pid: endpoint.host.pid },
        ),
      );
    });
  });
}

function session(
  socket: net.Socket,
  queue: Queue,
  welcome: Welcome,
  endpoint: Endpoint,
): WorkshopClient {
  let nextId = 1;
  let closed = false;
  const pending = new Map<
    number,
    { method: string; resolve: (value: unknown) => void; reject: (error: WorkshopError) => void }
  >();
  const listeners = new Set<(event: HostEvent) => void>();
  let resolveClosed: () => void = () => undefined;
  const closedPromise = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  const end = (reason: WorkshopError) => {
    if (closed) return;
    closed = true;
    for (const [, call] of pending)
      call.reject(
        failure(
          "ConnectionLost",
          `The connection to the workshop host ended while ${call.method} was in flight (${reason.message}). A write may or may not have committed: check it with "receipt" and the same request ID, or retry with the same request ID.`,
        ),
      );
    pending.clear();
    socket.destroy();
    resolveClosed();
  };

  queue.drain((frame) => {
    const decoded = decodeWith(HostFrame, frame);
    if (!decoded.ok) {
      end(failure("ProtocolError", "The host sent a frame this client cannot read."));
      return;
    }
    const value = decoded.value;
    if (value.t === "event") {
      for (const listener of listeners) listener(value);
      return;
    }
    const call = pending.get(value.id);
    if (!call) return;
    pending.delete(value.id);
    if (value.ok) call.resolve(value.value);
    else call.reject(new WorkshopError(value.error));
  }, end);

  return {
    welcome,
    endpoint,
    call<M extends MethodName>(method: M, params: MethodParams[M]): Promise<MethodResults[M]> {
      if (closed)
        return Promise.reject(
          failure("ConnectionLost", "This connection to the workshop host has closed."),
        );
      const id = nextId++;
      return new Promise<MethodResults[M]>((resolve, reject) => {
        pending.set(id, {
          method,
          resolve: (value) => {
            const guard = resultGuards[method];
            if (guard(value)) resolve(value);
            else
              reject(
                failure("ProtocolError", `The host's reply to ${method} has an unexpected shape.`),
              );
          },
          reject,
        });
        socket.write(encodeFrame({ t: "call", id, method, params }));
      });
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    closed: closedPromise,
    isClosed: () => closed,
    close() {
      end(failure("ConnectionLost", "The client closed the connection."));
    },
  };
}

/** Frames received before the session takes over, then a pass-through. */
class Queue {
  private items: unknown[] = [];
  private waiter:
    | { resolve: (frame: unknown) => void; reject: (error: WorkshopError) => void }
    | undefined;
  private error: WorkshopError | undefined;
  private sink:
    | { frame: (frame: unknown) => void; end: (error: WorkshopError) => void }
    | undefined;

  push(frame: unknown): void {
    if (this.sink) return this.sink.frame(frame);
    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = undefined;
      waiter.resolve(frame);
      return;
    }
    this.items.push(frame);
  }

  fail(error: WorkshopError): void {
    if (this.error) return;
    this.error = error;
    if (this.sink) return this.sink.end(error);
    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = undefined;
      waiter.reject(error);
    }
  }

  next(timeoutMs: number): Promise<unknown> {
    const item = this.items.shift();
    if (item !== undefined) return Promise.resolve(item);
    if (this.error) return Promise.reject(this.error);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = undefined;
        reject(
          failure(
            "HostUnavailable",
            `The workshop host did not finish the handshake within ${timeoutMs} ms.`,
          ),
        );
      }, timeoutMs);
      this.waiter = {
        resolve: (frame) => {
          clearTimeout(timer);
          resolve(frame);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
    });
  }

  drain(frame: (frame: unknown) => void, end: (error: WorkshopError) => void): void {
    this.sink = { frame, end };
    for (const item of this.items.splice(0)) frame(item);
    if (this.error) end(this.error);
  }
}

// ── Review artifacts ────────────────────────────────────────────────────────

interface ReviewReader {
  call<M extends MethodName>(method: M, params: MethodParams[M]): Promise<MethodResults[M]>;
}

/**
 * Every byte of an issued artifact, read with `review.read` in chunks. The
 * SHA-256 of what arrived must be the one asked for, so a client can bind what
 * it saves to the manifest it got.
 */
export async function readArtifact(
  client: ReviewReader,
  sha256: string,
): Promise<{ readonly bytes: Uint8Array; readonly mediaType: string }> {
  const parts: Buffer[] = [];
  let offset = 0;
  let mediaType = "application/octet-stream";
  for (;;) {
    const chunk = await client.call("review.read", { sha256, offset });
    const bytes = Buffer.from(chunk.base64, "base64");
    mediaType = chunk.mediaType;
    parts.push(bytes);
    offset += bytes.byteLength;
    if (chunk.done || bytes.byteLength === 0) break;
  }
  const bytes = new Uint8Array(Buffer.concat(parts));
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== sha256)
    throw failure("ProtocolError", `The artifact ${sha256} arrived with SHA-256 ${actual}.`);
  return { bytes, mediaType };
}
