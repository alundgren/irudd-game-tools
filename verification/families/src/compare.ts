// Structural comparison of a fresh export against its G0 reference export.
//
// Compares the decoded glTF: scene graph, node transforms, skins and joint
// names, meshes and their attribute sets, material parameters, textures,
// animations and channels, and every accessor's decoded values. Buffer layout,
// image encoding, the exporter's generator string and the new provenance
// block are excluded, as in the G0 content digest. Images are compared by
// decoded pixels.

import { decodePng } from "./png.js";
import { accessorValues, imageBytes, isRecord, num, parseGlb, records, type Glb } from "./glb.js";

export interface Difference {
  readonly path: string;
  readonly reference: unknown;
  readonly fresh: unknown;
}

export interface AccessorUse {
  readonly use: string;
  readonly accessors: number;
  readonly values: number;
  readonly differing: number;
  readonly maxAbs: number;
}

export interface ImageComparison {
  readonly index: number;
  readonly width: number;
  readonly height: number;
  readonly sameBytes: boolean;
  /** Largest absolute channel difference over all pixels, 0 to 255. */
  readonly maxChannel: number;
  readonly differingPixels: number;
  readonly firstDifference?: {
    readonly x: number;
    readonly y: number;
    readonly reference: string;
    readonly fresh: string;
  };
}

/**
 * Differences the port makes on purpose, applied to the reference before comparing.
 * `regions` maps a legacy part ID, which joints name in `extras.region`, to the
 * document's stable part ID that replaces it.
 */
export interface Expected {
  readonly regions?: ReadonlyMap<string, string>;
}

export interface Comparison {
  /** Differences in the decoded glTF structure, numbers within `tolerance`. */
  readonly structure: ReadonlyArray<Difference>;
  readonly structureNumbersMaxAbs: number;
  readonly accessors: ReadonlyArray<AccessorUse>;
  readonly images: ReadonlyArray<ImageComparison>;
  readonly counts: Record<string, readonly [number, number]>;
}

const excludedKeys = new Set([
  "buffers",
  "bufferViews",
  "bufferView",
  "byteOffset",
  "byteLength",
  "uri",
  "generator",
]);

function normalise(json: Record<string, unknown>): unknown {
  const asset = isRecord(json["asset"]) ? json["asset"] : {};
  const extras = isRecord(asset["extras"]) ? { ...asset["extras"] } : undefined;
  if (extras) delete extras["irudd"];
  const cleanAsset = {
    ...asset,
    extras: extras && Object.keys(extras).length ? extras : undefined,
  };
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (!isRecord(value)) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value))
      if (!excludedKeys.has(k) && v !== undefined) out[k] = strip(v);
    return out;
  };
  return strip({ ...json, asset: cleanAsset });
}

function walk(
  a: unknown,
  b: unknown,
  path: string,
  tolerance: number,
  out: Difference[],
  numbers: { maxAbs: number },
): void {
  if (typeof a === "number" && typeof b === "number") {
    const d = Math.abs(a - b);
    numbers.maxAbs = Math.max(numbers.maxAbs, d);
    if (d > tolerance * Math.max(1, Math.abs(a))) out.push({ path, reference: a, fresh: b });
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length)
      out.push({ path: path + ".length", reference: a.length, fresh: b.length });
    for (let i = 0; i < Math.min(a.length, b.length); i++)
      walk(a[i], b[i], `${path}[${i}]`, tolerance, out, numbers);
    return;
  }
  if (isRecord(a) && isRecord(b)) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (path === "" && key === "accessors") {
        // Accessor values are compared separately; keep their layout fields.
        const ra = records(a[key]);
        const rb = records(b[key]);
        if (ra.length !== rb.length)
          out.push({ path: "accessors.length", reference: ra.length, fresh: rb.length });
        ra.forEach((x, i) => {
          const y = rb[i];
          if (!y) return;
          for (const field of ["componentType", "count", "type", "normalized"])
            if (x[field] !== y[field])
              out.push({ path: `accessors[${i}].${field}`, reference: x[field], fresh: y[field] });
          walk(x["min"], y["min"], `accessors[${i}].min`, tolerance, out, numbers);
          walk(x["max"], y["max"], `accessors[${i}].max`, tolerance, out, numbers);
        });
        continue;
      }
      walk(a[key], b[key], path ? `${path}.${key}` : key, tolerance, out, numbers);
    }
    return;
  }
  if (a !== b) out.push({ path, reference: a, fresh: b });
}

