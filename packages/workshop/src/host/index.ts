import { Effect, Exit, Scope } from "effect";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { Actor, Registry } from "@irudd/document";
import { ProjectLocked, type ProjectError } from "../contract/errors.js";
import { projectFileName, type Project } from "../contract/project.js";
import { createProject, openProject } from "../service/project.js";

import {
  methodNames,
  wireProtocol,
  wireVersion,
  type CommitEvent,
  type HostEvent,
  type HostIdentity,
  type MethodName,
  type MethodParams,
  type MethodResults,
} from "../wire/protocol.js";
import type { SteerEvent } from "../wire/steering.js";
import { Steering } from "../steering/service.js";
import { SteeringStore } from "../steering/store.js";
import {
  agentCredentialPath,
  canonicalProjectPath,
  endpointAddress,
  hostFiles,
  writePrivateFile,
  type Endpoint,
  type HostFiles,
  type LocationOptions,
} from "../wire/local.js";
import { connect, resultGuards, WorkshopError, type WorkshopClient } from "../client/index.js";
import { Credentials } from "./credentials.js";
import { Review, type ReviewRenderer } from "../review/service.js";
import { ReviewRoutes } from "../review/dispatch.js";
import { Art, ArtError, type ArtCut, type ArtTranslator } from "../art/service.js";
import { ArtRoutes } from "../art/dispatch.js";
import { ArtStore } from "../art/store.js";
import { Dispatcher, type Caller } from "./dispatch.js";
import { serveConnection, type Subscriber } from "./server.js";
import {
  startersView,
  workshopRegistry,
  workshopStarters,
  type FormStarter,
  type StarterDefinition,
} from "./starters.js";

export type { ReviewRenderer, RenderOutput } from "../review/service.js";
export {
  ArtError,
  artCommandId,
  variationTranslator,
  type ArtCut,
  type ArtTranslation,
  type ArtTranslator,
  type ArtTranslatorInput,
} from "../art/service.js";
export {
  loadForms,
  workshopRegistry,
  workshopStarters,
  seededRandom,
  type FormStarter,
  type StarterDefinition,
} from "./starters.js";

export interface HostOptions extends LocationOptions {
  readonly path: string;
  readonly create?: { readonly label: string; readonly inMemory?: boolean };
  readonly registry?: Registry;
  readonly starters?: ReadonlyArray<StarterDefinition>;
  readonly forms?: ReadonlyArray<FormStarter>;
  readonly human?: Actor;
  readonly kind?: HostIdentity["kind"];
  readonly durability?: "full" | "normal";
  readonly lockTimeoutMs?: number;
  readonly log?: (line: string) => void;
  readonly agentCommand?: string;
  readonly artTranslators?: ReadonlyArray<ArtTranslator>;
  readonly artCut?: (point: ArtCut) => void;
  readonly shippedArtwork?: ReadonlyArray<string>;
  readonly steeringTiming?: {
    readonly retryBaseMs?: number;
    readonly deliverTimeoutMs?: number;
    readonly checkTimeoutMs?: number;
    readonly channelConfirmMs?: number;
  };
}

export interface WorkshopHost {
  readonly project: Project;
  readonly endpoint: Endpoint;
  readonly files: HostFiles;
  readonly human: Actor;
  call<M extends MethodName>(method: M, params: MethodParams[M]): Promise<MethodResults[M]>;
  onCommit(listener: (event: CommitEvent) => void): () => void;
  onSteer(listener: (event: SteerEvent) => void): () => void;
  registerRenderer(renderer: ReviewRenderer): () => void;
  registerArtTranslator(translator: ArtTranslator): () => void;
}

export class HostFailed extends Error {
  readonly _tag = "HostFailed";
}

export function defaultHuman(): Actor {
  let name = "person";
  try {
    name = os.userInfo().username;
  } catch {}
  const id =
    name
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, "-")
      .replace(/^[^a-z0-9]+/, "")
      .slice(0, 64) || "person";
  return { kind: "human", id, ...(name.trim() ? { name: name.trim().slice(0, 120) } : {}) };
}

