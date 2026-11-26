// Saved outfits. Ported from wearOutfit in character-view/outfit-sets.js at
// 2761eb1: wearing a look selects its base outfit, styles every fitted
// garment from the look (hiding garments it does not name) and replaces the
// appearance's tones with the look's own.

import {
  characterAppearance,
  outfitFit,
  outfitLayers,
  outfitLooks,
  outfitWardrobe,
  type CharacterDocument,
  type LayerStyle,
  type OutfitLook,
} from "@irudd/document";

/** The document's saved outfits, in their saved order. */
export function savedLooks(doc: CharacterDocument): ReadonlyArray<OutfitLook> {
  return outfitLooks.read(doc.features)?.looks ?? [];
}

/** The document as it is worn in `look`. Geometry, paint and every edit are untouched. */
export function wearLook(doc: CharacterDocument, look: OutfitLook): CharacterDocument {
  const layers: Record<string, LayerStyle> = {};
  for (const part of doc.parts)
    if (outfitFit.read(part.features) !== undefined)
      layers[part.id] = Object.hasOwn(look.layers, part.id)
        ? { ...look.layers[part.id] }
        : { show: false };
  const features = { ...doc.features };
  features[outfitWardrobe.id] = outfitWardrobe.json({ outfit: look.base });
  features[outfitLayers.id] = outfitLayers.json({ layers });
  const appearance = characterAppearance.read(doc.features);
  if (appearance) {
    const { tones: _worn, ...rest } = appearance;
    features[characterAppearance.id] = characterAppearance.json(
      look.tones ? { ...rest, tones: { ...look.tones } } : rest,
    );
  } else if (look.tones)
    throw new Error(`The outfit ${look.name} has tones but the character has no appearance.`);
  return { ...doc, features };
}
