// Field-level addressing, diffs and guarded patches.
//
// A change names one atomic unit of the document by identifier, never by array
// index, so it keeps its meaning when other entities are added or removed:
//
//   ["label"] ["requires"] ["catalog"] ["generation"]
//   ["features", feature] ["extensions", namespace]
//   ["extensions", "irudd.asset-credits", digest]   one picture's credit
//   ["parts", id]                         whole part (add or remove)
//   ["parts", id, field]                  label parent shape position rotation size
//                                         color paint slot component
//   ["parts", id, "sculpt", editId]       one displacement
//   ["parts", id, "features", feature]    one family payload
//   ["poses", id] ["assets", digest]
//
// Undo, proposals and conflict reports all use these paths. A patch carries the
// value it expects to replace, so applying it to a document that has moved on
// reports exactly which fields conflict.
//
// The asset-credit record is the one extension addressed inside: a diff between
// two records in their written form names each credit, so concurrent proposals
// that credit different pictures merge. Two changes that leave one credit in
// the same state agree; any other difference at a credit is a conflict. A
// record in any other form changes as a whole, as every other extension does.

import { Schema } from "effect";
import { diagnostic, fail, ok, type Checked, type Diagnostic } from "./diagnostics.js";
import { isJsonObject, jsonEqual, type Json, type JsonObject } from "./json.js";
import { assetCreditsNamespace, creditEntries, creditRecord } from "./credit-record.js";
import { decodeAssetCredit } from "./credits.js";
import { canonicalize } from "./document.js";
import { decodeWith } from "./registry.js";
import {
  AssetEntry,
  CatalogDependency,
  Color,
  ComponentSource,
  Displacement,
  FeatureRequirement,
  Generation,
  JsonValue,
  Label,
  Paint,
  Part,
  PartId,
  Position,
  Pose,
  Rotation,
  Shape,
  Size,
  SlotKey,
  type CharacterDocument,
} from "./schema.js";

export type Path = ReadonlyArray<string>;

export type Change = {
  readonly path: Path;
  /** Absent when the path did not exist before. */
  readonly before?: Json;
  /** Absent when the change removes the path. */
  readonly after?: Json;
};

export const ChangeSchema = Schema.Struct({
  path: Schema.Array(Schema.String).check(Schema.isMinLength(1), Schema.isMaxLength(4)),
  before: Schema.optionalKey(JsonValue),
  after: Schema.optionalKey(JsonValue),
});

export const partFields = [
  "label",
  "parent",
  "shape",
  "position",
  "rotation",
  "size",
  "color",
  "paint",
  "slot",
  "component",
] as const;
export type PartField = (typeof partFields)[number];
const optionalPartFields = new Set<string>(["paint", "slot", "component"]);

const partFieldSchemas = {
  label: Label,
  parent: Schema.NullOr(PartId),
  shape: Shape,
  position: Position,
  rotation: Rotation,
  size: Size,
  color: Color,
  paint: Paint,
  slot: SlotKey,
  component: ComponentSource,
} as const;

export function pathKey(path: Path): string {
  return path.join("\u0000");
}

/** True when one path addresses the other or something inside it. */
export function pathsOverlap(a: Path, b: Path): boolean {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
  return true;
}

function isPartField(name: string | undefined): name is PartField {
  return partFields.some((f) => f === name);
}

