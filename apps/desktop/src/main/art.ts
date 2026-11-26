// Art translators the desktop host offers.
//
// - turnaround: the reply repaints the brief's painted regions from the new
//   sheet with the character package's repaint operations, the same ones
//   checked against G0's paint panel.
// - depth: the agent's front depth pass of the brief's painted portrait
//   becomes that part's fitted depth field, as G0's depth action makes it.
// - trace (fit, every trace brief without an intent): the face landmarks and
//   depth pairs of the trace map's region for the brief's painted head
//   calibrate its face and add depth pins, as G0's trace editor fits them
//   onto a selected head. The proposal's summary lists what the reply
//   carried beyond the fit.
// - trace (build, when the person asks for it): the map's regions become new
//   editable parts painted from the brief's part's sheet, as G0's
//   buildTraceMap traces them, attached to their parent regions and
//   registered with that part. Regions named like existing parts stay as
//   they are; the summary names what was kept and what could not be built.
//
// Depth and trace draw pictures the way G0 does, with a browser canvas: the
// depth pass into a 384 px square, the sheet's quadrants into 640 px panels. They take that raster from the desktop (its review
// worker); a host without one leaves them out and records such replies.

import { Schema } from "effect";
import { AssetEntry, isJson, isJsonArray, type Json } from "@irudd/document";
import { bundledAssets } from "@irudd/character/assets";
import { repaintOperations } from "@irudd/character/repaint";
import {
  ArtFitError,
  depthCanvas,
  depthFromPixels,
  depthOperations,
  depthTarget,
  jsonOperations,
  panelCanvas,
  panelFromPixels,
  traceFitOperations,
  type Panel,
  traceTarget,
} from "@irudd/character/art-fit";
import { buildAnchor, traceBuildOperations } from "@irudd/character/trace-build";
import type { ArtTranslator } from "@irudd/workshop/host";

export const shippedArtwork = bundledAssets.map((asset) => asset.digest);
const decodeEntry = Schema.decodeUnknownSync(AssetEntry);

/**
 * Draws a picture with a browser canvas, as G0 does: the whole image, or one
 * quadrant of a two-by-two sheet (0 front, 1 the profile facing left), scaled
 * into a `size` square, read back as RGBA. Throws an `ArtError` when the
 * raster cannot run now, so the reply is translated again on retry.
 */
export interface ArtRaster {
  pixels(
    bytes: Uint8Array,
    mediaType: string,
    size: number,
    quadrant?: 0 | 1 | 2 | 3,
  ): Promise<Uint8ClampedArray<ArrayBuffer>>;
}

export const repaintTranslator: ArtTranslator = {
  kind: "turnaround",
  id: "repaint",
  translate({ brief, document, reply, files }): ReadonlyArray<Json> {
    if (reply.kind !== "turnaround") throw new Error("A repaint takes a turnaround reply.");
    const sheet = files.find((f) => f.digest === reply.image);
    if (!sheet) throw new Error("The reply's sheet was not measured.");
    const entry = decodeEntry({
      digest: sheet.digest,
      mediaType: sheet.mediaType,
      byteLength: sheet.byteLength,
      role: "paint-atlas",
    });
    const ops: unknown = JSON.parse(
      JSON.stringify(repaintOperations(document, brief.parts ?? [], entry)),
    );
    if (!isJson(ops) || !isJsonArray(ops)) throw new Error("The repaint produced no operations.");
    return ops;
  },
};

const refusal = (check: () => unknown): string | undefined => {
  try {
    check();
    return undefined;
  } catch (error) {
    if (error instanceof ArtFitError) return error.message;
    throw error;
  }
};

/** The depth pass of the brief's portrait as its fitted depth field. */
export function depthTranslator(raster: ArtRaster): ArtTranslator {
  return {
    kind: "depth",
    id: "portrait-depth",
    guidance: [
      "Answer for the brief's part: this host fits your front depth pass to it as its portrait depth field, which you can compare in clay. Keep the attached front view's crop: the field registers to the silhouette's top, bottom and width.",
    ],
    check: (brief, document) => refusal(() => depthTarget(document, brief.parts)),
    async translate({ brief, document, reply, files, read }) {
      if (reply.kind !== "depth") throw new Error("A depth fit takes a depth reply.");
      const part = depthTarget(document, brief.parts);
      const image = files.find((f) => f.digest === reply.image);
      if (!image) throw new Error("The reply's depth pass was not measured.");
      const pixels = await raster.pixels(await read(image.digest), image.mediaType, depthCanvas);
      const field = depthFromPixels(pixels, depthCanvas, depthCanvas);
      return jsonOperations(depthOperations(document, part.id, field));
    },
  };
}

