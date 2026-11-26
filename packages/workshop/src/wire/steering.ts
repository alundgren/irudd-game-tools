// Steering: a person's instructions to one paired agent, delivered into the
// exact conversation that agent is already in.
//
// The pieces are kept apart on purpose:
//
//   pairing        a person paired agent X (credential, pairing ID)
//   recipient      the person bound X's pairing to one conversation: a host
//                  (T3 Code, Claude Code, Codex), its environment and the
//                  conversation's own ID, plus the transport that reaches it
//   host accepted  that host took the message for that conversation
//   acknowledged   agent X, authenticated with that pairing, read it
//   reported       agent X linked a request it committed after the message
//   applied        that request changed the character: the agent's own direct
//                  revision, or the person's acceptance of exactly the linked
//                  proposal version. A linked proposal is "proposed" (awaiting
//                  review) until then, and may end discarded or superseded.
//
// Messages wait in a durable outbox in the project host. The host never
// starts a conversation, never picks another one when a route is down and
// never falls back to another provider: an unreachable route leaves the
// message queued, and the paired agent can always read it from its inbox.
// Pure: no Node and no storage, so the desktop renderer may import it.

import { Schema } from "effect";
import { Actor, DocumentId, RequestId } from "@irudd/document";
import { AgentId, SteeringMessageId } from "./ids.js";

export const steeringHosts = ["agent", "claude-code", "codex"] as const;
export type SteeringHost = (typeof steeringHosts)[number];

/**
 * How the host reaches the conversation.
 * - `t3-thread`: T3's `t3_thread_send`. `delivery: "mid-turn"` lets T3 steer a running turn
 *   (needs "irudd t3 connect"); the default, next-turn, queues it after the running turn.
 * - `claude-channel`: the agent's own irudd MCP server pushes a Claude Code
 *   channel notification into the session that started it.
 * - `codex-queue`: `codex queue --thread <id>`, queued for that saved session.
 * - `inbox`: no push. The agent reads its inbox in the same paired session.
 */
export const steeringTransports = ["claude-channel", "inbox"] as const;
export type SteeringTransportName = (typeof steeringTransports)[number];

const ShortText = Schema.String.check(Schema.isMaxLength(200));
/** T3 thread IDs, including delegated ones such as `thread:delegated-task:command%3A…`. */
const Uuid = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, {
    message: "Use the session's UUID.",
  }),
);
/** A random ID each irudd MCP server process picks when it starts. */
export const ChannelInstance = Schema.String.check(
  Schema.isPattern(/^chn-[0-9a-f]{24}$/, {
    message: "Use a channel instance from recipient.list.",
  }),
);
export const McpServerName = Schema.String.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9_-]{0,63}$/, {
    message: "Use the MCP server name the session was started with, such as irudd.",
  }),
);

/** One conversation and the transport that reaches it. Every field is the host's own identifier. */
export const RecipientRoute = Schema.Union([
  Schema.Struct({
    transport: Schema.Literal("claude-channel"),
    host: Schema.Literal("claude-code"),
    environment: Schema.Literal("local"),
    /** The name of the irudd MCP server in that session's MCP config and `--channels` list. */
    server: McpServerName,
    /**
     * The exact MCP server process that session started, from `recipient.list`
     * (`channels`). A server name alone is not unique; a restarted server has a
     * new instance and needs binding again.
     */
    instance: ChannelInstance,
    /** The Claude Code session ID, when known. Shown to the person. */
    conversation: Schema.optionalKey(Uuid),
  }),
  Schema.Struct({
    transport: Schema.Literal("inbox"),
    host: Schema.Literals(steeringHosts),
    environment: Schema.Literal("local"),
    /** The host's conversation ID, when known, so the person can tell sessions apart. */
    conversation: Schema.optionalKey(ShortText),
  }),
]);
export type RecipientRoute = typeof RecipientRoute.Type;

export const SteeringText = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(8000, { message: "Keep a steering message under 8000 characters." }),
);

