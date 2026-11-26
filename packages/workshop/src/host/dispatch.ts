// One table of verbs for every caller of a host: wire connections from the CLI
// and MCP, and the desktop window calling in-process. Authorization happens
// here, against the role the host bound when the caller authenticated.

import { Effect, Exit } from "effect";
import {
  decodeWith,
  diagnostic,
  isJson,
  isJsonObject,
  type Actor,
  type Json,
} from "@irudd/document";
import path from "node:path";
import type { ApplyResult, ImportReport, Project, Session } from "../contract/project.js";
import {
  agentMethods,
  decodeParams,
  humanOnlyCommands,
  isMethodName,
  methodParams,
  toWireError,
  type CommitEvent,
  type DecodedParams,
  type HostIdentity,
  type MethodName,
  type StartersView,
  type WireErrorShape,
} from "../wire/protocol.js";
import type { Credentials } from "./credentials.js";
import { SteeringError, type AgentLink, type Steering } from "../steering/service.js";
import type { ResolvedStarter } from "./starters.js";
import { stageFormArtwork } from "./artwork.js";
import { isReviewMethod, type ReviewRoutes } from "../review/dispatch.js";
import type { ConnectionLink } from "../review/remote.js";
import { isArtMethod, type ArtRoutes } from "../art/dispatch.js";

export interface Caller {
  readonly actor: Actor;
  readonly role: "human" | "agent";
  readonly session: Session;
  /** Agents: the pairing this connection authenticated with, and its link for inbox events. */
  readonly link?: AgentLink;
  /** The wire connection this caller authenticated on; absent for desktop main in process. */
  readonly connection?: ConnectionLink;
}

export type Outcome =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: WireErrorShape };

const error = (tag: string, message: string, fields: Record<string, unknown> = {}): Outcome => ({
  ok: false,
  error: { ...fields, _tag: tag, message },
});

async function run<A, E>(effect: Effect.Effect<A, E>): Promise<Outcome> {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return { ok: true, value: exit.value };
  const failed = exit.cause.reasons.find((reason) => reason._tag === "Fail");
  if (failed && failed._tag === "Fail") return { ok: false, error: toWireError(failed.error) };
  return error("HostFailed", `The host failed unexpectedly: ${String(exit.cause)}`);
}

const rejected = (
  code: "forbidden",
  path: ReadonlyArray<string>,
  message: string,
): ApplyResult => ({
  kind: "rejected",
  diagnostics: [diagnostic(code, path, message)],
});

export interface DispatchContext {
  readonly project: Project;
  readonly credentials: Credentials;
  readonly identity: HostIdentity;
  readonly starters: {
    readonly view: StartersView;
    readonly byId: ReadonlyMap<string, ResolvedStarter>;
  };
  readonly emit: (event: CommitEvent) => void;
  readonly steering: Steering;
  readonly review: ReviewRoutes;
  readonly art: ArtRoutes;
}

export class Dispatcher {
  private readonly context: DispatchContext;
  constructor(context: DispatchContext) {
    this.context = context;
  }

  /** A connection closed: forget its inbox watch. */
  connected(link: AgentLink): void {
    this.context.steering.connected(link);
  }

  disconnected(linkId: string): void {
    this.context.steering.disconnected(linkId);
  }

  /** A connection closed: a renderer it served leaves, failing its jobs. */
  connectionClosed(connectionId: string): void {
    this.context.review.connectionClosed(connectionId);
    this.context.art.connectionClosed(connectionId);
  }

  /** Run one method for an authenticated caller. Never throws. */
  async call(caller: Caller, method: string, params: unknown): Promise<Outcome> {
    if (!isMethodName(method))
      return error("UnknownMethod", `The host has no method ${method}.`, { method });
    if (caller.role === "agent" && !agentMethods.has(method))
      return error(
        "Forbidden",
        `${method} needs a person. Agents read, create documents and propose changes; a person accepts them.`,
        { method },
      );
    const decoded = decodeParams(method, params);
    if (!decoded.ok)
      return error(
        "InvalidArgument",
        decoded.diagnostics.map((d) => `${d.path.join(".")}: ${d.message}`).join(" "),
        { path: decoded.diagnostics[0]?.path ?? ["params"], diagnostics: decoded.diagnostics },
      );
    if (isReviewMethod(method)) return this.context.review.call(caller, method, decoded.value);
    if (isArtMethod(method))
      return this.context.art.call(
        {
          actor: caller.actor,
          role: caller.role,
          session: caller.session,
          key: caller.connection?.id ?? "in-process",
          ...(caller.link ? { link: caller.link } : {}),
        },
        method,
        decoded.value,
      );
    try {
      return await this.route(caller, method, decoded.value);
    } catch (thrown) {
      return { ok: false, error: toWireError(thrown) };
    }
  }

