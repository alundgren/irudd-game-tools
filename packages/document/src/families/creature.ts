import { Schema } from "effect";
import { bounded, family, Hex } from "./family.js";

export const CreatureBlend = Schema.Struct({ blend: Schema.Literal(true) });
export type CreatureBlend = typeof CreatureBlend.Type;

export const creatureBlend = family({
  id: "creature.blend",
  version: 1,
  scope: "part",
  schema: CreatureBlend,
  toJson: (v) => v,
});

export const CreatureSkin = Schema.Struct({
  tint: Schema.optionalKey(Hex),
  surface: Schema.optionalKey(Schema.Literals(["plain", "scales"])),
  softness: Schema.optionalKey(bounded(0.005, 0.045)),
});
export type CreatureSkin = typeof CreatureSkin.Type;

export const creatureSkin = family({
  id: "creature.skin",
  version: 1,
  scope: "document",
  schema: CreatureSkin,
  toJson: (v) => v,
});
