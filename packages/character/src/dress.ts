// How each body region is dressed for an outfit. Ported from fitWardrobe in
// character-view/wardrobe.js at 2761eb1: a base layer or pressure suit
// refits each region with a clothing role, easing it in or out and
// recolouring it. Pure, so views can tell which sheets an outfit needs.

import {
  digestBrand,
  type Appearance,
  type Digest,
  type OutfitName,
  type OutfitRoleName,
  type OutfitWear,
} from "@irudd/document";

/** What a fit reads of a view (a `BuildView`). */
interface Dressed {
  readonly outfit: OutfitName;
  readonly appearance: Appearance | undefined;
  readonly parts: ReadonlyArray<Worn>;
}

/** What a fit reads of a part (a `BuildPart`). */
interface Worn {
  readonly wear: OutfitWear;
}

const dyes: Readonly<Record<Appearance["palette"], readonly [string, string, string]>> = {
  Tide: ["#536c60", "#c0824b", "#bdc8b6"],
  Ochre: ["#a88b58", "#49635c", "#d3c8a8"],
  Clay: ["#955b4c", "#d5a861", "#d0bba6"],
  Polar: ["#718f99", "#c88e54", "#c6d6d1"],
};

/** How one region is dressed in the view's outfit. */
export interface RegionFit {
  readonly role: OutfitRoleName;
  /** A pressure suit, which carries equipment and the expedition textile. */
  readonly suit: boolean;
  /** The region keeps its own surface and paint. */
  readonly preserve: boolean;
  /** The region is left as bare skin. */
  readonly bare: boolean;
  /** Skirts and accessories are not worn with the outfit. */
  readonly hide: boolean;
  readonly color: string;
  /** Radial ease: sweep knot radii, or the primitive's horizontal scale. */
  readonly amount: number;
  readonly cloth: string;
  readonly trim: string;
  readonly panel: string;
}

const suitOnBody: Partial<Record<OutfitRoleName, number>> = {
  torso: 1.2,
  "upper arm": 1.42,
  forearm: 1.5,
  thigh: 1.3,
  shin: 1.5,
  foot: 1.32,
};
const layerOnBody: Partial<Record<OutfitRoleName, number>> = {
  torso: 1.035,
  "upper arm": 1.06,
  thigh: 1.05,
  foot: 1.12,
};
const suitOverClothes: Partial<Record<OutfitRoleName, number>> = {
  torso: 1.16,
  "upper arm": 1.22,
  forearm: 1.23,
  hand: 1.18,
  thigh: 1.16,
  shin: 1.23,
  foot: 1.14,
};
const layerOverClothes: Partial<Record<OutfitRoleName, number>> = {
  torso: 0.9,
  "upper arm": 0.85,
  forearm: 0.85,
  shin: 0.84,
  thigh: 0.89,
  foot: 0.88,
};

/**
 * How `part` is dressed in the view's outfit, or nothing when the outfit
 * leaves regions as authored (Anatomy, Work clothes) or the part has no
 * clothing role.
 */
export function regionFit(view: Dressed, part: Worn): RegionFit | undefined {
  const role = part.wear.role;
  if (view.outfit === "Anatomy" || view.outfit === "Work clothes" || !role) return undefined;
  const appearance = view.appearance;
  if (!appearance)
    throw new Error(`A character dressed in ${view.outfit} needs an appearance for its dyes.`);
  const suit = view.outfit === "Pressure suit";
  const [cloth, trim, panel] = dyes[appearance.palette];
  const tones = appearance.tones;
  const dyed = {
    cloth: tones?.cloth ?? cloth,
    trim: tones?.trim ?? trim,
    panel: tones?.panel ?? panel,
  };
  const preserve = role === "head" || role === "tail" || (!suit && role === "hand");
  const bare = !suit && (role === "forearm" || role === "shin");
  const hide = role === "skirt" || role === "accessory";
  const color = bare
    ? appearance.skin
    : role === "foot" || role === "hand"
      ? "#384341"
      : suit
        ? dyed.cloth
        : role === "thigh" || role === "upper arm" || role === "torso"
          ? "#364b48"
          : "#535c58";
  // A bare region is the body itself, so clothing sits on it with ease
  // instead of being cut down from a clothed surface.
  const amount = preserve
    ? 1
    : part.wear.bare
      ? suit
        ? (suitOnBody[role] ?? 1.2)
        : bare
          ? 1
          : (layerOnBody[role] ?? 1.03)
      : suit
        ? (suitOverClothes[role] ?? 1.1)
        : (layerOverClothes[role] ?? 1);
  return { role, suit, preserve, bare, hide, color, amount, ...dyed };
}

/** The bundled expedition suit sheet (`expedition.atlas.webp`) the pressure suit is cut from. */
export const expeditionAtlas: Digest = digestBrand(
  "sha256:90eda5840127e933ca4df505079c11e5bc174744031f11592ae2585cbd83c221",
);

/** Regions the pressure suit dresses in the expedition textile. */
export const expeditionRoles: ReadonlySet<OutfitRoleName> = new Set([
  "torso",
  "head",
  "upper arm",
  "forearm",
  "hand",
  "thigh",
  "shin",
  "foot",
  "pelvis",
]);

/** Whether the view wears the expedition textile anywhere. */
export const wearsExpedition = (view: Dressed): boolean =>
  view.parts.some((part) => {
    const fit = regionFit(view, part);
    return Boolean(fit?.suit && !fit.preserve && expeditionRoles.has(fit.role));
  });
