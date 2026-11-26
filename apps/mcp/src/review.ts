import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { readArtifact, WorkshopError } from "@irudd/workshop/client";
import {
  reviewPresets,
  reviewSheets,
  type InspectReviewView,
  type ReviewShot,
} from "@irudd/workshop/wire";
import type { HostConnection } from "./connection.js";

const defaultInline = 6;
const maxInline = 12;

const documentId = z
  .string()
  .describe("Document ID, like doc-marsh01 (doc- then 4–63 lowercase letters, digits or dashes).");
const revision = z
  .number()
  .int()
  .min(1)
  .optional()
  .describe(
    "A committed revision to review. Default: the head when the host receives the request. The result names the exact revision and says whether the head moved meanwhile.",
  );
const preset = z
  .enum(reviewPresets)
  .optional()
  .describe(
    "Export preset: clay (untextured), full (every texture), game (compact runtime textures) or portrait (face detail). Default clay.",
  );
const shot = z
  .object({
    view: z.string().describe("A view from review_capabilities, e.g. front, side, threequarter."),
    clip: z
      .string()
      .nullable()
      .optional()
      .describe("An animation clip from the model, or null for rest."),
    time: z.number().min(0).max(1).optional().describe("Fraction of the clip."),
    surface: z.string().optional().describe("source, clay or ink (silhouette)."),
    morph: z.string().nullable().optional().describe("An expression at full weight, or null."),
    angle: z
      .object({ yaw: z.number().min(-180).max(180), pitch: z.number().min(-80).max(80) })
      .optional()
      .describe("For the portrait-angle view: degrees from the front."),
    gaze: z
      .object({ x: z.number().min(-1).max(1), y: z.number().min(-1).max(1) })
      .optional()
      .describe("Eye direction, each from -1 to 1."),
    light: z.string().optional().describe("A light from review_capabilities."),
  })
  .describe("One extra image.");

const text = (value: string, isError = false): CallToolResult => ({
  content: [{ type: "text", text: value }],
  ...(isError ? { isError: true } : {}),
});

const json = (summary: string, value: unknown, isError = false): CallToolResult =>
  text(`${summary}\n\n${JSON.stringify(value, null, 2)}`, isError);

async function guarded(body: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof WorkshopError) {
      const actions = error.detail["actions"];
      const steps = Array.isArray(actions)
        ? actions.filter((a): a is string => typeof a === "string")
        : [];
      return json(
        `${error._tag}: ${error.message}${steps.length ? `\nWhat a person can do:\n${steps.map((s) => `- ${s}`).join("\n")}` : ""}`,
        error.detail,
        true,
      );
    }
    return text(
      `Unexpected failure: ${error instanceof Error ? error.message : String(error)}`,
      true,
    );
  }
}

const read = { readOnlyHint: true, openWorldHint: false } as const;
const render = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

function gpuLine(gpu: { renderer: string; software: boolean }): string {
  return `${gpu.renderer}${gpu.software ? " (SOFTWARE FALLBACK)" : ""}`;
}

function manifest(view: InspectReviewView, inline: ReadonlyArray<string>): unknown {
  const { inventory: _inventory, ...rest } = view;
  return {
    ...rest,
    images: view.images.map((i) => ({ ...i, inline: inline.includes(i.sha256) })),
  };
}

