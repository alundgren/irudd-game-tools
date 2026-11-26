import {
  digestBrand,
  sha256Digest,
  verifyAssetBytes,
  type AssetEntry,
  type CharacterDocument,
  type Digest,
} from "@irudd/document";

export type AssetOrigin =
  | {
      readonly kind: "project";
      readonly license: "MIT";
      readonly source: string;
      readonly added: string;
    }
  | {
      readonly kind: "credited";
      readonly license: string;
      readonly source: string;
      readonly credit: string;
    };

export interface BundledAsset {
  readonly name: string;
  readonly file: string;
  readonly digest: Digest;
  readonly mediaType: "image/webp";
  readonly byteLength: number;
  readonly use: "turnaround" | "surface";
  readonly origin: AssetOrigin;
}

const reference = "2761eb14";

function project(
  name: string,
  file: string,
  hex: string,
  byteLength: number,
  use: BundledAsset["use"],
  added: string,
): BundledAsset {
  return {
    name,
    file,
    digest: digestBrand(`sha256:${hex}`),
    mediaType: "image/webp",
    byteLength,
    use,
    origin: {
      kind: "project",
      license: "MIT",
      source: `character-view/${file} at ${reference}`,
      added,
    },
  };
}

export const bundledAssets: ReadonlyArray<BundledAsset> = [
  project(
    "surfaces",
    "surfaces.atlas.webp",
    "59af8c9dbd86e321c1c8f13ed0102c21a41b6b433b9afbe47d565fb16c2f2140",
    669626,
    "surface",
    "188f04d",
  ),
  project(
    "jacket",
    "work-jacket.webp",
    "31bb906fca93601ab321bcd1d3061a8baf892c4a65e4bc6b7d66d598ddf94bd3",
    728364,
    "surface",
    "188f04d",
  ),
  project(
    "horn",
    "horn-growth.atlas.webp",
    "f0ee028b6ac20544f06a7b41b086ab54d4df5da86c43de14b6230552a397a451",
    109740,
    "surface",
    "9d8e1b5",
  ),
  project(
    "faces",
    "faces.atlas.webp",
    "2a8a4048d933d1c72e0f8667dd81b537063cd87c063ae75986fa67fd7ebd9928",
    273064,
    "surface",
    "188f04d",
  ),
  project(
    "tidebell",
    "tidebell.atlas.webp",
    "fd37d10c0e04a6b255efc859fe332e5ed3944d642f9be148c3eb126c2f3b8042",
    207226,
    "turnaround",
    "188f04d",
  ),
  project(
    "trader",
    "trader.atlas.webp",
    "1aaf5cd8b5f118e1d65514fd183c3c11e488347a4439bec70742972ae2583270",
    173268,
    "turnaround",
    "872309a",
  ),
  project(
    "surveyor",
    "surveyor.atlas.webp",
    "7a4a68d18617e41dee3d59896a8705553f52f9c4fdf3c9f99418ae5c01a6d998",
    146550,
    "turnaround",
    "872309a",
  ),
  project(
    "courier",
    "courier.atlas.webp",
    "bde8b712c80034dbf393fe82167165fb4ec73dc327eff5b18ab224db68a150c8",
    85060,
    "turnaround",
    "872309a",
  ),
  project(
    "foremanPortrait",
    "foreman-portrait.atlas.webp",
    "fea133346ae0950fe9a561fc74c24eda0bf3a000f45ded09968559e9014cd05e",
    316902,
    "turnaround",
    "872309a",
  ),
  project(
    "relayPortrait",
    "relay-portrait.atlas.webp",
    "50269508c8892a0bcc9e2f93d6cf0500dce6463e876e2fbe4e4fe92b883fd813",
    201832,
    "turnaround",
    "872309a",
  ),
  project(
    "expedition",
    "expedition.atlas.webp",
    "90eda5840127e933ca4df505079c11e5bc174744031f11592ae2585cbd83c221",
    169210,
    "turnaround",
    "872309a",
  ),
  project(
    "ridgeback",
    "ridgeback.atlas.webp",
    "d78bd66b2e44e069032c8165fe332f23ee69f55ddb809afc06842217422d6fbf",
    361674,
    "turnaround",
    "872309a",
  ),
  project(
    "cartographer",
    "cartographer.atlas.webp",
    "e79f94b72b718df2884116d921c6daa802822059dd05cc50abc5f7265d071f0c",
    131000,
    "turnaround",
    "872309a",
  ),
  project(
    "conductor",
    "conductor.atlas.webp",
    "60f941ec5d3f38cb8328b9faf08f8ced935920844b644b568200b5d6b50cc3fc",
    99682,
    "turnaround",
    "872309a",
  ),
  project(
    "coastPortrait",
    "coast-portrait.atlas.webp",
    "35b9bee5247d425063626d13348fc25fbd59c8945f1d9ee6c9c20853c82cd9c8",
    401246,
    "turnaround",
    "872309a",
  ),
  project(
    "conductorPortrait",
    "conductor-portrait.atlas.webp",
    "dc79c0fd524c9ec6e3272f27d0d00d5e78ea1046074263d631f92f4fd37b52a5",
    233832,
    "turnaround",
    "872309a",
  ),
];

