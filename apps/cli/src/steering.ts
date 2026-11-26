import fs from "node:fs";
import { isJsonArray, type Json } from "@irudd/document";
import type { RecipientRoute, SteeringMessage, RecipientView } from "@irudd/workshop/wire";
import {
  baseOption,
  base,
  exit,
  list,
  parseJson,
  positional,
  readJson,
  requestId,
  requestOption,
  show,
  submit,
  text,
  UsageError,
  withClient,
  type Context,
  type Verb,
} from "./commands.js";
import { table } from "./format.js";

const clip = (value: string, width: number): string => {
  const line = value.replaceAll(/\s+/g, " ").trim();
  return line.length <= width ? line : `${line.slice(0, width - 1)}…`;
};

const time = (at: number | null | undefined): string =>
  at === null || at === undefined ? "" : new Date(at).toISOString().replace(/\.\d+Z$/, "Z");

export function routeLine(route: RecipientRoute): string {
  switch (route.transport) {
    case "t3-thread":
      return `t3 thread ${route.conversation} (${route.environment}${route.project ? `, project ${route.project}` : ""}, ${route.delivery ?? "next-turn"})`;
    case "claude-channel":
      return `claude channel ${route.instance} via MCP server ${route.server}${route.conversation ? `, session ${route.conversation}` : ""}`;
    case "codex-queue":
      return `codex session ${route.conversation}`;
    case "inbox":
      return `${route.host} inbox only${route.conversation ? ` (${route.conversation})` : ""}`;
  }
}

function recipients(views: ReadonlyArray<RecipientView>): string {
  if (views.length === 0) return 'No agents are paired. Pair one with "irudd pair <agent-id>".';
  return views
    .map((v) =>
      [
        `${v.agent}${v.name ? ` (${v.name})` : ""}  pairing ${v.pairingId}`,
        `  route        ${v.recipient ? routeLine(v.recipient.route) : "none: bind one with irudd route"}`,
        `  availability ${v.availability.state}${v.availability.push ? ", push" : ", no push"}: ${v.availability.summary}`,
        ...(v.availability.conversation
          ? [
              `  conversation ${Object.entries(v.availability.conversation)
                .map(([k, val]) => `${k}=${String(val)}`)
                .join(" ")}`,
            ]
          : []),
        ...v.channels.map(
          (c) =>
            `  channel      ${c.instance}${c.server ? ` server ${c.server}` : ""}${c.client ? ` from ${c.client.name} ${c.client.version}` : ""}, since ${time(c.since)}`,
        ),
      ].join("\n"),
    )
    .join("\n");
}

export function messageDetail(m: SteeringMessage): string {
  return [
    `${m.messageId}  ${m.status}`,
    `  to        ${m.agent} (pairing ${m.pairingId}) at ${routeLine(m.route)}`,
    `  request   ${m.requestId}, sent ${time(m.createdAt)} by ${m.createdBy.id}`,
    ...(m.cursor
      ? [
          `  document  ${m.cursor.documentId}: manual changes since r${m.cursor.since}, head r${m.cursor.head}`,
        ]
      : []),
    `  delivery  ${m.delivery.state}, ${m.delivery.attempts} attempt(s)${m.delivery.receipt ? `, host ${m.delivery.receipt.delivery ?? "accepted"}${m.delivery.receipt.hostMessageId ? ` ${m.delivery.receipt.hostMessageId}` : ""} at ${time(m.delivery.receipt.at)}` : ""}${m.delivery.nextAttemptAt ? `, next try ${time(m.delivery.nextAttemptAt)}` : ""}`,
    ...(m.delivery.detail ? [`            ${m.delivery.detail}`] : []),
    `  agent ack ${m.acknowledged ? `${time(m.acknowledged.at)} by ${m.acknowledged.agent}` : "not yet"}`,
    `  reported  ${m.report ? `${m.report.documentId} request ${m.report.requestId} (${m.report.command}${m.report.proposal ? ` of ${m.report.proposal.id} v${m.report.proposal.version}` : ""})` : "not yet"}`,
    ...(m.review
      ? [
          `  review    ${m.review.state}${m.review.state === "pending" ? ", awaiting the person" : ""}${m.review.latestVersion !== m.review.version ? `, latest v${m.review.latestVersion}` : ""}${m.review.decisionRequestId ? ` (request ${m.review.decisionRequestId}${m.review.decidedBy ? ` by ${m.review.decidedBy.id}` : ""})` : ""}`,
        ]
      : []),
    `  applied   ${m.applied ? `revision ${m.applied.revision} of ${m.applied.documentId} (${m.applied.via === "direct" ? "direct edit" : `proposal ${m.applied.proposal?.id ?? ""} v${m.applied.proposal?.version ?? 0} accepted`}, request ${m.applied.requestId})` : "not yet"}`,
    ...(m.closed ? [`  closed    ${m.closed.reason}: ${m.closed.detail}`] : []),
    "",
    m.text,
  ].join("\n");
}

