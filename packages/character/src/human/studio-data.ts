import { readPack, type PackSpec } from "./pack.js";

export const studioPieces = [
  "skin",
  "eyes",
  "brows",
  "lashes",
  "hair_main",
  "hair_ponytail",
  "hair_strand",
  "hairband",
] as const;
export const studioExpressions = ["Blink", "Smile", "BrowLift"] as const;
export function readStudio(bytes: Uint8Array) {
  const spec: Record<string, PackSpec[string]> = { neck: { kind: "u16" } };
  for (const name of studioPieces) {
    spec[name + ".position"] = spec[name + ".uv"] = { kind: "f32" };
    spec[name + ".color"] = { kind: "u8" };
    spec[name + ".index"] = { kind: "u16" };
    if (name === "skin" || name === "brows" || name === "lashes")
      for (const e of studioExpressions) spec[name + "." + e] = { kind: "f32" };
  }
  return readPack(bytes, spec, "studio-rain.bin");
}