  private async route(
    caller: Caller,
    method: MethodName,
    p: DecodedParams[MethodName],
  ): Promise<Outcome> {
    const { project, credentials, identity, steering } = this.context;
    const params: Record<string, unknown> = { ...p };
    const text = (key: string): string => String(params[key]);
    const number = (key: string): number => Number(params[key]);
    switch (method) {
      case "project.info":
        return { ok: true, value: { ...project.info, host: identity } };
      case "project.image": {
        const blob = await Effect.runPromise(project.blob(text("digest")));
        if (!["image/png", "image/webp", "image/jpeg"].includes(blob.mediaType))
          return error("InvalidArgument", "The requested project asset is not a raster image.");
        const offset = number("offset");
        if (offset > blob.byteLength)
          return error("InvalidArgument", "The image offset exceeds its size.");
        const end = Math.min(blob.byteLength, offset + 3 * 1024 * 1024);
        return {
          ok: true,
          value: {
            digest: blob.digest,
            mediaType: blob.mediaType,
            byteLength: blob.byteLength,
            offset,
            base64: Buffer.from(blob.bytes.subarray(offset, end)).toString("base64"),
            done: end === blob.byteLength,
          },
        };
      }
      case "whoami":
        return { ok: true, value: { actor: caller.actor, role: caller.role } };
      case "starters":
        return { ok: true, value: this.context.starters.view };
      case "documents":
        return run(project.documents);
      case "current":
        return run(project.current(text("documentId")));
      case "inspect":
        return run(project.inspect(text("documentId")));
      case "changes": {
        const by = params["by"];
        return run(
          project.changes(text("documentId"), {
            since: number("since"),
            ...(by === "human" || by === "agent" ? { by } : {}),
          }),
        );
      }
      case "diff":
        return run(project.diff(text("documentId"), number("from"), number("to")));
      case "draft":
        return run(project.draft(text("documentId"), text("proposalId")));
      case "receipt": {
        const outcome = await run(project.receipt(text("documentId"), text("requestId")));
        return outcome.ok ? { ok: true, value: outcome.value ?? null } : outcome;
      }
      case "apply":
        return this.apply(caller, params["request"]);
      case "start":
        return this.start(caller, params);
      case "subscribe":
        return { ok: true, value: { subscribed: true } };
      case "pair.agent": {
        const name = params["name"];
        const paired = credentials.pair(text("agent"), typeof name === "string" ? name : undefined);
        steering.pairingChanged(paired.agent);
        return { ok: true, value: paired };
      }
      case "pair.list":
        return { ok: true, value: credentials.list() };
      case "pair.revoke": {
        const revoked = credentials.revoke(text("agent"));
        steering.pairingChanged(text("agent"));
        return { ok: true, value: { agent: text("agent"), revoked } };
      }
      case "verify":
        return run(project.verify);
      case "document.save":
      case "document.open": {
        const file = text("path");
        if (!path.isAbsolute(file))
          return error("InvalidArgument", `Give an absolute path, not ${file}.`, {
            path: ["params", "path"],
          });
        if (method === "document.save") return run(project.saveCharacter(text("documentId"), file));
        // Windows and clients learn of the new document as of a commit.
        const announce = (report: ImportReport) =>
          this.context.emit({
            t: "event",
            event: "commit",
            documentId: report.documentId,
            revision: report.revision,
            sequence: report.journal.sequence,
            command: "document.open",
            actor: caller.actor,
          });
        return run(
          caller.session
            .openCharacter(file)
            .pipe(Effect.tap((r) => Effect.sync(() => announce(r)))),
        );
      }
      default:
        return this.steer(caller, method, p);
    }
  }

