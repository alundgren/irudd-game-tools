// Art direction: a person asks the paired agent for artwork with a typed,
// versioned brief, and the agent answers in the same conversation.
//
//   art.capabilities  which kinds this host can turn into a proposal, and why not
//   art.put           stage image bytes (editor views, a generated sheet) in chunks
//   art.request       people: send a brief to one paired agent's conversation
//   art.list/get      the requests, their attachments and every submission
//   art.read          bytes of an attachment or submitted file of one request
//   art.submit        the agent's reply (or a person's imported file)
//   art.cancel        people: close a request; later replies are refused
//
// The host never generates anything and never starts a model session. Image
// generation, tracing and depth estimation belong to the paired agent; when
// it lacks a capability, the person can save the brief and import a file.
// A reply becomes a proposal on the brief's revision, authored by whoever
// submitted it, so it stays reviewable, discardable and undoable like any
// other proposal, including when the person edited the head meanwhile.
// Pure: no Node and no storage, so the desktop renderer may import it.

import { Schema } from "effect";
import {
  Actor,
  AssetAttribution,
  Digest,
  DocumentId,
  JsonValue,
  PartId,
  RequestId,
} from "@irudd/document";
import type { Diagnostic } from "@irudd/document";
import { AgentId } from "./ids.js";

export const artBriefFormat = "irudd.art-brief";
export const artReplyFormat = "irudd.art-reply";
export const traceMapFormat = "irudd.trace-map.v1";

/**
 * - `variation`: new or changed geometry as document operations.
 * - `turnaround`: a 2x2 orthographic sheet (front, right, back, left on magenta) that repaints painted regions.
 * - `trace`: an `irudd.trace-map.v1` of corresponding front and profile regions.
 * - `depth`: a front-view grayscale depth image of a painted portrait.
 */
export const artKinds = ["variation", "turnaround", "trace", "depth"] as const;
export type ArtKind = (typeof artKinds)[number];

/**
 * What a trace reply does, chosen by the person:
 * - `fit` (also every brief without an intent): the map's region for the one
 *   named painted part calibrates its face and adds depth pins.
 * - `build`: the map's regions become new editable parts, painted from the
 *   named part's sheet and placed under their parent regions.
 */
export const traceIntents = ["fit", "build"] as const;
export type TraceIntent = (typeof traceIntents)[number];

export const attachmentRoles = [
  "whole",
  "close-up",
  "front",
  "side",
  "back",
  "source-sheet",
  "reference",
] as const;
export type AttachmentRole = (typeof attachmentRoles)[number];

/** Image media types a brief or reply may carry. */
export const artImageTypes = ["image/png", "image/jpeg", "image/webp"] as const;
/** Limits on staged art bytes and their pictures. */
export const artLimits = {
  attachments: 8,
  attachmentBytes: 16 * 1024 * 1024,
  replyBytes: 32 * 1024 * 1024,
  minEdge: 64,
  maxEdge: 8192,
  /** A turnaround sheet's shorter edge, and how far it may be from square. */
  sheetMinEdge: 512,
  sheetAspectTolerance: 0.02,
  /** Chunk size for art.put and art.read, before base64. */
  chunkBytes: 4 * 1024 * 1024,
  operations: 512,
} as const;

const Text = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max));
const Label = Schema.String.check(Schema.isMaxLength(120));
const Unit = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }));
const Height = Schema.Number.check(Schema.isBetween({ minimum: 0.15, maximum: 6 }));
const Revision = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
);

export const ArtId = Schema.String.check(
  Schema.isPattern(/^art-[0-9a-f]{24}$/, { message: "Use an art request ID like art-…" }),
);
export type ArtId = typeof ArtId.Type;

export const ArtAttachment = Schema.Struct({
  role: Schema.Literals(attachmentRoles),
  /** A blob staged with art.put. */
  digest: Digest,
  label: Schema.optionalKey(Label),
});
export type ArtAttachment = typeof ArtAttachment.Type;

