// Heavy gate for review: the packaged desktop's isolated worker rendering for
// real CLI processes, a real MCP SDK client and a person's connection, on the
// hardware GPU. Take the GPU lock around it:
//
//   pnpm --filter @irudd/desktop build
//   powershell -NoProfile -File verification/families/gpu-lock.ps1 \
//     pnpm --filter @irudd/desktop qa:review [-- --keep] [--scale 2]
//
// Desktop owns the project: a painted (feline-worker, with embedded artwork)
// and an unpainted (marsh-draw-3) subject, exported and inspected at every
// preset from the CLI, with each file re-hashed against its manifest and its
// PNGs decoded; repeat exports and inspections byte-identical; a revision
// pinned while the person edits; a person's orbit during a review; no draw in
// the person's viewport during a review; high-DPI images; and the MCP client's
// GPU label and image payloads compared with files the CLI captured. The person
// exports every saved outfit of field-wardrobe from the editor; the CLI and the
// MCP client request the same wardrobe export and get the same bytes, one scene
// per outfit, while the as-worn export stays a separate single-scene artifact.
//
// A headless host owns the project: review is unavailable with actions until
// the desktop attaches and serves its worker, a desktop killed mid-render fails
// the job with RendererLost, and a relaunched desktop serves again. Artifacts
// issued for one project cannot be read from another. Nothing here ships.

import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { inflateSync } from "node:zlib";
import { chromium, type Browser, type Page } from "@playwright/test";
import { documentDigest } from "@irudd/document";
import { connect, envelope, WorkshopError, type WorkshopClient } from "@irudd/workshop/client";
import { appDir, appEnvironment, electronExecutable } from "./electron.js";

const { values } = parseArgs({
  options: { keep: { type: "boolean" }, scale: { type: "string" } },
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
});
const keep = values.keep === true;
const scale = Number(values.scale ?? "2");
if (!Number.isFinite(scale) || scale <= 0) throw new Error("--scale is a positive number.");

/** Measured budgets: a step slower than this fails the gate. */
const budgets = {
  workerReadyMs: 30_000,
  inspectMs: 30_000,
  exportMs: 20_000,
  /** Three outfits at game, each built, fitted and optimised: about 14 s measured. */
  wardrobeExportMs: 40_000,
  mcpMs: 60_000,
} as const;
const presets = ["clay", "full", "game", "portrait"] as const;
type Preset = (typeof presets)[number];
const hardware = (renderer: string, software: boolean): boolean =>
  !software && !/swiftshader|llvmpipe|softpipe|basic render|software/i.test(renderer);

const repository = resolve(appDir, "..", "..");
const register = pathToFileURL(join(repository, "packages/document/test/support/register.ts")).href;
const cliMain = join(repository, "apps/cli/src/main.ts");
const hostMain = join(repository, "packages/workshop/src/host/main.ts");
const mcpClient = join(repository, "apps/mcp/test/review.client.ts");

const scratch = mkdtempSync(join(tmpdir(), "irudd-review-qa-"));
const stateDir = join(scratch, "state");
const userData = join(scratch, "user-data");
const projectA = join(scratch, "owned");
const projectB = join(scratch, "attached");
const distribution = join(scratch, "Workshop App");
mkdirSync(distribution);
copyFileSync(join(appDir, "package.json"), join(distribution, "package.json"));
cpSync(join(appDir, "dist"), join(distribution, "dist"), { recursive: true });

const results: { step: string; ms: number; detail?: string }[] = [];
const problems: string[] = [];

async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    const value = await run();
    const ms = Math.round(performance.now() - started);
    results.push({ step: name, ms });
    console.log(`ok   ${name} (${ms} ms)`);
    return value;
  } catch (error) {
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}
const note = (name: string, detail: string): void => {
  results.push({ step: name, ms: 0, detail });
  console.log(`     ${name}: ${detail}`);
};

const field = (value: unknown, ...keys: Array<string | number>): unknown =>
  keys.reduce<unknown>(
    (v, k) => (typeof v === "object" && v !== null ? Reflect.get(v, k) : undefined),
    value,
  );
const str = (value: unknown, ...keys: Array<string | number>): string =>
  String(field(value, ...keys));
const num = (value: unknown, ...keys: Array<string | number>): number =>
  Number(field(value, ...keys));
const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const readJsonFile = (file: string): unknown => JSON.parse(readFileSync(file, "utf8"));
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

// ── Processes ───────────────────────────────────────────────────────────────

const children = new Set<ChildProcess>();
const browsers = new Set<Browser>();

interface Ran {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly ms: number;
}

function run(file: string, args: string[], env: Record<string, string> = {}): Promise<Ran> {
  const started = performance.now();
  return new Promise((done) => {
    const child = execFile(
      process.execPath,
      ["--import", register, file, ...args],
      {
        env: appEnvironment({ IRUDD_STATE_DIR: stateDir, ...env }),
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        children.delete(child);
        done({
          code: error && typeof error.code === "number" ? error.code : error ? 1 : 0,
          stdout,
          stderr,
          ms: Math.round(performance.now() - started),
        });
      },
    );
    children.add(child);
  });
}

async function cli(project: string, ...args: string[]): Promise<Ran & { value: unknown }> {
  const ran = await run(cliMain, [...args, "--project", project, "--json"]);
  let value: unknown;
  try {
    value = JSON.parse(ran.stdout);
  } catch {
    assert.fail(
      `irudd ${args.join(" ")} printed no JSON (exit ${ran.code}): ${ran.stdout}${ran.stderr}`,
    );
  }
  return { ...ran, value };
}

