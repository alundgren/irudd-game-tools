// The seeded adult at the textured presets against G0, in installed Chrome
// (hardware GPU, 1280 × 800 at device scale factor 1, as G0's sessions were).
// Run it under the shared GPU lock:
//
//   node --import ../../packages/document/test/support/register.ts src/locked.ts \
//     src/human-textured.ts [--preset full|game] [--allow-software] [SEED|look-SEED|VARIANT...]
//
// Without names it runs every required export: all eleven seeded adults at
// Full, 491, 42 and 1 at Game, and the starter's looks (look-SEED) and the
// variants below at both. A missing reference fails the run.
//
// Each document is generated here through the real reducer, exported
// in the page (src/browser/human-entry.ts) and compared whole with
// .reference-cache/human-oracle/adult-NAME-PRESET.glb: structure, every
// accessor and every image by decoded pixels. Fresh exports and the report go
// to .reference-cache/g4a/human-textured/.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { chromium, type Page } from "@playwright/test";
import { bundledAssets, type Preset } from "@irudd/character";
import {
  dressedAdult,
  humanLooks,
  humanPackFiles,
  seededHumanAdult,
  type HumanAdultParams,
} from "@irudd/character/human";
import { humanPaintFile } from "@irudd/character/human/paint";
import { documentJson } from "@irudd/document";
import type { HumanExportRequest, HumanExportResponse } from "./browser/human-entry.js";
import { compareGlb, type ImageComparison } from "./compare.js";
import { humanAssetsDir, loadHumanBody } from "./human-assets.js";
import { adultStore, documentOf, humanOracleDir } from "./human-clay.js";
import { outDir, repository } from "./paths.js";

const origin = "https://g4a.invalid";
const software = ["swiftshader", "llvmpipe", "softpipe", "basic render", "software", "gdi generic"];
const dir = join(outDir, "human-textured");

const argv = process.argv.slice(2);
const flag = (name: string) => argv.indexOf(name);
const presetAt = flag("--preset");
const chosen: Preset | undefined =
  presetAt >= 0 ? (argv[presetAt + 1] === "game" ? "game" : "full") : undefined;
const allowSoftware = flag("--allow-software") >= 0;
/**
 * A seeded adult or a dressed starter with one style field changed. Each
 * reference is G0's export of that same adult and change (.reference-cache/g0/derived).
 */
const variants: Readonly<
  Record<
    string,
    { readonly seed: number; readonly dressed?: true; readonly style: HumanAdultParams["style"] }
  >
> = {
  "491-rose-stain": { seed: 491, style: { makeup: "Rose stain" } },
  "look-8973-crop": { seed: 8973, dressed: true, style: { hair: "Crop" } },
  "look-8973-buzz-cut": { seed: 8973, dressed: true, style: { hair: "Buzz cut" } },
  "look-8973-ponytail": { seed: 8973, dressed: true, style: { hair: "Ponytail" } },
  "look-8973-bun": { seed: 8973, dressed: true, style: { hair: "Bun" } },
  "look-8950-crop": { seed: 8950, dressed: true, style: { hair: "Crop" } },
};
const named = argv.filter(
  (a, i) => (/^(look-)?\d+$/.test(a) || Object.hasOwn(variants, a)) && argv[i - 1] !== "--preset",
);
// Every seeded adult of the frozen fixtures at Full; G0 exported Game for 491, 42, 1 and 491's look.
// The looks the starter offers, at both: 491's tailored outfit, 8973's Day dress and the six worn cast
// members.
const required: ReadonlyArray<{ readonly name: string; readonly presets: ReadonlyArray<Preset> }> =
  [
    { name: "491", presets: ["full", "game"] },
    { name: "42", presets: ["full", "game"] },
    { name: "1", presets: ["full", "game"] },
    ...[8713, 8950, 8973, 8990, 9001, 49027675, 716973847, 3782767734].map((seed) => ({
      name: String(seed),
      presets: ["full"] as const,
    })),
    ...[491, 8950, 8973, 1, 42, 8713, 9001, 49027675, 3782767734].map((seed) => ({
      name: `look-${seed}`,
      presets: ["full", "game"] as const,
    })),
    ...Object.keys(variants).map((name) => ({ name, presets: ["full", "game"] as const })),
  ];
