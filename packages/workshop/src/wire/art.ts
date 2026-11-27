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

export const artKinds = ["variation", "turnaround", "trace", "depth"] as const;
export type ArtKind = (typeof artKinds)[number];

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

export const artImageTypes = ["image/png", "image/jpeg", "image/webp"] as const;
export const artLimits = {
  attachments: 8,
  attachmentBytes: 16 * 1024 * 1024,
  replyBytes: 32 * 1024 * 1024,
  minEdge: 64,
  maxEdge: 8192,
  sheetMinEdge: 512,
  sheetAspectTolerance: 0.02,
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
  digest: Digest,
  label: Schema.optionalKey(Label),
});
export type ArtAttachment = typeof ArtAttachment.Type;

export const ArtBrief = Schema.Struct({
  format: Schema.Literal(artBriefFormat),
  version: Schema.Literal(1),
  kind: Schema.Literals(artKinds),
  documentId: DocumentId,
  revision: Revision,
  direction: Text(8000),
  fromSteer: Schema.optionalKey(Schema.Literal(true)),
  variation: Schema.optionalKey(
    Schema.Struct({
      strength: Schema.Literals(["subtle", "exploratory", "radical"]),
      seed: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 0xffffffff })),
      magnitude: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
      cues: Schema.Array(Text(96)).check(Schema.isMaxLength(2)),
      choices: Schema.Array(Schema.Struct({ label: Text(48), value: Text(96) })).check(
        Schema.isMaxLength(8),
      ),
    }),
  ),
  attachments: Schema.Array(ArtAttachment).check(Schema.isMaxLength(artLimits.attachments)),
  parts: Schema.optionalKey(Schema.Array(PartId).check(Schema.isMaxLength(128))),
  height: Schema.optionalKey(Height),
  protected: Schema.optionalKey(Schema.Array(Text(64)).check(Schema.isMaxLength(32))),
  refinement: Schema.optionalKey(
    Schema.Struct({
      proposal: Text(128),
      version: Revision,
      summary: Schema.String.check(Schema.isMaxLength(500)),
      earlierDirection: Schema.String.check(Schema.isMaxLength(8000)),
      exportReview: Schema.optionalKey(JsonValue),
      spatialGuide: Schema.optionalKey(JsonValue),
      surfaceMarks: Schema.optionalKey(JsonValue),
    }),
  ),
  nudge: Schema.optionalKey(
    Schema.Struct({
      target: Schema.NullOr(PartId),
      amounts: Schema.Record(
        Label,
        Schema.Int.check(Schema.isBetween({ minimum: -40, maximum: 40 })),
      ),
    }),
  ),
  paintAction: Schema.optionalKey(Schema.Literals(["whole", "replace", "wear", "revise", "scalp"])),
  intent: Schema.optionalKey(Schema.Literals(traceIntents)),
}).check(
  Schema.makeFilter(
    (b) =>
      b.fromSteer ||
      b.direction.length <= 4000 ||
      "Keep the artwork direction under 4000 characters.",
  ),
  Schema.makeFilter(
    (b) =>
      b.kind === "variation" ||
      (b.kind === "turnaround" && !b.fromSteer) ||
      (!b.variation && !b.fromSteer) ||
      "Choose a variation brief for a drawn direction.",
  ),
  Schema.makeFilter(
    (b) => !b.refinement || b.kind === "variation" || "A refinement takes variation operations.",
  ),
  Schema.makeFilter(
    (b) =>
      !b.nudge ||
      b.kind === "turnaround" ||
      b.kind === "depth" ||
      "Supply a nudge with a painted or depth edit.",
  ),
  Schema.makeFilter(
    (b) => !b.paintAction || b.kind === "turnaround" || "Choose a turnaround for a painted edit.",
  ),
  Schema.makeFilter(
    (b) =>
      b.intent === undefined ||
      b.kind === "trace" ||
      "Only a trace brief has an intent: fit the named part or build the map's regions.",
  ),
);
export type ArtBrief = typeof ArtBrief.Type;

export const briefIntent = (brief: ArtBrief): TraceIntent | undefined =>
  brief.kind === "trace" ? (brief.intent ?? "fit") : undefined;

const Point = Schema.Tuple([Unit, Unit]);
const Outline = Schema.Array(Point).check(
  Schema.isMaxLength(12),
  Schema.makeFilter(
    (points) =>
      !points.length || points.length >= 4 || "Supply at least four points for an outline.",
  ),
);
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
  hairRegions: Schema.optionalKey(
    Schema.Array(Schema.Struct({ id: RegionId, front: Outline, side: Outline })).check(
      Schema.isMaxLength(24),
    ),
  ),
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