const isEditor = (url: string): boolean =>
  url.startsWith("file:") && url.endsWith("/dist/renderer/index.html");

async function editorPage(browser: Browser): Promise<Page> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    for (const context of browser.contexts())
      for (const candidate of context.pages()) if (isEditor(candidate.url())) return candidate;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    `No editor window among ${browser
      .contexts()
      .flatMap((c) => c.pages().map((p) => p.url()))
      .join(", ")}.`,
  );
}

interface App {
  readonly child: ChildProcess;
  readonly browser: Browser;
  readonly page: Page;
  readonly started: number;
  close(): Promise<void>;
  kill(): Promise<void>;
}

/** The packaged app, hidden, with a DevTools endpoint on an ephemeral loopback port. */
async function launch(project: string, create: boolean): Promise<App> {
  const started = performance.now();
  const child = spawn(
    electronExecutable(),
    [
      distribution,
      "--hidden",
      "--remote-debugging-port=0",
      `--force-device-scale-factor=${scale}`,
      "--user-data",
      userData,
      "--project",
      project,
      ...(create ? ["--create"] : []),
    ],
    {
      cwd: distribution,
      env: appEnvironment({ IRUDD_STATE_DIR: stateDir }),
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  children.add(child);
  const exited = new Promise<void>((done) =>
    child.once("exit", () => {
      children.delete(child);
      done();
    }),
  );
  let log = "";
  const endpoint = await new Promise<string>((done, fail) => {
    const timer = setTimeout(
      () => fail(new Error(`No DevTools endpoint: ${log.slice(-800)}`)),
      60_000,
    );
    child.stderr?.on("data", (chunk: Buffer) => {
      log += chunk.toString();
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(log);
      if (match?.[1]) {
        clearTimeout(timer);
        done(match[1]);
      }
    });
    child.once("exit", (code) =>
      fail(new Error(`The app exited with ${code}: ${log.slice(-800)}`)),
    );
  });
  const browser = await chromium.connectOverCDP(endpoint);
  browsers.add(browser);
  // The editor window by its URL, whichever page DevTools lists first.
  const page = await editorPage(browser);
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
  await page
    .waitForSelector("body[data-ready=true]", { timeout: 60_000 })
    .catch((error: unknown) => {
      throw new Error(
        `The window ${page.url()} did not get ready (contexts: ${browser
          .contexts()
          .map((c) =>
            c
              .pages()
              .map((p) => p.url())
              .join(" "),
          )
          .join(" | ")}): ${error instanceof Error ? error.message : String(error)}
${log.slice(-1500)}`,
      );
    });
  const dispose = async (): Promise<void> => {
    browsers.delete(browser);
    await browser.close().catch(() => undefined);
  };
  return {
    child,
    browser,
    page,
    started,
    async close() {
      await page.evaluate(() => window.close()).catch(() => undefined);
      const timeout = setTimeout(() => child.kill(), 20_000);
      await exited;
      clearTimeout(timeout);
      await dispose();
      assert.equal(child.exitCode, 0, `the app quit cleanly: ${log.slice(-400)}`);
    },
    async kill() {
      child.kill("SIGKILL");
      await exited;
      await dispose();
    },
  };
}

function startHeadless(project: string): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    [
      "--import",
      register,
      hostMain,
      project,
      "--create",
      "--label",
      "Review attached",
      "--forms",
      join(distribution, "dist", "forms"),
      "--json",
    ],
    {
      env: appEnvironment({ IRUDD_STATE_DIR: stateDir }),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  children.add(child);
  child.once("exit", () => children.delete(child));
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  return new Promise((done, fail) => {
    let out = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      if (out.includes("\n")) done(child);
    });
    child.once("exit", (code) => fail(new Error(`host exited ${String(code)}: ${stderr}`)));
  });
}

async function stopped(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((done) => {
    child.once("exit", () => done());
    child.kill();
  });
}

