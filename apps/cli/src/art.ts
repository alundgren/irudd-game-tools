import fs from "node:fs";
import path from "node:path";
import { decodeWith, isJsonArray, type Json } from "@irudd/document";
import {
  artExtension,
  newRequestId,
  readArtFile,
  sniffArtImage,
  uploadArt,
  type WorkshopClient,
} from "@irudd/workshop/client";
import {
  ArtReply,
  artKinds,
  artReplyFormat,
  attachmentRoles,
  traceIntents,
  type ArtKind,
  type ArtRequestView,
  type ArtSubmissionView,
  type AttachmentRole,
} from "@irudd/workshop/wire";
import {
  exit,
  integer,
  list,
  positional,
  readJson,
  show,
  text,
  UsageError,
  withClient,
  type Context,
  type Verb,
} from "./commands.js";

const subcommands = ["capabilities", "request", "list", "show", "submit", "cancel"] as const;

function kind(context: Context): ArtKind {
  const value = text(context, "kind");
  const found = artKinds.find((k) => k === value);
  if (!found) throw new UsageError(`--kind is one of ${artKinds.join(", ")}.`);
  return found;
}

function intent(context: Context, k: ArtKind): { readonly intent?: "build" } {
  const value = text(context, "intent");
  if (value === undefined) return {};
  if (!traceIntents.some((i) => i === value))
    throw new UsageError(`--intent is one of ${traceIntents.join(", ")}.`);
  if (k !== "trace") throw new UsageError("--intent is for a trace brief.");
  return value === "build" ? { intent: "build" } : {};
}

function readPicture(file: string): {
  bytes: Uint8Array;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
} {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(fs.readFileSync(path.resolve(file)));
  } catch {
    throw new UsageError(`Cannot read the picture ${file}.`);
  }
  const mediaType = sniffArtImage(bytes);
  if (!mediaType) throw new UsageError(`${file} is not a PNG, JPEG or WebP picture.`);
  return { bytes, mediaType };
}

function attachments(
  context: Context,
): Array<{ role: AttachmentRole; file: string; label?: string }> {
  return list(context, "attach").map((raw) => {
    const at = raw.indexOf("=");
    const role = attachmentRoles.find((r) => r === raw.slice(0, at));
    if (at <= 0 || !role)
      throw new UsageError(
        `--attach is role=file with a role from ${attachmentRoles.join(", ")}, not ${raw}.`,
      );
    return { role, file: raw.slice(at + 1), label: path.basename(raw.slice(at + 1)).slice(0, 120) };
  });
}

function describeSubmission(s: ArtSubmissionView): string {
  const files = s.files.map((f) => `${f.digest} ${f.width}×${f.height} ${f.mediaType}`).join(", ");
  return [
    `  ${s.submissionId} by ${s.by.name ?? s.by.id} (${s.via}): ${s.state}${s.duplicateOf ? ` (duplicate of ${s.duplicateOf})` : ""}, "${s.reply.summary}"`,
    ...(files ? [`    files: ${files}`] : []),
    ...(s.reply.attribution
      ? [
          `    stated: ${Object.entries(s.reply.attribution)
            .map(([k, v]) => `${k} "${v}"`)
            .join(", ")}`,
        ]
      : []),
    ...(s.proposal
      ? [
          `    proposal ${s.proposal.id} v${s.proposal.version} on revision ${s.proposal.baseRevision}: ${s.proposal.status}${s.proposal.acceptedRevision ? ` in revision ${s.proposal.acceptedRevision}` : ""}${s.source.stale ? ` (stale: the head was ${s.source.headAtSubmit})` : ""}`,
        ]
      : []),
    ...s.diagnostics.map((d) => `    ${d.code} at ${d.path.join(".")}: ${d.message}`),
  ].join("\n");
}

