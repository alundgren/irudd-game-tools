import {
  assetResolver,
  bundledAssets,
  domRaster,
  exportCharacter,
  loadPaintAtlases,
  loadPortraitPlates,
  loadSurfaces,
  exportPaintSheets,
  exportPortraitPlates,
  type SurfaceKit,
} from "@irudd/character";
import {
  createRegistry,
  digestBrand,
  familyFeatures,
  readDocument,
  type Digest,
} from "@irudd/document";
import {
  humanAdultGenerator,
  humanAdultId,
  loadHumanPacks,
  type HumanBody,
} from "@irudd/character/human";
import {
  loadHumanPaint,
  prepareHumanPaint,
  type HumanPaintSources,
} from "@irudd/character/human/paint";

import { targetPreset, wardrobeTarget, type Target } from "../targets.js";

const origin = "https://g4a.invalid";

async function fetchBytes(path: string): Promise<Uint8Array | undefined> {
  const response = await fetch(`${origin}/${path}`);
  return response.ok ? new Uint8Array(await response.arrayBuffer()) : undefined;
}

export interface ExportRequest {
  readonly name: string;
  readonly document: unknown;
  readonly presets: ReadonlyArray<Target>;
  readonly blobs: ReadonlyArray<{ readonly digest: string; readonly mediaType: string }>;
  readonly revision: number;
  readonly build: string;
}

export interface ExportResponse {
  readonly name: string;
  readonly preset: Target;
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
const bundled = new Map<string, Uint8Array>();
let surfaces: SurfaceKit | undefined;

let adult: Promise<{ readonly body: HumanBody; readonly paint: HumanPaintSources }> | undefined;
let body: HumanBody | undefined;
async function loadAdult() {
  const read = async (file: string) => {
    const bytes = await fetchBytes(`assets/human/${file}`);
    if (!bytes) throw new Error(`The runner does not serve the adult pack ${file}.`);
    return bytes;
  };
  body = await loadHumanPacks(read);
  return { body, paint: await prepareHumanPaint(raster, await loadHumanPaint(read), body) };
}
const registry = createRegistry({
  features: familyFeatures,
  generators: [
    humanAdultGenerator(() => {
      if (!body) throw new Error("The adult packs are not loaded.");
      return body;
    }),
  ],
});
const isAdult = (document: unknown): boolean => {
  const generation: unknown =
    typeof document === "object" && document !== null
      ? Reflect.get(document, "generation")
      : undefined;
  return (
    typeof generation === "object" &&
    generation !== null &&
    Reflect.get(generation, "generator") === humanAdultId
  );
};

async function prepare(): Promise<void> {
  for (const asset of bundledAssets) {
    const bytes = await fetchBytes(`assets/${asset.file}`);
    if (bytes) bundled.set(asset.file, bytes);
  }
}

async function exportAll(requests: ReadonlyArray<ExportRequest>): Promise<ExportResponse[]> {
  if (!bundled.size) await prepare();
  const out: ExportResponse[] = [];
  for (const request of requests) {
    const project = new Map<Digest, { bytes: Uint8Array; mediaType: string }>();
    for (const blob of request.blobs) {
      const bytes = await fetchBytes(`blobs/${blob.digest.replace(":", "-")}`);
      if (bytes)
        project.set(digestBrand(`sha256:${blob.digest.slice(7)}`), {
          bytes,
          mediaType: blob.mediaType,
        });
    }
    const assets = assetResolver({
      bundled: (asset) => bundled.get(asset.file),
      project: (digest) => project.get(digest),
    });
    const human = isAdult(request.document) ? await (adult ??= loadAdult()) : undefined;
    const read = readDocument(request.document, { registry });
    if (!read.ok) {
      for (const preset of request.presets)
        out.push({ name: request.name, preset, ms: 0, error: JSON.stringify(read.diagnostics) });
      continue;
    }
    surfaces ??= await loadSurfaces(raster, assets);
    const modes = new Set(request.presets.map((preset) => preset === wardrobeTarget));
    const sheets = [...modes].flatMap((wardrobe) => exportPaintSheets(read.value, wardrobe));
    const paint = await loadPaintAtlases(raster, assets, sheets);
    const plateDigests = [...modes].flatMap((wardrobe) =>
      exportPortraitPlates(read.value, wardrobe),
    );
    const plates = await loadPortraitPlates(raster, assets, plateDigests);
    for (const preset of request.presets) {
      const started = performance.now();
      try {
        const result = await exportCharacter(read.value, {
          preset: targetPreset(preset),
          wardrobe: preset === wardrobeTarget,
          revision: request.revision,
          build: request.build,
          textures: { surfaces, paint, assets, plates },
          ...(human ? { human: human.body, humanPaint: human.paint } : {}),
        });
        out.push({
          name: request.name,
          preset,
          base64: base64(result.bytes),
          ms: Math.round(performance.now() - started),
        });
      } catch (error) {
        out.push({
          name: request.name,
          preset,
          ms: Math.round(performance.now() - started),
          error: error instanceof Error ? (error.stack ?? error.message) : String(error),
        });
      }
    }
  }
  return out;
}

function renderer(): string | null {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  if (!gl) return null;
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const value: unknown = gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
  return typeof value === "string" ? value : null;
}

Object.assign(globalThis, { iruddExport: exportAll, iruddRenderer: renderer });
