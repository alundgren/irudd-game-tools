import { isJson, isJsonArray } from "@irudd/document";
import { BrowserWindow, protocol, session } from "electron";
import fs from "node:fs";
import path from "node:path";
import { humanPackFiles, humanPaintFile } from "@irudd/character/human";
import { ArtError, type RenderOutput, type ReviewRenderer } from "@irudd/workshop/host";
import type { RenderJob, RenderResult, RendererInfo } from "@irudd/workshop/wire";
import type { ArtRaster } from "./art.js";

export const reviewScheme = "irudd-review";
const partition = "irudd-review";
const origin = `${reviewScheme}://worker`;

export function registerReviewScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: reviewScheme,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ]);
}

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".png": "image/png",
  ".json": "application/json",
};

interface Running {
  readonly job: RenderJob;
  readonly build: string;
  readonly blobs: ReadonlyMap<string, Uint8Array>;
  readonly files: Map<string, Uint8Array>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function isRenderResult(value: unknown): value is RenderResult {
  return (
    isRecord(value) &&
    typeof value["glb"] === "string" &&
    typeof value["exportMs"] === "number" &&
    Array.isArray(value["credits"]) &&
    isRecord(value["gpu"])
  );
}

function isWorkerInfo(value: unknown): value is Pick<RendererInfo, "gpu" | "supports"> {
  return isRecord(value) && isRecord(value["gpu"]) && isRecord(value["supports"]);
}

export interface ReviewWorkerOptions {
  readonly rendererDir: string;
  readonly assetsDir: string;
  readonly build: string;
  readonly versions: RendererInfo["versions"];
  readonly log?: (line: string) => void;
  readonly after?: Promise<unknown>;
}

export class ReviewWorker implements ReviewRenderer, ArtRaster {
  private readonly options: ReviewWorkerOptions;
  private window: BrowserWindow | undefined;
  private starting: Promise<BrowserWindow> | undefined;
  private running: Running | undefined;
  private failRunning: ((error: Error) => void) | undefined;
  private served = false;
  private disposed = false;
  info: RendererInfo;

  constructor(options: ReviewWorkerOptions) {
    this.options = options;
    this.info = {
      kind: "desktop-worker",
      build: options.build,
      versions: options.versions,
      gpu: { vendor: "", renderer: "not started", webgl: "", software: false },
      supports: {
        views: [],
        portraitViews: [],
        surfaces: [],
        lights: [],
        pixelRatios: [],
        maxEdge: 0,
      },
    };
  }

  async start(): Promise<RendererInfo> {
    const win = await this.open();
    const text: unknown = await win.webContents.executeJavaScript(
      "globalThis.iruddReview.info()",
      true,
    );
    const reported: unknown = typeof text === "string" ? JSON.parse(text) : undefined;
    if (!isWorkerInfo(reported)) throw new Error("The review worker did not describe itself.");
    this.info = { ...this.info, gpu: reported.gpu, supports: reported.supports };
    this.options.log?.(
      `review worker ready on ${reported.gpu.renderer}${reported.gpu.software ? " (software fallback)" : ""}`,
    );
    return this.info;
  }

  private open(): Promise<BrowserWindow> {
    if (this.disposed) return Promise.reject(new Error("The review worker was closed."));
    if (this.window && !this.window.isDestroyed()) return Promise.resolve(this.window);
    this.starting ??= Promise.resolve(this.options.after)
      .then(() => {
        if (this.disposed) throw new Error("The review worker was closed.");
        return this.create();
      })
      .finally(() => {
        this.starting = undefined;
      });
    return this.starting;
  }

  private serve(): void {
    if (this.served) return;
    this.served = true;
    const ses = session.fromPartition(partition);
    ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    ses.protocol.handle(reviewScheme, (request) => this.respond(request));
  }

