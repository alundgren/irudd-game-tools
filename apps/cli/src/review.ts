// Review verbs: export a named revision and inspect the GLB it produced.
//
// The project's host renders with the desktop app's isolated review worker.
// The CLI reads every issued file back, checks its SHA-256 against the
// manifest, and writes the files with that manifest beside them, so what
// lands on disk is bound to the document, revision, digest and file SHA the
// host reported.

import fs from "node:fs";
import path from "node:path";
import { readArtifact, WorkshopError, type WorkshopClient } from "@irudd/workshop/client";
import {
  reviewPresets,
  reviewSheets,
  type ReviewPreset,
  type ReviewShot,
  type ReviewSheet,
} from "@irudd/workshop/wire";
import {
  exit,
  integer,
  list,
  positional,
  show,
  text,
  UsageError,
  withClient,
  type Context,
  type Verb,
} from "./commands.js";

const presetOption = {
  preset: {
    type: "string",
    value: reviewPresets.join("|"),
    help: "Export preset (default clay).",
  },
} as const;
const revisionOption = {
  revision: {
    type: "string",
    value: "rev",
    help: "A committed revision (default: the head when the host receives the request).",
  },
} as const;

function preset(context: Context): ReviewPreset {
  const value = text(context, "preset") ?? "clay";
  const found = reviewPresets.find((p) => p === value);
  if (!found) throw new UsageError(`--preset is one of ${reviewPresets.join(", ")}.`);
  return found;
}

function revision(context: Context): { revision?: number } {
  const value = text(context, "revision");
  return value === undefined ? {} : { revision: integer(value, "--revision") };
}

function out(context: Context): string {
  const value = text(context, "out");
  if (!value) throw new UsageError("--out is required.");
  return path.resolve(value);
}

/** Renderer unavailable: say why and what to do, and exit as for an unavailable host. */
async function guarded(context: Context, body: () => Promise<number>): Promise<number> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof WorkshopError && error._tag === "RendererUnavailable") {
      const actions = error.detail["actions"];
      const lines = Array.isArray(actions) ? actions.filter((a) => typeof a === "string") : [];
      if (context.json) context.out(JSON.stringify({ error: error.detail }, null, 2));
      else context.out([error.message, ...lines.map((a) => `- ${a}`)].join("\n"));
      return exit.unavailable;
    }
    throw error;
  }
}

/** Parse `view=front,clip=Walk,time=0.5,surface=ink,morph=Smile,yaw=-30,pitch=10,gaze=0.5:0,light=studio`. */
export function parseShot(raw: string): ReviewShot {
  const fields = new Map<string, string>();
  for (const part of raw.split(",")) {
    const at = part.indexOf("=");
    if (at <= 0)
      throw new UsageError(`--shot takes key=value pairs separated by commas, not ${part}.`);
    fields.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
  }
  const view = fields.get("view");
  if (!view) throw new UsageError("--shot needs view=<view>.");
  const number = (key: string): number | undefined => {
    const value = fields.get(key);
    if (value === undefined) return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new UsageError(`--shot ${key} is a number, not ${value}.`);
    return parsed;
  };
  const known = new Set([
    "view",
    "clip",
    "time",
    "surface",
    "morph",
    "yaw",
    "pitch",
    "gaze",
    "light",
  ]);
  for (const key of fields.keys())
    if (!known.has(key))
      throw new UsageError(`--shot has no key ${key}. Keys: ${[...known].join(", ")}.`);
  const time = number("time");
  const yaw = number("yaw");
  const pitch = number("pitch");
  const gaze = fields.get("gaze")?.split(":").map(Number);
  const clip = fields.get("clip");
  const surface = fields.get("surface");
  const morph = fields.get("morph");
  const light = fields.get("light");
  if (gaze && (gaze.length !== 2 || gaze.some((v) => !Number.isFinite(v))))
    throw new UsageError("--shot gaze is x:y, each from -1 to 1.");
  return {
    view,
    ...(clip === undefined ? {} : { clip }),
    ...(time === undefined ? {} : { time }),
    ...(surface === undefined ? {} : { surface }),
    ...(morph === undefined ? {} : { morph }),
    ...(yaw === undefined && pitch === undefined
      ? {}
      : { angle: { yaw: yaw ?? 0, pitch: pitch ?? 0 } }),
    ...(gaze ? { gaze: { x: gaze[0] ?? 0, y: gaze[1] ?? 0 } } : {}),
    ...(light === undefined ? {} : { light }),
  };
}

