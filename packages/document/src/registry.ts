// Feature and generator registry.
//
// The core never imports a character family. Families register features (their
// payload schema, version, upgrade codecs and reference fields) and generators
// (pure functions from validated parameters to a materialised slot list). The
// document decoder composes the registered schemas, so a later family extends
// the same validator instead of adding another one.

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

/** A reference a family payload makes to another document entity. */
export interface FeatureReference {
  readonly kind: "part" | "pose" | "asset";
  readonly id: string;
  /** Path inside the payload, for diagnostics. */
  readonly path: DiagnosticPath;
  /** For an asset: the role it must be declared with. Such a binding loads a raster image. */
  readonly role?: AssetRole;
}

export interface FeatureDefinition {
  readonly id: FeatureId;
  /** The version this build reads and writes. */
  readonly version: number;
  /** Where payloads may appear. Core features carry no payload. */
  readonly scope: "document" | "part" | "both" | "none";
  /** Validate and normalise a current-version payload. */
  readonly validate: (payload: Json) => Checked<Json>;
  /**
   * Upgrade codecs. `upgrades[n - 1]` turns a version-n payload into version n+1.
   * A document declaring an older version is upgraded on read; a newer version
   * is rejected with an explicit capability error.
   */
  readonly upgrades: ReadonlyArray<(payload: Json) => Json>;
  readonly references: (payload: Json) => ReadonlyArray<FeatureReference>;
  /**
   * How a part carrying this payload attaches its children: the metres one
   * unit of the children's basis spans along each of the part's axes. Without
   * a declaring feature the basis is the part's rigid metric frame ([1, 1, 1]).
   * At most one feature on a part may declare a basis.
   */
  readonly childBasis?: (payload: Json, size: Vec3) => Vec3 | undefined;
}

export interface GeneratorDefinition {
  readonly id: GeneratorId;
  readonly version: number;
  readonly label: string;
  /** Validate and normalise raw parameters. */
  readonly params: (raw: Json) => Checked<Json>;
  /** Pure and deterministic: equal parameters always give equal slots. */
  readonly generate: (params: Json) => ReadonlyArray<BaseSlot>;
  /**
   * Where a hand-made part hanging from a generated slot sits once the
   * parameters change from `before` to `after`, or undefined to keep its
   * position. A generator whose output carries sockets, such as an adult's
   * shoulder blades, moves the parts seated on them.
   */
  readonly reseat?: (before: Json, after: Json) => Reseat;
}

/** The new position of a hand-made `part` under the slot `parent`, or undefined to keep it. */
export type Reseat = (part: Part, parent: string) => Vec3 | undefined;

export interface Registry {
  readonly features: ReadonlyMap<string, FeatureDefinition>;
  /** Keyed by `${id}@${version}`. */
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

/** Decode with a schema, returning its value or field-specific diagnostics. */
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
  /** Schema for the current version. Its decoded value must be JSON. */
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
      // Validate the generator's own output so a faulty generator cannot write
      // an invalid base into a document.
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

/** Capabilities every document built by this version may declare. */
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

// ── Storage environment ────────────────────────────────────────────────────

export interface StoredAsset {
  readonly byteLength: number;
  readonly mediaType: string;
}

/**
 * What the document package needs from storage. The project service supplies
 * the real content-addressed blob store and installed catalog; the package
 * never reads files itself.
 */
export interface Environment {
  readonly registry: Registry;
  /** Complete, hash-verified blobs available to this project. */
  readonly assets: { readonly lookup: (digest: Digest) => StoredAsset | undefined };
  /** Installed catalog content digests. */
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
