// The workshop wire protocol, "irudd.workshop-wire" version 1.
//
// A project host (desktop main or the headless host) serves one open project
// over an OS-local endpoint: a named pipe on Windows, a Unix domain socket
// elsewhere. Frames are UTF-8 JSON, one per line. Every frame a peer receives
// is decoded with the schemas below before it is acted on.
//
//   client → host  hello      role, agent ID (agents only), client nonce
//   host → client  challenge  host nonce and the host's proof of the shared key
//   client → host  auth       the client's proof
//   host → client  welcome    the actor the host bound to this connection
//                  refused    a typed error, then the host closes
//   client → host  call       {id, method, params}
//   host → client  reply      {id, ok, value | error}
//   host → client  event      a commit, after `subscribe`
//
// The client never names its actor. The host stamps the actor bound to the
// credential into every command, so an agent connection cannot act as a person.
// This module is client-safe: it reaches no storage code.

import { Schema } from "effect";
import {
  Actor,
  Digest,
  DocumentId,
  JsonValue,
  ProposalId,
  RequestId,
  decodeWith,
  type Checked,
  type Receipt,
} from "@irudd/document";
import type {
  ApplyResult,
  CharacterSaveReport,
  ChangesView,
  CurrentView,
  DiffView,
  DocumentSummary,
  DraftView,
  ImportReport,
  InspectView,
  ProjectInfo,
  VerifyReport,
} from "../contract/project.js";
import { AgentId } from "./ids.js";
import {
  InboxEvent,
  SteerEvent,
  steeringAgentMethods,
  steeringParams,
  type InboxView,
  type Recipient,
  type RecipientView,
  type SteeringList,
  type SteeringMessage,
} from "./steering.js";
import {
  ReviewJobEvent,
  reviewAgentMethods,
  reviewParams,
  type ReviewMethodResults,
} from "./review.js";
import { artAgentMethods, artParams, type ArtMethodResults, type ArtReadView } from "./art.js";

export { AgentId, PairingId, SteeringMessageId } from "./ids.js";

export const wireProtocol = "irudd.workshop-wire";
export const wireVersion = 1;
/** Largest frame either side accepts, in bytes of UTF-8 JSON. */
export const maxFrameBytes = 32 * 1024 * 1024;
/** A connection that has not authenticated within this time is closed. */
export const handshakeTimeoutMs = 5000;

// ── Handshake ───────────────────────────────────────────────────────────────

const Nonce = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{43}$/, { message: "Use 32 random bytes in base64url." }),
);
const Proof = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{43}$/, { message: "Use an HMAC-SHA-256 in base64url." }),
);
const ShortText = Schema.String.check(Schema.isMaxLength(200));

export const Hello = Schema.Struct({
  t: Schema.Literal("hello"),
  wire: Schema.Literal(wireProtocol),
  version: Schema.Literal(wireVersion),
  role: Schema.Literals(["human", "agent"]),
  /** Agents name the pairing they authenticate with. */
  agent: Schema.optionalKey(AgentId),
  nonce: Nonce,
  client: Schema.Struct({ name: ShortText, version: ShortText }),
});
export type Hello = typeof Hello.Type;

export const Challenge = Schema.Struct({
  t: Schema.Literal("challenge"),
  nonce: Nonce,
  /** HMAC(key, "host" | client nonce | host nonce): the host holds the same key. */
  proof: Proof,
});
export type Challenge = typeof Challenge.Type;

export const Auth = Schema.Struct({ t: Schema.Literal("auth"), proof: Proof });
export type Auth = typeof Auth.Type;

export const HostIdentity = Schema.Struct({
  pid: Schema.Int,
  /** Random per host start; a restarted host has a new instance. */
  instance: Schema.String,
  startedAt: Schema.Number,
  /** `desktop` or `headless`. */
  kind: Schema.Literals(["desktop", "headless"]),
});
export type HostIdentity = typeof HostIdentity.Type;

export const Welcome = Schema.Struct({
  t: Schema.Literal("welcome"),
  actor: Actor,
  role: Schema.Literals(["human", "agent"]),
  host: HostIdentity,
  project: Schema.Struct({
    projectId: Schema.String,
    label: Schema.String,
    directory: Schema.String,
  }),
  methods: Schema.Array(Schema.String),
});
export type Welcome = typeof Welcome.Type;

