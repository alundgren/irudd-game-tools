import { Effect, Exit } from "effect";
import { outfitLooks } from "@irudd/document";
import { randomBytes } from "node:crypto";
import type { Project } from "../contract/project.js";
import {
  defaultReviewSheets,
  maxReadBytes,
  reviewPresets,
  reviewSheets,
  type ExportView,
  type InspectImage,
  type InspectReviewView,
  type ReadView,
  type RenderJob,
  type RenderResult,
  type RendererInfo,
  type RendererView,
  type ReviewCapabilities,
  type ReviewMetrics,
  type ReviewPreset,
  type ReviewShot,
  type ReviewSheet,
  type ReviewSource,
} from "../wire/review.js";
import { ArtifactStore } from "./store.js";

export class ReviewError extends Error {
  readonly _tag: string;
  readonly [field: string]: unknown;
  constructor(tag: string, message: string, fields: Record<string, unknown> = {}) {
    super(message);
    Object.assign(this, fields);
    this._tag = tag;
  }
}

export interface RenderOutput {
  readonly result: RenderResult;
  readonly files: ReadonlyMap<string, Uint8Array>;
}

export interface ReviewRenderer {
  readonly info: RendererInfo;
  render(job: RenderJob, blobs: ReadonlyMap<string, Uint8Array>): Promise<RenderOutput>;
}

export interface ExportParams {
  readonly documentId: string;
  readonly revision?: number;
  readonly preset: ReviewPreset;
  readonly wardrobe?: boolean;
}

export interface InspectParams extends Omit<ExportParams, "wardrobe"> {
  readonly sheets?: ReadonlyArray<ReviewSheet>;
  readonly shots?: ReadonlyArray<ReviewShot>;
  readonly width?: number;
  readonly height?: number;
  readonly pixelRatio?: number;
  readonly light?: string;
}

async function run<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;
  const failed = exit.cause.reasons.find((reason) => reason._tag === "Fail");
  if (failed && failed._tag === "Fail") throw failed.error;
  throw new ReviewError("HostFailed", String(exit.cause));
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const count = (value: unknown): number => (typeof value === "number" ? value : 0);

export function glbProvenance(bytes: Uint8Array): Record<string, unknown> | undefined {
  if (bytes.byteLength < 20) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(16, true) !== 0x4e4f534a)
    return undefined;
  const length = view.getUint32(12, true);
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
  } catch {
    return undefined;
  }
  const asset = isRecord(json) ? json["asset"] : undefined;
  const extras = isRecord(asset) ? asset["extras"] : undefined;
  const irudd = isRecord(extras) ? extras["irudd"] : undefined;
  return isRecord(irudd) ? irudd : undefined;
}

export function pngSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.byteLength < 24 || signature.some((b, i) => bytes[i] !== b)) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export function metricsOf(inventory: unknown): ReviewMetrics {
  const inv = isRecord(inventory) ? inventory : {};
  const images = list(inv["images"]).filter(isRecord);
  const materials = list(inv["materials"]).filter(isRecord);
  let largest: { width: number; height: number } | null = null;
  for (const image of images) {
    const width = count(image["width"]);
    const height = count(image["height"]);
    if (!largest || width * height > largest.width * largest.height) largest = { width, height };
  }
  return {
    geometry: {
      vertices: count(inv["vertices"]),
      triangles: count(inv["triangles"]),
      regions: isRecord(inv["regions"]) ? Object.keys(inv["regions"]).length : 0,
      bounds: inv["bounds"] ?? null,
    },
    textures: {
      images: images.length,
      bytes: images.reduce((n, image) => n + count(image["byteLength"]), 0),
      largest,
      texturedMaterials: materials.filter(
        (m) => isRecord(m["textures"]) && Object.keys(m["textures"]).length > 0,
      ).length,
    },
    rig: {
      joints: list(inv["joints"]).length,
      morphTargets: list(inv["morphTargets"]).length,
      clips: list(inv["animations"]).length,
    },
    materials: {
      count: materials.length,
      names: materials.map((m) => (typeof m["name"] === "string" ? m["name"] : "")),
    },
  };
}

interface Registered {
  readonly id: string;
  readonly via: RendererView["via"];
  readonly renderer: ReviewRenderer;
  readonly registeredAt: number;
}

export interface ReviewOptions {
  readonly project: Project;
  readonly dir: string;
  readonly log?: (line: string) => void;
  readonly timeoutMs?: number;
}

