// Export a character document revision as a GLB.
//
// Ported from exportForm in character-view/export-form.js at 2761eb1. The GLB
// carries its provenance in `asset.extras.irudd`: the document, its digest and
// revision, the builder's build, the preset and the artwork it was painted
// with (digest, whether bundled or project bytes, origin and licence).
// Credits for third-party material the character uses go in `asset.copyright`.
// Project artwork carries the document's `irudd.asset-credits` entry for it
// (who submitted it and what they stated about who made it), and a stated
// credit or licence joins `asset.copyright`. Bundled files keep their shipped
// origin whatever the document says.
//
// Presets:
//   clay      one uniform material, no textures (runs anywhere)
//   full      finish materials, baked turnaround paint and markings
//   game      the full surfaces on one 1024 px atlas within 24,000 triangles
//   portrait  the same on a 2048 px atlas
// With `wardrobe` every saved outfit is its own scene with its own rig and
// clips, as G0's wardrobe export writes them.
// Textured presets need `textures`: the host raster, loaded surface swatches
// and the document's prepared paint sheets. A painted part whose sheet did
// not resolve fails the export instead of silently losing its paint.
// The bundled faces sheet a visible built-in head draws, the portrait plates
// of parts that show and the bundled swatch sheets (surfaces, jacket, horn)
// whose swatches reach an exported material are listed with the paint sheets; neither has
// turnaround panels, and clay draws none of them. A plate whose bytes did not
// load fails the export.

import * as T from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import {
  assetCreditLine,
  assetCredits,
  documentDigest,
  type AssetCredit,
  type CharacterDocument,
  type Digest,
  type OutfitLook,
} from "@irudd/document";
import { humanCredits } from "./human/credits.js";
import {
  buildCharacter,
  clayMaterials,
  type BuiltCharacter,
  type MaterialSource,
  type Preset,
} from "./build.js";
import { canonicalImages, readGlb, writeGlb } from "./glb.js";
import { skinCharacter, type Rig } from "./rig/skin.js";
import { isMesh } from "./mesh.js";
import { savedLooks, wearLook } from "./wardrobe.js";
import {
  buildView,
  drawsBuiltinFace,
  paintSheets,
  portraitPlates,
  type BuildView,
} from "./view.js";
import type { PortraitPlates } from "./paint/portrait.js";
import { gameTriangleTarget, optimizeForGame } from "./game/optimize.js";
import { surfaceMaterials, swatchSheet, type SurfaceKit } from "./materials/surfaces.js";
import type { PaintAtlases } from "./paint/turnaround.js";
import {
  bundledAssetNamed,
  type AssetOrigin,
  type AssetResolver,
  type AssetSource,
} from "./assets.js";
import type { HumanBody } from "./human/body.js";
import type { HumanPaintSources } from "./human/complexion.js";

export const provenanceFormat = "irudd.export";
export const provenanceVersion = 1;

export interface Provenance {
  readonly format: typeof provenanceFormat;
  readonly version: typeof provenanceVersion;
  readonly document: string;
  readonly digest: Digest;
  readonly revision: number;
  /** The character builder build that produced the bytes. */
  readonly build: string;
  readonly preset: Preset;
  /**
   * A wardrobe export: the saved outfits, one scene each, in scene order.
   * Absent for an export of the document as worn, which has one scene.
   */
  readonly wardrobe?: { readonly looks: ReadonlyArray<string> };
  /** Sheets the export painted with. Absent when it used none. */
  readonly artwork?: ReadonlyArray<ArtworkUse>;
}

/** One sheet a GLB was painted from, and where its bytes came from. */
export interface ArtworkUse {
  readonly digest: Digest;
  readonly source: AssetSource;
  /** For bundled files: its file name, origin and licence. */
  readonly file?: string;
  readonly origin?: AssetOrigin;
  /** For project bytes: the document's credit for them, from `irudd.asset-credits`. */
  readonly credit?: AssetCredit;
}

