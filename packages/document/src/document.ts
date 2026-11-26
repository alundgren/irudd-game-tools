import { Schema } from "effect";
import {
  diagnostic,
  fail,
  ok,
  type Checked,
  type Diagnostic,
  type DiagnosticPath,
} from "./diagnostics.js";
import { isJson, isJsonArray, isJsonObject, type Json, type JsonObject } from "./json.js";
import { digestJson, sha256Digest } from "./sha256.js";
import {
  CharacterDocument,
  Digest as DigestSchema,
  documentFormat,
  documentVersion,
  rasterMediaTypes,
  type AssetEntry,
  type BaseSlot,
  type Digest,
  type FeatureRequirement,
  type Part,
} from "./schema.js";
import {
  decodeWith,
  findGenerator,
  type Environment,
  type FeatureDefinition,
  type Registry,
} from "./registry.js";

const byKey =
  <T>(key: (item: T) => string) =>
  (a: T, b: T): number => {
    const x = key(a);
    const y = key(b);
    return x < y ? -1 : x > y ? 1 : 0;
  };

export function canonicalize(doc: CharacterDocument): CharacterDocument {
  return {
    ...doc,
    requires: [...doc.requires].sort(byKey((r) => r.feature)),
    catalog: [...doc.catalog].sort(byKey((c) => c.id)),
    assets: [...doc.assets].sort(byKey((a) => a.digest)),
    parts: [...doc.parts]
      .map((p) => ({ ...p, sculpt: [...p.sculpt].sort(byKey((d) => d.id)) }))
      .sort(byKey((p) => p.id)),
    poses: [...doc.poses]
      .map((pose) => ({ ...pose, joints: [...pose.joints].sort(byKey((j) => j.part)) }))
      .sort(byKey((p) => p.id)),
  };
}

export function documentJson(doc: CharacterDocument): Json {
  return doc;
}

export function documentDigest(doc: CharacterDocument): Digest {
  return digestBrand(digestJson(documentJson(doc)));
}

const decodeDigest = Schema.decodeUnknownSync(DigestSchema);
export function digestBrand(value: `sha256:${string}`): Digest {
  return decodeDigest(value);
}

export function baseDigest(slots: ReadonlyArray<BaseSlot>): Digest {
  return digestBrand(digestJson(slots));
}

function readRequirements(
  raw: JsonObject,
  registry: Registry,
): Checked<{ readonly upgraded: JsonObject }> {
  const diagnostics: Diagnostic[] = [];
  const requires = raw["requires"];
  if (!isJsonArray(requires)) return ok({ upgraded: raw });
  const plan: Array<{ def: FeatureDefinition; from: number }> = [];
  requires.forEach((entry: Json, i: number) => {
    if (!isJsonObject(entry)) return;
    const feature = entry["feature"];
    const version = entry["version"];
    if (typeof feature !== "string" || typeof version !== "number") return;
    const def = registry.features.get(feature);
    if (!def) {
      diagnostics.push(
        diagnostic(
          "unknown-feature",
          ["requires", i],
          `This build does not support the required feature ${feature}.`,
          {
            feature,
            version,
          },
        ),
      );
      return;
    }
    if (version > def.version) {
      diagnostics.push(
        diagnostic(
          "unsupported-feature-version",
          ["requires", i],
          `${feature} version ${version} needs a newer build; this build reads up to version ${def.version}.`,
          { feature, version, supported: def.version },
        ),
      );
      return;
    }
    if (Number.isInteger(version) && version >= 1 && version < def.version)
      plan.push({ def, from: version });
  });
  if (diagnostics.length) return fail(diagnostics);
  if (!plan.length) return ok({ upgraded: raw });

  const lift = (def: FeatureDefinition, from: number, payload: Json): Json => {
    let value = payload;
    for (let v = from; v < def.version; v++) {
      const step = def.upgrades[v - 1];
      if (step) value = step(value);
    }
    return value;
  };
  const upgradeFeatures = (features: Json | undefined): Json | undefined => {
    if (!isJsonObject(features)) return features;
    const next: Record<string, Json> = { ...features };
    for (const { def, from } of plan) {
      const payload = features[def.id];
      if (payload !== undefined) next[def.id] = lift(def, from, payload);
    }
    return next;
  };
  const versions = new Map<string, number>(plan.map(({ def }) => [def.id, def.version]));
  const upgraded: Record<string, Json> = { ...raw };
  upgraded["requires"] = requires.map((entry: Json) => {
    if (!isJsonObject(entry) || typeof entry["feature"] !== "string") return entry;
    const v = versions.get(entry["feature"]);
    return v === undefined ? entry : { ...entry, version: v };
  });
  const docFeatures = upgradeFeatures(raw["features"]);
  if (docFeatures !== undefined) upgraded["features"] = docFeatures;
  const parts = raw["parts"];
  if (isJsonArray(parts))
    upgraded["parts"] = parts.map((p: Json) => {
      if (!isJsonObject(p)) return p;
      const features = upgradeFeatures(p["features"]);
      return features === undefined ? p : { ...p, features };
    });
  return ok({ upgraded });
}

