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
  "Plum stage": {
    lip: [0.75, 0.22, 0.43],
    shadow: [0.53, 0.38, 0.68],
    cheek: [0.95, 0.7, 0.88],
    strength: 1,
    roughness: 0.42,
  },
  "Smoked charcoal": {
    lip: [0.88, 0.7, 0.71],
    shadow: [0.36, 0.37, 0.41],
    cheek: [0.96, 0.9, 0.88],
    strength: 0.91,
    roughness: 0.48,
  },
  "Gilded nocturne": {
    lip: [0.78, 0.26, 0.22],
    shadow: [0.46, 0.36, 0.3],
    cheek: [0.95, 0.76, 0.66],
    strength: 0.98,
    roughness: 0.44,
  },
  "Crimson aria": {
    lip: [0.84, 0.14, 0.22],
    shadow: [0.44, 0.24, 0.3],
    cheek: [0.96, 0.72, 0.78],
    strength: 1,
    roughness: 0.4,
  },
} as const satisfies Readonly<Record<string, MakeupPalette>>;

export type MakeupName = keyof typeof palettes;
export const makeupStyles = [
  "None",
  "Rose stain",
  "Burnished copper",
  "Berry satin",
  "Plum stage",
  "Smoked charcoal",
  "Gilded nocturne",
  "Crimson aria",
] as const;

const table: ReadonlyMap<string, MakeupPalette> = new Map(Object.entries(palettes));
export const makeupPalette = (name: string | undefined): MakeupPalette | null =>
  (name === undefined ? undefined : table.get(name)) ?? null;

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
