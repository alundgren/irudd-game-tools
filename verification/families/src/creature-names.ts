// G0 decided a creature plan's hide, coat and limb pigment from part names
// (character-view/creature-hide.js, creature-coat.js, creature-limb-colour.js,
// creature-face-coat.js and creature-bill.js at 2761eb1). Preparing a form
// resolves each name once into the typed creature.organ and
// creature.limb-chain features, so the builders never read a label.

import type { Json } from "@irudd/document";

const coreHide = /^(?:body|head|neck|muzzle|jaw|tail|shoulders|pelvis)(?: \d+)?$/;

/** The creature.organ feature for a part with this legacy ID, or none when the name says nothing. */
export function creatureOrgan(id: string): Record<string, Json> | undefined {
  const organ: Record<string, Json> = {};
  if (coreHide.test(id)) organ["hide"] = "core";
  else if (id.startsWith("dress ") || id.startsWith("gear ")) organ["hide"] = "kit";
  if (/^head(?: \d+)?$/.test(id)) organ["rank"] = "head";
  else if (/^(?:neck|muzzle|jaw)(?: \d+)?$/.test(id)) organ["rank"] = "throat";
  else if (id === "body") organ["rank"] = "spine";
  else if (/^(?:tail|shoulders|pelvis)$/.test(id) || /(?:haunch|thigh|upper)$/.test(id))
    organ["rank"] = "haunch";
  if (/(?:foot|toes|hand|trunk tip|claw|pad|paddle|hoof)/.test(id)) organ["extremity"] = true;
  if (/(?:^| )eye(?: \d+)?$/.test(id)) organ["eye"] = true;
  if (id.startsWith("tail")) organ["tail"] = true;
  if (id.includes("tentacle")) organ["tentacle"] = true;
  if (/muzzle|bill|snout/.test(id)) organ["snout"] = true;
  if (id.includes("leg")) organ["leg"] = true;
  if (/^(?:head|muzzle|jaw|brow|lid)/.test(id)) organ["head"] = true;
  if (
    id === "body" ||
    /^(?:head(?: \d+)?|neck(?: \d+)?|shoulders(?: \d+)?|tail)$/.test(id) ||
    id.endsWith("haunch")
  )
    organ["coatSwatch"] = true;
  if (/^lower beak(?: [0-9]+)?$/.test(id)) organ["bill"] = "lower";
  else if (/^beak(?: [0-9]+)?$/.test(id)) organ["bill"] = "upper";
  return Object.keys(organ).length ? organ : undefined;
}

interface PlanLimb {
  readonly kind: string;
  readonly side: string;
  readonly pairs: number;
}

const limbRoles = new Set(["upper arm", "forearm", "hand", "thigh", "shin", "foot"]);

/**
 * The creature.limb-chain feature of each limb's first part, by legacy ID.
 * A plan limb is numbered per side and kind ("left leg 2"), as the plan
 * named the parts it built.
 */
export function creatureLimbChains(
  partIds: ReadonlyArray<string>,
  limbs: ReadonlyArray<PlanLimb>,
  ids: ReadonlyMap<string, string>,
  roles: ReadonlyMap<string, string>,
): Map<string, Record<string, Json>> {
  const counters = new Map<string, number>();
  const named = new Map<string, number>();
  for (const [index, limb] of limbs.entries())
    for (let i = 0; i < limb.pairs; i++)
      for (const side of limb.side === "both" ? ["left", "right"] : [limb.side]) {
        const name = side + " " + limb.kind;
        const n = (counters.get(name) ?? 0) + 1;
        counters.set(name, n);
        named.set(`${name} ${n}`, index);
      }
  const present = new Set(partIds);
  const chains = new Map<string, Record<string, Json>>();
  for (const first of partIds) {
    const match = /^((left|right) (leg|arm) \d+) (thigh|upper)$/.exec(first);
    const prefix = match?.[1];
    if (!match || prefix === undefined) continue;
    const arm = match[3] === "arm";
    const names = [
      first,
      prefix + (arm ? " forearm" : " shin"),
      prefix + (arm ? " hand" : " foot"),
    ];
    if (!present.has(names[1] ?? "")) continue;
    const id = (legacy: string): string => {
      const next = ids.get(legacy);
      if (next === undefined) throw new Error(`A limb chain names the missing part ${legacy}.`);
      return next;
    };
    const limb = named.get(prefix);
    chains.set(first, {
      chain: names.filter((n) => present.has(n)).map(id),
      ...(limb === undefined ? {} : { limb }),
      side: match[2] === "left" ? "left" : "right",
      arm,
      tinted: partIds
        .filter(
          (p) =>
            p.startsWith(prefix + " ") &&
            (limbRoles.has(roles.get(p) ?? "") || p === prefix + " toes"),
        )
        .map(id),
    });
  }
  return chains;
}