export function registerReviewTools(server: McpServer, host: HostConnection): void {
  server.registerTool(
    "review_capabilities",
    {
      title: "Review capabilities",
      description:
        "Whether the project can render reviews now, on which GPU, and the presets, sheets, views, surfaces, lights and pixel ratios it supports. Without a renderer it says why and what a person can do.",
      inputSchema: {},
      annotations: read,
    },
    () =>
      guarded(async () => {
        const caps = await host.call("review.capabilities", {});
        return json(
          caps.renderer
            ? `Renderer ready on ${gpuLine(caps.renderer.info.gpu)} (${caps.renderer.via}).`
            : `No renderer: ${caps.reason ?? "none registered"}`,
          caps,
          !caps.available,
        );
      }),
  );

  server.registerTool(
    "export_character",
    {
      title: "Export character",
      description:
        "Export a committed revision of a document as a GLB with the desktop's exporter. Returns the manifest: the exact revision and document digest, the GLB's SHA-256 and size, its provenance stamp, credits, inventory and the GPU that built it. With wardrobe, the GLB holds every saved outfit as its own scene (named after the outfit, with its own rig and clips) and the manifest's wardrobe lists them in scene order. Use inspect_character to see it.",
      inputSchema: {
        documentId,
        revision,
        preset,
        wardrobe: z
          .boolean()
          .optional()
          .describe(
            "Export every saved outfit, one scene each, instead of the character as worn. The revision must have saved outfits.",
          ),
      },
      annotations: render,
    },
    (args) =>
      guarded(async () => {
        const view = await host.call("review.export", {
          documentId: args.documentId,
          preset: args.preset ?? "clay",
          ...(args.revision === undefined ? {} : { revision: args.revision }),
          ...(args.wardrobe ? { wardrobe: true } : {}),
        });
        return json(
          `Exported ${view.source.documentId} revision ${view.source.revision} at ${view.preset}${view.wardrobe ? ` with every saved outfit as its own scene (${view.wardrobe.looks.join(", ")})` : ""}: GLB sha256 ${view.glb.sha256} (${view.glb.byteLength} bytes) on ${gpuLine(view.gpu)}.${view.source.headMoved ? ` The head moved to ${view.source.head.atCompletion} meanwhile; this is still revision ${view.source.revision}.` : ""}`,
          view,
        );
      }),
  );

  server.registerTool(
    "inspect_character",
    {
      title: "Inspect character",
      description: [
        "Export a committed revision and render the actual GLB in the desktop's hidden review worker, never the person's window.",
        `Sheets: ${reviewSheets.join(", ")}. Default body, portrait (only with a face) and silhouette; motion and expressions are opt-in.`,
        "Returns the manifest (revision, document digest, GLB SHA-256, metrics, model clips and expressions, readiness, notes, GPU) and the first images as PNG image content; fetch the rest with review_image by sha256.",
      ].join(" "),
      inputSchema: {
        documentId,
        revision,
        preset,
        sheets: z.array(z.enum(reviewSheets)).optional().describe("Image groups to render."),
        shots: z.array(shot).max(24).optional().describe("Extra images, each with its own recipe."),
        width: z
          .number()
          .int()
          .min(64)
          .max(2048)
          .optional()
          .describe("Image width in CSS pixels (default 512 here)."),
        height: z
          .number()
          .int()
          .min(64)
          .max(2048)
          .optional()
          .describe("Image height in CSS pixels (default: the width)."),
        pixelRatio: z
          .number()
          .int()
          .min(1)
          .max(3)
          .optional()
          .describe("Device pixels per CSS pixel (default 2)."),
        light: z.string().optional().describe("Light for shots that name none (default studio)."),
        inline: z
          .number()
          .int()
          .min(0)
          .max(maxInline)
          .optional()
          .describe(`Images to return inline (default ${defaultInline}).`),
      },
      annotations: render,
    },
    (args) =>
      guarded(async () => {
        const width = args.width ?? 512;
        const shots: ReviewShot[] = (args.shots ?? []).map((s) => ({
          view: s.view,
          ...(s.clip === undefined ? {} : { clip: s.clip }),
          ...(s.time === undefined ? {} : { time: s.time }),
          ...(s.surface === undefined ? {} : { surface: s.surface }),
          ...(s.morph === undefined ? {} : { morph: s.morph }),
          ...(s.angle === undefined ? {} : { angle: s.angle }),
          ...(s.gaze === undefined ? {} : { gaze: s.gaze }),
          ...(s.light === undefined ? {} : { light: s.light }),
        }));
        const view = await host.call("review.inspect", {
          documentId: args.documentId,
          preset: args.preset ?? "clay",
          ...(args.revision === undefined ? {} : { revision: args.revision }),
          ...(args.sheets ? { sheets: args.sheets } : {}),
          ...(shots.length ? { shots } : {}),
          width,
          height: args.height ?? width,
          pixelRatio: args.pixelRatio ?? 2,
          ...(args.light === undefined ? {} : { light: args.light }),
        });
        const shown = view.images.slice(0, args.inline ?? defaultInline);
        const content: CallToolResult["content"] = [];
        for (const image of shown) {
          const { bytes, mediaType } = await readArtifact(host, image.sha256);
          content.push({
            type: "text",
            text: `${image.name} (${image.kind}, ${image.width}×${image.height}, sha256 ${image.sha256})`,
          });
          content.push({
            type: "image",
            data: Buffer.from(bytes).toString("base64"),
            mimeType: mediaType,
          });
        }
        const rest = view.images.length - shown.length;
        const summary = [
          `Inspected ${view.source.documentId} revision ${view.source.revision} (digest ${view.source.documentDigest}) at ${view.preset} on ${gpuLine(view.gpu)}.`,
          `GLB sha256 ${view.glb.sha256}: ${view.metrics.geometry.triangles} triangles, ${view.metrics.textures.images} textures, ${view.metrics.rig.joints} joints, ${view.metrics.rig.clips} clips, ${view.metrics.rig.morphTargets} morph targets.`,
          `${view.images.length} images; ${shown.length} inline below${rest ? `, ${rest} more by sha256 with review_image` : ""}.`,
          ...view.notes.map((n) => `Note: ${n}`),
          ...(view.source.headMoved
            ? [
                `The head moved to ${view.source.head.atCompletion} meanwhile; every image is still revision ${view.source.revision}.`,
              ]
            : []),
        ].join("\n");
        return {
          content: [
            {
              type: "text",
              text: `${summary}\n\n${JSON.stringify(
                manifest(
                  view,
                  shown.map((i) => i.sha256),
                ),
                null,
                2,
              )}`,
            },
            ...content,
          ],
        };
      }),
  );

  server.registerTool(
    "review_image",
    {
      title: "Review image",
      description:
        "One image from an earlier inspect_character result, by its sha256, as PNG image content. Only images this project's host issued can be read.",
      inputSchema: {
        sha256: z
          .string()
          .regex(/^[0-9a-f]{64}$/)
          .describe("The image's sha256 from the manifest."),
      },
      annotations: read,
    },
    (args) =>
      guarded(async () => {
        const { bytes, mediaType } = await readArtifact(host, args.sha256);
        if (!mediaType.startsWith("image/"))
          return text(`${args.sha256} is ${mediaType}, not an image.`, true);
        return {
          content: [
            { type: "text", text: `sha256 ${args.sha256}, ${bytes.byteLength} bytes` },
            { type: "image", data: Buffer.from(bytes).toString("base64"), mimeType: mediaType },
          ],
        };
      }),
  );
}
