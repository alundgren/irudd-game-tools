// The page side of the adult's textured presets: bundled with esbuild and run
// in installed Chrome, so canvas decoding, resampling and PNG encoding are the
// browser's, as they were G0's.
//
// The runner (src/human-textured.ts) serves this bundle, the bundled surface
// assets and the human packs from a routed origin, then calls `iruddHumanExport`.

import {
  assetResolver,
  bundledAssets,
  domRaster,
  exportCharacter,
  loadPaintAtlases,
  loadSurfaces,
  type AssetResolver,
  type PaintAtlases,
  type Preset,
  type SurfaceKit,
} from "@irudd/character";
import { humanAdultGenerator, loadHumanPacks, type HumanBody } from "@irudd/character/human";
import {
  loadHumanPaint,
  prepareHumanPaint,
  type HumanPaintSources,
} from "@irudd/character/human/paint";
import { createRegistry, familyFeatures, readDocument } from "@irudd/document";

const origin = "https://g4a.invalid";

async function fetchBytes(path: string): Promise<Uint8Array> {
  const response = await fetch(`${origin}/${path}`);
  if (!response.ok) throw new Error(`The runner does not serve ${path}.`);
  return new Uint8Array(await response.arrayBuffer());
}

export interface HumanExportRequest {
  readonly name: string;
  readonly document: unknown;
  readonly presets: ReadonlyArray<Preset>;
}

export interface HumanExportResponse {
  readonly name: string;
  readonly preset: Preset;
  readonly base64?: string;
  readonly ms: number;
  readonly error?: string;
}

function base64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

const raster = domRaster();
let ready:
  | Promise<{
      readonly body: HumanBody;
      readonly paint: HumanPaintSources;
      readonly surfaces: SurfaceKit;
      readonly atlases: PaintAtlases;
      readonly assets: AssetResolver;
    }>
  | undefined;

async function prepare() {
  const bundled = new Map<string, Uint8Array>();
  for (const asset of bundledAssets)
    bundled.set(asset.file, await fetchBytes(`assets/${asset.file}`));
  const assets = assetResolver({
    bundled: (asset) => bundled.get(asset.file),
    project: () => undefined,
  });
  const read = (file: string) => fetchBytes(`assets/human/${file}`);
  const body = await loadHumanPacks(read);
  const paint = await prepareHumanPaint(raster, await loadHumanPaint(read), body);
  const surfaces = await loadSurfaces(raster, assets);
  // A seeded adult paints with no turnaround sheets.
  return { body, paint, surfaces, atlases: await loadPaintAtlases(raster, assets, []), assets };
}

async function exportAll(
  requests: ReadonlyArray<HumanExportRequest>,
): Promise<HumanExportResponse[]> {
  const started = performance.now();
  const { body, paint, surfaces, atlases, assets } = await (ready ??= prepare());
  const prepareMs = Math.round(performance.now() - started);
  const registry = createRegistry({
    features: familyFeatures,
    generators: [humanAdultGenerator(body)],
  });
  const out: HumanExportResponse[] = [];
  for (const request of requests) {
    const read = readDocument(request.document, { registry });
    for (const preset of request.presets) {
      const t = performance.now();
      if (!read.ok) {
        out.push({ name: request.name, preset, ms: 0, error: JSON.stringify(read.diagnostics) });
        continue;
      }
      try {
        const result = await exportCharacter(read.value, {
          preset,
          revision: 1,
          build: "g4a",
          textures: { surfaces, paint: atlases, assets },
          human: body,
          humanPaint: paint,
        });
        out.push({
          name: request.name,
          preset,
          base64: base64(result.bytes),
          ms: Math.round(performance.now() - t),
        });
      } catch (error) {
        out.push({
          name: request.name,
          preset,
          ms: Math.round(performance.now() - t),
          error: error instanceof Error ? (error.stack ?? error.message) : String(error),
        });
      }
    }
  }
  if (out[0]) out[0] = { ...out[0], ms: out[0].ms + prepareMs };
  return out;
}

/** The WebGL renderer string, so the run records whether canvas work was hardware accelerated. */
function renderer(): string | null {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  if (!gl) return null;
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const value: unknown = gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
  return typeof value === "string" ? value : null;
}

Object.assign(globalThis, { iruddHumanExport: exportAll, iruddRenderer: renderer });