/** A failure as it crosses the wire: the error's `_tag`, `message` and plain fields. */
export interface WireErrorShape {
  readonly _tag: string;
  readonly message: string;
  readonly [field: string]: unknown;
}

const ErrorValue = Schema.Unknown.pipe(
  Schema.refine((value: unknown): value is WireErrorShape => isWireError(value), {
    message: "Expected an error with _tag and message.",
  }),
);

export const Refused = Schema.Struct({ t: Schema.Literal("refused"), error: ErrorValue });

// ── Calls ───────────────────────────────────────────────────────────────────

const CallId = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }));

export const Call = Schema.Struct({
  t: Schema.Literal("call"),
  id: CallId,
  method: Schema.String,
  params: JsonValue,
});
export type Call = typeof Call.Type;

export const Reply = Schema.Union([
  Schema.Struct({
    t: Schema.Literal("reply"),
    id: CallId,
    ok: Schema.Literal(true),
    value: Schema.Unknown,
  }),
  Schema.Struct({
    t: Schema.Literal("reply"),
    id: CallId,
    ok: Schema.Literal(false),
    error: ErrorValue,
  }),
]);
export type Reply = typeof Reply.Type;

export const CommitEvent = Schema.Struct({
  t: Schema.Literal("event"),
  event: Schema.Literal("commit"),
  documentId: Schema.String,
  revision: Schema.Int,
  sequence: Schema.Int,
  command: Schema.String,
  actor: Actor,
});
export type CommitEvent = typeof CommitEvent.Type;

/** Frames a host accepts after the handshake. */
export const ClientFrame = Call;
/** Events a host sends after `subscribe` (commits, steering changes) or `inbox.watch`. */
export const HostEvent = Schema.Union([CommitEvent, SteerEvent, InboxEvent, ReviewJobEvent]);
export type HostEvent = typeof HostEvent.Type;
/** Frames a client accepts after the handshake. */
export const HostFrame = Schema.Union([Reply, CommitEvent, SteerEvent, InboxEvent, ReviewJobEvent]);
export type HostFrame = typeof HostFrame.Type;

// ── Methods ─────────────────────────────────────────────────────────────────

const Revision = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
);
const Empty = Schema.Struct({});
const Doc = Schema.Struct({ documentId: DocumentId });
/** An absolute file path on the host's machine; the host and its clients share one OS account. */
const FilePath = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096));
const StarterId = Schema.String.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9.-]{0,63}$/, { message: "Use a starter ID from `starters`." }),
);

/** Parameter schemas for every method, shared by clients and the host. */
export const methodParams = {
  /** The open project and the host serving it. */
  "project.info": Empty,
  /** The person's editor reads a verified project image for the head or a proposal. */
  "project.image": Schema.Struct({ digest: Digest, offset: Revision }),
  /** The actor and role the host bound to this connection. */
  whoami: Empty,
  /** Generators and presets this host's registry really provides. */
  starters: Empty,
  documents: Empty,
  current: Doc,
  inspect: Doc,
  changes: Schema.Struct({
    documentId: DocumentId,
    since: Revision,
    by: Schema.optionalKey(Schema.Literals(["human", "agent"])),
  }),
  diff: Schema.Struct({ documentId: DocumentId, from: Revision, to: Revision }),
  draft: Schema.Struct({ documentId: DocumentId, proposalId: ProposalId }),
  receipt: Schema.Struct({ documentId: DocumentId, requestId: RequestId }),
  /**
   * One command envelope. `actor` is left out: the host stamps the connection's
   * actor. An envelope that names an actor is refused with `forbidden`.
   */
  apply: Schema.Struct({ request: JsonValue }),
  /**
   * Create a document from a starter: a registered generator with one of a
   * preset, a seed or explicit parameters (default: the `default` preset).
   */
  start: Schema.Struct({
    documentId: DocumentId,
    requestId: RequestId,
    starter: StarterId,
    label: Schema.optionalKey(Schema.String),
    preset: Schema.optionalKey(Schema.String),
    seed: Schema.optionalKey(
      Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 2 ** 32 - 1 })),
    ),
    params: Schema.optionalKey(JsonValue),
  }),
  /** Receive commit events on this connection. */
  subscribe: Empty,
  /** People only: pair an agent and write its credential file. */
  "pair.agent": Schema.Struct({ agent: AgentId, name: Schema.optionalKey(Schema.String) }),
  "pair.list": Empty,
  "pair.revoke": Schema.Struct({ agent: AgentId }),
  /** People only: full integrity check of the open project. */
  verify: Empty,
  /**
   * People only: save a character as an `.irudd-character` package (ZIP with
   * document.json, history and artwork) at an absolute path that does not exist.
   */
  "document.save": Schema.Struct({ documentId: DocumentId, path: FilePath }),
  /** People only: open a saved character (package or JSON archive) into this project. */
  "document.open": Schema.Struct({ path: FilePath }),
  ...steeringParams,
  ...reviewParams,
  ...artParams,
} as const;

