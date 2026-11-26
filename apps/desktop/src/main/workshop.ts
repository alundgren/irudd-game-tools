// The desktop's link to a project: the shared workshop host, in-process when
// this process owns the project, or a client of the process that does.
//
// This adapter is the only place desktop main touches the project service.
// It never opens SQLite itself, so a window, the CLI and MCP share one owner,
// one registry, one write path and one stream of commit events.

import { Schema } from "effect";
import type { Registry } from "@irudd/document";
import { attachOrHost, loadForms, type StarterDefinition } from "@irudd/workshop/host";
import { WorkshopError } from "@irudd/workshop/client";
import {
  methodParams,
  type CommitEvent,
  type SteerEvent,
  type MethodName,
  type MethodParams,
  type MethodResults,
} from "@irudd/workshop/wire";
import type { CallOutcome, CommitNotice, SteerNotice, WindowMethod } from "../shared/api.js";
import { registerInProcess, serveAttached } from "./review-link.js";
import type { ReviewWorker } from "./review.js";
import { desktopArtTranslators, shippedArtwork, type ArtRaster } from "./art.js";

/** Both the in-process host and an attached client answer the same verbs. */
interface Verbs {
  call<M extends MethodName>(method: M, params: MethodParams[M]): Promise<MethodResults[M]>;
}

export interface WorkshopLink {
  readonly mode: "host" | "attached";
  readonly directory: string;
  readonly label: string;
  /** Validate the window's parameters and call the method as the person. */
  call(method: WindowMethod, params: unknown): Promise<CallOutcome>;
  onCommit(listener: (notice: CommitNotice) => void): () => void;
  /** Steering messages changing state: queued, host accepted, acknowledged, applied, and so on. */
  onSteer(listener: (notice: SteerNotice) => void): () => void;
  /**
   * Save or open a character file at a path main chose from a dialog. The
   * same host method the CLI calls; it throws `WorkshopError` on failure.
   */
  characterFile<M extends "document.save" | "document.open">(
    method: M,
    params: MethodParams[M],
  ): Promise<MethodResults[M]>;
  close(): Promise<void>;
}

function refuse(method: string): Promise<never> {
  return Promise.reject(
    new WorkshopError({ _tag: "InvalidArgument", message: `Invalid parameters for ${method}.` }),
  );
}

const is = Schema.is;