async function person(project: string): Promise<WorkshopClient> {
  let last: unknown;
  for (let i = 0; i < 100; i++) {
    try {
      return await connect({
        credential: { role: "human", project },
        stateDir,
        client: { name: "review-qa", version: "1" },
      });
    } catch (error) {
      last = error;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

async function available(client: WorkshopClient, via: "in-process" | "attached") {
  for (let i = 0; i < 300; i++) {
    const caps = await client.call("review.capabilities", {});
    if (caps.available && caps.renderer) {
      assert.equal(caps.renderer.via, via);
      return caps.renderer;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("No renderer registered within 30 s.");
}

// ── Images and GLBs ─────────────────────────────────────────────────────────

interface Decoded {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

/** A minimal decoder for the 8-bit, non-interlaced RGB(A) PNGs the worker writes. */
function decodePng(bytes: Uint8Array): Decoded {
  const buffer = Buffer.from(bytes);
  assert.equal(buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "PNG signature");
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const data: Buffer[] = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      assert.equal(body[8], 8, "8-bit samples");
      assert.equal(body[12], 0, "not interlaced");
      channels = body[9] === 6 ? 4 : body[9] === 2 ? 3 : 0;
      assert.ok(channels, `colour type ${String(body[9])}`);
    } else if (type === "IDAT") data.push(body);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  let at = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[at++] ?? 0;
    const line = raw.subarray(at, at + stride);
    at += stride;
    const current = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? (current[i - channels] ?? 0) : 0;
      const b = previous[i] ?? 0;
      const c = i >= channels ? (previous[i - channels] ?? 0) : 0;
      const x = line[i] ?? 0;
      let value = x;
      if (filter === 1) value = x + a;
      else if (filter === 2) value = x + b;
      else if (filter === 3) value = x + ((a + b) >> 1);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      current[i] = value & 255;
    }
    for (let px = 0; px < width; px++) {
      const o = (y * width + px) * 4;
      rgba[o] = current[px * channels] ?? 0;
      rgba[o + 1] = current[px * channels + 1] ?? 0;
      rgba[o + 2] = current[px * channels + 2] ?? 0;
      rgba[o + 3] = channels === 4 ? (current[px * channels + 3] ?? 0) : 255;
    }
    previous = current;
  }
  return { width, height, rgba };
}

/** Share of pixels that differ from the top-left (background) pixel. */
function drawnShare(image: Decoded): number {
  const [r, g, b] = [image.rgba[0] ?? 0, image.rgba[1] ?? 0, image.rgba[2] ?? 0];
  let drawn = 0;
  for (let i = 0; i < image.rgba.length; i += 4)
    if (
      Math.abs((image.rgba[i] ?? 0) - r) +
        Math.abs((image.rgba[i + 1] ?? 0) - g) +
        Math.abs((image.rgba[i + 2] ?? 0) - b) >
      24
    )
      drawn += 1;
  return drawn / (image.width * image.height);
}

/** The GLB's glTF JSON, after checking its header against its size. */
function glbJson(bytes: Uint8Array): unknown {
  const buffer = Buffer.from(bytes);
  assert.equal(buffer.readUInt32LE(0), 0x46546c67, "glTF magic");
  assert.equal(buffer.readUInt32LE(4), 2, "glTF 2");
  assert.equal(buffer.readUInt32LE(8), buffer.length, "GLB length");
  const jsonLength = buffer.readUInt32LE(12);
  return JSON.parse(buffer.toString("utf8", 20, 20 + jsonLength));
}

/** The GLB's provenance stamp. */
const glbStamp = (bytes: Uint8Array): unknown => field(glbJson(bytes), "asset", "extras", "irudd");

/** The scene names of a GLB, in order. */
const sceneNames = (bytes: Uint8Array): string[] =>
  array(field(glbJson(bytes), "scenes")).map((scene) => str(scene, "name"));

interface Expect {
  readonly documentId: string;
  readonly revision: number;
  readonly digest: string;
  readonly preset: Preset;
}

function checkSource(manifest: unknown, expect: Expect): void {
  assert.equal(str(manifest, "source", "documentId"), expect.documentId);
  assert.equal(num(manifest, "source", "revision"), expect.revision);
  assert.equal(str(manifest, "source", "documentDigest"), expect.digest);
  assert.equal(str(manifest, "preset"), expect.preset);
  assert.ok(
    hardware(str(manifest, "gpu", "renderer"), field(manifest, "gpu", "software") === true),
    `hardware GPU, not ${str(manifest, "gpu", "renderer")}`,
  );
}

function checkGlb(bytes: Uint8Array, manifest: unknown, expect: Expect): void {
  assert.equal(sha256(bytes), str(manifest, "glb", "sha256"), "GLB bytes match the manifest");
  assert.equal(bytes.byteLength, num(manifest, "glb", "byteLength"));
  const stamp = glbStamp(bytes);
  assert.equal(str(stamp, "document"), expect.documentId);
  assert.equal(num(stamp, "revision"), expect.revision);
  assert.equal(str(stamp, "digest"), expect.digest);
  assert.equal(str(stamp, "preset"), expect.preset);
}

interface Inspection {
  readonly manifest: unknown;
  readonly shas: ReadonlyMap<string, string>;
  readonly ms: number;
}

/** Check an `irudd inspect` output directory against its manifest and the request. */
function checkInspection(
  dir: string,
  expect: Expect,
  size: { width: number; height: number; ratio: number },
  ms: number,
): Inspection {
  const manifest = readJsonFile(join(dir, "manifest.json"));
  assert.equal(str(manifest, "format"), "irudd.review-inspection");
  checkSource(manifest, expect);
  checkGlb(readFileSync(join(dir, "model.glb")), manifest, expect);
  assert.equal(field(manifest, "readiness", "settled"), true, "the warm-up frames matched");
  const images = array(field(manifest, "images"));
  assert.ok(images.length >= 3, "at least the body and silhouette sheets");
  const shas = new Map<string, string>();
  for (const image of images) {
    const name = str(image, "name");
    const bytes = readFileSync(join(dir, name));
    assert.equal(sha256(bytes), str(image, "sha256"), `${name} bytes match the manifest`);
    const decoded = decodePng(bytes);
    assert.equal(decoded.width, size.width * size.ratio, `${name} width in device pixels`);
    assert.equal(decoded.height, size.height * size.ratio, `${name} height in device pixels`);
    assert.equal(num(image, "width"), decoded.width);
    const share = drawnShare(decoded);
    assert.ok(share > 0.01 && share < 0.95, `${name} shows a figure (${share.toFixed(3)})`);
    if (str(image, "kind") === "silhouette")
      assert.ok(num(image, "silhouette", "coverage") > 0.01, `${name} silhouette coverage`);
    shas.set(name, str(image, "sha256"));
  }
  return { manifest, shas, ms };
}

async function head(
  client: WorkshopClient,
  documentId: string,
): Promise<Expect & { doc: unknown }> {
  const current = await client.call("current", { documentId });
  assert.ok(current.document && current.documentDigest);
  // The client derives the digest itself from the document it read.
  assert.equal(
    documentDigest(current.document),
    current.documentDigest,
    "the document digest is the digest of the document",
  );
  return {
    documentId,
    revision: current.revision,
    digest: current.documentDigest,
    preset: "clay",
    doc: current.document,
  };
}

// ── The person's window ─────────────────────────────────────────────────────

/** Count WebGL draws and clears in the person's page from now on. */
async function countDraws(page: Page): Promise<void> {
  await page.evaluate(() => {
    const key = "__reviewQaDraws";
    if (Reflect.has(globalThis, key)) return;
    Reflect.set(globalThis, key, 0);
    const names = [
      "drawElements",
      "drawArrays",
      "drawElementsInstanced",
      "drawArraysInstanced",
      "clear",
    ];
    for (const proto of [WebGL2RenderingContext.prototype, WebGLRenderingContext.prototype])
      for (const name of names) {
        const original: unknown = Reflect.get(proto, name);
        if (typeof original !== "function") continue;
        Object.defineProperty(proto, name, {
          configurable: true,
          value(this: unknown, ...args: unknown[]): unknown {
            Reflect.set(globalThis, key, Number(Reflect.get(globalThis, key)) + 1);
            return Reflect.apply(original, this, args);
          },
        });
      }
  });
}
const draws = (page: Page): Promise<number> =>
  page.evaluate(() => Number(Reflect.get(globalThis, "__reviewQaDraws") ?? 0));

/** What the person's viewport shows: redraw once and hash that frame. */
async function viewportHash(page: Page): Promise<string> {
  const frame = await page.evaluate(async () => {
    const canvas = document.querySelector("#viewport canvas");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("No viewport canvas.");
    const button = document.getElementById("tool-select");
    if (!(button instanceof HTMLButtonElement)) throw new Error("No #tool-select.");
    const bitmap = await new Promise<ImageBitmap>((done, fail) => {
      button.click();
      requestAnimationFrame(() => createImageBitmap(canvas).then(done, fail));
    });
    const c = new OffscreenCanvas(bitmap.width, bitmap.height);
    const g = c.getContext("2d");
    if (!g) throw new Error("No 2D context.");
    g.drawImage(bitmap, 0, 0);
    const pixels = g.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let drawn = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (
        Math.abs((pixels[i] ?? 0) - (pixels[0] ?? 0)) +
          Math.abs((pixels[i + 1] ?? 0) - (pixels[1] ?? 0)) +
          Math.abs((pixels[i + 2] ?? 0) - (pixels[2] ?? 0)) >
        24
      )
        drawn += 1;
    const digest = await crypto.subtle.digest("SHA-256", pixels);
    return {
      hash: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(""),
      share: drawn / (bitmap.width * bitmap.height),
    };
  });
  assert.ok(
    frame.share > 0.01,
    `the viewport frame shows the character (${frame.share.toFixed(3)})`,
  );
  return frame.hash;
}

/** Move the person's camera: a drag, then a zoom. */
async function orbit(page: Page): Promise<void> {
  const box = await page.locator("#viewport canvas").boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + 24, box.y + 24);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 90, { steps: 4 });
  await page.mouse.up();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 300);
}

