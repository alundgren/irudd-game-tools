import { Schema } from "effect";
import { DocumentId, JsonValue } from "@irudd/document";

export const reviewPresets = ["clay", "full", "game", "portrait"] as const;
export type ReviewPreset = (typeof reviewPresets)[number];

export const reviewSheets = ["body", "portrait", "motion", "expressions", "silhouette"] as const;
export type ReviewSheet = (typeof reviewSheets)[number];
export const defaultReviewSheets: ReadonlyArray<ReviewSheet> = ["body", "portrait", "silhouette"];

export const maxReviewEdge = 4096;
export const maxReadBytes = 8 * 1024 * 1024;
export const putChunkBytes = 4 * 1024 * 1024;

const Sha256 = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{64}$/, { message: "Use the artifact's sha256 (64 hex digits)." }),
);
const Name = Schema.String.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9._-]{0,95}$/, { message: "Use a lowercase output name." }),
);
const JobId = Schema.String.check(
  Schema.isPattern(/^job-[0-9a-f]{24}$/, { message: "Use the job ID from the review-job event." }),
);
const Token = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9 ._:/()+-]{0,200}$/));
const Fraction = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }));
const Unit = Schema.Number.check(Schema.isBetween({ minimum: -1, maximum: 1 }));
const Revision = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
);
const Preset = Schema.Literals(reviewPresets);

export const ReviewShot = Schema.Struct({
  view: Token,
  clip: Schema.optionalKey(Schema.NullOr(Schema.String.check(Schema.isMaxLength(120)))),
  time: Schema.optionalKey(Fraction),
  surface: Schema.optionalKey(Token),
  morph: Schema.optionalKey(Schema.NullOr(Schema.String.check(Schema.isMaxLength(120)))),
  angle: Schema.optionalKey(
    Schema.Struct({
      yaw: Schema.Number.check(Schema.isBetween({ minimum: -180, maximum: 180 })),
      pitch: Schema.Number.check(Schema.isBetween({ minimum: -80, maximum: 80 })),
    }),
  ),
  gaze: Schema.optionalKey(Schema.Struct({ x: Unit, y: Unit })),
  light: Schema.optionalKey(Token),
});
export type ReviewShot = typeof ReviewShot.Type;

const GpuInfo = Schema.Struct({
  vendor: Schema.String,
  renderer: Schema.String,
  webgl: Schema.String,
  software: Schema.Boolean,
});

export const RendererInfo = Schema.Struct({
  kind: Schema.Literals(["desktop-worker"]),
  build: Token,
  versions: Schema.Struct({ electron: Token, chrome: Token }),
  gpu: GpuInfo,
  supports: Schema.Struct({
    views: Schema.Array(Token),
    portraitViews: Schema.Array(Token),
    surfaces: Schema.Array(Token),
    lights: Schema.Array(Token),
    pixelRatios: Schema.Array(Schema.Int),
    maxEdge: Schema.Int,
  }),
});
export type RendererInfo = typeof RendererInfo.Type;

const Target = {
  documentId: DocumentId,
  revision: Schema.optionalKey(Revision),
  preset: Preset,
  staticMesh: Schema.optionalKey(Schema.Boolean),
};

export const reviewParams = {
  "review.capabilities": Schema.Struct({}),
  "review.export": Schema.Struct({
    ...Target,
    wardrobe: Schema.optionalKey(Schema.Boolean),
  }),
  "review.inspect": Schema.Struct({
    ...Target,
    sheets: Schema.optionalKey(
      Schema.Array(Schema.Literals(reviewSheets)).check(Schema.isMaxLength(reviewSheets.length)),
    ),
    shots: Schema.optionalKey(Schema.Array(ReviewShot).check(Schema.isMaxLength(24))),
    width: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 64, maximum: 2048 }))),
    height: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 64, maximum: 2048 }))),
    pixelRatio: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 3 }))),
    light: Schema.optionalKey(Token),
  }),
  "review.read": Schema.Struct({
    sha256: Sha256,
    offset: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
    length: Schema.optionalKey(
      Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: maxReadBytes })),
    ),
  }),
  "review.serve": Schema.Struct({ renderer: RendererInfo }),
  "review.put": Schema.Struct({
    jobId: JobId,
    name: Name,
    offset: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    total: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 256 * 1024 * 1024 })),
    base64: Schema.String.check(Schema.isMaxLength(Math.ceil(putChunkBytes / 3) * 4)),
  }),
  "review.complete": Schema.Struct({
    jobId: JobId,
    ok: Schema.Boolean,
    result: Schema.optionalKey(JsonValue),
    error: Schema.optionalKey(Schema.Struct({ tag: Token, message: Schema.String })),
  }),
} as const;

export const reviewAgentMethods = [
  "review.capabilities",
  "review.export",
  "review.inspect",
  "review.read",
] as const;

export interface RenderJob {
  readonly jobId: string;
  readonly kind: "export" | "inspect";
  readonly documentId: string;
  readonly revision: number;
  readonly documentDigest: string;
  readonly document: unknown;
  readonly preset: ReviewPreset;
  readonly wardrobe?: true;
  readonly staticMesh?: true;
  readonly blobs: ReadonlyArray<{ readonly digest: string; readonly mediaType: string }>;
  readonly inspect?: {
    readonly sheets: ReadonlyArray<ReviewSheet>;
    readonly shots: ReadonlyArray<ReviewShot>;
    readonly width: number;
    readonly height: number;
    readonly pixelRatio: number;
    readonly light: string;
  };
}