// One entry per window method: the parameters are checked against the wire
// schema before they reach the host, which checks them again.
const routes: {
  readonly [M in WindowMethod]: (verbs: Verbs, params: unknown) => Promise<unknown>;
} = {
  "project.info": (v, p) =>
    is(methodParams["project.info"])(p) ? v.call("project.info", p) : refuse("project.info"),
  starters: (v, p) => (is(methodParams.starters)(p) ? v.call("starters", p) : refuse("starters")),
  documents: (v, p) =>
    is(methodParams.documents)(p) ? v.call("documents", p) : refuse("documents"),
  current: (v, p) => (is(methodParams.current)(p) ? v.call("current", p) : refuse("current")),
  inspect: (v, p) => (is(methodParams.inspect)(p) ? v.call("inspect", p) : refuse("inspect")),
  changes: (v, p) => (is(methodParams.changes)(p) ? v.call("changes", p) : refuse("changes")),
  diff: (v, p) => (is(methodParams.diff)(p) ? v.call("diff", p) : refuse("diff")),
  draft: (v, p) => (is(methodParams.draft)(p) ? v.call("draft", p) : refuse("draft")),
  apply: (v, p) => (is(methodParams.apply)(p) ? v.call("apply", p) : refuse("apply")),
  start: (v, p) => (is(methodParams.start)(p) ? v.call("start", p) : refuse("start")),
  "pair.agent": (v, p) =>
    is(methodParams["pair.agent"])(p) ? v.call("pair.agent", p) : refuse("pair.agent"),
  "pair.list": (v, p) =>
    is(methodParams["pair.list"])(p) ? v.call("pair.list", p) : refuse("pair.list"),
  "pair.revoke": (v, p) =>
    is(methodParams["pair.revoke"])(p) ? v.call("pair.revoke", p) : refuse("pair.revoke"),
  verify: (v, p) => (is(methodParams.verify)(p) ? v.call("verify", p) : refuse("verify")),
  "recipient.list": (v, p) =>
    is(methodParams["recipient.list"])(p) ? v.call("recipient.list", p) : refuse("recipient.list"),
  "recipient.check": (v, p) =>
    is(methodParams["recipient.check"])(p)
      ? v.call("recipient.check", p)
      : refuse("recipient.check"),
  "recipient.bind": (v, p) =>
    is(methodParams["recipient.bind"])(p) ? v.call("recipient.bind", p) : refuse("recipient.bind"),
  "recipient.unbind": (v, p) =>
    is(methodParams["recipient.unbind"])(p)
      ? v.call("recipient.unbind", p)
      : refuse("recipient.unbind"),
  "steer.send": (v, p) =>
    is(methodParams["steer.send"])(p) ? v.call("steer.send", p) : refuse("steer.send"),
  "steer.list": (v, p) =>
    is(methodParams["steer.list"])(p) ? v.call("steer.list", p) : refuse("steer.list"),
  "steer.get": (v, p) =>
    is(methodParams["steer.get"])(p) ? v.call("steer.get", p) : refuse("steer.get"),
  "steer.cancel": (v, p) =>
    is(methodParams["steer.cancel"])(p) ? v.call("steer.cancel", p) : refuse("steer.cancel"),
  "steer.retry": (v, p) =>
    is(methodParams["steer.retry"])(p) ? v.call("steer.retry", p) : refuse("steer.retry"),
  "review.capabilities": (v, p) =>
    is(methodParams["review.capabilities"])(p)
      ? v.call("review.capabilities", p)
      : refuse("review.capabilities"),
  "review.export": (v, p) =>
    is(methodParams["review.export"])(p) ? v.call("review.export", p) : refuse("review.export"),
  "review.inspect": (v, p) =>
    is(methodParams["review.inspect"])(p) ? v.call("review.inspect", p) : refuse("review.inspect"),
  "project.image": (v, p) =>
    is(methodParams["project.image"])(p) ? v.call("project.image", p) : refuse("project.image"),
  "review.read": (v, p) =>
    is(methodParams["review.read"])(p) ? v.call("review.read", p) : refuse("review.read"),
  "art.capabilities": (v, p) =>
    is(methodParams["art.capabilities"])(p)
      ? v.call("art.capabilities", p)
      : refuse("art.capabilities"),
  "art.put": (v, p) => (is(methodParams["art.put"])(p) ? v.call("art.put", p) : refuse("art.put")),
  "art.request": (v, p) =>
    is(methodParams["art.request"])(p) ? v.call("art.request", p) : refuse("art.request"),
  "art.list": (v, p) =>
    is(methodParams["art.list"])(p) ? v.call("art.list", p) : refuse("art.list"),
  "art.get": (v, p) => (is(methodParams["art.get"])(p) ? v.call("art.get", p) : refuse("art.get")),
  "art.read": (v, p) =>
    is(methodParams["art.read"])(p) ? v.call("art.read", p) : refuse("art.read"),
  "art.submit": (v, p) =>
    is(methodParams["art.submit"])(p) ? v.call("art.submit", p) : refuse("art.submit"),
  "art.cancel": (v, p) =>
    is(methodParams["art.cancel"])(p) ? v.call("art.cancel", p) : refuse("art.cancel"),
};

export function isWindowMethod(value: unknown): value is WindowMethod {
  return typeof value === "string" && Object.hasOwn(routes, value);
}

function outcomeOf(error: unknown): CallOutcome {
  if (error instanceof WorkshopError)
    return { ok: false, error: { _tag: error._tag, message: error.message } };
  if (error instanceof Error)
    return { ok: false, error: { _tag: "HostFailed", message: error.message } };
  return { ok: false, error: { _tag: "HostFailed", message: String(error) } };
}

