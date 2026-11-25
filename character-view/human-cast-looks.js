import { castOutfitSubjects } from "./human-cast-wardrobe.js";
import catalog from "./human-cast-catalog.json" with { type: "json" };
import { randomStream } from "./random.js";

export const castStyles = ["None", ...Object.keys(catalog.people)];
export const castSubject = (name) => Object.hasOwn(catalog.people, name) ? catalog.people[name].subject : null;

export const castDonor = name => catalog.people[name]?.donor;

export function castSources(form) {
  const name = wornCast(form);
  if (!name) return [];
  const donor = castDonor(name);
  const sources = [castSubject(name), ...castOutfitSubjects(name, form.humanStyle)];
  if (donor && (form.humanStyle.castShape || form.humanStyle.castPigment)) sources.push(donor);
  return [...new Set(sources)];
}

export function wornCast(form) {
  const name = form.humanStyle?.cast;
  if (!castSubject(name) || form.outfit !== "Work clothes" || !form.parts) return null;
  // Partial component bodies and replacement heads still use their individual regions.
  const regions = form.parts.filter(p => p.shape === "human region");
  if (regions.length !== catalog.bones.length ||
      regions.some(p => p.humanSource || p.nativePortrait)) return null;
  return name;
}

export function castWardrobeFits(direction, look) {
  return ["Any", "Everyday", "Workwear", "Outdoors"].includes(direction) &&
    look.outfit === "Work clothes" && !look.style.armour;
}

export function drawCastIdentity(human, seed) {
  if ((human.earTip ?? 0) > .45) return null;
  const draw = randomStream(seed ^ 0x8658d12c);
  if (draw() >= .58 || Math.abs(human.frame ?? 0) < .18) return null;
  const rig = human.frame < 0 ? "female" : "male";
  const age = human.age ?? .3;
  // Body warps preserve the photographed skin. Keep the native ageing system when
  // the cast has no source in a comparable age range.
  const options = Object.entries(catalog.people).filter(([, person]) =>
    person.rig === rig && Math.abs(age - (person.home.age ?? .3)) <= .4);
  if (!options.length || (options.length === 1 && draw() < .5)) return null;
  const weight = ([, person]) => 1 / (.12 + Math.abs(age - (person.home.age ?? .3))) ** 2;
  let at = draw() * options.reduce((sum, option) => sum + weight(option), 0);
  for (const option of options) {
    at -= weight(option);
    if (at <= 0) return option[0];
  }
  return options.at(-1)[0];
}
