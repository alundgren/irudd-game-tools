import { Schema } from "effect";
import { Digest, type CharacterDocument } from "./schema.js";
import { decodeWith } from "./registry.js";
import { diagnostic, fail, ok, type Checked } from "./diagnostics.js";
import { isJson, isJsonObject, type Json, type JsonObject } from "./json.js";
import { Actor } from "./commands.js";
import {
  assetCreditsFormat,
  assetCreditsNamespace,
  assetCreditsVersion,
  creditRecord,
} from "./credit-record.js";

export { assetCreditsFormat, assetCreditsNamespace, assetCreditsVersion };

const Text = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max));

export const AssetAttribution = Schema.Struct({
  author: Schema.optionalKey(Text(200)),
  credit: Schema.optionalKey(Text(300)),
  license: Schema.optionalKey(Text(120)),
  source: Schema.optionalKey(Text(500)),
});
export type AssetAttribution = typeof AssetAttribution.Type;

export const AssetCredit = Schema.Struct({
  digest: Digest,
  via: Schema.Literals(["paired-agent", "person-import"]),
  submittedBy: Actor,
  art: Schema.Struct({ id: Text(64), kind: Text(32) }),
  summary: Text(400),
  ...AssetAttribution.fields,
});
export type AssetCredit = typeof AssetCredit.Type;

export const assetCreditsLimit = 64;

export const AssetCredits = Schema.Struct({
  format: Schema.Literal(assetCreditsFormat),
  version: Schema.Literal(assetCreditsVersion),
  assets: Schema.Array(AssetCredit).check(Schema.isMaxLength(assetCreditsLimit)),
});
export type AssetCredits = typeof AssetCredits.Type;

const StoredCredits = Schema.Struct({
  format: Schema.Literal(assetCreditsFormat),
  version: Schema.Literal(assetCreditsVersion),
  assets: Schema.Array(AssetCredit),
});

export function readAssetCredits(doc: CharacterDocument): Checked<ReadonlyArray<AssetCredit>> {
  const raw = doc.extensions[assetCreditsNamespace];
  if (raw === undefined) return ok([]);
  const decoded = decodeWith(StoredCredits, raw, ["extensions", assetCreditsNamespace]);
  if (!decoded.ok) return decoded;
  const seen = new Set<string>();
  for (const [i, credit] of decoded.value.assets.entries()) {
    if (seen.has(credit.digest))
      return fail([
        diagnostic(
          "schema",
          ["extensions", assetCreditsNamespace, "assets", i, "digest"],
          `${assetCreditsNamespace} credits ${credit.digest} twice.`,
        ),
      ]);
    seen.add(credit.digest);
  }
  return ok(decoded.value.assets);
}

export function assetCredits(doc: CharacterDocument): ReadonlyMap<string, AssetCredit> {
  const out = new Map<string, AssetCredit>();
  const declared = new Set(doc.assets.map((a) => a.digest));
  for (const credit of storedAssetCredits(doc))
    if (declared.has(credit.digest)) out.set(credit.digest, credit);
  return out;
}

export function storedAssetCredits(doc: CharacterDocument): ReadonlyArray<AssetCredit> {
  const read = readAssetCredits(doc);
  return read.ok ? read.value : [];
}

export function mergeAssetCredits(
  doc: CharacterDocument,
  declared: ReadonlySet<string>,
  added: ReadonlyArray<AssetCredit>,
): Checked<Json | undefined> {
  const stored = readAssetCredits(doc);
  if (!stored.ok)
    return fail([
      diagnostic(
        "schema",
        ["extensions", assetCreditsNamespace],
        `The document's ${assetCreditsNamespace} record cannot be read, so its credits cannot be kept: ${stored.diagnostics.map((d) => d.message).join(" ")} Restore a revision whose record reads, or correct the record, before adding artwork.`,
      ),
    ]);
  const byDigest = new Map<string, AssetCredit>();
  for (const credit of stored.value)
    if (declared.has(credit.digest)) byDigest.set(credit.digest, credit);
  for (const credit of added) byDigest.set(credit.digest, credit);
  if (byDigest.size > assetCreditsLimit)
    return fail([
      diagnostic(
        "limit",
        ["extensions", assetCreditsNamespace],
        `${byDigest.size} pictures would be credited; ${assetCreditsNamespace} holds at most ${assetCreditsLimit}.`,
      ),
    ]);
  const value: unknown = JSON.parse(JSON.stringify([...byDigest.values()]));
  if (!Array.isArray(value)) return ok(undefined);
  const entries = value.filter((v): v is JsonObject => isJson(v) && isJsonObject(v));
  return ok(creditRecord(entries));
}

export function decodeAssetCredit(value: Json, path: ReadonlyArray<string>): Checked<AssetCredit> {
  return decodeWith(AssetCredit, value, path);
}

export function assetCreditLine(credit: AssetCredit): string | undefined {
  const line =
    credit.credit ?? (credit.author ? `${credit.art.kind} artwork by ${credit.author}` : undefined);
  if (line) return credit.license ? `${line} (${credit.license})` : line;
  return credit.license ? `${credit.art.kind} artwork (${credit.license})` : undefined;
}