function notice(event: CommitEvent): CommitNotice {
  return {
    documentId: event.documentId,
    revision: event.revision,
    sequence: event.sequence,
    command: event.command,
    actor: event.actor,
  };
}

export interface LinkOptions {
  readonly directory: string;
  /** Create the project with this label when the directory holds none. */
  readonly create?: { readonly label: string; readonly inMemory?: boolean };
  /** Directory of prepared form documents the host offers as starters. */
  readonly forms?: string;
  /** The features and generators a hosted project reads documents with. */
  readonly registry?: Registry;
  /** The starters a hosted project offers, beside its prepared forms. */
  readonly starters?: ReadonlyArray<StarterDefinition>;
  /** The isolated review worker this window offers the project as its renderer. */
  readonly review?: ReviewWorker;
  /** The raster the art fits draw with; the review worker's when absent. */
  readonly raster?: ArtRaster;
  readonly log?: (line: string) => void;
}

export async function openWorkshop(options: LinkOptions): Promise<WorkshopLink> {
  const loaded = options.forms ? loadForms(options.forms) : { forms: [], problems: [] };
  for (const problem of loaded.problems) console.warn(`Form starter skipped: ${problem}`);
  const forms = loaded.forms;
  const attached = await attachOrHost({
    path: options.directory,
    kind: "desktop",
    forms,
    artTranslators: desktopArtTranslators(options.raster ?? options.review),
    shippedArtwork,
    ...(options.registry ? { registry: options.registry } : {}),
    ...(options.starters ? { starters: options.starters } : {}),
    // The installed launcher names its own CLI, so steering tells agents a command that exists.
    ...(process.env["IRUDD_AGENT_COMMAND"]
      ? { agentCommand: process.env["IRUDD_AGENT_COMMAND"] }
      : {}),
    ...(options.create ? { create: options.create } : {}),
  });
  const listeners = new Set<(notice: CommitNotice) => void>();
  const emit = (event: CommitEvent): void => {
    for (const listener of listeners) listener(notice(event));
  };
  const steerListeners = new Set<(notice: SteerNotice) => void>();
  const emitSteer = (event: SteerEvent): void => {
    const steered: SteerNotice = {
      messageId: event.messageId,
      agent: event.agent,
      seq: event.seq,
      status: event.status,
    };
    for (const listener of steerListeners) listener(steered);
  };
  let verbs: Verbs;
  let stop: () => Promise<void>;
  if (attached.mode === "host") {
    const host = attached.host;
    verbs = host;
    const off = host.onCommit(emit);
    const offSteer = host.onSteer(emitSteer);
    // The worker starts beside the window: opening the project never waits for it.
    let closed = false;
    let offReview = (): void => undefined;
    if (options.review)
      void registerInProcess(host, options.review, options.log).then((unregister) => {
        if (closed) unregister();
        else offReview = unregister;
      });
    stop = async () => {
      closed = true;
      off();
      offSteer();
      offReview();
      await host.close();
    };
  } else {
    const client = attached.client;
    verbs = client;
    // Inbox events are for agent connections; a window only shows commits and steering states.
    const off = client.onEvent((event) => {
      if (event.event === "commit") emit(event);
      else if (event.event === "steer") emitSteer(event);
    });
    await client.call("subscribe", {});
    if (options.review)
      void serveAttached(client, options.review, options.log).catch((error: unknown) =>
        (options.log ?? console.warn)(
          `Review worker not offered: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    stop = async () => {
      off();
      client.close();
      await client.closed;
    };
  }
  const info = await verbs.call("project.info", {});
  return {
    mode: attached.mode,
    directory: info.directory,
    label: info.label,
    async call(method, params) {
      try {
        return { ok: true, value: await routes[method](verbs, params) };
      } catch (error) {
        return outcomeOf(error);
      }
    },
    onCommit(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    characterFile: (method, params) => verbs.call(method, params),
    onSteer(listener) {
      steerListeners.add(listener);
      return () => steerListeners.delete(listener);
    },
    close: stop,
  };
}