function messages(list: ReadonlyArray<SteeringMessage>): string {
  if (list.length === 0) return "No messages.";
  return table(
    ["MESSAGE", "STATUS", "AGENT", "DOC", "ACK", "TEXT"],
    list.map((m) => [
      m.messageId,
      m.status,
      m.agent,
      m.documentId ?? "",
      m.acknowledged ? "yes" : "",
      clip(m.text, 48),
    ]),
  );
}

function readText(context: Context, index: number): string {
  const raw = positional(context, index, "text");
  if (raw !== "-") return raw;
  return fs.readFileSync(0, "utf8");
}

function buildRoute(context: Context): RecipientRoute {
  const t3 = text(context, "t3-thread");
  const codex = text(context, "codex-session");
  const channel = text(context, "claude-channel");
  const inbox = text(context, "inbox");
  const given = [t3, codex, channel, inbox].filter((v) => v !== undefined).length;
  if (given !== 1)
    throw new UsageError(
      "Give exactly one of --t3-thread, --codex-session, --claude-channel or --inbox.",
    );
  const environment = text(context, "environment") ?? "local";
  const conversation = text(context, "conversation");
  if (t3 !== undefined) {
    const project = text(context, "t3-project");
    return {
      transport: "t3-thread",
      host: "t3",
      environment,
      conversation: t3,
      ...(project === undefined ? {} : { project }),
      ...(context.options["mid-turn"] === true ? { delivery: "mid-turn" as const } : {}),
    };
  }
  if (codex !== undefined)
    return { transport: "codex-queue", host: "codex", environment: "local", conversation: codex };
  if (channel !== undefined)
    return {
      transport: "claude-channel",
      host: "claude-code",
      environment: "local",
      server: text(context, "server") ?? "irudd",
      instance: channel,
      ...(conversation === undefined ? {} : { conversation }),
    };
  if (inbox !== "agent" && inbox !== "t3" && inbox !== "claude-code" && inbox !== "codex")
    throw new UsageError("--inbox is agent, t3, claude-code or codex.");
  return {
    transport: "inbox",
    host: inbox,
    environment,
    ...(conversation === undefined ? {} : { conversation }),
  };
}

const messageVerb = (
  name: string,
  summary: string,
  method: "steer.get" | "steer.cancel" | "steer.retry",
  details?: string,
): Verb => ({
  name,
  args: "<message-id>",
  summary,
  ...(details === undefined ? {} : { details }),
  options: {},
  run: (context) =>
    withClient(context, async (c) => {
      const message = await c.call(method, { messageId: positional(context, 0, "message-id") });
      show(context, message, () => messageDetail(message));
      return exit.ok;
    }),
});

