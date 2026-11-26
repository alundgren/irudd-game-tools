import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { isJson, type Json } from "@irudd/document";
import { envelope, mergePatch, WorkshopError } from "@irudd/workshop/client";
import type { ApplyResult } from "@irudd/workshop/contract";
import type { HostConnection } from "./connection.js";

const documentId = z
  .string()
  .describe("Document ID, like doc-marsh01 (doc- then 4–63 lowercase letters, digits or dashes).");
const requestId = z
  .string()
  .describe(
    "Idempotency key for this change, 8–128 characters (a UUID is fine). Choose a new one per intended change and reuse it when retrying: a repeat replays the original result instead of writing twice.",
  );
const baseRevision = z
  .number()
  .int()
  .min(0)
  .describe("The document revision you read and prepared this change against.");
const proposalId = z
  .string()
  .describe("Proposal ID, like prop-longer-tail (prop- then lowercase letters, digits or dashes).");
const ops = z
  .array(z.record(z.string(), z.unknown()))
  .describe(
    'Document operations, e.g. {"op":"part.rename","part":"p-head","label":"Skull"} or {"op":"part.set","part":"p-tail","set":{"color":"#445566"}}. The host validates each and reports field diagnostics.',
  );
const steer = z
  .record(z.string(), z.unknown())
  .describe(
    'A JSON merge patch for the document\'s generator parameters, e.g. {"tail":{"length":1.2}}. It is merged with the current parameters and sent as one generation.steer operation; manual edits are kept.',
  );

const text = (value: string, isError = false): CallToolResult => ({
  content: [{ type: "text", text: value }],
  ...(isError ? { isError: true } : {}),
});

const json = (summary: string, value: unknown, isError = false): CallToolResult =>
  text(`${summary}\n\n${JSON.stringify(value, null, 2)}`, isError);

function asJson(value: unknown, what: string): Json {
  if (!isJson(value))
    throw new WorkshopError({ _tag: "InvalidArgument", message: `${what} must be plain JSON.` });
  return value;
}

function applied(result: ApplyResult, request: string): CallToolResult {
  switch (result.kind) {
    case "committed":
      return json(
        `Committed (request ${request}): head is revision ${result.receipt.revision}.${result.receipt.proposal ? ` Proposal ${result.receipt.proposal.id} v${result.receipt.proposal.version} is ${result.receipt.proposal.status}.` : ""}`,
        result,
      );
    case "replayed":
      return json(`Already applied earlier (request ${request}); nothing new was written.`, result);
    case "rejected":
      return json(
        `Rejected; nothing was written (request ${request}). Fix the fields named below${result.diagnostics.some((d) => d.code === "stale-revision") ? ", or read the document again and use its current revision" : ""}.`,
        result,
        true,
      );
  }
}

async function guarded(body: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof WorkshopError)
      return json(`${error._tag}: ${error.message}`, error.detail, true);
    return text(
      `Unexpected failure: ${error instanceof Error ? error.message : String(error)}`,
      true,
    );
  }
}

