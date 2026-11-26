// The accessory and hair styles an adult can wear, as plain names for the
// document's schema; the geometry lives in eyewear.ts, necklace.ts and hair.ts.

import type { GroomName } from "../groom.js";

export const eyewearStyles = ["None", "Round wire", "Square acetate", "Upswept frames"] as const;
export const necklaceStyles = ["None", "Teardrop pendant", "Pearl strand", "Fan collar"] as const;

/** Cuts grown as strands on the scalp (dress/strand-groom.ts), in G0's order. */
export const grownHairStyles = [
  "Tapered crop",
  "Horseshoe crop",
  "Close crop",
  "Buzz cut",
  "Crop",
  "Side part",
  "Swept back",
  "Ponytail",
  "Bun",
  "Braid",
] as const;
export type GrownHairStyle = (typeof grownHairStyles)[number];

/** Library hair styles whose authored groom the port fits. */
export const fittedHairStyles = [
  "Layered short",
  "Receding short",
  "Tied bun",
  "Long centre part",
  "Side-swept pixie",
  "Low ponytail",
] as const;
/** The groom each fitted hair style wears. */
export const fittedHairGrooms: Readonly<Record<(typeof fittedHairStyles)[number], GroomName>> = {
  "Layered short": "short_layered",
  "Receding short": "short_receding",
  "Tied bun": "bun_tied",
  "Long centre part": "long_centre",
  "Side-swept pixie": "pixie_swept",
  "Low ponytail": "ponytail_low",
};

/**
 * Ways to wear the hair that grows over the forehead (human-fringe.js at
 * 2761eb1). "As cut" leaves a style as it was made. Left and right are the
 * wearer's own.
 */
export const fringeStyles = [
  "As cut",
  "Parted",
  "Swept left",
  "Swept right",
  "Off the face",
] as const;

/**
 * Cloth designs a tailored outfit is woven in (clothDesigns in
 * human-cloth-swatch.js at 2761eb1, without the scallop brocade, which is not
 * woven for tailored pieces). "Plain cloth" and "Outfit swatch" leave tailored
 * cloth plain.
 */
export const tailoredClothDesigns = [
  "Plain cloth",
  "Outfit swatch",
  "Quiet weave",
  "Pinstripe",
  "Windowpane",
  "Breton stripe",
  "Herringbone",
  "Colour block",
  "Gingham",
  "Small dots",
  "Chest band",
  "Knit yoke",
  "Hem border",
] as const;
/** Designs a second piece may carry; "Plain cloth" leaves it in the quiet weave. */
export const secondClothDesigns = tailoredClothDesigns.filter((d) => d !== "Outfit swatch");
