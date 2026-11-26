// Art requests through the project host.
//
// A person sends a typed brief to one paired agent. The host checks the
// brief against the document revision and the attached pictures, stores it,
// and sends it as a steering message to that agent's bound conversation, so
// the brief reaches exactly the conversation the person paired. The host
// never launches a model, a tool or a child process for art: the reply comes
// from the paired agent (or a person importing a file the agent could not
// make), on a connection authenticated with the brief's pairing.
//
// A valid reply becomes a proposal on the brief's revision through the
// submitter's own session, so the journal records who drafted it. The
// proposal stays reviewable even when the person edited the head meanwhile;
// accepting it then needs a fresh brief or a refinement, as with any stale
// proposal. Translators turn a reply into operations. Variation replies carry
// their operations; other kinds need a translator the host was given, and
// without one a valid reply is recorded, not proposed.
//
// The request log (`art.sqlite`), the steering outbox and the project are
// separate files, so every step that writes more than one of them is either
// idempotent on retry or settled when the host starts. A brief stored without
// its steering message is sent again by a retry with the same request ID,
// unless the agent already answered it; a host start never sends it. A reply
// that becomes a proposal is recorded as pending before the journal commit
// and settled from the journal's receipt; the journal request ID is derived
// from the reply itself, so a retry with a fresh submission ID finds the
// committed proposal instead of drafting a second one. A proposal the journal
// lost to a restored older backup is drafted again once, and one an art log
// version 1 host committed under its submission-derived ID is adopted.
//
// An art proposal also writes the document's `irudd.asset-credits`: who made
// each picture it adds, how it arrived and what the submitter stated about
// its rights. Accepting the proposal makes that attribution part of the
// character, so backups, archives and exports carry it. Removing a picture
// retires its credit in the reducer.

import { Effect } from "effect";
import { createHash } from "node:crypto";
import {
  assetCreditsNamespace,
  AssetCredit,
  canonicalJson,
  decodeWith,
  diagnostic,
  isJson,
  isJsonObject,
  mergeAssetCredits,
  readAssetCredits,
  type Actor,
  type CharacterDocument,
  type Diagnostic,
  type Json,
} from "@irudd/document";
import type { ApplyResult, Project, Session } from "../contract/project.js";
import {
  artBriefFormat,
  artImageTypes,
  artKinds,
  artLimits,
  artReplyFormat,
  briefIntent,
  traceIntents,
  traceMapFormat,
  type ArtApply,
  type AttachmentRole,
  type ArtBrief,
  type ArtCapabilities,
  type ArtFile,
  type ArtKind,
  type ArtPutResult,
  type ArtReadView,
  type ArtReply,
  type ArtRequestView,
  type ArtSubmissionView,
  type ArtSubmitResult,
  type TraceIntent,
} from "../wire/art.js";
import type { SteeringMessage, SteeringStatus } from "../wire/steering.js";
import {
  SteeringError,
  steeringMessageId,
  type AgentLink,
  type PairingSource,
  type Steering,
} from "../steering/service.js";
import { imageSize } from "./images.js";
import type {
  ArtStore,
  StoredFile,
  StoredPending,
  StoredRequest,
  StoredSubmission,
} from "./store.js";

export class ArtError extends Error {
  readonly _tag: string;
  readonly [field: string]: unknown;
  constructor(tag: string, message: string, fields: Record<string, unknown> = {}) {
    super(message);
    this._tag = tag;
    Object.assign(this, fields);
  }
}

/**
 * What a translator is given: the brief, the document at the brief's
 * revision, the reply, its measured files, and the verified bytes of any
 * project blob (the reply's picture, the brief's attachments, the document's
 * sheets).
 */
export interface ArtTranslatorInput {
  readonly brief: ArtBrief;
  readonly document: CharacterDocument;
  readonly reply: ArtReply;
  readonly files: ReadonlyArray<ArtFile>;
  readonly read: (digest: string) => Promise<Uint8Array>;
}

/** Operations, and what the reply carried that they leave out, for the proposal's summary. */
export interface ArtTranslation {
  readonly operations: ReadonlyArray<Json>;
  readonly notes?: ReadonlyArray<string>;
}

/**
 * Turns one kind of reply into document operations. Throwing rejects the
 * reply with the error's message; nothing is proposed. Throwing an
 * `ArtError` instead fails the call without recording the reply, for a
 * translator that cannot run now (its raster is not ready): the same
 * submission is translated again when it is retried.
 */
export interface ArtTranslator {
  readonly kind: ArtKind;
  /**
   * Trace only: the intent it answers. Absent: the default fit, which every
   * trace brief without an intent asks for.
   */
  readonly intent?: TraceIntent;
  /** A short name recorded with every proposal it makes, such as `repaint`. */
  readonly id: string;
  translate(
    input: ArtTranslatorInput,
  ): ReadonlyArray<Json> | ArtTranslation | Promise<ReadonlyArray<Json> | ArtTranslation>;
  /**
   * Why a brief of this kind cannot be answered at its revision, such as a
   * target part that cannot take the fit; checked when the person sends it.
   */
  check?(brief: ArtBrief, document: CharacterDocument): string | undefined;
  /** Lines the steering prompt adds to the kind's instructions. */
  readonly guidance?: ReadonlyArray<string>;
}

/** Variation replies are operations already; the reducer validates them. */
export const variationTranslator: ArtTranslator = {
  kind: "variation",
  id: "operations",
  translate: ({ reply }) => (reply.kind === "variation" ? reply.operations : []),
};

/** Who is calling, as the dispatcher bound them. */
export interface ArtCaller {
  readonly actor: Actor;
  readonly role: "human" | "agent";
  readonly session: Session;
  readonly link?: AgentLink;
  /** Uploads are kept per connection. */
  readonly key: string;
}

/**
 * Points between the writes of one art call, for tests that stop the host
 * there: after a brief is stored and before its steering message; after a
 * submission is recorded as pending; after its proposal is committed; and
 * after the submission is recorded, before the steering link.
 */
export type ArtCut =
  | "request-stored"
  | "submission-pending"
  | "proposal-committed"
  | "submission-recorded";

/** Who a steering link is made for: an agent and the pairing the brief went to. */
interface Pairing {
  readonly agent: string;
  readonly pairingId: string;
}

export interface ArtOptions {
  readonly project: Project;
  readonly store: ArtStore;
  readonly steering: Steering;
  readonly pairings: PairingSource;
  /** Commit through the dispatcher, so commit events and steering re-checks follow. */
  readonly apply: (caller: ArtCaller, request: unknown) => Promise<ApplyResult>;
  readonly now?: () => number;
  /** Digests this build ships with their own origin; submitting their bytes credits nobody new. */
  readonly shipped?: (digest: string) => boolean;
  /** Test hook: called at each `ArtCut`. It may end the process or throw to stop the call there. */
  readonly cut?: (point: ArtCut) => void;
}

