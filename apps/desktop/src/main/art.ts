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

async function sheetPanels(
  raster: ArtRaster,
  bytes: Uint8Array,
  mediaType: string,
): Promise<readonly [Panel, Panel, Panel, Panel]> {
  const panel = async (quadrant: 0 | 1 | 2 | 3) =>
    panelFromPixels(await raster.pixels(bytes, mediaType, panelCanvas, quadrant), panelCanvas);
  return [await panel(0), await panel(1), await panel(2), await panel(3)];
}

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
