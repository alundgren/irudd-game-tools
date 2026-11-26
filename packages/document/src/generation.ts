import { diagnostic, fail, ok, type Checked, type Diagnostic } from "./diagnostics.js";
import { isJson, jsonEqual, type JsonObject } from "./json.js";
import { digestJson } from "./sha256.js";
import { Schema } from "effect";
import {
  add,
  div,
  mul,
  quatConjugate,
  quatMultiply,
  quatNormalize,
  rotate,
  sub,
  type Vec3,
} from "./geometry.js";
import { baseDigest, canonicalize } from "./document.js";
import { findGenerator, type Registry } from "./registry.js";
import {
  PartId as PartIdSchema,
  type BaseSlot,
  type CharacterDocument,
  type Generation,
  type Part,
  type PartId,
} from "./schema.js";

const decodePartId = Schema.decodeUnknownSync(PartIdSchema);

export function derivePartId(documentId: string, requestId: string, slot: string): PartId {
  const hex = digestJson([documentId, requestId, slot]).slice(
    "sha256:".length,
    "sha256:".length + 16,
  );
  return decodePartId(`p-${hex}`);
}

function topological(slots: ReadonlyArray<BaseSlot>): BaseSlot[] {
  const bySlot = new Map<string, BaseSlot>(slots.map((s) => [s.slot, s]));
  const out: BaseSlot[] = [];
  const placed = new Set<string>();
  const visit = (s: BaseSlot, depth: number) => {
    if (placed.has(s.slot) || depth > slots.length) return;
    const parent = s.parent === null ? undefined : bySlot.get(s.parent);
    if (parent) visit(parent, depth + 1);
    placed.add(s.slot);
    out.push(s);
  };
  for (const s of slots) visit(s, 0);
  return out;
}

function materialise(slot: BaseSlot, id: PartId, parent: PartId | null): Part {
  return {
    id,
    label: slot.label,
    parent,
    shape: slot.shape,
    position: slot.position,
    rotation: slot.rotation,
    size: slot.size,
    color: slot.color,
    sculpt: [],
    slot: slot.slot,
    features: slot.features ?? {},
  };
}

function runGenerator(
  registry: Registry,
  generator: string,
  version: number,
  rawParams: unknown,
): Checked<{ generation: Generation; slots: BaseSlot[] }> {
  const def = findGenerator(registry, generator, version);
  if (!def)
    return fail([
      diagnostic(
        "unsupported-generator",
        ["generator"],
        `This build has no generator ${generator} version ${version}.`,
      ),
    ]);
  if (!isJson(rawParams))
    return fail([diagnostic("schema", ["params"], "Generator parameters are plain JSON.")]);
  const params = def.params(rawParams);
  if (!params.ok) return params;
  let slots: BaseSlot[];
  try {
    slots = topological(def.generate(params.value));
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "Generation failed.";
    return fail([
      diagnostic("generator-failed", ["generator"], `${def.id}@${def.version}: ${reason}`),
    ]);
  }
  return ok({
    slots,
    generation: {
      generator: def.id,
      version: def.version,
      params: params.value,
      base: { digest: baseDigest(slots), slots },
    },
  });
}

export interface GenerateRequest {
  readonly generator: string;
  readonly version: number;
  readonly params: unknown;
}

export function generateParts(
  registry: Registry,
  request: GenerateRequest,
  idFor: (slot: string) => PartId,
): Checked<{ parts: Part[]; generation: Generation }> {
  const run = runGenerator(registry, request.generator, request.version, request.params);
  if (!run.ok) return run;
  const ids = new Map<string, PartId>(run.value.slots.map((s) => [s.slot, idFor(s.slot)]));
  const parts = run.value.slots.map((s) =>
    materialise(
      s,
      ids.get(s.slot) ?? idFor(s.slot),
      s.parent === null ? null : (ids.get(s.parent) ?? null),
    ),
  );
  return ok({ parts, generation: run.value.generation });
}

export interface RegenerateRequest extends GenerateRequest {
  readonly discardEdits: boolean;
}

function vecEqual(a: Vec3, b: Vec3): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

export function transportOffset(c: Vec3, b: BaseSlot, n: BaseSlot): Vec3 {
  const local = div(rotate(quatConjugate(b.rotation), sub(c, b.position)), b.size);
  return add(n.position, rotate(n.rotation, mul(local, n.size)));
}

interface Conflict {
  readonly path: ReadonlyArray<string>;
  readonly reason:
    | "both-changed"
    | "generator-changed"
    | "frame-changed"
    | "slot-removed"
    | "parent-removed"
    | "referenced-by-pose";
  readonly message: string;
}

