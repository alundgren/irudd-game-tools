// Creature coat features on parts. Ported from the undercoat, coatZone and
// eyeSurface checks in character-view/recipe.js at 2761eb1.
//
//   figure.undercoat     part  a marking painted under the part's markings
//   creature.coat-zone   part  where the plan's coat lies on the part: the body or a limb end
//   creature.eye-surface part  which layer of a creature's eye a cage draws

import { Schema } from "effect";
import { family } from "./family.js";
import { FigureMarkings } from "./figure.js";

/** An undercoat is a marking set, painted first so the part's markings lie over it. */
export const figureUndercoat = family({
  id: "figure.undercoat",
  version: 1,
  scope: "part",
  schema: FigureMarkings,
  toJson: (v) => v,
});

export const coatZones = ["body", "end"] as const;
export const CoatZone = Schema.Struct({ zone: Schema.Literals(coatZones) });
export type CoatZone = typeof CoatZone.Type;

export const creatureCoatZone = family({
  id: "creature.coat-zone",
  version: 1,
  scope: "part",
  schema: CoatZone,
  toJson: (v) => v,
});

export const eyeSurfaces = ["compound", "white", "iris", "pupil"] as const;
export const EyeSurface = Schema.Struct({ surface: Schema.Literals(eyeSurfaces) });
export type EyeSurface = typeof EyeSurface.Type;

export const creatureEyeSurface = family({
  id: "creature.eye-surface",
  version: 1,
  scope: "part",
  schema: EyeSurface,
  toJson: (v) => v,
});