export const steeringVerbs: ReadonlyArray<Verb> = [
  {
    name: "route",
    args: "<agent-id>",
    summary: "Bind a paired agent to the one conversation it works in",
    details: [
      "Examples:",
      "  irudd route claude --t3-thread thread:abc123 --t3-project <t3-project-id> [--mid-turn]",
      "  irudd route codex --codex-session 019a…",
      "  irudd route claude --claude-channel chn-… (an instance from irudd recipients)",
      "  irudd route codex --inbox codex --conversation 019a…",
      "The host delivers only to this conversation. It never starts one, never picks",
      "another when this one is unreachable, and binding again does not move messages",
      "already sent. Re-pairing the agent unbinds it.",
    ].join("\n"),
    options: {
      "t3-thread": { type: "string", value: "thread-id", help: "A T3 Code thread ID." },
      "t3-project": { type: "string", value: "id", help: "The T3 project the thread belongs to." },
      "mid-turn": {
        type: "boolean",
        help: "T3: steer a running turn when T3 and its provider can (needs irudd t3 connect).",
      },
      "codex-session": { type: "string", value: "uuid", help: "A saved Codex session ID." },
      "claude-channel": {
        type: "string",
        value: "instance",
        help: "A connected irudd MCP server instance (see irudd recipients).",
      },
      server: { type: "string", value: "name", help: "The MCP server's name (default irudd)." },
      inbox: {
        type: "string",
        value: "host",
        help: "No push: agent, t3, claude-code or codex. The agent reads its inbox.",
      },
      conversation: {
        type: "string",
        value: "id",
        help: "The host's conversation ID, for display (inbox and channel routes).",
      },
      environment: { type: "string", value: "id", help: "local (default) or a T3 environment ID." },
      doc: {
        type: "string",
        multiple: true,
        value: "doc-id",
        help: "Limit to these documents. Repeat for several.",
      },
    },
    run: (context) =>
      withClient(context, async (c) => {
        const documents = list(context, "doc");
        const bound = await c.call("recipient.bind", {
          agent: positional(context, 0, "agent-id"),
          route: buildRoute(context),
          ...(documents.length > 0 ? { documents: [...documents] } : {}),
        });
        show(
          context,
          bound,
          () => `Bound ${bound.agent} (pairing ${bound.pairingId}) to ${routeLine(bound.route)}.`,
        );
        return exit.ok;
      }),
  },
  {
    name: "unroute",
    args: "<agent-id>",
    summary: "Remove an agent's conversation binding; queued messages stay queued",
    options: {},
    run: (context) =>
      withClient(context, async (c) => {
        const result = await c.call("recipient.unbind", {
          agent: positional(context, 0, "agent-id"),
        });
        show(context, result, () =>
          result.unbound ? `Unbound ${result.agent}.` : `${result.agent} had no binding.`,
        );
        return exit.ok;
      }),
  },
  {
    name: "recipients",
    args: "[agent-id]",
    summary: "Show each paired agent's route, availability and connected channels",
    details: "With an agent ID, asks that agent's host now instead of showing the last check.",
    options: {},
    run: (context) =>
      withClient(context, async (c) => {
        const agent = context.positionals[0];
        const views =
          agent === undefined
            ? await c.call("recipient.list", {})
            : [await c.call("recipient.check", { agent })];
        show(context, views, () => recipients(views));
        return exit.ok;
      }),
  },
  {
    name: "send",
    args: "<agent-id> <text|->",
    summary: "Send a message to an agent's bound conversation (- reads it from stdin)",
    details:
      "The message waits in the host's outbox until the conversation's host accepts it; the agent acknowledges it with its own credential. Reusing --request-id returns the same message.",
    options: {
      doc: { type: "string", value: "doc-id", help: "The document the message is about." },
      ...requestOption,
    },
    run: (context) =>
      withClient(context, async (c) => {
        const documentId = text(context, "doc");
        const sent = await c.call("steer.send", {
          agent: positional(context, 0, "agent-id"),
          requestId: requestId(context),
          text: readText(context, 1),
          ...(documentId === undefined ? {} : { documentId }),
        });
        show(context, sent, () => messageDetail(sent));
        return exit.ok;
      }),
  },
  {
    name: "outbox",
    args: "",
    summary: "List steering messages and their delivery, acknowledgement and applied state",
    options: {
      agent: { type: "string", value: "agent-id", help: "Only this agent's messages." },
      after: { type: "string", value: "seq", help: "Only messages after this sequence number." },
    },
    run: (context) =>
      withClient(context, async (c) => {
        const agent = text(context, "agent");
        const after = text(context, "after");
        const view = await c.call("steer.list", {
          ...(agent === undefined ? {} : { agent }),
          ...(after === undefined ? {} : { after: Number(after) }),
        });
        show(context, view, () => messages(view.messages));
        return exit.ok;
      }),
  },
  messageVerb("message", "Show one steering message with its delivery history", "steer.get"),
  messageVerb("cancel", "Withdraw a message the agent has not acknowledged", "steer.cancel"),
  messageVerb(
    "resend",
    "Send a failed or delivery-unknown message again to the same conversation",
    "steer.retry",
    "The conversation may already hold the first copy; the agent recognises the repeat by its message ID.",
  ),
  {
    name: "inbox",
    args: "",
    summary: "Agents (--credential): the messages sent to this pairing",
    options: {
      all: { type: "boolean", help: "Include acknowledged messages." },
      after: { type: "string", value: "seq", help: "Only messages after this sequence number." },
    },
    run: (context) =>
      withClient(context, async (c) => {
        const after = text(context, "after");
        const view = await c.call("inbox.read", {
          ...(context.options["all"] === true ? { all: true } : {}),
          ...(after === undefined ? {} : { after: Number(after) }),
        });
        show(context, view, () =>
          view.messages.length === 0
            ? `No unacknowledged messages for ${view.agent}.`
            : view.messages.map(messageDetail).join("\n\n"),
        );
        return exit.ok;
      }),
  },
  {
    name: "ack",
    args: "<message-id>",
    summary: "Agents (--credential): acknowledge a message after reading it",
    options: {},
    run: (context) =>
      withClient(context, async (c) => {
        const acked = await c.call("inbox.ack", {
          messageId: positional(context, 0, "message-id"),
        });
        show(context, acked, () =>
          [
            `Acknowledged ${acked.messageId}.`,
            ...(acked.cursor
              ? [
                  `Manual changes it refers to: irudd changes ${acked.cursor.documentId} --since ${acked.cursor.since} --by human`,
                ]
              : []),
          ].join("\n"),
        );
        return exit.ok;
      }),
  },
  {
    name: "applied",
    args: "<message-id>",
    summary: "Agents (--credential): link the edit or proposal you committed for a message",
    details:
      "A direct edit applies the message. A proposal leaves it awaiting the person's review; it is applied only when they accept that version.",
    options: {
      doc: { type: "string", value: "doc-id", help: "The document you changed." },
      "request-id": { type: "string", value: "id", help: "The request ID of your change." },
    },
    run: (context) =>
      withClient(context, async (c) => {
        const documentId = text(context, "doc");
        const request = text(context, "request-id");
        if (documentId === undefined || request === undefined)
          throw new UsageError("Give --doc and --request-id of the change you committed.");
        const done = await c.call("inbox.applied", {
          messageId: positional(context, 0, "message-id"),
          documentId,
          requestId: request,
        });
        show(
          context,
          done,
          () =>
            `Linked ${done.messageId} to ${documentId} request ${request}: ${done.applied ? `applied in revision ${done.applied.revision}` : done.status === "proposed" ? "awaiting the person's review" : done.status}.`,
        );
        return exit.ok;
      }),
  },
  {
    name: "propose",
    args: "<doc-id> <proposal-id>",
    summary: "Draft a proposal of document operations for a person to accept",
    details:
      'Example: irudd propose doc-marsh01 prop-brow --base head --summary "Heavier brow" --op \'{"op":"feature.set","feature":"character.appearance","value":{…}}\'',
    options: {
      ...baseOption,
      summary: { type: "string", value: "text", help: "What the change does and why." },
      op: {
        type: "string",
        multiple: true,
        value: "json",
        help: "One operation as JSON. Repeat for several.",
      },
      "ops-file": { type: "string", value: "file", help: "A JSON array of operations." },
      ...requestOption,
    },
    run: (context) =>
      withClient(context, async (c) => {
        const documentId = positional(context, 0, "doc-id");
        const proposal = positional(context, 1, "proposal-id");
        const summary = text(context, "summary");
        if (summary === undefined) throw new UsageError("Give --summary for the reviewer.");
        const ops: Json[] = list(context, "op").map((raw, i) => parseJson(raw, `--op ${i + 1}`));
        const file = text(context, "ops-file");
        if (file !== undefined) {
          const fromFile = readJson(file, "operations file");
          if (!isJsonArray(fromFile))
            throw new UsageError(`${file} must hold a JSON array of operations.`);
          ops.push(...fromFile);
        }
        if (ops.length === 0) throw new UsageError("Give at least one --op or --ops-file.");
        return submit(context, c, documentId, await base(context, c, documentId), {
          type: "proposal.create",
          proposal,
          summary,
          content: { kind: "ops", ops },
        });
      }),
  },
];
