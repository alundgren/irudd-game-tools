// Review: export a named, immutable revision and inspect the resulting GLB.
//
// The project host owns review, as it owns writes. A request names a
// document, a revision (default: the head when the request arrives) and a
// preset. The host reads that revision's document from the journal, sends it
// with its verified artwork to the one registered renderer, and checks what
// comes back: the GLB's SHA-256 and its provenance stamp (document, digest,
// revision, preset) before it issues anything.
//
//   review.capabilities  whether a renderer is registered, what it supports,
//                        and what to do when none is
//   review.export        the GLB artifact and its inventory
//   review.inspect       the same plus metrics and rendered images
//   review.read          bytes of an artifact this host issued, in chunks
//
// A renderer is a desktop app's isolated review worker: a hidden window with
// its own WebGL context, its own player stage and camera, never the person's
// viewport. Desktop main registers it in process when it owns the project;
// an attached desktop registers it over its authenticated person connection
// with `review.serve`, receives `review-job` events and answers with
// `review.put` and `review.complete`. Nothing ever falls back to a
// screenshot: without a renderer a request fails with `RendererUnavailable`.
// Pure: no Node and no storage, so the desktop renderer may import it.

import { Schema } from "effect";
import { DocumentId, JsonValue } from "@irudd/document";

export const reviewPresets = ["clay", "full", "game", "portrait"] as const;
export type ReviewPreset = (typeof reviewPresets)[number];

/** Image groups `review.inspect` can take. */
export const reviewSheets = ["body", "portrait", "motion", "expressions", "silhouette"] as const;
export type ReviewSheet = (typeof reviewSheets)[number];
export const defaultReviewSheets: ReadonlyArray<ReviewSheet> = ["body", "portrait", "silhouette"];

/** Largest edge of one review image in device pixels, and the largest chunk `review.read` returns. */
export const maxReviewEdge = 4096;
export const maxReadBytes = 8 * 1024 * 1024;
/** Chunk size renderers upload with `review.put`, before base64. */
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

/** One camera, pose and surface the player can draw. Views and surfaces are the renderer's own. */
export const ReviewShot = Schema.Struct({
  view: Token,
  /** Clip name, or null for the rest pose. */
  clip: Schema.optionalKey(Schema.NullOr(Schema.String.check(Schema.isMaxLength(120)))),
  /** Fraction of the clip. */
  time: Schema.optionalKey(Fraction),
  surface: Schema.optionalKey(Token),
  /** Expression at full weight, or none. */
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

/** What a renderer says about itself when it registers. */
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
  /** A committed revision. Default: the head when the host receives the request. */
  revision: Schema.optionalKey(Revision),
  preset: Preset,
};

/** Parameter schemas of the review methods; `wire/protocol.ts` merges them into the method table. */
export const reviewParams = {
  "review.capabilities": Schema.Struct({}),
  "review.export": Schema.Struct({
    ...Target,
    /**
     * Export every saved outfit as its own scene, rig and clips (a wardrobe
     * export) instead of the document as worn. The revision must have saved outfits.
     */
    wardrobe: Schema.optionalKey(Schema.Boolean),
  }),
  "review.inspect": Schema.Struct({
    ...Target,
    /** Image groups. Default: body, portrait (when the model has a face) and silhouette. */
    sheets: Schema.optionalKey(
      Schema.Array(Schema.Literals(reviewSheets)).check(Schema.isMaxLength(reviewSheets.length)),
    ),
    /** Extra shots, each its own image. */
    shots: Schema.optionalKey(Schema.Array(ReviewShot).check(Schema.isMaxLength(24))),
    /** Image size in CSS pixels (default 768 × 768). */
    width: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 64, maximum: 2048 }))),
    height: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 64, maximum: 2048 }))),
    /** Device pixels per CSS pixel (default 2). */
    pixelRatio: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 3 }))),
    /** Lighting for every shot that names none (default: the player's studio light). */
    light: Schema.optionalKey(Token),
  }),
  /** Bytes of an artifact this host issued for this project. */
  "review.read": Schema.Struct({
    sha256: Sha256,
    offset: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
    length: Schema.optionalKey(
      Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: maxReadBytes })),
    ),
  }),
  /** People only: make this connection the project's renderer. Jobs arrive as `review-job` events. */
  "review.serve": Schema.Struct({ renderer: RendererInfo }),
  /** People only: upload part of a job's output. */
  "review.put": Schema.Struct({
    jobId: JobId,
    name: Name,
    offset: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    total: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 256 * 1024 * 1024 })),
    base64: Schema.String.check(Schema.isMaxLength(Math.ceil(putChunkBytes / 3) * 4)),
  }),
  /** People only: finish a job with its result, or its failure. */
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