/** Label each accessor by its use: an attribute, indices, a morph target, joint matrices or an animation sampler. */
function accessorUses(glb: Glb): Map<number, string> {
  const uses = new Map<number, string>();
  for (const mesh of records(glb.json["meshes"]))
    for (const primitive of records(mesh["primitives"])) {
      const attributes = isRecord(primitive["attributes"]) ? primitive["attributes"] : {};
      for (const [name, index] of Object.entries(attributes))
        if (typeof index === "number") uses.set(index, name);
      if (typeof primitive["indices"] === "number") uses.set(primitive["indices"], "indices");
      for (const target of records(primitive["targets"]))
        for (const [name, index] of Object.entries(target))
          if (typeof index === "number") uses.set(index, "morph " + name);
    }
  for (const skin of records(glb.json["skins"]))
    if (typeof skin["inverseBindMatrices"] === "number")
      uses.set(skin["inverseBindMatrices"], "inverseBindMatrices");
  for (const animation of records(glb.json["animations"])) {
    const samplers = records(animation["samplers"]);
    for (const channel of records(animation["channels"])) {
      const sampler = samplers[num(channel["sampler"], -1)];
      const target = isRecord(channel["target"]) ? channel["target"] : {};
      if (!sampler) continue;
      if (typeof sampler["input"] === "number") uses.set(sampler["input"], "animation time");
      if (typeof sampler["output"] === "number")
        uses.set(sampler["output"], "animation " + String(target["path"]));
    }
  }
  return uses;
}

const countKeys = [
  "nodes",
  "meshes",
  "materials",
  "textures",
  "images",
  "skins",
  "animations",
  "accessors",
] as const;

function applyExpected(json: Record<string, unknown>, expected: Expected): Record<string, unknown> {
  const regions = expected.regions;
  if (!regions) return json;
  const nodes = records(json["nodes"]).map((node) => {
    const extras = node["extras"];
    if (!isRecord(extras) || typeof extras["region"] !== "string") return node;
    return {
      ...node,
      extras: { ...extras, region: regions.get(extras["region"]) ?? extras["region"] },
    };
  });
  return { ...json, nodes };
}

export function compareGlb(
  reference: Uint8Array,
  fresh: Uint8Array,
  expected: Expected = {},
  tolerance = 1e-5,
): Comparison {
  const a = parseGlb(reference);
  const b = parseGlb(fresh);
  const structure: Difference[] = [];
  const numbers = { maxAbs: 0 };
  walk(
    normalise(applyExpected(a.json, expected)),
    normalise(b.json),
    "",
    tolerance,
    structure,
    numbers,
  );
  const uses = accessorUses(a);
  const byUse = new Map<
    string,
    { accessors: number; values: number; differing: number; maxAbs: number }
  >();
  const count = Math.min(records(a.json["accessors"]).length, records(b.json["accessors"]).length);
  for (let i = 0; i < count; i++) {
    const va = accessorValues(a, i);
    const vb = accessorValues(b, i);
    const use = uses.get(i) ?? "other";
    const row = byUse.get(use) ?? { accessors: 0, values: 0, differing: 0, maxAbs: 0 };
    row.accessors++;
    row.values += va.length;
    if (va.length !== vb.length) {
      row.differing += va.length;
      row.maxAbs = Infinity;
    } else
      for (let k = 0; k < va.length; k++) {
        const d = Math.abs((va[k] ?? 0) - (vb[k] ?? 0));
        if (d > 0) row.differing++;
        if (d > row.maxAbs) row.maxAbs = d;
      }
    byUse.set(use, row);
  }
  const images: ImageComparison[] = [];
  const imageCount = Math.min(records(a.json["images"]).length, records(b.json["images"]).length);
  for (let i = 0; i < imageCount; i++) {
    const ia = imageBytes(a, i);
    const ib = imageBytes(b, i);
    const pa = decodePng(ia);
    const pb = decodePng(ib);
    let maxChannel = 0;
    let differingPixels = 0;
    let firstDifference: ImageComparison["firstDifference"];
    if (pa.width !== pb.width || pa.height !== pb.height) maxChannel = 255;
    else
      for (let p = 0; p < pa.width * pa.height; p++) {
        let pixel = 0;
        for (let c = 0; c < 4; c++)
          pixel = Math.max(pixel, Math.abs((pa.rgba[p * 4 + c] ?? 0) - (pb.rgba[p * 4 + c] ?? 0)));
        if (pixel) {
          differingPixels++;
          if (!firstDifference) {
            const rgba = (data: Uint8Array) =>
              Array.from(data.subarray(p * 4, p * 4 + 4), (v) =>
                v.toString(16).padStart(2, "0"),
              ).join("");
            firstDifference = {
              x: p % pa.width,
              y: Math.floor(p / pa.width),
              reference: rgba(pa.rgba),
              fresh: rgba(pb.rgba),
            };
          }
        }
        maxChannel = Math.max(maxChannel, pixel);
      }
    images.push({
      index: i,
      width: pa.width,
      height: pa.height,
      sameBytes: ia.length === ib.length && ia.every((v, k) => v === ib[k]),
      maxChannel,
      differingPixels,
      ...(firstDifference ? { firstDifference } : {}),
    });
  }
  const counts: Record<string, readonly [number, number]> = {};
  for (const key of countKeys)
    counts[key] = [records(a.json[key]).length, records(b.json[key]).length];
  return {
    structure,
    structureNumbersMaxAbs: numbers.maxAbs,
    accessors: [...byUse]
      .map(([use, row]) => ({ use, ...row }))
      .sort((x, y) => x.use.localeCompare(y.use)),
    images,
    counts,
  };
}
