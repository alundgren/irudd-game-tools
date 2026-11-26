import assets from "./human-scanned-tops-data.json" with { type: "json" };

export const scannedAssets = assets;
export const scannedClothes = {
  "Crew sweatshirt and cargo trousers": ["einar_trousers", "shoes02", "crew_sweatshirt"],
  "Crew sweatshirt and trousers": ["viking_pants", "shoes02", "crew_sweatshirt"],
  "Cable V-neck and trousers": ["viking_pants", "shoes01", "cable_vneck"],
  "Cable V-neck and cargo trousers": ["einar_trousers", "shoes02", "cable_vneck"],
};
export const scannedShare = { Any: .06, Everyday: .1, Outdoors: .06, Workwear: .05, Smart: .04 };
export const scannedCredit = "Scanned clothing adapted from HSRD-100 by Digital Reality Lab (CC BY 4.0). https://huggingface.co/datasets/digitalrealitylab/HSRD-100 | https://creativecommons.org/licenses/by/4.0/";
