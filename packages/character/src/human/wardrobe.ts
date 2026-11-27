import { type OutfitName } from "@irudd/document";
import { tailorProblems, type TailorLayer } from "./dress/tailor-data.js";
import { castSkin } from "./cast.js";
import { isCastFigureName, type CastFigureName } from "./cast-data.js";
import { castOutfits } from "./cast-wardrobe.js";
import { armInkStyles } from "./draw.js";
import { presetOutfitNames, type PresetOutfit } from "./dress/outfit-names.js";
import {
  finishingStyles,
  eyewearStyles,
  fittedHairStyles,
  fringeStyles,
  grownHairStyles,
  necklaceStyles,
  secondClothDesigns,
  tailoredClothDesigns,
} from "./dress/styles.js";
import { browStyles, type HumanAdultParams } from "./generator.js";
import { makeupStyles } from "./makeup.js";
import { randomStream } from "./identity.js";

type Style = HumanAdultParams["style"];
export const adultStyleOptions = {
  ...finishingStyles,
  hair: [...fittedHairStyles, ...grownHairStyles],
  fringe: fringeStyles,
  browStyle: browStyles,
  makeup: makeupStyles,
  armInk: armInkStyles,
  eyewear: eyewearStyles,
  necklace: necklaceStyles,
  outfit: ["None", ...presetOutfitNames],
  clothDesign: tailoredClothDesigns,
  secondDesign: secondClothDesigns,
} as const;
export const lookDirections = [
  "Any",
  "Everyday",
  "Smart",
  "Workwear",
  "Outdoors",
  "Festive",
  "Adventure",
] as const;
export type LookDirection = (typeof lookDirections)[number];
const outfitsByDirection: Record<LookDirection, readonly PresetOutfit[]> = {
  Any: presetOutfitNames,
  Everyday: [
    "T-shirt and jeans",
    "Hoodie and joggers",
    "Shirt and chinos",
    "Sweater and skirt",
    "Day dress",
    "Chore jacket",
  ],
  Smart: ["Shirt and chinos", "Sweater and skirt", "Day dress", "Overcoat"],
  Workwear: ["Coveralls", "Chore jacket", "Workshop apron"],
  Outdoors: ["Running kit", "Overcoat", "Traveller", "Explorer", "Parka"],
  Festive: ["Shirt and chinos", "Day dress", "Sweater and skirt"],
  Adventure: ["Traveller", "Explorer", "Leather armour"],
};

const framedLook = 0.5;
const skirtedOutfits: readonly string[] = ["Day dress", "Sweater and skirt"];
const clippedHair: readonly string[] = [
  "Horseshoe crop",
  "Receding short",
  "Buzz cut",
  "Close crop",
  "Tapered crop",
];

export function showOutfit(params: HumanAdultParams, show: boolean): HumanAdultParams {
  const style = params.style;
  const needsClothes =
    show && !style.cast && !style.tailor && (!style.outfit || style.outfit === "None");
  return {
    ...params,
    outfit: show ? "Work clothes" : "Anatomy",
    style: needsClothes ? { ...style, outfit: "T-shirt and jeans" } : style,
  };
}

export function chooseAdultStyle(
  params: HumanAdultParams,
  changes: Partial<Style>,
  clear?: keyof Style,
): HumanAdultParams {
  const style = { ...params.style, ...changes };
  if (clear) delete style[clear];
  if (changes.faceFamily && changes.faceFamily !== "None") delete style.cast;
  if ("cast" in changes || clear === "cast") {
    delete style.castTop;
    delete style.castBottom;
    delete style.castPigment;
    delete style.castShape;
    delete style.castSkin;
    const skin = style.cast && castSkin(style.cast);
    if (skin) style.castSkin = skin;
  }
  if (changes.castTop && style.cast && isCastFigureName(style.cast)) {
    const outfits = castOutfits(style.cast);
    const options = outfits.filter((item) => item.castTop === changes.castTop);
    if (
      options[0] &&
      !options.some((item) => item.castBottom === (style.castBottom ?? outfits[0]?.castBottom))
    )
      style.castBottom = options[0].castBottom;
  }
  if (changes.outfit) delete style.tailor;
  const next = { ...params, style };
  if (
    !changes.outfit &&
    !changes.cast &&
    (params.outfit === "Base layer" || params.outfit === "Pressure suit")
  )
    return next;
  return showOutfit(
    next,
    changes.outfit !== "None" &&
      Boolean(changes.cast || changes.outfit || params.outfit === "Work clothes"),
  );
}

