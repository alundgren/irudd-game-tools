// The host's steering service: the outbox, its delivery worker, the paired
// agents' inboxes and the Claude channel push route.
//
// Rules it keeps:
// - A message goes only to the conversation its agent's current pairing was
//   bound to when the person sent it. A changed recipient, a re-pairing or a
//   revocation stops delivery; nothing is retargeted.
// - An offline route keeps the message queued and is retried with backoff.
//   A send whose outcome is unknown is never resent automatically.
// - Host acceptance, the agent's acknowledgement and the applied receipt are
//   recorded separately. Only the authenticated agent of the message's pairing
//   acknowledges it, and only a journal entry that agent committed can be
//   linked as applied.

import { Effect, Option, Schema } from "effect";
import { createHash } from "node:crypto";
import { Actor, type JournalEntry } from "@irudd/document";
import type { Project } from "../contract/project.js";
import {
  steeringStatus,
  type DeliveryOutcome,
  type InboxEvent,
  type InboxView,
  type LiveChannel,
  type ManualCursor,
  type ProposalReview,
  type Recipient,
  type RecipientRoute,
  type RecipientView,
  type RouteAvailability,
  type RouteCheck,
  type SteerEvent,
  type SteeringList,
  type SteeringApplied,
  type SteeringMessage,
  type SteeringReport,
  type SteeringTransport,
  type SteeringTransportName,
} from "../wire/steering.js";
import type { SteeringStore } from "./store.js";

/** A failure with the plain fields the wire carries. */
export class SteeringError extends Error {
  readonly _tag: string;
  readonly [field: string]: unknown;
  constructor(tag: string, message: string, fields: Record<string, unknown> = {}) {
    super(message);
    this._tag = tag;
    Object.assign(this, fields);
  }
}

/** The pairing side of the host: who is paired now, and with which pairing. */
export interface PairingSource {
  pairingId(agent: string): string | undefined;
  list(): ReadonlyArray<{
    readonly agent: string;
    readonly pairingId: string;
    readonly name: string | null;
    readonly createdAt: number;
  }>;
}

/** One authenticated agent connection, as the steering service sees it. */
export interface AgentLink {
  readonly id: string;
  readonly agent: string;
  readonly pairingId: string;
  /** Write one frame; false when the connection is gone. */
  write(frame: InboxEvent): boolean;
}

export interface SteeringOptions {
  readonly store: SteeringStore;
  readonly project: Project;
  readonly pairings: PairingSource;
  /** Named transport adapters. `claude-channel` and `inbox` are built in. */
  readonly transports: ReadonlyArray<SteeringTransport>;
  readonly emit: (event: SteerEvent) => void;
  /** The irudd command an agent runs, for the instructions in each message. */
  readonly agentCommand: string;
  readonly credentialFile: (agent: string) => string;
  readonly log?: (line: string) => void;
  readonly now?: () => number;
  readonly deliverTimeoutMs?: number;
  readonly checkTimeoutMs?: number;
  readonly channelConfirmMs?: number;
  /** First retry delay after an offline route; doubles up to a minute. */
  readonly retryBaseMs?: number;
  /**
   * How to answer a message that carries something other than free text, such
   * as an art brief: replaces the propose and link lines. Undefined: the usual lines.
   */
  readonly instructions?: (
    message: SteeringMessage,
    cli: { readonly irudd: string; readonly cred: string },
  ) => ReadonlyArray<string> | undefined;
}

const crockford = "0123456789abcdefghjkmnpqrstvwxyz";

/** `stm-` and 26 base-32 digits of SHA-256(project, agent, request ID): the same request gives the same ID. */
export function steeringMessageId(projectId: string, agent: string, requestId: string): string {
  const digest = createHash("sha256")
    .update(`irudd.steering\0${projectId}\0${agent}\0${requestId}`)
    .digest();
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of digest) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < 26) {
      out += crockford[(value >>> (bits - 5)) & 31] ?? "0";
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  return `stm-${out}`;
}