function describe(r: ArtRequestView): string {
  return [
    `${r.artId} ${r.brief.kind}${r.brief.intent === "build" ? " (build)" : ""} for ${r.brief.documentId} at revision ${r.brief.revision} → ${r.agent}: ${r.state}${r.stale ? ` (head ${r.head})` : ""}`,
    `  message ${r.messageId}: ${r.steering?.status ?? "unknown"}`,
    `  apply: ${r.apply.available ? `yes, by ${r.apply.translator ?? ""}` : `no. ${r.apply.reason ?? ""}`}`,
    `  direction: ${r.brief.direction}`,
    ...r.attachments.map(
      (a, i) =>
        `  attachment ${i + 1} ${a.role}: ${a.digest} ${a.width}×${a.height} ${a.mediaType}`,
    ),
    ...(r.brief.parts?.length ? [`  parts: ${r.brief.parts.join(", ")}`] : []),
    ...(r.closed ? [`  closed: ${r.closed.detail}`] : []),
    ...(r.submissions.length ? ["  submissions:", ...r.submissions.map(describeSubmission)] : []),
  ].join("\n");
}

async function save(c: WorkshopClient, r: ArtRequestView, dir: string): Promise<string[]> {
  fs.mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  const write = (name: string, bytes: Uint8Array | string) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, bytes);
    written.push(file);
  };
  write("brief.json", JSON.stringify(r.brief, null, 2) + "\n");
  write("request.json", JSON.stringify(r, null, 2) + "\n");
  for (const [i, a] of r.attachments.entries()) {
    const { bytes } = await readArtFile(c, r.artId, a.digest);
    write(`attachment-${i + 1}-${a.role}.${artExtension(a.mediaType)}`, bytes);
  }
  for (const s of r.submissions) {
    write(`reply-${s.seq}.json`, JSON.stringify(s.reply, null, 2) + "\n");
    for (const f of s.files) {
      const { bytes } = await readArtFile(c, r.artId, f.digest);
      write(`reply-${s.seq}.${artExtension(f.mediaType)}`, bytes);
    }
  }
  return written;
}

async function request(context: Context, c: WorkshopClient): Promise<number> {
  const documentId = positional(context, 1, "document");
  const agent = text(context, "agent");
  if (!agent)
    throw new UsageError(
      "--agent is required: the paired agent whose conversation gets the brief.",
    );
  const direction = text(context, "direction");
  if (!direction) throw new UsageError("--direction is required.");
  const rev = text(context, "revision") ?? "head";
  const revision =
    rev === "head"
      ? (await c.call("current", { documentId })).revision
      : integer(rev, "--revision");
  const staged = [];
  for (const a of attachments(context)) {
    const picture = readPicture(a.file);
    const stored = await uploadArt(c, picture.bytes, picture.mediaType);
    staged.push({ role: a.role, digest: stored.digest, ...(a.label ? { label: a.label } : {}) });
  }
  const height = text(context, "height");
  const parts = list(context, "part");
  const protectedRegions = list(context, "protect");
  const k = kind(context);
  const view = await c.call("art.request", {
    agent,
    requestId: text(context, "request-id") ?? newRequestId("art"),
    brief: {
      format: "irudd.art-brief",
      version: 1,
      kind: k,
      documentId,
      revision,
      direction,
      attachments: staged,
      ...(parts.length ? { parts } : {}),
      ...(height === undefined ? {} : { height: Number(height) }),
      ...(protectedRegions.length ? { protected: protectedRegions } : {}),
      ...intent(context, k),
    },
  });
  show(context, view, () => describe(view));
  return exit.ok;
}

