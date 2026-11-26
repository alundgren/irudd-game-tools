// What each part of a creature built from a plan is, for its hide, coat and
// limb pigment. G0 read these from part names (character-view/creature-hide.js,
// creature-coat.js, creature-limb-colour.js, creature-face-coat.js and
// creature-bill.js at 2761eb1); a prepared document states them.
//
//   creature.organ      part  the organ's role in the hide, its atlas share and relief
//   creature.limb-chain part  on a limb's first part: the chain its pigment runs along

import { Schema } from "effect";
import { PartId } from "../schema.js";
import { family } from "./family.js";

/** `core` organs always join the hide; `kit` (dress and gear) never does. */
export const hideRoles = ["core", "kit"] as const;

/**
 * The organ's share of the hide atlas, largest first. `spine` is the trunk
 * whose knots are the creature's spine: the hide, coat and flank markings
 * measure along it. Organs without a rank take the limb share.
 */
export const organRanks = ["head", "throat", "spine", "haunch"] as const;
export type OrganRank = (typeof organRanks)[number];

/** Which half of a bill a cage draws. */
export const billHalves = ["upper", "lower"] as const;

const flag = Schema.optionalKey(Schema.Literal(true));

export const CreatureOrgan = Schema.Struct({
  hide: Schema.optionalKey(Schema.Literals(hideRoles)),
  rank: Schema.optionalKey(Schema.Literals(organRanks)),
  /** Charted flat in the hide, as a foot, hand, claw or pad is. */
  extremity: flag,
  /** An eye: the hide and coat frame the skin around it. */
  eye: flag,
  /** Relief: segmented as a tail. */
  tail: flag,
  /** Relief: ridged and pale below as a tentacle. */
  tentacle: flag,
  /** Relief: bare as a muzzle, bill or snout. */
  snout: flag,
  /** Relief: scaled as a bird's shank when the plan has bird legs. */
  leg: flag,
  /** Relief: modelled as the head, its muzzle, jaw, brow or lid. */
  head: flag,
  /** A coat swatch covers the organ when the coat paints it outside the hide. */
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

/**
 * A limb whose pigment follows its length: the first, second and (when it
 * has one) third part of the chain from the body, which plan limb it grew
 * from, and every part the pigment colours.
 */
export const CreatureLimbChain = Schema.Struct({
  chain: Schema.Array(PartId).check(Schema.isMinLength(2), Schema.isMaxLength(3)),
  /** Index into the plan's limbs; absent when the plan has no limb of this name. */
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