async function revisionShown(page: Page, at: number): Promise<void> {
  await page.waitForFunction(
    (n) =>
      new RegExp(`revision ${n}\\b`).test(
        document.querySelector("#status-right")?.textContent ?? "",
      ),
    at,
    { timeout: 20_000 },
  );
}

// ── The run ─────────────────────────────────────────────────────────────────

const inspectDir = (name: string): string => join(scratch, "out", name);
const inspections = new Map<string, Inspection>();

async function cliInspect(
  project: string,
  name: string,
  expect: Expect,
  extra: string[] = [],
  size = { width: 768, height: 768, ratio: 2 },
): Promise<Inspection> {
  const dir = inspectDir(name);
  const ran = await cli(
    project,
    "inspect",
    expect.documentId,
    "--preset",
    expect.preset,
    "--out",
    dir,
    ...extra,
  );
  assert.equal(ran.code, 0, `${ran.stdout}${ran.stderr}`);
  assert.ok(ran.ms < budgets.inspectMs, `inspect within ${budgets.inspectMs} ms (${ran.ms})`);
  const inspection = checkInspection(dir, expect, size, ran.ms);
  inspections.set(name, inspection);
  return inspection;
}

const sameImages = (a: Inspection, b: Inspection): void => {
  assert.equal(a.shas.size, b.shas.size, "same image count");
  for (const [name, sha] of a.shas) assert.equal(b.shas.get(name), sha, `${name} is identical`);
};

