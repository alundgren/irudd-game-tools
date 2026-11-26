import type { RunningHost } from "@irudd/workshop/host";
import type { WorkshopClient } from "@irudd/workshop/client";
import { putChunkBytes, type RenderJob } from "@irudd/workshop/wire";
import type { ReviewWorker } from "./review.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function isJob(value: unknown): value is RenderJob {
  return (
    isRecord(value) &&
    typeof value["jobId"] === "string" &&
    typeof value["documentId"] === "string" &&
    typeof value["revision"] === "number" &&
    typeof value["preset"] === "string" &&
    Array.isArray(value["blobs"])
  );
}

const say = (log: ((line: string) => void) | undefined, line: string): void =>
  log ? log(line) : console.warn(line);

export async function registerInProcess(
  host: RunningHost,
  worker: ReviewWorker,
  log?: (line: string) => void,
): Promise<() => void> {
  try {
    await worker.start();
  } catch (error) {
    say(
      log,
      `Review worker unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
    return () => undefined;
  }
  return host.registerRenderer(worker);
}

export async function serveAttached(
  client: WorkshopClient,
  worker: ReviewWorker,
  log?: (line: string) => void,
): Promise<void> {
  try {
    await worker.start();
  } catch (error) {
    say(
      log,
      `Review worker unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }
  client.onEvent((event) => {
    if (event.event !== "review-job") return;
    const job = event.job;
    if (!isJob(job)) return;
    const blobs = new Map<string, Uint8Array>();
    for (const [digest, base64] of Object.entries(event.blobs))
      blobs.set(digest, new Uint8Array(Buffer.from(base64, "base64")));
    void answer(client, worker, job, blobs).catch((error: unknown) =>
      say(log, `Review job ${job.jobId} could not be answered: ${String(error)}`),
    );
  });
  await client.call("review.serve", { renderer: worker.info });
}

async function answer(
  client: WorkshopClient,
  worker: ReviewWorker,
  job: RenderJob,
  blobs: ReadonlyMap<string, Uint8Array>,
): Promise<void> {
  let output;
  try {
    output = await worker.render(job, blobs);
  } catch (error) {
    await client.call("review.complete", {
      jobId: job.jobId,
      ok: false,
      error: {
        tag: "WorkerFailed",
        message: error instanceof Error ? error.message : String(error),
      },
    });
    return;
  }
  for (const [name, bytes] of output.files)
    for (let offset = 0; offset < bytes.byteLength; offset += putChunkBytes)
      await client.call("review.put", {
        jobId: job.jobId,
        name,
        offset,
        total: bytes.byteLength,
        base64: Buffer.from(bytes.subarray(offset, offset + putChunkBytes)).toString("base64"),
      });
  const result: unknown = JSON.parse(JSON.stringify(output.result));
  if (!isRecord(result)) throw new Error("The worker's result is not an object.");
  await client.call("review.complete", { jobId: job.jobId, ok: true, result: toJson(result) });
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function toJson(value: unknown): Json {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(toJson);
  if (isRecord(value)) {
    const out: { [key: string]: Json } = {};
    for (const [key, entry] of Object.entries(value)) out[key] = toJson(entry);
    return out;
  }
  return null;
}