  private async create(): Promise<BrowserWindow> {
    this.serve();
    const win = new BrowserWindow({
      show: false,
      width: 320,
      height: 240,
      paintWhenInitiallyHidden: false,
      title: "Irudd review worker",
      webPreferences: {
        partition: "irudd-review",
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false,
        backgroundThrottling: false,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    win.webContents.on("render-process-gone", (_event, details) => {
      this.failRunning?.(new Error(`The review worker stopped (${details.reason}).`));
      this.window = undefined;
      if (!win.isDestroyed()) win.destroy();
    });
    win.on("closed", () => {
      if (this.window === win) this.window = undefined;
      this.failRunning?.(new Error("The review worker closed."));
    });
    try {
      await win.loadURL(`${origin}/review/review.html`);
      const ready: unknown = await win.webContents.executeJavaScript(
        "typeof globalThis.iruddReview === 'object'",
        true,
      );
      if (ready !== true) throw new Error("The review worker page did not start.");
    } catch (error) {
      win.destroy();
      throw error;
    }
    this.window = win;
    return win;
  }

  private async respond(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const missing = (): Response => new Response("", { status: 404 });
    if (url.host !== "worker") return missing();
    const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (segments[0] === "job") {
      const running = this.running;
      if (!running || segments[1] !== running.job.jobId) return missing();
      if (request.method === "GET" && segments[2] === "input" && segments.length === 3)
        return Response.json({ job: running.job, build: running.build });
      if (request.method === "GET" && segments[2] === "blob" && segments.length === 4) {
        const bytes = running.blobs.get(`sha256:${segments[3] ?? ""}`);
        return bytes ? new Response(new Uint8Array(bytes)) : missing();
      }
      if (
        request.method === "POST" &&
        segments[2] === "out" &&
        segments.length === 4 &&
        /^[a-z0-9][a-z0-9._-]{0,95}$/.test(segments[3] ?? "")
      ) {
        running.files.set(segments[3] ?? "", new Uint8Array(await request.arrayBuffer()));
        return new Response(null, { status: 204 });
      }
      return missing();
    }
    if (request.method !== "GET") return missing();
    if (segments[0] === "bundled" && segments.length === 2) {
      const name = segments[1] ?? "";
      if (!/^[a-z0-9][a-z0-9.-]{0,80}\.webp$/.test(name)) return missing();
      return this.file(path.join(this.options.assetsDir, name));
    }
    if (segments[0] === "human" && segments.length === 2) {
      const pack = [...humanPackFiles, humanPaintFile].find((p) => p.file === segments[1]);
      return pack ? this.file(path.join(this.options.assetsDir, "human", pack.file)) : missing();
    }
    const relative = segments.join("/");
    if (
      relative === "index.html" ||
      !/^(review\/review\.html|assets\/[A-Za-z0-9._-]+)$/.test(relative)
    )
      return missing();
    return this.file(path.join(this.options.rendererDir, ...segments));
  }

  private file(file: string): Response {
    try {
      const type = contentTypes[path.extname(file)] ?? "application/octet-stream";
      return new Response(new Uint8Array(fs.readFileSync(file)), {
        headers: { "content-type": type },
      });
    } catch {
      return new Response("", { status: 404 });
    }
  }

  async render(job: RenderJob, blobs: ReadonlyMap<string, Uint8Array>): Promise<RenderOutput> {
    if (this.running) throw new Error("The review worker is busy.");
    const win = await this.open();
    const running: Running = { job, build: this.options.build, blobs, files: new Map() };
    this.running = running;
    try {
      const text = await new Promise<unknown>((resolve, reject) => {
        this.failRunning = reject;
        win.webContents
          .executeJavaScript(`globalThis.iruddReview.run(${JSON.stringify(job.jobId)})`, true)
          .then(resolve, (error: unknown) =>
            reject(error instanceof Error ? error : new Error(String(error))),
          );
      });
      const result: unknown = typeof text === "string" ? JSON.parse(text) : undefined;
      if (!isRenderResult(result)) throw new Error("The review worker returned no result.");
      return { result, files: running.files };
    } finally {
      this.running = undefined;
      this.failRunning = undefined;
    }
  }

  async nudge(
    doc: import("@irudd/document").CharacterDocument,
    nudge: NonNullable<import("./art.js").FitInput["brief"]["nudge"]>,
  ) {
    const win = await this.open();
    const result: unknown = await win.webContents.executeJavaScript(
      `globalThis.iruddReview.nudge(${JSON.stringify(doc)},${JSON.stringify(nudge)})`,
      true,
    );
    if (!isJson(result) || !isJsonArray(result))
      throw new Error("Invalid painted nudge operations.");
    return result;
  }

  async fit(input: import("./art.js").FitInput, bytes: Uint8Array) {
    const win = await this.open();
    const result: unknown = await win.webContents.executeJavaScript(
      `globalThis.iruddReview.fit(${JSON.stringify(input)}, ${JSON.stringify(Buffer.from(bytes).toString("base64"))})`,
      true,
    );
    if (
      !isRecord(result) ||
      !isRecord(result["fit"]) ||
      typeof result["fit"]["needsRepair"] !== "boolean" ||
      typeof result["fit"]["score"] !== "number" ||
      !isJson(result["operations"]) ||
      !isJsonArray(result["operations"]) ||
      !Array.isArray(result["notes"]) ||
      !result["notes"].every((n: unknown): n is string => typeof n === "string")
    )
      throw new Error("Invalid painted fit returned by the worker.");
    return {
      operations: result["operations"],
      notes: result["notes"],
      fit: { needsRepair: result["fit"]["needsRepair"], score: result["fit"]["score"] },
    };
  }

  async pixels(
    bytes: Uint8Array,
    mediaType: string,
    size: number,
    quadrant?: 0 | 1 | 2 | 3,
  ): Promise<Uint8ClampedArray<ArrayBuffer>> {
    let text: unknown;
    try {
      const win = await this.open();
      text = await win.webContents.executeJavaScript(
        `globalThis.iruddReview.pixels(${JSON.stringify(Buffer.from(bytes).toString("base64"))}, ${JSON.stringify(mediaType)}, ${String(size)}, ${quadrant === undefined ? "null" : String(quadrant)})`,
        true,
      );
    } catch (error) {
      throw new ArtError(
        "HostFailed",
        `The desktop's raster is not available: ${error instanceof Error ? error.message : String(error)} Submit the same reply again.`,
      );
    }
    const drawn: unknown = typeof text === "string" ? JSON.parse(text) : undefined;
    if (!isRecord(drawn))
      throw new ArtError("HostFailed", "The desktop's raster returned nothing.");
    if (drawn["ok"] !== true || typeof drawn["rgba"] !== "string")
      throw new Error(`The picture could not be drawn: ${String(drawn["error"])}`);
    const rgba = Buffer.from(drawn["rgba"], "base64");
    if (rgba.length !== size * size * 4)
      throw new ArtError("HostFailed", "The desktop's raster returned the wrong size.");
    const out = new Uint8ClampedArray(rgba.length);
    out.set(rgba);
    return out;
  }

  close(): void {
    this.disposed = true;
    this.failRunning?.(new Error("The review worker closed."));
    const win = this.window;
    this.window = undefined;
    if (win && !win.isDestroyed()) win.destroy();
  }
}
