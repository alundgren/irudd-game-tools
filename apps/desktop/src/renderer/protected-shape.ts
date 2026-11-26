import {
  decodeWith,
  isJsonObject,
  jsonEqual,
  type Change,
  type CharacterDocument,
  type Json,
} from "@irudd/document";
import {
  humanSlotBone,
  boneNames,
  evaluateHuman,
  humanMeasurements,
  humanAdultId,
  HumanAdultParams,
  type HumanBody,
} from "@irudd/character/human";

function measurements(gen: Json | undefined) {
  if (!gen || !isJsonObject(gen) || gen["generator"] !== humanAdultId) return undefined;
  const decoded = decodeWith(HumanAdultParams, gen["params"]);
  return decoded.ok ? humanMeasurements(decoded.value) : undefined;
}
export function protectedChanges(
  doc: CharacterDocument | undefined,
  body: HumanBody | undefined,
  changes: readonly Change[],
  ids: readonly string[],
): string[] {
  if (!ids.length) return [];
  const locked = new Set(ids);
  const changed = new Set<string>();
  for (const { path } of changes) {
    const [group, id, field] = path;
    if (
      group === "parts" &&
      id &&
      locked.has(id) &&
      !["parent", "position", "rotation", "label"].includes(field ?? "")
    )
      changed.add(id);
  }
  const generation = changes.find((c) => c.path[0] === "generation");
  if (!generation || !body || !doc) return [...changed];
  const regions = new Map<number, string>();
  for (const part of doc.parts) {
    if (!locked.has(part.id) || !part.slot) continue;
    const bone = humanSlotBone(part.slot);
    if (bone) regions.set(boneNames.indexOf(bone), part.id);
  }
  if (!regions.size) return [...changed];
  const before = measurements(generation.before),
    after = measurements(generation.after);
  if (before && after && !jsonEqual(before, after)) {
    const a = evaluateHuman(body, before),
      b = evaluateHuman(body, after);
    for (let i = 0; i < a.bodyVertices; i++) {
      const id = regions.get(a.boneIndices[i * 4] ?? -1);
      if (!id || changed.has(id)) continue;
      const v = i * 3;
      const delta = (k: number) => (a.positions[v + k] ?? 0) - (b.positions[v + k] ?? 0);
      if (Math.hypot(delta(0), delta(1), delta(2)) > 0.00005) changed.add(id);
    }
  } else if (Boolean(before) !== Boolean(after)) for (const id of regions.values()) changed.add(id);
  return [...changed];
}
