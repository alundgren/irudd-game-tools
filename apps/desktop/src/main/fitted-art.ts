import { Schema } from "effect";
import {
  applyOperations,
  createRegistry,
  decodeOperations,
  derivePartId,
  familyFeatures,
  AssetEntry,
} from "@irudd/document";
import { fittedEditRefusal } from "@irudd/character/art-fit";
import type { ArtTranslator } from "@irudd/workshop/host";
import { repaintTranslator, type ArtRaster } from "./art.js";

export function fittedTurnaround(raster: ArtRaster): ArtTranslator {
  return {
    ...repaintTranslator,
    check(brief, doc) {
      const target = doc.parts.find((p) => p.id === brief.parts?.[0]);
      if (brief.paintAction)
        return fittedEditRefusal(brief.paintAction, target, brief.protected ?? []);
      if (brief.parts?.some((id) => brief.protected?.includes(id)))
        return "Remove the shape lock before repainting the selected region.";
      return undefined;
    },
    async translate(input) {
      const { brief, document, reply, files, read } = input;
      if (!brief.paintAction) return repaintTranslator.translate(input);
      if (reply.kind !== "turnaround") throw new Error("Return a painted turnaround.");
      const file = files.find((f) => f.digest === reply.image);
      if (!file) throw new Error("Missing painted sheet.");
      const asset = Schema.decodeUnknownSync(AssetEntry)({
        digest: file.digest,
        mediaType: file.mediaType,
        byteLength: file.byteLength,
        role: "paint-atlas",
      });
      if (!raster.fit) throw new Error("Open the desktop workshop to fit a painted part.");
      return raster.fit({ document, brief, reply, asset }, await read(file.digest));
    },
  };
}

export function withPaintNudge(
  translator: ArtTranslator,
  raster: ArtRaster | undefined,
): ArtTranslator {
  return {
    ...translator,
    async translate(input) {
      const nudge = input.brief.nudge;
      if (!nudge) return translator.translate(input);
      if (!raster?.nudge) throw new Error("Open the desktop workshop to fit nudged artwork.");
      const operations = await raster.nudge(input.document, nudge);
      if (!operations.length) return translator.translate(input);
      const decoded = decodeOperations(operations);
      if (!decoded.ok) throw new Error(decoded.diagnostics.map((d) => d.message).join(" "));
      const next = applyOperations(input.document, decoded.value, {
        registry: createRegistry({ features: familyFeatures }),
        retired: new Set(),
        idFor: (slot) => derivePartId(input.document.id, "paint-nudge", slot),
      });
      if (!next.ok) throw new Error(next.diagnostics.map((d) => d.message).join(" "));
      const result = await translator.translate({ ...input, document: next.value });
      return "operations" in result
        ? { ...result, operations: [...operations, ...result.operations] }
        : [...operations, ...result];
    },
  };
}
