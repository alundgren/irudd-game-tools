// Typed edit operations. An edit command carries a list of these; they apply
// in order to a working copy and the whole list either commits as one
// revision or changes nothing.
//
// Transient editor state (selection, camera, drag previews, surface picks) is
// never part of an operation. A pick in world space is resolved against the
// revision the command names (`sculpt.at`), and only the resolved, part-local
// values are stored.

import { Schema } from "effect";
import { diagnostic, fail, ok, type Checked, type Diagnostic } from "./diagnostics.js";
import { isJsonObject, type Json } from "./json.js";
import { retireCredit } from "./credit-record.js";
import {
  affinePoint,
  compose,
  length,
  mul,
  quatMultiply,
  quatNormalize,
  sub,
  worldFrame,
  zero,
  add,
  type Frame,
  type Vec3,
} from "./geometry.js";
import { canonicalize } from "./document.js";
import {
  normalizedOffsetToWorld,
  normalizedToWorld,
  partPlacement,
  worldHalfExtent,
  worldOffsetToNormalized,
  worldToNormalized,
} from "./frames.js";
import { regenerate } from "./generation.js";
import type { Registry } from "./registry.js";
import {
  AssetEntry,
  CatalogDependency,
  CatalogId,
  Color,
  ComponentSource,
  Digest,
  Displacement,
  EditId,
  FeatureId,
  GeneratorId,
  JsonValue,
  Label,
  Namespace,
  Paint,
  Part,
  PartId,
  Pose,
  PoseId,
  Position,
  Rotation,
  Shape,
  Size,
  type CharacterDocument,
  type FeatureRequirement,
  type Part as PartType,
  type PartId as PartIdType,
} from "./schema.js";

const Finite3 = Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite]);

const op = <Tag extends string, F extends Schema.Struct.Fields>(tag: Tag, fields: F) =>
  Schema.Struct({ op: Schema.Literal(tag), ...fields });

export const PartChanges = Schema.Struct({
  label: Schema.optionalKey(Label),
  parent: Schema.optionalKey(Schema.NullOr(PartId)),
  shape: Schema.optionalKey(Shape),
  position: Schema.optionalKey(Position),
  rotation: Schema.optionalKey(Rotation),
  size: Schema.optionalKey(Size),
  color: Schema.optionalKey(Color),
  paint: Schema.optionalKey(Schema.NullOr(Paint)),
  component: Schema.optionalKey(Schema.NullOr(ComponentSource)),
});

export const Operation = Schema.Union([
  op("part.add", { part: Part }),
  op("part.remove", { part: PartId, cascade: Schema.Boolean }),
  op("part.set", { part: PartId, set: PartChanges }),
  op("part.rename", { part: PartId, label: Label }),
  /** A gesture: translate in the parent frame, then rotate and scale locally. */
  op("part.transform", {
    part: PartId,
    translate: Schema.optionalKey(Finite3),
    rotate: Schema.optionalKey(Rotation),
    scale: Schema.optionalKey(
      Schema.Tuple([
        Schema.Finite.check(Schema.isBetween({ minimum: 0.01, maximum: 100 })),
        Schema.Finite.check(Schema.isBetween({ minimum: 0.01, maximum: 100 })),
        Schema.Finite.check(Schema.isBetween({ minimum: 0.01, maximum: 100 })),
      ]),
    ),
  }),
  op("sculpt.set", { part: PartId, edit: Displacement }),
  op("sculpt.remove", { part: PartId, edit: EditId }),
  /** Sculpt at a world-space pick, resolved against the named revision. */
  op("sculpt.at", {
    part: PartId,
    edit: EditId,
    world: Finite3,
    offset: Finite3,
    radius: Schema.Finite.check(Schema.isBetween({ minimum: 0.0005, maximum: 100 })),
  }),
  op("pose.set", { pose: Pose }),
  op("pose.remove", { pose: PoseId }),
  op("asset.add", { asset: AssetEntry }),
  op("asset.remove", { digest: Digest }),
  op("catalog.set", { dependency: CatalogDependency }),
  op("catalog.remove", { catalog: CatalogId }),
  op("document.label", { label: Label }),
  op("extension.set", { namespace: Namespace, value: Schema.NullOr(JsonValue) }),
  op("feature.set", {
    feature: FeatureId,
    part: Schema.optionalKey(PartId),
    value: Schema.NullOr(JsonValue),
  }),
  /** Re-run the document's generator with new parameters, keeping manual edits. */
  op("generation.steer", { params: JsonValue }),
  /** Multiply the generator's `scale` parameter. */
  op("generation.scale", {
    factor: Schema.Finite.check(Schema.isBetween({ minimum: 0.05, maximum: 20 })),
  }),
  /** Switch generator or parameters; `discardEdits` resets generated parts. */
  op("generation.rebuild", {
    generator: GeneratorId,
    version: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 })),
    params: JsonValue,
    discardEdits: Schema.Boolean,
  }),
]);
export type Operation = typeof Operation.Type;