  /** The steering methods: people manage recipients and the outbox, agents their inbox. */
  private async steer(
    caller: Caller,
    method: MethodName,
    p: DecodedParams[MethodName],
  ): Promise<Outcome> {
    const steering = this.context.steering;
    const ok = (value: unknown): Outcome => ({ ok: true, value });
    const link = () => {
      if (caller.role !== "agent" || !caller.link)
        throw new SteeringError("Forbidden", `${method} is for a paired agent's connection.`);
      return caller.link;
    };
    const params: Record<string, unknown> = { ...p };
    const str = (key: string): string => {
      const value = params[key];
      if (typeof value !== "string")
        throw new SteeringError("InvalidArgument", `${key} is required.`);
      return value;
    };
    const opt = (key: string): unknown => params[key];
    switch (method) {
      case "recipient.bind": {
        const decoded = decodeWith(methodParams["recipient.bind"], p);
        if (!decoded.ok)
          return error("InvalidArgument", "The route does not match any transport.", {
            path: ["params", "route"],
          });
        const { agent, route, documents } = decoded.value;
        return ok(
          steering.bind(caller.actor, {
            agent,
            route,
            ...(documents === undefined ? {} : { documents }),
          }),
        );
      }
      case "recipient.unbind":
        return ok(steering.unbind(str("agent")));
      case "recipient.list":
        return ok(steering.recipients());
      case "recipient.check":
        return ok(await steering.check(str("agent")));
      case "steer.send": {
        const documentId = opt("documentId");
        return ok(
          await steering.send(caller.actor, {
            agent: str("agent"),
            requestId: str("requestId"),
            text: str("text"),
            ...(typeof documentId === "string" ? { documentId } : {}),
          }),
        );
      }
      case "steer.list": {
        const agent = opt("agent");
        const after = opt("after");
        const limit = opt("limit");
        return ok(
          steering.list({
            ...(typeof agent === "string" ? { agent } : {}),
            ...(typeof after === "number" ? { after } : {}),
            ...(typeof limit === "number" ? { limit } : {}),
          }),
        );
      }
      case "steer.get":
        return ok(steering.get(str("messageId")));
      case "steer.cancel":
        return ok(steering.cancel(str("messageId")));
      case "steer.retry":
        return ok(steering.retry(str("messageId")));
      case "inbox.read": {
        const after = opt("after");
        const all = opt("all");
        return ok(
          steering.inbox(link(), {
            ...(typeof after === "number" ? { after } : {}),
            ...(typeof all === "boolean" ? { all } : {}),
          }),
        );
      }
      case "inbox.ack":
        return ok(steering.ack(link(), str("messageId")));
      case "inbox.applied":
        return ok(
          await steering.applied(link(), {
            messageId: str("messageId"),
            documentId: str("documentId"),
            requestId: str("requestId"),
          }),
        );
      case "inbox.watch": {
        const push = opt("push");
        const instance = opt("instance");
        const server = opt("server");
        const client = opt("client");
        const clientName: unknown =
          typeof client === "object" && client !== null ? Reflect.get(client, "name") : undefined;
        const clientVersion: unknown =
          typeof client === "object" && client !== null
            ? Reflect.get(client, "version")
            : undefined;
        return ok(
          steering.watch(link(), {
            push: push === "claude-channel" ? "claude-channel" : "events",
            ...(typeof instance === "string" ? { instance } : {}),
            ...(typeof server === "string" ? { server } : {}),
            ...(typeof clientName === "string" && typeof clientVersion === "string"
              ? { client: { name: clientName, version: clientVersion } }
              : {}),
          }),
        );
      }
      case "inbox.pushed":
        return ok(steering.pushed(link(), str("messageId")));
      default:
        return error("UnknownMethod", `The host has no method ${method}.`, { method });
    }
  }

  /** Apply one envelope with the caller's actor stamped by the session. */
  async apply(caller: Caller, request: unknown): Promise<Outcome> {
    if (typeof request === "object" && request !== null && !Array.isArray(request)) {
      if ("actor" in request)
        return {
          ok: true,
          value: rejected(
            "forbidden",
            ["actor"],
            "Leave actor out of the request. The host stamps the actor bound to this connection.",
          ),
        };
      const command: unknown = Reflect.get(request, "command");
      const type: unknown =
        typeof command === "object" && command !== null ? Reflect.get(command, "type") : undefined;
      if (caller.role === "agent" && typeof type === "string" && humanOnlyCommands.has(type))
        return {
          ok: true,
          value: rejected("forbidden", ["command", "type"], `Only a person can send ${type}.`),
        };
    }
    const outcome = await run(caller.session.apply(request));
    if (outcome.ok) this.notify(caller.actor, outcome.value);
    return outcome;
  }

  private notify(actor: Actor, value: unknown): void {
    if (typeof value !== "object" || value === null) return;
    const kind: unknown = Reflect.get(value, "kind");
    if (kind !== "committed") return;
    const receipt: unknown = Reflect.get(value, "receipt");
    const entry: unknown = Reflect.get(value, "entry");
    if (
      typeof receipt !== "object" ||
      receipt === null ||
      typeof entry !== "object" ||
      entry === null
    )
      return;
    this.context.emit({
      t: "event",
      event: "commit",
      documentId: String(Reflect.get(receipt, "documentId")),
      revision: Number(Reflect.get(receipt, "revision")),
      sequence: Number(Reflect.get(entry, "sequence")),
      command: String(Reflect.get(receipt, "command")),
      actor,
    });
  }

