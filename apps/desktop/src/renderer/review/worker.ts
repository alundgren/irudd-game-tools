// The desktop's review worker: a hidden, sandboxed page with no bridge to the
// project. Desktop main loads it in its own session and hands it one job at a
// time. It exports the pinned revision with the same exportCharacter, raster
// and texture loaders as the window, then inspects the bytes it produced with
// the player's Inspector: its own OffscreenCanvas, WebGL context, stage,
// camera and lights. Nothing here can reach the person's viewport, and it
// never takes a screenshot.
//
// Main serves this page, the bundled sheets and each job's inputs from the
// worker's own scheme, and receives the outputs the page uploads there.

import {
  assetResolver,
  exportPaintSheets,
  exportPortraitPlates,
  bundledAssets,
  domRaster,
  exportCharacter,
  inspectGlb,
  loadPaintAtlases,
  loadPortraitPlates,
  loadSurfaces,
  type BundledAsset,
  type Preset,
  type SurfaceKit,
} from "@irudd/character";
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
import {
  createRegistry,
  digestBrand,
  familyFeatures,
  frameCreature,
  readDocument,
  type Digest,
  type Registry,
} from "@irudd/document";
import {
  Inspector,
  bodyViews,
  portraitViews,
  surfaces,
  views,
  type ModelInfo,
  type Shot,
  type ShotRequest,
  type View,
} from "@irudd/player";
import type { RenderJob, RenderResult, RenderedImage, ReviewShot } from "@irudd/workshop/wire";

const raster = domRaster();
const humanPack = (file: string): Promise<Uint8Array> => get(`/human/${encodeURIComponent(file)}`);
/** The adult's body and the registry that generates it, read once from main's packs. */
let adult: Promise<{ readonly body: HumanBody; readonly registry: Registry }> | undefined;
/** The adult's prepared paint, read the first time a textured preset exports one. */
let adultPaint: Promise<HumanPaintSources> | undefined;
async function loadAdult(): Promise<{ readonly body: HumanBody; readonly registry: Registry }> {
  const body = await loadHumanPacks(humanPack);
  return {
    body,
    registry: createRegistry({
      features: familyFeatures,
      generators: [frameCreature, humanAdultGenerator(body)],
    }),
  };
}
const lights = ["studio"] as const;
const pixelRatios = [1, 2, 3];
const maxEdge = 4096;
/** Expression and clip images per job, so a large rig cannot make a job unbounded. */
const maxExpressions = 16;
const maxClips = 8;
const motionTimes = [0, 0.25, 0.5, 0.75];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