interface Upload {
  readonly mediaType: string;
  readonly total: number;
  readonly chunks: Buffer[];
  received: number;
}

/** Which translator answers a brief: its kind, and for a trace brief that builds, `trace:build`. */
type ArtRoute = ArtKind | "trace:build";
const route = (kind: ArtKind, intent: TraceIntent | undefined): ArtRoute =>
  kind === "trace" && intent === "build" ? "trace:build" : kind;
const briefRoute = (brief: ArtBrief): ArtRoute => route(brief.kind, briefIntent(brief));

const unavailable: Record<Exclude<ArtRoute, "variation">, ArtApply> = {
  turnaround: {
    available: false,
    translator: null,
    reason:
      "This host has no repaint translator. Use the packaged host or the desktop to propose a repaint.",
    actions: ["Open the project in the desktop app so it owns the project, then submit again."],
  },
  trace: {
    available: false,
    translator: null,
    reason:
      "This host has no trace fit translator: fitting a trace map's face landmarks and depth pairs measures the part's sheet with the desktop's raster.",
    actions: [
      "Open the project in the desktop app so it owns the project, then submit again.",
      "Keep the recorded trace map; save it with art show --out.",
    ],
  },
  "trace:build": {
    available: false,
    translator: null,
    reason:
      "This host has no trace build translator: building parts from a trace map's outlines measures the anchor part's sheet with the desktop's raster.",
    actions: [
      "Open the project in the desktop app so it owns the project, then submit again.",
      "Keep the recorded trace map; save it with art show --out.",
    ],
  },
  depth: {
    available: false,
    translator: null,
    reason:
      "This host has no depth translator: fitting a depth pass to the portrait draws it with the desktop's raster.",
    actions: [
      "Open the project in the desktop app so it owns the project, then submit again.",
      "Keep the recorded depth image; save it with art show --out.",
    ],
  },
};

const hex = (text: string) => createHash("sha256").update(text).digest("hex");

/** The request ID is stable per project, agent and the person's request ID. */
export function artRequestId(projectId: string, agent: string, requestId: string): string {
  return "art-" + hex(`${projectId}\u0000${agent}\u0000${requestId}`).slice(0, 24);
}

/**
 * The journal request ID of the proposal a reply makes: the same request,
 * route, submitter and reply always give the same ID, whatever submission ID
 * carried it, so a retry after a lost reply replays the committed proposal.
 */
export function artCommandId(
  artId: string,
  via: "agent" | "person-import",
  submitter: string,
  replyDigest: string,
): string {
  return `art.${hex(`${artId}\u0000${via}\u0000${submitter}\u0000${replyDigest}`).slice(0, 40)}`;
}

const sameActor = (a: Actor, b: Actor): boolean => a.kind === b.kind && a.id === b.id;

/** The journal request ID a host before reply-derived IDs gave a submission's proposal. */
export function legacyArtCommandId(artId: string, submissionId: string): string {
  return `art.${hex(`${artId}\u0000${submissionId}`).slice(0, 40)}`;
}

/** The proposal a reply makes, on the brief's revision. */
function proposalCommand(
  request: StoredRequest,
  reply: ArtReply,
  proposal: string,
  requestId: string,
  ops: ReadonlyArray<Json>,
  notes: ReadonlyArray<string> = [],
) {
  const brief = request.brief;
  const summary = `${brief.kind} for ${request.artId}: ${reply.summary}`;
  return {
    format: "irudd.command",
    version: 1,
    requestId,
    documentId: brief.documentId,
    expectedRevision: brief.revision,
    command: {
      type: "proposal.create",
      proposal,
      summary: (notes.length ? `${summary} (${notes.join(" ")})` : summary).slice(0, 500),
      content: { kind: "ops", ops },
    },
  } as const;
}

/** Equal as JSON, whatever the key order a client sent. */
const sameJson = (a: unknown, b: unknown): boolean => {
  const x: unknown = JSON.parse(JSON.stringify(a));
  const y: unknown = JSON.parse(JSON.stringify(b));
  return isJson(x) && isJson(y) ? canonicalJson(x) === canonicalJson(y) : false;
};

const replyDigest = (reply: ArtReply): string => {
  const json: unknown = JSON.parse(JSON.stringify(reply));
  return "sha256:" + hex(isJson(json) ? canonicalJson(json) : JSON.stringify(json));
};

/** What each kind asks of the paired agent, condensed from the G0 art director prompts. */
const kindInstructions: Record<ArtRoute, ReadonlyArray<string>> = {
  variation: [
    "Act as geometry author. Return document operations against the brief's revision; keep the IDs of parts you retain.",
  ],
  turnaround: [
    "Generate one original, nonsexualized square 2x2 orthographic turnaround with your image tool: top left exact front (+Z), top right profile with the nose pointing LEFT, bottom left exact rear, bottom right profile pointing RIGHT.",
    "Equal square cells, same pose, floor and scale in every view, 5% margin, even diffuse lighting, a uniform #ff00ff background in every gap; no floor, shadow, lines, text or extra figures.",
    "The editor reuses the existing geometry and projects these colours onto the listed painted regions, so keep the attached source sheet's registration, silhouette and framing exactly.",
  ],
  trace: [
    "Trace corresponding visible volumes in the attached front and left-facing profile views. Use no image generation.",
    `Return an ${traceMapFormat} map: height, and 5-12 regions with id, optional parent, method (loft, volume, path or membrane), front and side outlines of 4-12 normalised [x,y] points (0,0 top left), a spine for a path, optional faceLandmarks and depthPairs.`,
  ],
  "trace:build": [
    "Trace corresponding visible volumes in the attached front and left-facing profile views. Use no image generation.",
    `Return an ${traceMapFormat} map: height, and 1-24 regions with id, optional parent region, method (loft for a body of level cross sections, volume for a solid silhouette, membrane for a thin fin or wing with correspondence same or opposite, path for a curved limb or tail along a spine), front and side outlines of 4-12 normalised [x,y] points (0,0 top left), a spine of [front x, front y, profile x, profile y, width radius, depth radius] points from socket to tip for a path, optional motionRole, outfitRole, faceLandmarks and depthPairs.`,
    "The person asked to build: each region you return becomes a new editable part on the brief's sheet, attached to its parent region.",
  ],
  depth: [
    "With your image tool, render the head in the FIRST view as a front orthographic linear depth pass on black, same camera, crop and orientation; the SECOND view is its profile for depth only.",
    "Closest is light (nose tip about 245/255), the plane through the front of the ears about 85/255, background pure black, pure grayscale, no lighting, colour, painted features or text.",
  ],
};

/**
 * The operations with the reply's attribution for every new picture they
 * add, written as the document's `irudd.asset-credits`. A picture the base
 * document already declares, or one the build ships with its own origin,
 * keeps whatever credit it has. A picture the document no longer declares
 * has no credit to inherit: a stale entry for its bytes, from a build that
 * kept credits of removed pictures, is replaced, and other such entries are
 * compacted away. The reducer retires the credit of an asset the operations
 * remove. A reply may not write the extension itself, and a record that
 * cannot be read is never overwritten.
 */