export type MethodName = keyof typeof methodParams;
export const methodNames = Object.keys(methodParams).filter(isMethodName);
export type MethodParams = { readonly [M in MethodName]: (typeof methodParams)[M]["Encoded"] };
export type DecodedParams = { readonly [M in MethodName]: (typeof methodParams)[M]["Type"] };

/** Methods an agent connection may call. Everything else needs a person. */
export const agentMethods: ReadonlySet<MethodName> = new Set<MethodName>([
  "project.info",
  "whoami",
  "starters",
  "documents",
  "current",
  "inspect",
  "changes",
  "diff",
  "draft",
  "receipt",
  "apply",
  "start",
  "subscribe",
  ...steeringAgentMethods,
  ...reviewAgentMethods,
  ...artAgentMethods,
]);

/** Commands the host never accepts from an agent, whatever the document policy says. */
export const humanOnlyCommands: ReadonlySet<string> = new Set(["policy.set"]);

export interface StarterPreset {
  readonly id: string;
  readonly label: string;
  readonly params: unknown;
}

export interface Starter {
  readonly id: string;
  /**
   * `generator`: a registered generator with presets and, when `seeded`, seeds.
   * `form`: a prepared document the host holds; `start` creates a copy under the new ID.
   */
  readonly kind: "generator" | "form";
  readonly label: string;
  /** The generator behind a `generator` starter; null for a prepared form. */
  readonly generator: {
    readonly id: string;
    readonly version: number;
    readonly label: string;
  } | null;
  /**
   * A reference generator exists to exercise the protocol with a real,
   * deterministic generator. It is not a character family.
   */
  readonly reference: boolean;
  readonly description: string;
  readonly presets: ReadonlyArray<StarterPreset>;
  /** Whether `seed` derives parameters deterministically within the generator's ranges. */
  readonly seeded: boolean;
  /** Feature families a prepared form uses. Empty for generator starters. */
  readonly features: ReadonlyArray<string>;
  /**
   * Artwork a prepared form declares: whether this host ships its bytes, with
   * their origin and licence. `start` stages shipped bytes into the project.
   */
  readonly artwork?: ReadonlyArray<{
    readonly digest: string;
    readonly shipped: boolean;
    readonly origin: {
      readonly kind: "project" | "credited";
      readonly license: string;
      readonly source: string;
      readonly credit?: string;
    } | null;
  }>;
}

export interface StartersView {
  readonly starters: ReadonlyArray<Starter>;
  /** Registered family features: documents using them are created from a prepared form. */
  readonly families: ReadonlyArray<{ readonly id: string; readonly version: number }>;
}

export interface StartResult {
  readonly starter: string;
  readonly kind: "generator" | "form";
  /** Null for a prepared form. */
  readonly generator: { readonly id: string; readonly version: number } | null;
  readonly preset: string | null;
  readonly seed: number | null;
  readonly params: unknown;
  readonly result: ApplyResult;
  /** A prepared form's declared artwork, staged into the project before the document was created. */
  readonly artwork?: ReadonlyArray<{
    readonly digest: string;
    readonly stored: "new" | "existing";
    readonly origin: {
      readonly kind: string;
      readonly license: string;
      readonly source: string;
    } | null;
  }>;
}

export interface Pairing {
  readonly agent: string;
  /** Changes whenever the agent is paired again; recipients and messages are bound to it. */
  readonly pairingId: string;
  readonly name: string | null;
  readonly createdAt: number;
}

export interface PairResult extends Pairing {
  /** The credential file the MCP server reads. It never crosses the wire. */
  readonly credentialFile: string;
}

export interface ProjectInfoView extends ProjectInfo {
  readonly host: HostIdentity;
}

