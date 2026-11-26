// Read what a binary glTF says about itself without building a scene.
//
// Pure: no DOM, no WebGL. The desktop library lists files with this, and the
// player shows it next to the rendered model.

const magic = 0x46546c67;
const jsonChunk = 0x4e4f534a;

export type JsonObject = { readonly [key: string]: unknown };

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function list(value: unknown): ReadonlyArray<unknown> {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** The `irudd.export` provenance a workshop export stamps in `asset.extras.irudd`. */
export interface ExportProvenance {
  readonly format: string;
  readonly version: number;
  readonly document: string;
  readonly digest: string;
  readonly revision: number;
  readonly build: string;
  readonly preset: string;
}

export interface GlbSummary {
  readonly byteLength: number;
  readonly generator: string | undefined;
  readonly copyright: string | undefined;
  readonly scenes: ReadonlyArray<string>;
  readonly nodes: number;
  readonly meshes: number;
  readonly skins: number;
  readonly materials: number;
  readonly textures: number;
  readonly animations: ReadonlyArray<string>;
  readonly extensionsUsed: ReadonlyArray<string>;
  readonly extensionsRequired: ReadonlyArray<string>;
  /** Present only for files the workshop exported. A file without a recipe has none. */
  readonly provenance: ExportProvenance | undefined;
}

export class GlbError extends Error {
  override readonly name = "GlbError";
}

/** The JSON chunk of a GLB. Throws GlbError for anything that is not a binary glTF 2. */
export function glbJson(bytes: Uint8Array): JsonObject {
  if (bytes.byteLength < 20) throw new GlbError("The file is too short to be a GLB.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== magic) throw new GlbError("This is not a binary glTF (GLB).");
  if (view.getUint32(4, true) !== 2) throw new GlbError("Only glTF 2 is supported.");
  const length = view.getUint32(12, true);
  if (view.getUint32(16, true) !== jsonChunk || 20 + length > bytes.byteLength)
    throw new GlbError("The GLB's first chunk is not JSON.");
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
  } catch {
    throw new GlbError("The GLB's JSON chunk does not parse.");
  }
  if (!isObject(json)) throw new GlbError("The GLB's JSON chunk is not an object.");
  return json;
}

function provenanceOf(asset: JsonObject | undefined): ExportProvenance | undefined {
  const extras = asset?.["extras"];
  const irudd = isObject(extras) ? extras["irudd"] : undefined;
  if (!isObject(irudd)) return undefined;
  const { format, version, document, digest, revision, build, preset } = irudd;
  if (
    typeof format !== "string" ||
    typeof version !== "number" ||
    typeof document !== "string" ||
    typeof digest !== "string" ||
    typeof revision !== "number" ||
    typeof build !== "string" ||
    typeof preset !== "string"
  )
    return undefined;
  return { format, version, document, digest, revision, build, preset };
}

export function summarizeGlb(bytes: Uint8Array): GlbSummary {
  const json = glbJson(bytes);
  const asset = isObject(json["asset"]) ? json["asset"] : undefined;
  const named = (key: string, fallback: string): string[] =>
    list(json[key]).map((entry, i) =>
      isObject(entry) ? (text(entry["name"]) ?? `${fallback} ${i + 1}`) : `${fallback} ${i + 1}`,
    );
  return {
    byteLength: bytes.byteLength,
    generator: text(asset?.["generator"]),
    copyright: text(asset?.["copyright"]),
    scenes: named("scenes", "Scene"),
    nodes: list(json["nodes"]).length,
    meshes: list(json["meshes"]).length,
    skins: list(json["skins"]).length,
    materials: list(json["materials"]).length,
    textures: list(json["textures"]).length,
    animations: named("animations", "Clip"),
    extensionsUsed: list(json["extensionsUsed"]).flatMap((e) => (typeof e === "string" ? [e] : [])),
    extensionsRequired: list(json["extensionsRequired"]).flatMap((e) =>
      typeof e === "string" ? [e] : [],
    ),
    provenance: provenanceOf(asset),
  };
}