function creditOperations(
  document: CharacterDocument,
  ops: ReadonlyArray<Json>,
  who: {
    readonly via: "agent" | "person-import";
    readonly submittedBy: Actor;
    readonly artId: string;
    readonly kind: ArtKind;
    readonly reply: ArtReply;
    readonly shipped: (digest: string) => boolean;
  },
): Json[] | Diagnostic {
  const declared = new Set<string>(document.assets.map((a) => a.digest));
  // The assets declared once the operations ran, in their order.
  const present = new Set(declared);
  const added: string[] = [];
  for (const [i, op] of ops.entries()) {
    if (!isJsonObject(op)) continue;
    if (op["op"] === "extension.set" && op["namespace"] === assetCreditsNamespace)
      return diagnostic(
        "schema",
        ["reply", "operations", i],
        `The host writes ${assetCreditsNamespace} from the reply's attribution; leave it out of the operations.`,
      );
    const asset = op["asset"];
    if (op["op"] === "asset.add" && isJsonObject(asset) && typeof asset["digest"] === "string") {
      added.push(asset["digest"]);
      present.add(asset["digest"]);
    }
    if (op["op"] === "asset.remove" && typeof op["digest"] === "string")
      present.delete(op["digest"]);
  }
  const credits: AssetCredit[] = [];
  for (const digest of new Set(added)) {
    if (!present.has(digest) || declared.has(digest) || who.shipped(digest)) continue;
    const credit = decodeWith(AssetCredit, {
      digest,
      via: who.via === "agent" ? "paired-agent" : "person-import",
      submittedBy: who.submittedBy,
      art: { id: who.artId, kind: who.kind },
      summary: who.reply.summary,
      ...who.reply.attribution,
    });
    if (!credit.ok)
      return diagnostic(
        "schema",
        ["reply", "attribution"],
        `The credit for ${digest} does not fit ${assetCreditsNamespace}: ${credit.diagnostics.map((d) => d.message).join(" ")}`,
      );
    credits.push(credit.value);
  }
  // A newly declared picture never inherits an entry left from before it was removed.
  const fresh = (d: string) => present.has(d) && !declared.has(d);
  const stale = readAssetCredits(document);
  const inherits = stale.ok && stale.value.some((c) => fresh(c.digest));
  if (credits.length === 0 && !inherits) return [...ops];
  const keep = new Set(
    [...present].filter((d) => declared.has(d) || credits.some((c) => c.digest === d)),
  );
  const value = mergeAssetCredits(document, keep, credits);
  if (!value.ok) {
    const [first] = value.diagnostics;
    return first ?? diagnostic("schema", ["extensions", assetCreditsNamespace], "No credit.");
  }
  return [
    ...ops,
    { op: "extension.set", namespace: assetCreditsNamespace, value: value.value ?? null },
  ];
}

const isTranslation = (made: ReadonlyArray<Json> | ArtTranslation): made is ArtTranslation =>
  !Array.isArray(made);

