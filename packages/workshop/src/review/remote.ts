import { isJson } from "@irudd/document";
import type { RenderJob, RenderResult, RendererInfo, ReviewJobEvent } from "../wire/review.js";
import { ReviewError, type RenderOutput, type ReviewRenderer } from "./service.js";

export const maxJobBytes = 512 * 1024 * 1024;

export interface ConnectionLink {
  readonly id: string;
  readonly write: (event: ReviewJobEvent) => boolean;
}

interface Pending {
  readonly files: Map<string, { total: number; chunks: Buffer[]; received: number }>;
  bytes: number;
  readonly resolve: (output: RenderOutput) => void;
  readonly reject: (error: unknown) => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function isRenderResult(value: unknown): value is RenderResult {
  if (!isRecord(value)) return false;
  const { glb, exportMs, credits, gpu, inspection } = value;
  if (
    typeof glb !== "string" ||
    typeof exportMs !== "number" ||
    !Array.isArray(credits) ||
    !credits.every((c) => typeof c === "string") ||
    !isRecord(gpu) ||
    typeof gpu["renderer"] !== "string" ||
    typeof gpu["software"] !== "boolean"
  )
    return false;
  if (inspection !== undefined) {
    if (!isRecord(inspection) || !Array.isArray(inspection["images"])) return false;
    for (const image of inspection["images"])
      if (
        !isRecord(image) ||
        typeof image["name"] !== "string" ||
        typeof image["width"] !== "number" ||
        typeof image["height"] !== "number" ||
        !isRecord(image["recipe"])
      )
        return false;
  }
  return true;
}

export class RemoteRenderer implements ReviewRenderer {
  readonly info: RendererInfo;
  readonly link: ConnectionLink;
  private readonly pending = new Map<string, Pending>();
  private closed = false;

  constructor(link: ConnectionLink, info: RendererInfo) {
    this.link = link;
    this.info = info;
  }

  render(job: RenderJob, blobs: ReadonlyMap<string, Uint8Array>): Promise<RenderOutput> {
    if (this.closed)
      return Promise.reject(
        new ReviewError(
          "RendererLost",
          "The desktop review worker disconnected before the job started.",
        ),
      );
    return new Promise<RenderOutput>((resolve, reject) => {
      this.pending.set(job.jobId, { files: new Map(), bytes: 0, resolve, reject });
      const encoded: Record<string, string> = {};
      for (const [digest, bytes] of blobs) encoded[digest] = Buffer.from(bytes).toString("base64");
      const plain: unknown = JSON.parse(JSON.stringify(job));
      if (!isJson(plain)) {
        this.fail(job.jobId, new ReviewError("HostFailed", "The job is not plain JSON."));
        return;
      }
      const sent = this.link.write({
        t: "event",
        event: "review-job",
        job: plain,
        blobs: encoded,
      });
      if (!sent) this.fail(job.jobId, lost());
    });
  }

  put(jobId: string, name: string, offset: number, total: number, base64: string): number {
    const job = this.pending.get(jobId);
    if (!job) throw unknownJob(jobId);
    const bytes = Buffer.from(base64, "base64");
    let file = job.files.get(name);
    if (!file) {
      file = { total, chunks: [], received: 0 };
      job.files.set(name, file);
    }
    if (
      file.total !== total ||
      offset !== file.received ||
      file.received + bytes.byteLength > total
    )
      throw new ReviewError(
        "InvalidArgument",
        `Upload ${name} in order: expected offset ${file.received} of ${file.total} bytes.`,
        { path: ["params", "offset"] },
      );
    job.bytes += bytes.byteLength;
    if (job.bytes > maxJobBytes) {
      this.fail(jobId, new ReviewError("RenderFailed", "The job's outputs exceed 512 MiB."));
      throw new ReviewError("RenderFailed", "The job's outputs exceed 512 MiB.");
    }
    file.chunks.push(bytes);
    file.received += bytes.byteLength;
    return file.received;
  }

  complete(
    jobId: string,
    outcome:
      | { readonly ok: true; readonly result: unknown }
      | { readonly ok: false; readonly tag: string; readonly message: string },
  ): void {
    const job = this.pending.get(jobId);
    if (!job) throw unknownJob(jobId);
    this.pending.delete(jobId);
    if (!outcome.ok) {
      job.reject(
        new ReviewError("RenderFailed", `${outcome.tag}: ${outcome.message}`, {
          cause: outcome.tag,
        }),
      );
      return;
    }
    const result = outcome.result;
    if (!isRenderResult(result)) {
      job.reject(new ReviewError("RenderFailed", "The renderer's result has an unexpected shape."));
      return;
    }
    const files = new Map<string, Uint8Array>();
    for (const [name, file] of job.files) {
      if (file.received !== file.total) {
        job.reject(new ReviewError("RenderFailed", `The upload of ${name} is incomplete.`));
        return;
      }
      files.set(name, new Uint8Array(Buffer.concat(file.chunks)));
    }
    job.resolve({ result, files });
  }

  owns(jobId: string): boolean {
    return this.pending.has(jobId);
  }

  private fail(jobId: string, error: unknown): void {
    const job = this.pending.get(jobId);
    this.pending.delete(jobId);
    job?.reject(error);
  }

  close(): void {
    this.closed = true;
    for (const jobId of this.pending.keys()) this.fail(jobId, lost());
  }
}

const lost = (): ReviewError =>
  new ReviewError(
    "RendererLost",
    "The desktop review worker disconnected during the job. Nothing was issued. Reopen the project in the desktop app (it registers its worker again) and retry.",
  );

const unknownJob = (jobId: string): ReviewError =>
  new ReviewError("JobUnknown", `No job ${jobId} is waiting on this connection.`, { jobId });