/** Parameter schemas of the steering methods; `wire/protocol.ts` merges them into the method table. */
export const steeringParams = {
  /** People only: bind an agent's current pairing to one conversation. */
  "recipient.bind": Schema.Struct({
    agent: AgentId,
    route: RecipientRoute,
    /** Documents this recipient steers. Empty or absent: the whole project. */
    documents: Schema.optionalKey(Schema.Array(DocumentId)),
  }),
  "recipient.unbind": Schema.Struct({ agent: AgentId }),
  /** Every paired agent with its recipient and the last known availability. */
  "recipient.list": Schema.Struct({}),
  /** Ask the recipient's host now whether the conversation is reachable. */
  "recipient.check": Schema.Struct({ agent: AgentId }),
  /** Queue a message for the agent's bound conversation. A repeated request ID returns the same message. */
  "steer.send": Schema.Struct({
    agent: AgentId,
    requestId: RequestId,
    text: SteeringText,
    documentId: Schema.optionalKey(DocumentId),
  }),
  "steer.list": Schema.Struct({
    agent: Schema.optionalKey(AgentId),
    /** Messages after this outbox sequence number. */
    after: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
    limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 500 }))),
  }),
  "steer.get": Schema.Struct({ messageId: SteeringMessageId }),
  /** Withdraw a message the agent has not acknowledged. */
  "steer.cancel": Schema.Struct({ messageId: SteeringMessageId }),
  /**
   * Send again after `delivery-unknown`, `failed` or a long offline wait. The
   * person decides: the conversation may already hold the first copy, which
   * the agent recognises by its message ID.
   */
  "steer.retry": Schema.Struct({ messageId: SteeringMessageId }),
  /** Agents: messages addressed to this pairing, oldest first. */
  "inbox.read": Schema.Struct({
    after: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
    /** Include acknowledged messages too (default: only unacknowledged ones). */
    all: Schema.optionalKey(Schema.Boolean),
  }),
  /** Agents: acknowledge one message. Repeating it is harmless. */
  "inbox.ack": Schema.Struct({ messageId: SteeringMessageId }),
  /** Agents: link the receipt of the change made for a message (a committed request by this agent). */
  "inbox.applied": Schema.Struct({
    messageId: SteeringMessageId,
    documentId: DocumentId,
    requestId: RequestId,
  }),
  /**
   * Agents: receive `inbox` events on this connection. `claude-channel` also
   * makes this connection the push route of a `claude-channel` recipient: the
   * MCP server turns each event into a channel notification and confirms it
   * with `inbox.pushed`.
   */
  "inbox.watch": Schema.Struct({
    push: Schema.Literals(["events", "claude-channel"]),
    /** Required with `claude-channel`: this MCP server process's instance. */
    instance: Schema.optionalKey(ChannelInstance),
    /** What the MCP client told the server about itself (Claude Code's name and version). */
    client: Schema.optionalKey(Schema.Struct({ name: ShortText, version: ShortText })),
    /** The MCP server's configured name, if it knows it. */
    server: Schema.optionalKey(McpServerName),
  }),
  "inbox.pushed": Schema.Struct({ messageId: SteeringMessageId }),
} as const;

export const steeringAgentMethods = [
  "inbox.read",
  "inbox.ack",
  "inbox.applied",
  "inbox.watch",
  "inbox.pushed",
] as const;

// ── Views ───────────────────────────────────────────────────────────────────

export interface Recipient {
  readonly agent: string;
  /** The pairing this route was bound to. Re-pairing or revoking the agent unbinds it. */
  readonly pairingId: string;
  readonly route: RecipientRoute;
  /** Empty: the whole project. */
  readonly documents: ReadonlyArray<string>;
  readonly boundAt: number;
  readonly boundBy: Actor;
}

/**
 * What the person sees about a route.
 * - `ready`: the host will take a message for this conversation now (`busy`: as its next turn).
 * - `inbox-only`: no push route; the agent reads its inbox in the same session.
 * - `offline`: the host or conversation cannot be reached now; messages wait.
 * - `gone`: the host says the conversation does not exist or is archived.
 * - `unbound`: paired but no conversation chosen. `unpaired`: no current pairing.
 * - `unchecked`: bound, and nobody asked the host yet (`recipient.check`).
 */
export type AvailabilityState =
  | "ready"
  | "inbox-only"
  | "offline"
  | "gone"
  | "unbound"
  | "unpaired"
  | "unchecked";

export interface RouteAvailability {
  readonly state: AvailabilityState;
  /** Whether a message reaches the conversation without the agent reading its inbox. */
  readonly push: boolean;
  /** One line for the person. */
  readonly summary: string;
  readonly checkedAt: number;
  /** What the host reported about the conversation. Never its messages. */
  readonly conversation: {
    readonly status?: string;
    readonly busy?: boolean;
    readonly provider?: string;
    readonly model?: string;
    readonly project?: string;
  } | null;
}

/** An irudd MCP server process of this agent that is connected and offers a Claude channel. */
export interface LiveChannel {
  readonly instance: string;
  readonly server: string | null;
  readonly client: { readonly name: string; readonly version: string } | null;
  readonly since: number;
}

