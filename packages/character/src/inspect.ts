import { sha256Hex } from "@irudd/document";
import { readGlb } from "./glb.js";

type Json = Record<string, unknown>;

const isRecord = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const list = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(isRecord) : []);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const nums = (v: unknown): number[] =>
  Array.isArray(v) ? v.filter((x): x is number => typeof x === "number") : [];

export interface ImageSummary {
  readonly index: number;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly sha256: string;
}

export interface MaterialSummary {
  readonly index: number;
  readonly name: string | null;
  readonly baseColor: number[];
  readonly metallic: number;
  readonly roughness: number;
  readonly emissive: number[];
  readonly textures: Record<string, number>;
  readonly extensions: string[];
  readonly primitives: number;
  readonly triangles: number;
  readonly regions: string[];
}

export interface GlbSummary {
  readonly generator: string | null;
  readonly provenance: unknown;
  readonly extensionsUsed: string[];
  readonly counts: Record<string, number>;
  readonly vertices: number;
  readonly triangles: number;
  readonly bounds: { readonly min: number[]; readonly max: number[] } | null;
  readonly regions: Record<string, number>;
  readonly materials: MaterialSummary[];
  readonly images: ImageSummary[];
  readonly joints: { readonly name: string; readonly part: string | null }[];
  readonly morphTargets: string[];
  readonly animations: {
    readonly name: string;
    readonly channels: number;
    readonly seconds: number;
  }[];
}

interface Glb {
  readonly json: Json;
  readonly bin: Uint8Array;
}

function parse(bytes: Uint8Array): Glb {
  const { json, rest } = readGlb(bytes);
  if (!isRecord(json)) throw new Error("The GLB has no JSON object.");
  const view = new DataView(rest.buffer, rest.byteOffset, rest.byteLength);
  const bin =
    rest.byteLength >= 8 ? rest.subarray(8, 8 + view.getUint32(0, true)) : new Uint8Array();
  return { json, bin };
}

function viewBytes(glb: Glb, index: number | undefined): Uint8Array | undefined {
  const view = index === undefined ? undefined : list(glb.json["bufferViews"])[index];
  if (!view) return undefined;
  const offset = num(view["byteOffset"]) ?? 0;
  return glb.bin.subarray(offset, offset + (num(view["byteLength"]) ?? 0));
}

const componentSize: Record<number, number> = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
};

function scalars(glb: Glb, index: number | undefined): number[] {
  const accessor = index === undefined ? undefined : list(glb.json["accessors"])[index];
  if (!accessor) return [];
  const views = list(glb.json["bufferViews"]);
  const viewIndex = num(accessor["bufferView"]);
  const bytes = viewBytes(glb, viewIndex);
  const type = num(accessor["componentType"]) ?? 0;
  const size = componentSize[type];
  if (!bytes || size === undefined || str(accessor["type"]) !== "SCALAR") return [];
  const stride = num(views[viewIndex ?? -1]?.["byteStride"]) ?? size;
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = num(accessor["byteOffset"]) ?? 0;
  const out: number[] = [];
  for (let i = 0; i < (num(accessor["count"]) ?? 0); i++) {
    const at = start + i * stride;
    out.push(
      type === 5121
        ? data.getUint8(at)
        : type === 5120
          ? data.getInt8(at)
          : type === 5123
            ? data.getUint16(at, true)
            : type === 5122
              ? data.getInt16(at, true)
              : type === 5125
                ? data.getUint32(at, true)
                : data.getFloat32(at, true),
    );
  }
  return out;
}

function pngSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((b, i) => bytes[i] !== b)) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

const slots = [
  [
    "baseColor",
    (m: Json) =>
      isRecord(m["pbrMetallicRoughness"])
        ? m["pbrMetallicRoughness"]["baseColorTexture"]
        : undefined,
  ],
  [
    "metallicRoughness",
    (m: Json) =>
      isRecord(m["pbrMetallicRoughness"])
        ? m["pbrMetallicRoughness"]["metallicRoughnessTexture"]
        : undefined,
  ],
  ["normal", (m: Json) => m["normalTexture"]],
  ["occlusion", (m: Json) => m["occlusionTexture"]],
  ["emissive", (m: Json) => m["emissiveTexture"]],
  [
    "bump",
    (m: Json) =>
      isRecord(m["extensions"]) && isRecord(m["extensions"]["EXT_materials_bump"])
        ? m["extensions"]["EXT_materials_bump"]["bumpTexture"]
        : undefined,
  ],
] as const;

