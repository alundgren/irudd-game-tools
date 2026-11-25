// Costumes made by MakeHuman community authors, each released by its author under CC0.
//   attireClothes   outfit name -> the packed garments worn together
//   attireAssets    the packed garments, in the form human-library.js fits, rigs and dyes
//   attireCredits   outfit name -> [{ garment, author, licence, source }] for the community garments in it
// The garments are packed by scripts/pack-human-attire.py from the official `suits02`, `dress01`, `skirts01`,
// and `shirts01` asset packs. They are
// worn through human-library.js like every other library garment: fitted to the skin, skinned to the same
// joints, dyed by the tones of the style and drawn by the same exporter.
import assets from "./human-attire-data.json" with { type: "json" };

export const attireAssets = assets;
// The robe is worn over the low leather shoes of the system library: a boot shaft would stand through its skirt.
export const attireClothes = {
  "Mail tunic and boots": ["viking_tunic", "viking_pants", "viking_boots"],
  "Rope-belted robe": ["monk_robe", "shoes01"],
};
// Everyday silhouettes by community authors: a tailored dress and a skirt worn with knitwear.
// The skirt is put on first, so the knit lies over its waistband.
export const everydayClothes = {
  "Shift dress": ["shift_dress", "shoes01"],
  "Rib knit and full skirt": ["full_skirt", "rib_sweater", "shoes01"],
};
/** Outfits that leave the lower leg bare: their socks stand as knitted, with no trouser cuff to lie under. */
export const bareLegged = new Set(Object.keys(everydayClothes));
export const attireCredits = Object.fromEntries(Object.entries({ ...attireClothes, ...everydayClothes }).map(([outfit, garments]) =>
  [outfit, garments.filter(garment => assets[garment]).map(garment => ({ garment, ...assets[garment].credit }))]));

/**
 * Give a garment's material the roughness, metal and shadow painted for it, so mail gleams beside dull cloth.
 * The map holds occlusion in red, roughness in green and metal in blue.
 */
export function wearSurface(material, map) {
  material.roughnessMap = material.metalnessMap = material.aoMap = map;
  material.roughness = material.metalness = 1;
  material.aoMapIntensity = .8;
  return material;
}
