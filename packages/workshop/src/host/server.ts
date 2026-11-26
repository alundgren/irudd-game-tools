import { Effect } from "effect";
import { randomBytes } from "node:crypto";
import type net from "node:net";
import { decodeWith, type Actor } from "@irudd/document";
import type { Project } from "../contract/project.js";
import {
  Auth,
  ClientFrame,
  Hello,
  encodeFrame,
  FrameReader,
  handshakeTimeoutMs,
  methodNames,
  agentMethods,
  type HostEvent,
  type HostIdentity,
  type WireErrorShape,
} from "../wire/protocol.js";
import { newNonce, proof, sameProof } from "../wire/local.js";
import type { Credentials } from "./credentials.js";
import type { Caller, Dispatcher } from "./dispatch.js";
import type { AgentLink } from "../steering/service.js";
import type { ReviewJobEvent } from "../wire/review.js";

export interface Subscriber {
  readonly role: "human" | "agent";
  readonly send: (event: HostEvent) => void;
}

export interface ConnectionContext {
  readonly project: Project;
  readonly credentials: Credentials;
  readonly dispatcher: Dispatcher;
  readonly identity: HostIdentity;
  readonly human: Actor;
  readonly subscribers: Set<Subscriber>;
  readonly log: (line: string) => void;
}

const refuse = (socket: net.Socket, error: WireErrorShape): void => {
  socket.end(encodeFrame({ t: "refused", error }));
};

export function serveConnection(socket: net.Socket, context: ConnectionContext): void {
  socket.setEncoding("utf8");
  socket.on("error", () => undefined);
  let state:
    | { readonly t: "hello" }
    | {
        readonly t: "auth";
        readonly hello: Hello;
        readonly key: Buffer;
        readonly hostNonce: string;
      }
    | { readonly t: "ready"; readonly caller: Caller }
    | { readonly t: "closed" } = { t: "hello" };

  const timer = setTimeout(() => {
    if (state.t !== "ready") {
      refuse(socket, {
        _tag: "CredentialRejected",
        message: "The handshake did not finish in time.",
      });
      state = { t: "closed" };
    }
  }, handshakeTimeoutMs);

  const protocolError = (message: string) => {
    refuse(socket, { _tag: "ProtocolError", message });
    state = { t: "closed" };
  };

  let subscriber: Subscriber | undefined;
  let link: AgentLink | undefined;
  const connection = {
    id: randomBytes(12).toString("hex"),
    write: (event: ReviewJobEvent): boolean => {
      if (socket.destroyed || !socket.writable) return false;
      socket.write(encodeFrame(event));
      return true;
    },
  };
  socket.on("close", () => {
    clearTimeout(timer);
    if (subscriber) context.subscribers.delete(subscriber);
    if (link) context.dispatcher.disconnected(link.id);
    context.dispatcher.connectionClosed(connection.id);
    state = { t: "closed" };
  });

  const frames = new FrameReader((frame) => {
    switch (state.t) {
      case "closed":
        return;
      case "hello": {
        const hello = decodeWith(Hello, frame);
        if (!hello.ok)
          return protocolError("Expected a hello frame for irudd.workshop-wire version 1.");
        let key: Buffer | undefined;
        if (hello.value.role === "human") key = context.credentials.humanKey;
        else if (hello.value.agent === undefined)
          return protocolError("An agent hello names the agent it was paired as.");
        else key = context.credentials.agentKey(hello.value.agent);
        if (!key) {
          refuse(socket, {
            _tag: "CredentialRejected",
            message: `Agent ${hello.value.agent ?? ""} is not paired with this project. A person pairs it with "irudd pair ${hello.value.agent ?? "<agent-id>"}".`,
          });
          state = { t: "closed" };
          return;
        }
        const hostNonce = newNonce();
        socket.write(
          encodeFrame({
            t: "challenge",
            nonce: hostNonce,
            proof: proof(key, "host", hello.value.nonce, hostNonce),
          }),
        );
        state = { t: "auth", hello: hello.value, key, hostNonce };
        return;
      }
      case "auth": {
        const auth = decodeWith(Auth, frame);
        if (!auth.ok) return protocolError("Expected an auth frame.");
        const expected = proof(state.key, "client", state.hostNonce, state.hello.nonce);
        if (!sameProof(auth.value.proof, expected)) {
          refuse(socket, {
            _tag: "CredentialRejected",
            message:
              state.hello.role === "human"
                ? "The person's key does not match this host. Run the command again; the host writes a new key each time it starts."
                : `The credential for agent ${state.hello.agent ?? ""} is out of date or revoked. Pair it again with "irudd pair ${state.hello.agent ?? "<agent-id>"}".`,
          });
          state = { t: "closed" };
          return;
        }
        const hello = state.hello;
        const role = hello.role;
        const agentName = hello.agent ? context.credentials.agentName(hello.agent) : undefined;
        const actor: Actor =
          role === "human"
            ? context.human
            : {
                kind: "agent",
                id: hello.agent ?? "agent",
                ...(agentName === undefined ? {} : { name: agentName }),
              };
        const bound = Effect.runSyncExit(context.project.session({ actor }));
        if (bound._tag !== "Success") {
          refuse(socket, {
            _tag: "CredentialRejected",
            message: `The host cannot bind actor ${actor.id}.`,
          });
          state = { t: "closed" };
          return;
        }
        clearTimeout(timer);
        const pairingId =
          role === "agent" && hello.agent ? context.credentials.pairingId(hello.agent) : undefined;
        if (role === "agent" && pairingId !== undefined)
          link = {
            id: randomBytes(12).toString("hex"),
            agent: actor.id,
            pairingId,
            write: (event) => {
              if (socket.destroyed || !socket.writable) return false;
              socket.write(encodeFrame(event));
              return true;
            },
          };
        state = {
          t: "ready",
          caller: { actor, role, session: bound.value, connection, ...(link ? { link } : {}) },
        };
        context.log(`${role} ${actor.id} connected (${hello.client.name} ${hello.client.version})`);
        socket.write(
          encodeFrame({
            t: "welcome",
            actor,
            role,
            host: context.identity,
            project: {
              projectId: context.project.info.projectId,
              label: context.project.info.label,
              directory: context.project.info.directory,
            },
            methods:
              role === "human" ? methodNames : methodNames.filter((m) => agentMethods.has(m)),
          }),
        );
        return;
      }
      case "ready": {
        const call = decodeWith(ClientFrame, frame);
        if (!call.ok) return protocolError("Expected a call frame.");
        const caller = state.caller;
        const { id, method, params } = call.value;
        void context.dispatcher.call(caller, method, params).then((outcome) => {
          if (method === "subscribe" && outcome.ok && !subscriber) {
            subscriber = {
              role: caller.role,
              send: (event) => {
                if (!socket.destroyed) socket.write(encodeFrame(event));
              },
            };
            context.subscribers.add(subscriber);
          }
          if (socket.destroyed) return;
          socket.write(
            encodeFrame(
              outcome.ok
                ? { t: "reply", id, ok: true, value: outcome.value }
                : { t: "reply", id, ok: false, error: outcome.error },
            ),
          );
        });
        return;
      }
    }
  }, protocolError);

  socket.on("data", (chunk: string) => frames.push(chunk));
}