async function get(path: string): Promise<Uint8Array> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`The worker could not read ${path} (${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}

async function put(jobId: string, name: string, bytes: Uint8Array): Promise<void> {
  // A Blob body, not the bytes: DevTools inlines a byte body into each request
  // event, and a textured export of a large figure outgrows a DevTools message.
  const response = await fetch(`/job/${jobId}/out/${name}`, {
    method: "POST",
    body: new Blob([new Uint8Array(bytes)]),
  });
  if (!response.ok) throw new Error(`The worker could not upload ${name} (${response.status}).`);
}

const bundled = new Map<string, Uint8Array>();
let surfaceKit: SurfaceKit | undefined;

async function bundledBytes(): Promise<void> {
  if (bundled.size) return;
  for (const asset of bundledAssets)
    bundled.set(asset.file, await get(`/bundled/${encodeURIComponent(asset.file)}`));
}

function webglRenderer(): { vendor: string; renderer: string; webgl: string; software: boolean } {
  const canvas = new OffscreenCanvas(16, 16);
  const gl = canvas.getContext("webgl2");
  if (!gl) return { vendor: "", renderer: "no WebGL 2", webgl: "", software: true };
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  const read = (unmasked: number | undefined, masked: number): string => {
    const value: unknown = gl.getParameter(unmasked ?? masked);
    return typeof value === "string" ? value : "";
  };
  const renderer = read(debug?.UNMASKED_RENDERER_WEBGL, gl.RENDERER);
  const version: unknown = gl.getParameter(gl.VERSION);
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return {
    vendor: read(debug?.UNMASKED_VENDOR_WEBGL, gl.VENDOR),
    renderer,
    webgl: typeof version === "string" ? version : "",
    software: /swiftshader|llvmpipe|softpipe|basic render|microsoft basic|warp/i.test(renderer),
  };
}

const gpu = webglRenderer();

/** What this worker can draw, for the host's capabilities. */
function info(): string {
  return JSON.stringify({
    gpu,
    supports: {
      views: [...views],
      portraitViews: [...portraitViews],
      surfaces: [...surfaces],
      lights: [...lights],
      pixelRatios,
      maxEdge,
    },
  });
}

interface JobInput {
  readonly job: RenderJob;
  readonly build: string;
}

function isJobInput(value: unknown): value is JobInput {
  return (
    isRecord(value) &&
    typeof value["build"] === "string" &&
    isRecord(value["job"]) &&
    typeof value["job"]["jobId"] === "string"
  );
}

const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "x";

/** Share of pixels the ink silhouette covers, and their bounding box. */
async function silhouetteOf(png: Uint8Array): Promise<NonNullable<RenderedImage["silhouette"]>> {
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(png)], { type: "image/png" }));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The worker has no 2D context.");
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
  let covered = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // The ink surface is flat #203733 under neutral tone mapping; the floor and grid are far lighter.
      const dark =
        (data[i] ?? 255) < 90 && (data[i + 1] ?? 255) < 110 && (data[i + 2] ?? 255) < 105;
      if (!dark) continue;
      covered++;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  return {
    coverage: covered / (width * height),
    bbox: maxX < 0 ? null : [minX, minY, maxX - minX + 1, maxY - minY + 1],
  };
}

interface Planned {
  readonly kind: RenderedImage["kind"];
  readonly label: string;
  readonly shot: ShotRequest;
  readonly light: string;
}

function isView(value: string): value is View {
  return views.some((v) => v === value);
}

function plan(
  model: ModelInfo | undefined,
  recipe: NonNullable<RenderJob["inspect"]>,
  notes: string[],
): Planned[] {
  const out: Planned[] = [];
  const light = recipe.light;
  const sheets = new Set(recipe.sheets);
  if (sheets.has("body"))
    for (const view of bodyViews) out.push({ kind: "body", label: view, shot: { view }, light });
  if (sheets.has("portrait")) {
    if (model?.face)
      for (const view of portraitViews)
        out.push({ kind: "portrait", label: view, shot: { view }, light });
    else notes.push("The model has no face surface, so the portrait views were not taken.");
  }
  if (sheets.has("silhouette"))
    for (const view of ["front", "side", "threequarter"] as const)
      out.push({ kind: "silhouette", label: view, shot: { view, surface: "ink" }, light });
  if (sheets.has("motion")) {
    const clips = model?.clips ?? [];
    if (!clips.length) notes.push("The model has no animation clips.");
    if (clips.length > maxClips) notes.push(`Only the first ${maxClips} clips were drawn.`);
    for (const clip of clips.slice(0, maxClips))
      for (const time of motionTimes)
        out.push({
          kind: "motion",
          label: `${clip.name}-${Math.round(time * 100)}`,
          shot: { view: "threequarter", clip: clip.name, time },
          light,
        });
  }
  if (sheets.has("expressions")) {
    const expressions = model?.expressions ?? [];
    if (!expressions.length) notes.push("The model has no expression morph targets.");
    if (expressions.length > maxExpressions)
      notes.push(`Only the first ${maxExpressions} expressions were drawn.`);
    const view: View = model?.face ? "portrait" : "threequarter";
    for (const morph of expressions.slice(0, maxExpressions))
      out.push({ kind: "expression", label: morph, shot: { view, morph }, light });
  }
  recipe.shots.forEach((shot: ReviewShot, index) => {
    if (!isView(shot.view)) throw new Error(`The player has no view ${shot.view}.`);
    const surface = surfaces.find((s) => s === shot.surface);
    const request: ShotRequest = {
      view: shot.view,
      ...(shot.clip === undefined ? {} : { clip: shot.clip }),
      ...(shot.time === undefined ? {} : { time: shot.time }),
      ...(surface === undefined ? {} : { surface }),
      ...(shot.morph === undefined ? {} : { morph: shot.morph }),
      ...(shot.angle === undefined ? {} : { angle: shot.angle }),
      ...(shot.gaze === undefined ? {} : { gaze: shot.gaze }),
    };
    out.push({
      kind: "custom",
      label: `${index + 1}-${shot.view}`,
      shot: request,
      light: shot.light ?? light,
    });
  });
  return out;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function recipeOf(shot: Shot, light: string, pixelRatio: number): Record<string, unknown> {
  return {
    view: shot.view,
    requested: shot.requested,
    clip: shot.clip,
    time: shot.time,
    surface: shot.surface,
    morph: shot.morph,
    gaze: shot.gaze,
    angle: shot.angle,
    light,
    camera: shot.camera,
    pixelRatio,
    cssSize: [shot.width / pixelRatio, shot.height / pixelRatio],
  };
}

async function run(jobId: string): Promise<string> {
  const input: unknown = JSON.parse(new TextDecoder().decode(await get(`/job/${jobId}/input`)));
  if (!isJobInput(input)) throw new Error("The job input has an unexpected shape.");
  const { job, build } = input;
  await bundledBytes();
  const project = new Map<Digest, { bytes: Uint8Array; mediaType: string }>();
  for (const blob of job.blobs)
    project.set(digestBrand(`sha256:${blob.digest.slice(7)}`), {
      bytes: await get(`/job/${jobId}/blob/${blob.digest.slice(7)}`),
      mediaType: blob.mediaType,
    });
  const assets = assetResolver({
    bundled: (asset: BundledAsset) => bundled.get(asset.file),
    project: (digest) => project.get(digest),
  });
  // A failed read is tried again at the next job rather than remembered.
  const { body, registry } = await (adult ??= loadAdult().catch((error: unknown) => {
    adult = undefined;
    throw error;
  }));
  const read = readDocument(job.document, { registry });
  if (!read.ok)
    throw new Error(
      `The revision does not read: ${read.diagnostics.map((d) => d.message).join(" ")}`,
    );
  const preset: Preset = job.preset;
  const started = performance.now();
  const textures =
    preset === "clay"
      ? undefined
      : {
          surfaces: (surfaceKit ??= await loadSurfaces(raster, assets)),
          paint: await loadPaintAtlases(
            raster,
            assets,
            exportPaintSheets(read.value, job.wardrobe),
          ),
          assets,
          plates: await loadPortraitPlates(
            raster,
            assets,
            exportPortraitPlates(read.value, job.wardrobe),
          ),
        };
  const humanPaint =
    textures && read.value.generation?.generator === humanAdultId
      ? await (adultPaint ??= loadHumanPaint(humanPack)
          .then((data) => prepareHumanPaint(raster, data, body))
          .catch((error: unknown) => {
            adultPaint = undefined;
            throw error;
          }))
      : undefined;
  const exported = await exportCharacter(read.value, {
    preset,
    revision: job.revision,
    build,
    human: body,
    ...(humanPaint ? { humanPaint } : {}),
    ...(textures ? { textures } : {}),
    ...(job.wardrobe ? { wardrobe: true } : {}),
  });
  const exportMs = Math.round(performance.now() - started);
  await put(jobId, "model.glb", exported.bytes);
  const inventory = inspectGlb(exported.bytes);
  const base: RenderResult = {
    glb: "model.glb",
    exportMs,
    credits: exported.credits,
    inventory,
    gpu: { vendor: gpu.vendor, renderer: gpu.renderer, software: gpu.software },
  };
  const recipe = job.inspect;
  if (job.kind !== "inspect" || !recipe) return JSON.stringify(base);

  const renderStarted = performance.now();
  const width = recipe.width * recipe.pixelRatio;
  const height = recipe.height * recipe.pixelRatio;
  const inspector = new Inspector(width, height);
  try {
    const phases = { loadMs: 0, drawMs: 0, uploadMs: 0, silhouetteMs: 0, measureMs: 0 };
    let mark = performance.now();
    const lap = (key: keyof typeof phases): void => {
      const now = performance.now();
      phases[key] += now - mark;
      mark = now;
    };
    await inspector.load(exported.bytes, `${job.documentId}-r${job.revision}-${preset}.glb`);
    const model = inspector.info;
    const notes: string[] = [];
    // The first frame compiles shaders and fills the shadow map; draw it twice
    // and compare, so the manifest says whether the capture was settled.
    const warm = await inspector.shoot({ view: "threequarter" });
    const again = await inspector.shoot({ view: "threequarter" });
    const settled = (await sha256(warm.png)) === (await sha256(again.png));
    lap("loadMs");
    const images: RenderedImage[] = [];
    let index = 0;
    for (const planned of plan(model, recipe, notes)) {
      const shot = await inspector.shoot(planned.shot);
      lap("drawMs");
      index += 1;
      const name = `${String(index).padStart(2, "0")}-${planned.kind}-${slug(planned.label)}.png`;
      await put(jobId, name, shot.png);
      lap("uploadMs");
      const silhouette = planned.kind === "silhouette" ? await silhouetteOf(shot.png) : undefined;
      lap("silhouetteMs");
      images.push({
        name,
        kind: planned.kind,
        width: shot.width,
        height: shot.height,
        recipe: recipeOf(shot, planned.light, recipe.pixelRatio),
        render: shot.render,
        ...(silhouette ? { silhouette } : {}),
      });
      if (shot.view !== shot.requested)
        notes.push(`${name}: ${shot.requested} has no face to frame; drew ${shot.view}.`);
    }
    // Clip movement and floor contact sample every vertex on the CPU (seconds
    // on a large rig), so they are measured only with the motion sheet.
    const motion = !recipe.sheets.includes("motion")
      ? null
      : inspector.measure().map((m) => ({
          ...m,
          duration: model?.clips.find((c) => c.name === m.clip)?.duration ?? null,
        }));
    lap("measureMs");
    const result: RenderResult = {
      ...base,
      gpu: {
        vendor: inspector.gpu.vendor,
        renderer: inspector.gpu.renderer,
        software: inspector.gpu.software,
      },
      inspection: {
        model: model
          ? {
              heightMetres: model.heightMetres,
              bounds: model.bounds,
              triangles: model.triangles,
              meshes: model.meshes,
              drawnMaterials: model.drawnMaterials,
              skeletons: model.skeletons,
              morphTargets: model.morphTargets,
              expressions: model.expressions,
              gaze: model.gaze,
              face: model.face,
              clips: model.clips,
            }
          : null,
        motion,
        images,
        readiness: {
          loaded: true,
          settled,
          warmupFrames: 2,
          webgl: inspector.gpu.webgl,
          drawingBuffer: [width, height],
          devicePixelRatio: globalThis.devicePixelRatio,
          phases: Object.fromEntries(Object.entries(phases).map(([k, v]) => [k, Math.round(v)])),
        },
        renderMs: Math.round(performance.now() - renderStarted),
        notes,
      },
    };
    return JSON.stringify(result);
  } finally {
    inspector.dispose();
  }
}

const toBase64 = (bytes: Uint8Array): string => {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
};

/**
 * Art fits: draw a picture into a `size` square canvas as G0 does and return
 * its RGBA as base64. A depth pass is drawn whole from an ImageBitmap, as
 * G0's depth action draws it; a sheet quadrant (0 front, 1 the profile facing
 * left) is drawn from the decoded image as the paint bake prepares its
 * panels. Errors are returned, not thrown, so main can tell a picture the
 * canvas cannot read from a worker that stopped.
 */
async function pixels(
  base64: string,
  mediaType: string,
  size: number,
  quadrant: number | null,
): Promise<string> {
  try {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const canvas = raster.canvas(size, size);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("The worker has no 2D canvas.");
    if (quadrant === null) {
      const bitmap = await createImageBitmap(new Blob([bytes], { type: mediaType }));
      ctx.drawImage(bitmap, 0, 0, size, size);
      bitmap.close();
    } else {
      const image = await raster.image(bytes, mediaType);
      ctx.drawImage(
        image,
        ((quadrant % 2) * image.width) / 2,
        (Math.floor(quadrant / 2) * image.height) / 2,
        image.width / 2,
        image.height / 2,
        0,
        0,
        size,
        size,
      );
    }
    const data = ctx.getImageData(0, 0, size, size).data;
    return JSON.stringify({ ok: true, rgba: toBase64(new Uint8Array(data.buffer)) });
  } catch (error) {
    return JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

Object.assign(globalThis, { iruddReview: { info, run, pixels } });
document.title = "Irudd review worker (ready)";