const byDigest = new Map(bundledAssets.map((a) => [a.digest, a]));
const byName = new Map(bundledAssets.map((a) => [a.name, a]));

export const bundledAsset = (digest: Digest): BundledAsset | undefined => byDigest.get(digest);
export const bundledAssetNamed = (name: string): BundledAsset | undefined => byName.get(name);

export function bundledEntry(asset: BundledAsset): AssetEntry {
  return {
    digest: asset.digest,
    mediaType: asset.mediaType,
    byteLength: asset.byteLength,
    role: "paint-atlas",
  };
}

export type AssetSource = "bundled" | "project";

export interface ResolvedAsset {
  readonly digest: Digest;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
  readonly source: AssetSource;
  readonly bundled?: BundledAsset;
}

export interface AssetResolver {
  readonly resolve: (digest: Digest) => ResolvedAsset | undefined;
}

export interface ResolverInput {
  readonly bundled: (asset: BundledAsset) => Uint8Array | undefined;
  readonly project?: (
    digest: Digest,
  ) => { readonly bytes: Uint8Array; readonly mediaType: string } | undefined;
}

export function assetResolver(input: ResolverInput): AssetResolver {
  const cache = new Map<Digest, ResolvedAsset | null>();
  const verified = (digest: Digest, bytes: Uint8Array): boolean => sha256Digest(bytes) === digest;
  return {
    resolve(digest) {
      const known = cache.get(digest);
      if (known !== undefined) return known ?? undefined;
      let found: ResolvedAsset | undefined;
      const asset = byDigest.get(digest);
      const bytes = asset && input.bundled(asset);
      if (asset && bytes && verified(digest, bytes))
        found = { digest, mediaType: asset.mediaType, bytes, source: "bundled", bundled: asset };
      else {
        const stored = input.project?.(digest);
        if (stored && verified(digest, stored.bytes))
          found = { digest, mediaType: stored.mediaType, bytes: stored.bytes, source: "project" };
      }
      cache.set(digest, found ?? null);
      return found;
    },
  };
}

export function bundledDependencies(
  doc: CharacterDocument,
): ReadonlyArray<{ readonly entry: AssetEntry; readonly asset: BundledAsset }> {
  const out: { entry: AssetEntry; asset: BundledAsset }[] = [];
  for (const entry of doc.assets) {
    const asset = byDigest.get(entry.digest);
    if (asset && asset.byteLength === entry.byteLength && asset.mediaType === entry.mediaType)
      out.push({ entry, asset });
  }
  return out;
}

export const checkAssetBytes = verifyAssetBytes;