function otherCastOutfits(cast: CastFigureName, style: Style) {
  const fits = castOutfits(cast);
  const top = style.castTop ?? fits[0]?.castTop;
  const bottom = style.castBottom ?? fits[0]?.castBottom;
  return fits.filter((outfit) => outfit.castTop !== top || outfit.castBottom !== bottom);
}

export function newHumanLook(
  params: HumanAdultParams,
  seed: number,
  direction: LookDirection,
): HumanAdultParams {
  const draw = randomStream(seed ^ 0x9e3779b9);
  function pick<T>(values: readonly T[]): T {
    const item = values[Math.floor(draw() * values.length)];
    if (item === undefined) throw new Error("No choices available for this look.");
    return item;
  }
  const style = params.style;
  const cast = style.cast && isCastFigureName(style.cast) ? style.cast : undefined;
  const fits = cast ? otherCastOutfits(cast, style) : [];
  const keepCast =
    cast &&
    ["Any", "Everyday", "Workwear", "Outdoors"].includes(direction) &&
    (fits.length > 0 || params.outfit !== "Work clothes");
  const frame = params.human["frame"] ?? 0;
  const fitting = <T extends string>(
    all: readonly T[],
    current: string | undefined,
    avoid: readonly string[],
  ) => {
    const fresh = all.filter((name) => name !== current);
    const framed = fresh.filter((name) => !avoid.includes(name));
    return framed.length ? framed : fresh;
  };
  const clothing = fitting(
    outfitsByDirection[direction],
    style.outfit,
    frame >= framedLook ? skirtedOutfits : [],
  );
  const hair = fitting(adultStyleOptions.hair, style.hair, frame <= -framedLook ? clippedHair : []);
  return {
    ...params,
    ...(cast && !keepCast && style.castSkin && params.outfit === "Work clothes"
      ? { skin: style.castSkin, sourceSkin: params.sourceSkin ?? params.skin }
      : {}),
    outfit: "Work clothes",
    style: {
      ...(keepCast
        ? {
            cast,
            ...(style.castSkin ? { castSkin: style.castSkin } : {}),
            ...(style.castShape !== undefined ? { castShape: style.castShape } : {}),
            ...(style.castPigment !== undefined ? { castPigment: style.castPigment } : {}),
            ...(fits.length ? pick(fits) : {}),
          }
        : {}),
      ...(style.armInk ? { armInk: style.armInk } : {}),
      ...(style.browStyle ? { browStyle: style.browStyle } : {}),
      outfit: pick(clothing),
      hair: pick(hair),
      fringe: pick(fringeStyles),
      hairColor: pick(
        (params.human["age"] ?? 0) > 0.62
          ? ["#9b948c", "#6c6862", "#68564b", "#4b3c36"]
          : ["#302725", "#44372f", "#72553d", "#a88659", "#995f47", "#504041", "#624535"],
      ),
      clothColor: pick([
        "#466068",
        "#81704f",
        "#603d4b",
        "#5b677b",
        "#51554b",
        "#894f37",
        "#596c60",
        "#967442",
        "#353e49",
        "#866e81",
      ]),
      clothDesign: pick(tailoredClothDesigns),
      makeup: draw() < (direction === "Festive" ? 0.65 : 0.19) ? pick(makeupStyles) : "None",
      eyewear: draw() < 0.24 ? pick(eyewearStyles) : "None",
      necklace: draw() < (direction === "Festive" ? 0.65 : 0.14) ? pick(necklaceStyles) : "None",
    },
  };
}

export function chooseAdultWardrobe(
  params: HumanAdultParams,
  outfit: OutfitName,
): HumanAdultParams {
  return outfit === "Work clothes" ? showOutfit(params, true) : { ...params, outfit };
}

export function tailorAdult(
  params: HumanAdultParams,
  layers: readonly TailorLayer[],
): HumanAdultParams {
  const problems = layers.length ? tailorProblems({ layers }) : [];
  if (problems.length) throw new Error(problems.join(" "));
  const { tailor: _old, ...style } = params.style;
  const next = { ...params, style: layers.length ? { ...style, tailor: { layers } } : style };
  return chooseAdultWardrobe(next, layers.length ? "Work clothes" : (params.outfit ?? "Anatomy"));
}