export class Art {
  private readonly options: ArtOptions;
  private readonly now: () => number;
  private readonly translators = new Map<ArtRoute, ArtTranslator>();
  private readonly uploads = new Map<string, Upload>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: ArtOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
    this.translators.set("variation", variationTranslator);
  }

  /** Register a translator for its kind. Returns the function that removes it. */
  register(translator: ArtTranslator): () => void {
    const at = route(translator.kind, translator.intent);
    this.translators.set(at, translator);
    return () => {
      if (this.translators.get(at) === translator) this.translators.delete(at);
    };
  }

  private apply(at: ArtRoute): ArtApply {
    const translator = this.translators.get(at);
    if (translator) return { available: true, translator: translator.id };
    return at === "variation"
      ? { available: false, translator: null, reason: "No translator." }
      : unavailable[at];
  }

  capabilities(): ArtCapabilities {
    return {
      kinds: artKinds.map((kind) => ({
        kind,
        apply: this.apply(kind),
        ...(kind === "trace"
          ? {
              intents: traceIntents.map((intent) => ({
                intent,
                apply: this.apply(route(kind, intent)),
              })),
            }
          : {}),
      })),
      producer: "paired-agent",
      limits: artLimits,
      formats: { brief: artBriefFormat, reply: artReplyFormat, traceMap: traceMapFormat },
    };
  }

  /** A connection closed: drop its unfinished uploads. */
  disconnected(key: string): void {
    for (const id of this.uploads.keys())
      if (id.startsWith(key + "\u0000")) this.uploads.delete(id);
  }

  // ── Uploads ─────────────────────────────────────────────────────────────

  async put(
    caller: ArtCaller,
    p: {
      readonly digest: string;
      readonly mediaType: string;
      readonly offset: number;
      readonly total: number;
      readonly base64: string;
    },
  ): Promise<ArtPutResult> {
    const id = `${caller.key}\u0000${p.digest}`;
    let upload = this.uploads.get(id);
    if (p.offset === 0 || !upload || upload.total !== p.total || upload.mediaType !== p.mediaType) {
      if (p.offset !== 0)
        throw new ArtError("UploadIncomplete", `Start the upload of ${p.digest} at offset 0.`, {
          digest: p.digest,
          received: 0,
        });
      upload = { mediaType: p.mediaType, total: p.total, chunks: [], received: 0 };
      this.uploads.set(id, upload);
    }
    if (p.offset !== upload.received)
      throw new ArtError(
        "UploadIncomplete",
        `Send the chunks of ${p.digest} in order: the next offset is ${upload.received}.`,
        { digest: p.digest, received: upload.received },
      );
    const chunk = Buffer.from(p.base64, "base64");
    if (chunk.length === 0 || upload.received + chunk.length > upload.total) {
      this.uploads.delete(id);
      throw new ArtError(
        "ArtRejected",
        `The chunk does not fit the declared ${upload.total} bytes.`,
        {
          digest: p.digest,
        },
      );
    }
    upload.chunks.push(chunk);
    upload.received += chunk.length;
    if (upload.received < upload.total)
      return { digest: p.digest, received: upload.received, total: upload.total, stored: null };
    this.uploads.delete(id);
    const bytes = new Uint8Array(Buffer.concat(upload.chunks));
    const put = await Effect.runPromise(
      caller.session.putBlob({ bytes, mediaType: upload.mediaType, digest: p.digest }),
    );
    const size = imageSize(bytes, put.mediaType);
    if (!size)
      throw new ArtError(
        "ArtRejected",
        `The picture size of ${p.digest} cannot be read from its header.`,
        {
          digest: p.digest,
        },
      );
    return {
      digest: p.digest,
      received: upload.received,
      total: upload.total,
      stored: { ...put, ...size },
    };
  }

  /** Measure a stored blob: it must be a picture this module accepts. */
  private async measure(
    digest: string,
    path: ReadonlyArray<string | number>,
    limit: number,
  ): Promise<StoredFile | Diagnostic> {
    const info = await Effect.runPromise(this.options.project.blobInfo(digest));
    if (!info)
      return diagnostic(
        "missing-asset",
        path,
        `${digest} is not staged in this project. Upload it with art.put first.`,
      );
    if (!artImageTypes.some((t) => t === info.mediaType))
      return diagnostic("schema", path, `${digest} is ${info.mediaType}; use PNG, JPEG or WebP.`);
    if (info.byteLength > limit)
      return diagnostic(
        "limit",
        path,
        `${digest} has ${info.byteLength} bytes; the limit is ${limit}.`,
      );
    const blob = await Effect.runPromise(this.options.project.blob(digest));
    const size = imageSize(blob.bytes, info.mediaType);
    if (!size) return diagnostic("schema", path, `The picture size of ${digest} cannot be read.`);
    if (
      Math.min(size.width, size.height) < artLimits.minEdge ||
      Math.max(size.width, size.height) > artLimits.maxEdge
    )
      return diagnostic(
        "limit",
        path,
        `${digest} is ${size.width} × ${size.height}; use ${artLimits.minEdge} to ${artLimits.maxEdge} pixels per edge.`,
      );
    return { digest, mediaType: info.mediaType, byteLength: info.byteLength, ...size };
  }

  // ── Requests ────────────────────────────────────────────────────────────

  async request(
    person: Actor,
    p: { readonly agent: string; readonly requestId: string; readonly brief: ArtBrief },
  ): Promise<ArtRequestView> {
    return this.serial(async () => {
      const { project, store } = this.options;
      const artId = artRequestId(project.info.projectId, p.agent, p.requestId);
      const existing = store.request(artId);
      if (existing) {
        if (!sameJson(existing.brief, p.brief))
          throw new ArtError(
            "RequestConflict",
            `Request ${p.requestId} already sent a different brief to ${p.agent}. Use a new request ID.`,
            { artId },
          );
        const delivered = await this.redeliver(person, existing);
        if (delivered) return this.view(delivered);
        // The stored brief went to a pairing that is gone and nothing answered it: start again.
      }
      const brief = p.brief;
      const problems: Diagnostic[] = [];
      const at = await Effect.runPromise(project.revision(brief.documentId, brief.revision));
      if (!at)
        throw new ArtError(
          "ArtRejected",
          `${brief.documentId} has no revision ${brief.revision}.`,
          {
            path: ["params", "brief", "revision"],
          },
        );
      const roles = new Set(brief.attachments.map((a) => a.role));
      const need = (role: AttachmentRole) => {
        if (!roles.has(role))
          problems.push(
            diagnostic(
              "schema",
              ["brief", "attachments"],
              `A ${brief.kind} brief attaches a ${role} view.`,
            ),
          );
      };
      if (brief.kind === "trace" || brief.kind === "depth") {
        need("front");
        need("side");
      }
      if (brief.kind === "turnaround") {
        const parts = brief.parts ?? [];
        if (parts.length === 0)
          problems.push(
            diagnostic("schema", ["brief", "parts"], "Name the painted regions to repaint."),
          );
        const atlases = new Set<string>();
        for (const [i, id] of parts.entries()) {
          const part = at.document.parts.find((q) => q.id === id);
          if (!part)
            problems.push(
              diagnostic(
                "missing-reference",
                ["brief", "parts", i],
                `Revision ${brief.revision} has no part ${id}.`,
              ),
            );
          else if (!part.paint)
            problems.push(
              diagnostic(
                "schema",
                ["brief", "parts", i],
                `${id} is not painted from a turnaround sheet.`,
              ),
            );
          else atlases.add(part.paint.atlas);
        }
        // A source sheet is the one the selected regions paint from at this revision.
        const [atlas] = atlases;
        if (atlas !== undefined && atlases.size === 1)
          for (const [i, a] of brief.attachments.entries())
            if (a.role === "source-sheet" && a.digest !== atlas)
              problems.push(
                diagnostic(
                  "missing-reference",
                  ["brief", "attachments", i, "digest"],
                  `Attachment ${i + 1} is not the source sheet of the selected regions: at revision ${brief.revision} they paint from ${atlas}.`,
                ),
              );
        if (atlases.size > 1)
          problems.push(
            diagnostic(
              "schema",
              ["brief", "parts"],
              "Choose regions painted from the same source sheet.",
            ),
          );
        if (brief.attachments.length === 0)
          problems.push(
            diagnostic("schema", ["brief", "attachments"], "Attach at least the whole view."),
          );
      }
      // A translator checks the brief's target at this revision, such as a portrait for depth.
      const refusal = this.translators.get(briefRoute(brief))?.check?.(brief, at.document);
      if (refusal) problems.push(diagnostic("schema", ["brief", "parts"], refusal));
      if (brief.kind === "variation")
        for (const [i, id] of (brief.parts ?? []).entries())
          if (!at.document.parts.some((q) => q.id === id))
            problems.push(
              diagnostic(
                "missing-reference",
                ["brief", "parts", i],
                `Revision ${brief.revision} has no part ${id}.`,
              ),
            );
      const files: StoredFile[] = [];
      for (const [i, a] of brief.attachments.entries()) {
        const measured = await this.measure(
          a.digest,
          ["brief", "attachments", i, "digest"],
          artLimits.attachmentBytes,
        );
        if ("code" in measured) problems.push(measured);
        else files.push(measured);
      }
      if (problems.length)
        throw new ArtError("ArtRejected", problems.map((d) => d.message).join(" "), {
          diagnostics: problems,
          path: ["params", ...(problems[0]?.path ?? [])],
        });
      const pairingId = this.options.pairings.pairingId(p.agent);
      if (!pairingId)
        throw new ArtError("AgentNotPaired", `Agent ${p.agent} is not paired with this project.`, {
          agent: p.agent,
        });
      // Stored first, so the steering prompt finds the brief when it is built.
      this.options.steering.requireConnected(p.agent);
      const stored = store.insertRequest({
        artId,
        agent: p.agent,
        pairingId,
        requestId: p.requestId,
        messageId: steeringMessageId(project.info.projectId, p.agent, p.requestId),
        brief,
        files,
        createdAt: this.now(),
        createdBy: person,
      });
      this.options.cut?.("request-stored");
      await this.deliver(person, stored);
      return this.view(stored);
    });
  }

  /** Send a stored brief as its steering message. A brief nobody answered is removed when that fails. */
  private async deliver(person: Actor, stored: StoredRequest): Promise<void> {
    const { store, steering } = this.options;
    try {
      const message = await steering.send(person, {
        agent: stored.agent,
        requestId: stored.requestId,
        text: this.summary(stored.artId, stored.brief, stored.files),
        documentId: stored.brief.documentId,
      });
      if (message.messageId !== stored.messageId || message.pairingId !== stored.pairingId)
        throw new ArtError("HostFailed", "The steering message does not match the brief.");
    } catch (error) {
      if (store.submissions(stored.artId).length === 0 && store.pending(stored.artId).length === 0)
        store.deleteRequest(stored.artId);
      throw error;
    }
  }

  /**
   * A retried request: its brief is stored, but the host may have stopped
   * before the steering message was written. Send it now. Undefined when the
   * brief went to a pairing that was replaced and nothing answered it, so the
   * caller starts the request again.
   */
  private async redeliver(
    person: Actor,
    stored: StoredRequest,
  ): Promise<StoredRequest | undefined> {
    const { steering, store, pairings } = this.options;
    try {
      steering.get(stored.messageId);
      return stored;
    } catch (error) {
      if (!(error instanceof SteeringError)) throw error;
    }
    if (stored.closed) return stored;
    // The agent found the brief without its message and already replied:
    // sending it now would ask the conversation a second time.
    const answered =
      store.submissions(stored.artId).length > 0 || store.pending(stored.artId).length > 0;
    if (answered) return stored;
    if (pairings.pairingId(stored.agent) !== stored.pairingId) {
      store.deleteRequest(stored.artId);
      return undefined;
    }
    await this.deliver(person, stored);
    return store.request(stored.artId) ?? stored;
  }

  /** The person's words for the conversation; `instructions` adds how to answer. */
  private summary(artId: string, brief: ArtBrief, files: ReadonlyArray<StoredFile>): string {
    const lines = [
      `Art request ${artId}: ${brief.kind}, an ${artBriefFormat} v1 brief for ${brief.documentId} at revision ${brief.revision}.`,
      "",
      brief.direction,
      "",
      ...brief.attachments.map((a, i) => {
        const f = files[i];
        return `Attachment ${i + 1}, ${a.role}${a.label ? ` (${a.label})` : ""}: ${a.digest}${f ? `, ${f.width} × ${f.height} ${f.mediaType}` : ""}`;
      }),
      ...(brief.parts?.length ? [`Parts: ${brief.parts.join(", ")}`] : []),
      ...(brief.height !== undefined ? [`Height: ${brief.height} m`] : []),
      ...(brief.protected?.length ? [`Protected regions: ${brief.protected.join(", ")}`] : []),
      ...(brief.intent === "build"
        ? [
            "Intent: build. Each region of the trace map becomes a new editable part painted from the named part's sheet.",
          ]
        : []),
    ];
    return lines.join("\n").slice(0, 8000);
  }

  /** The steering prompt's answer lines for a message that carries a brief; undefined otherwise. */
  instructions(
    message: SteeringMessage,
    cli: { readonly irudd: string; readonly cred: string },
  ): ReadonlyArray<string> | undefined {
    const request = this.options.store.byMessage(message.messageId);
    if (!request) return undefined;
    const { irudd, cred } = cli;
    const id = request.artId;
    const kind = request.brief.kind;
    const at = briefRoute(request.brief);
    const reply =
      kind === "variation"
        ? `--ops <operations.json>`
        : kind === "trace"
          ? `--trace-map <trace-map.json>`
          : `--image <file.png>${kind === "turnaround" ? " [--height <m>]" : ""}`;
    return [
      ...kindInstructions[at],
      ...(this.translators.get(at)?.guidance ?? []),
      `Read the brief and save its attached views: ${irudd} art show ${id} --out <folder> ${cred}`,
      `Answer here, in this conversation, with your own tools: ${irudd} art submit ${id} ${reply} --summary "<what you made>" ${cred}`,
      "The host checks the reply and drafts it as a proposal on the brief's revision; the person reviews, accepts, discards or undoes it. You need no propose or applied step for it.",
      `If you cannot make this kind of artwork in this session, say so plainly here and submit nothing; the person can import a file instead. Over the irudd MCP server the same steps are art_brief and art_submit.`,
    ];
  }

  list(
    caller: ArtCaller,
    p: { readonly documentId?: string; readonly all?: boolean },
  ): Promise<{ readonly requests: ReadonlyArray<ArtRequestView> }> {
    const agent = caller.role === "agent" ? this.link(caller) : undefined;
    const stored = this.options.store
      .requests({
        ...(agent ? { agent: agent.agent } : {}),
        ...(p.documentId === undefined ? {} : { documentId: p.documentId }),
      })
      .filter((r) => (agent ? r.pairingId === agent.pairingId : true))
      .filter((r) => p.all === true || r.closed === null);
    return Promise.all(stored.map((r) => this.view(r))).then((requests) => ({ requests }));
  }

  async get(caller: ArtCaller, artId: string): Promise<ArtRequestView> {
    return this.view(this.own(caller, artId));
  }

  async read(
    caller: ArtCaller,
    p: {
      readonly artId: string;
      readonly digest: string;
      readonly offset?: number;
      readonly length?: number;
    },
  ): Promise<ArtReadView> {
    const request = this.own(caller, p.artId);
    const files = [
      ...request.files,
      ...this.options.store.submissions(request.artId).flatMap((s) => s.files),
    ];
    if (!files.some((f) => f.digest === p.digest))
      throw new ArtError("ArtMissing", `${p.artId} has no file ${p.digest}.`, { digest: p.digest });
    const blob = await Effect.runPromise(this.options.project.blob(p.digest));
    const offset = Math.min(p.offset ?? 0, blob.bytes.length);
    const end = Math.min(blob.bytes.length, offset + (p.length ?? artLimits.chunkBytes));
    return {
      digest: blob.digest,
      mediaType: blob.mediaType,
      byteLength: blob.byteLength,
      offset,
      base64: Buffer.from(blob.bytes.subarray(offset, end)).toString("base64"),
      done: end >= blob.bytes.length,
    };
  }

  async cancel(artId: string): Promise<ArtRequestView> {
    return this.serial(async () => {
      const request = this.options.store.request(artId);
      if (!request)
        throw new ArtError("ArtMissing", `There is no art request ${artId}.`, { artId });
      if (request.closed) return this.view(request);
      let detail = "Cancelled by the person before delivery.";
      try {
        const message = this.options.steering.cancel(request.messageId);
        if (message.delivery.state === "accepted")
          detail = "Cancelled by the person; the conversation already holds the brief.";
      } catch (error) {
        if (!(error instanceof SteeringError)) throw error;
        detail =
          "Cancelled by the person after the agent read the brief; later replies are refused.";
      }
      this.options.store.closeRequest(artId, { at: this.now(), detail });
      return this.view(this.options.store.request(artId) ?? request);
    });
  }

  // ── Replies ─────────────────────────────────────────────────────────────

  async submit(
    caller: ArtCaller,
    p: { readonly artId: string; readonly submissionId: string; readonly reply: ArtReply },
  ): Promise<ArtSubmitResult> {
    return this.serial(async () => {
      const { store, project } = this.options;
      const request = this.own(caller, p.artId);
      // A submission the host stopped in the middle of is settled before anything else.
      await this.settle(store.pending(request.artId));
      const digest = replyDigest(p.reply);
      const seen = store.submission(request.artId, p.submissionId);
      if (seen) {
        if (seen.replyDigest !== digest)
          throw new ArtError(
            "RequestConflict",
            `Submission ${p.submissionId} already carried a different reply. Use a new submission ID.`,
            { artId: request.artId, submissionId: p.submissionId },
          );
        // A project restored from an older backup may have lost the proposal
        // this reply made. The same submitter's retry drafts it again under
        // its recorded proposal and journal request IDs.
        const via = caller.role === "agent" ? "agent" : "person-import";
        if (
          seen.proposal &&
          seen.via === via &&
          sameActor(seen.by, caller.actor) &&
          (await this.lost(request, seen.proposal)) &&
          !(await this.recovered(request, seen))
        ) {
          const problems = await this.redraft(caller, request, seen, seen.proposal);
          if (problems.length)
            throw new ArtError(
              "ArtRejected",
              `Proposal ${seen.proposal.id} is missing from this project's journal and cannot be drafted again: ${problems.map((d) => d.message).join(" ")}`,
              { artId: request.artId, diagnostics: problems },
            );
        }
        // The steering link is the last write; a retry makes it if the host stopped before.
        if (seen.proposal && seen.via === "agent" && caller.role === "agent")
          await this.linkSteering(this.link(caller), request, seen.proposal.requestId);
        return this.result("replayed", seen, request);
      }
      if (request.closed)
        throw new ArtError("ArtClosed", `${request.artId} was closed: ${request.closed.detail}`, {
          artId: request.artId,
        });
      const via = caller.role === "agent" ? "agent" : "person-import";
      const link = caller.role === "agent" ? this.link(caller) : undefined;
      const brief = request.brief;
      const head = (await Effect.runPromise(project.current(brief.documentId))).revision;
      const source = {
        baseRevision: brief.revision,
        headAtSubmit: head,
        stale: head > brief.revision,
      };
      const base = {
        artId: request.artId,
        submissionId: p.submissionId,
        at: this.now(),
        by: caller.actor,
        via,
        pairingId: link?.pairingId ?? null,
        reply: p.reply,
        replyDigest: digest,
        source,
      } as const;
      const reject = (
        diagnostics: ReadonlyArray<Diagnostic>,
        files: ReadonlyArray<StoredFile> = [],
      ) =>
        this.result(
          "new",
          store.insertSubmission({
            ...base,
            files,
            state: "rejected",
            diagnostics,
            duplicateOf: null,
            translator: null,
            proposal: null,
          }),
          request,
        );
      if (p.reply.kind !== brief.kind)
        return reject([
          diagnostic(
            "schema",
            ["reply", "kind"],
            `The brief asks for a ${brief.kind} reply, not ${p.reply.kind}.`,
          ),
        ]);
      // The same reply again stands for its earlier submission, unless the
      // journal no longer has that submission's proposal (an older backup was
      // restored): then it is drafted afresh. A discarded proposal is still in
      // the journal, so a discarded reply is not proposed again.
      let earlier: StoredSubmission | undefined;
      for (const s of store.submissions(request.artId)) {
        if (s.replyDigest !== digest || s.state === "rejected") continue;
        if (s.proposal && (await this.lost(request, s.proposal))) continue;
        earlier = s;
        break;
      }
      if (earlier)
        return this.result(
          "new",
          store.insertSubmission({
            ...base,
            files: earlier.files,
            state: earlier.state,
            diagnostics: [],
            duplicateOf: earlier.submissionId,
            translator: earlier.translator,
            proposal: earlier.proposal,
          }),
          request,
        );
      const files: StoredFile[] = [];
      if (p.reply.kind === "turnaround" || p.reply.kind === "depth") {
        const measured = await this.measure(
          p.reply.image,
          ["reply", "image"],
          artLimits.replyBytes,
        );
        if ("code" in measured) return reject([measured]);
        files.push(measured);
        const shape = this.shape(request, p.reply.kind, measured);
        if (shape) return reject([shape], files);
      }
      const translator = this.translators.get(briefRoute(brief));
      if (!translator)
        return this.result(
          "new",
          store.insertSubmission({
            ...base,
            files,
            state: "recorded",
            diagnostics: [],
            duplicateOf: null,
            translator: null,
            proposal: null,
          }),
          request,
        );
      // A host before journal request IDs came from the reply derived them
      // from the submission ID. Its proposal, committed before it could record
      // the submission, is this submission's when nothing else claims it.
      const legacy = await this.legacyProposal(caller, request, p.submissionId);
      if (legacy) {
        const submission = store.insertSubmission({
          ...base,
          files,
          state: "proposed",
          diagnostics: [],
          duplicateOf: null,
          translator: translator.id,
          proposal: legacy,
        });
        if (link) await this.linkSteering(link, request, legacy.requestId);
        return this.result("new", submission, request);
      }
      const prepared = await this.prepare(caller, request, translator, p.reply, files);
      if (!prepared.ok) return reject(prepared.diagnostics, files);
      const credited = prepared.ops;
      const requestId = artCommandId(request.artId, via, caller.actor.id, digest);
      // A proposal committed for this very reply before the host stopped keeps its ID.
      const prior = await Effect.runPromise(project.receipt(brief.documentId, requestId));
      const proposalId = prior?.proposal?.id ?? (await this.nextProposal(request));
      const pending = store.insertPending({
        ...base,
        files,
        translator: translator.id,
        proposal: { id: proposalId, version: 1, requestId, baseRevision: brief.revision },
      });
      this.options.cut?.("submission-pending");
      let outcome: ApplyResult;
      try {
        outcome = await this.options.apply(
          caller,
          proposalCommand(request, p.reply, proposalId, requestId, credited, prepared.notes),
        );
      } catch (error) {
        // The commit may have landed before the failure: the journal decides.
        await this.settle([pending]);
        throw error;
      }
      this.options.cut?.("proposal-committed");
      if (outcome.kind === "rejected") {
        store.dropPending(request.artId, p.submissionId);
        return reject(outcome.diagnostics, files);
      }
      const submission = store.finishPending(request.artId, p.submissionId);
      this.options.cut?.("submission-recorded");
      if (link) await this.linkSteering(link, request, requestId);
      return this.result("new", submission, request);
    });
  }

  /**
   * Settle submissions left pending by a host that stopped mid-call. One
   * whose proposal the journal committed becomes the proposed submission and
   * is linked to its steering message; the rest are dropped, so a retry runs
   * them again.
   */
  private async settle(pending: ReadonlyArray<StoredPending>): Promise<number> {
    const { store, project } = this.options;
    let settled = 0;
    for (const p of pending) {
      const request = store.request(p.artId);
      if (!request) continue;
      const receipt = await Effect.runPromise(
        project.receipt(request.brief.documentId, p.proposal.requestId),
      );
      if (!receipt) {
        store.dropPending(p.artId, p.submissionId);
        continue;
      }
      store.finishPending(p.artId, p.submissionId);
      settled++;
      if (p.via === "agent" && p.pairingId === request.pairingId)
        await this.linkSteering(
          { agent: request.agent, pairingId: request.pairingId },
          request,
          p.proposal.requestId,
        );
    }
    return settled;
  }

  /**
   * After a restart: settle every pending submission, and link each open
   * request's latest proposal to its steering message if the host stopped
   * before it could.
   */
  async recover(): Promise<{ readonly settled: number; readonly linked: number }> {
    return this.serial(async () => {
      const { store, steering, pairings } = this.options;
      const settled = await this.settle(store.pending());
      let linked = 0;
      for (const request of store.requests({})) {
        if (request.closed || pairings.pairingId(request.agent) !== request.pairingId) continue;
        const latest = store
          .submissions(request.artId)
          .filter((s) => s.proposal !== null && s.via === "agent" && s.duplicateOf === null)
          .at(-1);
        if (!latest?.proposal) continue;
        let message: SteeringMessage;
        try {
          message = steering.get(request.messageId);
        } catch {
          continue;
        }
        if (message.closed || message.applied || message.report) continue;
        await this.linkSteering(
          { agent: request.agent, pairingId: request.pairingId },
          request,
          latest.proposal.requestId,
        );
        linked++;
      }
      return { settled, linked };
    });
  }

  /** The next free `prop-<art id>-<n>`, counting the log and the journal. */
  private async nextProposal(request: StoredRequest): Promise<string> {
    const { store, project } = this.options;
    const prefix = `prop-${request.artId}-`;
    const journal = await Effect.runPromise(project.inspect(request.brief.documentId));
    const used = [
      ...store.submissions(request.artId).flatMap((s) => (s.proposal ? [s.proposal.id] : [])),
      ...store.pending(request.artId).map((s) => s.proposal.id),
      ...journal.proposals.map((q) => q.id),
    ];
    let n = 0;
    for (const id of used)
      if (id.startsWith(prefix)) n = Math.max(n, Number(id.slice(prefix.length)) || 0);
    return prefix + String(n + 1);
  }

  /** The reply's operations on the brief's revision, with its credits, or why there are none. */
  private async prepare(
    caller: ArtCaller,
    request: StoredRequest,
    translator: ArtTranslator,
    reply: ArtReply,
    files: ReadonlyArray<StoredFile>,
  ): Promise<
    | {
        readonly ok: true;
        readonly ops: ReadonlyArray<Json>;
        readonly notes: ReadonlyArray<string>;
      }
    | { readonly ok: false; readonly diagnostics: ReadonlyArray<Diagnostic> }
  > {
    const brief = request.brief;
    const at = await Effect.runPromise(
      this.options.project.revision(brief.documentId, brief.revision),
    );
    if (!at)
      return {
        ok: false,
        diagnostics: [
          diagnostic("unknown-revision", ["brief", "revision"], "The brief's revision is gone."),
        ],
      };
    let ops: ReadonlyArray<Json>;
    let notes: ReadonlyArray<string> = [];
    const read = async (digest: string): Promise<Uint8Array> =>
      (await Effect.runPromise(this.options.project.blob(digest))).bytes;
    try {
      const made = await translator.translate({ brief, document: at.document, reply, files, read });
      if (isTranslation(made)) {
        ops = made.operations;
        notes = made.notes ?? [];
      } else ops = made;
    } catch (error) {
      // The translator cannot run now: nothing is recorded and a retry translates again.
      if (error instanceof ArtError) throw error;
      return {
        ok: false,
        diagnostics: [
          diagnostic(
            "schema",
            ["reply"],
            `${translator.id}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        ],
      };
    }
    if (ops.length === 0)
      return {
        ok: false,
        diagnostics: [diagnostic("no-change", ["reply"], "The reply changes nothing.")],
      };
    const credited = creditOperations(at.document, ops, {
      via: caller.role === "agent" ? "agent" : "person-import",
      submittedBy: caller.actor,
      artId: request.artId,
      kind: brief.kind,
      reply,
      shipped: (digest) => this.options.shipped?.(digest) ?? false,
    });
    if (!Array.isArray(credited)) return { ok: false, diagnostics: [credited] };
    return { ok: true, ops: credited, notes };
  }

  /**
   * True when the journal has neither the proposal a submission recorded nor
   * a receipt for its request: the project was restored from a backup taken
   * before it. A discarded or accepted proposal is still in the journal.
   */
  private async lost(
    request: StoredRequest,
    proposal: { readonly id: string; readonly requestId: string },
  ): Promise<boolean> {
    const { project } = this.options;
    const documentId = request.brief.documentId;
    const journal = await Effect.runPromise(project.inspect(documentId));
    if (journal.proposals.some((q) => q.id === proposal.id)) return false;
    return (await Effect.runPromise(project.receipt(documentId, proposal.requestId))) === undefined;
  }

  /** True when another submission of the same reply already has a proposal in the journal. */
  private async recovered(request: StoredRequest, seen: StoredSubmission): Promise<boolean> {
    for (const s of this.options.store.submissions(request.artId))
      if (
        s.submissionId !== seen.submissionId &&
        s.replyDigest === seen.replyDigest &&
        s.proposal &&
        !(await this.lost(request, s.proposal))
      )
        return true;
    return false;
  }

  /** Draft a recorded submission's lost proposal again under its recorded IDs. */
  private async redraft(
    caller: ArtCaller,
    request: StoredRequest,
    seen: StoredSubmission,
    proposal: { readonly id: string; readonly requestId: string },
  ): Promise<ReadonlyArray<Diagnostic>> {
    const translator = this.translators.get(briefRoute(request.brief));
    if (!translator)
      return [
        diagnostic(
          "schema",
          ["reply"],
          `This host has no translator for ${request.brief.kind}${request.brief.intent === "build" ? " build" : ""} replies.`,
        ),
      ];
    const prepared = await this.prepare(caller, request, translator, seen.reply, seen.files);
    if (!prepared.ok) return prepared.diagnostics;
    const outcome = await this.options.apply(
      caller,
      proposalCommand(
        request,
        seen.reply,
        proposal.id,
        proposal.requestId,
        prepared.ops,
        prepared.notes,
      ),
    );
    return outcome.kind === "rejected" ? outcome.diagnostics : [];
  }

  /**
   * The proposal an earlier host committed for this submission under its
   * submission-derived journal request ID, when it is unmistakably this
   * reply's: a proposal.create receipt for this request's proposal series,
   * authored by this caller on the brief's revision, that no recorded or
   * pending submission claims.
   */
  private async legacyProposal(
    caller: ArtCaller,
    request: StoredRequest,
    submissionId: string,
  ): Promise<
    | {
        readonly id: string;
        readonly version: number;
        readonly requestId: string;
        readonly baseRevision: number;
      }
    | undefined
  > {
    const { project, store } = this.options;
    const documentId = request.brief.documentId;
    const requestId = legacyArtCommandId(request.artId, submissionId);
    const receipt = await Effect.runPromise(project.receipt(documentId, requestId));
    const id = receipt?.proposal?.id;
    if (receipt?.command !== "proposal.create" || !id?.startsWith(`prop-${request.artId}-`))
      return undefined;
    const claimed = [...store.submissions(request.artId), ...store.pending(request.artId)].some(
      (s) => s.proposal?.id === id,
    );
    if (claimed) return undefined;
    const proposal = (await Effect.runPromise(project.inspect(documentId))).proposals.find(
      (q) => q.id === id,
    );
    if (
      !proposal ||
      !sameActor(proposal.author, caller.actor) ||
      proposal.baseRevision !== request.brief.revision
    )
      return undefined;
    return { id, version: 1, requestId, baseRevision: proposal.baseRevision };
  }

  /** The kind's picture shape: a square sheet, or a depth view framed like the front view. */
  private shape(
    request: StoredRequest,
    kind: "turnaround" | "depth",
    file: StoredFile,
  ): Diagnostic | undefined {
    const ratio = file.width / file.height;
    if (kind === "turnaround") {
      if (Math.min(file.width, file.height) < artLimits.sheetMinEdge)
        return diagnostic(
          "limit",
          ["reply", "image"],
          `A turnaround sheet needs at least ${artLimits.sheetMinEdge} pixels per edge, not ${file.width} × ${file.height}.`,
        );
      if (Math.abs(ratio - 1) > artLimits.sheetAspectTolerance)
        return diagnostic(
          "schema",
          ["reply", "image"],
          `A turnaround sheet is square 2x2, not ${file.width} × ${file.height}.`,
        );
      return undefined;
    }
    const index = request.brief.attachments.findIndex((a) => a.role === "front");
    const front = request.files[index];
    if (front && Math.abs(ratio - front.width / front.height) > artLimits.sheetAspectTolerance)
      return diagnostic(
        "schema",
        ["reply", "image"],
        `The depth image is ${file.width} × ${file.height}; frame it like the ${front.width} × ${front.height} front view.`,
      );
    return undefined;
  }

  /** Link the proposal to the steering message, acknowledging it first if the agent has not. */
  private async linkSteering(
    link: Pairing,
    request: StoredRequest,
    requestId: string,
  ): Promise<void> {
    const { steering } = this.options;
    try {
      const message = steering.get(request.messageId);
      if (!message.acknowledged) steering.ack(link, request.messageId);
      await steering.applied(link, {
        messageId: request.messageId,
        documentId: request.brief.documentId,
        requestId,
      });
    } catch (error) {
      // An already applied message keeps its link; the proposal stands on its own.
      if (!(error instanceof SteeringError)) throw error;
    }
  }

  // ── Views ───────────────────────────────────────────────────────────────

  private link(caller: ArtCaller): AgentLink {
    const link = caller.link;
    if (!link)
      throw new ArtError("Forbidden", "This art method is for a paired agent's connection.");
    if (this.options.pairings.pairingId(link.agent) !== link.pairingId)
      throw new ArtError(
        "CredentialRejected",
        `This connection's pairing for ${link.agent} was revoked or replaced. Use the agent's current credential.`,
      );
    return link;
  }

  /** A request this caller may see. Another agent's request, or an earlier pairing's, is missing. */
  private own(caller: ArtCaller, artId: string): StoredRequest {
    const request = this.options.store.request(artId);
    if (caller.role === "agent") {
      const link = this.link(caller);
      if (!request || request.agent !== link.agent)
        throw new ArtError("ArtMissing", `You have no art request ${artId}.`, { artId });
      if (request.pairingId !== link.pairingId)
        throw new ArtError(
          "Forbidden",
          `${artId} was sent to an earlier pairing of ${link.agent}.`,
          { artId },
        );
      return request;
    }
    if (!request) throw new ArtError("ArtMissing", `There is no art request ${artId}.`, { artId });
    return request;
  }

  private async result(
    outcome: "new" | "replayed",
    stored: StoredSubmission,
    request: StoredRequest,
  ): Promise<ArtSubmitResult> {
    const view = await this.view(this.options.store.request(request.artId) ?? request);
    const submission = view.submissions.find((s) => s.submissionId === stored.submissionId);
    if (!submission) throw new ArtError("HostFailed", "The submission was not stored.");
    return { outcome, submission, request: view };
  }

  private async view(request: StoredRequest): Promise<ArtRequestView> {
    const { project, steering, store } = this.options;
    const current = await Effect.runPromise(project.current(request.brief.documentId));
    const proposals = (await Effect.runPromise(project.inspect(request.brief.documentId)))
      .proposals;
    let status: SteeringStatus | null = null;
    try {
      status = steering.get(request.messageId).status;
    } catch {
      status = null;
    }
    const submissions: ArtSubmissionView[] = store.submissions(request.artId).map((s) => {
      const live = s.proposal ? proposals.find((q) => q.id === s.proposal?.id) : undefined;
      return {
        submissionId: s.submissionId,
        seq: s.seq,
        at: s.at,
        by: s.by,
        via: s.via,
        pairingId: s.pairingId,
        reply: s.reply,
        replyDigest: s.replyDigest,
        files: s.files,
        state: s.state,
        diagnostics: s.diagnostics,
        duplicateOf: s.duplicateOf,
        translator: s.translator,
        proposal: s.proposal
          ? {
              ...s.proposal,
              version: live?.version ?? s.proposal.version,
              status: live?.status ?? "missing",
              acceptedRevision: live?.acceptedRevision ?? null,
            }
          : null,
        source: s.source,
      };
    });
    return {
      artId: request.artId,
      seq: request.seq,
      agent: request.agent,
      pairingId: request.pairingId,
      requestId: request.requestId,
      messageId: request.messageId,
      steering: status ? { status } : null,
      brief: request.brief,
      attachments: request.brief.attachments.map((a, i) => {
        const f = request.files[i];
        return {
          role: a.role,
          label: a.label ?? null,
          digest: a.digest,
          mediaType: f?.mediaType ?? "",
          byteLength: f?.byteLength ?? 0,
          width: f?.width ?? 0,
          height: f?.height ?? 0,
        };
      }),
      createdAt: request.createdAt,
      createdBy: request.createdBy,
      state: request.closed
        ? "cancelled"
        : submissions.some((s) => s.state !== "rejected")
          ? "answered"
          : "open",
      closed: request.closed,
      head: current.revision,
      stale: current.revision > request.brief.revision,
      apply: this.apply(briefRoute(request.brief)),
      submissions,
    };
  }

  /** Requests and replies are checked and written one at a time. */
  private serial<T>(step: () => Promise<T>): Promise<T> {
    const run = this.queue.then(step, step);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
