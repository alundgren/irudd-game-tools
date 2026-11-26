import { Schema } from "effect";
import { PartId } from "../schema.js";
import { Tones } from "./appearance.js";
import { family, Hex } from "./family.js";

export const outfits = ["Anatomy", "Base layer", "Work clothes", "Pressure suit"] as const;
export const OutfitName = Schema.Literals(outfits);
export type OutfitName = typeof OutfitName.Type;

export const outfitRoles = [
  "torso",
  "pelvis",
  "upper arm",
  "forearm",
  "hand",
  "thigh",
  "shin",
  "foot",
  "head",
  "skirt",
  "accessory",
  "tail",
] as const;
export const OutfitRoleName = Schema.Literals(outfitRoles);
export type OutfitRoleName = typeof OutfitRoleName.Type;

export const OutfitWardrobe = Schema.Struct({ outfit: OutfitName });
export type OutfitWardrobe = typeof OutfitWardrobe.Type;

export const outfitWardrobe = family({
  id: "outfit.wardrobe",
  version: 1,
  scope: "document",
  schema: OutfitWardrobe,
  toJson: (v) => v,
});

export const OutfitWear = Schema.Struct({
  role: Schema.optionalKey(OutfitRoleName),
  visibleIn: Schema.optionalKey(Schema.Array(OutfitName).check(Schema.isMinLength(1))),
  bare: Schema.optionalKey(Schema.Literal(true)),
});
export type OutfitWear = typeof OutfitWear.Type;

export const outfitWear = family({
  id: "outfit.wear",
  version: 1,
  scope: "part",
  schema: OutfitWear,
  toJson: (v) => v,
});

export const OutfitFit = Schema.Struct({});
export type OutfitFit = typeof OutfitFit.Type;

export const outfitFit = family({
  id: "outfit.fit",
  version: 1,
  scope: "part",
  schema: OutfitFit,
  toJson: (v) => v,
});

export const LayerStyle = Schema.Struct({
  show: Schema.optionalKey(Schema.Boolean),
  dye: Schema.optionalKey(Hex),
  order: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 15 }))),
});
export type LayerStyle = typeof LayerStyle.Type;

export const GarmentLayers = Schema.Record(PartId, LayerStyle).check(
  Schema.makeFilter(
    (layers: Readonly<Record<string, LayerStyle>>) =>
      Object.keys(layers).length <= 128 || "Style at most 128 garments.",
  ),
);
export type GarmentLayers = typeof GarmentLayers.Type;

const layerReferences = (layers: GarmentLayers, path: ReadonlyArray<string | number>) =>
  Object.keys(layers).map((id) => ({ kind: "part" as const, id, path: [...path, id] }));

export const OutfitLayers = Schema.Struct({ layers: GarmentLayers });
export type OutfitLayers = typeof OutfitLayers.Type;

export const outfitLayers = family({
  id: "outfit.layers",
  version: 1,
  scope: "document",
  schema: OutfitLayers,
  toJson: (v) => v,
  references: (v) => layerReferences(v.layers, ["layers"]),
});

export const OutfitLook = Schema.Struct({
  name: Schema.String.check(
    Schema.isMaxLength(64),
    Schema.makeFilter((name: string) => name.trim().length > 0 || "Name the outfit."),
  ),
  base: OutfitName,
  layers: GarmentLayers,
  tones: Schema.optionalKey(Tones),
});
export type OutfitLook = typeof OutfitLook.Type;

export const OutfitLooks = Schema.Struct({
  looks: Schema.Array(OutfitLook).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(32),
    Schema.makeFilter(
      (looks: ReadonlyArray<OutfitLook>) =>
        new Set(looks.map((l) => l.name)).size === looks.length || "Give each outfit its own name.",
    ),
  ),
});
export type OutfitLooks = typeof OutfitLooks.Type;

export const outfitLooks = family({
  id: "outfit.looks",
  version: 1,
  scope: "document",
  schema: OutfitLooks,
  toJson: (v) => v,
  references: (v) => v.looks.flatMap((l, i) => layerReferences(l.layers, ["looks", i, "layers"])),
});
