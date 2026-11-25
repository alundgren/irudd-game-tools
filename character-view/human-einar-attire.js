// A weathered field coat, patched cargo trousers and work boots, adapted from the clothes of
// Einar Rig (CC-BY) Blender Foundation | studio.blender.org, CC BY 4.0.
//   einarClothes   outfit name -> the packed garments worn together
//   einarAssets    the packed garments, in the form human-library.js fits, rigs and dyes
//   einarCredit    the attribution a build or an export that uses them must carry
// The coat's missing left sleeve is the mirror of its right one. Each garment is the authored cloth with its
// folds, pockets, straps and hardware, its Blender material baked to colour, relief, roughness and metal maps.
// Repacked by the fit tools kept with the private source (docs/human-attire.md).
import assets from "./human-einar-attire-data.json" with { type: "json" };

export const einarAssets = assets;
export const einarOutfit = "Weathered field coat";
// The trousers go on first: the coat's hem lies over their belt and their cuffs over the boots.
export const einarClothes = { [einarOutfit]: ["einar_trousers", "einar_boots", "einar_coat"] };
export const einarCredit = "Einar Rig (CC-BY) Blender Foundation | studio.blender.org. Adapted for editable characters. https://studio.blender.org/characters/einar/v1/ · https://creativecommons.org/licenses/by/4.0/";
/** How often a new look of a direction wears the outfit, drawn from a stream of its own. */
export const einarShare = { Any: .03, Adventure: .14, Outdoors: .1 };