export interface RecipientView {
  readonly agent: string;
  readonly name: string | null;
  readonly pairingId: string;
  readonly pairedAt: number;
  readonly recipient: Recipient | null;
  readonly availability: RouteAvailability;
  /** Connected channel candidates; bind one exact instance to use a Claude channel route. */
  readonly channels: ReadonlyArray<LiveChannel>;
}

/** Where the manual changes a message refers to start: `changes(documentId, {since, by: "human"})`. */
export interface ManualCursor {
  readonly documentId: string;
  /** The revision this agent last acknowledged for the document (0 before its first message). */
  readonly since: number;
  /** The document's head when the person sent the message. */
  readonly head: number;
}

export type DeliveryState =
  /** Waiting for its turn or for its route (an offline route is retried automatically). */
  | "pending"
  /** Being handed to the host now. */
  | "dispatching"
  /** The host took it for that exact conversation. */
  | "accepted"
  /** No push route; it waits in the inbox. */
  | "inbox-only"
  /** The host may or may not have it (a crash or timeout during the send). Never resent automatically. */
  | "unknown"
  /** The host refused the route. */
  | "failed"
  /** Cancelled or revoked before it was sent. */
  | "withdrawn";

export type SteeringStatus =
  | "queued"
  | "dispatching"
  | "host-accepted"
  | "inbox-only"
  | "delivery-unknown"
  | "failed"
  | "acknowledged"
  /** The agent linked a proposal; it awaits the person's review. */
  | "proposed"
  /** The person discarded the linked proposal. */
  | "proposal-discarded"
  /** The linked proposal version was refined or a different version was accepted. */
  | "proposal-superseded"
  /** A revision changed the character for this message. */
  | "applied"
  | "revoked"
  | "cancelled";

export const steeringStatuses: ReadonlyArray<SteeringStatus> = [
  "queued",
  "dispatching",
  "host-accepted",
  "inbox-only",
  "delivery-unknown",
  "failed",
  "acknowledged",
  "proposed",
  "proposal-discarded",
  "proposal-superseded",
  "applied",
  "revoked",
  "cancelled",
];

/** The request the agent linked with `inbox.applied`. */
export interface SteeringReport {
  readonly at: number;
  readonly documentId: string;
  readonly requestId: string;
  /** The journal command of that request: "edit", "undo", "proposal.create", "proposal.refine", … */
  readonly command: string;
  /** `revision`: the request appended a revision. `proposal`: it created or refined a draft. */
  readonly kind: "revision" | "proposal";
  /** Head revision right after the request. For a proposal this is not a change. */
  readonly revision: number;
  readonly proposal: { readonly id: string; readonly version: number } | null;
}

/** The person's review of a linked proposal, as the document journal records it. */
export interface ProposalReview {
  readonly proposalId: string;
  /** The linked version. */
  readonly version: number;
  readonly state: "pending" | "accepted" | "discarded" | "superseded";
  /** The proposal's current version. */
  readonly latestVersion: number;
  readonly decidedAt: number | null;
  readonly decidedBy: Actor | null;
  /** The accept, discard or refine request that decided it. */
  readonly decisionRequestId: string | null;
  /** Set only when `state` is `accepted`. */
  readonly acceptedRevision: number | null;
}

/** The revision that changed the character for a message. */
export interface SteeringApplied {
  readonly at: number;
  readonly documentId: string;
  /** The agent's direct request, or the person's proposal.accept request. */
  readonly requestId: string;
  readonly revision: number;
  readonly via: "direct" | "proposal-accepted";
  readonly proposal: { readonly id: string; readonly version: number } | null;
  readonly acceptedBy: Actor | null;
}

export interface HostReceipt {
  readonly transport: SteeringTransportName;
  /** The host's own message ID, when it reports one (T3: the message ID of the queued turn). */
  readonly hostMessageId?: string;
  readonly runId?: string;
  /** The host's word for what happened: `queued`, `started`, `channel-notified`, … */
  readonly delivery?: string;
  /** When the conversation gets it: inside its running turn, as its next turn, as a new turn, or by restarting the turn. */
  /** Which mechanism carried it: `t3-mcp`, `t3-cli`, `claude-channel`, `codex-cli`. */
  readonly via?: string;
  readonly at: number;
}

