import { Schema } from "effect";
import { Actor, DocumentId, RequestId } from "@irudd/document";
import { AgentId, SteeringMessageId } from "./ids.js";

export const steeringHosts = ["t3", "claude-code", "codex", "agent"] as const;
export type SteeringHost = (typeof steeringHosts)[number];

export const steeringTransports = ["t3-thread", "claude-channel", "codex-queue", "inbox"] as const;
export type SteeringTransportName = (typeof steeringTransports)[number];

const ShortText = Schema.String.check(Schema.isMaxLength(200));
export const T3ThreadId = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9:%._~-]{0,511}$/, {
    message: "Use the T3 thread ID exactly as T3 Code shows it.",
  }),
);
export const EnvironmentRef = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/, {
    message: "Use local or the environment ID.",
  }),
);
export const T3ProjectId = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/, { message: "Use a T3 project ID." }),
);
const Uuid = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, {
    message: "Use the session's UUID.",
  }),
);
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

export const RecipientRoute = Schema.Union([
  Schema.Struct({
    transport: Schema.Literal("t3-thread"),
    host: Schema.Literal("t3"),
    environment: EnvironmentRef,
    project: Schema.optionalKey(T3ProjectId),
    conversation: T3ThreadId,
    delivery: Schema.optionalKey(Schema.Literals(["next-turn", "mid-turn"])),
  }),
  Schema.Struct({
    transport: Schema.Literal("claude-channel"),
    host: Schema.Literal("claude-code"),
    environment: Schema.Literal("local"),
    server: McpServerName,
    instance: ChannelInstance,
    conversation: Schema.optionalKey(Uuid),
  }),
  Schema.Struct({
    transport: Schema.Literal("codex-queue"),
    host: Schema.Literal("codex"),
    environment: Schema.Literal("local"),
    conversation: Uuid,
  }),
  Schema.Struct({
    transport: Schema.Literal("inbox"),
    host: Schema.Literals(steeringHosts),
    environment: EnvironmentRef,
    conversation: Schema.optionalKey(ShortText),
  }),
]);
export type RecipientRoute = typeof RecipientRoute.Type;

export const SteeringText = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(8000, { message: "Keep a steering message under 8000 characters." }),
);

export const steeringParams = {
  "recipient.bind": Schema.Struct({
    agent: AgentId,
    route: RecipientRoute,
    documents: Schema.optionalKey(Schema.Array(DocumentId)),
  }),
  "recipient.unbind": Schema.Struct({ agent: AgentId }),
  "recipient.list": Schema.Struct({}),
  "recipient.check": Schema.Struct({ agent: AgentId }),
  "steer.send": Schema.Struct({
    agent: AgentId,
    requestId: RequestId,
    text: SteeringText,
    documentId: Schema.optionalKey(DocumentId),
  }),
  "steer.list": Schema.Struct({
    agent: Schema.optionalKey(AgentId),
    after: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
    limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 500 }))),
  }),
  "steer.get": Schema.Struct({ messageId: SteeringMessageId }),
  "steer.cancel": Schema.Struct({ messageId: SteeringMessageId }),
  "steer.retry": Schema.Struct({ messageId: SteeringMessageId }),
  "inbox.read": Schema.Struct({
    after: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
    all: Schema.optionalKey(Schema.Boolean),
  }),
  "inbox.ack": Schema.Struct({ messageId: SteeringMessageId }),
  "inbox.applied": Schema.Struct({
    messageId: SteeringMessageId,
    documentId: DocumentId,
    requestId: RequestId,
  }),
  "inbox.watch": Schema.Struct({
    push: Schema.Literals(["events", "claude-channel"]),
    instance: Schema.optionalKey(ChannelInstance),
    client: Schema.optionalKey(Schema.Struct({ name: ShortText, version: ShortText })),
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

export interface Recipient {
  readonly agent: string;
  readonly pairingId: string;
  readonly route: RecipientRoute;
  readonly documents: ReadonlyArray<string>;
  readonly boundAt: number;
  readonly boundBy: Actor;
}

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
  readonly push: boolean;
  readonly summary: string;
  readonly checkedAt: number;
  readonly conversation: {
    readonly status?: string;
    readonly busy?: boolean;
    readonly provider?: string;
    readonly model?: string;
    readonly project?: string;
  } | null;
}

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
  readonly channels: ReadonlyArray<LiveChannel>;
}

