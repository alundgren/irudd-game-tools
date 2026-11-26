import {
  characterAppearance,
  outfitFit,
  outfitLayers,
  outfitLooks,
  outfitWardrobe,
  outfitWear,
  decodeWith,
  type OutfitName,
  type CharacterDocument,
  type LayerStyle,
  type OutfitLook,
} from "@irudd/document";

import { humanAdultId, HumanAdultParams } from "./human/generator.js";
import { chooseAdultWardrobe } from "./human/wardrobe.js";

export function adultWardrobeParams(doc: CharacterDocument) {
  if (doc.generation?.generator !== humanAdultId) return undefined;
  const read = decodeWith(HumanAdultParams, doc.generation.params);
  if (!read.ok) throw new Error(read.diagnostics.map((d) => d.message).join(" "));
  return read.value;
}

export function wornOutfit(doc: CharacterDocument): OutfitName {
  const adult = adultWardrobeParams(doc);
  return adult
    ? (adult.outfit ?? "Anatomy")
    : (outfitWardrobe.read(doc.features)?.outfit ?? "Work clothes");
}

export function chooseWardrobe(doc: CharacterDocument, outfit: OutfitName): CharacterDocument {
  const params = adultWardrobeParams(doc);
  const features = {
    ...doc.features,
    [outfitWardrobe.id]: outfitWardrobe.json({ outfit }),
    [outfitLayers.id]: outfitLayers.json({ layers: {} }),
  };
  return params && doc.generation
    ? {
        ...doc,
        features,
        generation: { ...doc.generation, params: chooseAdultWardrobe(params, outfit) },
      }
    : { ...doc, features };
}

export function fittedGarments(doc: CharacterDocument) {
  return doc.parts.filter((p) => outfitFit.read(p.features) !== undefined);
}

export function styleGarment(doc: CharacterDocument, id: string, style: LayerStyle) {
  if (!fittedGarments(doc).some((p) => p.id === id)) throw new Error("Choose a fitted garment.");
  const layers: Record<string, LayerStyle> = { ...outfitLayers.read(doc.features)?.layers };
  if (Object.keys(style).length) layers[id] = style;
  else delete layers[id];
  return outfitLayers.json({ layers });
}

export function saveLook(doc: CharacterDocument, name: string, replace = false) {
  name = name.trim();
  if (!name || name.length > 64) throw new Error("Give the outfit a name of up to 64 characters.");
  const looks = savedLooks(doc);
  const existing = looks.some((l) => l.name === name);
  if (existing && !replace)
    throw new Error("That name is in use. Choose Update outfit to replace it.");
  if (!existing && replace) throw new Error("Choose a saved outfit to update.");
  if (!existing && looks.length >= 32)
    throw new Error("A character can hold up to 32 saved outfits.");
  const base = wornOutfit(doc),
    active = outfitLayers.read(doc.features)?.layers;
  const layers: Record<string, LayerStyle> = {};
  for (const p of fittedGarments(doc)) {
    const style = active?.[p.id];
    layers[p.id] = {
      ...style,
      show: style?.show ?? outfitWear.read(p.features)?.visibleIn?.includes(base) ?? true,
    };
  }
  const tones = characterAppearance.read(doc.features)?.tones;
  const look: OutfitLook = { name, base, layers, ...(tones ? { tones } : {}) };
  return outfitLooks.json({
    looks: existing ? looks.map((l) => (l.name === name ? look : l)) : [...looks, look],
  });
}

export function savedLooks(doc: CharacterDocument): ReadonlyArray<OutfitLook> {
  return outfitLooks.read(doc.features)?.looks ?? [];
}

export function wearLook(doc: CharacterDocument, look: OutfitLook): CharacterDocument {
  const layers: Record<string, LayerStyle> = {};
  for (const part of doc.parts)
    if (outfitFit.read(part.features) !== undefined)
      layers[part.id] = Object.hasOwn(look.layers, part.id)
        ? { ...look.layers[part.id] }
        : { show: false };
  const chosen = chooseWardrobe(doc, look.base);
  const features = { ...chosen.features };
  features[outfitLayers.id] = outfitLayers.json({ layers });
  const appearance = characterAppearance.read(doc.features);
  if (appearance) {
    const { tones: _worn, ...rest } = appearance;
    features[characterAppearance.id] = characterAppearance.json(
      look.tones ? { ...rest, tones: { ...look.tones } } : rest,
    );
  } else if (look.tones)
    throw new Error(`The outfit ${look.name} has tones but the character has no appearance.`);
  return { ...chosen, features };
}