function size(context: Context): { width?: number; height?: number } {
  const value = text(context, "size");
  if (value === undefined) return {};
  const match = /^(\d+)(?:x(\d+))?$/.exec(value);
  if (!match) throw new UsageError("--size is WIDTH or WIDTHxHEIGHT in CSS pixels.");
  const width = Number(match[1]);
  return { width, height: match[2] === undefined ? width : Number(match[2]) };
}

async function save(
  c: WorkshopClient,
  sha256: string,
  file: string,
): Promise<{ file: string; sha256: string; bytes: number }> {
  const { bytes } = await readArtifact(c, sha256);
  fs.writeFileSync(file, bytes);
  return { file, sha256, bytes: bytes.byteLength };
}

export const reviewVerbs: ReadonlyArray<Verb> = [
  {
    name: "review",
    args: "",
    summary: "Show whether a review renderer is available, its GPU and what it can draw",
    options: {},
    run: (context) =>
      withClient(context, async (c) => {
        const caps = await c.call("review.capabilities", {});
        show(context, caps, () =>
          caps.renderer
            ? [
                `Renderer: ${caps.renderer.info.kind} (${caps.renderer.via}), build ${caps.renderer.info.build}`,
                `GPU: ${caps.renderer.info.gpu.renderer}${caps.renderer.info.gpu.software ? " (software fallback)" : ""}`,
                `Presets: ${caps.presets.join(", ")}`,
                `Sheets: ${caps.sheets.join(", ")}`,
                `Views: ${caps.renderer.info.supports.views.join(", ")}`,
                `Surfaces: ${caps.renderer.info.supports.surfaces.join(", ")}; lights: ${caps.renderer.info.supports.lights.join(", ")}`,
                `Queue: ${caps.queue.running} running, ${caps.queue.waiting} waiting`,
              ].join("\n")
            : [
                `No renderer. ${caps.reason ?? ""}`,
                ...(caps.actions ?? []).map((a) => `- ${a}`),
              ].join("\n"),
        );
        return caps.available ? exit.ok : exit.unavailable;
      }),
  },
  {
    name: "export",
    args: "<document>",
    summary: "Export a committed revision as a GLB, with its manifest beside it",
    details:
      "Writes FILE and FILE.json. The manifest binds the file to the document, revision, document digest and the GLB's SHA-256, and lists its provenance, credits and inventory. The CLI re-hashes the bytes before writing them. With --wardrobe the GLB holds every saved outfit as its own scene, named after the outfit with its own rig and clips; the manifest's `wardrobe` lists them in scene order.",
    options: {
      ...presetOption,
      ...revisionOption,
      wardrobe: {
        type: "boolean",
        help: "Export every saved outfit, one scene each, instead of the character as worn.",
      },
      out: { type: "string", value: "file.glb", help: "Where to write the GLB." },
    },
    run: (context) =>
      withClient(context, (c) =>
        guarded(context, async () => {
          const documentId = positional(context, 0, "document");
          const file = out(context);
          const exported = await c.call("review.export", {
            documentId,
            preset: preset(context),
            ...revision(context),
            ...(context.options["wardrobe"] === true ? { wardrobe: true } : {}),
          });
          fs.mkdirSync(path.dirname(file), { recursive: true });
          const saved = await save(c, exported.glb.sha256, file);
          const manifest = { ...exported, file: saved.file };
          fs.writeFileSync(`${file}.json`, JSON.stringify(manifest, null, 2) + "\n");
          show(context, manifest, () =>
            [
              `${saved.file}`,
              `  ${documentId} revision ${exported.source.revision} (digest ${exported.source.documentDigest}) at ${exported.preset}`,
              ...(exported.wardrobe
                ? [`  outfits, one scene each: ${exported.wardrobe.looks.join(", ")}`]
                : []),
              `  sha256 ${exported.glb.sha256}, ${exported.glb.byteLength} bytes`,
              `  rendered on ${exported.gpu.renderer}${exported.gpu.software ? " (software fallback)" : ""}`,
              ...(exported.source.headMoved
                ? [`  the head moved to ${exported.source.head.atCompletion} meanwhile`]
                : []),
              `  manifest ${saved.file}.json`,
            ].join("\n"),
          );
          return exit.ok;
        }),
      ),
  },
  {
    name: "inspect",
    args: "<document>",
    summary: "Export a revision and inspect the GLB: metrics and rendered review images",
    details: [
      `Writes model.glb, one PNG per image and manifest.json into --out. Sheets: ${reviewSheets.join(", ")} (default body, portrait, silhouette).`,
      "A shot is key=value pairs: view (required), clip, time (0–1), surface, morph, yaw and pitch (portrait-angle), gaze x:y, light. See `irudd review` for the renderer's views, surfaces and lights.",
    ].join("\n"),
    options: {
      ...presetOption,
      ...revisionOption,
      out: { type: "string", value: "dir", help: "Directory for the images and manifest." },
      sheet: {
        type: "string",
        multiple: true,
        value: "name",
        help: "An image group; repeat for several.",
      },
      shot: {
        type: "string",
        multiple: true,
        value: "spec",
        help: "An extra shot; repeat for several.",
      },
      size: { type: "string", value: "WxH", help: "Image size in CSS pixels (default 768x768)." },
      "pixel-ratio": {
        type: "string",
        value: "1-3",
        help: "Device pixels per CSS pixel (default 2).",
      },
      light: {
        type: "string",
        value: "name",
        help: "Light for shots that name none (default studio).",
      },
    },
    run: (context) =>
      withClient(context, (c) =>
        guarded(context, async () => {
          const documentId = positional(context, 0, "document");
          const dir = out(context);
          const sheets = list(context, "sheet").map((s): ReviewSheet => {
            const found = reviewSheets.find((k) => k === s);
            if (!found) throw new UsageError(`--sheet is one of ${reviewSheets.join(", ")}.`);
            return found;
          });
          const ratio = text(context, "pixel-ratio");
          const light = text(context, "light");
          const inspected = await c.call("review.inspect", {
            documentId,
            preset: preset(context),
            ...revision(context),
            ...(sheets.length ? { sheets } : {}),
            ...(list(context, "shot").length
              ? { shots: list(context, "shot").map(parseShot) }
              : {}),
            ...size(context),
            ...(ratio === undefined ? {} : { pixelRatio: integer(ratio, "--pixel-ratio") }),
            ...(light === undefined ? {} : { light }),
          });
          fs.mkdirSync(dir, { recursive: true });
          await save(c, inspected.glb.sha256, path.join(dir, "model.glb"));
          for (const image of inspected.images)
            await save(c, image.sha256, path.join(dir, image.name));
          const manifest = {
            ...inspected,
            files: {
              glb: "model.glb",
              images: inspected.images.map((i) => ({ file: i.name, sha256: i.sha256 })),
            },
          };
          const manifestFile = path.join(dir, "manifest.json");
          fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
          show(context, manifest, () =>
            [
              `${documentId} revision ${inspected.source.revision} at ${inspected.preset}: ${inspected.images.length} images in ${dir}`,
              `  GLB sha256 ${inspected.glb.sha256}; ${inspected.metrics.geometry.triangles} triangles, ${inspected.metrics.textures.images} textures, ${inspected.metrics.rig.joints} joints, ${inspected.metrics.rig.clips} clips`,
              `  rendered on ${inspected.gpu.renderer}${inspected.gpu.software ? " (software fallback)" : ""}`,
              ...inspected.notes.map((n) => `  note: ${n}`),
              ...(inspected.source.headMoved
                ? [`  the head moved to ${inspected.source.head.atCompletion} meanwhile`]
                : []),
              `  manifest ${manifestFile}`,
            ].join("\n"),
          );
          return exit.ok;
        }),
      ),
  },
];
