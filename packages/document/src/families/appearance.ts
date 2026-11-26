import { Schema } from "effect";
import { bounded, family, Hex } from "./family.js";
import { FigureRecipe } from "./figure-recipe.js";

export const palettes = ["Tide", "Ochre", "Clay", "Polar"] as const;
export const hairStyles = ["Crop", "Sweep", "Coils", "Bald"] as const;

const multiplier = bounded(0.35, 2);

export const FaceSculpt = Schema.Struct({
  jaw: Schema.optionalKey(multiplier),
  nose: Schema.optionalKey(multiplier),
  brow: Schema.optionalKey(multiplier),
  cheek: Schema.optionalKey(multiplier),
  eyes: Schema.optionalKey(multiplier),
  "eye size": Schema.optionalKey(multiplier),
  mouth: Schema.optionalKey(multiplier),
  lips: Schema.optionalKey(multiplier),
  chin: Schema.optionalKey(multiplier),
  smile: Schema.optionalKey(multiplier),
});
export type FaceSculpt = typeof FaceSculpt.Type;

export const Tones = Schema.Struct({
  cloth: Schema.optionalKey(Hex),
  trim: Schema.optionalKey(Hex),
  panel: Schema.optionalKey(Hex),
  pants: Schema.optionalKey(Hex),
  boots: Schema.optionalKey(Hex),
});
export type Tones = typeof Tones.Type;

export const Appearance = Schema.Struct({
  palette: Schema.Literals(palettes),
  skin: Hex,
  face: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 }))),
  hair: Schema.Literals(hairStyles),
  hairColor: Hex,
  sculpt: Schema.optionalKey(FaceSculpt),
  tones: Schema.optionalKey(Tones),
  belly: Schema.optionalKey(bounded(0.5, 2)),
  sleeves: Schema.optionalKey(Schema.Literals(["long", "short", "none"])),
  pockets: Schema.optionalKey(Schema.Boolean),
  collar: Schema.optionalKey(Schema.Boolean),
});
export type Appearance = typeof Appearance.Type;

export const characterAppearance = family({
  id: "character.appearance",
  version: 1,
  scope: "document",
  schema: Appearance,
  toJson: (v) => v,
});

export const CharacterOrigin = Schema.Struct({
  generator: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 64 }))),
  kind: Schema.Literals(["human", "creature", "creature plan", "figure", "human surface"]),
  seed: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 0xffffffff }))),
  figure: Schema.optionalKey(FigureRecipe),
});
export type CharacterOrigin = typeof CharacterOrigin.Type;

export const characterOrigin = family({
  id: "character.origin",
  version: 1,
  scope: "document",
  schema: CharacterOrigin,
  toJson: (v) => v,
});