export function getAt(doc: CharacterDocument, path: Path): Json | undefined {
  const [head, id, field, sub] = path;
  switch (head) {
    case "label":
      return path.length === 1 ? doc.label : undefined;
    case "requires":
      return path.length === 1 ? doc.requires : undefined;
    case "catalog":
      return path.length === 1 ? doc.catalog : undefined;
    case "generation":
      return path.length === 1 ? doc.generation : undefined;
    case "features":
      return path.length === 2 && id !== undefined ? doc.features[id] : undefined;
    case "extensions":
      if (isCreditPath(path) && field !== undefined)
        return creditEntries(doc.extensions[assetCreditsNamespace])?.get(field);
      return path.length === 2 && id !== undefined ? doc.extensions[id] : undefined;
    case "poses":
      return path.length === 2 ? doc.poses.find((p) => p.id === id) : undefined;
    case "assets":
      return path.length === 2 ? doc.assets.find((a) => a.digest === id) : undefined;
    case "parts": {
      const part = doc.parts.find((p) => p.id === id);
      if (!part) return undefined;
      if (path.length === 2) return part;
      if (path.length === 3 && isPartField(field)) return part[field];
      if (path.length === 4 && field === "sculpt") return part.sculpt.find((d) => d.id === sub);
      if (path.length === 4 && field === "features" && sub !== undefined) return part.features[sub];
      return undefined;
    }
    default:
      return undefined;
  }
}

function badPath(path: Path): Diagnostic {
  return diagnostic("schema", path, `Unknown document path ${path.join("/")}.`);
}

function decoded<T>(result: Checked<T>, path: Path): Checked<T> {
  return result.ok
    ? result
    : fail(result.diagnostics.map((d) => diagnostic(d.code, [...path, ...d.path], d.message)));
}

function without<T>(items: ReadonlyArray<T>, match: (item: T) => boolean): T[] {
  return items.filter((item) => !match(item));
}

function setPartField(
  part: Part,
  field: PartField,
  value: Json | undefined,
  path: Path,
): Checked<Part> {
  if (value === undefined) {
    if (!optionalPartFields.has(field))
      return fail([diagnostic("schema", path, `A part always has a ${field}.`)]);
    if (field === "paint") {
      const { paint: _paint, ...rest } = part;
      return ok(rest);
    }
    if (field === "slot") {
      const { slot: _slot, ...rest } = part;
      return ok(rest);
    }
    const { component: _component, ...rest } = part;
    return ok(rest);
  }
  switch (field) {
    case "label": {
      const v = decoded(decodeWith(partFieldSchemas.label, value), path);
      return v.ok ? ok({ ...part, label: v.value }) : v;
    }
    case "parent": {
      const v = decoded(decodeWith(partFieldSchemas.parent, value), path);
      return v.ok ? ok({ ...part, parent: v.value }) : v;
    }
    case "shape": {
      const v = decoded(decodeWith(partFieldSchemas.shape, value), path);
      return v.ok ? ok({ ...part, shape: v.value }) : v;
    }
    case "position": {
      const v = decoded(decodeWith(partFieldSchemas.position, value), path);
      return v.ok ? ok({ ...part, position: v.value }) : v;
    }
    case "rotation": {
      const v = decoded(decodeWith(partFieldSchemas.rotation, value), path);
      return v.ok ? ok({ ...part, rotation: v.value }) : v;
    }
    case "size": {
      const v = decoded(decodeWith(partFieldSchemas.size, value), path);
      return v.ok ? ok({ ...part, size: v.value }) : v;
    }
    case "color": {
      const v = decoded(decodeWith(partFieldSchemas.color, value), path);
      return v.ok ? ok({ ...part, color: v.value }) : v;
    }
    case "paint": {
      const v = decoded(decodeWith(partFieldSchemas.paint, value), path);
      return v.ok ? ok({ ...part, paint: v.value }) : v;
    }
    case "slot": {
      const v = decoded(decodeWith(partFieldSchemas.slot, value), path);
      return v.ok ? ok({ ...part, slot: v.value }) : v;
    }
    case "component": {
      const v = decoded(decodeWith(partFieldSchemas.component, value), path);
      return v.ok ? ok({ ...part, component: v.value }) : v;
    }
  }
}