export interface ManualCursor {
  readonly documentId: string;
  readonly since: number;
  readonly head: number;
}

export type DeliveryState =
  | "pending"
  | "dispatching"
  | "accepted"
  | "inbox-only"
  | "unknown"
  | "failed"
  | "withdrawn";

export type SteeringStatus =
  | "queued"
  | "dispatching"
  | "host-accepted"
  | "inbox-only"
  | "delivery-unknown"
  | "failed"
  | "acknowledged"
  | "proposed"
  | "proposal-discarded"
  | "proposal-superseded"
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

export interface SteeringReport {
  readonly at: number;
  readonly documentId: string;
  readonly requestId: string;
  readonly command: string;
  readonly kind: "revision" | "proposal";
  readonly revision: number;
  readonly proposal: { readonly id: string; readonly version: number } | null;
}

export interface ProposalReview {
  readonly proposalId: string;
  readonly version: number;
  readonly state: "pending" | "accepted" | "discarded" | "superseded";
  readonly latestVersion: number;
  readonly decidedAt: number | null;
  readonly decidedBy: Actor | null;
  readonly decisionRequestId: string | null;
  readonly acceptedRevision: number | null;
}

export interface SteeringApplied {
  readonly at: number;
  readonly documentId: string;
  readonly requestId: string;
  readonly revision: number;
  readonly via: "direct" | "proposal-accepted";
  readonly proposal: { readonly id: string; readonly version: number } | null;
  readonly acceptedBy: Actor | null;
}

export interface HostReceipt {
  readonly transport: SteeringTransportName;
  readonly hostMessageId?: string;
  readonly runId?: string;
  readonly delivery?: string;
  readonly turn?: "mid-turn" | "next-turn" | "new-turn" | "restarted";
  readonly via?: string;
  readonly at: number;
}

export interface SteeringMessage {
  readonly messageId: string;
  readonly seq: number;
  readonly requestId: string;
  readonly agent: string;
  readonly pairingId: string;
  readonly documentId: string | null;
  readonly text: string;
  readonly cursor: ManualCursor | null;
  readonly createdAt: number;
  readonly createdBy: Actor;
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
  readonly last: number;
}

export interface InboxView {
  readonly agent: string;
  readonly pairingId: string;
  readonly recipient: Recipient | null;
  readonly messages: ReadonlyArray<SteeringMessage>;
  readonly last: number;
}

export const SteerEvent = Schema.Struct({
  t: Schema.Literal("event"),
  event: Schema.Literal("steer"),
  messageId: SteeringMessageId,
  agent: AgentId,
  seq: Schema.Int,
  status: Schema.Literals(steeringStatuses),
});
export type SteerEvent = typeof SteerEvent.Type;

export const InboxEvent = Schema.Struct({
  t: Schema.Literal("event"),
  event: Schema.Literal("inbox"),
  messageId: SteeringMessageId,
  seq: Schema.Int,
  prompt: Schema.String,
  meta: Schema.Record(Schema.String, Schema.String),
});
export type InboxEvent = typeof InboxEvent.Type;

export interface DeliveryRequest {
  readonly messageId: string;
  readonly agent: string;
  readonly route: RecipientRoute;
  readonly prompt: string;
  readonly meta: Readonly<Record<string, string>>;
}

export type DeliveryOutcome =
  | { readonly kind: "accepted"; readonly receipt: HostReceipt }
  | { readonly kind: "offline"; readonly detail: string }
  | { readonly kind: "rejected"; readonly detail: string }
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
