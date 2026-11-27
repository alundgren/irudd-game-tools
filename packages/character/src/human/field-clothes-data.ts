import { panelDyes } from "./dress/library-dyes.js";
import { readPack, type EntrySpec } from "./pack.js";

const spec: Record<string, EntrySpec> = {
  brocade: { kind: "u8", elements: 144 * 144 },
  devices: { kind: "u8", elements: 512 * 512 },
};
const growth = ["growth.moustache", "growth.chin", "growth.side"] as const;
for (const key of growth) spec[key] = { kind: "u8", elements: 180 * 197 };
const channels: Readonly<Record<string, readonly string[]>> = {
  male_casualsuit05: ["texture", "normal", "occlusion"],
  shoes02: ["texture"],
  male_worksuit01: ["texture", "normal", "occlusion"],
  male_elegantsuit01: ["texture"],
  shoes01: ["texture", "normal"],
  female_elegantsuit01: ["texture", "normal", "occlusion"],
  male_casualsuit01: ["texture", "normal", "occlusion"],
  male_casualsuit03: ["texture", "normal", "occlusion"],
  female_sportsuit01: ["texture", "normal", "occlusion"],
  shoes05: ["texture"],
  viking_tunic: ["texture", "normal", "surface"],
  viking_pants: ["texture", "normal", "surface"],
  viking_boots: ["texture", "normal", "surface"],
  monk_robe: ["texture", "normal", "surface"],
  shift_dress: ["texture", "normal", "surface"],
  full_skirt: ["texture", "normal", "surface"],
  rib_sweater: ["texture", "normal", "surface"],
  einar_trousers: ["texture", "normal", "surface"],
  einar_boots: ["texture", "normal", "surface"],
  einar_coat: ["texture", "normal", "surface"],
  expedition_vest: ["texture", "normal", "surface"],
  hoodie_shorts: ["texture", "normal", "surface"],
  crew_sweatshirt: ["texture", "normal", "surface"],
  cable_vneck: ["texture", "normal", "surface"],
};
const names = Object.keys(channels);
for (const name of names) {
  if (panelDyes[name]) spec[name + ".panels"] = { kind: "u8" };
  for (const key of ["refs", "uv", "corners", "uvCorners", "hide"])
    spec[name + "." + key] = { kind: "u16" };
  for (const key of ["weights", "offsets"]) spec[name + "." + key] = { kind: "f32" };
  for (const key of channels[name] ?? []) {
    spec[name + "." + key] = { kind: "u8" };
    spec[name + "." + key + ".size"] = { kind: "u16", elements: 2 };
  }
}
export async function readFieldClothes(bytes: Uint8Array) {
  const pack = await readPack(bytes, spec, "human-field-clothes.bin");
  const fieldClothing = names.map((name) => {
    const image = (channel: string) => {
      const key = name + "." + channel,
        [width, height] = pack.u16(key + ".size"),
        pixels = pack.u8(key);
      if (!width || !height || width * height * 4 !== pixels.length)
        throw new Error("Invalid field clothing image " + key + ".");
      return { width, height, pixels };
    };
    return {
      record: {
        name,
        panels: panelDyes[name] ? pack.u8(name + ".panels") : null,
        texture: image("texture"),
        normal: channels[name]?.includes("normal") ? image("normal") : null,
        occlusion: channels[name]?.includes("occlusion") ? image("occlusion") : null,
        surface: channels[name]?.includes("surface") ? image("surface") : null,
      },
      refs: pack.u16(name + ".refs"),
      weights: pack.f32(name + ".weights"),
      offsets: pack.f32(name + ".offsets"),
      corners: pack.u16(name + ".corners"),
      texCorners: pack.u16(name + ".uvCorners"),
      uv: pack.u16(name + ".uv"),
      hide: pack.u16(name + ".hide"),
    };
  });
  return {
    growth: growth.map((key) => pack.u8(key)),
    fieldClothing,
    brocade: pack.u8("brocade"),
    devices: pack.u8("devices"),
  };
}
export type FieldClothing = Awaited<ReturnType<typeof readFieldClothes>>["fieldClothing"][number];