function setPart(
  doc: CharacterDocument,
  path: Path,
  value: Json | undefined,
): Checked<CharacterDocument> {
  const [, id, field, sub] = path;
  const index = doc.parts.findIndex((p) => p.id === id);
  if (path.length === 2) {
    const rest = without(doc.parts, (p) => p.id === id);
    if (value === undefined) return ok({ ...doc, parts: rest });
    const part = decoded(decodeWith(Part, value), path);
    if (!part.ok) return part;
    if (part.value.id !== id)
      return fail([diagnostic("immutable-id", path, `A part stored at ${id} must keep that ID.`)]);
    return ok({ ...doc, parts: [...rest, part.value] });
  }
  const part = doc.parts[index];
  if (!part) return fail([diagnostic("missing-reference", path, `There is no part ${id}.`)]);
  let next: Checked<Part>;
  if (path.length === 3 && isPartField(field)) next = setPartField(part, field, value, path);
  else if (path.length === 4 && field === "sculpt") {
    const rest = without(part.sculpt, (d) => d.id === sub);
    if (value === undefined) next = ok({ ...part, sculpt: rest });
    else {
      const d = decoded(decodeWith(Displacement, value), path);
      if (!d.ok) return d;
      if (d.value.id !== sub)
        return fail([
          diagnostic("immutable-id", path, `An edit stored at ${sub} must keep that ID.`),
        ]);
      next = ok({ ...part, sculpt: [...rest, d.value] });
    }
  } else if (path.length === 4 && field === "features" && sub !== undefined) {
    const { [sub]: _old, ...rest } = part.features;
    if (value === undefined) next = ok({ ...part, features: rest });
    else {
      const v = decoded(decodeWith(JsonValue, value), path);
      if (!v.ok) return v;
      next = ok({ ...part, features: { ...rest, [sub]: v.value } });
    }
  } else return fail([badPath(path)]);
  if (!next.ok) return next;
  const parts = [...doc.parts];
  parts[index] = next.value;
  return ok({ ...doc, parts });
}

/** True for the path of one credit in the asset-credit record. */
export function isCreditPath(path: Path): boolean {
  return path.length === 3 && path[0] === "extensions" && path[1] === assetCreditsNamespace;
}

/** Set or remove one credit. A record this build cannot edit by credit is refused, never replaced. */
function setCredit(
  doc: CharacterDocument,
  path: Path,
  value: Json | undefined,
): Checked<CharacterDocument> {
  const digest = path[2] ?? "";
  const entries = creditEntries(doc.extensions[assetCreditsNamespace]);
  if (!entries)
    return fail([
      diagnostic(
        "schema",
        ["extensions", assetCreditsNamespace],
        `The document's ${assetCreditsNamespace} record is not in a form this build can change one credit in, so the credit for ${digest} cannot be written. Correct or remove the record first.`,
      ),
    ]);
  if (value === undefined) entries.delete(digest);
  else {
    const credit = decodeAssetCredit(value, path);
    if (!credit.ok) return credit;
    if (credit.value.digest !== digest || !isJsonObject(value))
      return fail([
        diagnostic("immutable-id", path, `A credit stored at ${digest} must name that digest.`),
      ]);
    entries.set(digest, value);
  }
  const { [assetCreditsNamespace]: _old, ...rest } = doc.extensions;
  const record = creditRecord(entries.values());
  return ok({
    ...doc,
    extensions: record === undefined ? rest : { ...rest, [assetCreditsNamespace]: record },
  });
}

/**
 * The credits of a record in its written form (sorted by digest, every entry
 * a valid credit, no other fields), so a diff by credit reproduces it exactly.
 * Empty for an absent record; undefined for any other form.
 */
function writtenCredits(value: Json | undefined): Map<string, JsonObject> | undefined {
  const entries = creditEntries(value);
  if (!entries || value === undefined) return entries;
  if (!jsonEqual(value, creditRecord(entries.values()))) return undefined;
  for (const [digest, entry] of entries)
    if (!decodeAssetCredit(entry, ["extensions", assetCreditsNamespace, digest]).ok)
      return undefined;
  return entries;
}

