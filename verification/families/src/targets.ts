import type { Preset } from "@irudd/character";

export const wardrobeTarget = "game-outfits";
export type Target = Preset | typeof wardrobeTarget;

export const targetPreset = (target: Target): Preset =>
  target === wardrobeTarget ? "game" : target;
