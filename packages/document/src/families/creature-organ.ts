import { Schema } from "effect";
import { PartId } from "../schema.js";
import { family } from "./family.js";

export const hideRoles = ["core", "kit"] as const;

export const organRanks = ["head", "throat", "spine", "haunch"] as const;
export type OrganRank = (typeof organRanks)[number];

export const billHalves = ["upper", "lower"] as const;

const flag = Schema.optionalKey(Schema.Literal(true));

export const CreatureOrgan = Schema.Struct({
  hide: Schema.optionalKey(Schema.Literals(hideRoles)),
  rank: Schema.optionalKey(Schema.Literals(organRanks)),
  extremity: flag,
  eye: flag,
  tail: flag,
  tentacle: flag,
  snout: flag,
  leg: flag,
  head: flag,
  coatSwatch: flag,
  bill: Schema.optionalKey(Schema.Literals(billHalves)),
});
export type CreatureOrgan = typeof CreatureOrgan.Type;

export const creatureOrgan = family({
  id: "creature.organ",
  version: 1,
  scope: "part",
  schema: CreatureOrgan,
  toJson: (v) => v,
});

export const CreatureLimbChain = Schema.Struct({
  chain: Schema.Array(PartId).check(Schema.isMinLength(2), Schema.isMaxLength(3)),
  limb: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 7 }))),
  side: Schema.Literals(["left", "right"]),
  arm: Schema.Boolean,
  tinted: Schema.Array(PartId).check(Schema.isMaxLength(32)),
});
export type CreatureLimbChain = typeof CreatureLimbChain.Type;

export const creatureLimbChain = family({
  id: "creature.limb-chain",
  version: 1,
  scope: "part",
  schema: CreatureLimbChain,
  toJson: (v) => v,
  references: (v) => [
    ...v.chain.map((id, i) => ({ kind: "part" as const, id, path: ["chain", i] })),
    ...v.tinted.map((id, i) => ({ kind: "part" as const, id, path: ["tinted", i] })),
  ],
});