/** Set (or with `undefined`, remove) the value at a path. The result is canonical. */
export function setAt(
  doc: CharacterDocument,
  path: Path,
  value: Json | undefined,
): Checked<CharacterDocument> {
  const [head, id] = path;
  const result = ((): Checked<CharacterDocument> => {
    switch (head) {
      case "label": {
        if (path.length !== 1 || value === undefined) return fail([badPath(path)]);
        const v = decoded(decodeWith(Label, value), path);
        return v.ok ? ok({ ...doc, label: v.value }) : v;
      }
      case "requires": {
        if (path.length !== 1 || value === undefined) return fail([badPath(path)]);
        const v = decoded(decodeWith(Schema.Array(FeatureRequirement), value), path);
        return v.ok ? ok({ ...doc, requires: v.value }) : v;
      }
      case "catalog": {
        if (path.length !== 1 || value === undefined) return fail([badPath(path)]);
        const v = decoded(decodeWith(Schema.Array(CatalogDependency), value), path);
        return v.ok ? ok({ ...doc, catalog: v.value }) : v;
      }
      case "generation": {
        if (path.length !== 1) return fail([badPath(path)]);
        if (value === undefined) {
          const { generation: _g, ...rest } = doc;
          return ok(rest);
        }
        const v = decoded(decodeWith(Generation, value), path);
        return v.ok ? ok({ ...doc, generation: v.value }) : v;
      }
      case "features":
      case "extensions": {
        if (head === "extensions" && isCreditPath(path)) return setCredit(doc, path, value);
        if (path.length !== 2 || id === undefined) return fail([badPath(path)]);
        const record = head === "features" ? doc.features : doc.extensions;
        const { [id]: _old, ...rest } = record;
        let next: Record<string, Json> = rest;
        if (value !== undefined) {
          const v = decoded(decodeWith(JsonValue, value), path);
          if (!v.ok) return v;
          next = { ...rest, [id]: v.value };
        }
        // Keys are validated as FeatureId / Namespace by the document decoder.
        return ok(head === "features" ? { ...doc, features: next } : { ...doc, extensions: next });
      }
      case "poses": {
        if (path.length !== 2) return fail([badPath(path)]);
        const rest = without(doc.poses, (p) => p.id === id);
        if (value === undefined) return ok({ ...doc, poses: rest });
        const v = decoded(decodeWith(Pose, value), path);
        if (!v.ok) return v;
        if (v.value.id !== id)
          return fail([
            diagnostic("immutable-id", path, `A pose stored at ${id} must keep that ID.`),
          ]);
        return ok({ ...doc, poses: [...rest, v.value] });
      }
      case "assets": {
        if (path.length !== 2) return fail([badPath(path)]);
        const rest = without(doc.assets, (a) => a.digest === id);
        if (value === undefined) return ok({ ...doc, assets: rest });
        const v = decoded(decodeWith(AssetEntry, value), path);
        if (!v.ok) return v;
        if (v.value.digest !== id)
          return fail([
            diagnostic("immutable-id", path, `An asset stored at ${id} must have that digest.`),
          ]);
        return ok({ ...doc, assets: [...rest, v.value] });
      }
      case "parts":
        return path.length >= 2 ? setPart(doc, path, value) : fail([badPath(path)]);
      default:
        return fail([badPath(path)]);
    }
  })();
  return result.ok ? ok(canonicalize(result.value)) : result;
}

function change(path: Path, before: Json | undefined, after: Json | undefined): Change | undefined {
  if (jsonEqual(before, after)) return undefined;
  return {
    path,
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
  };
}

function keyedDiff<T extends Json>(
  out: Change[],
  prefix: Path,
  a: ReadonlyArray<T>,
  b: ReadonlyArray<T>,
  key: (item: T) => string,
): void {
  const left = new Map(a.map((x) => [key(x), x]));
  const right = new Map(b.map((x) => [key(x), x]));
  for (const id of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    const c = change([...prefix, id], left.get(id), right.get(id));
    if (c) out.push(c);
  }
}

function recordDiff(
  out: Change[],
  prefix: ReadonlyArray<string>,
  a: Readonly<Record<string, Json>>,
  b: Readonly<Record<string, Json>>,
): void {
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    if (prefix.length === 1 && prefix[0] === "extensions" && k === assetCreditsNamespace) {
      const x = writtenCredits(a[k]);
      const y = writtenCredits(b[k]);
      if (x && y) {
        creditDiff(out, x, y);
        continue;
      }
    }
    const c = change([...prefix, k], a[k], b[k]);
    if (c) out.push(c);
  }
}