export const Operations = Schema.Array(Operation).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(256),
);

export interface OperationContext {
  readonly registry: Registry;
  /** IDs once used in this document's history; they cannot name a new part. */
  readonly retired: ReadonlySet<string>;
  /** Deterministic ID for a slot the generator adds during this command. */
  readonly idFor: (slot: string) => PartIdType;
}

/**
 * Rigid world frame of a part, composed up its parent chain in the core's
 * metric frames. It is the part's world placement only when no part on the
 * chain declares a scaled child basis; for family documents use
 * `partPlacement(doc, id, registry)`.
 */
export function partFrame(doc: CharacterDocument, id: string): Frame | undefined {
  const byId = new Map<string, PartType>(doc.parts.map((p) => [p.id, p]));
  const chain: PartType[] = [];
  let at = byId.get(id);
  while (at && chain.length <= doc.parts.length) {
    chain.unshift(at);
    at = at.parent === null ? undefined : byId.get(at.parent);
  }
  if (!chain.length) return undefined;
  return chain.reduce<Frame>(
    (frame, p) => compose(frame, { position: p.position, rotation: p.rotation }),
    worldFrame,
  );
}

/** Normalised part coordinates (fractions of the half-extents) of a world point. */
export function toPartLocal(
  doc: CharacterDocument,
  id: string,
  world: Vec3,
  registry?: Registry,
): Vec3 | undefined {
  const placement = partPlacement(doc, id, registry);
  return placement && worldToNormalized(placement, world);
}

/** World-space position and offset of a sculpted displacement. */
export function displacementInWorld(
  doc: CharacterDocument,
  partId: string,
  editId: string,
  registry?: Registry,
): { readonly at: Vec3; readonly offset: Vec3 } | undefined {
  const part = doc.parts.find((p) => p.id === partId);
  const placement = partPlacement(doc, partId, registry);
  const d = part?.sculpt.find((e) => e.id === editId);
  if (!part || !placement || !d) return undefined;
  return {
    at: normalizedToWorld(placement, d.at),
    offset: normalizedOffsetToWorld(placement, d.offset),
  };
}

/** Declare every capability the document uses, at this build's versions. */
export function requireDeclaredFeatures(
  doc: CharacterDocument,
  registry: Registry,
): CharacterDocument {
  const declared = new Map<string, number>(doc.requires.map((r) => [r.feature, r.version]));
  const want = (feature: string) => {
    if (!declared.has(feature)) declared.set(feature, registry.features.get(feature)?.version ?? 1);
  };
  want("core.parts");
  if (doc.parts.some((p) => p.sculpt.length)) want("core.sculpt");
  if (doc.poses.length) want("core.poses");
  if (doc.parts.some((p) => p.paint) || doc.assets.length) want("core.paint");
  if (doc.generation) want("core.generation");
  if (doc.catalog.length || doc.parts.some((p) => p.component)) want("core.catalog");
  for (const f of Object.keys(doc.features)) want(f);
  for (const p of doc.parts) for (const f of Object.keys(p.features)) want(f);
  const decode = Schema.decodeUnknownSync(
    Schema.Array(Schema.Struct({ feature: FeatureId, version: Schema.Int })),
  );
  const requires: ReadonlyArray<FeatureRequirement> = decode(
    [...declared].map(([feature, version]) => ({ feature, version })),
  );
  return { ...doc, requires };
}