export class Review {
  private readonly project: Project;
  private readonly store: ArtifactStore;
  private readonly log: (line: string) => void;
  private readonly timeoutMs: number;
  private current: Registered | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  private running = 0;
  private waiting = 0;
  private stopped = false;

  constructor(options: ReviewOptions) {
    this.project = options.project;
    this.store = new ArtifactStore({ dir: options.dir, projectId: options.project.info.projectId });
    this.log = options.log ?? (() => undefined);
    this.timeoutMs = options.timeoutMs ?? 300_000;
  }

  register(
    renderer: ReviewRenderer,
    via: RendererView["via"],
  ): { readonly id: string; readonly unregister: () => void } {
    const entry: Registered = {
      id: `renderer-${randomBytes(8).toString("hex")}`,
      via,
      renderer,
      registeredAt: Date.now(),
    };
    this.current = entry;
    this.log(`review: renderer ${entry.id} registered (${via}, ${renderer.info.gpu.renderer})`);
    return {
      id: entry.id,
      unregister: () => {
        if (this.current?.id === entry.id) {
          this.current = undefined;
          this.log(`review: renderer ${entry.id} left`);
        }
      },
    };
  }

  view(entry: Registered): RendererView {
    return {
      id: entry.id,
      via: entry.via,
      info: entry.renderer.info,
      registeredAt: entry.registeredAt,
    };
  }

  capabilities(): ReviewCapabilities {
    const entry = this.current;
    const base = {
      presets: reviewPresets,
      sheets: reviewSheets,
      queue: { running: this.running, waiting: this.waiting },
    };
    if (entry) return { available: true, renderer: this.view(entry), ...base };
    return { available: false, renderer: null, ...base, ...unavailable() };
  }

  stop(): void {
    this.stopped = true;
    this.current = undefined;
  }

  read(sha256: string, offset = 0, length = maxReadBytes): ReadView {
    const found = this.store.read(sha256, offset, Math.min(length, maxReadBytes));
    if (!found)
      throw new ReviewError(
        "ArtifactUnknown",
        `This host issued no artifact ${sha256} for this project. Use a sha256 from review.export or review.inspect.`,
        { sha256 },
      );
    const start = Math.min(offset, found.entry.byteLength);
    return {
      sha256,
      mediaType: found.entry.mediaType,
      byteLength: found.entry.byteLength,
      offset: start,
      base64: Buffer.from(found.bytes).toString("base64"),
      done: start + found.bytes.byteLength >= found.entry.byteLength,
    };
  }

  async export(params: ExportParams): Promise<ExportView> {
    const done = await this.job("export", params, undefined);
    const { inspection: _inspection, ...view } = done;
    return { ...view, format: "irudd.review-export" };
  }

  async inspect(params: InspectParams): Promise<InspectReviewView> {
    const entry = this.current;
    if (!entry) throw unavailableError();
    const supports = entry.renderer.info.supports;
    const recipe: NonNullable<RenderJob["inspect"]> = {
      sheets: params.sheets ? [...new Set(params.sheets)] : defaultReviewSheets,
      shots: params.shots ?? [],
      width: params.width ?? 768,
      height: params.height ?? 768,
      pixelRatio: params.pixelRatio ?? 2,
      light: params.light ?? supports.lights[0] ?? "studio",
    };
    const refuse = (message: string, path: ReadonlyArray<string | number>) => {
      throw new ReviewError("InvalidArgument", message, { path: ["params", ...path] });
    };
    if (!supports.pixelRatios.includes(recipe.pixelRatio))
      refuse(`The renderer draws at pixel ratios ${supports.pixelRatios.join(", ")}.`, [
        "pixelRatio",
      ]);
    if (Math.max(recipe.width, recipe.height) * recipe.pixelRatio > supports.maxEdge)
      refuse(`Keep each image within ${supports.maxEdge} device pixels per edge.`, ["width"]);
    if (!supports.lights.includes(recipe.light))
      refuse(`The player lights a scene with: ${supports.lights.join(", ")}.`, ["light"]);
    recipe.shots.forEach((shot, i) => {
      if (!supports.views.includes(shot.view))
        refuse(`The player has no view ${shot.view}. Views: ${supports.views.join(", ")}.`, [
          "shots",
          i,
          "view",
        ]);
      if (shot.surface !== undefined && !supports.surfaces.includes(shot.surface))
        refuse(`Surfaces: ${supports.surfaces.join(", ")}.`, ["shots", i, "surface"]);
      if (shot.light !== undefined && !supports.lights.includes(shot.light))
        refuse(`Lights: ${supports.lights.join(", ")}.`, ["shots", i, "light"]);
    });
    const done = await this.job("inspect", params, recipe);
    const inspection = done.inspection;
    if (!inspection) throw new ReviewError("RenderFailed", "The renderer returned no inspection.");
    return { ...done, ...inspection, format: "irudd.review-inspection", recipe };
  }