export interface SteeringMessage {
  readonly messageId: string;
  /** Outbox order. */
  readonly seq: number;
  readonly requestId: string;
  readonly agent: string;
  readonly pairingId: string;
  readonly documentId: string | null;
  readonly text: string;
  readonly cursor: ManualCursor | null;
  readonly createdAt: number;
  readonly createdBy: Actor;
  /** The route as it was bound when the person sent the message. */
  readonly route: RecipientRoute;
  readonly status: SteeringStatus;
  readonly delivery: {
    readonly state: DeliveryState;
    readonly attempts: number;
    readonly lastAttemptAt: number | null;
    readonly nextAttemptAt: number | null;
    readonly receipt: HostReceipt | null;
    readonly detail: string | null;
  };
  readonly acknowledged: {
    readonly at: number;
    readonly agent: string;
    readonly pairingId: string;
  } | null;
  readonly report: SteeringReport | null;
  readonly review: ProposalReview | null;
  readonly applied: SteeringApplied | null;
  readonly closed: {
    readonly at: number;
    readonly reason: "revoked" | "cancelled";
    readonly detail: string;
  } | null;
}

export interface SteeringList {
  readonly messages: ReadonlyArray<SteeringMessage>;
  /** The highest sequence number in the outbox; pass it as `after` to read only newer messages. */
  readonly last: number;
}

export interface InboxView {
  readonly agent: string;
  readonly pairingId: string;
  readonly recipient: Recipient | null;
  readonly messages: ReadonlyArray<SteeringMessage>;
  readonly last: number;
}

// ── Events ──────────────────────────────────────────────────────────────────

/** To people who subscribed: a message changed state. Read it with `steer.get`. */
export const SteerEvent = Schema.Struct({
  t: Schema.Literal("event"),
  event: Schema.Literal("steer"),
  messageId: SteeringMessageId,
  agent: AgentId,
  seq: Schema.Int,
  status: Schema.Literals(steeringStatuses),
});
export type SteerEvent = typeof SteerEvent.Type;

/** To the addressed agent's watching connections: a new message, with the text to show. */
export const InboxEvent = Schema.Struct({
  t: Schema.Literal("event"),
  event: Schema.Literal("inbox"),
  messageId: SteeringMessageId,
  seq: Schema.Int,
  /** The message as the conversation should see it, including how to acknowledge it. */
  prompt: Schema.String,
  meta: Schema.Record(Schema.String, Schema.String),
});
export type InboxEvent = typeof InboxEvent.Type;

// ── Transports ──────────────────────────────────────────────────────────────
// A transport adapter reaches one kind of host. Adapters are named and typed:
// each runs fixed verbs of one host's own CLI or protocol, never a command
// line from a route or a message.

export interface DeliveryRequest {
  readonly messageId: string;
  readonly agent: string;
  readonly route: RecipientRoute;
  /** The full text the conversation receives. */
  readonly prompt: string;
  readonly meta: Readonly<Record<string, string>>;
}

export type DeliveryOutcome =
  /** The host took it for that conversation. */
  | { readonly kind: "accepted"; readonly receipt: HostReceipt }
  /** Nothing was sent: the host is not reachable now. Safe to retry. */
  | { readonly kind: "offline"; readonly detail: string }
  /** The host refused the route (no such conversation, wrong project). Not retried. */
  | { readonly kind: "rejected"; readonly detail: string }
  /** The send started and its outcome is unknown. Not retried automatically. */
  | { readonly kind: "unknown"; readonly detail: string };

export interface RouteCheck {
  readonly state: "ready" | "offline" | "gone" | "inbox-only";
  readonly push: boolean;
  readonly summary: string;
  readonly conversation: RouteAvailability["conversation"];
}

export interface SteeringTransport {
  readonly transport: SteeringTransportName;
  check(route: RecipientRoute): Promise<RouteCheck>;
  deliver(request: DeliveryRequest): Promise<DeliveryOutcome>;
}

/** The message's summary status from its parts. */
export function steeringStatus(message: {
  readonly delivery: { readonly state: DeliveryState };
  readonly acknowledged: unknown;
  readonly review: { readonly state: ProposalReview["state"] } | null;
  readonly applied: unknown;
  readonly closed: { readonly reason: "revoked" | "cancelled" } | null;
}): SteeringStatus {
  if (message.applied) return "applied";
  if (message.closed) return message.closed.reason;
  switch (message.review?.state) {
    case "pending":
    case "accepted":
      return "proposed";
    case "discarded":
      return "proposal-discarded";
    case "superseded":
      return "proposal-superseded";
    case undefined:
      break;
  }
  if (message.acknowledged) return "acknowledged";
  switch (message.delivery.state) {
    case "pending":
    case "withdrawn":
      return "queued";
    case "dispatching":
      return "dispatching";
    case "accepted":
      return "host-accepted";
    case "inbox-only":
      return "inbox-only";
    case "unknown":
      return "delivery-unknown";
    case "failed":
      return "failed";
  }
}
