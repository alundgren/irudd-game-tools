import type { GroomName } from "../groom.js";

export const finishingStyles = {
  faceFamily: ["None", "Angular", "Soft", "Studio Rain"],
  faceFamilyHair: ["Family", "Chosen"],
  facePlanes: ["None", "Subtle", "Sculpted"],
  facialHair: ["None", "Clipped beard", "Stubble", "Moustache", "Short beard", "Full beard"],
  earrings: [
    "None",
    "Pearl studs",
    "Hammered hoops",
    "Enamel drops",
    "Single ear pendant",
    "Sea fan ear cuffs",
    "Hoops",
  ],
  waistBag: ["None", "Dispatch folio", "Running belt"],
  handProp: ["None", "Painted folding fan"],
  hat: ["None", "Bucket hat", "Beret", "Flat cap", "Ribbed watch cap", "Flying cap and goggles"],
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
  "Sleek bob",
  "Curled-under bob",
  "Angled bob",
  "Fringed bob",
  "Loose waves",
  "Layered short",
  "Receding short",
  "Tied bun",
  "Long centre part",
  "Side-swept pixie",
  "Low ponytail",
] as const;
export const fittedHairGrooms: Readonly<Record<(typeof fittedHairStyles)[number], GroomName>> = {
  "Sleek bob": "bob_blunt",
  "Curled-under bob": "bob_curled",
  "Angled bob": "bob_inverted",
  "Fringed bob": "bob_blunt_fringe",
  "Loose waves": "cloud_waves",
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
  "Scallop brocade",
] as const;
export const secondClothDesigns = tailoredClothDesigns.filter((d) => d !== "Outfit swatch");

export const adultHairStyles = [
  "None",
  "Buzz cut",
  "Crop",
  "Side part",
  "Swept back",
  "Curls",
  "Afro",
  "Bob",
  "Long",
  "Wavy",
  "Ponytail",
  "Bun",
  "Braid",
  "Swept crop",
  "Rounded bob",
  "Crown braid",
  "Natural curls",
  "Blunt bob",
  "Low ponytail",
  "Long centre part",
  "Side-swept pixie",
  "Loose waves",
  "Layered short",
  "Receding short",
  "Sleek bob",
  "Fringed bob",
  "Angled bob",
  "Curled-under bob",
  "Tied bun",
  "Coiled crop",
  "Rounded coils",
  "Tapered crop",
  "Horseshoe crop",
  "Close crop",
  "Sculpted crop",
  "Sculpted bob",
  "Sculpted tie-back",
  "Fringed ponytail",
  "Feathered pixie",
  "Ribbon ponytail",
  "Silver side part",
  "Feathered dark crop",
] as const;
