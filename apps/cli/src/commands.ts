import fs from "node:fs";
import { isJson, isJsonArray, type Json } from "@irudd/document";
import {
  assignmentsPatch,
  connect,
  envelope,
  mergePatch,
  newRequestId,
  readEndpoint,
  type WorkshopClient,
} from "@irudd/workshop/client";
import type { ApplyResult } from "@irudd/workshop/contract";
import * as format from "./format.js";

export class UsageError extends Error {}

export const exit = { ok: 0, failed: 1, usage: 2, unavailable: 3, rejected: 4, error: 5 } as const;

export type OptionSpec = {
  readonly type: "string" | "boolean";
  readonly multiple?: boolean;
  readonly short?: string;
};

export interface Context {
  readonly project: string;
  readonly credential: string | undefined;
  readonly json: boolean;
  readonly positionals: ReadonlyArray<string>;
  readonly options: Readonly<Record<string, string | boolean | ReadonlyArray<string> | undefined>>;
  readonly out: (text: string) => void;
  readonly stateDir: string | undefined;
}

export interface Verb {
  readonly name: string;
  readonly args: string;
  readonly summary: string;
  readonly details?: string;
  readonly options: Readonly<
    Record<string, OptionSpec & { readonly help: string; readonly value?: string }>
  >;
  readonly run: (context: Context) => Promise<number>;
}

export const requestOption = {
  "request-id": {
    type: "string",
    value: "id",
    help: "Idempotency key (8–128 characters). Reuse it to retry safely; default: a fresh one.",
  },
} as const;
export const baseOption = {
  base: {
    type: "string",
    value: "rev|head",
    help: "The revision you prepared this change against, or head to use the current one.",
  },
} as const;

export async function client(context: Context): Promise<WorkshopClient> {
  return connect({
    credential:
      context.credential === undefined
        ? { role: "human", project: context.project }
        : { role: "agent", file: context.credential },
    client: { name: "irudd-cli", version: "1" },
    ...(context.stateDir === undefined ? {} : { stateDir: context.stateDir }),
  });
}

export async function withClient(
  context: Context,
  body: (c: WorkshopClient) => Promise<number>,
): Promise<number> {
  const c = await client(context);
  try {
    return await body(c);
  } finally {
    c.close();
  }
}

export function positional(context: Context, index: number, name: string): string {
  const value = context.positionals[index];
  if (value === undefined) throw new UsageError(`Missing <${name}>.`);
  return value;
}

export function text(context: Context, name: string): string | undefined {
  const value = context.options[name];
  return typeof value === "string" ? value : undefined;
}

export function list(context: Context, name: string): ReadonlyArray<string> {
  const value = context.options[name];
  if (value === undefined || typeof value === "boolean") return [];
  return typeof value === "string" ? [value] : value;
}

export function integer(value: string, name: string): number {
  if (!/^\d+$/.test(value)) throw new UsageError(`${name} is a whole number, not ${value}.`);
  return Number(value);
}

export async function base(
  context: Context,
  c: WorkshopClient,
  documentId: string,
): Promise<number> {
  const value = text(context, "base");
  if (value === undefined)
    throw new UsageError(
      `--base is required: the revision you prepared this change against (see "irudd show ${documentId}"), or "head".`,
    );
  if (value === "head") return (await c.call("current", { documentId })).revision;
  return integer(value, "--base");
}

export function requestId(context: Context): string {
  return text(context, "request-id") ?? newRequestId("cli");
}

