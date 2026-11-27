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
  for (const name of [
    "bindingVertices",
    "triangles",
    "skin.source",
    "skin.smooth",
    "lids.L",
    "lids.R",
  ])
    spec[name] = { kind: "u16" };
  for (const name of [
    "bindingShares",
    "bindingRest",
    "control",
    "centre.L",
    "centre.R",
    "eyes.box",
    "eyes.axis",
  ])
    spec[name] = { kind: "f32" };
  for (const name of ["settle", "lips", "eyes.left", "paint.skin", "paint.hair", "paint.eyes"])
    spec[name] = { kind: "u8" };
  for (const name of studioPieces)
    if (name !== "skin") {
      spec[name + ".ties"] = { kind: "u16" };
      spec[name + ".shares"] = { kind: "f32" };
    }
  return readPack(bytes, spec, "studio-rain.bin");
}