/** What each method returns. */
export interface MethodResults extends ReviewMethodResults, ArtMethodResults {
  readonly "project.info": ProjectInfoView;
  readonly "project.image": ArtReadView;
  readonly whoami: { readonly actor: Actor; readonly role: "human" | "agent" };
  readonly starters: StartersView;
  readonly documents: ReadonlyArray<DocumentSummary>;
  readonly current: CurrentView;
  readonly inspect: InspectView;
  readonly changes: ChangesView;
  readonly diff: DiffView;
  readonly draft: DraftView;
  readonly receipt: Receipt | null;
  readonly apply: ApplyResult;
  readonly start: StartResult;
  readonly subscribe: { readonly subscribed: true };
  readonly "pair.agent": PairResult;
  readonly "pair.list": ReadonlyArray<Pairing>;
  readonly "pair.revoke": { readonly agent: string; readonly revoked: boolean };
  readonly verify: VerifyReport;
  readonly "document.save": CharacterSaveReport;
  readonly "document.open": ImportReport;
  readonly "recipient.bind": Recipient;
  readonly "recipient.unbind": { readonly agent: string; readonly unbound: boolean };
  readonly "recipient.list": ReadonlyArray<RecipientView>;
  readonly "recipient.check": RecipientView;
  readonly "steer.send": SteeringMessage;
  readonly "steer.list": SteeringList;
  readonly "steer.get": SteeringMessage;
  readonly "steer.cancel": SteeringMessage;
  readonly "steer.retry": SteeringMessage;
  readonly "inbox.read": InboxView;
  readonly "inbox.ack": SteeringMessage;
  readonly "inbox.applied": SteeringMessage;
  readonly "inbox.watch": { readonly watching: true; readonly push: "events" | "claude-channel" };
  readonly "inbox.pushed": SteeringMessage;
}

// ── Codecs ──────────────────────────────────────────────────────────────────

export function isMethodName(name: string): name is MethodName {
  return Object.hasOwn(methodParams, name);
}

export function isWireError(value: unknown): value is WireErrorShape {
  return (
    typeof value === "object" &&
    value !== null &&
    "_tag" in value &&
    typeof value._tag === "string" &&
    "message" in value &&
    typeof value.message === "string"
  );
}

export function decodeParams(
  method: MethodName,
  params: unknown,
): Checked<DecodedParams[MethodName]> {
  return decodeWith(methodParams[method], params, ["params"]);
}

/** Encode one frame as a line. */
export function encodeFrame(frame: unknown): string {
  return JSON.stringify(frame, (_key, value: unknown) => (Object.is(value, -0) ? 0 : value)) + "\n";
}

/**
 * Turn any failure into its wire shape. Tagged errors keep their plain fields;
 * `cause` and other non-JSON values are dropped.
 */
export function toWireError(error: unknown): WireErrorShape {
  if (isWireError(error)) {
    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(error)) {
      if (key === "cause" || key === "stack") continue;
      if (isPlain(value)) fields[key] = value;
    }
    return { ...fields, _tag: error._tag, message: error.message };
  }
  if (error instanceof Error) return { _tag: "HostFailed", message: error.message };
  return { _tag: "HostFailed", message: String(error) };
}

function isPlain(value: unknown, depth = 0): boolean {
  if (depth > 32) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((v) => isPlain(v, depth + 1));
  if (typeof value === "object") return Object.values(value).every((v) => isPlain(v, depth + 1));
  return false;
}

/**
 * Splits a byte stream into decoded JSON lines. A line longer than
 * `maxFrameBytes` or one that is not JSON is reported once and ends the stream.
 */
export class FrameReader {
  private buffer = "";
  private failed = false;
  private readonly onFrame: (frame: unknown) => void;
  private readonly onError: (message: string) => void;
  constructor(onFrame: (frame: unknown) => void, onError: (message: string) => void) {
    this.onFrame = onFrame;
    this.onError = onError;
  }

  push(chunk: string): void {
    if (this.failed) return;
    this.buffer += chunk;
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (line.trim().length > 0) {
        let frame: unknown;
        try {
          frame = JSON.parse(line);
        } catch {
          this.fail("A frame was not valid JSON.");
          return;
        }
        this.onFrame(frame);
        if (this.failed) return;
      }
      newline = this.buffer.indexOf("\n");
    }
    if (this.buffer.length > maxFrameBytes) this.fail(`A frame exceeded ${maxFrameBytes} bytes.`);
  }

  private fail(message: string): void {
    this.failed = true;
    this.buffer = "";
    this.onError(message);
  }
}
