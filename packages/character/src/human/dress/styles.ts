import type { GroomName } from "../groom.js";

export const finishingStyles = {
  faceFamily: ["None", "Angular", "Soft", "Studio Rain"],
  faceFamilyHair: ["Family", "Chosen"],
  facePlanes: ["None", "Subtle", "Sculpted"],
  facialHair: ["None", "Moustache", "Short beard"],
  earrings: ["None", "Hoops", "Single ear pendant"],
  waistBag: ["None", "Dispatch folio", "Running belt"],
  handProp: ["None", "Painted folding fan"],
  hat: ["None", "Bucket hat", "Beret"],
} as const;

export const eyewearStyles = ["None", "Round wire", "Square acetate", "Upswept frames"] as const;
export const necklaceStyles = ["None", "Teardrop pendant", "Pearl strand", "Fan collar"] as const;

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

export const fittedHairStyles = [
  "Layered short",
  "Receding short",
  "Tied bun",
  "Long centre part",
  "Side-swept pixie",
  "Low ponytail",
] as const;
export const fittedHairGrooms: Readonly<Record<(typeof fittedHairStyles)[number], GroomName>> = {
  "Layered short": "short_layered",
  "Receding short": "short_receding",
  "Tied bun": "bun_tied",
  "Long centre part": "long_centre",
  "Side-swept pixie": "pixie_swept",
  "Low ponytail": "ponytail_low",
};

export const fringeStyles = [
  "As cut",
  "Parted",
  "Swept left",
  "Swept right",
  "Off the face",
] as const;

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
export const secondClothDesigns = tailoredClothDesigns.filter((d) => d !== "Outfit swatch");