/** What the person asks for. Version 1. */
export const ArtBrief = Schema.Struct({
  format: Schema.Literal(artBriefFormat),
  version: Schema.Literal(1),
  kind: Schema.Literals(artKinds),
  documentId: DocumentId,
  /** The committed revision the attached views show and the reply is drafted against. */
  revision: Revision,
  direction: Text(4000),
  attachments: Schema.Array(ArtAttachment).check(Schema.isMaxLength(artLimits.attachments)),
  /** Turnaround: the painted regions to repaint, all from one sheet. Variation: the parts to change. */
  parts: Schema.optionalKey(Schema.Array(PartId).check(Schema.isMaxLength(128))),
  /** Standing height (or the isolated part's height) in metres. */
  height: Schema.optionalKey(Height),
  /** Trace: region IDs the new map keeps at matching places. */
  protected: Schema.optionalKey(Schema.Array(Text(64)).check(Schema.isMaxLength(32))),
  /** Trace only: fit the named part (the default) or build the map's regions as new parts. */
  intent: Schema.optionalKey(Schema.Literals(traceIntents)),
}).check(
  Schema.makeFilter(
    (b) =>
      b.intent === undefined ||
      b.kind === "trace" ||
      "Only a trace brief has an intent: fit the named part or build the map's regions.",
  ),
);
export type ArtBrief = typeof ArtBrief.Type;

/** The trace intent of a brief: `fit` unless it asks to build. */
export const briefIntent = (brief: ArtBrief): TraceIntent | undefined =>
  brief.kind === "trace" ? (brief.intent ?? "fit") : undefined;

// ── Trace map ───────────────────────────────────────────────────────────────

const Point = Schema.Tuple([Unit, Unit]);
const Outline = Schema.Array(Point).check(Schema.isMinLength(4), Schema.isMaxLength(12));
const SpinePoint = Schema.Tuple([
  Unit,
  Unit,
  Unit,
  Unit,
  Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 0.5 })),
  Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 0.5 })),
]);
const RegionId = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/, {
    message: "Use a region ID of up to 64 letters, digits, spaces, dots or dashes.",
  }),
);

export const TraceRegion = Schema.Struct({
  id: RegionId,
  parent: Schema.optionalKey(RegionId),
  method: Schema.Literals(["loft", "volume", "path", "membrane"]),
  front: Schema.optionalKey(Outline),
  side: Schema.optionalKey(Outline),
  spine: Schema.optionalKey(
    Schema.Array(SpinePoint).check(Schema.isMinLength(4), Schema.isMaxLength(12)),
  ),
  correspondence: Schema.optionalKey(Schema.Literals(["same", "opposite"])),
  thickness: Schema.optionalKey(
    Schema.Number.check(Schema.isBetween({ minimum: 0.006, maximum: 0.04 })),
  ),
  outfitRole: Schema.optionalKey(Label),
  motionRole: Schema.optionalKey(Label),
  faceLandmarks: Schema.optionalKey(
    Schema.Array(Point).check(Schema.isMinLength(5), Schema.isMaxLength(5)),
  ),
  depthPairs: Schema.optionalKey(
    Schema.Array(
      Schema.Tuple([
        Unit,
        Unit,
        Unit,
        Unit,
        Schema.Number.check(Schema.isBetween({ minimum: 0.06, maximum: 0.25 })),
      ]),
    ).check(Schema.isMaxLength(8)),
  ),
}).check(
  Schema.makeFilter((r) => {
    if (r.method === "path")
      return r.spine !== undefined || "A path region lists its spine from socket to tip.";
    if (r.front === undefined || r.side === undefined)
      return `Region ${r.id} needs front and side outlines.`;
    return true;
  }),
);
export type TraceRegion = typeof TraceRegion.Type;

export const TraceMap = Schema.Struct({
  format: Schema.Literal(traceMapFormat),
  height: Height,
  regions: Schema.Array(TraceRegion).check(Schema.isMinLength(1), Schema.isMaxLength(24)),
}).check(
  Schema.makeFilter((map) => {
    const ids = new Set<string>();
    for (const r of map.regions) {
      if (ids.has(r.id)) return `Region ${r.id} appears twice.`;
      ids.add(r.id);
    }
    const parents = new Map(map.regions.map((r) => [r.id, r.parent]));
    for (const r of map.regions) {
      if (r.parent !== undefined && !ids.has(r.parent))
        return `Region ${r.id} names a missing parent ${r.parent}.`;
      const seen = new Set<string>();
      let at: string | undefined = r.id;
      while (at !== undefined) {
        if (seen.has(at)) return `Regions ${[...seen].join(", ")} form a cycle.`;
        seen.add(at);
        at = parents.get(at);
      }
    }
    return true;
  }),
);
export type TraceMap = typeof TraceMap.Type;