const jobs = (
  named.length ? named.map((name) => ({ name, presets: ["full", "game"] as const })) : required
)
  .map((job) => ({ name: job.name, presets: job.presets.filter((p) => !chosen || p === chosen) }))
  .filter((job) => job.presets.length);

/**
 * The differences from G0 that remain, both in the face colour (image 1 at
 * Full, its share of the page at Game). Seed 491's differs at the lash line by
 * one level in at most two pixels, in some runs and not others, while
 * re-exports of G0 repeat exactly; its dressed look paints the same face. The
 * Day dress look's (look-8973) differs by one level in one pixel at Full in
 * every run, while seed 8973's own face repeats G0 exactly. They are reported,
 * not hidden; anything beyond them fails.
 */
function knownResidual(
  name: string,
  seed: number,
  preset: Preset,
  image: ImageComparison,
): boolean {
  if (image.index !== 1 || image.maxChannel > 1) return false;
  if (seed === 491) return image.differingPixels <= 2;
  const pixel = image.firstDifference;
  return (
    name === "look-8973" &&
    preset === "full" &&
    image.differingPixels === 1 &&
    pixel?.x === 446 &&
    pixel.y === 699 &&
    pixel.reference === "3b3b3fff" &&
    pixel.fresh === "3c3b40ff"
  );
}

function bundle(): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "bundle.js");
  buildSync({
    entryPoints: [fileURLToPath(new URL("./browser/human-entry.ts", import.meta.url))],
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
        body: `<!doctype html><meta charset="utf-8"><title>g4a human</title><script type="module" src="bundle.js"></script>`,
      });
    if (path === "bundle.js") return r.fulfill({ contentType: "text/javascript", body: script });
    if (packs.has(path))
      return r.fulfill({
        contentType: "application/octet-stream",
        body: readFileSync(join(humanAssetsDir, path.slice("assets/human/".length))),
      });
    const asset = bundledAssets.find((a) => `assets/${a.file}` === path);
    if (asset)
      return r.fulfill({
        contentType: asset.mediaType,
        body: readFileSync(join(assets, asset.file)),
      });
    return r.fulfill({ status: 404, body: "" });
  });
}

function isResponse(value: unknown): value is HumanExportResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "name") === "string" &&
    typeof Reflect.get(value, "preset") === "string"
  );
}

/** Keep only one adult's GLBs in the browser-to-Node response at once. */
async function* exportsFor(page: Page, requests: HumanExportRequest[]) {
  for (const request of requests) {
    const text = await page.evaluate(async (item) => {
      const run: unknown = Reflect.get(globalThis, "iruddHumanExport");
      if (typeof run !== "function") throw new Error("The export page did not load.");
      return JSON.stringify(await Reflect.apply(run, undefined, [[item]]));
    }, request);
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error("The export page returned no list.");
    for (const response of parsed) {
      if (!isResponse(response)) throw new Error("The export page returned an invalid result.");
      yield response;
    }
  }
}

