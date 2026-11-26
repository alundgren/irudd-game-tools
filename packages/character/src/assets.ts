// Bundled artwork and the typed resolution of the bytes a character uses.
//
// A document names every atlas it paints with by content digest, in
// `part.paint.atlas` and `figure.occluders`, and declares it in `doc.assets`
// (role `paint-atlas`). The digest is the only identity: a bundled atlas
// shipped with this build and an atlas a person imported into a project
// resolve the same way, and a GLB is never treated as editable source.
//
// Bundled files live in `packages/character/assets/`. Their bytes are the
// tracked files of the reference workshop at 2761eb14, so their history and
// licence are the repository's. Hosts stage a document's bundled bytes into
// the project's content-addressed store before committing it
// (`bundledDependencies`), so the project reopens even if a later build
// retires the file.

import {
  digestBrand,
  sha256Digest,
  verifyAssetBytes,
  type AssetEntry,
  type CharacterDocument,
  type Digest,
} from "@irudd/document";

/** Where a bundled file came from and under which licence it ships. */
export type AssetOrigin =
  | {
      /** Original art made for this project; the repository's MIT licence applies. */
      readonly kind: "project";
      readonly license: "MIT";
      /** Tracked source path at the reference commit, and the commit that added it. */
      readonly source: string;
      readonly added: string;
    }
  | {
      /** Third-party material that must be credited in exports. */
      readonly kind: "credited";
      readonly license: string;
      readonly source: string;
      readonly credit: string;
    };

export interface BundledAsset {
  /** The reference workshop's name for the file, used only when preparing its forms. */
  readonly name: string;
  /** File name in packages/character/assets. */
  readonly file: string;
  readonly digest: Digest;
  readonly mediaType: "image/webp";
  readonly byteLength: number;
  /** `turnaround`: a two-by-two paint sheet. `surface`: a material swatch the builder loads itself. */
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

/** Every file this build ships. All of it is project-owned original art. */
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

/** The declaration a document makes for a bundled file it paints with. */
export function bundledEntry(asset: BundledAsset): AssetEntry {
  return {
    digest: asset.digest,
    mediaType: asset.mediaType,
    byteLength: asset.byteLength,
    role: "paint-atlas",
  };
}

/** Where a resolved asset's bytes came from. */
export type AssetSource = "bundled" | "project";

export interface ResolvedAsset {
  readonly digest: Digest;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
  readonly source: AssetSource;
  /** Present for bundled files. */
  readonly bundled?: BundledAsset;
}

/**
 * Resolves a digest to verified bytes, offline. Bundled files come first,
 * then the project's content-addressed store. Bytes that do not hash to the
 * digest are refused, so a resolver never returns unverified content.
 */
export interface AssetResolver {
  readonly resolve: (digest: Digest) => ResolvedAsset | undefined;
}

export interface ResolverInput {
  /** Bytes of a bundled file, for example read from packages/character/assets. */
  readonly bundled: (asset: BundledAsset) => Uint8Array | undefined;
  /** The project's blob store, for imported artwork. */
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

/**
 * The declared assets of a document that this build ships, with their bytes'
 * origin, so a host can stage them in the project's store before commit.
 * Each returned entry verifies against bytes the resolver gives for it.
 */
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

/** Diagnostics for ingesting `bytes` as the declared `entry`; empty when they match. */
export const checkAssetBytes = verifyAssetBytes;