  private async job(
    kind: RenderJob["kind"],
    params: ExportParams,
    recipe: RenderJob["inspect"],
  ): Promise<
    Omit<ExportView, "format"> & {
      inspection?: Omit<InspectReviewView, keyof ExportView | "format" | "recipe" | "timing"> & {
        timing: InspectReviewView["timing"];
      };
    }
  > {
    const requested = performance.now();
    const head = await run(this.project.current(params.documentId));
    const revision = params.revision ?? head.revision;
    const pinned =
      revision >= 1 ? await run(this.project.revision(params.documentId, revision)) : undefined;
    if (!pinned)
      throw new ReviewError(
        "RevisionMissing",
        `${params.documentId} has no revision ${revision}; its head is ${head.revision}.`,
        { documentId: params.documentId, revision, head: head.revision },
      );
    const looks = params.wardrobe
      ? (outfitLooks.read(pinned.document.features)?.looks ?? [])
      : undefined;
    if (looks && !looks.length)
      throw new ReviewError(
        "InvalidArgument",
        `Revision ${revision} of ${params.documentId} has no saved outfits. Save an outfit before exporting the wardrobe.`,
        { path: ["params", "wardrobe"] },
      );
    const blobs = new Map<string, Uint8Array>();
    const declared: { digest: string; mediaType: string }[] = [];
    for (const asset of pinned.document.assets) {
      const content = await run(this.project.blob(asset.digest)).catch(() => undefined);
      if (!content)
        throw new ReviewError(
          "ArtworkUnresolved",
          `Revision ${revision} of ${params.documentId} declares ${asset.digest}, which the project does not store. Import that artwork before reviewing.`,
          { digests: [asset.digest] },
        );
      blobs.set(asset.digest, content.bytes);
      declared.push({ digest: asset.digest, mediaType: content.mediaType });
    }
    const job: RenderJob = {
      jobId: `job-${randomBytes(12).toString("hex")}`,
      kind,
      documentId: params.documentId,
      revision,
      documentDigest: pinned.documentDigest,
      document: pinned.document,
      preset: params.preset,
      ...(looks ? { wardrobe: true as const } : {}),
      blobs: declared,
      ...(recipe ? { inspect: recipe } : {}),
    };
    if (!this.current) throw unavailableError();
    this.waiting += 1;
    const queued = this.tail.then(async () => {
      this.waiting -= 1;
      const entry = this.current;
      if (this.stopped || !entry) throw unavailableError();
      this.running += 1;
      const started = performance.now();
      try {
        return {
          entry,
          output: await this.withTimeout(entry.renderer.render(job, blobs)),
          started,
        };
      } finally {
        this.running -= 1;
      }
    });
    this.tail = queued.catch(() => undefined);
    const { entry, output, started } = await queued;
    const finished = performance.now();
    const after = await run(this.project.current(params.documentId));
    return this.issue(job, entry, output, {
      requested: params.revision ?? "head",
      head: { atRequest: head.revision, atCompletion: after.revision },
      queuedMs: Math.round(started - requested),
      totalMs: Math.round(finished - requested),
    });
  }