/** What textured presets draw with. */
export interface Textures {
  readonly surfaces: SurfaceKit;
  readonly paint: PaintAtlases;
  /** The resolver the paint sheets came from, for provenance. */
  readonly assets: AssetResolver;
  /** The document's portrait plates, loaded as individual images. */
  readonly plates?: PortraitPlates;
}

export interface ExportOptions {
  readonly preset: Preset;
  /** The document revision being exported. */
  readonly revision: number;
  /** Identifies the active build, for example its source commit. */
  readonly build: string;
  /** Surfaces for the textured presets. The clay preset needs none. */
  readonly textures?: Textures;
  /** Overrides the textured presets' finish materials, for previews. */
  readonly materials?: MaterialSource;
  /** The adult body pack, needed to export documents irudd.human-adult generated. */
  readonly human?: HumanBody;
  /** The adult's prepared paint, for the textured presets of documents irudd.human-adult generated. */
  readonly humanPaint?: HumanPaintSources;
  /**
   * Export every saved outfit (`outfit.looks`) as its own scene, named after
   * the outfit with its own rig and clips, instead of the document as worn.
   */
  readonly wardrobe?: boolean;
}

export interface ExportResult {
  readonly bytes: Uint8Array;
  readonly provenance: Provenance;
  readonly credits: ReadonlyArray<string>;
}

/** The sheets a view paints with, resolved. Throws when one is not available. */
export function artworkFor(view: BuildView, assets: AssetResolver): ArtworkUse[] {
  return sortedArtwork(
    resolveArtwork([...paintSheets(view), ...kitSheets([view]), ...portraitPlates(view)], assets),
  );
}

/** Sheets to load for the scenes that will actually be exported. */
export function exportPaintSheets(doc: CharacterDocument, wardrobe = false): Digest[] {
  if (!wardrobe) return paintSheets(buildView(doc));
  const sheets = savedLooks(doc).flatMap((look) => paintSheets(buildView(wearLook(doc, look))));
  return [...new Set(sheets)].sort();
}

/** Portrait plates to load for the scenes that will actually be exported. */
export function exportPortraitPlates(doc: CharacterDocument, wardrobe = false): Digest[] {
  const views = wardrobe
    ? savedLooks(doc).map((look) => buildView(wearLook(doc, look)))
    : [buildView(doc)];
  return [...new Set(views.flatMap(portraitPlates))].sort();
}

/**
 * Bundled sheets a textured export draws besides its paint sheets: the faces
 * sheet when a built-in head shows. They carry no turnaround panels.
 */
export function exportKitSheets(doc: CharacterDocument, wardrobe = false): Digest[] {
  return kitSheets(
    wardrobe ? savedLooks(doc).map((look) => buildView(wearLook(doc, look))) : [buildView(doc)],
  );
}

const sortedArtwork = (artwork: ReadonlyArray<ArtworkUse>): ArtworkUse[] =>
  [...artwork].sort((a, b) => (a.digest < b.digest ? -1 : 1));

function kitSheets(views: ReadonlyArray<BuildView>): Digest[] {
  if (!views.some(drawsBuiltinFace)) return [];
  const faces = bundledAssetNamed("faces");
  if (!faces) throw new Error("This build does not ship the built-in faces sheet.");
  return [faces.digest];
}

/**
 * The artwork a textured export of `doc` paints with, resolved for its
 * provenance. Throws when a sheet or plate is not available, when a paint
 * sheet's panels or a portrait plate's image did not load.
 */
export function exportArtwork(
  doc: CharacterDocument,
  textures: Pick<Textures, "assets" | "paint" | "plates">,
  wardrobe = false,
): ArtworkUse[] {
  const sheets = resolveArtwork(exportPaintSheets(doc, wardrobe), textures.assets);
  const missing = sheets.filter((a) => !textures.paint.panels(a.digest)).map((a) => a.digest);
  if (missing.length) throw new Error(`Paint sheets did not load: ${missing.join(", ")}.`);
  const kit = resolveArtwork(exportKitSheets(doc, wardrobe), textures.assets);
  const plateDigests = exportPortraitPlates(doc, wardrobe);
  const plates = resolveArtwork(plateDigests, textures.assets);
  const unloaded = plateDigests.filter((d) => !textures.plates?.image(d));
  if (unloaded.length) throw new Error(`Portrait plates did not load: ${unloaded.join(", ")}.`);
  return sortedArtwork([...sheets, ...kit, ...plates]);
}