function listen(server: net.Server, address: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(address, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
}

export const hostProject = (
  options: HostOptions,
): Effect.Effect<WorkshopHost, ProjectError | HostFailed, Scope.Scope> =>
  Effect.gen(function* () {
    const registry = options.registry ?? workshopRegistry();
    const common = {
      path: options.path,
      registry,
      ...(options.durability === undefined ? {} : { durability: options.durability }),
      ...(options.lockTimeoutMs === undefined ? {} : { lockTimeoutMs: options.lockTimeoutMs }),
    };
    const exists = fs.existsSync(path.join(options.path, projectFileName));
    const project: Project =
      !exists && options.create
        ? yield* createProject({ ...common, ...options.create })
        : yield* openProject(common);

    const log = options.log ?? (() => undefined);
    const files = hostFiles(options.path, options);
    if (options.create?.inMemory && !fs.existsSync(files.dir)) {
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          fs.rmSync(files.dir, { recursive: true, force: true });
        }),
      );
    }
    const instance = randomBytes(16).toString("hex");
    const identity: HostIdentity = {
      pid: process.pid,
      instance,
      startedAt: Date.now(),
      kind: options.kind ?? "headless",
    };
    const human = options.human ?? defaultHuman();
    const credentials = yield* Effect.try({
      try: () =>
        new Credentials(files, {
          directory: canonicalProjectPath(options.path),
          projectId: project.info.projectId,
        }),
      catch: (cause) =>
        new HostFailed(`Cannot write host credentials in ${files.dir}: ${String(cause)}`),
    });
    const subscribers = new Set<Subscriber>();
    const listeners = new Set<(event: CommitEvent) => void>();
    const steerListeners = new Set<(event: SteerEvent) => void>();
    const broadcast = (event: HostEvent, roles: ReadonlyArray<"human" | "agent">) => {
      for (const subscriber of subscribers)
        if (roles.includes(subscriber.role)) subscriber.send(event);
    };
    const opened = yield* Effect.try({
      try: () => SteeringStore.open({ directory: files.dir, projectId: project.info.projectId }),
      catch: (cause) =>
        new HostFailed(`Cannot open the steering outbox in ${files.dir}: ${String(cause)}`),
    });
    if (opened.replaced)
      log(
        `steering: the outbox belonged to another project at this path; kept it as ${opened.replaced}`,
      );
    let art: Art | undefined;
    const steering = new Steering({
      store: opened.store,
      project,
      pairings: credentials,
      emit: (event) => {
        broadcast(event, ["human"]);
        for (const listener of steerListeners) listener(event);
      },
      agentCommand: options.agentCommand ?? "irudd",
      credentialFile: (agent) => agentCredentialPath(files, agent),
      instructions: (message, cli) => art?.instructions(message, cli),
      log,
      ...options.steeringTiming,
    });
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        steering.stop();
        opened.store.close();
      }),
    );
    const review = new Review({ project, dir: path.join(files.dir, "review"), log });
    yield* Effect.addFinalizer(() => Effect.sync(() => review.stop()));
    const artLog = yield* Effect.try({
      try: () => ArtStore.open({ directory: files.dir, projectId: project.info.projectId }),
      catch: (cause) =>
        new HostFailed(`Cannot open the art request log in ${files.dir}: ${String(cause)}`),
    });
    if (artLog.replaced)
      log(
        `art: the request log belonged to another project at this path; kept it as ${artLog.replaced}`,
      );
    yield* Effect.addFinalizer(() => Effect.sync(() => artLog.store.close()));
    let dispatchRef: Dispatcher | undefined;
    const shipped = new Set([
      ...(options.forms ?? []).flatMap((f) => (f.artwork ?? []).map((a) => a.digest)),
      ...(options.shippedArtwork ?? []),
    ]);
    art = new Art({
      project,
      store: artLog.store,
      steering,
      pairings: credentials,
      ...(options.artCut ? { cut: options.artCut } : {}),
      shipped: (digest) => shipped.has(digest),
      apply: async (caller, request) => {
        if (!dispatchRef) throw new ArtError("HostFailed", "The host is not ready.");
        const outcome = await dispatchRef.apply(
          {
            actor: caller.actor,
            role: caller.role,
            session: caller.session,
            ...(caller.link ? { link: caller.link } : {}),
          },
          request,
        );
        if (!outcome.ok) throw new ArtError(outcome.error._tag, outcome.error.message);
        if (!resultGuards.apply(outcome.value))
          throw new ArtError("HostFailed", "apply returned an unexpected shape.");
        return outcome.value;
      },
    });
    for (const translator of options.artTranslators ?? []) art.register(translator);
    const artRoutes = new ArtRoutes(art);
    const dispatcher = new Dispatcher({
      project,
      credentials,
      identity,
      starters: startersView(registry, options.starters ?? workshopStarters, options.forms ?? []),
      emit: (event) => {
        broadcast(event, ["human", "agent"]);
        for (const listener of listeners) listener(event);
        if (event.command.startsWith("proposal.")) void steering.documentChanged(event.documentId);
      },
      steering,
      review: new ReviewRoutes(review),
      art: artRoutes,
    });
    dispatchRef = dispatcher;
    const recovered = yield* Effect.tryPromise({
      try: () => art.recover(),
      catch: (cause) => new HostFailed(`Cannot recover the art request log: ${String(cause)}`),
    });
    if (recovered.settled || recovered.linked)
      log(
        `art: recovered ${recovered.settled} pending repl${recovered.settled === 1 ? "y" : "ies"} and ${recovered.linked} steering link${recovered.linked === 1 ? "" : "s"}`,
      );
    steering.start();

    const address = endpointAddress(files, instance);
    if (process.platform !== "win32") fs.rmSync(address, { force: true });
    const sockets = new Set<net.Socket>();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      serveConnection(socket, {
        project,
        credentials,
        dispatcher,
        identity,
        human,
        subscribers,
        log,
      });
    });
    yield* Effect.tryPromise({
      try: () => listen(server, address),
      catch: (cause) => new HostFailed(`Cannot listen on ${address}: ${String(cause)}`),
    });
    const endpoint: Endpoint = {
      format: "irudd.workshop-endpoint",
      wire: wireProtocol,
      version: wireVersion,
      address,
      project: canonicalProjectPath(options.path),
      projectId: project.info.projectId,
      host: identity,
    };
    writePrivateFile(files.endpoint, JSON.stringify(endpoint, null, 2) + "\n");
    log(`serving ${endpoint.project} at ${address}`);

    yield* Effect.addFinalizer(() =>
      Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => resolve());
            try {
              const current: unknown = JSON.parse(fs.readFileSync(files.endpoint, "utf8"));
              if (
                typeof current === "object" &&
                current !== null &&
                JSON.stringify(Reflect.get(current, "host")) === JSON.stringify(identity)
              ) {
                fs.rmSync(files.endpoint, { force: true });
                credentials.dispose();
              }
            } catch {}
          }),
      ),
    );

    const session = yield* project.session({ actor: human });
    const person: Caller = { actor: human, role: "human", session };
    const host: WorkshopHost = {
      project,
      endpoint,
      files,
      human,
      async call<M extends MethodName>(
        method: M,
        params: MethodParams[M],
      ): Promise<MethodResults[M]> {
        const outcome = await dispatcher.call(person, method, params);
        if (!outcome.ok) throw new WorkshopError(outcome.error);
        const guard = resultGuards[method];
        if (!guard(outcome.value))
          throw new WorkshopError({
            _tag: "HostFailed",
            message: `${method} returned an unexpected shape.`,
          });
        return outcome.value;
      },
      onCommit(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      onSteer(listener) {
        steerListeners.add(listener);
        return () => steerListeners.delete(listener);
      },
      registerRenderer(renderer) {
        return review.register(renderer, "in-process").unregister;
      },
      registerArtTranslator(translator) {
        return art?.register(translator) ?? (() => undefined);
      },
    };
    return host;
  });

