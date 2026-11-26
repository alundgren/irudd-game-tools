import assets from "./human-attire-data.json" with { type: "json" };

export const attireAssets = assets;
export const attireClothes = {
  "Mail tunic and boots": ["viking_tunic", "viking_pants", "viking_boots"],
  "Rope-belted robe": ["monk_robe", "shoes01"],
};
export const everydayClothes = {
  "Shift dress": ["shift_dress", "shoes01"],
  "Rib knit and full skirt": ["full_skirt", "rib_sweater", "shoes01"],
};
export const bareLegged = new Set(Object.keys(everydayClothes));
export const attireCredits = Object.fromEntries(Object.entries({ ...attireClothes, ...everydayClothes }).map(([outfit, garments]) =>
  [outfit, garments.filter(garment => assets[garment]).map(garment => ({ garment, ...assets[garment].credit }))]));

export function wearSurface(material, map) {
  material.roughnessMap = material.metalnessMap = material.aoMap = map;
  material.roughness = material.metalness = 1;
  material.aoMapIntensity = .8;
  return material;
}