  private async start(caller: Caller, params: Record<string, unknown>): Promise<Outcome> {
    const starterId = String(params["starter"]);
    const resolved = this.context.starters.byId.get(starterId);
    if (!resolved)
      return error(
        "InvalidArgument",
        `There is no starter ${starterId}. This host offers: ${[...this.context.starters.byId.keys()].join(", ") || "none"}.`,
        { path: ["params", "starter"] },
      );
    const preset = params["preset"];
    const seed = params["seed"];
    const explicit = params["params"];
    const customLabel = params["label"];
    const requestId = String(params["requestId"]);
    const documentId = String(params["documentId"]);
    if (resolved.kind === "form") {
      if (preset !== undefined || seed !== undefined || explicit !== undefined)
        return error(
          "InvalidArgument",
          `Starter ${resolved.form.id} is a prepared form; it takes no preset, seed or params.`,
          { path: ["params"] },
        );
      const source = resolved.form.document;
      const document: Json = isJsonObject(source)
        ? {
            ...source,
            id: documentId,
            ...(typeof customLabel === "string" ? { label: customLabel } : {}),
          }
        : source;
      // Artwork goes into the verified blob store first, so the revision never
      // references bytes the project does not hold.
      const staged = await stageFormArtwork(
        this.context.project,
        caller.session,
        resolved.form.id,
        document,
        resolved.form.artwork ?? [],
      );
      if (!staged.ok)
        return error(staged.tag, staged.message, {
          path: ["params", "starter"],
          digests: staged.digests,
        });
      const outcome = await this.apply(caller, {
        format: "irudd.command",
        version: 1,
        requestId,
        documentId,
        expectedRevision: 0,
        command: { type: "document.create", document },
      });
      if (!outcome.ok) return outcome;
      return {
        ok: true,
        value: {
          starter: resolved.form.id,
          kind: "form",
          generator: null,
          preset: null,
          seed: null,
          params: null,
          result: outcome.value,
          artwork: staged.staged,
        },
      };
    }
    const definition = resolved.definition;
    const given = [preset, seed, explicit].filter((v) => v !== undefined).length;
    if (given > 1)
      return error("InvalidArgument", "Give at most one of preset, seed and params.", {
        path: ["params"],
      });
    let chosen: unknown;
    let label: string;
    let presetId: string | null = null;
    let seedValue: number | null = null;
    if (typeof seed === "number") {
      if (!definition.seed)
        return error("InvalidArgument", `Starter ${definition.id} has no seeded variations.`, {
          path: ["params", "seed"],
        });
      chosen = definition.seed(seed);
      seedValue = seed;
      label = `${definition.label} ${seed}`;
    } else if (explicit !== undefined) {
      chosen = explicit;
      label = definition.label;
    } else {
      const wanted = typeof preset === "string" ? preset : "default";
      const found = definition.presets.find((p) => p.id === wanted);
      if (!found)
        return error(
          "InvalidArgument",
          definition.presets.length === 0
            ? `Starter ${definition.id} has no presets; pass params${definition.seed ? " or a seed" : ""}.`
            : `Starter ${definition.id} has no preset ${wanted}. Presets: ${definition.presets.map((p) => p.id).join(", ")}.`,
          { path: ["params", "preset"] },
        );
      chosen = found.params;
      presetId = found.id;
      label = found.label;
    }
    const request = {
      format: "irudd.command",
      version: 1,
      requestId,
      documentId,
      expectedRevision: 0,
      command: {
        type: "document.generate",
        label: typeof customLabel === "string" ? customLabel : label,
        generator: definition.generator.id,
        version: definition.generator.version,
        params: toJson(chosen),
      },
    };
    const outcome = await this.apply(caller, request);
    if (!outcome.ok) return outcome;
    return {
      ok: true,
      value: {
        starter: definition.id,
        kind: "generator",
        generator: { id: definition.generator.id, version: definition.generator.version },
        preset: presetId,
        seed: seedValue,
        params: chosen,
        result: outcome.value,
      },
    };
  }
}

/** Parameters as JSON, so a preset object reaches the reducer as plain data. */
function toJson(value: unknown): Json {
  const parsed: unknown = JSON.parse(JSON.stringify(value ?? null));
  return isJson(parsed) ? parsed : null;
}
