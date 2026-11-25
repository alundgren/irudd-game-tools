import {productionStyles, productionHair} from "./human-production-hair.js";
import {fittedFan,handProps,wornHandProp} from "./human-hand-fan.js";
import { browStyles } from "./human-brow-styles.js";
import { bakeGameFolds } from "./human-fold-bake.js";
import { humanStyles, styleHuman, toneFields } from "./human-style.js";
import { randomStream } from "./random.js";
import { additionalHair, libraryClothes, libraryHair, libraryPieces } from "./human-library.js";
import {coilStyles,coilGroom} from "./human-coils.js";
import { groomStyles, grownStyles, strandGroom } from "./human-groom.js";
import { sculptedHair, sculptedStyles } from "./human-sculpt-hair.js";
import { facePlaneStyles } from "./human-face-planes.js";
import { studioHeadStyles, studioHairStyles, studioFamilyHair, studioHairFor } from "./human-studio-head.js";
import { scanHairStyles, scanHair } from "./human-scan-hair.js";
import { tailorHuman, tailorProblems } from "./human-tailor.js";
import { armourTailor, validArmour } from "./human-armour.js";
import { fringeStyles } from "./human-fringe.js";
import { armInkStyles } from "./human-arm-ink.js";
import { drawnMakeupStyles, makeupStyles, stageMakeupStyles } from "./human-makeup.js";
import { eyewearStyles, fittedEyewear } from "./human-eyewear.js";
import { fittedWaistBag, waistBagStyles } from "./human-waist-bag.js";
import { fittedNecklace, necklaceStyles } from "./human-necklace.js";
import { earringStyles, fittedEarrings } from "./human-earrings.js";
import { clothDesigns, finishTailored, secondDesigns } from "./human-cloth-swatch.js";
import { completeLook, lookFields } from "./human-looks.js";
import { facialHairNames } from "./human-face-hair.js";
import { drawWornMarks, wearFaceMarks } from "./human-face-marks.js";
import { drawHat, fittedHat, hatStyles } from "./human-hats.js";
import { castBottoms, castPieces, castSkin, castOutfitProblems, drawCastOutfit } from "./human-cast-wardrobe.js";
import { castStyles, castWardrobeFits } from "./human-cast-looks.js";
export const adultStyles = {
  cast: castStyles,
  castTop: Object.keys(castPieces.top),
  castBottom: Object.keys(castPieces.bottom),
  hair: [...humanStyles.hair, ...Object.keys(libraryHair),...coilStyles, ...groomStyles, ...sculptedStyles, ...productionStyles, ...studioHairStyles, ...scanHairStyles],
  outfit: [...humanStyles.outfit, ...Object.keys(libraryClothes)],
  // How hair over the forehead is worn. A look saved without one is "As cut".
  fringe: fringeStyles,
  eyewear: eyewearStyles,
  makeup: makeupStyles,
  browStyle: browStyles,
  armInk: armInkStyles,
  earrings: earringStyles,
  necklace: necklaceStyles,
  waistBag: waistBagStyles,
  handProp: handProps,
  // Fitted to the head and worn over the hair. A look saved without one is "None".
  hat: hatStyles,
  clothDesign: clothDesigns,
  // The design of the outfit's other large piece. A look saved without one leaves it in the quiet weave.
  secondDesign: secondDesigns,
  // Grown from the face itself. A look saved without one is "None".
  facialHair: facialHairNames,
  // Opt-in sculptural facial plane definition. Omitted or "None" keeps smooth normals.
  facePlanes: facePlaneStyles,
  // A head made by a studio artist, worn with its own eyes, brows, lashes and hair. Omitted or "None" is the native face.
  faceFamily: studioHeadStyles,
  // Whose hair a face family wears. Omitted or "Family" is the hair made for it; "Chosen" is the hairstyle named in `hair`.
  faceFamilyHair: studioFamilyHair,
};
/**
 * A style with some choices changed. Choosing a preset outfit puts away pieces tailored one
 * by one and an armour set, because they would hide it; every other change keeps them.
 */