function coreUses(doc: CharacterDocument): string[] {
  const used = ["core.parts"];
  if (doc.parts.some((p) => p.sculpt.length)) used.push("core.sculpt");
  if (doc.poses.length) used.push("core.poses");
  if (doc.parts.some((p) => p.paint) || doc.assets.length) used.push("core.paint");
  if (doc.generation) used.push("core.generation");
  if (doc.catalog.length || doc.parts.some((p) => p.component)) used.push("core.catalog");
  return used;
}

function checkFeatures(doc: CharacterDocument, registry: Registry): Checked<CharacterDocument> {
  const diagnostics: Diagnostic[] = [];
  const declared = new Map<string, number>(
    doc.requires.map((r: FeatureRequirement) => [r.feature, r.version]),
  );
  doc.requires.forEach((r, i) => {
    if (doc.requires.findIndex((q) => q.feature === r.feature) !== i)
      diagnostics.push(
        diagnostic("duplicate-id", ["requires", i], `${r.feature} is declared twice.`),
      );
  });
  for (const feature of coreUses(doc))
    if (!declared.has(feature))
      diagnostics.push(
        diagnostic(
          "feature-not-declared",
          ["requires"],
          `The document uses ${feature} but does not declare it.`,
          {
            feature,
          },
        ),
      );

  const validatePayloads = (
    features: Readonly<Record<string, Json>>,
    scope: "document" | "part",
    prefix: ReadonlyArray<string | number>,
  ): Record<string, Json> => {
    const out: Record<string, Json> = {};
    for (const [id, payload] of Object.entries(features)) {
      const def = registry.features.get(id);
      if (!def) {
        diagnostics.push(
          diagnostic("unknown-feature", [...prefix, id], `Unknown feature payload ${id}.`),
        );
        continue;
      }
      if (!declared.has(id))
        diagnostics.push(
          diagnostic(
            "feature-not-declared",
            [...prefix, id],
            `The document uses ${id} but does not declare it.`,
            {
              feature: id,
            },
          ),
        );
      if (def.scope !== scope && def.scope !== "both") {
        diagnostics.push(
          diagnostic("schema", [...prefix, id], `${id} payloads do not belong on a ${scope}.`),
        );
        continue;
      }
      const checked = def.validate(payload);
      if (checked.ok) out[id] = checked.value;
      else
        for (const d of checked.diagnostics)
          diagnostics.push(diagnostic(d.code, [...prefix, id, ...d.path], d.message));
    }
    return out;
  };

  const features = validatePayloads(doc.features, "document", ["features"]);
  const parts = doc.parts.map((p, i) => ({
    ...p,
    features: validatePayloads(p.features, "part", ["parts", i, "features"]),
  }));

  if (doc.generation) {
    const g = doc.generation;
    const def = findGenerator(registry, g.generator, g.version);
    if (!def)
      diagnostics.push(
        diagnostic(
          "unsupported-generator",
          ["generation", "generator"],
          `This build has no generator ${g.generator} version ${g.version}.`,
          { generator: g.generator, version: g.version },
        ),
      );
    else {
      const params = def.params(g.params);
      if (!params.ok)
        for (const d of params.diagnostics)
          diagnostics.push(diagnostic(d.code, ["generation", ...d.path], d.message));
    }
    if (baseDigest(g.base.slots) !== g.base.digest)
      diagnostics.push(
        diagnostic(
          "base-mismatch",
          ["generation", "base", "digest"],
          "The stored generator base does not match its digest.",
        ),
      );
  }
  return diagnostics.length ? fail(diagnostics) : ok({ ...doc, features, parts });
}