// ── Replies ─────────────────────────────────────────────────────────────────

const Summary = Text(400);
const replyHeader = {
  format: Schema.Literal(artReplyFormat),
  version: Schema.Literal(1),
  summary: Summary,
  /**
   * What the submitter states about the picture's rights: credit text, a
   * licence and a source. An accepted reply carries it, with its author, into
   * the document's `irudd.asset-credits` and from there into exports.
   */
  attribution: Schema.optionalKey(AssetAttribution),
};

/** What the agent answers. The image is a blob it staged with art.put. Version 1. */
export const ArtReply = Schema.Union([
  Schema.Struct({
    ...replyHeader,
    kind: Schema.Literal("variation"),
    /** Document operations against the brief's revision. */
    operations: Schema.Array(JsonValue).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(artLimits.operations),
    ),
  }),
  Schema.Struct({
    ...replyHeader,
    kind: Schema.Literal("turnaround"),
    image: Digest,
    height: Schema.optionalKey(Height),
    /** Wearables: open-front or strappy garments, or a fully covered front and back. */
    coverage: Schema.optionalKey(Schema.Literals(["open", "closed"])),
  }),
  Schema.Struct({ ...replyHeader, kind: Schema.Literal("trace"), traceMap: TraceMap }),
  Schema.Struct({ ...replyHeader, kind: Schema.Literal("depth"), image: Digest }),
]);
export type ArtReply = typeof ArtReply.Type;

// ── Methods ─────────────────────────────────────────────────────────────────

const Offset = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** Parameter schemas of the art methods; `wire/protocol.ts` merges them into the method table. */
export const artParams = {
  "art.capabilities": Schema.Struct({}),
  /** Stage bytes in order. The last chunk verifies and stores them as a project blob. */
  "art.put": Schema.Struct({
    digest: Digest,
    mediaType: Schema.Literals(artImageTypes),
    offset: Offset,
    total: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: artLimits.replyBytes })),
    base64: Schema.String.check(Schema.isMaxLength(Math.ceil(artLimits.chunkBytes / 3) * 4)),
  }),
  /** People only. A repeated request ID for the same agent returns the same request. */
  "art.request": Schema.Struct({ agent: AgentId, requestId: RequestId, brief: ArtBrief }),
  "art.list": Schema.Struct({
    documentId: Schema.optionalKey(DocumentId),
    /** Include cancelled requests (default: only open and answered ones). */
    all: Schema.optionalKey(Schema.Boolean),
  }),
  "art.get": Schema.Struct({ artId: ArtId }),
  /** An attachment or submitted file of this request, in chunks. */
  "art.read": Schema.Struct({
    artId: ArtId,
    digest: Digest,
    offset: Schema.optionalKey(Offset),
    length: Schema.optionalKey(
      Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: artLimits.chunkBytes })),
    ),
  }),
  /**
   * The agent's reply, or a person importing a file the agent could not make.
   * `submissionId` makes a retry safe: the same ID and reply replay the result.
   */
  "art.submit": Schema.Struct({ artId: ArtId, submissionId: RequestId, reply: ArtReply }),
  /** People only: close the request. A delivered message stays in the conversation. */
  "art.cancel": Schema.Struct({ artId: ArtId }),
} as const;

export const artAgentMethods = [
  "art.capabilities",
  "art.put",
  "art.list",
  "art.get",
  "art.read",
  "art.submit",
] as const;

// ── Views ───────────────────────────────────────────────────────────────────

/** A staged picture, as the host measured it from its bytes. */
export interface ArtFile {
  readonly digest: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
}

export interface ArtAttachmentView extends ArtFile {
  readonly role: AttachmentRole;
  readonly label: string | null;
}

/** Whether this host turns a kind's reply into a proposal. */
export interface ArtApply {
  readonly available: boolean;
  /** The translator that makes the operations, such as `repaint`. */
  readonly translator: string | null;
  /** When unavailable: why, and what a person can do. */
  readonly reason?: string;
  readonly actions?: ReadonlyArray<string>;
}