export function inspectGlb(bytes: Uint8Array): GlbSummary {
  const glb = parse(bytes);
  const { json } = glb;
  const asset = isRecord(json["asset"]) ? json["asset"] : {};
  const extras = isRecord(asset["extras"]) ? asset["extras"] : {};
  const textures = list(json["textures"]);
  const imageOf = (ref: unknown): number | undefined => {
    const texture = isRecord(ref) ? textures[num(ref["index"]) ?? -1] : undefined;
    return texture ? num(texture["source"]) : undefined;
  };
  const accessors = list(json["accessors"]);
  const nodes = list(json["nodes"]);
  const meshNodes = nodes.filter((n) => num(n["mesh"]) !== undefined);
  const regionNamesOf = (meshIndex: number): string[] => {
    const node = meshNodes.find((n) => n["mesh"] === meshIndex);
    const names = node && isRecord(node["extras"]) ? node["extras"]["regionNames"] : undefined;
    return Array.isArray(names) ? names.filter((x): x is string => typeof x === "string") : [];
  };
  const regions: Record<string, number> = {};
  const materials = list(json["materials"]).map((m, index) => {
    const pbr = isRecord(m["pbrMetallicRoughness"]) ? m["pbrMetallicRoughness"] : {};
    const slotImages: Record<string, number> = {};
    for (const [slot, read] of slots) {
      const image = imageOf(read(m));
      if (image !== undefined) slotImages[slot] = image;
    }
    return {
      index,
      name: str(m["name"]) ?? null,
      baseColor: pbr["baseColorFactor"] === undefined ? [1, 1, 1, 1] : nums(pbr["baseColorFactor"]),
      metallic: num(pbr["metallicFactor"]) ?? 1,
      roughness: num(pbr["roughnessFactor"]) ?? 1,
      emissive: m["emissiveFactor"] === undefined ? [0, 0, 0] : nums(m["emissiveFactor"]),
      textures: slotImages,
      extensions: isRecord(m["extensions"]) ? Object.keys(m["extensions"]) : [],
      primitives: 0,
      triangles: 0,
      regions: new Set<string>(),
    };
  });
  let vertices = 0;
  let triangles = 0;
  let min: number[] | null = null;
  let max: number[] | null = null;
  const positions = new Set<number>();
  for (const [meshIndex, mesh] of list(json["meshes"]).entries()) {
    const names = regionNamesOf(meshIndex);
    for (const p of list(mesh["primitives"])) {
      const attributes = isRecord(p["attributes"]) ? p["attributes"] : {};
      const position = num(attributes["POSITION"]);
      const accessor = position === undefined ? undefined : accessors[position];
      if (position !== undefined && accessor && !positions.has(position)) {
        positions.add(position);
        vertices += num(accessor["count"]) ?? 0;
        const lo = nums(accessor["min"]);
        const hi = nums(accessor["max"]);
        min = min ? min.map((v, i) => Math.min(v, lo[i] ?? v)) : lo;
        max = max ? max.map((v, i) => Math.max(v, hi[i] ?? v)) : hi;
      }
      const indices = num(p["indices"]);
      const count =
        indices === undefined
          ? (num(accessor?.["count"]) ?? 0)
          : (num(accessors[indices]?.["count"]) ?? 0);
      const tris = num(p["mode"]) === 4 || p["mode"] === undefined ? Math.floor(count / 3) : 0;
      triangles += tris;
      const material = materials[num(p["material"]) ?? -1];
      if (material) {
        material.primitives++;
        material.triangles += tris;
      }
      const region = scalars(glb, num(attributes["_REGION"]));
      if (!region.length || !tris) continue;
      const corners = indices === undefined ? undefined : scalars(glb, indices);
      for (let t = 0; t < tris; t++) {
        const first = corners ? (corners[t * 3] ?? 0) : t * 3;
        const name = names[region[first] ?? -1] ?? `#${region[first] ?? -1}`;
        regions[name] = (regions[name] ?? 0) + 1;
        material?.regions.add(name);
      }
    }
  }
  const images = list(json["images"]).map((image, index): ImageSummary => {
    const data = viewBytes(glb, num(image["bufferView"])) ?? new Uint8Array();
    const size = pngSize(data);
    return {
      index,
      mimeType: str(image["mimeType"]) ?? "",
      byteLength: data.byteLength,
      width: size?.width ?? null,
      height: size?.height ?? null,
      sha256: sha256Hex(data),
    };
  });
  const counts: Record<string, number> = {};
  for (const key of ["nodes", "meshes", "materials", "textures", "images", "skins", "animations"])
    counts[key] = list(json[key]).length;
  counts["primitives"] = list(json["meshes"]).reduce((n, m) => n + list(m["primitives"]).length, 0);
  const jointIndices = new Set(list(json["skins"]).flatMap((s) => nums(s["joints"])));
  const joints = [...jointIndices].map((i) => {
    const node = nodes[i] ?? {};
    const region = isRecord(node["extras"]) ? str(node["extras"]["region"]) : undefined;
    return { name: str(node["name"]) ?? `node ${i}`, part: region ?? null };
  });
  const morphTargets = list(json["meshes"]).flatMap((m) => {
    const names = isRecord(m["extras"]) ? m["extras"]["targetNames"] : undefined;
    return Array.isArray(names) ? names.filter((x): x is string => typeof x === "string") : [];
  });
  const animations = list(json["animations"]).map((a, i) => {
    const samplers = list(a["samplers"]);
    const seconds = Math.max(
      0,
      ...samplers.map((s) => nums(accessors[num(s["input"]) ?? -1]?.["max"])[0] ?? 0),
    );
    return {
      name: str(a["name"]) ?? `animation ${i}`,
      channels: list(a["channels"]).length,
      seconds,
    };
  });
  return {
    generator: str(asset["generator"]) ?? null,
    provenance: extras["irudd"] ?? null,
    extensionsUsed: Array.isArray(json["extensionsUsed"])
      ? json["extensionsUsed"].filter((x): x is string => typeof x === "string")
      : [],
    counts,
    vertices,
    triangles,
    bounds: min && max ? { min, max } : null,
    regions,
    materials: materials.map((m) => ({ ...m, regions: [...m.regions].sort() })),
    images,
    joints,
    morphTargets,
    animations,
  };
}