let app: App | undefined;
let host: ChildProcess | undefined;
const clients: WorkshopClient[] = [];
let failed = false;
try {
  // ── Desktop owns the project ──
  app = await step("launch the packaged desktop on a new project", () => launch(projectA, true));
  const page = app.page;
  const ownerA = await person(projectA);
  clients.push(ownerA);

  const renderer = await step("the worker registers in process on the hardware GPU", async () => {
    const view = await available(ownerA, "in-process");
    const ready = Math.round(performance.now() - (app?.started ?? 0));
    assert.ok(ready < budgets.workerReadyMs, `worker ready within budget (${ready} ms)`);
    assert.ok(hardware(view.info.gpu.renderer, view.info.gpu.software), view.info.gpu.renderer);
    note("renderer", `${view.info.gpu.renderer}; ready ${ready} ms after launch`);
    return view;
  });

  await step(
    "the worker is a separate, hidden page outside the person's browser context",
    async () => {
      const cdp = await app?.browser.newBrowserCDPSession();
      assert.ok(cdp);
      const { targetInfos } = await cdp.send("Target.getTargets");
      const pages = targetInfos.filter((t) => t.type === "page");
      const worker = pages.find((t) => t.url.startsWith("irudd-review://worker/"));
      const main = pages.find((t) => t.url === page.url());
      assert.ok(worker, `worker target among ${pages.map((p) => p.url).join(", ")}`);
      assert.ok(main);
      assert.notEqual(worker.browserContextId, main.browserContextId, "separate partitions");
      const first = app?.browser.contexts()[0]?.pages()[0]?.url() ?? "";
      note("first page", first.startsWith("irudd-review:") ? "the worker" : "the editor");
      const loaded = await page.evaluate(() =>
        performance.getEntriesByType("resource").map((e) => e.name),
      );
      assert.ok(
        !loaded.some((u) => u.startsWith("irudd-review:")),
        "no review resource in the window",
      );
      const dpr = await page.evaluate(() => devicePixelRatio);
      assert.equal(dpr, scale, "the person's window runs at the requested scale");
      note("targets", `${pages.length} pages; window DPR ${dpr}`);
    },
  );

  const starts = await step("start the painted and unpainted forms", async () => {
    // The painted form through the editor's own menu, so the person's window shows it.
    await page.selectOption("#start", "feline-worker");
    await page.waitForSelector("#outliner [data-part]");
    await revisionShown(page, 1);
    const shown = await page.inputValue("#document");
    const starter = (await ownerA.call("starters", {})).starters.find(
      (x) => x.id === "feline-worker",
    );
    const marsh = await ownerA.call("start", {
      documentId: "doc-marsh",
      requestId: "req-review-marsh",
      starter: "marsh-draw-3",
    });
    assert.ok((starter?.artwork ?? []).length >= 1, "feline-worker declares its artwork");
    assert.equal((marsh.artwork ?? []).length, 0, "marsh-draw-3 has no artwork");
    return {
      feline: await head(ownerA, shown),
      marsh: await head(ownerA, "doc-marsh"),
      staged: (starter?.artwork ?? []).map((a) => a.digest),
    };
  });
  const staged = starts.staged;
  const felineId = starts.feline.documentId;
  await countDraws(page);

  const credentialFile = await step("pair an agent from the CLI", async () => {
    const paired = await cli(projectA, "pair", "review-agent", "--name", "Review agent");
    assert.equal(paired.code, 0, paired.stdout + paired.stderr);
    const file = str(paired.value, "credentialFile");
    assert.ok(existsSync(file));
    return file;
  });

  for (const [subject, expect] of [
    ["feline", starts.feline],
    ["marsh", starts.marsh],
  ] as const)
    for (const preset of presets)
      await step(`CLI inspect ${subject} at ${preset}`, async () => {
        const inspection = await cliInspect(projectA, `${subject}-${preset}`, {
          ...expect,
          preset,
        });
        note(
          `${subject}-${preset}`,
          `${inspection.shas.size} images, GLB ${num(inspection.manifest, "glb", "byteLength")} bytes, ${inspection.ms} ms, timing ${JSON.stringify(field(inspection.manifest, "timing"))}`,
        );
      });

  await step("painted and clay renders of the painted subject differ", () => {
    const clay = inspections.get("feline-clay");
    const full = inspections.get("feline-full");
    assert.ok(clay && full);
    const front = [...clay.shas.keys()].find((n) => n.includes("body-front"));
    assert.ok(front);
    assert.notEqual(clay.shas.get(front), full.shas.get(front), "textures change the body image");
    return Promise.resolve();
  });

  await step("CLI export writes the GLB and a bound manifest, repeatably", async () => {
    const file = join(scratch, "out", "feline-game.glb");
    const first = await cli(projectA, "export", felineId, "--preset", "game", "--out", file);
    assert.equal(first.code, 0, first.stdout + first.stderr);
    assert.ok(first.ms < budgets.exportMs, `export within budget (${first.ms} ms)`);
    const manifest = readJsonFile(`${file}.json`);
    const expect = { ...starts.feline, preset: "game" as const };
    checkSource(manifest, expect);
    checkGlb(readFileSync(file), manifest, expect);
    // The staged sheet is project art (no credit needed); the stamp names it and every origin.
    const artwork = array(field(manifest, "provenance", "artwork"));
    assert.ok(
      artwork.some((a) => str(a, "source") === "project" && staged.includes(str(a, "digest"))),
      "the stamp names the staged project artwork",
    );
    for (const a of artwork.filter((x) => str(x, "source") === "bundled"))
      assert.ok(str(a, "origin", "license"), `bundled ${str(a, "file")} has a licence`);
    assert.deepEqual(field(manifest, "credits"), [], "project-owned art carries no credit");
    const again = await cli(projectA, "export", felineId, "--preset", "game", "--out", file);
    assert.equal(again.code, 0);
    assert.equal(str(again.value, "glb", "sha256"), str(manifest, "glb", "sha256"));
    assert.equal(field(again.value, "repeat", "identical"), true);
    note("export", `${first.ms} ms then ${again.ms} ms; sha ${str(manifest, "glb", "sha256")}`);
  });

  await step("a repeated inspection is byte-identical", async () => {
    const repeat = await cliInspect(projectA, "feline-full-again", {
      ...starts.feline,
      preset: "full",
    });
    const first = inspections.get("feline-full");
    assert.ok(first);
    sameImages(first, repeat);
    assert.equal(field(repeat.manifest, "repeat", "identical"), true);
  });

  await step("a review draws nothing in the person's viewport and leaves its view", async () => {
    const before = await viewportHash(page);
    assert.equal(await viewportHash(page), before, "the viewport hash is stable at rest");
    const count = await draws(page);
    const reviewed = await ownerA.call("review.inspect", {
      documentId: felineId,
      preset: "clay",
    });
    assert.equal(await draws(page), count, "no WebGL draw in the person's page during a review");
    assert.equal(await viewportHash(page), before, "the person's view is unchanged");
    const clay = inspections.get("feline-clay");
    assert.ok(clay);
    for (const image of reviewed.images)
      assert.equal(clay.shas.get(image.name), image.sha256, `${image.name} as the CLI captured`);
  });

  await step("the person orbits during a review; neither affects the other", async () => {
    const before = await viewportHash(page);
    const at = (await ownerA.call("current", { documentId: felineId })).revision;
    const started = performance.now();
    let finished = 0;
    const pending = ownerA
      .call("review.inspect", { documentId: felineId, preset: "clay" })
      .finally(() => (finished = Math.round(performance.now() - started)));
    await orbit(page);
    const orbited = Math.round(performance.now() - started);
    const reviewed = await pending;
    const done = Math.round(performance.now() - started);
    const after = await viewportHash(page);
    // A hidden editor window gets about two frames a second, so its input is slow on its own.
    note("orbit", `input done at ${orbited} ms; review done at ${finished || done} ms`);
    assert.notEqual(after, before, "the orbit moved the person's view");
    const clay = inspections.get("feline-clay");
    assert.ok(clay);
    for (const image of reviewed.images)
      assert.equal(
        clay.shas.get(image.name),
        image.sha256,
        `${image.name} unaffected by the orbit`,
      );
    assert.equal((await ownerA.call("current", { documentId: felineId })).revision, at);
  });

  const pinned = await step(
    "an edit during a review: the output stays on its revision",
    async () => {
      const before = await head(ownerA, felineId);
      const pending = ownerA.call("review.inspect", {
        documentId: felineId,
        preset: "clay",
        sheets: ["body", "silhouette", "motion"],
      });
      await new Promise((r) => setTimeout(r, 400));
      const parts = array(field(before.doc, "parts"));
      const part = str(parts[1] ?? parts[0], "id");
      const edited = await ownerA.call("apply", {
        request: envelope(
          felineId,
          before.revision,
          { type: "edit", ops: [{ op: "part.rename", part, label: "Edited during review" }] },
          "req-review-edit-during",
        ),
      });
      assert.equal(edited.kind, "committed", JSON.stringify(edited));
      await revisionShown(page, before.revision + 1);
      const reviewed = await pending;
      assert.equal(reviewed.source.revision, before.revision);
      assert.equal(reviewed.source.documentDigest, before.digest);
      assert.equal(reviewed.source.headMoved, true, "the manifest says the head moved");
      assert.equal(reviewed.source.head.atCompletion, before.revision + 1);
      const clay = inspections.get("feline-clay");
      assert.ok(clay);
      for (const image of reviewed.images.filter((i) => i.kind !== "motion"))
        assert.equal(clay.shas.get(image.name), image.sha256, `${image.name} is revision's`);
      note("motion", JSON.stringify(reviewed.motion).slice(0, 200));
      return { revision: before.revision, digest: before.digest };
    },
  );

  await step("a named earlier revision exports exactly that revision", async () => {
    const file = join(scratch, "out", "feline-pinned.glb");
    const ran = await cli(
      projectA,
      "export",
      felineId,
      "--preset",
      "clay",
      "--revision",
      String(pinned.revision),
      "--out",
      file,
    );
    assert.equal(ran.code, 0, ran.stdout + ran.stderr);
    const expect = { documentId: felineId, ...pinned, preset: "clay" as const };
    checkSource(ran.value, expect);
    checkGlb(readFileSync(file), ran.value, expect);
    const latest = await head(ownerA, felineId);
    assert.notEqual(latest.digest, pinned.digest);
  });

  await step("high-DPI images at pixel ratio 3", async () => {
    const inspection = await cliInspect(
      projectA,
      "feline-dpr3",
      { ...(await head(ownerA, felineId)), preset: "clay" },
      ["--size", "512", "--pixel-ratio", "3", "--sheet", "body"],
      { width: 512, height: 512, ratio: 3 },
    );
    note(
      "dpr3",
      `${inspection.shas.size} images at 1536 px; worker DPR ${String(field(inspection.manifest, "readiness", "devicePixelRatio"))}`,
    );
  });

  const wardrobe = await step(
    "the person exports every saved outfit of field-wardrobe from the editor",
    async () => {
      await page.selectOption("#start", "field-wardrobe");
      await page.waitForSelector("#outliner [data-part]");
      await revisionShown(page, 1);
      const expect = {
        ...(await head(ownerA, await page.inputValue("#document"))),
        preset: "game" as const,
      };
      const looks = array(field(expect.doc, "features", "outfit.looks", "looks")).map((look) =>
        str(look, "name"),
      );
      assert.ok(looks.length >= 2, `field-wardrobe has saved outfits (${looks.join(", ")})`);
      await page.waitForSelector("#export-outfits:not([disabled])");
      await page.selectOption("#export-preset", "game");
      await page.check("#export-outfits");
      await page.click("#export");
      await page.waitForSelector("#status:has-text('with outfits')", {
        timeout: budgets.wardrobeExportMs,
      });
      const saved = readdirSync(join(projectA, "exports")).filter((name) =>
        name.endsWith(`-r${expect.revision}-game-outfits.glb`),
      );
      assert.equal(saved.length, 1, `one wardrobe export file (${saved.join(", ")})`);
      const file = join(projectA, "exports", saved[0] ?? "");
      const bytes = readFileSync(file);
      assert.deepEqual(sceneNames(bytes), looks, "one scene per saved outfit, in saved order");
      const stamp = glbStamp(bytes);
      assert.equal(str(stamp, "digest"), expect.digest);
      assert.equal(str(stamp, "preset"), "game");
      assert.deepEqual(field(stamp, "wardrobe", "looks"), looks, "the stamp names the outfits");
      await page.waitForSelector(`.pl-status:has-text('${saved[0] ?? ""}')`);
      note("wardrobe", `${saved[0] ?? ""}: ${looks.join(", ")}; sha ${sha256(bytes)}`);
      return { expect, looks, sha: sha256(bytes) };
    },
  );

  await step("CLI wardrobe export is the editor's file; as worn stays one scene", async () => {
    const { expect, looks, sha } = wardrobe;
    const file = join(scratch, "out", "field-game-outfits.glb");
    const ran = await cli(
      projectA,
      "export",
      expect.documentId,
      "--preset",
      "game",
      "--wardrobe",
      "--out",
      file,
    );
    assert.equal(ran.code, 0, ran.stdout + ran.stderr);
    assert.ok(ran.ms < budgets.wardrobeExportMs, `wardrobe export within budget (${ran.ms} ms)`);
    checkSource(ran.value, expect);
    checkGlb(readFileSync(file), ran.value, expect);
    assert.equal(str(ran.value, "glb", "sha256"), sha, "the CLI exported the editor's bytes");
    assert.deepEqual(field(ran.value, "wardrobe", "looks"), looks);
    const worn = join(scratch, "out", "field-game.glb");
    const single = await cli(
      projectA,
      "export",
      expect.documentId,
      "--preset",
      "game",
      "--out",
      worn,
    );
    assert.equal(single.code, 0, single.stdout + single.stderr);
    checkGlb(readFileSync(worn), single.value, expect);
    assert.notEqual(str(single.value, "glb", "sha256"), sha, "as worn is its own artifact");
    assert.equal(field(single.value, "wardrobe"), null, "as worn names no outfits");
    assert.equal(sceneNames(readFileSync(worn)).length, 1, "as worn is one scene");
    assert.equal(field(glbStamp(readFileSync(worn)), "wardrobe"), undefined);
  });

  await step("MCP SDK client: GPU label and image payloads match the captured files", async () => {
    const out = join(scratch, "out", "mcp");
    const ran = await run(mcpClient, [
      "--credential",
      credentialFile,
      "--out",
      out,
      "--document",
      "doc-marsh",
      "--preset",
      "game",
      "--width",
      "768",
      "--pixel-ratio",
      "2",
      "--inline",
      "12",
      "--wardrobe",
      wardrobe.expect.documentId,
    ]);
    assert.equal(ran.code, 0, ran.stderr.slice(-2000));
    assert.ok(ran.ms < budgets.mcpMs, `MCP run within budget (${ran.ms} ms)`);
    const report = readJsonFile(join(out, "report.json"));
    const tools = array(field(report, "tools")).map(String);
    for (const name of [
      "review_capabilities",
      "export_character",
      "inspect_character",
      "review_image",
    ])
      assert.ok(tools.includes(name), `MCP offers ${name}`);
    assert.ok(!tools.some((t) => /serve|complete|put/.test(t)), "no renderer tools for agents");
    const label = str(report, "capabilities", "value", "renderer", "info", "gpu", "renderer");
    assert.equal(label, renderer.info.gpu.renderer, "MCP GPU label is the renderer's");
    const captured = inspections.get("marsh-game");
    assert.ok(captured);
    assert.equal(str(report, "inspect", "manifest", "gpu", "renderer"), label);
    assert.equal(
      str(report, "inspect", "manifest", "glb", "sha256"),
      str(captured.manifest, "glb", "sha256"),
      "the agent's inspection exported the same GLB",
    );
    const received = array(field(report, "inspect", "received"));
    assert.ok(received.length >= 3, "images arrived as MCP image content");
    for (const image of received) {
      const name = str(image, "name");
      assert.equal(str(image, "mimeType"), "image/png");
      assert.equal(str(image, "received"), str(image, "sha256"), `${name} payload hash`);
      const file = readFileSync(join(inspectDir("marsh-game"), name));
      assert.equal(sha256(file), str(image, "received"), `${name} equals the CLI's file`);
      assert.deepEqual(readFileSync(str(image, "file")), file);
    }
    assert.equal(str(report, "reviewImage", "received"), str(report, "reviewImage", "sha256"));
    assert.equal(field(report, "unknownImage", "isError"), true);
    assert.match(str(report, "unknownImage", "summary"), /ArtifactUnknown/);
    assert.equal(str(report, "export", "value", "source", "documentDigest"), starts.marsh.digest);
    assert.equal(field(report, "export", "value", "wardrobe"), null, "a single-scene export");
    assert.equal(field(report, "wardrobe", "isError"), false, str(report, "wardrobe", "summary"));
    assert.equal(
      str(report, "wardrobe", "value", "glb", "sha256"),
      wardrobe.sha,
      "the agent's wardrobe export is the editor's file",
    );
    assert.deepEqual(field(report, "wardrobe", "value", "wardrobe", "looks"), wardrobe.looks);
    note("mcp", `${received.length} images; ${JSON.stringify(field(report, "timings"))}`);
  });

  const issuedInA = str(inspections.get("feline-clay")?.manifest, "glb", "sha256");
  await step("quit the desktop cleanly", async () => {
    await app?.close();
    app = undefined;
  });

  // ── A headless host owns the project; the desktop attaches ──
  host = await step("start a headless host with the shipped forms", () => startHeadless(projectB));
  const ownerB = await person(projectB);
  clients.push(ownerB);
  const startedB = await ownerB.call("start", {
    documentId: "doc-feline",
    requestId: "req-review-feline-b",
    starter: "feline-worker",
  });
  assert.ok((startedB.artwork ?? []).length >= 1, "the headless host staged the artwork too");
  const felineB = await head(ownerB, "doc-feline");

  await step("without a renderer, review is unavailable with actions", async () => {
    const caps = await cli(projectB, "review");
    assert.equal(caps.code, 3);
    assert.equal(field(caps.value, "available"), false);
    assert.ok(array(field(caps.value, "actions")).length >= 1);
    const refused = await cli(projectB, "inspect", "doc-feline", "--out", inspectDir("refused"));
    assert.equal(refused.code, 3, refused.stdout + refused.stderr);
    assert.equal(str(refused.value, "error", "_tag"), "RendererUnavailable");
    assert.ok(array(field(refused.value, "error", "actions")).length >= 1);
  });

  await step("artifacts issued for another project cannot be read", async () => {
    await assert.rejects(
      ownerB.call("review.read", { sha256: issuedInA }),
      (e) => e instanceof WorkshopError && e._tag === "ArtifactUnknown",
    );
  });

  app = await step("launch the desktop on the hosted project", () => launch(projectB, false));
  await step("the desktop serves its worker to the headless host", async () => {
    const view = await available(ownerB, "attached");
    assert.ok(hardware(view.info.gpu.renderer, view.info.gpu.software));
  });
  const attached = await step("CLI inspect through the attached worker", async () => {
    const inspection = await cliInspect(projectB, "attached-clay", { ...felineB, preset: "clay" });
    const owned = inspections.get("feline-clay");
    if (owned && felineB.digest === starts.feline.digest) sameImages(owned, inspection);
    note(
      "attached",
      `${inspection.ms} ms; same digest as owned: ${String(felineB.digest === starts.feline.digest)}`,
    );
    return inspection;
  });

  await step("a desktop killed mid-render fails the job with RendererLost", async () => {
    const pending = ownerB.call("review.inspect", {
      documentId: "doc-feline",
      preset: "full",
      sheets: ["body", "silhouette", "motion", "expressions"],
    });
    // Settle now: the rejection arrives while the desktop is still exiting.
    const outcome = pending.then(
      () => undefined,
      (error: unknown) => error,
    );
    await new Promise((r) => setTimeout(r, 1_500));
    const killed = performance.now();
    await app?.kill();
    app = undefined;
    const error = await outcome;
    assert.ok(error instanceof WorkshopError, `the job failed: ${String(error)}`);
    assert.equal(error._tag, "RendererLost");
    note("renderer lost", `${Math.round(performance.now() - killed)} ms after the kill`);
    const caps = await ownerB.call("review.capabilities", {});
    assert.equal(caps.available, false);
  });

  app = await step("relaunch the desktop: it serves again", () => launch(projectB, false));
  await step("the reconnected worker renders the same images", async () => {
    await available(ownerB, "attached");
    const again = await cliInspect(projectB, "attached-clay-again", { ...felineB, preset: "clay" });
    sameImages(attached, again);
  });
  await step("quit the desktop and the headless host", async () => {
    await app?.close();
    app = undefined;
    if (host) await stopped(host);
    host = undefined;
  });

  if (problems.length) throw new Error(`Page problems:\n${problems.join("\n")}`);
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  for (const client of clients) client.close();
  if (app) await app.kill().catch(() => undefined);
  for (const browser of browsers) await browser.close().catch(() => undefined);
  for (const child of children) child.kill();
  const report = join(scratch, "results.json");
  writeFileSync(
    report,
    JSON.stringify({ failed, scale, budgets, results, problems }, null, 2) + "\n",
  );
  console.log(
    `\n${failed ? "FAILED" : "passed"}: ${results.filter((r) => !r.detail).length} steps`,
  );
  if (keep || failed) console.log(`kept ${scratch}`);
  else rmSync(scratch, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