async function submit(context: Context, c: WorkshopClient): Promise<number> {
  const artId = positional(context, 1, "art-id");
  const summary = text(context, "summary");
  if (!summary) throw new UsageError("--summary is required: what the reply is.");
  const view = await c.call("art.get", { artId });
  const k = view.brief.kind;
  const image = text(context, "image");
  const traceMap = text(context, "trace-map");
  const ops = text(context, "ops");
  const attribution = Object.fromEntries(
    (["author", "credit", "license", "source"] as const).flatMap((key) => {
      const value = text(context, key);
      return value === undefined ? [] : [[key, value]];
    }),
  );
  const header = {
    format: "irudd.art-reply",
    version: 1,
    summary,
    ...(Object.keys(attribution).length ? { attribution } : {}),
  } as const;
  let reply;
  if (k === "turnaround" || k === "depth") {
    if (!image) throw new UsageError(`A ${k} reply is a picture: give --image <file>.`);
    const picture = readPicture(image);
    const stored = await uploadArt(c, picture.bytes, picture.mediaType);
    const height = text(context, "height");
    const coverage = text(context, "coverage");
    if (coverage !== undefined && coverage !== "open" && coverage !== "closed")
      throw new UsageError("--coverage is open or closed.");
    reply =
      k === "depth"
        ? { ...header, kind: k, image: stored.digest }
        : {
            ...header,
            kind: k,
            image: stored.digest,
            ...(height === undefined ? {} : { height: Number(height) }),
            ...(coverage === undefined ? {} : { coverage }),
          };
  } else if (k === "trace") {
    if (!traceMap)
      throw new UsageError("A trace reply is an irudd.trace-map.v1: give --trace-map <file.json>.");
    reply = { ...header, kind: k, traceMap: readJson(path.resolve(traceMap), "trace map") };
  } else {
    if (!ops)
      throw new UsageError("A variation reply is document operations: give --ops <file.json>.");
    const operations: Json = readJson(path.resolve(ops), "operations");
    if (!isJsonArray(operations)) throw new UsageError("--ops holds a JSON array of operations.");
    reply = { ...header, kind: k, operations };
  }
  const checked = decodeWith(ArtReply, reply);
  if (!checked.ok)
    throw new UsageError(
      `The reply does not fit ${artReplyFormat} v1: ${checked.diagnostics.map((d) => `${d.path.join(".")}: ${d.message}`).join(" ")}`,
    );
  const result = await c.call("art.submit", {
    artId,
    submissionId: text(context, "submission-id") ?? newRequestId("art-reply"),
    reply: checked.value,
  });
  show(context, result, () =>
    [
      `${result.outcome === "replayed" ? "Replayed" : "Submitted"} ${result.submission.submissionId}: ${result.submission.state}.`,
      describeSubmission(result.submission),
    ].join("\n"),
  );
  return result.submission.state === "rejected" ? exit.rejected : exit.ok;
}

