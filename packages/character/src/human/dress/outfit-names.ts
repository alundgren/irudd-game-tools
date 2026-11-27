export const presetOutfitNames = [
  "T-shirt and jeans",
  "Hoodie and joggers",
  "Shirt and chinos",
  "Sweater and skirt",
  "Day dress",
  "Evening gown",
  "Split mantle",
  "Hooded shoulder cloak",
  "Bomber and wide trousers",
  "Rolled bomber and cuffed trousers",
  "Bodice and gored skirt",
  "Draped bodice gown",
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
export type OutfitPattern = PresetOutfit | "Pressure suit";
export const isPresetOutfit = (name: string): name is PresetOutfit =>
  presetOutfitNames.some((n) => n === name);

export const libraryOutfits: Readonly<Record<string, readonly string[]>> = {
  "Field jacket and denim": ["male_casualsuit05", "shoes02"],
  "Workshop overalls": ["male_worksuit01", "shoes02"],
  "Tailored suit": ["male_elegantsuit01", "shoes01"],
  "Striped blouse and skirt": ["female_elegantsuit01", "shoes01"],
  "Overshirt and denim": ["male_casualsuit01", "shoes02"],
  "Striped shirt and jeans": ["male_casualsuit03", "shoes01"],
  "Track top and leggings": ["female_sportsuit01", "shoes05"],
  "Mail tunic and boots": ["viking_tunic", "viking_pants", "viking_boots"],
  "Rope-belted robe": ["monk_robe", "shoes01"],
  "Shift dress": ["shift_dress", "shoes01"],
  "Rib knit and full skirt": ["full_skirt", "rib_sweater", "shoes01"],
  "Weathered field coat": ["einar_trousers", "einar_boots", "einar_coat"],
  "Survey vest": ["expedition_vest"],
  "Hoodie and denim shorts": ["hoodie_shorts"],
  "Crew sweatshirt and cargo trousers": ["einar_trousers", "shoes02", "crew_sweatshirt"],
  "Crew sweatshirt and trousers": ["viking_pants", "shoes02", "crew_sweatshirt"],
  "Cable V-neck and trousers": ["viking_pants", "shoes01", "cable_vneck"],
  "Cable V-neck and cargo trousers": ["einar_trousers", "shoes02", "cable_vneck"],
};
export const libraryOutfitNames = Object.keys(libraryOutfits);
