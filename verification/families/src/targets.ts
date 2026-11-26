// What the gate exports for a form: each preset, and G0's wardrobe export,
// which writes every saved outfit as its own scene at the game preset.

import type { Preset } from "@irudd/character";

export const wardrobeTarget = "game-outfits";
export type Target = Preset | typeof wardrobeTarget;

/** The preset a target exports at. */
export const targetPreset = (target: Target): Preset =>
  target === wardrobeTarget ? "game" : target;
