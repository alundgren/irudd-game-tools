import { isJsonArray, isJsonObject, type Json, type JsonObject } from "./json.js";

export const assetCreditsNamespace = "irudd.asset-credits";
export const assetCreditsFormat = "irudd.asset-credits";
export const assetCreditsVersion = 1;

export function creditEntries(value: Json | undefined): Map<string, JsonObject> | undefined {
  const out = new Map<string, JsonObject>();
  if (value === undefined) return out;
  if (!isJsonObject(value)) return undefined;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined);
  if (keys.some((k) => k !== "format" && k !== "version" && k !== "assets")) return undefined;
  if (value["format"] !== assetCreditsFormat || value["version"] !== assetCreditsVersion)
    return undefined;
  const assets = value["assets"];
  if (!isJsonArray(assets)) return undefined;
  for (const entry of assets) {
    if (!isJsonObject(entry)) return undefined;
    const digest = entry["digest"];
    if (typeof digest !== "string" || out.has(digest)) return undefined;
    out.set(digest, entry);
  }
  return out;
}

export function creditRecord(entries: Iterable<JsonObject>): Json | undefined {
  const key = (entry: JsonObject): string => {
    const digest = entry["digest"];
    return typeof digest === "string" ? digest : "";
  };
  const assets = [...entries].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    return x < y ? -1 : x > y ? 1 : 0;
  });
  if (assets.length === 0) return undefined;
  return { format: assetCreditsFormat, version: assetCreditsVersion, assets };
}

export function retireCredit(
  extensions: Readonly<Record<string, Json>>,
  digest: string,
): Readonly<Record<string, Json>> {
  const entries = creditEntries(extensions[assetCreditsNamespace]);
  if (!entries?.has(digest)) return extensions;
  entries.delete(digest);
  const { [assetCreditsNamespace]: _old, ...rest } = extensions;
  const record = creditRecord(entries.values());
  return record === undefined ? rest : { ...rest, [assetCreditsNamespace]: record };
}
