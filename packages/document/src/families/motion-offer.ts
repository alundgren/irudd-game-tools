import { Schema } from "effect";
import { PartId } from "../schema.js";
import { family } from "./family.js";

export const MotionOffer = Schema.Struct({
  pose: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(60)),
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
