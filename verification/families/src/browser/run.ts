import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { chromium, type Browser, type Page } from "@playwright/test";
import { bundledAssets, type Preset } from "@irudd/character";
import { humanPackFiles } from "@irudd/character/human";
import { humanPaintFile } from "@irudd/character/human/paint";
import { blobsDir, outDir, referenceBlobsDir, repository } from "../paths.js";
import type { ExportRequest, ExportResponse } from "./entry.js";

const origin = "https://g4a.invalid";
const software = ["swiftshader", "llvmpipe", "softpipe", "basic render", "software", "gdi generic"];

export interface Session {
  readonly chrome: string;
  readonly renderer: string | null;
  readonly softwareFallback: boolean;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly deviceScaleFactor: number;
}

export interface TexturedRunner {
  readonly session: Session;
  exportAll(requests: ReadonlyArray<ExportRequest>): Promise<ExportResponse[]>;
  close(): Promise<void>;
}

function bundle(): string {
  const dir = join(outDir, "browser");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "bundle.js");
  buildSync({
    entryPoints: [fileURLToPath(new URL("./entry.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2024",
    outfile: file,
    logLevel: "warning",
    sourcemap: "inline",
  });
  return readFileSync(file, "utf8");
}

async function route(page: Page, script: string): Promise<void> {
  const assets = join(repository, "packages", "character", "assets");
  const packs = new Set([...humanPackFiles, humanPaintFile].map((p) => `assets/human/${p.file}`));
  await page.route(`${origin}/**`, async (r) => {
    const path = new URL(r.request().url()).pathname.slice(1);
    if (path === "" || path === "index.html")
      return r.fulfill({
        contentType: "text/html",
        body: `<!doctype html><meta charset="utf-8"><title>g4a</title><script type="module" src="bundle.js"></script>`,
      });
    if (path === "bundle.js") return r.fulfill({ contentType: "text/javascript", body: script });
    if (packs.has(path))
      return r.fulfill({
        contentType: "application/octet-stream",
        body: readFileSync(join(assets, path.slice("assets/".length))),
      });
    const asset =
      path.startsWith("assets/") && bundledAssets.find((a) => `assets/${a.file}` === path);
    if (asset)
      return r.fulfill({
        contentType: asset.mediaType,
        body: readFileSync(join(assets, asset.file)),
      });
    if (path.startsWith("blobs/"))
      for (const dir of [blobsDir, referenceBlobsDir]) {
        const file = join(dir, path.slice(6));
        if (existsSync(file))
          return r.fulfill({ contentType: "application/octet-stream", body: readFileSync(file) });
      }
    return r.fulfill({ status: 404, body: "" });
  });
}

export async function openTextured(
  options: { readonly allowSoftware?: boolean } = {},
): Promise<TexturedRunner> {
  const script = bundle();
  const browser: Browser = await chromium.launch({ channel: "chrome" });
  try {
    return await start(browser, script, options);
  } catch (error) {
    await browser.close();
    throw error;
  }
}

async function start(
  browser: Browser,
  script: string,
  options: { readonly allowSoftware?: boolean },
): Promise<TexturedRunner> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await route(page, script);
  await page.goto(`${origin}/index.html`);
  await page.waitForFunction(() => "iruddExport" in globalThis);
  const renderer = await page.evaluate(() => {
    const read: unknown = Reflect.get(globalThis, "iruddRenderer");
    const value: unknown = typeof read === "function" ? Reflect.apply(read, undefined, []) : null;
    return typeof value === "string" ? value : null;
  });
  const softwareFallback =
    renderer === null || software.some((k) => renderer.toLowerCase().includes(k));
  if (softwareFallback && !options.allowSoftware)
    throw new Error(
      `Chrome reports a software renderer (${renderer}); pass --allow-software to record a fallback run.`,
    );
  const session: Session = {
    chrome: browser.version(),
    renderer,
    softwareFallback,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  };
  return {
    session,
    async exportAll(requests) {
      const out = await page.evaluate(async (list) => {
        const run: unknown = Reflect.get(globalThis, "iruddExport");
        if (typeof run !== "function") throw new Error("The export page did not load.");
        const result: unknown = await Reflect.apply(run, undefined, [list]);
        return JSON.stringify(result);
      }, requests);
      if (errors.length) throw new Error("Page errors: " + errors.join("; "));
      const parsed: unknown = JSON.parse(out);
      if (!Array.isArray(parsed)) throw new Error("The export page returned no list.");
      return parsed.filter(isResponse);
    },
    close: () => browser.close(),
  };
}

function isResponse(value: unknown): value is ExportResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "name") === "string" &&
    typeof Reflect.get(value, "preset") === "string"
  );
}

export const texturedPresets: ReadonlyArray<Preset> = ["full", "game", "portrait"];