export function chooseAdultStyle(style = {}, choices = {}) {
  if (choices.faceFamily && choices.faceFamily !== "None" && style.cast && !Object.hasOwn(choices, "cast"))
    choices = {...choices, cast: "None"};
  if (choices.cast && choices.cast !== style.cast) {
    const { castTop, castBottom, castSkin: previousSkin, ...withoutOutfit } = style;
    const tone = castSkin(choices.cast);
    if (tone && !choices.castSkin) choices = { ...choices, castSkin: tone };
    style = withoutOutfit;
  }
  if (choices.castTop) {
    const bottoms = castBottoms(choices.cast ?? style.cast, choices.castTop);
    if (bottoms.length && !bottoms.includes(choices.castBottom ?? style.castBottom))
      choices = {...choices, castBottom: bottoms[0]};
  }
  const { tailor, armour, ...rest } = style;
  return { ...("outfit" in choices && !("tailor" in choices) && !("armour" in choices) ? rest : style), ...choices };
}
// Dress the current identity with a complete look. The anatomy and skin tone stay
// usable as separate edits, and the chosen assets and colours are saved in the recipe.
// `direction` is one of lookDirections and leans the wardrobe and palette one way; "Any" draws from everything.
// What a drawn style is worn as: grooms combed by an artist and fitted to the head, where the library has one
// for the cut. Each entry lists the grooms a draw chooses between and how often the draw takes one of them.
const bobs = ["Sleek bob", "Curled-under bob", "Angled bob", "Fringed bob"], shortCuts = ["Layered short", "Layered short", "Side-swept pixie", "Feathered pixie"];
const fittedVariants = {
  Bob: [bobs, .9], "Rounded bob": [bobs, .9], Ponytail: [["Low ponytail", "Fringed ponytail"], 1], Bun: [["Tied bun"], 1],
  Long: [["Long centre part", "Long centre part", "Loose waves"], 1], Wavy: [["Loose waves", "Long centre part"], .9], "Side part": [shortCuts, .85], "Swept back": [shortCuts, .85],
  Crop: [["Layered short"], .6], "Swept crop": [["Layered short"], .6],
};
/** Every hair a draw of `drawn` may wear: the fitted grooms listed for it, and the drawn style itself where some draws keep it. */
export function hairWornFor(drawn) {
  const variant = fittedVariants[drawn], own = drawn === "Swept crop" ? "Tapered crop" : drawn;
  if (!variant) return [own];
  return [...new Set([...variant[0], ...(variant[0].includes("Layered short") ? ["Receding short", "Horseshoe crop"] : []), ...(variant[1] < 1 ? [own] : [])])];
}
/** The hair a draw wears for the style it drew. With age a short cut on a broad frame is often receding. */
function fittedHair(drawn, form, seed) {
  const chance = randomStream(seed ^ 0x6c8f25a1), variant = fittedVariants[drawn];
  if (!variant || chance() >= variant[1]) return drawn === "Swept crop" ? "Tapered crop" : drawn;
  const hair = variant[0][Math.floor(chance() * variant[0].length)];
  if (hair === "Layered short" && form.human.age > .5 && (form.human.frame ?? 0) > -.2 && chance() < .6)
    return form.human.age > .68 && chance() < .55 ? "Horseshoe crop" : "Receding short";
  return hair;
}

