import {
  assetResolver,
  bundledAsset,
  bundledAssets,
  domRaster,
  loadSurfaces,
  type SurfaceKit,
  exportKitSheets,
  type Textures,
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
  readonly textures: Textures;
  readonly finish: NonNullable<BuildOptions["finish"]>;
}

export class ViewportPaint {
  private last: { key: string; result: Promise<StudioPaint> } | undefined;

  private readonly kitImages = new Map<Digest, Uint8Array>();

  private kit: Promise<SurfaceKit> | undefined;

  private readonly bundledImage: (digest: string) => Promise<Uint8Array>;

  constructor(bundledImage: (digest: string) => Promise<Uint8Array>) {
    this.bundledImage = bundledImage;
  }

  private async loadKit(): Promise<SurfaceKit> {
    const assets = bundledAssets.filter((asset) =>
      ["surfaces", "jacket", "horn", "faces"].includes(asset.name),
    );
    await Promise.all(
      assets.map(async (asset) =>
        this.kitImages.set(asset.digest, await this.bundledImage(asset.digest)),
      ),
    );
    return loadSurfaces(
      domRaster(),
      assetResolver({ bundled: (asset) => this.kitImages.get(asset.digest) }),
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
    const kit = exportKitSheets(doc);
    const key = JSON.stringify([paint, plates, kit]);
    if (this.last?.key === key) return this.last.result;
    const result = this.load(host, paint, plates, kit).catch((error: unknown) => {
      if (this.last?.result === result) this.reset();
      throw error;
    });
    this.last = { key, result };
    return result;
  }

  private async load(
    host: Workshop,
    sheets: Digest[],
    plates: Digest[],
    kitSheets: Digest[],
  ): Promise<StudioPaint> {
    const files = new Map<Digest, { bytes: Uint8Array; mediaType: string }>();
    for (const digest of new Set([...sheets, ...plates, ...kitSheets])) {
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
      bundled: (asset) => files.get(asset.digest)?.bytes ?? this.kitImages.get(asset.digest),
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
    return {
      kit,
      textures: { surfaces: kit, paint, plates: portraits, assets: resolver },
      finish: { paint, faces: kit.faces, plates: portraits },
    };
  }
}
