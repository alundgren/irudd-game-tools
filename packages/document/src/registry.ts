import { Schema, SchemaIssue } from "effect";
import {
  diagnostic,
  fail,
  ok,
  type Checked,
  type Diagnostic,
  type DiagnosticPath,
} from "./diagnostics.js";
import type { Vec3 } from "./geometry.js";
import type { Json } from "./json.js";
import {
  BaseSlot,
  type BaseSlotInput,
  type CatalogId,
  type Digest,
  type FeatureId,
  FeatureId as FeatureIdSchema,
  type AssetRole,
  type GeneratorId,
  GeneratorId as GeneratorIdSchema,
  type Part,
  strictParse,
} from "./schema.js";

export interface FeatureReference {
  readonly kind: "part" | "pose" | "asset";
  readonly id: string;
  readonly path: DiagnosticPath;
  readonly role?: AssetRole;
}

export interface FeatureDefinition {
  readonly id: FeatureId;
  readonly version: number;
  readonly scope: "document" | "part" | "both" | "none";
  readonly validate: (payload: Json) => Checked<Json>;
  readonly upgrades: ReadonlyArray<(payload: Json) => Json>;
  readonly references: (payload: Json) => ReadonlyArray<FeatureReference>;
  readonly childBasis?: (payload: Json, size: Vec3) => Vec3 | undefined;
}

export interface GeneratorDefinition {
  readonly id: GeneratorId;
  readonly version: number;
  readonly label: string;
  readonly params: (raw: Json) => Checked<Json>;
  readonly generate: (params: Json) => ReadonlyArray<BaseSlot>;
  readonly reseat?: (before: Json, after: Json) => Reseat;
}

export type Reseat = (part: Part, parent: string) => Vec3 | undefined;

export interface Registry {
  readonly features: ReadonlyMap<string, FeatureDefinition>;
  readonly generators: ReadonlyMap<string, GeneratorDefinition>;
}

export function issueDiagnostics(issue: SchemaIssue.Issue, prefix: DiagnosticPath): Diagnostic[] {
  const formatted = SchemaIssue.makeFormatterStandardSchemaV1()(issue);
  return formatted.issues.map((i) =>
    diagnostic(
      "schema",
      [
        ...prefix,
        ...(i.path ?? []).map((k) => {
          const key = typeof k === "object" && k !== null && "key" in k ? k.key : k;
          return typeof key === "number" ? key : String(key);
        }),
      ],
      i.message,
    ),
  );
}

export function decodeWith<S extends Schema.Decoder<unknown>>(
  schema: S,
  value: unknown,
  prefix: DiagnosticPath = [],
): Checked<S["Type"]> {
  const result = Schema.decodeUnknownResult(schema, strictParse)(value);
  if (result._tag === "Success") return ok(result.success);
  return fail(issueDiagnostics(result.failure.issue, prefix));
}

export function defineFeature<S extends Schema.Decoder<unknown>>(spec: {
  readonly id: string;
  readonly version: number;
  readonly scope: "document" | "part" | "both";
  readonly schema: S;
  readonly toJson: (value: S["Type"]) => Json;
  readonly upgrades?: ReadonlyArray<(payload: Json) => Json>;
  readonly references?: (value: S["Type"]) => ReadonlyArray<FeatureReference>;
  readonly childBasis?: (value: S["Type"], size: Vec3) => Vec3 | undefined;
}): FeatureDefinition {
  const id = Schema.decodeUnknownSync(FeatureIdSchema)(spec.id);
  const references = spec.references;
  const childBasis = spec.childBasis;
  return {
    id,
    version: spec.version,
    scope: spec.scope,
    validate: (payload) => {
      const decoded = decodeWith(spec.schema, payload);
      return decoded.ok ? ok(spec.toJson(decoded.value)) : decoded;
    },
    upgrades: spec.upgrades ?? [],
    references: (payload) => {
      if (!references) return [];
      const decoded = decodeWith(spec.schema, payload);
      return decoded.ok ? references(decoded.value) : [];
    },
    ...(childBasis
      ? {
          childBasis: (payload: Json, size: Vec3) => {
            const decoded = decodeWith(spec.schema, payload);
            return decoded.ok ? childBasis(decoded.value, size) : undefined;
          },
        }
      : {}),
  };
}

