import {
  CreaturePlan,
  isJsonObject,
  creaturePlan,
  decodeWith,
  defineGenerator,
  type CharacterDocument,
} from "@irudd/document";
import { creatureSlots } from "./body.js";
import { randomCreature } from "./draw.js";

export const creatureGenerator = defineGenerator({
  id: "irudd.creature-plan",
  version: 1,
  label: "Creature",
  schema: CreaturePlan,
  toJson: (p) => p,
  generate: creatureSlots,
});
export const creatureStarter = {
  id: "creature-plan",
  label: "Creature",
  reference: false,
  generator: creatureGenerator,
  description: "A seeded creature with editable anatomy, limbs and coat.",
  presets: [],
  seed: (seed: number) => randomCreature(seed),
};
export function generatedCreature(doc: CharacterDocument) {
  return (
    doc.generation?.generator === creatureGenerator.id ||
    (doc.generation?.generator === "irudd.workshop-form" &&
      isJsonObject(doc.generation.params) &&
      doc.generation.params["kind"] === "Hybrid")
  );
}

export function creatureEdits(
  doc: CharacterDocument,
  previous: CreaturePlan,
  next: CreaturePlan,
): object[] {
  if (
    doc.generation?.generator === "irudd.workshop-form" &&
    isJsonObject(doc.generation.params) &&
    doc.generation.params["kind"] === "Hybrid"
  )
    return [{ op: "generation.steer", params: { ...doc.generation.params, plan: next } }];
  if (doc.generation?.generator === creatureGenerator.id)
    return [{ op: "generation.steer", params: next }];
  const ops: object[] = [{ op: "feature.set", feature: "creature.plan", value: next }];
  for (const part of doc.parts) {
    for (const channel of ["base", "accent", "pale", "eye"] as const)
      if (part.color === previous.skin[channel] && previous.skin[channel] !== next.skin[channel]) {
        ops.push({ op: "part.set", part: part.id, set: { color: next.skin[channel] } });
        break;
      }
    if (JSON.stringify(previous.skin.markings) !== JSON.stringify(next.skin.markings)) {
      for (const feature of ["figure.markings", "figure.undercoat"])
        if (
          part.features[feature] ||
          (feature === "figure.markings" && part.features["creature.coat-zone"])
        )
          ops.push({ op: "feature.set", feature, part: part.id, value: next.skin.markings });
    }
  }
  return ops;
}

export function currentCreature(doc: CharacterDocument) {
  const generation = doc.generation;
  if (
    generation?.generator === "irudd.workshop-form" &&
    isJsonObject(generation.params) &&
    generation.params["kind"] === "Hybrid"
  ) {
    const result = decodeWith(CreaturePlan, generation.params["plan"]);
    return result.ok ? result.value : undefined;
  }
  if (doc.generation?.generator !== creatureGenerator.id) return creaturePlan.read(doc.features);
  const result = decodeWith(CreaturePlan, doc.generation.params);
  return result.ok ? result.value : undefined;
}