export function parseJson(raw: string, what: string): Json {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new UsageError(
      `${what} is not JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isJson(value)) throw new UsageError(`${what} must be plain JSON.`);
  return value;
}

export function readJson(file: string, what: string): Json {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    throw new UsageError(`Cannot read ${what} ${file}.`);
  }
  return parseJson(raw, `${what} ${file}`);
}

export function show(context: Context, value: unknown, rendered: () => string): void {
  context.out(context.json ? JSON.stringify(value, null, 2) : rendered());
}

export async function submit(
  context: Context,
  c: WorkshopClient,
  documentId: string,
  expected: number,
  command: Record<string, Json>,
): Promise<number> {
  const id = requestId(context);
  const result = await c.call("apply", { request: envelope(documentId, expected, command, id) });
  return reportApply(context, result, documentId, id);
}

function reportApply(
  context: Context,
  result: ApplyResult,
  documentId: string,
  id: string,
): number {
  show(context, { requestId: id, ...result }, () => format.applied(result, documentId, id));
  return result.kind === "rejected" ? exit.rejected : exit.ok;
}

async function proposalVersion(
  c: WorkshopClient,
  documentId: string,
  proposal: string,
): Promise<number> {
  const view = await c.call("inspect", { documentId });
  const found = view.proposals.find((p) => p.id === proposal);
  if (!found)
    throw new UsageError(
      `${documentId} has no proposal ${proposal}. See "irudd proposals ${documentId}".`,
    );
  return found.version;
}

export const verbs: ReadonlyArray<Verb> = [
  {
    name: "status",
    args: "",
    summary: "Show the host that owns the project and who you are",
    options: {},
    run: async (context) => {
      const endpoint = readEndpoint(
        context.project,
        context.stateDir === undefined ? {} : { stateDir: context.stateDir },
      );
      return withClient(context, async (c) => {
        const info = await c.call("project.info", {});
        const docs = await c.call("documents", {});
        const pairs = c.welcome.role === "human" ? await c.call("pair.list", {}) : [];
        show(context, { info, you: c.welcome.actor, documents: docs.length, pairings: pairs }, () =>
          [
            `Project "${info.label}" (${info.projectId})`,
            `  directory ${info.directory}`,
            `  host      ${info.host.kind}, pid ${info.host.pid}, started ${new Date(info.host.startedAt).toISOString()}`,
            `  endpoint  ${endpoint.address}`,
            `  sqlite    ${info.sqliteVersion}`,
            `You are ${c.welcome.actor.kind} ${c.welcome.actor.id}. ${docs.length} document(s), ${pairs.length} paired agent(s).`,
          ].join("\n"),
        );
        return exit.ok;
      });
    },
  },
  {
    name: "starters",
    args: "",
    summary: "List the starting forms this host's registry provides",
    options: {},
    run: (context) =>
      withClient(context, async (c) => {
        const view = await c.call("starters", {});
        show(context, view, () => format.starters(view));
        return exit.ok;
      }),
  },
  {
    name: "list",
    args: "",
    summary: "List documents in the project",
    options: {},
    run: (context) =>
      withClient(context, async (c) => {
        const docs = await c.call("documents", {});
        show(context, docs, () => format.documents(docs));
        return exit.ok;
      }),
  },
  {
    name: "new",
    args: "<doc-id>",
    summary: "Create a document from a starter (preset or seed) or a prepared form",
    details:
      "Document IDs look like doc-marsh01. Without options this uses the frame-creature starter's default preset.",
    options: {
      starter: {
        type: "string",
        value: "id",
        help: 'Starter from "irudd starters" (default frame-creature).',
      },
      preset: {
        type: "string",
        value: "id",
        help: "A named preset of the starter (default: default).",
      },
      seed: {
        type: "string",
        value: "n",
        help: "Derive parameters from a seed instead of a preset.",
      },
      params: { type: "string", value: "json", help: "Explicit generator parameters as JSON." },
      from: {
        type: "string",
        value: "file",
        help: "Create from a complete irudd.character JSON form.",
      },
      label: { type: "string", value: "text", help: "Document label." },
      ...requestOption,
    },
    run: (context) =>
      withClient(context, async (c) => {
        const documentId = positional(context, 0, "doc-id");
        const id = requestId(context);
        const from = text(context, "from");
        if (from !== undefined) {
          const form = readJson(from, "form");
          const named: Json =
            typeof form === "object" && form !== null && !Array.isArray(form)
              ? mergePatch(form, {
                  id: documentId,
                  ...(text(context, "label") ? { label: text(context, "label") ?? null } : {}),
                })
              : form;
          const result = await c.call("apply", {
            request: envelope(documentId, 0, { type: "document.create", document: named }, id),
          });
          return reportApply(context, result, documentId, id);
        }
        const seed = text(context, "seed");
        const params = text(context, "params");
        const preset = text(context, "preset");
        const label = text(context, "label");
        const started = await c.call("start", {
          documentId,
          requestId: id,
          starter: text(context, "starter") ?? "frame-creature",
          ...(preset === undefined ? {} : { preset }),
          ...(seed === undefined ? {} : { seed: integer(seed, "--seed") }),
          ...(params === undefined ? {} : { params: parseJson(params, "--params") }),
          ...(label === undefined ? {} : { label }),
        });
        const code = reportApply(context, started.result, documentId, id);
        if (!context.json && started.result.kind !== "rejected")
          context.out(
            `From ${started.starter} (${started.generator ? `${started.generator.id}@${started.generator.version}` : "prepared form"})${started.preset ? `, preset ${started.preset}` : ""}${started.seed === null ? "" : `, seed ${started.seed}`}.`,
          );
        return code;
      }),
  },
  {
    name: "show",
    args: "<doc-id>",
    summary: "Show a document's head: revision, digest, access, policy and parts",
    options: {},
    run: (context) =>
      withClient(context, async (c) => {
        const view = await c.call("current", { documentId: positional(context, 0, "doc-id") });
        show(context, view, () => format.current(view));
        return exit.ok;
      }),
  },
  {
    name: "history",
    args: "<doc-id>",
    summary: "Show revisions (who, what kind, undo state) and proposals",
    options: {},
    run: (context) =>
      withClient(context, async (c) => {
        const view = await c.call("inspect", { documentId: positional(context, 0, "doc-id") });
        show(context, view, () => format.inspect(view));
        return exit.ok;
      }),
  },
  {
    name: "changes",
    args: "<doc-id>",
    summary: "Field changes after a revision, optionally only a person's or agents' edits",
    options: {
      since: { type: "string", value: "rev", help: "Revisions after this one (default 0)." },
      by: { type: "string", value: "human|agent", help: "Only revisions by this kind of actor." },
    },
    run: (context) =>
      withClient(context, async (c) => {
        const by = text(context, "by");
        if (by !== undefined && by !== "human" && by !== "agent")
          throw new UsageError("--by is human or agent.");
        const view = await c.call("changes", {
          documentId: positional(context, 0, "doc-id"),
          since: integer(text(context, "since") ?? "0", "--since"),
          ...(by === undefined ? {} : { by }),
        });
        show(context, view, () => format.changes(view));
        return exit.ok;
      }),
  },
  {
    name: "diff",
    args: "<doc-id> <from> <to>",
    summary: "Net field changes between two revisions",
    options: {},
    run: (context) =>
      withClient(context, async (c) => {
        const view = await c.call("diff", {
          documentId: positional(context, 0, "doc-id"),
          from: integer(positional(context, 1, "from"), "<from>"),
          to: integer(positional(context, 2, "to"), "<to>"),
        });
        show(context, view, () =>
          view.ok
            ? view.changes.map((ch) => JSON.stringify(ch)).join("\n") || "No changes."
            : format.diagnostics(view.diagnostics),
        );
        return view.ok ? exit.ok : exit.rejected;
      }),
  },
  {
    name: "edit",
    args: "<doc-id>",
    summary: "Commit a direct edit: one or more document operations",
    details:
      'Example: irudd edit doc-marsh01 --base 1 --op \'{"op":"part.rename","part":"p-head","label":"Skull"}\'',
    options: {
      ...baseOption,
      op: {
        type: "string",
        multiple: true,
        value: "json",
        help: "One operation as JSON. Repeat for several.",
      },
      "ops-file": { type: "string", value: "file", help: "A JSON array of operations." },
      summary: { type: "string", value: "text", help: "What the edit does." },
      ...requestOption,
    },
    run: (context) =>
      withClient(context, async (c) => {
        const documentId = positional(context, 0, "doc-id");
        const file = text(context, "ops-file");
        const ops: Json[] = list(context, "op").map((raw, i) => parseJson(raw, `--op ${i + 1}`));
        if (file !== undefined) {
          const fromFile = readJson(file, "operations file");
          if (!isJsonArray(fromFile))
            throw new UsageError(`${file} must hold a JSON array of operations.`);
          ops.push(...fromFile);
        }
        if (ops.length === 0) throw new UsageError("Give at least one --op or --ops-file.");
        const summary = text(context, "summary");
        return submit(context, c, documentId, await base(context, c, documentId), {
          type: "edit",
          ops,
          ...(summary === undefined ? {} : { summary }),
        });
      }),
  },
  {
    name: "rename",
    args: "<doc-id> <part-id> <label>",
    summary: "Rename a part (a direct edit)",
    options: { ...baseOption, ...requestOption },
    run: (context) =>
      withClient(context, async (c) => {
        const documentId = positional(context, 0, "doc-id");
        return submit(context, c, documentId, await base(context, c, documentId), {
          type: "edit",
          ops: [
            {
              op: "part.rename",
              part: positional(context, 1, "part-id"),
              label: positional(context, 2, "label"),
            },
          ],
        });
      }),
  },
  {
    name: "steer",
    args: "<doc-id>",
    summary: "Re-run the generator with some parameters changed, keeping manual edits",
    details:
      "Example: irudd steer doc-marsh01 --base head --set tail.length=1.2 --set legs.pairs=3",
    options: {
      ...baseOption,
      set: {
        type: "string",
        multiple: true,
        value: "key=value",
        help: "A parameter to change. Repeat for several.",
      },
      ...requestOption,
    },
    run: (context) =>
      withClient(context, async (c) => {
        const documentId = positional(context, 0, "doc-id");
        const sets = list(context, "set");
        if (sets.length === 0) throw new UsageError("Give at least one --set key.path=value.");
        const expected = await base(context, c, documentId);
        const head = await c.call("current", { documentId });
        const generation = head.document?.generation;
        if (!generation) throw new UsageError(`${documentId} was not built by a generator.`);
        let patch: Json;
        try {
          patch = assignmentsPatch(sets);
        } catch (error) {
          throw new UsageError(error instanceof Error ? error.message : String(error));
        }
        return submit(context, c, documentId, expected, {
          type: "edit",
          ops: [{ op: "generation.steer", params: mergePatch(generation.params, patch) }],
          summary: `Steer ${sets.join(", ")}`.slice(0, 500),
        });
      }),
  },
  {
    name: "upgrade",
    args: "<doc-id>",
    summary: "Upgrade an older character to this build's feature versions in one revision",
    options: { ...baseOption, ...requestOption },
    run: (context) =>
      withClient(context, async (c) => {
        const documentId = positional(context, 0, "doc-id");
        return submit(context, c, documentId, await base(context, c, documentId), {
          type: "document.upgrade",
        });
      }),
  },
  {
    name: "undo",
    args: "<doc-id> <revision>",
    summary: "Append a revision that reverses an earlier one, keeping later edits",
    options: { ...baseOption, ...requestOption },
    run: (context) =>
      withClient(context, async (c) => {
        const documentId = positional(context, 0, "doc-id");
        return submit(context, c, documentId, await base(context, c, documentId), {
          type: "undo",
          target: integer(positional(context, 1, "revision"), "<revision>"),
        });
      }),
  },
  {
    name: "proposals",
    args: "<doc-id>",
    summary: "List proposals and their status",
    options: {},
    run: (context) =>
      withClient(context, async (c) => {
        const view = await c.call("inspect", { documentId: positional(context, 0, "doc-id") });
        show(context, view.proposals, () => format.proposals(view));
        return exit.ok;
      }),
  },
  {
    name: "preview",
    args: "<doc-id> <proposal-id>",
    summary: "Preview a proposal: its changes, whether it is stale, and how it rebases",
    options: {},
    run: (context) =>
      withClient(context, async (c) => {
        const documentId = positional(context, 0, "doc-id");
        const view = await c.call("draft", {
          documentId,
          proposalId: positional(context, 1, "proposal-id"),
        });
        show(context, view, () => format.draft(view, documentId));
        return view.ok ? exit.ok : exit.rejected;
      }),
  },
  {
    name: "accept",
    args: "<doc-id> <proposal-id>",
    summary: "Accept a proposal as a new revision",
    options: {
      ...baseOption,
      version: {
        type: "string",
        value: "n",
        help: "The proposal version you reviewed (default: its current version).",
      },
      ...requestOption,
    },
    run: (context) =>
      withClient(context, async (c) => {
        const documentId = positional(context, 0, "doc-id");
        const proposal = positional(context, 1, "proposal-id");
        const expected = await base(context, c, documentId);
        const versionText = text(context, "version");
        const version =
          versionText === undefined
            ? await proposalVersion(c, documentId, proposal)
            : integer(versionText, "--version");
        return submit(context, c, documentId, expected, {
          type: "proposal.accept",
          proposal,
          version,
        });
      }),
  },
  {
    name: "reject",
    args: "<doc-id> <proposal-id>",
    summary: "Discard a proposal; the document does not change",
    options: { ...baseOption, ...requestOption },
    run: (context) =>
      withClient(context, async (c) => {
        const documentId = positional(context, 0, "doc-id");
        const expected =
          text(context, "base") === undefined
            ? (await c.call("current", { documentId })).revision
            : await base(context, c, documentId);
        return submit(context, c, documentId, expected, {
          type: "proposal.discard",
          proposal: positional(context, 1, "proposal-id"),
        });
      }),
  },
  {
    name: "policy",
    args: "<doc-id>",
    summary: "Allow or forbid agents to edit this document without a proposal",
    options: {
      ...baseOption,
      "agent-direct-edit": {
        type: "string",
        value: "on|off",
        help: "on lets paired agents edit directly.",
      },
      ...requestOption,
    },
    run: (context) =>
      withClient(context, async (c) => {
        const documentId = positional(context, 0, "doc-id");
        const value = text(context, "agent-direct-edit");
        if (value !== "on" && value !== "off")
          throw new UsageError("--agent-direct-edit is on or off.");
        return submit(context, c, documentId, await base(context, c, documentId), {
          type: "policy.set",
          agentDirectEdit: value === "on",
        });
      }),
  },
  {
    name: "receipt",
    args: "<doc-id> <request-id>",
    summary: "Check whether a request committed, without sending it again",
    options: {},
    run: (context) =>
      withClient(context, async (c) => {
        const documentId = positional(context, 0, "doc-id");
        const requestIdValue = positional(context, 1, "request-id");
        const receipt = await c.call("receipt", { documentId, requestId: requestIdValue });
        show(context, receipt, () =>
          receipt === null
            ? `Request ${requestIdValue} has not committed on ${documentId}. It is safe to send it again with the same ID.`
            : `Request ${requestIdValue} committed ${receipt.command}; head revision ${receipt.revision} afterwards.`,
        );
        return receipt === null ? exit.rejected : exit.ok;
      }),
  },
  {
    name: "pair",
    args: "<agent-id>",
    summary: "Pair an MCP agent with this project and print its server command",
    details:
      "The credential binds the agent's identity: the host stamps it on everything the agent does. Pairing again rotates the credential.",
    options: { name: { type: "string", value: "text", help: "Display name, e.g. Claude." } },
    run: (context) =>
      withClient(context, async (c) => {
        const agent = positional(context, 0, "agent-id");
        const name = text(context, "name");
        const paired = await c.call("pair.agent", {
          agent,
          ...(name === undefined ? {} : { name }),
        });
        show(context, paired, () =>
          [
            `Paired agent ${paired.agent} with ${context.project}.`,
            `Credential (private to this account): ${paired.credentialFile}`,
            "",
            "Configure the agent's MCP server as a stdio command:",
            `  irudd mcp --credential "${paired.credentialFile}"`,
            "For example, in Claude Code:",
            `  claude mcp add irudd-workshop -- irudd mcp --credential "${paired.credentialFile}"`,
            `Revoke it with "irudd unpair ${paired.agent}".`,
          ].join("\n"),
        );
        return exit.ok;
      }),
  },
  {
    name: "pairs",
    args: "",
    summary: "List paired agents",
    options: {},
    run: (context) =>
      withClient(context, async (c) => {
        const pairs = await c.call("pair.list", {});
        show(context, pairs, () => format.pairings(pairs));
        return exit.ok;
      }),
  },
  {
    name: "unpair",
    args: "<agent-id>",
    summary: "Revoke an agent's credential; its next connection is refused",
    options: {},
    run: (context) =>
      withClient(context, async (c) => {
        const result = await c.call("pair.revoke", { agent: positional(context, 0, "agent-id") });
        show(context, result, () =>
          result.revoked ? `Revoked ${result.agent}.` : `${result.agent} was not paired.`,
        );
        return exit.ok;
      }),
  },
  {
    name: "watch",
    args: "[doc-id]",
    summary: "Print commits and steering changes as they happen, until Ctrl+C",
    options: {},
    run: async (context) => {
      const c = await client(context);
      const only = context.positionals[0];
      await c.call("subscribe", {});
      c.onEvent((event) => {
        if (event.event === "steer") {
          if (only === undefined)
            context.out(
              context.json
                ? JSON.stringify(event)
                : `steer ${event.messageId} to ${event.agent}: ${event.status}`,
            );
          return;
        }
        if (event.event !== "commit") return;
        if (only !== undefined && event.documentId !== only) return;
        context.out(
          context.json
            ? JSON.stringify(event)
            : `${event.documentId} r${event.revision} ${event.command} by ${event.actor.kind} ${event.actor.id}`,
        );
      });
      if (!context.json) context.out(`Watching ${only ?? "all documents"}. Press Ctrl+C to stop.`);
      await c.closed;
      return exit.unavailable;
    },
  },
  {
    name: "verify",
    args: "",
    summary: "Check SQLite, every journal and every blob of the open project",
    options: {},
    run: (context) =>
      withClient(context, async (c) => {
        const report = await c.call("verify", {});
        show(context, report, () =>
          [
            `${report.ok ? "OK" : "PROBLEMS FOUND"}: sqlite ${report.sqlite}, ${report.documents.length} document(s), ${report.blobs.count} blob(s)`,
            ...report.documents
              .filter((d) => !d.ok)
              .map(
                (d) =>
                  `  ${d.documentId} entry ${d.index ?? "?"}:\n${format.diagnostics(d.diagnostics)}`,
              ),
            ...report.blobs.damaged.map((d) => `  damaged blob ${d}`),
            ...report.blobs.missing.map(
              (m) => `  ${m.documentId} r${m.revision} misses blob ${m.digest}`,
            ),
          ].join("\n"),
        );
        return report.ok ? exit.ok : exit.rejected;
      }),
  },
];