/** Texture slots a standard material exports. */
const slots = [
  "map",
  "bumpMap",
  "roughnessMap",
  "emissiveMap",
  "normalMap",
  "metalnessMap",
  "aoMap",
  "alphaMap",
] as const;

/**
 * Bundled swatch sheets whose textures reach a material of a visible mesh in
 * `scene`, as the exporter writes only visible nodes. A swatch a part's own
 * finish would use but an override replaced, or a hidden part's, is not one.
 */
export function swatchSheets(scene: T.Object3D): Digest[] {
  const found = new Set<Digest>();
  scene.traverseVisible((node) => {
    if (!isMesh(node)) return;
    const material: T.Material | T.Material[] = node.material;
    for (const m of Array.isArray(material) ? material : [material]) {
      if (!(m instanceof T.MeshStandardMaterial)) continue;
      for (const slot of slots) {
        const texture = m[slot];
        const sheet = texture && swatchSheet.get(texture);
        if (sheet) found.add(sheet);
      }
    }
  });
  return [...found].sort();
}

function resolveArtwork(digests: ReadonlyArray<Digest>, assets: AssetResolver): ArtworkUse[] {
  return digests.map((digest) => {
    const resolved = assets.resolve(digest);
    if (!resolved) throw new Error(`The artwork ${digest} is not available to this build.`);
    return resolved.bundled
      ? {
          digest,
          source: resolved.source,
          file: resolved.bundled.file,
          origin: resolved.bundled.origin,
        }
      : { digest, source: resolved.source };
  });
}

/** Credits for third-party material in `artwork`, and the credit or licence stated for project art. */
export function creditsFor(artwork: ReadonlyArray<ArtworkUse>): string[] {
  return artwork.flatMap((a) => {
    if (a.origin) return a.origin.kind === "credited" ? [a.origin.credit] : [];
    const line = a.credit && assetCreditLine(a.credit);
    return line ? [line] : [];
  });
}