  private withTimeout<A>(promise: Promise<A>): Promise<A> {
    return new Promise<A>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new ReviewError(
              "RenderTimeout",
              `The renderer did not finish within ${Math.round(this.timeoutMs / 1000)} s. Check the desktop app and try again.`,
            ),
          ),
        this.timeoutMs,
      );
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(
            error instanceof ReviewError
              ? error
              : new ReviewError(
                  "RenderFailed",
                  String(error instanceof Error ? error.message : error),
                ),
          );
        },
      );
    });
  }

  private issue(
    job: RenderJob,
    entry: Registered,
    output: RenderOutput,
    timing: {
      requested: number | "head";
      head: ReviewSource["head"];
      queuedMs: number;
      totalMs: number;
    },
  ) {
    const { result, files } = output;
    const glb = files.get(result.glb);
    if (!glb) throw new ReviewError("RenderFailed", "The renderer returned no GLB.");
    const provenance = glbProvenance(glb);
    const expected = {
      document: job.documentId,
      digest: job.documentDigest,
      revision: job.revision,
      preset: job.preset,
    };
    const differs = Object.entries(expected).filter(([k, v]) => provenance?.[k] !== v);
    const stamped = provenance?.["wardrobe"];
    const wardrobe = isRecord(stamped) ? stamped : undefined;
    const looks = list(wardrobe?.["looks"]).filter((l): l is string => typeof l === "string");
    const scenes = job.wardrobe ? wardrobe && looks.length > 0 : stamped === undefined;
    if (provenance && !scenes) differs.push(["wardrobe", job.wardrobe ? "outfits" : "as worn"]);
    if (!provenance || differs.length)
      throw new ReviewError(
        "ReviewMismatch",
        `The GLB the renderer returned is not ${job.documentId} revision ${job.revision} at ${job.preset}: ${provenance ? differs.map(([k]) => k).join(", ") + " differ" : "it carries no provenance"}. Nothing was issued.`,
        { expected, provenance: provenance ?? null },
      );
    const images = (result.inspection?.images ?? []).map((image): InspectImage => {
      const bytes = files.get(image.name);
      const size = bytes ? pngSize(bytes) : undefined;
      if (!bytes || !size || size.width !== image.width || size.height !== image.height)
        throw new ReviewError(
          "ReviewMismatch",
          `The image ${image.name} is missing or is not a ${image.width} × ${image.height} PNG. Nothing was issued.`,
        );
      return {
        ...image,
        ...this.store.put(bytes, {
          mediaType: "image/png",
          kind: "png",
          documentId: job.documentId,
          revision: job.revision,
        }),
      };
    });
    const artifact = this.store.put(glb, {
      mediaType: "model/gltf-binary",
      kind: "glb",
      documentId: job.documentId,
      revision: job.revision,
    });
    const key = `${job.documentDigest}|${job.revision}|${job.preset}|${String(provenance["build"])}${job.wardrobe ? "|wardrobe" : ""}`;
    const previous = this.store.lastExport(key);
    this.store.recordExport(key, artifact.sha256);
    const source: ReviewSource = {
      documentId: job.documentId,
      revision: job.revision,
      requested: timing.requested,
      documentDigest: job.documentDigest,
      head: timing.head,
      headMoved: timing.head.atCompletion !== timing.head.atRequest,
    };
    const base = {
      version: 1 as const,
      source,
      preset: job.preset,
      wardrobe: job.wardrobe ? { looks } : null,
      glb: artifact,
      provenance,
      credits: result.credits,
      inventory: result.inventory,
      renderer: this.view(entry),
      gpu: result.gpu,
      repeat: previous ? { previous, identical: previous === artifact.sha256 } : null,
      timing: { queuedMs: timing.queuedMs, exportMs: result.exportMs, totalMs: timing.totalMs },
    };
    const inspection = result.inspection;
    return {
      ...base,
      ...(inspection
        ? {
            inspection: {
              model: inspection.model,
              motion: inspection.motion,
              metrics: metricsOf(result.inventory),
              images,
              readiness: inspection.readiness,
              notes: inspection.notes,
              timing: { ...base.timing, renderMs: inspection.renderMs },
            },
          }
        : {}),
    };
  }
}

function unavailable(): { reason: string; actions: ReadonlyArray<string> } {
  return {
    reason:
      "No review renderer is registered with this project's host. Review renders in the Irudd Workshop desktop app's isolated review worker, on its GPU; a headless host has none of its own, and nothing falls back to screenshots.",
    actions: [
      "Open this project in the Irudd Workshop desktop app. If it owns the project, its worker registers at once; if `irudd host` owns it, the desktop attaches and registers its worker with the host.",
      "Then call review.capabilities again, or retry the request. A renderer that leaves fails its running job with RendererLost and registers again when the desktop reconnects.",
    ],
  };
}

function unavailableError(): ReviewError {
  const { reason, actions } = unavailable();
  return new ReviewError("RendererUnavailable", reason, { actions });
}