function checkIntegrity(doc: CharacterDocument, registry: Registry): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const parts = new Map<string, Part>();
  doc.parts.forEach((p, i) => {
    if (parts.has(p.id))
      diagnostics.push(
        diagnostic("duplicate-id", ["parts", i, "id"], `Part ${p.id} appears twice.`),
      );
    parts.set(p.id, p);
  });
  const assets = new Map<string, AssetEntry>();
  doc.assets.forEach((a, i) => {
    if (assets.has(a.digest))
      diagnostics.push(
        diagnostic("duplicate-id", ["assets", i, "digest"], `Asset ${a.digest} appears twice.`),
      );
    assets.set(a.digest, a);
  });
  const bound = new Set<string>();
  const catalogs = new Set<string>();
  doc.catalog.forEach((c, i) => {
    if (catalogs.has(c.id))
      diagnostics.push(
        diagnostic("duplicate-id", ["catalog", i, "id"], `Catalog ${c.id} appears twice.`),
      );
    catalogs.add(c.id);
  });
  const poses = new Set<string>();
  doc.poses.forEach((pose, i) => {
    if (poses.has(pose.id))
      diagnostics.push(
        diagnostic("duplicate-id", ["poses", i, "id"], `Pose ${pose.id} appears twice.`),
      );
    poses.add(pose.id);
    const joints = new Set<string>();
    pose.joints.forEach((j, k) => {
      if (!parts.has(j.part))
        diagnostics.push(
          diagnostic(
            "missing-reference",
            ["poses", i, "joints", k, "part"],
            `Pose ${pose.id} names a missing part ${j.part}.`,
            {
              pose: pose.id,
              part: j.part,
            },
          ),
        );
      if (joints.has(j.part))
        diagnostics.push(
          diagnostic(
            "duplicate-id",
            ["poses", i, "joints", k, "part"],
            `Pose ${pose.id} names ${j.part} twice.`,
          ),
        );
      joints.add(j.part);
    });
  });

  const checkReferences = (feature: string, payload: Json, prefix: DiagnosticPath): void => {
    for (const ref of registry.features.get(feature)?.references(payload) ?? []) {
      const path = [...prefix, ...ref.path];
      const asset = ref.kind === "asset" ? assets.get(ref.id) : undefined;
      const known =
        ref.kind === "part"
          ? parts.has(ref.id)
          : ref.kind === "pose"
            ? poses.has(ref.id)
            : asset !== undefined;
      if (!known) {
        diagnostics.push(
          diagnostic(
            "missing-reference",
            path,
            `${feature} names a missing ${ref.kind} ${ref.id}.`,
            {
              kind: ref.kind,
              id: ref.id,
            },
          ),
        );
        continue;
      }
      if (!asset) continue;
      if (ref.role === undefined) {
        if (asset.role === "portrait-plate")
          diagnostics.push(
            diagnostic(
              "asset-mismatch",
              path,
              `${feature} names ${ref.id}, a portrait plate rather than a sheet.`,
              { asset: ref.id },
            ),
          );
      } else if (asset.role !== ref.role)
        diagnostics.push(
          diagnostic(
            "asset-mismatch",
            path,
            `${feature} needs a ${ref.role} but ${ref.id} is declared as a ${asset.role}.`,
            { asset: ref.id, role: ref.role },
          ),
        );
      else if (!rasterMediaTypes.includes(asset.mediaType))
        diagnostics.push(
          diagnostic(
            "asset-mismatch",
            path,
            `${feature} loads ${ref.id} as an image, but it is ${asset.mediaType}.`,
            { asset: ref.id, mediaType: asset.mediaType },
          ),
        );
      else bound.add(ref.id);
    }
  };

  const slots = new Map<string, string>();
  const baseSlots = new Set((doc.generation?.base.slots ?? []).map((s) => s.slot));
  doc.parts.forEach((p, i) => {
    if (p.parent !== null && !parts.has(p.parent))
      diagnostics.push(
        diagnostic(
          "missing-reference",
          ["parts", i, "parent"],
          `Part ${p.id} is attached to a missing part ${p.parent}.`,
          {
            part: p.id,
            parent: p.parent,
          },
        ),
      );
    if (p.slot !== undefined) {
      if (slots.has(p.slot))
        diagnostics.push(
          diagnostic("duplicate-id", ["parts", i, "slot"], `Slot ${p.slot} is materialised twice.`),
        );
      slots.set(p.slot, p.id);
      if (!baseSlots.has(p.slot))
        diagnostics.push(
          diagnostic(
            "missing-reference",
            ["parts", i, "slot"],
            `Part ${p.id} names slot ${p.slot}, which the generator base lacks.`,
          ),
        );
    }
    if (p.paint) {
      for (const [key, digest] of [
        ["atlas", p.paint.atlas],
        ["occluder", p.paint.occluder],
      ] as const)
        if (digest !== undefined && !assets.has(digest))
          diagnostics.push(
            diagnostic(
              "missing-reference",
              ["parts", i, "paint", key],
              `Part ${p.id} paints with an undeclared asset ${digest}.`,
              {
                part: p.id,
                asset: digest,
              },
            ),
          );
        else if (digest !== undefined && assets.get(digest)?.role === "portrait-plate")
          diagnostics.push(
            diagnostic(
              "asset-mismatch",
              ["parts", i, "paint", key],
              `Part ${p.id} paints with ${digest}, a portrait plate rather than a sheet.`,
              { part: p.id, asset: digest },
            ),
          );
    }
    if (p.component && !catalogs.has(p.component.catalog))
      diagnostics.push(
        diagnostic(
          "missing-reference",
          ["parts", i, "component", "catalog"],
          `Part ${p.id} comes from catalog ${p.component.catalog}, which the document does not depend on.`,
        ),
      );
    for (const [feature, payload] of Object.entries(p.features))
      checkReferences(feature, payload, ["parts", i, "features", feature]);
  });
  for (const [feature, payload] of Object.entries(doc.features))
    checkReferences(feature, payload, ["features", feature]);
  doc.assets.forEach((a, i) => {
    if (a.role === "portrait-plate" && !bound.has(a.digest))
      diagnostics.push(
        diagnostic(
          "missing-reference",
          ["assets", i, "role"],
          `No portrait fit binds the portrait plate ${a.digest}.`,
          { asset: a.digest },
        ),
      );
  });

  for (const p of doc.parts) {
    const seen = new Set<string>([p.id]);
    let at = p.parent;
    while (at !== null) {
      if (seen.has(at)) {
        diagnostics.push(
          diagnostic(
            "reference-cycle",
            ["parts", p.id, "parent"],
            `Part ${p.id} is its own ancestor.`,
          ),
        );
        break;
      }
      seen.add(at);
      at = parts.get(at)?.parent ?? null;
    }
  }

  if (doc.generation) {
    const base = new Map(doc.generation.base.slots.map((s) => [s.slot, s]));
    doc.generation.base.slots.forEach((s, i) => {
      if (s.parent !== null && !base.has(s.parent))
        diagnostics.push(
          diagnostic(
            "missing-reference",
            ["generation", "base", "slots", i, "parent"],
            `Slot ${s.slot} has a missing parent.`,
          ),
        );
    });
  }
  return diagnostics;
}

