import { finishFootwear } from "./human-shoe-surface.js";
import * as T from "three";
import { analyse } from "./human-style-kit.js";
import { landmarks } from "./human-style-cloth.js";
import { outfits } from "./human-style-outfits.js";
import { hairstyles } from "./human-style-hair.js";
import { finishCloth } from "./human-cloth-swatch.js";
import { concealed } from "./human-style-conceal.js";

export const humanStyles = { hair: ["None", ...Object.keys(hairstyles)], outfit: ["None", ...Object.keys(outfits)] };
export const defaultHumanStyle = { hair: "None", outfit: "None", hairColor: "#45352e", clothColor: "#6f7f86" };

const find = (table, name) => Object.keys(table).find(key => key.toLowerCase() === String(name ?? "").trim().toLowerCase());
const clamp01 = x => Math.min(1, Math.max(0, x));

const skinLike = hue => hue > .94 || hue < .17;

export const toneFields = { clothSecond: "dark", clothLight: "light", accentColor: "accent", leatherColor: "leather", soleColor: "sole", metalColor: "metal" };

export function palette(style = {}) {
  const tones = derived(style.clothColor ?? defaultHumanStyle.clothColor);
  for (const [field, tone] of Object.entries(toneFields)) if (style[field]) tones[tone] = "#" + new T.Color(style[field]).getHexString();
  return tones;
}
function derived(clothColor) {
  const main = new T.Color(clothColor), hsl = main.getHSL({ h: 0, s: 0, l: 0 });
  const tone = (h, s, l) => "#" + new T.Color().setHSL((hsl.h + h + 1) % 1, clamp01(hsl.s * s), clamp01(l)).getHexString();
  return {
    main: "#" + main.getHexString(),
    dark: tone(.02, .8, hsl.l * .5 + .06),
    light: tone(-.02, .55, hsl.l * .45 + .52),
    accent: tone(skinLike((hsl.h + .5) % 1) ? (skinLike((hsl.h + .67) % 1) ? .33 : .67) : .5, .75, hsl.l * .5 + .14),
    leather: "#" + new T.Color("#5b4334").lerp(main, .12).getHexString(),
    sole: "#" + new T.Color("#2c2a28").lerp(main, .08).getHexString(),
    metal: "#8f9296",
  };
}

export function styleHuman(surface, style = {}, material = color => new T.MeshStandardMaterial({ color, roughness: .85 }), plain = false) {
  const hair = find(hairstyles, style.hair), outfit = find(outfits, style.outfit), meshes = [];
  if (!hair && !outfit) return Object.assign(meshes, { ground: 0 });
  const body = analyse(surface), m = landmarks(body);
  let ground = body.floor, helmet = false, hidden = new Set();
  if (outfit) {
    const worn = [];
    const tones = palette(style);
    for (const part of outfits[outfit](body, m)) {
      if (!part.piece.tri.length) continue;
      worn.push(part.piece);
      const base = material(tones[part.tone] ?? part.tone, part.type ?? "cloth"), mesh = part.piece.mesh(base, part.region, part.name);
      if (part.piece.clothJoints) mesh.humanWeights.clothJoints = part.piece.clothJoints;
      if (!plain) finishFootwear(mesh, part.piece.shoeUV);
      if (!plain) finishCloth(mesh, outfit, style, m, part.piece.clothGrid);
      if (!plain && part.piece.draped) {
        if (mesh.material === base) mesh.material = base.clone();
        mesh.material.userData.foldedCloth = true;
      }
      meshes.push(mesh);
      if (part.ground !== undefined) ground = Math.min(ground, part.ground);
      helmet ||= !!part.helmet;
    }
    hidden = concealed(body, worn);
  }
  if (hair) for (const part of hairstyles[hair](body, m, style)) {
    if (!part.piece.tri.length || helmet && part.loose) continue;
    meshes.push(part.piece.mesh(material(part.tone ?? style.hairColor ?? defaultHumanStyle.hairColor, part.type ?? "hair"), part.region ?? "head", part.name));
  }
  return Object.assign(meshes, { ground, hidden });
}