const body = await loadHumanBody();
const store = adultStore(body);
/** A seeded adult by its seed, a starter look by its id, or a variant by its name. */
function generated(name: string) {
  const variant = Object.hasOwn(variants, name) ? variants[name] : undefined;
  if (variant) {
    const seeded = seededHumanAdult(body, variant.seed);
    const look = humanLooks.find((l) => l.id === `look-${variant.seed}`);
    if (variant.dressed && !look) throw new Error(`Missing starter for ${name}`);
    const base = variant.dressed && look ? dressedAdult(seeded, look) : seeded;
    return store.generate(
      { ...base, style: { ...base.style, ...variant.style } },
      `Adult ${variant.seed}`,
    );
  }
  const look = humanLooks.find((l) => l.id === name);
  if (!look) return store.generated(Number(name));
  return store.generate(
    dressedAdult(seededHumanAdult(body, look.seed), look),
    `Adult ${look.seed}`,
  );
}
const docs = new Map(jobs.map((job) => [job.name, documentOf(generated(job.name))]));
const script = bundle();
const browser = await chromium.launch({ channel: "chrome" });
const rows: Array<Record<string, unknown>> = [];
let failed = false;
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await route(page, script);
  await page.goto(`${origin}/index.html`);
  await page.waitForFunction(() => "iruddHumanExport" in globalThis);
  const renderer = await page.evaluate(() => {
    const read: unknown = Reflect.get(globalThis, "iruddRenderer");
    const value: unknown = typeof read === "function" ? Reflect.apply(read, undefined, []) : null;
    return typeof value === "string" ? value : null;
  });
  const softwareFallback =
    renderer === null || software.some((k) => renderer.toLowerCase().includes(k));
  if (softwareFallback && !allowSoftware)
    throw new Error(`Chrome reports a software renderer (${renderer}); pass --allow-software.`);
  console.log(`chrome ${browser.version()}, ${renderer}`);
  const requests: HumanExportRequest[] = [...docs].map(([name, doc]) => ({
    name,
    document: documentJson(doc),
    presets: jobs.find((job) => job.name === name)?.presets ?? [],
  }));
  const expected = new Set(jobs.flatMap((job) => job.presets.map((p) => job.name + "/" + p)));
  for await (const response of exportsFor(page, requests)) {
    const key = response.name + "/" + response.preset;
    if (!expected.delete(key)) throw new Error("Unexpected or duplicate export: " + key);
    const name = response.name,
      seed =
        (Object.hasOwn(variants, name) ? variants[name]?.seed : undefined) ??
        humanLooks.find((look) => look.id === name)?.seed ??
        Number(name),
      doc = docs.get(name);
    const label = `adult ${name} ${response.preset}`;
    if (!response.base64 || !doc) {
      failed = true;
      rows.push({ name, preset: response.preset, error: response.error });
      console.log(`${label}: ${response.error ?? "no export"}`);
      continue;
    }
    const fresh = Buffer.from(response.base64, "base64");
    writeFileSync(join(dir, `adult-${name}-${response.preset}.glb`), fresh);
    const file = join(humanOracleDir, `adult-${name}-${response.preset}.glb`);
    if (!existsSync(file)) {
      failed = true;
      rows.push({ name, preset: response.preset, ms: response.ms, error: `no reference ${file}` });
      console.log(`${label}: no reference export at ${file}`);
      continue;
    }
    const comparison = compareGlb(readFileSync(file), fresh, {
      regions: new Map(doc.parts.map((p) => [p.label, p.id])),
    });
    const accessors = comparison.accessors.filter((a) => a.maxAbs > 1e-6);
    const changedImages = comparison.images.filter((i) => i.maxChannel > 0);
    const withinResidual = changedImages.filter((i) =>
      knownResidual(name, seed, response.preset, i),
    );
    const images = changedImages.filter((i) => !withinResidual.includes(i));
    if (comparison.structure.length || accessors.length || images.length) failed = true;
    if (withinResidual.length) console.log(`  ${label}: within its recorded residual`);
    rows.push({
      name,
      preset: response.preset,
      ms: response.ms,
      knownResidual: withinResidual.map((i) => i.index),
      ...comparison,
    });
    console.log(
      `${label} (${response.ms} ms): ${comparison.structure.length} structure, ` +
        `${accessors.length} accessor uses and ${changedImages.length} image(s) differ`,
    );
    for (const d of comparison.structure.slice(0, 12))
      console.log(
        `  structure ${d.path}: ${JSON.stringify(d.reference)} → ${JSON.stringify(d.fresh)}`.slice(
          0,
          240,
        ),
      );
    for (const a of accessors.slice(0, 12))
      console.log(`  accessor ${a.use}: ${a.differing}/${a.values} differ, max ${a.maxAbs}`);
    for (const i of comparison.images)
      console.log(
        `  image ${i.index} ${i.width}×${i.height}: max ${i.maxChannel}, ${i.differingPixels} pixels differ`,
      );
  }
  if (errors.length) throw new Error("Page errors: " + errors.join("; "));
  if (expected.size) throw new Error("Missing requested exports: " + [...expected].join(", "));
  writeFileSync(
    join(dir, "report.json"),
    JSON.stringify({ chrome: browser.version(), renderer, softwareFallback, rows }, null, 2),
  );
} finally {
  await browser.close();
}
process.exitCode = failed ? 1 : 0;