/** The trace map's face landmarks and depth pairs of the brief's painted head, fitted onto it. */
export function traceTranslator(raster: ArtRaster): ArtTranslator {
  return {
    kind: "trace",
    id: "trace-fit",
    guidance: [
      "Answer for the brief's part: give the region for it that part's ID. This host fits that region's faceLandmarks (calibrating the face) and depthPairs (adding depth pins, at most 24 on the part) onto it, in fractions of the attached front and left-facing profile panels of its sheet. Its outlines and any other regions are kept with the reply but not built: this brief fits, and a brief that builds adds regions as parts.",
    ],
    check: (brief, document) => refusal(() => traceTarget(document, brief.parts)),
    async translate({ brief, document, reply, read }) {
      if (reply.kind !== "trace") throw new Error("A trace fit takes a trace reply.");
      const part = traceTarget(document, brief.parts);
      const atlas = part.paint?.atlas;
      const asset = document.assets.find((a) => a.digest === atlas);
      if (!atlas || !asset) throw new Error(`${part.id}'s sheet is not declared.`);
      const sheet = await read(atlas);
      const panel = async (quadrant: 0 | 1) =>
        panelFromPixels(
          await raster.pixels(sheet, asset.mediaType, panelCanvas, quadrant),
          panelCanvas,
        );
      const fit = traceFitOperations(
        document,
        part.id,
        reply.traceMap.regions,
        await panel(0),
        await panel(1),
      );
      return { operations: jsonOperations(fit.operations), notes: fit.notes };
    },
  };
}

/** A part's sheet, prepared as the paint bake prepares it: four 640 px panels. */
async function sheetPanels(
  raster: ArtRaster,
  bytes: Uint8Array,
  mediaType: string,
): Promise<readonly [Panel, Panel, Panel, Panel]> {
  const panel = async (quadrant: 0 | 1 | 2 | 3) =>
    panelFromPixels(await raster.pixels(bytes, mediaType, panelCanvas, quadrant), panelCanvas);
  return [await panel(0), await panel(1), await panel(2), await panel(3)];
}

/** A trace map's regions built as new parts painted from the brief's part's sheet. */
export function traceBuildTranslator(raster: ArtRaster): ArtTranslator {
  return {
    kind: "trace",
    intent: "build",
    id: "trace-build",
    guidance: [
      "This brief builds: every region of your map becomes a new editable part painted from the brief's part's sheet, at that sheet's standing height, attached to its parent region. Name a region exactly like an existing part (its ID or label) to attach children to that part; such a region is kept as it is, not rebuilt. Outlines and spines are fractions of the attached front and left-facing profile panels of the sheet. A region that cannot be traced is left out and named in the proposal; the rest are still built.",
    ],
    check: (brief, document) => refusal(() => buildAnchor(document, brief.parts)),
    async translate({ brief, document, reply, read }) {
      if (reply.kind !== "trace") throw new Error("A trace build takes a trace reply.");
      const anchor = buildAnchor(document, brief.parts);
      const atlas = anchor.paint?.atlas;
      const asset = document.assets.find((a) => a.digest === atlas);
      if (!atlas || !asset) throw new Error(`${anchor.id}'s sheet is not declared.`);
      const panels = await sheetPanels(raster, await read(atlas), asset.mediaType);
      const made = traceBuildOperations(
        document,
        anchor.id,
        reply.traceMap.regions,
        panels,
        reply.traceMap.height,
      );
      const methods = made.built.map((b) => `${b.region} (${b.method})`).join(", ");
      return {
        operations: jsonOperations(made.operations),
        notes: [`Built ${made.built.length}: ${methods}.`, ...made.notes],
      };
    },
  };
}

/** The desktop's translators: depth and trace fits and builds only with a raster to draw their pictures. */
export function desktopArtTranslators(raster?: ArtRaster): ReadonlyArray<ArtTranslator> {
  return raster
    ? [
        repaintTranslator,
        depthTranslator(raster),
        traceTranslator(raster),
        traceBuildTranslator(raster),
      ]
    : [repaintTranslator];
}