function sameRoute(a: RecipientRoute, b: RecipientRoute): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function describeRoute(route: RecipientRoute): string {
  switch (route.transport) {
    case "t3-thread":
      return `T3 Code thread ${route.conversation} (${route.environment})`;
    case "claude-channel":
      return `Claude Code session${route.conversation ? ` ${route.conversation}` : ""} through MCP server ${route.server} (${route.instance})`;
    case "codex-queue":
      return `Codex session ${route.conversation}`;
    case "inbox":
      return `${route.host} conversation${route.conversation ? ` ${route.conversation}` : ""}, inbox only`;
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(onTimeout()), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface Watcher {
  readonly link: AgentLink;
  readonly push: "events" | "claude-channel";
  readonly channel: LiveChannel | null;
}

export class Steering {
  private readonly options: SteeringOptions;
  private readonly store: SteeringStore;
  private readonly now: () => number;
  private readonly transports = new Map<SteeringTransportName, SteeringTransport>();
  private readonly watchers = new Map<string, Watcher>();
  private readonly pushWaits = new Map<
    string,
    { readonly link: string; readonly resolve: (pushed: boolean) => void }
  >();
  private timer: NodeJS.Timeout | undefined;
  private pumping = false;
  private again = false;
  private stopped = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: SteeringOptions) {
    this.options = options;
    this.store = options.store;
    this.now = options.now ?? Date.now;
    for (const transport of options.transports) this.transports.set(transport.transport, transport);
    this.transports.set("claude-channel", this.channelTransport());
  }

  /** Recover from the last run and start delivering. */
  start(): void {
    for (const message of this.store.inFlight()) {
      const updated = this.store.update(
        message.messageId,
        {
          delivery: {
            state: "unknown",
            nextAttemptAt: null,
            detail:
              "The host stopped while sending this message; the conversation may already have it. Retry only if it did not arrive.",
          },
        },
        "recovered after a host stop",
      );
      this.announce(updated);
    }
    // Pairings revoked or rotated while no host was running.
    for (const pairing of new Set(
      this.store.list({ unacknowledged: true, limit: 500 }).map((m) => m.agent),
    ))
      this.pairingChanged(pairing);
    for (const recipient of this.store.recipients())
      if (this.options.pairings.pairingId(recipient.agent) !== recipient.pairingId)
        this.store.unbind(recipient.agent);
    this.kick();
    void this.documentChanged();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    for (const wait of this.pushWaits.values()) wait.resolve(false);
    this.pushWaits.clear();
    this.watchers.clear();
  }

  // ── Person: recipients ──────────────────────────────────────────────────

  bind(
    person: Actor,
    params: {
      readonly agent: string;
      readonly route: RecipientRoute;
      readonly documents?: ReadonlyArray<string>;
    },
  ): Recipient {
    const pairingId = this.options.pairings.pairingId(params.agent);
    if (!pairingId)
      throw new SteeringError(
        "AgentNotPaired",
        `Agent ${params.agent} is not paired with this project. Pair it first with "irudd pair ${params.agent}".`,
        { agent: params.agent },
      );
    if (params.route.transport === "claude-channel") {
      const route = params.route;
      const live = [...this.watchers.values()].find(
        (w) =>
          w.push === "claude-channel" &&
          w.link.agent === params.agent &&
          w.link.pairingId === pairingId &&
          w.channel?.instance === route.instance,
      );
      if (!live)
        throw new SteeringError(
          "RouteUnproven",
          `No irudd MCP server of agent ${params.agent} with channel instance ${route.instance} is connected now. Bind an instance listed by recipient.list while its Claude Code session is open.`,
          { agent: params.agent },
        );
    }
    const recipient: Recipient = {
      agent: params.agent,
      pairingId,
      route: params.route,
      documents: [...(params.documents ?? [])],
      boundAt: this.now(),
      boundBy: person,
    };
    this.store.bind(recipient);
    this.options.log?.(`steering: ${params.agent} bound to ${describeRoute(params.route)}`);
    return recipient;
  }

  unbind(agent: string): { readonly agent: string; readonly unbound: boolean } {
    return { agent, unbound: this.store.unbind(agent) };
  }

  /** Every paired agent with its recipient and the last known availability. */
  recipients(): ReadonlyArray<RecipientView> {
    return this.options.pairings.list().map((pairing) => this.view(pairing, undefined));
  }

  /** Ask the recipient's host now. */
  async check(agent: string): Promise<RecipientView> {
    const pairing = this.options.pairings.list().find((p) => p.agent === agent);
    if (!pairing)
      throw new SteeringError("AgentNotPaired", `Agent ${agent} is not paired with this project.`, {
        agent,
      });
    const recipient = this.current(agent);
    if (!recipient) return this.view(pairing, undefined);
    const availability =
      recipient.route.transport === "claude-channel"
        ? this.channelAvailability(agent, recipient.route)
        : await this.probe(recipient.route);
    this.store.setAvailability(agent, availability);
    return this.view(pairing, availability);
  }

  private view(
    pairing: ReturnType<PairingSource["list"]>[number],
    fresh: RouteAvailability | undefined,
  ): RecipientView {
    const recipient = this.current(pairing.agent) ?? null;
    const channels = [...this.watchers.values()]
      .filter(
        (w) =>
          w.push === "claude-channel" &&
          w.link.agent === pairing.agent &&
          w.link.pairingId === pairing.pairingId &&
          w.channel !== null,
      )
      .flatMap((w) => (w.channel ? [w.channel] : []));
    let availability: RouteAvailability;
    if (!recipient)
      availability = {
        state: "unbound",
        push: false,
        summary: `Paired, but no conversation is bound. Bind ${pairing.agent} to the conversation it works in.`,
        checkedAt: this.now(),
        conversation: null,
      };
    else if (recipient.route.transport === "inbox") availability = this.inboxOnly(recipient.route);
    else if (recipient.route.transport === "claude-channel")
      availability = this.channelAvailability(pairing.agent, recipient.route);
    else
      availability = fresh ??
        this.store.availability(pairing.agent) ?? {
          state: "unchecked",
          push: false,
          summary: `${describeRoute(recipient.route)}: not checked yet.`,
          checkedAt: this.now(),
          conversation: null,
        };
    return {
      agent: pairing.agent,
      name: pairing.name,
      pairingId: pairing.pairingId,
      pairedAt: pairing.createdAt,
      recipient,
      availability,
      channels,
    };
  }

  /** The recipient bound to the agent's current pairing, if any. */
  private current(agent: string): Recipient | undefined {
    const recipient = this.store.recipient(agent);
    if (!recipient) return undefined;
    return recipient.pairingId === this.options.pairings.pairingId(agent) ? recipient : undefined;
  }

  private inboxOnly(route: RecipientRoute): RouteAvailability {
    return {
      state: "inbox-only",
      push: false,
      summary: `${describeRoute(route)}: push is not available for this conversation. The agent reads its inbox in the same session (irudd inbox, or read_inbox over MCP).`,
      checkedAt: this.now(),
      conversation: null,
    };
  }

  private async probe(route: RecipientRoute): Promise<RouteAvailability> {
    if (route.transport === "inbox") return this.inboxOnly(route);
    const transport = this.transports.get(route.transport);
    if (!transport)
      return {
        state: "offline",
        push: false,
        summary: `This host has no ${route.transport} adapter; messages wait in the inbox.`,
        checkedAt: this.now(),
        conversation: null,
      };
    const checked = await withTimeout<RouteCheck>(
      transport.check(route).catch((error: unknown): RouteCheck => ({
        state: "offline",
        push: false,
        summary: `Checking failed: ${error instanceof Error ? error.message : String(error)}`,
        conversation: null,
      })),
      this.options.checkTimeoutMs ?? 15_000,
      () => ({
        state: "offline",
        push: false,
        summary: "The host did not answer in time.",
        conversation: null,
      }),
    );
    return { ...checked, checkedAt: this.now() };
  }

  // ── Person: messages ────────────────────────────────────────────────────

  async send(
    person: Actor,
    params: {
      readonly agent: string;
      readonly requestId: string;
      readonly text: string;
      readonly documentId?: string;
    },
  ): Promise<SteeringMessage> {
    const existing = this.store.byRequest(params.agent, params.requestId);
    if (existing) {
      if (existing.text === params.text && existing.documentId === (params.documentId ?? null))
        return existing;
      throw new SteeringError(
        "RequestConflict",
        `Request ${params.requestId} already sent a different message to ${params.agent}. Use a new request ID for a new message.`,
        { messageId: existing.messageId },
      );
    }
    const pairingId = this.options.pairings.pairingId(params.agent);
    if (!pairingId)
      throw new SteeringError(
        "AgentNotPaired",
        `Agent ${params.agent} is not paired with this project.`,
        { agent: params.agent },
      );
    const recipient = this.current(params.agent);
    if (!recipient)
      throw new SteeringError(
        "RecipientUnbound",
        `Agent ${params.agent} is paired but bound to no conversation. Bind its conversation first; the host never picks one.`,
        { agent: params.agent },
      );
    const documentId = params.documentId ?? null;
    if (
      documentId !== null &&
      recipient.documents.length > 0 &&
      !recipient.documents.includes(documentId)
    )
      throw new SteeringError(
        "InvalidArgument",
        `${params.agent} is bound to ${recipient.documents.join(", ")}, not ${documentId}.`,
        { path: ["params", "documentId"] },
      );
    let cursor: ManualCursor | null = null;
    // Each document's journal position now: requests up to it can never be linked.
    const baseline: Record<string, number> = {};
    if (documentId !== null) {
      const head = await Effect.runPromise(this.options.project.current(documentId));
      cursor = {
        documentId,
        since: this.store.cursor(params.agent, documentId, pairingId) ?? 0,
        head: head.revision,
      };
      baseline[documentId] = head.journal?.sequence ?? 0;
    } else
      for (const summary of await Effect.runPromise(this.options.project.documents))
        baseline[summary.documentId] = summary.journal.sequence;
    const message = this.store.insert({
      messageId: steeringMessageId(
        this.options.project.info.projectId,
        params.agent,
        params.requestId,
      ),
      requestId: params.requestId,
      agent: params.agent,
      pairingId,
      documentId,
      text: params.text,
      cursor,
      createdAt: this.now(),
      createdBy: person,
      route: recipient.route,
      delivery: recipient.route.transport === "inbox" ? "inbox-only" : "pending",
      baseline,
    });
    this.announce(message);
    this.notifyWatchers(message);
    this.kick();
    return message;
  }

  list(params: {
    readonly agent?: string;
    readonly after?: number;
    readonly limit?: number;
  }): SteeringList {
    return { messages: this.store.list(params), last: this.store.lastSeq() };
  }

  get(messageId: string): SteeringMessage {
    const message = this.store.message(messageId);
    if (!message)
      throw new SteeringError("MessageMissing", `There is no steering message ${messageId}.`, {
        messageId,
      });
    return message;
  }

  cancel(messageId: string): SteeringMessage {
    const message = this.get(messageId);
    if (message.closed) return message;
    if (message.acknowledged)
      throw new SteeringError(
        "SteeringSettled",
        `${messageId} was already acknowledged by ${message.agent}; it cannot be withdrawn.`,
        { messageId },
      );
    const updated = this.store.update(
      messageId,
      {
        ...(message.delivery.state === "pending"
          ? { delivery: { state: "withdrawn", nextAttemptAt: null } }
          : {}),
        closed: {
          at: this.now(),
          reason: "cancelled",
          detail:
            message.delivery.state === "accepted"
              ? "Cancelled after the host accepted it; the conversation already holds it."
              : "Cancelled before delivery.",
        },
      },
      "cancelled by the person",
    );
    this.announce(updated);
    return updated;
  }

  /** The person's explicit resend to the agent's current recipient. */
  retry(messageId: string): SteeringMessage {
    const message = this.get(messageId);
    if (message.closed || message.acknowledged)
      throw new SteeringError("SteeringSettled", `${messageId} is ${message.status}.`, {
        messageId,
      });
    if (!["delivery-unknown", "failed", "queued"].includes(message.status))
      throw new SteeringError(
        "SteeringSettled",
        `${messageId} is ${message.status}; only queued, failed or delivery-unknown messages are resent.`,
        { messageId },
      );
    const recipient = this.current(message.agent);
    if (!recipient || recipient.pairingId !== message.pairingId)
      throw new SteeringError(
        "RecipientUnbound",
        `${message.agent} has no recipient for the pairing this message was sent to.`,
        { messageId },
      );
    if (!sameRoute(recipient.route, message.route))
      throw new SteeringError(
        "RecipientChanged",
        `${message.agent} is now bound to ${describeRoute(recipient.route)}, not ${describeRoute(message.route)}. Send a new message instead; a message never moves to another conversation.`,
        { messageId },
      );
    const updated = this.store.update(
      messageId,
      {
        delivery: {
          state: message.route.transport === "inbox" ? "inbox-only" : "pending",
          nextAttemptAt: null,
          detail: "Resent at the person's request.",
        },
      },
      "retry requested by the person",
    );
    this.announce(updated);
    this.kick();
    return updated;
  }

  /** After `pair.agent` (rotation) or `pair.revoke`: messages of an older pairing are revoked. */
  pairingChanged(agent: string): void {
    const pairingId = this.options.pairings.pairingId(agent);
    for (const message of this.store.open(agent)) {
      if (message.pairingId === pairingId) continue;
      const updated = this.store.update(
        message.messageId,
        {
          ...(message.delivery.state === "pending"
            ? { delivery: { state: "withdrawn", nextAttemptAt: null } }
            : {}),
          closed: {
            at: this.now(),
            reason: "revoked",
            detail: pairingId
              ? `${agent} was paired again; this message belonged to the earlier pairing.`
              : `${agent}'s pairing was revoked.`,
          },
        },
        "pairing changed",
      );
      this.announce(updated);
    }
    const recipient = this.store.recipient(agent);
    if (recipient && recipient.pairingId !== pairingId) this.store.unbind(agent);
    for (const [id, watcher] of this.watchers)
      if (watcher.link.agent === agent && watcher.link.pairingId !== pairingId)
        this.watchers.delete(id);
  }

  // ── Agent: inbox ────────────────────────────────────────────────────────

  private authorize(link: { readonly agent: string; readonly pairingId: string }): void {
    if (this.options.pairings.pairingId(link.agent) !== link.pairingId)
      throw new SteeringError(
        "CredentialRejected",
        `This connection's pairing for ${link.agent} was revoked or replaced. Use the agent's current credential.`,
      );
  }

  inbox(
    link: { readonly agent: string; readonly pairingId: string },
    params: { readonly after?: number; readonly all?: boolean },
  ): InboxView {
    this.authorize(link);
    const messages = this.store
      .list({
        agent: link.agent,
        ...(params.after === undefined ? {} : { after: params.after }),
        unacknowledged: params.all !== true,
      })
      .filter((m) => m.pairingId === link.pairingId);
    return {
      agent: link.agent,
      pairingId: link.pairingId,
      recipient: this.current(link.agent) ?? null,
      messages,
      last: this.store.lastSeq(),
    };
  }

  private own(
    link: { readonly agent: string; readonly pairingId: string },
    messageId: string,
  ): SteeringMessage {
    this.authorize(link);
    const message = this.store.message(messageId);
    // Another agent's message is reported as missing: an agent sees only its own inbox.
    if (!message || message.agent !== link.agent)
      throw new SteeringError("MessageMissing", `Your inbox has no message ${messageId}.`, {
        messageId,
      });
    if (message.pairingId !== link.pairingId)
      throw new SteeringError(
        "Forbidden",
        `${messageId} was sent to an earlier pairing of ${link.agent}.`,
        { messageId },
      );
    return message;
  }

  ack(
    link: { readonly agent: string; readonly pairingId: string },
    messageId: string,
  ): SteeringMessage {
    const message = this.own(link, messageId);
    if (message.acknowledged) return message;
    if (message.closed)
      throw new SteeringError(
        "SteeringSettled",
        `${messageId} was ${message.closed.reason}: ${message.closed.detail}`,
        { messageId },
      );
    const updated = this.store.update(
      messageId,
      {
        ...(message.delivery.state === "pending"
          ? {
              delivery: {
                state: "withdrawn",
                nextAttemptAt: null,
                detail: "Acknowledged from the inbox before it was pushed.",
              },
            }
          : {}),
        acknowledged: { at: this.now(), agent: link.agent, pairingId: link.pairingId },
      },
      "acknowledged by the agent",
    );
    if (message.cursor)
      this.store.advanceCursor(
        link.agent,
        message.cursor.documentId,
        link.pairingId,
        message.cursor.head,
      );
    this.announce(updated);
    return updated;
  }

  /**
   * The agent links a request it committed for a message. A request that appended a
   * revision applies the message at once. A proposal it created or refined makes the
   * message "proposed" until the person accepts exactly that version (applied at the
   * accepting revision), discards it, or it is superseded. Requests committed before
   * the person sent the message are never linked. A later request of the agent's own
   * may replace a link that has not applied.
   */
  async applied(
    link: { readonly agent: string; readonly pairingId: string },
    params: { readonly messageId: string; readonly documentId: string; readonly requestId: string },
  ): Promise<SteeringMessage> {
    return this.serial(async () => {
      const message = this.own(link, params.messageId);
      const same =
        message.report?.documentId === params.documentId &&
        message.report.requestId === params.requestId;
      if (same) return (await this.resolve(message)) ?? message;
      if (message.applied)
        throw new SteeringError(
          "RequestConflict",
          `${params.messageId} is already applied by ${message.applied.documentId} request ${message.applied.requestId}.`,
          { messageId: params.messageId },
        );
      if (message.closed)
        throw new SteeringError(
          "SteeringSettled",
          `${params.messageId} was ${message.closed.reason}; nothing can be linked to it.`,
          { messageId: params.messageId },
        );
      if (!message.acknowledged)
        throw new SteeringError(
          "SteeringUnacknowledged",
          `Acknowledge ${params.messageId} before reporting what you did for it.`,
          { messageId: params.messageId },
        );
      if (message.documentId !== null && message.documentId !== params.documentId)
        throw new SteeringError(
          "InvalidArgument",
          `${params.messageId} is about ${message.documentId}, not ${params.documentId}.`,
          { path: ["params", "documentId"] },
        );
      const entries = await Effect.runPromise(this.options.project.journal(params.documentId));
      const entry = entries.find((e) => e.receipt.requestId === params.requestId);
      if (!entry)
        throw new SteeringError(
          "ReceiptMissing",
          `${params.documentId} has no committed request ${params.requestId}.`,
          { documentId: params.documentId, requestId: params.requestId },
        );
      const actor = actorOf(entry.envelope);
      if (actor?.kind !== "agent" || actor.id !== link.agent)
        throw new SteeringError(
          "Forbidden",
          `Request ${params.requestId} on ${params.documentId} was not committed by agent ${link.agent}.`,
          { documentId: params.documentId, requestId: params.requestId },
        );
      const baseline = this.store.baseline(params.messageId);
      if (baseline !== null && entry.sequence <= (baseline[params.documentId] ?? 0))
        throw new SteeringError(
          "InvalidArgument",
          `Request ${params.requestId} was committed before this message was sent; link a request you made for it.`,
          { documentId: params.documentId, requestId: params.requestId },
        );
      const report = reportOf(entry, this.now());
      if (!report)
        throw new SteeringError(
          "InvalidArgument",
          `Request ${params.requestId} (${entry.receipt.command}) neither changed the character nor proposed a change.`,
          { documentId: params.documentId, requestId: params.requestId },
        );
      const linked = message.report;
      if (linked) {
        const previous = entries.find((e) => e.receipt.requestId === linked.requestId);
        if (
          linked.documentId === params.documentId &&
          previous !== undefined &&
          previous.sequence >= entry.sequence
        )
          throw new SteeringError(
            "RequestConflict",
            `${params.messageId} is linked to the later request ${linked.requestId}.`,
            { messageId: params.messageId },
          );
      }
      const { review, applied } = judge(report, entries, null, this.now());
      const updated = this.store.update(
        params.messageId,
        { report, review, applied },
        applied
          ? `applied in revision ${String(applied.revision)} (${report.command})`
          : `reported ${report.command} of proposal ${report.proposal?.id ?? "?"} v${String(report.proposal?.version ?? 0)}; ${review?.state ?? "pending"}`,
      );
      this.announce(updated);
      return updated;
    });
  }

  /**
   * Re-check linked proposals against the journal: after a commit to a document,
   * and on start for every document.
   */
  documentChanged(documentId?: string): Promise<void> {
    return this.serial(async () => {
      try {
        for (const message of this.store.unresolved(documentId)) await this.resolve(message);
      } catch (error) {
        this.options.log?.(`steering: cannot re-check linked proposals: ${String(error)}`);
      }
    });
  }

  /** Recompute one message's review and applied state; store and announce a change. */
  private async resolve(message: SteeringMessage): Promise<SteeringMessage | undefined> {
    const stored = message.report;
    if (!stored || message.applied || message.closed) return undefined;
    let entries: ReadonlyArray<JournalEntry>;
    try {
      entries = await Effect.runPromise(this.options.project.journal(stored.documentId));
    } catch {
      return undefined;
    }
    const entry = entries.find((e) => e.receipt.requestId === stored.requestId);
    const report = entry ? (reportOf(entry, stored.at) ?? stored) : stored;
    const { review, applied } = judge(report, entries, message.review, this.now());
    if (
      JSON.stringify(report) === JSON.stringify(stored) &&
      JSON.stringify(review) === JSON.stringify(message.review) &&
      applied === null
    )
      return message;
    const updated = this.store.update(
      message.messageId,
      { report, review, applied },
      applied
        ? `applied: proposal ${review?.proposalId ?? ""} v${String(review?.version ?? 0)} accepted in revision ${String(applied.revision)}`
        : `proposal ${review?.proposalId ?? ""} v${String(review?.version ?? 0)} ${review?.state ?? "pending"}`,
    );
    this.announce(updated);
    return updated;
  }

  /** Run steps that read the journal and then write the outbox one at a time. */
  private serial<T>(step: () => Promise<T>): Promise<T> {
    const run = this.queue.then(step, step);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  watch(
    link: AgentLink,
    params: {
      readonly push: "events" | "claude-channel";
      readonly instance?: string;
      readonly server?: string;
      readonly client?: { readonly name: string; readonly version: string };
    },
  ): { readonly watching: true; readonly push: "events" | "claude-channel" } {
    this.authorize(link);
    if (params.push === "claude-channel" && params.instance === undefined)
      throw new SteeringError(
        "InvalidArgument",
        "A claude-channel watch names this MCP server process's instance.",
        { path: ["params", "instance"] },
      );
    this.watchers.set(link.id, {
      link,
      push: params.push,
      channel:
        params.push === "claude-channel" && params.instance !== undefined
          ? {
              instance: params.instance,
              server: params.server ?? null,
              client: params.client ?? null,
              since: this.now(),
            }
          : null,
    });
    if (params.push === "claude-channel") this.kick();
    return { watching: true, push: params.push };
  }

  pushed(link: AgentLink, messageId: string): SteeringMessage {
    const message = this.own(link, messageId);
    const wait = this.pushWaits.get(messageId);
    if (wait && wait.link === link.id) {
      this.pushWaits.delete(messageId);
      wait.resolve(true);
    }
    return message;
  }

  disconnected(linkId: string): void {
    this.watchers.delete(linkId);
    for (const [messageId, wait] of this.pushWaits)
      if (wait.link === linkId) {
        this.pushWaits.delete(messageId);
        wait.resolve(false);
      }
  }

  // ── Prompts ─────────────────────────────────────────────────────────────

  /** The text a conversation receives: the person's words, then how to answer through the pairing. */
  prompt(message: SteeringMessage): string {
    const { agentCommand: irudd } = this.options;
    const credential = this.options.credentialFile(message.agent);
    const cred = `--credential "${credential}"`;
    const project = this.options.project.info;
    const doc = message.documentId;
    const cursor = message.cursor;
    const special = this.options.instructions?.(message, { irudd, cred });
    const lines = [
      `[irudd steering ${message.messageId}]`,
      `From ${message.createdBy.name ?? message.createdBy.id} in the irudd workshop, project "${project.label}" (${project.projectId})${doc ? `, document ${doc}${cursor ? ` at revision ${cursor.head}` : ""}` : ""}.`,
      "",
      message.text,
      "",
      `This is for paired agent "${message.agent}" (pairing ${message.pairingId}) in this conversation. Work here; do not start another conversation or agent.`,
      `Your agent credential is the per-user file ${credential}. Use it as-is; never print or copy its contents.`,
      ...(doc && cursor
        ? [
            `Manual changes since your last acknowledged revision: ${irudd} changes ${doc} --since ${cursor.since} --by human ${cred}`,
            `Read the document: ${irudd} show ${doc} ${cred}`,
          ]
        : []),
      `Acknowledge once you have read this: ${irudd} ack ${message.messageId} ${cred}`,
      ...(special ??
        (doc
          ? [
              `Propose your change (a person accepts it): ${irudd} propose ${doc} <prop-id> --base <revision> --summary "<what and why>" --op '<operation JSON>' ${cred}`,
              `Then link it: ${irudd} applied ${message.messageId} --doc ${doc} --request-id <the request ID propose printed> ${cred}. It shows as awaiting review; it counts as applied only when the person accepts that version.`,
            ]
          : [])),
      `Your inbox: ${irudd} inbox ${cred}. Over the irudd MCP server the same steps are read_inbox, ack_steering, read_changes (by=human), propose_change and report_applied.`,
      `If you have seen ${message.messageId} before, it is a repeat: acknowledge it and do not act on it twice.`,
    ];
    return lines.join("\n");
  }

  private meta(message: SteeringMessage): Record<string, string> {
    return {
      message_id: message.messageId,
      agent: message.agent,
      project: this.options.project.info.projectId,
      ...(message.documentId ? { document: message.documentId } : {}),
    };
  }

  // ── Delivery ────────────────────────────────────────────────────────────

  private announce(message: SteeringMessage): void {
    this.options.emit({
      t: "event",
      event: "steer",
      messageId: message.messageId,
      agent: message.agent,
      seq: message.seq,
      status: message.status,
    });
  }

  private notifyWatchers(message: SteeringMessage): void {
    for (const watcher of this.watchers.values())
      if (
        watcher.push === "events" &&
        watcher.link.agent === message.agent &&
        watcher.link.pairingId === message.pairingId
      )
        watcher.link.write({
          t: "event",
          event: "inbox",
          messageId: message.messageId,
          seq: message.seq,
          prompt: this.prompt(message),
          meta: this.meta(message),
        });
  }

  private kick(): void {
    if (this.stopped) return;
    if (this.pumping) {
      this.again = true;
      return;
    }
    this.pumping = true;
    void this.pump()
      .catch((error: unknown) =>
        this.options.log?.(
          `steering: delivery worker failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      )
      .finally(() => {
        this.pumping = false;
        if (this.again) {
          this.again = false;
          this.kick();
        }
      });
  }

  private async pump(): Promise<void> {
    for (;;) {
      if (this.stopped) return;
      const now = this.now();
      const heads = this.store.deliverable();
      const due = heads.filter((m) => (m.delivery.nextAttemptAt ?? 0) <= now);
      if (due.length === 0) {
        const next = Math.min(
          ...heads.map((m) => m.delivery.nextAttemptAt ?? Number.POSITIVE_INFINITY),
        );
        if (this.timer) clearTimeout(this.timer);
        this.timer = undefined;
        if (Number.isFinite(next)) {
          this.timer = setTimeout(() => this.kick(), Math.max(10, next - now));
          this.timer.unref();
        }
        return;
      }
      await Promise.all(due.map((message) => this.dispatch(message)));
    }
  }

  private async dispatch(message: SteeringMessage): Promise<void> {
    const pairingId = this.options.pairings.pairingId(message.agent);
    if (pairingId !== message.pairingId) {
      this.pairingChanged(message.agent);
      return;
    }
    const recipient = this.current(message.agent);
    if (!recipient || !sameRoute(recipient.route, message.route)) {
      this.announce(
        this.store.update(
          message.messageId,
          {
            delivery: {
              state: "failed",
              nextAttemptAt: null,
              detail: recipient
                ? `${message.agent} was bound to ${describeRoute(recipient.route)} after this was sent to ${describeRoute(message.route)}. It was not delivered; send a new message.`
                : `${message.agent} was unbound after this was sent. It was not delivered.`,
            },
          },
          "recipient changed",
        ),
      );
      return;
    }
    const transport = this.transports.get(message.route.transport);
    const attempts = message.delivery.attempts + 1;
    if (!transport) {
      this.announce(
        this.store.update(
          message.messageId,
          {
            delivery: {
              state: "pending",
              attempts,
              lastAttemptAt: this.now(),
              nextAttemptAt: this.now() + 60_000,
              detail: `This host has no ${message.route.transport} adapter. The agent can read it from its inbox.`,
            },
          },
          "no adapter",
        ),
      );
      return;
    }
    this.announce(
      this.store.update(
        message.messageId,
        {
          delivery: {
            state: "dispatching",
            attempts,
            lastAttemptAt: this.now(),
            nextAttemptAt: null,
            detail: null,
          },
        },
        `attempt ${attempts}`,
      ),
    );
    const outcome = await withTimeout<DeliveryOutcome>(
      transport
        .deliver({
          messageId: message.messageId,
          agent: message.agent,
          route: message.route,
          prompt: this.prompt(message),
          meta: this.meta(message),
        })
        .catch((error: unknown): DeliveryOutcome => ({
          kind: "unknown",
          detail: `The adapter failed during the send: ${error instanceof Error ? error.message : String(error)}`,
        })),
      this.options.deliverTimeoutMs ?? 60_000,
      () => ({ kind: "unknown", detail: "The host did not answer in time." }),
    );
    if (this.stopped) return;
    const detail = outcome.kind === "accepted" ? null : outcome.detail;
    const state =
      outcome.kind === "accepted"
        ? "accepted"
        : outcome.kind === "offline"
          ? "pending"
          : outcome.kind === "rejected"
            ? "failed"
            : "unknown";
    const backoff = Math.min(
      60_000,
      (this.options.retryBaseMs ?? 1000) * 2 ** Math.min(attempts - 1, 6),
    );
    const updated = this.store.update(
      message.messageId,
      {
        delivery: {
          state,
          nextAttemptAt: outcome.kind === "offline" ? this.now() + backoff : null,
          receipt: outcome.kind === "accepted" ? outcome.receipt : null,
          detail,
        },
      },
      outcome.kind === "accepted"
        ? `accepted by ${outcome.receipt.transport}${outcome.receipt.delivery ? ` (${outcome.receipt.delivery})` : ""}`
        : `${outcome.kind}: ${detail ?? ""}`,
    );
    this.options.log?.(
      `steering: ${message.messageId} to ${message.agent}: ${steeringStatus(updated)}${detail ? ` (${detail})` : ""}`,
    );
    this.announce(updated);
  }

  // ── Claude channel ──────────────────────────────────────────────────────

  private channelWatcher(agent: string, instance: string): Watcher | undefined {
    const pairingId = this.options.pairings.pairingId(agent);
    return [...this.watchers.values()].find(
      (w) =>
        w.push === "claude-channel" &&
        w.link.agent === agent &&
        w.link.pairingId === pairingId &&
        w.channel?.instance === instance,
    );
  }

  private channelAvailability(
    agent: string,
    route: Extract<RecipientRoute, { transport: "claude-channel" }>,
  ): RouteAvailability {
    const live = this.channelWatcher(agent, route.instance);
    const others = [...this.watchers.values()].filter(
      (w) =>
        w.push === "claude-channel" &&
        w.link.agent === agent &&
        w.channel?.instance !== route.instance,
    );
    return live
      ? {
          state: "ready",
          push: true,
          summary: `${describeRoute(route)} is connected. Claude Code shows the message if that session was started with --channels (or --dangerously-load-development-channels) server:${route.server}; the agent's acknowledgement confirms it.`,
          checkedAt: this.now(),
          conversation: live.channel?.client
            ? {
                status: "connected",
                provider: `${live.channel.client.name} ${live.channel.client.version}`,
              }
            : { status: "connected" },
        }
      : {
          state: "offline",
          push: false,
          summary: `The bound MCP server instance ${route.instance} is not connected.${others.length > 0 ? ` Another instance of ${agent} is (${others.map((w) => w.channel?.instance ?? "?").join(", ")}); bind it explicitly if it is the same conversation.` : ""} Messages wait in the inbox.`,
          checkedAt: this.now(),
          conversation: null,
        };
  }

  private channelTransport(): SteeringTransport {
    return {
      transport: "claude-channel",
      // The service answers channel checks itself, per agent (channelAvailability).
      check: () =>
        Promise.resolve({
          state: "offline",
          push: false,
          summary: "Ask recipient.check for a channel route.",
          conversation: null,
        }),
      deliver: async (request) => {
        const route = request.route;
        if (route.transport !== "claude-channel")
          return { kind: "rejected", detail: "Not a channel route." };
        const watcher = this.channelWatcher(request.agent, route.instance);
        if (!watcher)
          return {
            kind: "offline",
            detail: `MCP server instance ${route.instance} of ${request.agent} is not connected.`,
          };
        const pushed = new Promise<boolean>((resolve) =>
          this.pushWaits.set(request.messageId, { link: watcher.link.id, resolve }),
        );
        const message = this.store.message(request.messageId);
        const written = watcher.link.write({
          t: "event",
          event: "inbox",
          messageId: request.messageId,
          seq: message?.seq ?? 0,
          prompt: request.prompt,
          meta: { ...request.meta },
        });
        if (!written) {
          this.pushWaits.delete(request.messageId);
          return { kind: "offline", detail: "The MCP server's connection closed before the push." };
        }
        const confirmed = await withTimeout(
          pushed,
          this.options.channelConfirmMs ?? 10_000,
          () => false,
        );
        this.pushWaits.delete(request.messageId);
        return confirmed
          ? {
              kind: "accepted",
              receipt: {
                transport: "claude-channel",
                delivery: "channel-notified",
                via: "claude-channel",
                at: this.now(),
              },
            }
          : {
              kind: "unknown",
              detail: "The MCP server did not confirm the channel notification.",
            };
      },
    };
  }
}

// ── Linked requests ─────────────────────────────────────────────────────────

const decodeActor = Schema.decodeUnknownOption(Actor);

function actorOf(envelope: unknown): Actor | null {
  if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope)) return null;
  return Option.getOrNull(decodeActor(Reflect.get(envelope, "actor")));
}

/** What a linked request did, or undefined when it neither changed nor proposed anything. */
function reportOf(entry: JournalEntry, at: number): SteeringReport | undefined {
  const receipt = entry.receipt;
  const base = {
    at,
    documentId: receipt.documentId,
    requestId: receipt.requestId,
    command: receipt.command,
    revision: receipt.revision,
  };
  if (receipt.command === "proposal.create" || receipt.command === "proposal.refine") {
    if (!receipt.proposal) return undefined;
    return {
      ...base,
      kind: "proposal",
      proposal: { id: receipt.proposal.id, version: receipt.proposal.version },
    };
  }
  if (receipt.appended) return { ...base, kind: "revision", proposal: null };
  return undefined;
}

/**
 * The review and applied state of a report, from the journal entries after it.
 * Only the person's acceptance of exactly the linked version applies a proposal.
 */
function judge(
  report: SteeringReport,
  entries: ReadonlyArray<JournalEntry>,
  previous: ProposalReview | null,
  now: number,
): { readonly review: ProposalReview | null; readonly applied: SteeringApplied | null } {
  const at = entries.find((e) => e.receipt.requestId === report.requestId);
  if (report.kind === "revision") {
    if (!at?.receipt.appended) return { review: null, applied: null };
    return {
      review: null,
      applied: {
        at: now,
        documentId: report.documentId,
        requestId: report.requestId,
        revision: at.receipt.revision,
        via: "direct",
        proposal: null,
        acceptedBy: null,
      },
    };
  }
  const linked = report.proposal;
  if (!linked || !at) return { review: null, applied: null };
  let state: ProposalReview["state"] = "pending";
  let latestVersion = linked.version;
  let decidedBy: Actor | null = null;
  let decisionRequestId: string | null = null;
  let acceptedRevision: number | null = null;
  for (const entry of entries) {
    if (entry.sequence <= at.sequence) continue;
    const proposal = entry.receipt.proposal;
    if (!proposal || proposal.id !== linked.id) continue;
    latestVersion = Math.max(latestVersion, proposal.version);
    if (state !== "pending") continue;
    let next: ProposalReview["state"] = "pending";
    if (entry.receipt.command === "proposal.refine") next = "superseded";
    else if (entry.receipt.command === "proposal.discard") next = "discarded";
    else if (entry.receipt.command === "proposal.accept")
      next =
        proposal.version === linked.version && entry.receipt.appended ? "accepted" : "superseded";
    if (next === "pending") continue;
    state = next;
    decidedBy = actorOf(entry.envelope);
    decisionRequestId = entry.receipt.requestId;
    if (next === "accepted") acceptedRevision = entry.receipt.revision;
  }
  const keep = previous !== null && previous.state === state && previous.proposalId === linked.id;
  const review: ProposalReview = {
    proposalId: linked.id,
    version: linked.version,
    state,
    latestVersion,
    decidedAt: state === "pending" ? null : keep ? previous.decidedAt : now,
    decidedBy,
    decisionRequestId,
    acceptedRevision,
  };
  const applied: SteeringApplied | null =
    state === "accepted" && acceptedRevision !== null && decisionRequestId !== null
      ? {
          at: now,
          documentId: report.documentId,
          requestId: decisionRequestId,
          revision: acceptedRevision,
          via: "proposal-accepted",
          proposal: linked,
          acceptedBy: decidedBy,
        }
      : null;
  return { review, applied };
}
