// Where the artwork a document draws with came from, kept in the document itself.
//
// The extension `irudd.asset-credits` lists, per asset digest, how a picture
// entered the character (a paired agent's art reply or a person's import), who
// submitted the bytes, the art request it answered and what the submitter
// stated about who made it, its credit, licence and source. Submitting bytes
// is not making them: the maker is only what the submitter states. It is ordinary document data: it travels with the journal
// through backups, restores and portable archives, and an export reads it for
// the GLB's attribution. It reaches the head only when the person accepts the
// proposal that carries it.
//
// A picture keeps its first credit: reusing an asset the document already
// declares, or one this build ships with its own origin, adds no new credit.
// A credit lives as long as its asset: removing the asset, by hand or in a
// proposal, retires the credit, and undoing the removal brings it back.
//
// Change paths address one credit as ["extensions", namespace, digest], so
// two proposals that credit different pictures merge, while two that credit
// the same picture differently still conflict.
//
// The record names the submitter by actor kind, ID and display name. It never
// holds pairing IDs, steering messages, conversation routes, credential paths
// or the person's art direction: those stay in the host's private state.

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

/** What the submitter states about a picture's rights. Every field is optional. */
export const AssetAttribution = Schema.Struct({
  /** Who made the picture, as the submitter states it, such as a person, a studio or a tool. */
  author: Schema.optionalKey(Text(200)),
  /** Credit text an export must carry, such as "Painted by Ada Lovelace". */
  credit: Schema.optionalKey(Text(300)),
  /** A licence name or SPDX ID, such as CC-BY-4.0. */
  license: Schema.optionalKey(Text(120)),
  /** Where the picture came from, such as a URL or a tool. */
  source: Schema.optionalKey(Text(500)),
});
export type AssetAttribution = typeof AssetAttribution.Type;

export const AssetCredit = Schema.Struct({
  digest: Digest,
  /** `paired-agent`: the paired agent's art reply. `person-import`: a person imported a file. */
  via: Schema.Literals(["paired-agent", "person-import"]),
  /** The actor that submitted the bytes, as the journal names it. Not necessarily who made them. */
  submittedBy: Actor,
  /** The art request it answered, and that request's kind. */
  art: Schema.Struct({ id: Text(64), kind: Text(32) }),
  /** The submitter's description of the reply. */
  summary: Text(400),
  ...AssetAttribution.fields,
});
export type AssetCredit = typeof AssetCredit.Type;

/** A document declares at most 64 assets, so a written record holds at most 64 credits. */
export const assetCreditsLimit = 64;

/** The record as a writer stores it. */
export const AssetCredits = Schema.Struct({
  format: Schema.Literal(assetCreditsFormat),
  version: Schema.Literal(assetCreditsVersion),
  assets: Schema.Array(AssetCredit).check(Schema.isMaxLength(assetCreditsLimit)),
});
export type AssetCredits = typeof AssetCredits.Type;

/**
 * The record as a reader accepts it. Concurrent proposals merge one credit at
 * a time, and a record from an earlier build can hold credits of pictures
 * removed since, so a reader does not cap the count: an extra entry never
 * hides the others.
 */
const StoredCredits = Schema.Struct({
  format: Schema.Literal(assetCreditsFormat),
  version: Schema.Literal(assetCreditsVersion),
  assets: Schema.Array(AssetCredit),
});

/**
 * Every stored credit, whether or not the document still declares its asset,
 * or the diagnostics of a record that cannot be read. An absent record holds none.
 */
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

/**
 * The document's asset credits, for assets it still declares, by digest. A
 * missing or malformed extension gives none: credits never block a build.
 */
export function assetCredits(doc: CharacterDocument): ReadonlyMap<string, AssetCredit> {
  const out = new Map<string, AssetCredit>();
  const declared = new Set(doc.assets.map((a) => a.digest));
  for (const credit of storedAssetCredits(doc))
    if (declared.has(credit.digest)) out.set(credit.digest, credit);
  return out;
}

/** Every stored credit, whether or not the document still declares its asset. None when malformed. */
export function storedAssetCredits(doc: CharacterDocument): ReadonlyArray<AssetCredit> {
  const read = readAssetCredits(doc);
  return read.ok ? read.value : [];
}

/**
 * The extension value after a change whose result declares `declared` assets
 * and credits `added`: the stored credits of assets that remain, then the new
 * ones, sorted by digest. Credits of assets the document no longer declares
 * are compacted away. Undefined when nothing is credited. A stored record that
 * cannot be read, or a result over the limit, fails: the caller never
 * replaces credits it could not read.
 */
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

/** A credit in a record, decoded for writing one credit at a time. */
export function decodeAssetCredit(value: Json, path: ReadonlyArray<string>): Checked<AssetCredit> {
  return decodeWith(AssetCredit, value, path);
}

/** The credit line an export carries for one credited asset, or undefined when none was stated. */
export function assetCreditLine(credit: AssetCredit): string | undefined {
  const line =
    credit.credit ?? (credit.author ? `${credit.art.kind} artwork by ${credit.author}` : undefined);
  if (line) return credit.license ? `${line} (${credit.license})` : line;
  return credit.license ? `${credit.art.kind} artwork (${credit.license})` : undefined;
}