/** Project artwork with the document's credits attached. Bundled files keep their shipped origin. */
export function creditArtwork(
  doc: CharacterDocument,
  artwork: ReadonlyArray<ArtworkUse>,
): ArtworkUse[] {
  const credits = assetCredits(doc);
  return artwork.map((a) => {
    const credit = a.source === "bundled" || a.origin ? undefined : credits.get(a.digest);
    return credit ? { ...a, credit } : a;
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function texturesFor(options: ExportOptions): Textures {
  if (!options.textures)
    throw new Error(
      `The ${options.preset} preset needs textures: a raster, surfaces and paint sheets.`,
    );
  return options.textures;
}

export async function exportCharacter(
  doc: CharacterDocument,
  options: ExportOptions,
): Promise<ExportResult> {
  const clay = options.preset === "clay";
  const game = options.preset === "game" || options.preset === "portrait";
  const textures = clay ? undefined : texturesFor(options);
  const sheets = textures ? exportArtwork(doc, textures, options.wardrobe) : [];
  const swatches = new Set<Digest>();
  const surfaces = textures && surfaceMaterials(textures.surfaces);
  const looks: ReadonlyArray<OutfitLook | undefined> = options.wardrobe
    ? savedLooks(doc)
    : [undefined];
  if (!looks.length) throw new Error("Save an outfit before exporting the wardrobe.");
  const entries: Array<{
    readonly scene: T.Scene;
    readonly rig: Rig;
    readonly character: BuiltCharacter;
    page?: { dispose(): void };
  }> = [];
  try {
    for (const look of looks) {
      const character = buildCharacter(look ? wearLook(doc, look) : doc, {
        materials: clay ? clayMaterials() : (options.materials ?? surfaces ?? clayMaterials()),
        groomMaterials: options.materials ? undefined : surfaces,
        wingMaterials: options.materials ? undefined : surfaces,
        ...(textures
          ? {
              finish: {
                paint: textures.paint,
                faces: textures.surfaces.faces,
                plates: textures.plates,
              },
            }
          : {}),
        game,
        human: options.human,
        humanPaint: options.humanPaint,
      });
      let rig: Rig;
      try {
        rig = skinCharacter(character);
      } catch (error) {
        character.dispose();
        throw error;
      }
      const scene = new T.Scene();
      const entry: (typeof entries)[number] = { scene, rig, character };
      entries.push(entry);
      if (look) {
        scene.name = look.name;
        scene.userData["outfitName"] = look.name;
        // Importers need a distinct, non-joint parent for each skeleton.
        rig.actor.name = look.name + " rig";
        scene.add(rig.actor);
        // A skinned mesh uses its joints' world transforms in glTF.
        scene.add(...rig.actor.children.filter(isMesh));
      } else scene.add(...rig.actor.children);
      // Read before a game atlas bakes the swatches into its own page.
      if (textures) for (const sheet of swatchSheets(scene)) swatches.add(sheet);
      if (game && textures)
        entry.page = await optimizeForGame(scene, {
          raster: textures.surfaces.raster,
          triangles: gameTriangleTarget,
          size: options.preset === "portrait" ? 2048 : 1024,
          contact: true,
        });
    }
    const clips = entries.map((e) => e.rig.clips);
    const output = await new GLTFExporter().parseAsync(
      entries.map((e) => e.scene),
      { binary: true, animations: entries.length === 1 ? (clips[0] ?? []) : clips },
    );
    if (!(output instanceof ArrayBuffer)) throw new Error("The exporter did not return a GLB.");
    const drawn = textures
      ? resolveArtwork(
          [...swatches].filter((d) => !sheets.some((a) => a.digest === d)),
          textures.assets,
        )
      : [];
    const artwork = creditArtwork(doc, sortedArtwork([...sheets, ...drawn]));
    const provenance: Provenance = {
      format: provenanceFormat,
      version: provenanceVersion,
      document: doc.id,
      digest: documentDigest(doc),
      revision: options.revision,
      build: options.build,
      preset: options.preset,
      ...(options.wardrobe
        ? { wardrobe: { looks: looks.flatMap((l) => (l ? [l.name] : [])) } }
        : {}),
      ...(artwork.length ? { artwork } : {}),
    };
    const human = entries.find((e) => e.character.human)?.character.human;
    const adult = human && humanCredits(human.params, human.bones.size);
    const credits = [...(adult?.copyright ?? []), ...creditsFor(artwork)];
    const { json, rest } = canonicalImages(readGlb(new Uint8Array(output)));
    if (!isObject(json) || !isObject(json["asset"])) throw new Error("The GLB has no asset.");
    const asset = json["asset"];
    const extras = isObject(asset["extras"]) ? asset["extras"] : {};
    const stamped = {
      ...json,
      asset: {
        ...asset,
        ...(credits.length ? { copyright: credits.join(" ") } : {}),
        extras: { ...extras, ...adult?.extras, irudd: provenance },
      },
    };
    return { bytes: writeGlb(stamped, rest), provenance, credits };
  } finally {
    for (const { scene, rig, character, page } of entries) {
      rig.actor.add(...scene.children.filter((o) => o !== rig.actor));
      page?.dispose();
      rig.dispose();
      character.dispose();
    }
  }
}

/** The provenance stamped in a GLB by `exportCharacter`, if any. */
export function readProvenance(bytes: Uint8Array): unknown {
  const { json } = readGlb(bytes);
  if (!isObject(json) || !isObject(json["asset"])) return undefined;
  const extras = json["asset"]["extras"];
  return isObject(extras) ? extras["irudd"] : undefined;
}
