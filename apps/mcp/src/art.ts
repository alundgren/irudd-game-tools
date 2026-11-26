import fs from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { decodeWith } from "@irudd/document";
import {
  newRequestId,
  readArtFile,
  sniffArtImage,
  uploadArt,
  WorkshopError,
} from "@irudd/workshop/client";
import {
  ArtReply,
  artLimits,
  artReplyFormat,
  traceMapFormat,
  type ArtRequestView,
  type ArtSubmissionView,
} from "@irudd/workshop/wire";
import type { HostConnection } from "./connection.js";

const text = (value: string, isError = false): CallToolResult => ({
  content: [{ type: "text", text: value }],
  ...(isError ? { isError: true } : {}),
});
const json = (summary: string, value: unknown, isError = false): CallToolResult =>
  text(`${summary}\n\n${JSON.stringify(value, null, 2)}`, isError);

async function guarded(body: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof WorkshopError)
      return json(`${error._tag}: ${error.message}`, error.detail, true);
    return text(`Failed: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

const artId = z.string().describe("The art request ID from art_requests, like art-….");

function line(s: ArtSubmissionView): string {
  return `${s.submissionId}: ${s.state}${s.duplicateOf ? ` (duplicate of ${s.duplicateOf})` : ""}${s.proposal ? `, proposal ${s.proposal.id} v${s.proposal.version} ${s.proposal.status}` : ""}${s.source.stale ? `, stale: the person moved the head to ${s.source.headAtSubmit}` : ""}${s.diagnostics.length ? `. ${s.diagnostics.map((d) => d.message).join(" ")}` : ""}`;
}

function summary(r: ArtRequestView): string {
  return `${r.artId}: ${r.brief.kind}${r.brief.intent === "build" ? " (build: each region becomes a new part)" : ""} for ${r.brief.documentId} at revision ${r.brief.revision}, ${r.state}${r.stale ? ` (head ${r.head})` : ""}. ${r.brief.direction}`;
}

function picture(args: {
  imageFile?: string | undefined;
  imageBase64?: string | undefined;
}): Uint8Array {
  if ((args.imageFile === undefined) === (args.imageBase64 === undefined))
    throw new Error("Give exactly one of imageFile and imageBase64.");
  let bytes: Uint8Array;
  if (args.imageFile !== undefined) {
    const file = path.resolve(args.imageFile);
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > artLimits.replyBytes)
      throw new Error(`${file} is not a picture file of at most ${artLimits.replyBytes} bytes.`);
    bytes = new Uint8Array(fs.readFileSync(file));
  } else bytes = new Uint8Array(Buffer.from(args.imageBase64 ?? "", "base64"));
  if (!sniffArtImage(bytes)) throw new Error("The picture is not a PNG, JPEG or WebP.");
  return bytes;
}

export function registerArtTools(server: McpServer, host: HostConnection): void {
  server.registerTool(
    "art_requests",
    {
      title: "Art requests",
      description:
        "The person's open art briefs for you: kind, document, revision, direction, attachments and replies so far. Read one with art_brief.",
      inputSchema: { all: z.boolean().optional().describe("Include cancelled requests.") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) =>
      guarded(async () => {
        const listed = await host.call("art.list", args.all ? { all: true } : {});
        return json(
          listed.requests.length ? listed.requests.map(summary).join("\n") : "No art requests.",
          listed,
        );
      }),
  );

  server.registerTool(
    "art_brief",
    {
      title: "Art brief",
      description: [
        "One art brief with its attached editor views as image content, the capability of this host to apply each kind, and every reply so far.",
        "Make the artwork yourself, in this conversation: the workshop never generates images. If you cannot make this kind of artwork, tell the person; they can import a file.",
      ].join(" "),
      inputSchema: { artId },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) =>
      guarded(async () => {
        const view = await host.call("art.get", { artId: args.artId });
        const client = await host.open();
        const images: CallToolResult["content"] = [];
        for (const a of view.attachments) {
          const { bytes, mediaType } = await readArtFile(client, view.artId, a.digest);
          images.push({
            type: "text",
            text: `Attachment ${a.role}${a.label ? ` (${a.label})` : ""}: ${a.digest}, ${a.width}×${a.height}`,
          });
          images.push({
            type: "image",
            data: Buffer.from(bytes).toString("base64"),
            mimeType: mediaType,
          });
        }
        const reply =
          view.brief.kind === "variation"
            ? "operations: an array of document operations against the brief's revision"
            : view.brief.kind === "trace"
              ? `traceMap: an ${traceMapFormat} object`
              : "imageFile or imageBase64: the picture you generated";
        return {
          content: [
            {
              type: "text",
              text: `${summary(view)}\nReply with art_submit (${reply}).${view.apply.available ? "" : ` This host records but does not apply ${view.brief.kind} replies: ${view.apply.reason ?? ""}`}\n\n${JSON.stringify(view, null, 2)}`,
            },
            ...images,
          ],
        };
      }),
  );

  server.registerTool(
    "art_submit",
    {
      title: "Submit artwork",
      description: [
        `Answer an art brief with an ${artReplyFormat} v1 reply. Turnaround: a square 2x2 sheet (front, profile facing left, rear, profile facing right on #ff00ff). Depth: a front depth image framed like the front view. Trace: an ${traceMapFormat}. Variation: document operations.`,
        "The host checks it, drafts a proposal on the brief's revision and links the steering message; the person accepts, discards or undoes it. Reuse submissionId to retry safely.",
      ].join(" "),
      inputSchema: {
        artId,
        submissionId: z
          .string()
          .optional()
          .describe("Idempotency key, 8–128 characters. Default: a fresh one."),
        summary: z.string().min(1).max(400).describe("What you made."),
        attribution: z
          .object({
            author: z.string().min(1).max(200).optional(),
            credit: z.string().min(1).max(300).optional(),
            license: z.string().min(1).max(120).optional(),
            source: z.string().min(1).max(500).optional(),
          })
          .optional()
          .describe(
            "Who made the picture (author), credit text, licence and source, when you know them. Accepted, they become the character's credit for it and reach exports. Submitting is not authorship: name the maker, such as the image tool you used.",
          ),
        imageFile: z
          .string()
          .optional()
          .describe("Turnaround or depth: absolute path of the PNG, JPEG or WebP you made."),
        imageBase64: z
          .string()
          .optional()
          .describe("Turnaround or depth: the picture as base64, instead of imageFile."),
        height: z
          .number()
          .min(0.15)
          .max(6)
          .optional()
          .describe("Turnaround: standing height in metres."),
        coverage: z.enum(["open", "closed"]).optional().describe("Turnaround of a wearable."),
        traceMap: z.unknown().optional().describe(`Trace: the ${traceMapFormat} object.`),
        operations: z.array(z.unknown()).optional().describe("Variation: document operations."),
      },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    (args) =>
      guarded(async () => {
        const view = await host.call("art.get", { artId: args.artId });
        const header = {
          format: artReplyFormat,
          version: 1,
          summary: args.summary,
          ...(args.attribution ? { attribution: args.attribution } : {}),
        };
        const kind = view.brief.kind;
        let reply: unknown;
        if (kind === "turnaround" || kind === "depth") {
          const stored = await uploadArt(await host.open(), picture(args));
          reply =
            kind === "depth"
              ? { ...header, kind, image: stored.digest }
              : {
                  ...header,
                  kind,
                  image: stored.digest,
                  ...(args.height === undefined ? {} : { height: args.height }),
                  ...(args.coverage === undefined ? {} : { coverage: args.coverage }),
                };
        } else if (kind === "trace") reply = { ...header, kind, traceMap: args.traceMap };
        else reply = { ...header, kind, operations: args.operations };
        const checked = decodeWith(ArtReply, reply);
        if (!checked.ok)
          return json(
            `The reply does not fit ${artReplyFormat} v1 for ${kind}.`,
            checked.diagnostics,
            true,
          );
        const result = await host.call("art.submit", {
          artId: args.artId,
          submissionId: args.submissionId ?? newRequestId("mcp-art"),
          reply: checked.value,
        });
        return json(
          `${result.outcome === "replayed" ? "Replayed" : "Submitted"} ${line(result.submission)}`,
          result,
          result.submission.state === "rejected",
        );
      }),
  );

  server.registerTool(
    "art_capabilities",
    {
      title: "Art capabilities",
      description:
        "Which art kinds this host turns into proposals, why the others are only recorded, and the limits on pictures. You produce the artwork; the host never does.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () =>
      guarded(async () => {
        const caps = await host.call("art.capabilities", {});
        return json(
          caps.kinds
            .flatMap((k) => [
              `${k.kind}: ${k.apply.available ? "proposed" : `recorded only (${k.apply.reason ?? ""})`}`,
              ...(k.intents ?? []).map(
                (i) =>
                  `${k.kind} ${i.intent}: ${i.apply.available ? "proposed" : `recorded only (${i.apply.reason ?? ""})`}`,
              ),
            ])
            .join("\n"),
          caps,
        );
      }),
  );
}
