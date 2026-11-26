export const presetOutfitNames = [
  "T-shirt and jeans",
  "Hoodie and joggers",
  "Shirt and chinos",
  "Sweater and skirt",
  "Day dress",
  "Running kit",
  "Coveralls",
  "Chore jacket",
  "Workshop apron",
  "Overcoat",
  "Traveller",
  "Explorer",
  "Parka",
  "Leather armour",
] as const;
export type PresetOutfit = (typeof presetOutfitNames)[number];
export const isPresetOutfit = (name: string): name is PresetOutfit =>
  presetOutfitNames.some((n) => n === name);