const read = { readOnlyHint: true, openWorldHint: false } as const;
const write = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function registerTools(server: McpServer, host: HostConnection): void {
  server.registerTool(
    "workshop_status",
    {
      title: "Workshop status",
      description:
        "The open project, the host serving it, and who you are. Explains what you may do: read documents, create new ones, and propose changes a person accepts. You edit directly only on documents where a person has turned that on.",
      inputSchema: {},
      annotations: read,
    },
    () =>
      guarded(async () => {
        const info = await host.call("project.info", {});
        const me = await host.call("whoami", {});
        return json(
          `Project "${info.label}" served by a ${info.host.kind} host (pid ${info.host.pid}). You are ${me.actor.kind} ${me.actor.id}.`,
          { project: info, you: me },
        );
      }),
  );

  server.registerTool(
    "list_starters",
    {
      title: "List starters",
      description:
        "Starting forms this host offers. A generator starter has presets and, if seeded, deterministic seeds. A reference generator exists to exercise the protocol and is not a character family. A form starter is a prepared family document.",
      inputSchema: {},
      annotations: read,
    },
    () => guarded(async () => json("Starters:", await host.call("starters", {}))),
  );

  server.registerTool(
    "list_documents",
    {
      title: "List documents",
      description: "Documents in the project with their head revision.",
      inputSchema: {},
      annotations: read,
    },
    () => guarded(async () => json("Documents:", await host.call("documents", {}))),
  );

  server.registerTool(
    "create_document",
    {
      title: "Create a document",
      description:
        "Create a new document from a starter. Give at most one of preset and seed; without either a generator starter uses its default preset.",
      inputSchema: {
        documentId,
        starter: z.string().describe("Starter ID from list_starters, e.g. frame-creature."),
        preset: z.string().optional().describe("Preset ID of a generator starter."),
        seed: z
          .number()
          .int()
          .min(0)
          .max(4294967295)
          .optional()
          .describe("Seed for a seeded generator starter."),
        label: z.string().optional().describe("Document label."),
        requestId,
      },
      annotations: write,
    },
    (args) =>
      guarded(async () => {
        const started = await host.call("start", {
          documentId: args.documentId,
          requestId: args.requestId,
          starter: args.starter,
          ...(args.preset === undefined ? {} : { preset: args.preset }),
          ...(args.seed === undefined ? {} : { seed: args.seed }),
          ...(args.label === undefined ? {} : { label: args.label }),
        });
        return applied(started.result, args.requestId);
      }),
  );

  server.registerTool(
    "read_document",
    {
      title: "Read a document",
      description:
        "The head of a document: revision, digest, access, agent policy and the whole document JSON (parts, generator parameters, features). Use its revision as baseRevision for changes.",
      inputSchema: { documentId },
      annotations: read,
    },
    (args) =>
      guarded(async () => {
        const view = await host.call("current", { documentId: args.documentId });
        return json(
          `${view.documentId} is at revision ${view.revision}. Direct agent edits are ${view.policy.agentDirectEdit ? "on" : "off; propose changes instead"}.`,
          view,
        );
      }),
  );

  server.registerTool(
    "document_history",
    {
      title: "Document history",
      description:
        "Every revision (who made it, kind, undo state, change count) and every proposal with its status.",
      inputSchema: { documentId },
      annotations: read,
    },
    (args) =>
      guarded(async () =>
        json("History and proposals:", await host.call("inspect", { documentId: args.documentId })),
      ),
  );

  server.registerTool(
    "read_changes",
    {
      title: "Read changes",
      description:
        'Field-level changes after a revision. Use by: "human" to see a person\'s manual edits since you last read, so a proposal builds on them instead of overwriting them.',
      inputSchema: {
        documentId,
        since: z.number().int().min(0).describe("Revisions after this one."),
        by: z.enum(["human", "agent"]).optional().describe("Only revisions by this kind of actor."),
      },
      annotations: read,
    },
    (args) =>
      guarded(async () => {
        const view = await host.call("changes", {
          documentId: args.documentId,
          since: args.since,
          ...(args.by === undefined ? {} : { by: args.by }),
        });
        return json(
          `${view.deltas.length} revision(s) after ${view.since}; head is ${view.revision}.`,
          view,
        );
      }),
  );

  const content = async (
    id: string,
    args: {
      readonly ops?: ReadonlyArray<unknown> | undefined;
      readonly document?: unknown;
      readonly steer?: unknown;
    },
  ): Promise<Json> => {
    const given = [args.ops, args.document, args.steer].filter((v) => v !== undefined).length;
    if (given !== 1)
      throw new WorkshopError({
        _tag: "InvalidArgument",
        message: "Give exactly one of ops, document and steer.",
      });
    if (args.document !== undefined)
      return { kind: "replace", document: asJson(args.document, "document") };
    if (args.ops !== undefined) return { kind: "ops", ops: asJson(args.ops, "ops") };
    const head = await host.call("current", { documentId: id });
    const generation = head.document?.generation;
    if (!generation)
      throw new WorkshopError({
        _tag: "InvalidArgument",
        message: `${id} was not built by a generator; steer does not apply.`,
      });
    return {
      kind: "ops",
      ops: [
        {
          op: "generation.steer",
          params: mergePatch(generation.params, asJson(args.steer, "steer")),
        },
      ],
    };
  };

  server.registerTool(
    "propose_change",
    {
      title: "Propose a change",
      description:
        "Draft a proposal a person reviews and accepts. Give exactly one of ops, a whole replacement document, or a steer patch. The base may be older than the head; the person sees whether it still rebases.",
      inputSchema: {
        documentId,
        baseRevision,
        proposalId,
        summary: z
          .string()
          .max(500)
          .describe("What the change does and why, for the person reviewing it."),
        ops: ops.optional(),
        document: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("A whole replacement irudd.character document."),
        steer: steer.optional(),
        requestId,
      },
      annotations: write,
    },
    (args) =>
      guarded(async () => {
        const result = await host.call("apply", {
          request: envelope(
            args.documentId,
            args.baseRevision,
            {
              type: "proposal.create",
              proposal: args.proposalId,
              summary: args.summary,
              content: await content(args.documentId, args),
            },
            args.requestId,
          ),
        });
        return applied(result, args.requestId);
      }),
  );

  server.registerTool(
    "refine_proposal",
    {
      title: "Refine a proposal",
      description:
        "Replace a draft proposal's content with a new version, for example rebased onto the current head after a person's edit. version is the draft's current version.",
      inputSchema: {
        documentId,
        baseRevision,
        proposalId,
        version: z
          .number()
          .int()
          .min(1)
          .describe("The proposal's current version, from preview_proposal."),
        summary: z.string().max(500),
        ops: ops.optional(),
        document: z.record(z.string(), z.unknown()).optional(),
        steer: steer.optional(),
        requestId,
      },
      annotations: write,
    },
    (args) =>
      guarded(async () => {
        const result = await host.call("apply", {
          request: envelope(
            args.documentId,
            args.baseRevision,
            {
              type: "proposal.refine",
              proposal: args.proposalId,
              version: args.version,
              summary: args.summary,
              content: await content(args.documentId, args),
            },
            args.requestId,
          ),
        });
        return applied(result, args.requestId);
      }),
  );

  server.registerTool(
    "preview_proposal",
    {
      title: "Preview a proposal",
      description:
        "A proposal's status, its changes against its base, the previewed document, whether it is stale, and how it rebases onto the head.",
      inputSchema: { documentId, proposalId },
      annotations: read,
    },
    (args) =>
      guarded(async () => {
        const view = await host.call("draft", {
          documentId: args.documentId,
          proposalId: args.proposalId,
        });
        if (!view.ok) return json("Cannot preview:", view.diagnostics, true);
        const { preview: _preview, ...rest } = view;
        return json(
          `${view.proposal.id} v${view.proposal.version} is ${view.proposal.status}${view.stale ? `; stale (head moved past base ${view.proposal.baseRevision}), ${view.rebased.ok ? "rebases cleanly" : "does not rebase"}` : ""}.`,
          rest,
        );
      }),
  );

  server.registerTool(
    "withdraw_proposal",
    {
      title: "Withdraw a proposal",
      description: "Discard one of your own draft proposals. The document does not change.",
      inputSchema: { documentId, proposalId, requestId },
      annotations: write,
    },
    (args) =>
      guarded(async () => {
        const head = await host.call("current", { documentId: args.documentId });
        const result = await host.call("apply", {
          request: envelope(
            args.documentId,
            head.revision,
            { type: "proposal.discard", proposal: args.proposalId },
            args.requestId,
          ),
        });
        return applied(result, args.requestId);
      }),
  );

  server.registerTool(
    "edit_document",
    {
      title: "Edit a document directly",
      description:
        "Commit operations as a new revision without review. Only works on documents where a person turned on direct agent edits; otherwise the host answers proposal-required and you should use propose_change.",
      inputSchema: {
        documentId,
        baseRevision,
        ops,
        summary: z.string().max(500).optional(),
        requestId,
      },
      annotations: write,
    },
    (args) =>
      guarded(async () => {
        const result = await host.call("apply", {
          request: envelope(
            args.documentId,
            args.baseRevision,
            {
              type: "edit",
              ops: asJson(args.ops, "ops"),
              ...(args.summary === undefined ? {} : { summary: args.summary }),
            },
            args.requestId,
          ),
        });
        return applied(result, args.requestId);
      }),
  );

  server.registerTool(
    "check_request",
    {
      title: "Check a request",
      description:
        "Whether a request ID committed on a document, without sending it again. Use it after a lost reply or a host restart.",
      inputSchema: { documentId, requestId },
      annotations: read,
    },
    (args) =>
      guarded(async () => {
        const receipt = await host.call("receipt", {
          documentId: args.documentId,
          requestId: args.requestId,
        });
        return receipt === null
          ? text(
              `Request ${args.requestId} has not committed on ${args.documentId}. Sending it again with the same ID is safe.`,
            )
          : json(`Request ${args.requestId} committed ${receipt.command}.`, receipt);
      }),
  );

  const messageId = z
    .string()
    .describe("Steering message ID, like stm-… (26 lowercase letters and digits after stm-).");

  server.registerTool(
    "read_inbox",
    {
      title: "Read steering inbox",
      description:
        "Messages the person sent to you (this pairing) in the conversation they bound you to, oldest first. Each has a document cursor: read_changes with since=cursor.since and by=human shows the manual edits it refers to. Acknowledge each with ack_steering once you have read it.",
      inputSchema: {
        all: z.boolean().optional().describe("Include messages you already acknowledged."),
      },
      annotations: read,
    },
    (args) =>
      guarded(async () => {
        const inbox = await host.call("inbox.read", args.all === true ? { all: true } : {});
        return json(
          inbox.messages.length === 0
            ? `No unacknowledged messages for ${inbox.agent}.`
            : `${inbox.messages.length} message(s) for ${inbox.agent} (pairing ${inbox.pairingId}).`,
          inbox,
        );
      }),
  );

  server.registerTool(
    "ack_steering",
    {
      title: "Acknowledge a steering message",
      description:
        "Tell the person you read a message. Only your own pairing can acknowledge it; repeating it is harmless. Acknowledging moves your manual-change cursor for its document to the revision it was sent at.",
      inputSchema: { messageId },
      annotations: write,
    },
    (args) =>
      guarded(async () => {
        const acked = await host.call("inbox.ack", { messageId: args.messageId });
        return json(`Acknowledged ${acked.messageId}.`, acked);
      }),
  );

  server.registerTool(
    "report_applied",
    {
      title: "Report what you applied",
      description:
        "Link a steering message to the request you committed for it after the message (for example the requestId of your propose_change). The host checks that you committed that request on that document. A proposal leaves the message awaiting the person's review; it is applied only when they accept that version.",
      inputSchema: { messageId, documentId, requestId },
      annotations: write,
    },
    (args) =>
      guarded(async () => {
        const done = await host.call("inbox.applied", {
          messageId: args.messageId,
          documentId: args.documentId,
          requestId: args.requestId,
        });
        return json(
          `Linked ${done.messageId} to request ${args.requestId}: ${done.applied ? `applied in revision ${String(done.applied.revision)}` : done.status === "proposed" ? "awaiting the person's review" : done.status}.`,
          done,
        );
      }),
  );
}
