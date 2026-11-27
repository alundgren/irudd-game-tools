import type { FineHeadLayer, SkinCorrections } from "@irudd/document";
import { boneNames } from "./catalogue.js";
import type { HumanMeasurements, HumanSurface } from "./surface.js";
export type FitRegion = "whole" | "head" | "trunk" | "arms" | "legs";
export interface FittedAdult {
  human: HumanMeasurements;
  corrections?: SkinCorrections;
  fineHead?: FineHeadLayer;
}
export const regionAt = (s: HumanSurface, v: number): FitRegion =>
  regionOfBone(boneNames[s.boneIndices[v * 4] ?? 0] ?? "");
export const regionOfBone = (bone: string): FitRegion => {
  if (bone === "head" || bone.startsWith("neck")) return "head";
  if (/thigh|calf|foot|ball/.test(bone)) return "legs";
  if (/arm|hand|thumb|index|middle|ring|pinky/.test(bone)) return "arms";
  return "trunk";
};