export function dressHuman(form, seed, direction = "Any") {
  const draw = randomStream(seed),
    pick = (list) => list[Math.floor(draw() * list.length)];
  const outfit = pick(adultStyles.outfit.filter((x) => x !== "None"));
  // The draw is over the styles it has always had, so a seed keeps its place in the list and every later
  // choice. What it wears for the drawn style is chosen from a stream of its own (fittedHair); the drawn
  // styles stay styles to choose by hand, and a saved look keeps the hair it names.
  const drawn = pick(adultStyles.hair.filter((x) => !productionStyles.includes(x) && !studioHairStyles.includes(x) && !scanHairStyles.includes(x) && !groomStyles.includes(x) && !sculptedStyles.includes(x) && !Object.hasOwn(additionalHair, x))),
    hair = fittedHair(drawn, form, seed);
  const hairColor = pick(
    (form.human.age ?? 0) > 0.62
      ? ["#9b948c", "#6c6862", "#a8a199", "#68564b", "#4b3c36", "#cfbfa8"]
      : [
          "#302725",
          "#44372f",
          "#72553d",
          "#a88659",
          "#995f47",
          "#504041",
          "#624535",
        ],
  );
  const clothColor = pick([
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
  ]);
  // Drawn last, so earlier seeds keep their outfit, hair and colours. A new look never hides the eyes.
  const fringe = pick(["Parted", "Swept left", "Swept right"]);
  // Facial hair comes after everything else for the same reason. It is common on broad frames,
  // occasional in between and left off slight ones; the editor offers every style to every frame.
  const frame = form.human.frame ?? 0,
    grown = draw() < (frame > 0.3 ? 0.5 : frame > -0.3 ? 0.12 : 0),
    kind = pick(["Stubble", "Stubble", "Short beard", "Clipped beard", "Full beard", "Moustache"]),
    facialHair = grown ? kind : "None";
  // Worn face marks are drawn last of all. Freckles, spots and scars belong to the person and stay.
  const worn = drawWornMarks(draw),
    eyewear = draw() < .24 ? pick(eyewearStyles.slice(1)) : "None";
  // What is worn (the wardrobe, its colours, materials and details) is chosen together in human-looks.js from a
  // stream of its own, so every draw above stays as it was. The outfit and cloth colour drawn above are no longer used.
  const look = completeLook(form, seed, direction),
    kept = Object.fromEntries(Object.entries(form.humanStyle ?? {}).filter(([key]) => !lookFields.includes(key) && key !== "hat" && key !== "hatColor"));
  // The hat belongs to the look: it is drawn for the wardrobe and takes one of its tones.
  const hat = look.outfit === "Pressure suit" ? { hat: "None" } : drawHat(seed, direction, look, hair);
  const evening = direction === "Festive" || ["Evening gown", "Draped bodice gown"].includes(look.style.outfit);
  const cosmetics = randomStream(seed ^ 0x6c279a05);
  const makeupPool = evening ? drawnMakeupStyles : drawnMakeupStyles.filter((m) => !stageMakeupStyles.includes(m));
  const standingBeard = ["Short beard", "Clipped beard", "Full beard"].includes(facialHair);
  const makeup =
    (evening || !standingBeard) && cosmetics() < (direction === "Festive" ? .65 : .19)
      ? makeupPool[Math.floor(cosmetics() * makeupPool.length)]
      : "None";
  const jewelleryChance = direction === "Festive" ? .7 : direction === "Smart" ? .42 : .28;
  const adorn = randomStream(seed ^ 0x54183ba0);
  const necklace = look.style?.armour || look.outfit === "Pressure suit" ? "None"
    : adorn() < (direction === "Festive" ? .65 : direction === "Smart" ? .35 : .14)
      ? necklaceStyles[1 + Math.floor(adorn()*(necklaceStyles.length-1))] : "None";
  const bagDraw = randomStream(seed ^ 0x7fc24819)();
  let waistBag = "None";
  if (bagDraw < .43 && ["Running kit", "Track top and leggings"].includes(look.style.outfit))
    waistBag = "Running belt";
  if (bagDraw < .28 && ["Field jacket and denim", "Striped shirt and jeans", "Workshop overalls", "Explorer", "Rolled bomber and cuffed trousers", "Bomber and wide trousers"].includes(look.style.outfit))
    waistBag = "Dispatch folio";
  const fanDraw = randomStream(seed ^ 0x357ae124)();
  const gown = ["Evening gown", "Draped bodice gown"].includes(look.style.outfit);
  const handProp = !look.style.armour && look.outfit !== "Pressure suit" &&
    fanDraw < (gown ? .34 : direction === "Festive" ? .12 : 0) ? "Painted folding fan" : "None";
  const earrings = look.outfit !== "Pressure suit" && draw() < jewelleryChance
    ? pick(earringStyles.filter(name => name !== "None" && (evening || name !== "Sea fan ear cuffs"))) : "None";
  if (kept.cast && kept.cast !== "None") {
    delete kept.castTop;
    delete kept.castBottom;
    if (castWardrobeFits(direction, look)) Object.assign(kept, drawCastOutfit(kept.cast, seed));
    else { kept.cast = "None"; delete kept.castSkin; }
  }
  return {
    // Worn paint takes a colour of the clothes.
    ...wearFaceMarks(form, [...worn.map((mark) => (mark.tone ? { ...mark, tone: look.paint } : mark)), ...look.marks]),
    outfit: look.outfit,
    humanStyle: { ...kept, ...look.style, makeup, hair, hairColor, fringe, facialHair, eyewear, earrings, necklace, waistBag, handProp, ...hat },
  };
}
export function adultStyleProblems(style) {
  if (!style || Array.isArray(style) || typeof style !== "object") return ["Use a humanStyle object."];
  const problems = [];
  for (const [key, value] of Object.entries(style)) {
    if (Object.hasOwn(adultStyles, key)) {
      if (!adultStyles[key].includes(value)) problems.push(key + " accepts " + adultStyles[key].join(", ") + ".");
    } else if (key === "castShape" || key === "castPigment") {
      if (!Number.isFinite(value) || value < 0 || value > 1) problems.push(key + " must be between 0 and 1.");
    } else if (key === "tailor") {
      problems.push(...tailorProblems(value));
    } else if (key === "armour") {
      if (validArmour(value)) problems.push(...tailorProblems(armourTailor(value)));
      else problems.push("Armour needs a listed look, a seed from 0 to 999999 and optional named piece overrides.");
    } else if (["hairColor", "hatColor", "clothColor", "clothAccent", "castSkin", ...Object.keys(toneFields)].includes(key)) {
      if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) problems.push(key + " needs a six-digit hex colour.");
    } else {
      problems.push("Unknown humanStyle field " + key + ".");
    }
  }
  return problems.concat(castOutfitProblems(style.cast, style));
}
export function validAdultStyle(style) {
  return !adultStyleProblems(style).length;
}
export function dressedHuman(s, form, material, plain, gameBudget=0) {
  const style = { ...form.humanStyle, handProp: wornHandProp(form) };
  if (form.outfit === "Anatomy") style.outfit = "None";
  else if (form.outfit === "Base layer") style.outfit = "Running kit";
  else if (form.outfit === "Pressure suit")
    style.outfit = humanStyles.outfit.includes("Pressure suit")
      ? "Pressure suit"
      : "Explorer";
  else if (!style.outfit || style.outfit === "None")
    style.outfit = "Field jacket and denim";
  if(style.outfit==="Pressure suit" && ["Crown braid","Rounded bob","Blunt bob","Low ponytail","Long centre part"].includes(style.hair))
    style.hair="Crop";
  // An outfit tailored piece by piece replaces the preset in ordinary clothes. An armour set is such an outfit
  // named by its look and seed; pieces written out one by one come first.
  if (!style.tailor && style.armour) style.tailor = armourTailor(style.armour);
  const tailored =
    style.tailor && !["Anatomy", "Base layer", "Pressure suit"].includes(form.outfit)
      ? tailorHuman(s, style.tailor, material, plain ? null : (meshes, m) => finishTailored(meshes, style, m), { game: gameBudget > 0, plain })
      : [];
  if (tailored.length) style.outfit = "None";
  // Hair that is grown as strands is left out of the sculpted styles, which would cover it with a shell.
  const grown = grownStyles.includes(style.hair) || productionStyles.includes(style.hair) || studioHairStyles.includes(style.hair) || scanHairStyles.includes(style.hair);
  const styled = styleHuman(s, grown ? { ...style, hair: "None" } : style, material, plain),
    parts = [...tailored, ...styled],
    // A style grown as curls keeps the name it had as a library groom and is no longer worn from the library.
    library = libraryPieces(s, grown && libraryHair[style.hair] ? { ...style, hair: "None" } : style, material, plain, gameBudget > 0, form.appearance.skin);
  // A game model grows coils as tufts, which it can carry; at full detail they are their own tubes.
  if (gameBudget > 0 && !plain) for (const piece of parts) bakeGameFolds(piece);
  const groom=[...scanHair(s,style,material,plain,form.appearance.skin),...studioHairFor(s,style,material,plain),...productionHair(s,style,material,plain,form.appearance.skin),...(gameBudget>0&&coilStyles.includes(style.hair)?[]:coilGroom(s,style,material,plain,form.appearance.skin,gameBudget)),...strandGroom(s,style,material,plain,form.appearance.skin,gameBudget,{tucked:style.outfit==="Pressure suit"}),...sculptedHair(s,style,material,plain,form.appearance.skin,gameBudget)];
  // Skin under tailored cloth and under a preset outfit is left out, as it is under library clothing.
  const hidden = tailored.hidden?.size || styled.hidden?.size ? new Set([...library.hidden, ...(tailored.hidden ?? []), ...(styled.hidden ?? [])]) : library.hidden;
  const eyewear = fittedEyewear(s, style.eyewear, material, plain);
  const earrings = style.outfit === "Pressure suit" ? [] : fittedEarrings(s, style, material, plain);
  const necklace = style.outfit === "Pressure suit" ? [] : fittedNecklace(s, style, [...parts,...library], material, plain);
  const bag = form.outfit === "Anatomy" || style.outfit === "Pressure suit" ? [] : fittedWaistBag(s, style, [...parts,...library], material, plain);
  // A hat presses the hair it covers, so it is fitted last, over every kind of hair.
  const headHair = [...styled, ...library, ...groom].filter(mesh => mesh.userData.styleRegion === "head");
  const hat = style.outfit === "Pressure suit" ? [] : fittedHat(s, style, headHair, material, plain);
  return Object.assign([...parts, ...library, ...groom, ...eyewear, ...earrings, ...necklace, ...bag, ...hat, ...fittedFan(s,style,material,plain)], { hidden });
}