export function checkEnvironment(doc: CharacterDocument, env: Environment): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  doc.assets.forEach((a) => {
    const stored = env.assets.lookup(a.digest);
    if (!stored)
      diagnostics.push(
        diagnostic(
          "missing-asset",
          ["assets", a.digest],
          `Asset ${a.digest} is not in this project's store.`,
          { asset: a.digest },
        ),
      );
    else if (stored.byteLength !== a.byteLength || stored.mediaType !== a.mediaType)
      diagnostics.push(
        diagnostic(
          "asset-mismatch",
          ["assets", a.digest],
          `Stored asset ${a.digest} differs from its declaration.`,
          {
            asset: a.digest,
            declared: { byteLength: a.byteLength, mediaType: a.mediaType },
            stored: { byteLength: stored.byteLength, mediaType: stored.mediaType },
          },
        ),
      );
  });
  doc.catalog.forEach((c) => {
    const installed = env.catalog.lookup(c.id);
    if (!installed)
      diagnostics.push(
        diagnostic("catalog-missing", ["catalog", c.id], `Catalog ${c.id} is not installed.`, {
          catalog: c.id,
        }),
      );
    else if (installed !== c.digest)
      diagnostics.push(
        diagnostic(
          "catalog-mismatch",
          ["catalog", c.id],
          `Installed catalog ${c.id} has different content.`,
          {
            catalog: c.id,
            required: c.digest,
            installed,
          },
        ),
      );
  });
  return diagnostics;
}

