// A courier's presentation: an ordinary clip "Offer dispatch" that eases the
// arm from its carry into an authored pose and back. G0 found it by names
// (hasDispatchAction in character-view/dispatch-pose.js at 2761eb1: a pose
// called "Present dispatch" and a "gear dispatch tube" held in a hand); a
// prepared document states it.
//
//   motion.offer  document  the pose the clip reaches and the part it presents

import { Schema } from "effect";
import { PartId } from "../schema.js";
import { family } from "./family.js";

export const MotionOffer = Schema.Struct({
  /** The `motion.poses` pose the clip reaches at full weight; it stays editable as a pose. */
  pose: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(60)),
  /** The part offered, held by a part whose role is `hand`. */
  held: PartId,
});
export type MotionOffer = typeof MotionOffer.Type;

export const motionOffer = family({
  id: "motion.offer",
  version: 1,
  scope: "document",
  schema: MotionOffer,
  toJson: (v) => v,
  references: (v) => [{ kind: "part" as const, id: v.held, path: ["held"] }],
});
