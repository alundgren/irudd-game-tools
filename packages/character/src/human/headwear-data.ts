import { headwear } from "./headwear-library.js";
import { readPack, type EntrySpec } from "./pack.js";

export function readHeadwear(bytes: Uint8Array) {
  const spec: Record<string, EntrySpec> = {};
  for (const pieces of Object.values(headwear))
    for (const part of pieces) {
      for (const morph of part.morphs ?? []) spec[morph.data] = { kind: "i16" };
      for (const key of [part.points, part.normals, part.uv]) if (key) spec[key] = { kind: "i16" };
      spec[part.indices] = { kind: "u32" };
      for (const key of [
        part.colors,
        part.bones,
        part.weights,
        part.map?.data,
        part.normalMap?.data,
        part.bumpMap?.data,
        part.roughMap?.data,
        part.metalMap?.data,
        part.occlusion?.data,
      ])
        if (key) spec[key] = { kind: "u8" };
    }
  return readPack(bytes, spec, "human-headwear.bin");
}