export function defineGenerator<S extends Schema.Decoder<unknown>>(spec: {
  readonly id: string;
  readonly version: number;
  readonly label: string;
  readonly schema: S;
  readonly toJson: (value: S["Type"]) => Json;
  readonly generate: (params: S["Type"]) => ReadonlyArray<BaseSlotInput>;
  readonly reseat?: (before: S["Type"], after: S["Type"]) => Reseat;
}): GeneratorDefinition {
  const id = Schema.decodeUnknownSync(GeneratorIdSchema)(spec.id);
  const slots = Schema.decodeUnknownSync(Schema.Array(BaseSlot));
  return {
    id,
    version: spec.version,
    label: spec.label,
    params: (raw) => {
      const decoded = decodeWith(spec.schema, raw, ["params"]);
      return decoded.ok ? ok(spec.toJson(decoded.value)) : decoded;
    },
    generate: (params) => {
      const decoded = decodeWith(spec.schema, params, ["params"]);
      if (!decoded.ok) throw new Error(decoded.diagnostics.map((d) => d.message).join(" "));
      return slots(spec.generate(decoded.value));
    },
    ...(spec.reseat
      ? {
          reseat: (before, after) => {
            const read = (params: Json) => {
              const decoded = decodeWith(spec.schema, params, ["params"]);
              if (!decoded.ok) throw new Error(decoded.diagnostics.map((d) => d.message).join(" "));
              return decoded.value;
            };
            return spec.reseat?.(read(before), read(after)) ?? (() => undefined);
          },
        }
      : {}),
  };
}

export const coreFeatures = [
  "core.parts",
  "core.sculpt",
  "core.poses",
  "core.paint",
  "core.generation",
  "core.catalog",
] as const;

function coreFeature(name: string): FeatureDefinition {
  return {
    id: Schema.decodeUnknownSync(FeatureIdSchema)(name),
    version: 1,
    scope: "none",
    validate: (payload) => ok(payload),
    upgrades: [],
    references: () => [],
  };
}

export function createRegistry(
  extra: {
    readonly features?: ReadonlyArray<FeatureDefinition>;
    readonly generators?: ReadonlyArray<GeneratorDefinition>;
  } = {},
): Registry {
  const features = new Map<string, FeatureDefinition>();
  for (const name of coreFeatures) features.set(name, coreFeature(name));
  for (const f of extra.features ?? []) {
    if (features.has(f.id)) throw new Error("Feature registered twice: " + f.id);
    if (f.version !== f.upgrades.length + 1)
      throw new Error(
        `Feature ${f.id} at version ${f.version} needs ${f.version - 1} upgrade codecs.`,
      );
    features.set(f.id, f);
  }
  const generators = new Map<string, GeneratorDefinition>();
  for (const g of extra.generators ?? []) {
    const key = `${g.id}@${g.version}`;
    if (generators.has(key)) throw new Error("Generator registered twice: " + key);
    generators.set(key, g);
  }
  return { features, generators };
}

export function findGenerator(
  registry: Registry,
  id: string,
  version: number,
): GeneratorDefinition | undefined {
  return registry.generators.get(`${id}@${version}`);
}

export interface StoredAsset {
  readonly byteLength: number;
  readonly mediaType: string;
}

export interface Environment {
  readonly registry: Registry;
  readonly assets: { readonly lookup: (digest: Digest) => StoredAsset | undefined };
  readonly catalog: { readonly lookup: (id: CatalogId) => Digest | undefined };
}

export function memoryEnvironment(
  registry: Registry,
  assets: ReadonlyArray<readonly [Digest, StoredAsset]> = [],
  catalog: ReadonlyArray<readonly [CatalogId, Digest]> = [],
): Environment {
  const blobs = new Map(assets);
  const installed = new Map(catalog);
  return {
    registry,
    assets: { lookup: (digest) => blobs.get(digest) },
    catalog: { lookup: (id) => installed.get(id) },
  };
}
