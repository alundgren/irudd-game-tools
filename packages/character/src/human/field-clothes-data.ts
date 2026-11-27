import { readPack, type EntrySpec } from "./pack.js";

const spec: Record<string, EntrySpec> = {};
const names = ["male_casualsuit05", "shoes02"] as const;
for (const name of names) {
  for (const key of ["refs", "uv", "corners", "uvCorners", "hide"])
    spec[name + "." + key] = { kind: "u16" };
  for (const key of ["weights", "offsets"]) spec[name + "." + key] = { kind: "f32" };
  for (const key of name === "shoes02" ? ["texture"] : ["texture", "normal", "occlusion"]) {
    spec[name + "." + key] = { kind: "u8" };
    spec[name + "." + key + ".size"] = { kind: "u16", elements: 2 };
  }
}
export async function readFieldClothes(bytes: Uint8Array) {
  const pack = await readPack(bytes, spec, "human-field-clothes.bin");
  return names.map((name) => {
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
        texture: image("texture"),
        normal: name === "shoes02" ? null : image("normal"),
        occlusion: name === "shoes02" ? null : image("occlusion"),
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
}
export type FieldClothing = Awaited<ReturnType<typeof readFieldClothes>>[number];
