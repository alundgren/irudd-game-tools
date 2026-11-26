// The Rocketbox cast an adult may be drawn as (character-view/human-cast-looks.js
// and the colour helpers of human-cast-wardrobe.js).

import { castPeople, type CastPerson } from "./catalogue.js";
import { randomStream } from "./identity.js";

export const castPerson = (name: string): CastPerson | undefined =>
  Object.hasOwn(castPeople, name) ? castPeople[name] : undefined;
export const castDonor = (name: string): string | undefined => castPerson(name)?.donor;

export function drawCastIdentity(
  human: { readonly earTip?: number; readonly frame?: number; readonly age?: number },
  seed: number,
): string | null {
  if ((human.earTip ?? 0) > 0.45) return null;
  const draw = randomStream(seed ^ 0x8658d12c);
  if (draw() >= 0.58 || Math.abs(human.frame ?? 0) < 0.18) return null;
  const rig = (human.frame ?? 0) < 0 ? "female" : "male";
  const age = human.age ?? 0.3;
  const options = Object.entries(castPeople).filter(
    ([, person]) => person.rig === rig && Math.abs(age - (person.age ?? 0.3)) <= 0.4,
  );
  if (!options.length || (options.length === 1 && draw() < 0.5)) return null;
  const weight = ([, person]: readonly [string, CastPerson]) =>
    1 / (0.12 + Math.abs(age - (person.age ?? 0.3))) ** 2;
  let at = draw() * options.reduce((sum, option) => sum + weight(option), 0);
  for (const option of options) {
    at -= weight(option);
    if (at <= 0) return option[0];
  }
  return options.at(-1)?.[0] ?? null;
}

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const hex = (tone: ReadonlyArray<number>) =>
  "#" +
  tone
    .map((v) =>
      Math.round(toSrgb(v) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");

/** The colour of a member's photographed face skin. */
export const castSkin = (name: string): string | null => {
  const person = castPerson(name);
  return person ? hex(person.tone) : null;
};

/** A skin colour for a drawn cast member: most keep the photographed skin. */
export function drawCastSkin(name: string, skin: string, seed: number, keep = 0.6): string | null {
  const original = castSkin(name);
  const person = castPerson(name);
  if (!original || !person || !/^#[0-9a-f]{6}$/i.test(skin)) return original;
  if (randomStream((seed ^ 0x2b7e1516) >>> 0)() < keep) return original;
  const tone = person.tone,
    wanted = [1, 3, 5].map((i) => toLinear(parseInt(skin.slice(i, i + 2), 16) / 255));
  const light = (c: ReadonlyArray<number>) =>
    0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
  if (light(wanted) === 0) return hex(tone.map((v) => 0.4 * v));
  const ratio = light(wanted) / light(tone),
    held = Math.min(1.45, Math.max(0.4, ratio)) / ratio;
  return hex(
    wanted.map((value, k) => {
      const v = Math.max(value, 1e-6),
        balance = v / light(wanted) / ((tone[k] ?? 0) / light(tone));
      return Math.min(1, (v * held * Math.min(1.5, Math.max(1 / 1.5, balance))) / balance);
    }),
  );
}
