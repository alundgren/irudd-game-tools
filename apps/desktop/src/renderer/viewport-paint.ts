import {
  assetResolver,
  bundledAsset,
  bundledAssets,
  domRaster,
  loadSurfaces,
  type SurfaceKit,
  exportPaintSheets,
  exportPortraitPlates,
  loadPaintAtlases,
  loadPortraitPlates,
  type BuildOptions,
} from "@irudd/character";
import type { CharacterDocument, Digest } from "@irudd/document";
import { readImageChunks } from "./art-files.js";
import type { Workshop } from "./bridge.js";

interface StudioPaint {
  readonly kit: SurfaceKit;
  readonly finish: NonNullable<BuildOptions["finish"]>;
}

export class ViewportPaint {
  private last: { key: string; result: Promise<StudioPaint> } | undefined;

  private kit: Promise<SurfaceKit> | undefined;

  private readonly bundledImage: (digest: string) => Promise<Uint8Array>;

  constructor(bundledImage: (digest: string) => Promise<Uint8Array>) {
    this.bundledImage = bundledImage;
  }

  private async loadKit(): Promise<SurfaceKit> {
    const assets = bundledAssets.filter((asset) =>
      ["surfaces", "jacket", "horn", "faces"].includes(asset.name),
    );
    const files = new Map(
      await Promise.all(
        assets.map(async (asset) => [asset.digest, await this.bundledImage(asset.digest)] as const),
      ),
    );
    return loadSurfaces(
      domRaster(),
      assetResolver({ bundled: (asset) => files.get(asset.digest) }),
    );
  }

  reset(): void {
    this.last = undefined;
  }

  prepare(host: Workshop, doc: CharacterDocument): Promise<StudioPaint> {
    const declared = new Set(doc.assets.map((a) => a.digest));
    const paint = exportPaintSheets(doc).filter(
      (digest) => declared.has(digest) || bundledAsset(digest),
    );
    const plates = exportPortraitPlates(doc);
    const key = JSON.stringify([paint, plates]);
    if (this.last?.key === key) return this.last.result;
    const result = this.load(host, paint, plates).catch((error: unknown) => {
      if (this.last?.result === result) this.reset();
      throw error;
    });
    this.last = { key, result };
    return result;
  }

  private async load(host: Workshop, sheets: Digest[], plates: Digest[]): Promise<StudioPaint> {
    const files = new Map<Digest, { bytes: Uint8Array; mediaType: string }>();
    for (const digest of new Set([...sheets, ...plates])) {
      const asset = bundledAsset(digest);
      files.set(
        digest,
        asset
          ? { bytes: await this.bundledImage(digest), mediaType: asset.mediaType }
          : await readImageChunks(digest, (offset) =>
              host.call("project.image", { digest, offset }),
            ),
      );
    }
    const resolver = assetResolver({
      bundled: (asset) => files.get(asset.digest)?.bytes,
      project: (digest) => files.get(digest),
    });
    const raster = domRaster();
    const paint = await loadPaintAtlases(raster, resolver, sheets);
    const portraits = await loadPortraitPlates(raster, resolver, plates);
    const missing = [...paint.missing, ...portraits.missing];
    if (missing.length) throw new Error(`Cannot display artwork ${missing.join(", ")}.`);
    const kit = await (this.kit ??= this.loadKit().catch((error: unknown) => {
      this.kit = undefined;
      throw error;
    }));
    return { kit, finish: { paint, faces: kit.faces, plates: portraits } };
  }
}
