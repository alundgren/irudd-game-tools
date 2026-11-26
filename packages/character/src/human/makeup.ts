// Everyday makeup on the painted face (palettes, makeupPalette and mixMakeup
// in character-view/human-makeup.js at 2761eb1). An everyday look is a
// subtle multiplicative stain on the lips, lids and cheeks, mixed into the
// face paint with its own lip gloss. The theatrical stage looks add a graphic
// pass over the painted face that is not ported yet, so they are not offered.

/** A makeup look's stains (linear multipliers), how strongly it is worn and its lip roughness. */
export interface MakeupPalette {
  readonly lip: readonly [number, number, number];
  readonly shadow: readonly [number, number, number];
  readonly cheek: readonly [number, number, number];
  readonly strength: number;
  readonly roughness: number;
}

const palettes = {
  "Rose stain": {
    lip: [0.98, 0.68, 0.77],
    shadow: [0.89, 0.79, 0.8],
    cheek: [1, 0.89, 0.93],
    strength: 0.7,
    roughness: 0.5,
  },
  "Burnished copper": {
    lip: [0.92, 0.55, 0.38],
    shadow: [0.85, 0.61, 0.43],
    cheek: [0.99, 0.83, 0.75],
    strength: 0.82,
    roughness: 0.47,
  },
  "Berry satin": {
    lip: [0.84, 0.32, 0.53],
    shadow: [0.73, 0.55, 0.75],
    cheek: [0.97, 0.78, 0.88],
    strength: 0.9,
    roughness: 0.45,
  },
} as const satisfies Readonly<Record<string, MakeupPalette>>;

export type MakeupName = keyof typeof palettes;
/** The makeup an adult can wear: bare, or one of the everyday looks. */
export const makeupStyles = ["None", "Rose stain", "Burnished copper", "Berry satin"] as const;

const table: ReadonlyMap<string, MakeupPalette> = new Map(Object.entries(palettes));
export const makeupPalette = (name: string | undefined): MakeupPalette | null =>
  (name === undefined ? undefined : table.get(name)) ?? null;

/** Stain one face pixel's linear tints by the look's zones: lips, lids, the eye socket and the cheek. */
export function mixMakeup(
  channels: number[],
  palette: MakeupPalette,
  lips: number,
  lids: number,
  socket: number,
  blush: number,
  mask: number,
): void {
  const opacity = mask * palette.strength;
  const lip = Math.min(1, lips * 1.22) * opacity;
  const lid = Math.min(1, lids * 0.98 + socket * socket * 0.36) * opacity;
  const cheek = Math.min(1, blush * blush * 0.84) * opacity;
  for (let i = 0; i < 3; i++)
    channels[i] =
      (channels[i] ?? 0) *
      ((1 - lip * (1 - (palette.lip[i] ?? 1))) *
        (1 - lid * (1 - (palette.shadow[i] ?? 1))) *
        (1 - cheek * (1 - (palette.cheek[i] ?? 1))));
}
