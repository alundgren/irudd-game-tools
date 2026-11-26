import { Schema } from "effect";
import { family } from "./family.js";
import { FigureMarkings } from "./figure.js";

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
