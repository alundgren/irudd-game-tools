import { buildCreature } from "./creature-plan.js";
import { extractComponent, placeComponent } from "./graft.js";
import { scapulaSocket } from "./human-sockets.js";
import { wingStructures } from "./wing-surface.js";

export const adultWingStructures = wingStructures.filter(name => name !== "plain");

export function attachCreatureLimbs(form, { wing = {}, skin = {} } = {}) {
  const chest = form.parts.find(p => p.shape === "human region" && p.humanBone === "spine_03" && !p.humanSource);
  if (!form.human || !chest) throw new Error("Choose an editable adult with a chest.");
  if (!adultWingStructures.includes(wing.structure ?? "feather"))
    throw new Error("Choose feather, bat or insect wings.");
  const source = buildCreature({
    spine: { rear: 83, front: 87 },
    head: { count: 0 },
    limbs: [{
      structure: "feather", length: .86, chord: .31, rise: 18, sweep: 36,
      bend: .35, pattern: "tips", ...wing, kind: "wing", pairs: 1, side: "both",
    }],
    skin: { base: "#665745", accent: "#537d81", pale: "#d5c3a0", ...skin },
  });
  let result = form;
  for (const membrane of source.parts.filter(p => p.shape === "wing")) {
    const component = extractComponent(source, membrane.parent);
    component.parts.find(p => p.id === component.root).scapulaMount = membrane.wing.side;
    result = placeComponent(result, component, { target: chest.id, mode: "attach", socket: "back" }).form;
  }
  return result;
}

export function reseatCreatureLimbs(parts, before, after) {
  const chestIds = new Set(parts.filter(p => p.humanBone === "spine_03" && !p.humanSource).map(p => p.id));
  const offsets = new Map();
  return parts.map(part => {
    const side = part.scapulaMount;
    if (!side || !chestIds.has(part.parent)) return part;
    if (!offsets.has(side)) {
      const old = scapulaSocket(before, side);
      offsets.set(side, scapulaSocket(after, side).map((x, i) => x - old[i]));
    }
    const offset = offsets.get(side);
    return { ...part, position: part.position.map((x, i) => x + offset[i]) };
  });
}