export const artVerbs: ReadonlyArray<Verb> = [
  {
    name: "art",
    args: `<${subcommands.join("|")}> [<document|art-id>]`,
    summary: "Ask the paired agent for artwork with a typed brief, and review or answer it",
    details: [
      "art request <doc> sends an irudd.art-brief to the agent's bound conversation, with pictures from --attach role=file (roles: " +
        attachmentRoles.join(", ") +
        "). The host makes no artwork: the paired agent answers with its own tools.",
      "art show <art-id> --out <dir> saves the brief, its pictures and every reply with their digests.",
      "art submit <art-id> answers a brief. With --credential it is the agent's reply; without, the person imports a file the agent could not make. Retrying with the same --submission-id is safe.",
      "A valid reply becomes a proposal on the brief's revision: review it with proposals, preview, accept, reject and undo.",
      "--author, --credit, --license and --source state who made the picture and its rights. Accepted, they are the character's credit for it and reach exports; submitting is not authorship, so state the maker when you know it.",
    ].join("\n"),
    options: {
      agent: { type: "string", value: "id", help: "request: the paired agent." },
      kind: { type: "string", value: artKinds.join("|"), help: "request: what to make." },
      direction: { type: "string", value: "text", help: "request: the art direction." },
      attach: {
        type: "string",
        multiple: true,
        value: "role=file",
        help: "request: a picture to attach (PNG, JPEG or WebP). Repeat for more.",
      },
      part: {
        type: "string",
        multiple: true,
        value: "p-…",
        help: "request: a part (turnaround: a painted region to repaint).",
      },
      intent: {
        type: "string",
        value: traceIntents.join("|"),
        help: "request (trace): fit the --part (default) or build the map's regions as new parts on its sheet.",
      },
      protect: {
        type: "string",
        multiple: true,
        value: "region",
        help: "request (trace): a region to keep.",
      },
      revision: {
        type: "string",
        value: "rev|head",
        help: "request: the revision the views show (default head).",
      },
      height: { type: "string", value: "m", help: "request or submit: standing height in metres." },
      "request-id": { type: "string", value: "id", help: "request: idempotency key." },
      doc: { type: "string", value: "doc", help: "list: only this document." },
      all: { type: "boolean", help: "list: include cancelled requests." },
      out: {
        type: "string",
        value: "dir",
        help: "show: save the brief, pictures and replies here.",
      },
      summary: { type: "string", value: "text", help: "submit: what the reply is." },
      author: { type: "string", value: "text", help: "submit: who made the picture." },
      credit: { type: "string", value: "text", help: "submit: credit text exports carry." },
      license: {
        type: "string",
        value: "id",
        help: "submit: the picture's licence, e.g. CC-BY-4.0.",
      },
      source: { type: "string", value: "text", help: "submit: where the picture came from." },
      image: { type: "string", value: "file", help: "submit (turnaround, depth): the picture." },
      "trace-map": {
        type: "string",
        value: "file",
        help: "submit (trace): an irudd.trace-map.v1 JSON file.",
      },
      ops: {
        type: "string",
        value: "file",
        help: "submit (variation): a JSON array of document operations.",
      },
      coverage: {
        type: "string",
        value: "open|closed",
        help: "submit (turnaround of a wearable).",
      },
      "submission-id": { type: "string", value: "id", help: "submit: idempotency key." },
    },
    run: (context) =>
      withClient(context, async (c) => {
        const sub = positional(context, 0, subcommands.join("|"));
        switch (sub) {
          case "capabilities": {
            const caps = await c.call("art.capabilities", {});
            show(context, caps, () =>
              [
                `Artwork comes from the ${caps.producer}; this host makes none.`,
                ...caps.kinds.flatMap((k) => [
                  `  ${k.kind}: ${k.apply.available ? `proposed by ${k.apply.translator ?? ""}` : `recorded only. ${k.apply.reason ?? ""}`}`,
                  ...(k.intents ?? []).map(
                    (i) =>
                      `    --intent ${i.intent}: ${i.apply.available ? `proposed by ${i.apply.translator ?? ""}` : `recorded only. ${i.apply.reason ?? ""}`}`,
                  ),
                ]),
              ].join("\n"),
            );
            return exit.ok;
          }
          case "request":
            return request(context, c);
          case "list": {
            const doc = text(context, "doc");
            const listed = await c.call("art.list", {
              ...(doc === undefined ? {} : { documentId: doc }),
              ...(context.options["all"] === true ? { all: true } : {}),
            });
            show(context, listed, () =>
              listed.requests.length
                ? listed.requests.map(describe).join("\n")
                : "No art requests.",
            );
            return exit.ok;
          }
          case "show": {
            const view = await c.call("art.get", { artId: positional(context, 1, "art-id") });
            const out = text(context, "out");
            const written = out === undefined ? [] : await save(c, view, path.resolve(out));
            show(context, { ...view, ...(out === undefined ? {} : { saved: written }) }, () =>
              [
                describe(view),
                ...(written.length ? ["Saved:", ...written.map((f) => `  ${f}`)] : []),
              ].join("\n"),
            );
            return exit.ok;
          }
          case "submit":
            return submit(context, c);
          case "cancel": {
            const view = await c.call("art.cancel", { artId: positional(context, 1, "art-id") });
            show(context, view, () => describe(view));
            return exit.ok;
          }
          default:
            throw new UsageError(`art takes one of ${subcommands.join(", ")}, not ${sub}.`);
        }
      }),
  },
];