const Summary = Text(400);
const replyHeader = {
  format: Schema.Literal(artReplyFormat),
  version: Schema.Literal(1),
  summary: Summary,
  attribution: Schema.optionalKey(AssetAttribution),
};

export const ArtReply = Schema.Union([
  Schema.Struct({
    ...replyHeader,
    kind: Schema.Literal("variation"),
    operations: Schema.Array(JsonValue).check(Schema.isMaxLength(artLimits.operations)),
  }),
  Schema.Struct({
    ...replyHeader,
    kind: Schema.Literal("turnaround"),
    image: Digest,
    height: Schema.optionalKey(Height),
    traceMap: Schema.optionalKey(TraceMap),
    coverage: Schema.optionalKey(Schema.Literals(["open", "closed"])),
  }),
  Schema.Struct({ ...replyHeader, kind: Schema.Literal("trace"), traceMap: TraceMap }),
  Schema.Struct({ ...replyHeader, kind: Schema.Literal("depth"), image: Digest }),
]);
export type ArtReply = typeof ArtReply.Type;

const Offset = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const artParams = {
  "art.capabilities": Schema.Struct({}),
  "art.put": Schema.Struct({
    digest: Digest,
    mediaType: Schema.Literals(artImageTypes),
    offset: Offset,
    total: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: artLimits.replyBytes })),
    base64: Schema.String.check(Schema.isMaxLength(Math.ceil(artLimits.chunkBytes / 3) * 4)),
  }),
  "art.request": Schema.Struct({
    agent: AgentId,
    requestId: RequestId,
    brief: ArtBrief,
    offline: Schema.optionalKey(Schema.Boolean),
  }),
  "art.list": Schema.Struct({
    documentId: Schema.optionalKey(DocumentId),
    all: Schema.optionalKey(Schema.Boolean),
  }),
  "art.get": Schema.Struct({ artId: ArtId }),
  "art.read": Schema.Struct({
    artId: ArtId,
    digest: Digest,
    offset: Schema.optionalKey(Offset),
    length: Schema.optionalKey(
      Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: artLimits.chunkBytes })),
    ),
  }),
  "art.submit": Schema.Struct({ artId: ArtId, submissionId: RequestId, reply: ArtReply }),
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

export interface ArtApply {
  readonly available: boolean;
  readonly translator: string | null;
  readonly reason?: string;
  readonly actions?: ReadonlyArray<string>;
}

export interface ArtCapabilities {
  readonly kinds: ReadonlyArray<{
    readonly kind: ArtKind;
    readonly apply: ArtApply;
    readonly intents?: ReadonlyArray<{ readonly intent: TraceIntent; readonly apply: ArtApply }>;
  }>;
  readonly producer: "paired-agent";
  readonly limits: typeof artLimits;
  readonly formats: { readonly brief: string; readonly reply: string; readonly traceMap: string };
}

export interface ArtPutResult {
  readonly digest: string;
  readonly received: number;
  readonly total: number;
  readonly stored: (ArtFile & { readonly stored: "new" | "existing" }) | null;
}

export type ArtSubmissionState = "proposed" | "recorded" | "rejected";

export interface ArtProposalLink {
  readonly id: string;
  readonly version: number;
  readonly requestId: string;
  readonly baseRevision: number;
  readonly status: string;
  readonly acceptedRevision: number | null;
}

export interface ArtSubmissionView {
  readonly submissionId: string;
  readonly seq: number;
  readonly at: number;
  readonly by: Actor;
  readonly via: "agent" | "person-import";
  readonly pairingId: string | null;
  readonly reply: ArtReply;
  readonly replyDigest: string;
  readonly files: ReadonlyArray<ArtFile>;
  readonly state: ArtSubmissionState;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly duplicateOf: string | null;
  readonly translator: string | null;
  readonly proposal: ArtProposalLink | null;
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
  readonly messageId: string;
  readonly steering: { readonly status: string; readonly proposalId?: string } | null;
  readonly brief: ArtBrief;
  readonly attachments: ReadonlyArray<ArtAttachmentView>;
  readonly createdAt: number;
  readonly createdBy: Actor;
  readonly state: ArtState;
  readonly closed: { readonly at: number; readonly detail: string } | null;
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