// ── Jobs ────────────────────────────────────────────────────────────────────

/** What a renderer receives. Blob bytes travel separately (in process) or as base64 (wire). */
export interface RenderJob {
  readonly jobId: string;
  readonly kind: "export" | "inspect";
  readonly documentId: string;
  readonly revision: number;
  readonly documentDigest: string;
  /** The document at that revision, as the journal holds it. */
  readonly document: unknown;
  readonly preset: ReviewPreset;
  /** Export jobs only: every saved outfit as its own scene. */
  readonly wardrobe?: true;
  /** Project blobs the document declares, verified by the host. */
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

/** The job as an event to a renderer connected over the wire. */
export const ReviewJobEvent = Schema.Struct({
  t: Schema.Literal("event"),
  event: Schema.Literal("review-job"),
  job: JsonValue,
  /** Blob bytes by digest, base64. */
  blobs: Schema.Record(Schema.String, Schema.String),
});
export type ReviewJobEvent = typeof ReviewJobEvent.Type;

/** One image a renderer produced. `name` is its output file. */
export interface RenderedImage {
  readonly name: string;
  readonly kind: "body" | "portrait" | "motion" | "expression" | "silhouette" | "custom";
  readonly width: number;
  readonly height: number;
  /** View, clip, time, surface, morph, gaze, angle, light, camera and pixel ratio. */
  readonly recipe: Record<string, unknown>;
  readonly render: { readonly calls: number; readonly triangles: number };
  /** Silhouette images: share of pixels covered and their bounding box. */
  readonly silhouette?: {
    readonly coverage: number;
    readonly bbox: readonly [number, number, number, number] | null;
  };
}

/** The renderer's description of a finished job; the bytes are its named outputs. */
export interface RenderResult {
  /** The exported GLB's output name. */
  readonly glb: string;
  readonly exportMs: number;
  readonly credits: ReadonlyArray<string>;
  /** `inspectGlb` of the bytes. */
  readonly inventory: unknown;
  readonly gpu: { readonly vendor: string; readonly renderer: string; readonly software: boolean };
  /** Set for inspect jobs. */
  readonly inspection?: {
    readonly model: unknown;
    readonly motion: unknown;
    readonly images: ReadonlyArray<RenderedImage>;
    readonly readiness: Record<string, unknown>;
    readonly renderMs: number;
    readonly notes: ReadonlyArray<string>;
  };
}

// ── Results ─────────────────────────────────────────────────────────────────

export interface RendererView {
  readonly id: string;
  /** `in-process`: desktop main owns the project. `attached`: a desktop serving a headless owner. */
  readonly via: "in-process" | "attached";
  readonly info: RendererInfo;
  readonly registeredAt: number;
}

export interface ReviewCapabilities {
  readonly available: boolean;
  readonly renderer: RendererView | null;
  readonly presets: ReadonlyArray<ReviewPreset>;
  readonly sheets: ReadonlyArray<ReviewSheet>;
  /** Jobs running and waiting on the renderer. */
  readonly queue: { readonly running: number; readonly waiting: number };
  /** Without a renderer: why, and what a person can do. */
  readonly reason?: string;
  readonly actions?: ReadonlyArray<string>;
}

/** What every review output is bound to. */
export interface ReviewSource {
  readonly documentId: string;
  readonly revision: number;
  /** `head`: the request named no revision and got the head it arrived at. */
  readonly requested: number | "head";
  readonly documentDigest: string;
  /** The document head when the request arrived and when its output was issued. */
  readonly head: { readonly atRequest: number; readonly atCompletion: number };
  /** True when another revision was committed while this one rendered. The output is still exactly `revision`. */
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
  /** A wardrobe export's saved outfits, one scene each in this order; null for one scene as worn. */
  readonly wardrobe: { readonly looks: ReadonlyArray<string> } | null;
  readonly glb: ReviewArtifact;
  /** The provenance stamp read back from the GLB. */
  readonly provenance: unknown;
  readonly credits: ReadonlyArray<string>;
  readonly inventory: unknown;
  readonly renderer: RendererView;
  readonly gpu: RenderResult["gpu"];
  /** Whether an earlier export of the same revision, preset, scenes and build had the same bytes. */
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
  /** The normalised request: sheets, shots, sizes and light. */
  readonly recipe: NonNullable<RenderJob["inspect"]>;
  readonly timing: ExportView["timing"] & { readonly renderMs: number };
}

/** Geometry, texture, rig and material figures, derived from the GLB inventory. */
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
  /** True when this chunk reaches the end. */
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