export const ReviewJobEvent = Schema.Struct({
  t: Schema.Literal("event"),
  event: Schema.Literal("review-job"),
  job: JsonValue,
  blobs: Schema.Record(Schema.String, Schema.String),
});
export type ReviewJobEvent = typeof ReviewJobEvent.Type;

export interface RenderedImage {
  readonly name: string;
  readonly kind: "body" | "portrait" | "motion" | "expression" | "silhouette" | "custom";
  readonly width: number;
  readonly height: number;
  readonly recipe: Record<string, unknown>;
  readonly render: { readonly calls: number; readonly triangles: number };
  readonly silhouette?: {
    readonly coverage: number;
    readonly bbox: readonly [number, number, number, number] | null;
  };
}

export interface RenderResult {
  readonly glb: string;
  readonly exportMs: number;
  readonly credits: ReadonlyArray<string>;
  readonly inventory: unknown;
  readonly gpu: { readonly vendor: string; readonly renderer: string; readonly software: boolean };
  readonly inspection?: {
    readonly model: unknown;
    readonly motion: unknown;
    readonly images: ReadonlyArray<RenderedImage>;
    readonly readiness: Record<string, unknown>;
    readonly renderMs: number;
    readonly notes: ReadonlyArray<string>;
  };
}

export interface RendererView {
  readonly id: string;
  readonly via: "in-process" | "attached";
  readonly info: RendererInfo;
  readonly registeredAt: number;
}

export interface ReviewCapabilities {
  readonly available: boolean;
  readonly renderer: RendererView | null;
  readonly presets: ReadonlyArray<ReviewPreset>;
  readonly sheets: ReadonlyArray<ReviewSheet>;
  readonly queue: { readonly running: number; readonly waiting: number };
  readonly reason?: string;
  readonly actions?: ReadonlyArray<string>;
}

export interface ReviewSource {
  readonly documentId: string;
  readonly revision: number;
  readonly requested: number | "head";
  readonly documentDigest: string;
  readonly head: { readonly atRequest: number; readonly atCompletion: number };
  readonly headMoved: boolean;
}

export interface ReviewArtifact {
  readonly sha256: string;
  readonly mediaType: string;
  readonly byteLength: number;
}

export interface ExportView {
  readonly format: "irudd.review-export";
  readonly version: 1;
  readonly source: ReviewSource;
  readonly preset: ReviewPreset;
  readonly wardrobe: { readonly looks: ReadonlyArray<string> } | null;
  readonly glb: ReviewArtifact;
  readonly provenance: unknown;
  readonly credits: ReadonlyArray<string>;
  readonly inventory: unknown;
  readonly renderer: RendererView;
  readonly gpu: RenderResult["gpu"];
  readonly repeat: { readonly previous: string; readonly identical: boolean } | null;
  readonly timing: {
    readonly queuedMs: number;
    readonly exportMs: number;
    readonly totalMs: number;
  };
}

export interface InspectImage extends RenderedImage, ReviewArtifact {}

export interface InspectReviewView extends Omit<ExportView, "format"> {
  readonly format: "irudd.review-inspection";
  readonly model: unknown;
  readonly motion: unknown;
  readonly metrics: ReviewMetrics;
  readonly images: ReadonlyArray<InspectImage>;
  readonly readiness: Record<string, unknown>;
  readonly notes: ReadonlyArray<string>;
  readonly recipe: NonNullable<RenderJob["inspect"]>;
  readonly timing: ExportView["timing"] & { readonly renderMs: number };
}

export interface ReviewMetrics {
  readonly geometry: {
    readonly vertices: number;
    readonly triangles: number;
    readonly regions: number;
    readonly bounds: unknown;
  };
  readonly textures: {
    readonly images: number;
    readonly bytes: number;
    readonly largest: { readonly width: number; readonly height: number } | null;
    readonly texturedMaterials: number;
  };
  readonly rig: { readonly joints: number; readonly morphTargets: number; readonly clips: number };
  readonly materials: { readonly count: number; readonly names: ReadonlyArray<string> };
}

export interface ReadView {
  readonly sha256: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly offset: number;
  readonly base64: string;
  readonly done: boolean;
}

export interface ReviewMethodResults {
  readonly "review.capabilities": ReviewCapabilities;
  readonly "review.export": ExportView;
  readonly "review.inspect": InspectReviewView;
  readonly "review.read": ReadView;
  readonly "review.serve": { readonly serving: true; readonly renderer: RendererView };
  readonly "review.put": {
    readonly jobId: string;
    readonly name: string;
    readonly received: number;
  };
  readonly "review.complete": { readonly jobId: string; readonly accepted: boolean };
}

export const reviewErrorTags = [
  "RendererUnavailable",
  "RendererLost",
  "RenderFailed",
  "RenderTimeout",
  "ReviewMismatch",
  "ArtifactUnknown",
  "RevisionMissing",
  "JobUnknown",
] as const;