export function verifyAssetBytes(entry: AssetEntry, bytes: Uint8Array): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (bytes.length !== entry.byteLength)
    diagnostics.push(
      diagnostic(
        "asset-mismatch",
        ["byteLength"],
        `Asset ${entry.digest} has ${bytes.length} bytes, not ${entry.byteLength}.`,
      ),
    );
  const actual = sha256Digest(bytes);
  if (actual !== entry.digest)
    diagnostics.push(
      diagnostic(
        "asset-mismatch",
        ["digest"],
        `Asset bytes hash to ${actual}, not ${entry.digest}.`,
        { actual },
      ),
    );
  return diagnostics;
}

export interface ReadOptions {
  readonly registry: Registry;
  readonly environment?: Environment;
}

export function readDocument(raw: unknown, options: ReadOptions): Checked<CharacterDocument> {
  if (!isJson(raw) || !isJsonObject(raw))
    return fail([diagnostic("schema", [], "A character document is a JSON object.")]);
  if (raw["format"] !== documentFormat)
    return fail([
      diagnostic("unsupported-format", ["format"], `Expected format ${documentFormat}.`),
    ]);
  const version = raw["version"];
  if (typeof version === "number" && version > documentVersion)
    return fail([
      diagnostic(
        "unsupported-format",
        ["version"],
        `Document version ${version} needs a newer build; this build reads version ${documentVersion}.`,
        { version, supported: documentVersion },
      ),
    ]);
  const requirements = readRequirements(raw, options.registry);
  if (!requirements.ok) return requirements;
  const decoded = decodeWith(CharacterDocument, requirements.value.upgraded);
  if (!decoded.ok) return decoded;
  const featured = checkFeatures(decoded.value, options.registry);
  if (!featured.ok) return featured;
  const doc = canonicalize(featured.value);
  const integrity = checkIntegrity(doc, options.registry);
  if (integrity.length) return fail(integrity);
  if (options.environment) {
    const stored = checkEnvironment(doc, options.environment);
    if (stored.length) return fail(stored);
  }
  return ok(doc);
}

export function validateDocument(
  doc: CharacterDocument,
  options: ReadOptions,
): Checked<CharacterDocument> {
  return readDocument(documentJson(doc), options);
}
