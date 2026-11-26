// The shape of the `irudd.asset-credits` extension, read without its schema.
//
// The reducer, the change paths and the credit schema all address one credit
// by its asset digest. This module only knows the record's envelope, so the
// operation reducer can retire a credit when its asset is removed without
// depending on the command schemas the full credit decoder needs.

import { isJsonArray, isJsonObject, type Json, type JsonObject } from "./json.js";

export const assetCreditsNamespace = "irudd.asset-credits";
export const assetCreditsFormat = "irudd.asset-credits";
export const assetCreditsVersion = 1;

/**
 * The record's credits by digest. Empty for an absent record. Undefined when
 * the value is not a credit record this build can edit one credit at a time:
 * another format or version, extra fields, or an entry without a unique digest.
 */
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

/** The record holding these credits, sorted by digest. Undefined when there are none. */
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

/**
 * The extensions after `digest`'s asset is removed: its credit goes with it.
 * A record this build cannot edit is left as it is; readers ignore credits of
 * assets the document no longer declares.
 */
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
