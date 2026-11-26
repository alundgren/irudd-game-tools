import {
  assetResolver,
  domRaster,
  exportPaintSheets,
  exportPortraitPlates,
  loadPaintAtlases,
  loadPortraitPlates,
  type BuildOptions,
} from "@irudd/character";
import type { CharacterDocument, Digest } from "@irudd/document";
import { readImageChunks } from "./art-files.js";
import type { Workshop } from "./bridge.js";

type Finish = NonNullable<BuildOptions["finish"]>;

/** Keep decoded images for the current set of sheets. Geometry and UVs are rebuilt for each edit. */
export class ViewportPaint {
  private last: { key: string; result: Promise<Finish> } | undefined;

  reset(): void {
    this.last = undefined;
  }

  prepare(host: Workshop, doc: CharacterDocument): Promise<Finish> | undefined {
    if (!doc.assets.some((a) => a.role === "paint-atlas" || a.role === "portrait-plate")) return;
    const declared = new Set(doc.assets.map((a) => a.digest));
    const paint = exportPaintSheets(doc).filter((digest) => declared.has(digest));
    const plates = exportPortraitPlates(doc);
    if (!paint.length && !plates.length) return;
    const key = JSON.stringify([paint, plates]);
    if (this.last?.key === key) return this.last.result;
    const result = this.load(host, paint, plates).catch((error: unknown) => {
      if (this.last?.result === result) this.reset();
      throw error;
    });
    this.last = { key, result };
    return result;
  }

  private async load(host: Workshop, sheets: Digest[], plates: Digest[]): Promise<Finish> {
    const files = new Map<Digest, { bytes: Uint8Array; mediaType: string }>();
    for (const digest of new Set([...sheets, ...plates])) {
      files.set(
        digest,
        await readImageChunks(digest, (offset) => host.call("project.image", { digest, offset })),
      );
    }
    const resolver = assetResolver({
      bundled: () => undefined,
      project: (digest) => files.get(digest),
    });
    const raster = domRaster();
    const paint = await loadPaintAtlases(raster, resolver, sheets);
    const portraits = await loadPortraitPlates(raster, resolver, plates);
    const missing = [...paint.missing, ...portraits.missing];
    if (missing.length) throw new Error(`Cannot display artwork ${missing.join(", ")}.`);
    return { paint, plates: portraits };
  }
}
