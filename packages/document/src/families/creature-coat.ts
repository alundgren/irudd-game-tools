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

export const CageFinish = Schema.Union([
  Schema.Struct({
    finish: Schema.Literal("whorl"),
    ribs: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 12 })),
    seed: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4294967295 })),
  }),
  Schema.Struct({ finish: Schema.Literal("nostril") }),
  Schema.Struct({ finish: Schema.Literal("contour feather") }),
]);
export type CageFinish = typeof CageFinish.Type;

export const creatureCageFinish = family({
  id: "creature.cage-finish",
  version: 1,
  scope: "part",
  schema: CageFinish,
  toJson: (v) => v,
});
