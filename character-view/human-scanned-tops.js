// Everyday tops taken from 3D scans of real clothing on real people: HSRD-100 by Digital Reality Lab, CC BY 4.0.
//   scannedAssets    the packed garments, in the form human-library.js fits, rigs and dyes
//   scannedClothes   outfit name -> the packed garments worn together
//   scannedCredit    the attribution a build or an export that uses them must carry
// Each top is our own trunk and arm surface carried to its donor's pose and laid on the scanned cloth, so the
// folds, the ease and the outline are the garment's own while the seams, the joints and the fit are ours. Its
// colour and relief are the scan's. The trousers and shoes under them are garments the library already holds.
import assets from "./human-scanned-tops-data.json" with { type: "json" };

export const scannedAssets = assets;
// The trousers go on first, so the top's hem lies over their waistband.
export const scannedClothes = {
  "Crew sweatshirt and cargo trousers": ["einar_trousers", "shoes02", "crew_sweatshirt"],
  "Crew sweatshirt and trousers": ["viking_pants", "shoes02", "crew_sweatshirt"],
  "Cable V-neck and trousers": ["viking_pants", "shoes01", "cable_vneck"],
  "Cable V-neck and cargo trousers": ["einar_trousers", "shoes02", "cable_vneck"],
};
/** How often an ordinary outfit of a direction gives way to one of these, drawn from a stream of its own. */
export const scannedShare = { Any: .06, Everyday: .1, Outdoors: .06, Workwear: .05, Smart: .04 };
export const scannedCredit = "Scanned clothing adapted from HSRD-100 by Digital Reality Lab (CC BY 4.0). https://huggingface.co/datasets/digitalrealitylab/HSRD-100 | https://creativecommons.org/licenses/by/4.0/";