export interface ArtCapabilities {
  /**
   * Every kind's brief and reply are typed and validated; `apply` says
   * whether a reply becomes a proposal here. For trace, `apply` is the
   * default fit and `intents` says the same for each intent a brief can ask.
   */
  readonly kinds: ReadonlyArray<{
    readonly kind: ArtKind;
    readonly apply: ArtApply;
    readonly intents?: ReadonlyArray<{ readonly intent: TraceIntent; readonly apply: ArtApply }>;
  }>;
  /** Who makes the artwork: always the paired agent, in its own conversation. */
  readonly producer: "paired-agent";
  readonly limits: typeof artLimits;
  readonly formats: { readonly brief: string; readonly reply: string; readonly traceMap: string };
}

export interface ArtPutResult {
  readonly digest: string;
  readonly received: number;
  readonly total: number;
  /** Set on the last chunk: the verified blob. */
  readonly stored: (ArtFile & { readonly stored: "new" | "existing" }) | null;
}

export type ArtSubmissionState =
  /** The reply became a proposal on the brief's revision. */
  | "proposed"
  /** The reply is valid and kept, but this host has no translator for its kind. */
  | "recorded"
  /** The reply was invalid; nothing was proposed. */
  | "rejected";

export interface ArtProposalLink {
  readonly id: string;
  readonly version: number;
  /** The proposal.create request, in the document journal. */
  readonly requestId: string;
  readonly baseRevision: number;
  /** Live from the journal: draft, accepted, discarded. */
  readonly status: string;
  readonly acceptedRevision: number | null;
}

export interface ArtSubmissionView {
  readonly submissionId: string;
  readonly seq: number;
  readonly at: number;
  /** Who submitted: the paired agent or a person importing a file. */
  readonly by: Actor;
  readonly via: "agent" | "person-import";
  readonly pairingId: string | null;
  /** The reply exactly as submitted. */
  readonly reply: ArtReply;
  /** SHA-256 of the reply's canonical JSON, for duplicate detection. */
  readonly replyDigest: string;
  /** Files the reply names, measured from their verified bytes. */
  readonly files: ReadonlyArray<ArtFile>;
  readonly state: ArtSubmissionState;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  /** Set when an earlier submission of this request carried the same reply. */
  readonly duplicateOf: string | null;
  readonly translator: string | null;
  readonly proposal: ArtProposalLink | null;
  /** The brief's revision, the head when the reply arrived and whether the head had moved past it. */
  readonly source: {
    readonly baseRevision: number;
    readonly headAtSubmit: number;
    readonly stale: boolean;
  };
}

export type ArtState = "open" | "answered" | "cancelled";

export interface ArtRequestView {
  readonly artId: string;
  readonly seq: number;
  readonly agent: string;
  readonly pairingId: string;
  readonly requestId: string;
  /** The steering message that carried the brief to the conversation. */
  readonly messageId: string;
  readonly steering: { readonly status: string } | null;
  readonly brief: ArtBrief;
  readonly attachments: ReadonlyArray<ArtAttachmentView>;
  readonly createdAt: number;
  readonly createdBy: Actor;
  readonly state: ArtState;
  readonly closed: { readonly at: number; readonly detail: string } | null;
  /** The document head now, and whether it moved past the brief's revision. */
  readonly head: number;
  readonly stale: boolean;
  readonly apply: ArtApply;
  readonly submissions: ReadonlyArray<ArtSubmissionView>;
}

export interface ArtReadView {
  readonly digest: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly offset: number;
  readonly base64: string;
  readonly done: boolean;
}

export interface ArtSubmitResult {
  /** `new`: stored now. `replayed`: this submission ID was seen with the same reply. */
  readonly outcome: "new" | "replayed";
  readonly submission: ArtSubmissionView;
  readonly request: ArtRequestView;
}

export interface ArtMethodResults {
  readonly "art.capabilities": ArtCapabilities;
  readonly "art.put": ArtPutResult;
  readonly "art.request": ArtRequestView;
  readonly "art.list": { readonly requests: ReadonlyArray<ArtRequestView> };
  readonly "art.get": ArtRequestView;
  readonly "art.read": ArtReadView;
  readonly "art.submit": ArtSubmitResult;
  readonly "art.cancel": ArtRequestView;
}

export const artErrorTags = [
  "ArtMissing",
  "ArtClosed",
  "ArtRejected",
  "UploadIncomplete",
  "RequestConflict",
] as const;
