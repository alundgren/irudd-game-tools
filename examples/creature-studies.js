// Original creatures built from the workshop's own body plans. Each one
// opens with the Creature body plan panel ready, so its spine, limb groups
// and details can be changed and it keeps walking.
import { buildCreature, creaturePresets } from "../character-view/creature-plan.js";

const slug = (name) => "plan-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

export const creatureStudies = Object.keys(creaturePresets).map((name) => ({
  id: slug(name),
  title: name,
  game: "Creature body plans",
  mode: "Color",
  angle: "3/4",
  make: () => buildCreature(creaturePresets[name]),
}));