function creditDiff(
  out: Change[],
  a: ReadonlyMap<string, Json>,
  b: ReadonlyMap<string, Json>,
): void {
  for (const digest of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const c = change(["extensions", assetCreditsNamespace, digest], a.get(digest), b.get(digest));
    if (c) out.push(c);
  }
}

/**
 * A whole-record change, as earlier builds wrote them, applied by credit when
 * the record moved on since: the credits it adds, changes and removes, each
 * checked on its own. Any other change is applied as it is.
 */
function byCredit(doc: CharacterDocument, c: Change): ReadonlyArray<Change> {
  if (c.path.length !== 2 || c.path[0] !== "extensions" || c.path[1] !== assetCreditsNamespace)
    return [c];
  if (jsonEqual(doc.extensions[assetCreditsNamespace], c.before)) return [c];
  const before = creditEntries(c.before);
  const after = creditEntries(c.after);
  if (!before || !after || !creditEntries(doc.extensions[assetCreditsNamespace])) return [c];
  const out: Change[] = [];
  creditDiff(out, before, after);
  return out;
}

/** Field-level difference. `applyChanges(a, diff(a, b))` yields `b`. */
export function diff(a: CharacterDocument, b: CharacterDocument): Change[] {
  const out: Change[] = [];
  for (const head of ["label", "requires", "catalog", "generation"] as const) {
    const c = change([head], getAt(a, [head]), getAt(b, [head]));
    if (c) out.push(c);
  }
  recordDiff(out, ["features"], a.features, b.features);
  recordDiff(out, ["extensions"], a.extensions, b.extensions);
  const left = new Map(a.parts.map((p) => [p.id, p]));
  const right = new Map(b.parts.map((p) => [p.id, p]));
  for (const id of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    const x = left.get(id);
    const y = right.get(id);
    if (!x || !y) {
      const c = change(["parts", id], x, y);
      if (c) out.push(c);
      continue;
    }
    for (const field of partFields) {
      const c = change(["parts", id, field], x[field], y[field]);
      if (c) out.push(c);
    }
    keyedDiff(out, ["parts", id, "sculpt"], x.sculpt, y.sculpt, (d) => d.id);
    recordDiff(out, ["parts", id, "features"], x.features, y.features);
  }
  keyedDiff(out, ["poses"], a.poses, b.poses, (p) => p.id);
  keyedDiff(out, ["assets"], a.assets, b.assets, (x) => x.digest);
  return out;
}

export function invert(changes: ReadonlyArray<Change>): Change[] {
  return [...changes].reverse().map((c) => ({
    path: c.path,
    ...(c.after === undefined ? {} : { before: c.after }),
    ...(c.before === undefined ? {} : { after: c.before }),
  }));
}

/**
 * Apply changes whose `before` must match the document. All conflicting paths
 * are reported together; nothing is applied unless every change applies.
 */
export function applyChanges(
  doc: CharacterDocument,
  changes: ReadonlyArray<Change>,
): Checked<CharacterDocument> {
  const conflicts: Diagnostic[] = [];
  let current = doc;
  for (const whole of changes)
    for (const c of byCredit(current, whole)) {
      const present = getAt(current, c.path);
      if (!jsonEqual(present, c.before)) {
        // Both sides left this credit in the same state, such as two proposals
        // that each compacted the credit of a picture removed earlier.
        if (isCreditPath(c.path) && jsonEqual(present, c.after)) continue;
        conflicts.push(
          diagnostic("conflict", c.path, `${c.path.join("/")} changed since this edit was made.`, {
            ...(c.before === undefined ? {} : { expected: c.before }),
            ...(present === undefined ? {} : { found: present }),
          }),
        );
        continue;
      }
      const next = setAt(current, c.path, c.after);
      if (!next.ok) return next;
      current = next.value;
    }
  return conflicts.length ? fail(conflicts) : ok(current);
}