export interface RunningHost extends WorkshopHost {
  close(): Promise<void>;
}

export async function startHost(options: HostOptions): Promise<RunningHost> {
  const scope = await Effect.runPromise(Scope.make());
  const exit = await Effect.runPromiseExit(Scope.provide(scope)(hostProject(options)));
  if (!Exit.isSuccess(exit)) {
    await Effect.runPromise(Scope.close(scope, Exit.void));
    const failed = exit.cause.reasons.find((reason) => reason._tag === "Fail");
    if (failed && failed._tag === "Fail") throw failed.error;
    throw new HostFailed(String(exit.cause));
  }
  let closing: Promise<void> | undefined;
  return {
    ...exit.value,
    close: () => (closing ??= Effect.runPromise(Scope.close(scope, Exit.void))),
  };
}

export type Attached =
  | { readonly mode: "host"; readonly host: RunningHost }
  | { readonly mode: "attached"; readonly client: WorkshopClient };

export async function attachOrHost(options: HostOptions): Promise<Attached> {
  try {
    return { mode: "host", host: await startHost(options) };
  } catch (error) {
    if (!(error instanceof ProjectLocked)) throw error;
    const client = await connect({
      credential: { role: "human", project: options.path },
      client: { name: options.kind === "desktop" ? "irudd-desktop" : "irudd-host", version: "1" },
      ...(options.stateDir === undefined ? {} : { stateDir: options.stateDir }),
    });
    return { mode: "attached", client };
  }
}

export const hostMethods: ReadonlyArray<MethodName> = methodNames;
