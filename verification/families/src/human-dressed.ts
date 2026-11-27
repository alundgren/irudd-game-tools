import { createHash } from "node:crypto";
import { accessorValues, isRecord, records, type Glb } from "./glb.js";

const attributes = [
  "POSITION",
  "NORMAL",
  "TEXCOORD_0",
  "_LODANCHOR",
  "_REGION",
  "JOINTS_0",
  "WEIGHTS_0",
];
const widths: Readonly<Record<string, number>> = {
  POSITION: 3,
  NORMAL: 3,
  TEXCOORD_0: 2,
  _LODANCHOR: 1,
  _REGION: 1,
  JOINTS_0: 4,
  WEIGHTS_0: 4,
};

export function surfaceDigest(
  glb: Glb,
  kept: ReadonlyArray<readonly [number, number]>,
  primitives: ReadonlyArray<number> = [0],
): { readonly digest: string; readonly vertices: number; readonly triangles: number } {
  const surface = records(glb.json["meshes"]).find((_, i) =>
    records(glb.json["nodes"]).some((n) => n["mesh"] === i && n["name"] === "Character surface"),
  );
  const all = records(surface?.["primitives"]),
    primitive = all[0];
  if (!primitive) throw new Error("No Character surface.");
  const attrs = isRecord(primitive["attributes"]) ? primitive["attributes"] : {};
  const hash = createHash("sha256");
  const renumber = new Map<number, number>();
  for (const [start, count] of kept)
    for (let v = start; v < start + count; v++) renumber.set(v, renumber.size);
  for (const name of attributes) {
    const index = attrs[name];
    if (index === undefined) throw new Error(`The surface has no ${name}.`);
    const values = accessorValues(glb, Number(index)),
      w = widths[name] ?? 1,
      out: number[] = [];
    for (const [start, count] of kept)
      for (let i = start * w; i < (start + count) * w; i++)
        out.push(Math.round((values[i] ?? 0) * 1e9));
    hash.update(name);
    hash.update(new Uint8Array(Float64Array.from(out).buffer));
  }
  const triangles: number[] = [];
  for (const k of primitives) {
    const indices = accessorValues(glb, Number(all[k]?.["indices"]));
    for (let t = 0; t < indices.length; t += 3) {
      const a = renumber.get(indices[t] ?? -1),
        b = renumber.get(indices[t + 1] ?? -1),
        c = renumber.get(indices[t + 2] ?? -1);
      if (a !== undefined && b !== undefined && c !== undefined) triangles.push(a, b, c);
    }
  }
  hash.update("indices");
  hash.update(new Uint8Array(Uint32Array.from(triangles).buffer));
  return { digest: hash.digest("hex"), vertices: renumber.size, triangles: triangles.length / 3 };
}

export const look491Pieces = {
  surface: { runs: [[0, 63203]], primitives: [0] },
  necklace: { runs: [[63203, 592]], primitives: [1, 2] },
  hair: { runs: [[63795, 17579]], primitives: [3] },
  eyewear: { runs: [[81374, 1183]], primitives: [4] },
} as const;