function conflictDiagnostic(c: Conflict, slot?: string): Diagnostic {
  return diagnostic("conflict", c.path, c.message, {
    reason: c.reason,
    ...(slot === undefined ? {} : { slot }),
  });
}

export function regenerate(
  doc: CharacterDocument,
  registry: Registry,
  request: RegenerateRequest,
  idFor: (slot: string) => PartId,
): Checked<CharacterDocument> {
  const previous = doc.generation;
  if (!previous)
    return fail([
      diagnostic(
        "missing-reference",
        ["generation"],
        "This document was not built by a generator. Generate one first.",
      ),
    ]);
  const run = runGenerator(registry, request.generator, request.version, request.params);
  if (!run.ok) return run;
  const N = run.value.slots;
  const comparable = previous.generator === run.value.generation.generator;
  const B = new Map<string, BaseSlot>(
    comparable ? previous.base.slots.map((s) => [s.slot, s]) : [],
  );
  const allOld = new Map<string, BaseSlot>(previous.base.slots.map((s) => [s.slot, s]));
  const C = new Map<string, Part>();
  for (const p of doc.parts) if (p.slot !== undefined) C.set(p.slot, p);
  const conflicts: Diagnostic[] = [];
  const parts = new Map<PartId, Part>();
  const slotIds = new Map<string, PartId>();
  for (const [slot, p] of C) slotIds.set(slot, p.id);

  const suppressed = new Set<string>();
  for (const s of previous.base.slots) if (!C.has(s.slot) && comparable) suppressed.add(s.slot);

  for (const n of N) {
    if (suppressed.has(n.slot) || (n.parent !== null && suppressed.has(n.parent))) {
      suppressed.add(n.slot);
      continue;
    }
    const parentId = n.parent === null ? null : slotIds.get(n.parent);
    if (parentId === undefined) {
      suppressed.add(n.slot);
      continue;
    }
    const b = B.get(n.slot);
    const c = C.get(n.slot);
    if (!comparable && !request.discardEdits) {
      const old = allOld.get(n.slot);
      if (old && !c) {
        conflicts.push(
          conflictDiagnostic(
            {
              path: ["generation", "base", "slots", n.slot],
              reason: "generator-changed",
              message: `Switching generators would restore the deleted slot ${n.slot}.`,
            },
            n.slot,
          ),
        );
        continue;
      }
      if (old && c) {
        const oldParent = old.parent === null ? null : (C.get(old.parent)?.id ?? null);
        const basePart: JsonObject = materialise(old, c.id, oldParent);
        const currentPart: JsonObject = c;
        for (const field of Object.keys(currentPart)) {
          if (jsonEqual(currentPart[field], basePart[field])) continue;
          conflicts.push(
            conflictDiagnostic(
              {
                path: ["parts", c.id, field],
                reason: "generator-changed",
                message: `Switching generators would replace the edited ${field} of ${c.label}.`,
              },
              n.slot,
            ),
          );
        }
      }
    }
    if (!b || !c || !comparable) {
      const id = derivedOrKept(n.slot);
      slotIds.set(n.slot, id);
      parts.set(id, materialise(n, id, parentId));
      continue;
    }
    if (request.discardEdits) {
      parts.set(c.id, materialise(n, c.id, parentId));
      continue;
    }
    const base = materialise(b, c.id, b.parent === null ? null : (slotIds.get(b.parent) ?? null));
    const here = (field: string): ReadonlyArray<string> => ["parts", c.id, field];

    let parent: PartId | null = parentId;
    if (c.parent !== base.parent) {
      if (n.parent === b.parent) parent = c.parent;
      else
        conflicts.push(
          conflictDiagnostic(
            {
              path: here("parent"),
              reason: "both-changed",
              message: `${c.label} was re-attached by hand and by the generator.`,
            },
            n.slot,
          ),
        );
    }

    let shape = n.shape;
    if (c.shape !== b.shape) {
      if (n.shape === b.shape || n.shape === c.shape) shape = c.shape;
      else
        conflicts.push(
          conflictDiagnostic(
            {
              path: here("shape"),
              reason: "both-changed",
              message: `${c.label} changed shape by hand and in the generator.`,
            },
            n.slot,
          ),
        );
    }
    if (shape !== c.shape)
      for (const d of c.sculpt)
        conflicts.push(
          conflictDiagnostic(
            {
              path: ["parts", c.id, "sculpt", d.id],
              reason: "frame-changed",
              message: `${c.label} would become a ${shape}; sculpted edit ${d.id} was made on a ${c.shape}.`,
            },
            n.slot,
          ),
        );

    let color = n.color;
    if (c.color !== b.color) {
      if (n.color === b.color || n.color === c.color) color = c.color;
      else
        conflicts.push(
          conflictDiagnostic(
            {
              path: here("color"),
              reason: "both-changed",
              message: `${c.label} was recoloured by hand and by the generator.`,
            },
            n.slot,
          ),
        );
    }

    const size = vecEqual(c.size, b.size)
      ? n.size
      : vecEqual(n.size, b.size)
        ? c.size
        : mul(n.size, div(c.size, b.size));
    const rotation = jsonEqual(c.rotation, b.rotation)
      ? n.rotation
      : jsonEqual(n.rotation, b.rotation)
        ? c.rotation
        : quatNormalize(
            quatMultiply(n.rotation, quatMultiply(quatConjugate(b.rotation), c.rotation)),
          );
    const position = vecEqual(c.position, b.position)
      ? n.position
      : vecEqual(n.position, b.position)
        ? c.position
        : transportOffset(c.position, b, n);

    const features = { ...c.features };
    for (const key of new Set([
      ...Object.keys(b.features ?? {}),
      ...Object.keys(n.features ?? {}),
    ])) {
      const previousValue = b.features?.[key];
      const nextValue = n.features?.[key];
      if (jsonEqual(previousValue, nextValue)) continue;
      if (!jsonEqual(previousValue, c.features[key]) && !jsonEqual(nextValue, c.features[key])) {
        conflicts.push(
          conflictDiagnostic(
            {
              path: [...here("features"), key],
              reason: "both-changed",
              message: `${c.label} changed ${key} by hand and in the generator.`,
            },
            n.slot,
          ),
        );
      } else if (nextValue === undefined) delete features[key];
      else features[key] = nextValue;
    }
    parts.set(c.id, {
      ...c,
      features,
      label: c.label === b.label ? n.label : c.label,
      parent,
      shape,
      color,
      size,
      rotation,
      position,
    });
  }

  function derivedOrKept(slot: string): PartId {
    return C.get(slot)?.id ?? idFor(slot);
  }

  const removed = new Set<PartId>();
  const oldIds = new Map<string, PartId>();
  for (const [slot, c] of C) oldIds.set(slot, c.id);
  for (const [slot, c] of C) {
    if (parts.has(c.id)) continue;
    removed.add(c.id);
    if (request.discardEdits) continue;
    const b = allOld.get(slot);
    const expectedParent = b?.parent == null ? null : (oldIds.get(b.parent) ?? null);
    const untouched = b !== undefined && jsonEqual(c, materialise(b, c.id, expectedParent));
    if (!untouched) {
      conflicts.push(
        conflictDiagnostic(
          {
            path: ["parts", c.id],
            reason: "slot-removed",
            message: `The generator no longer makes ${c.label}, which has manual edits.`,
          },
          slot,
        ),
      );
    }
  }

  const def =
    comparable && previous.version === run.value.generation.version
      ? findGenerator(registry, previous.generator, previous.version)
      : undefined;
  const reseat = def?.reseat?.(previous.params, run.value.generation.params);
  const slotOf = new Map<PartId, string>();
  for (const [slot, c] of C) slotOf.set(c.id, slot);
  for (const p of doc.parts) {
    if (p.slot !== undefined) continue;
    if (p.parent !== null && removed.has(p.parent)) {
      if (!request.discardEdits)
        conflicts.push(
          conflictDiagnostic({
            path: ["parts", p.id, "parent"],
            reason: "parent-removed",
            message: `${p.label} hangs from a part the generator no longer makes.`,
          }),
        );
      continue;
    }
    const parent = p.parent === null ? undefined : slotOf.get(p.parent);
    const position = reseat && parent !== undefined ? reseat(p, parent) : undefined;
    parts.set(p.id, position ? { ...p, position } : p);
  }

  let poses = doc.poses;
  if (removed.size) {
    if (request.discardEdits)
      poses = poses.map((pose) => ({
        ...pose,
        joints: pose.joints.filter((j) => !removed.has(j.part)),
      }));
    else
      for (const pose of doc.poses)
        if (pose.joints.some((j) => removed.has(j.part)))
          conflicts.push(
            conflictDiagnostic({
              path: ["poses", pose.id],
              reason: "referenced-by-pose",
              message: `Pose ${pose.label} moves a part the generator no longer makes.`,
            }),
          );
  }

  if (conflicts.length) return fail(conflicts);
  return ok(
    canonicalize({
      ...doc,
      parts: [...parts.values()],
      poses,
      generation: run.value.generation,
    }),
  );
}