function partIndex(
  doc: CharacterDocument,
  id: string,
  path: ReadonlyArray<string | number>,
): Checked<number> {
  const i = doc.parts.findIndex((p) => p.id === id);
  return i < 0
    ? fail([diagnostic("missing-reference", path, `There is no part ${id}.`, { part: id })])
    : ok(i);
}

function replacePart(doc: CharacterDocument, index: number, part: PartType): CharacterDocument {
  const parts = [...doc.parts];
  parts[index] = part;
  return { ...doc, parts };
}

function descendants(doc: CharacterDocument, id: string): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of doc.parts)
      if (p.parent !== null && out.has(p.parent) && !out.has(p.id)) {
        out.add(p.id);
        grew = true;
      }
  }
  return out;
}

function applyOne(
  doc: CharacterDocument,
  o: Operation,
  i: number,
  ctx: OperationContext,
): Checked<CharacterDocument> {
  const at = (...rest: Array<string | number>) => ["ops", i, ...rest];
  switch (o.op) {
    case "part.add": {
      if (doc.parts.some((p) => p.id === o.part.id))
        return fail([
          diagnostic("duplicate-id", at("part", "id"), `Part ${o.part.id} already exists.`),
        ]);
      if (ctx.retired.has(o.part.id))
        return fail([
          diagnostic(
            "retired-id",
            at("part", "id"),
            `Part ID ${o.part.id} belonged to a removed part; choose a new one.`,
          ),
        ]);
      if (o.part.slot !== undefined)
        return fail([
          diagnostic("schema", at("part", "slot"), "Only the generator assigns slots."),
        ]);
      return ok({ ...doc, parts: [...doc.parts, o.part] });
    }
    case "part.remove": {
      const index = partIndex(doc, o.part, at("part"));
      if (!index.ok) return index;
      const gone = o.cascade ? descendants(doc, o.part) : new Set<string>([o.part]);
      const problems: Diagnostic[] = [];
      if (!o.cascade)
        for (const p of doc.parts)
          if (p.parent === o.part)
            problems.push(
              diagnostic(
                "missing-reference",
                at("part"),
                `${p.label} is attached to this part. Remove with cascade.`,
                {
                  child: p.id,
                },
              ),
            );
      const poses = doc.poses.map((pose) => ({
        ...pose,
        joints: pose.joints.filter((j) => !gone.has(j.part)),
      }));
      if (!o.cascade)
        for (const pose of doc.poses)
          if (pose.joints.some((j) => gone.has(j.part)))
            problems.push(
              diagnostic(
                "missing-reference",
                at("part"),
                `Pose ${pose.label} moves this part. Remove with cascade.`,
                {
                  pose: pose.id,
                },
              ),
            );
      if (problems.length) return fail(problems);
      return ok({ ...doc, parts: doc.parts.filter((p) => !gone.has(p.id)), poses });
    }
    case "part.set":
    case "part.rename": {
      const index = partIndex(doc, o.part, at("part"));
      if (!index.ok) return index;
      const part = doc.parts[index.value];
      if (!part) return fail([]);
      const set = o.op === "part.rename" ? { label: o.label } : o.set;
      let next: PartType = { ...part };
      if (set.label !== undefined) next = { ...next, label: set.label };
      if (set.parent !== undefined) next = { ...next, parent: set.parent };
      if (set.shape !== undefined) next = { ...next, shape: set.shape };
      if (set.position !== undefined) next = { ...next, position: set.position };
      if (set.rotation !== undefined) next = { ...next, rotation: quatNormalize(set.rotation) };
      if (set.size !== undefined) next = { ...next, size: set.size };
      if (set.color !== undefined) next = { ...next, color: set.color };
      if (set.paint !== undefined) {
        const { paint: _p, ...rest } = next;
        next = set.paint === null ? rest : { ...rest, paint: set.paint };
      }
      if (set.component !== undefined) {
        const { component: _c, ...rest } = next;
        next = set.component === null ? rest : { ...rest, component: set.component };
      }
      return ok(replacePart(doc, index.value, next));
    }
    case "part.transform": {
      const index = partIndex(doc, o.part, at("part"));
      if (!index.ok) return index;
      const part = doc.parts[index.value];
      if (!part) return fail([]);
      return ok(
        replacePart(doc, index.value, {
          ...part,
          position: o.translate ? add(part.position, o.translate) : part.position,
          rotation: o.rotate ? quatNormalize(quatMultiply(part.rotation, o.rotate)) : part.rotation,
          size: o.scale ? mul(part.size, o.scale) : part.size,
        }),
      );
    }
    case "sculpt.set":
    case "sculpt.remove":
    case "sculpt.at": {
      const index = partIndex(doc, o.part, at("part"));
      if (!index.ok) return index;
      const part = doc.parts[index.value];
      if (!part) return fail([]);
      if (o.op === "sculpt.remove") {
        if (!part.sculpt.some((d) => d.id === o.edit))
          return fail([
            diagnostic("missing-reference", at("edit"), `${part.label} has no edit ${o.edit}.`),
          ]);
        return ok(
          replacePart(doc, index.value, {
            ...part,
            sculpt: part.sculpt.filter((d) => d.id !== o.edit),
          }),
        );
      }
      let edit = o.op === "sculpt.set" ? o.edit : undefined;
      if (o.op === "sculpt.at") {
        const placement = partPlacement(doc, o.part, ctx.registry);
        const local = placement && worldToNormalized(placement, o.world);
        const offset = placement && worldOffsetToNormalized(placement, o.offset);
        if (!placement || !local || !offset) return fail([]);
        const resolved = Schema.decodeUnknownResult(Displacement)({
          id: o.edit,
          at: local,
          offset,
          radius: o.radius / worldHalfExtent(placement),
        });
        if (resolved._tag === "Failure")
          return fail([
            diagnostic(
              "schema",
              at("world"),
              `The pick does not resolve to a sculptable point on ${part.label}.`,
              {
                distance: length(sub(o.world, affinePoint(placement.frame, zero))),
              },
            ),
          ]);
        edit = resolved.success;
      }
      if (!edit) return fail([]);
      const kept = edit;
      return ok(
        replacePart(doc, index.value, {
          ...part,
          sculpt: [...part.sculpt.filter((d) => d.id !== kept.id), kept],
        }),
      );
    }
    case "pose.set":
      return ok({ ...doc, poses: [...doc.poses.filter((p) => p.id !== o.pose.id), o.pose] });
    case "pose.remove":
      if (!doc.poses.some((p) => p.id === o.pose))
        return fail([diagnostic("missing-reference", at("pose"), `There is no pose ${o.pose}.`)]);
      return ok({ ...doc, poses: doc.poses.filter((p) => p.id !== o.pose) });
    case "asset.add":
      return ok({
        ...doc,
        assets: [...doc.assets.filter((a) => a.digest !== o.asset.digest), o.asset],
      });
    case "asset.remove":
      if (!doc.assets.some((a) => a.digest === o.digest))
        return fail([
          diagnostic("missing-reference", at("digest"), `There is no asset ${o.digest}.`),
        ]);
      // A picture's credit lives as long as the picture: removing it retires the credit too.
      return ok({
        ...doc,
        assets: doc.assets.filter((a) => a.digest !== o.digest),
        extensions: retireCredit(doc.extensions, o.digest),
      });
    case "catalog.set":
      return ok({
        ...doc,
        catalog: [...doc.catalog.filter((c) => c.id !== o.dependency.id), o.dependency],
      });
    case "catalog.remove":
      return ok({ ...doc, catalog: doc.catalog.filter((c) => c.id !== o.catalog) });
    case "document.label":
      return ok({ ...doc, label: o.label });
    case "extension.set": {
      const { [o.namespace]: _old, ...rest } = doc.extensions;
      return ok({
        ...doc,
        extensions: o.value === null ? rest : { ...rest, [o.namespace]: o.value },
      });
    }
    case "feature.set": {
      if (
        !ctx.registry.features.has(o.feature) ||
        ctx.registry.features.get(o.feature)?.scope === "none"
      )
        return fail([
          diagnostic(
            "unknown-feature",
            at("feature"),
            `This build has no payload feature ${o.feature}.`,
          ),
        ]);
      if (o.part === undefined) {
        const { [o.feature]: _old, ...rest } = doc.features;
        return ok({
          ...doc,
          features: o.value === null ? rest : { ...rest, [o.feature]: o.value },
        });
      }
      const index = partIndex(doc, o.part, at("part"));
      if (!index.ok) return index;
      const part = doc.parts[index.value];
      if (!part) return fail([]);
      const { [o.feature]: _old, ...rest } = part.features;
      return ok(
        replacePart(doc, index.value, {
          ...part,
          features: o.value === null ? rest : { ...rest, [o.feature]: o.value },
        }),
      );
    }
    case "generation.steer":
    case "generation.scale":
    case "generation.rebuild": {
      const g = doc.generation;
      if (!g && o.op !== "generation.rebuild")
        return fail([
          diagnostic("missing-reference", at("op"), "This document was not built by a generator."),
        ]);
      let params: Json =
        o.op === "generation.rebuild" ? o.params : o.op === "generation.steer" ? o.params : null;
      if (o.op === "generation.scale") {
        const current = g?.params;
        const value = isJsonObject(current) ? current["scale"] : undefined;
        if (!isJsonObject(current) || typeof value !== "number")
          return fail([
            diagnostic("schema", at("factor"), "This generator has no scale parameter."),
          ]);
        params = { ...current, scale: value * o.factor };
      }
      const result = g
        ? regenerate(
            doc,
            ctx.registry,
            {
              generator: o.op === "generation.rebuild" ? o.generator : g.generator,
              version: o.op === "generation.rebuild" ? o.version : g.version,
              params,
              discardEdits: o.op === "generation.rebuild" ? o.discardEdits : false,
            },
            ctx.idFor,
          )
        : fail<CharacterDocument>([
            diagnostic("missing-reference", at("op"), "Start from a generated document."),
          ]);
      if (!result.ok)
        return fail(
          result.diagnostics.map((d) =>
            d.code === "conflict" ? d : { ...d, path: at(...d.path.map(String)) },
          ),
        );
      return result;
    }
  }
}

/** Apply operations in order. The result is canonical but not yet validated. */
export function applyOperations(
  doc: CharacterDocument,
  ops: ReadonlyArray<Operation>,
  ctx: OperationContext,
): Checked<CharacterDocument> {
  let current = doc;
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i];
    if (!o) continue;
    const next = applyOne(current, o, i, ctx);
    if (!next.ok) return next;
    current = next.value;
  }
  return ok(canonicalize(requireDeclaredFeatures(current, ctx.registry)));
}

export const decodeOperations = (raw: unknown): Checked<ReadonlyArray<Operation>> => {
  const result = Schema.decodeUnknownResult(Operations, {
    onExcessProperty: "error",
    errors: "all",
  })(raw);
  if (result._tag === "Success") return ok(result.success);
  return fail([diagnostic("schema", ["ops"], result.failure.message)]);
};
