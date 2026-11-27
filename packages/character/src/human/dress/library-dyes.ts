export interface Dye {
  readonly tone: string;
  readonly level: number;
  readonly worn?: number;
  readonly pale?: string;
  readonly from?: number;
  readonly to?: number;
  readonly pick?: (h: number, s: number, l: number) => boolean;
}
export const panelDyes: Readonly<Record<string, readonly Dye[]>> = {
  male_casualsuit01: [
    {
      tone: "main",
      level: 0.3118,
    },
    {
      tone: "dark",
      level: 0.3039,
    },
    {
      tone: "accent",
      level: 0.48,
    },
  ],
  male_casualsuit03: [
    {
      tone: "main",
      level: 0.1176,
    },
    {
      tone: "dark",
      level: 0.3647,
    },
    {
      tone: "accent",
      level: 0.48,
    },
  ],
  female_sportsuit01: [
    {
      tone: "main",
      level: 0.3647,
    },
    {
      tone: "dark",
      level: 0.2,
    },
    {
      tone: "accent",
      level: 0.48,
    },
  ],
  viking_tunic: [
    {
      tone: "main",
      level: 0.151,
    },
    {
      tone: "leather",
      level: 0.1745,
    },
  ],
  viking_pants: [
    {
      tone: "dark",
      level: 0.2412,
    },
  ],
  viking_boots: [
    {
      tone: "leather",
      level: 0.3,
    },
    {
      tone: "sole",
      level: 0.3765,
    },
  ],
  monk_robe: [
    {
      tone: "main",
      level: 0.1824,
    },
    {
      tone: "dark",
      level: 0.1706,
    },
  ],
  shift_dress: [
    {
      tone: "main",
      level: 0.1647,
    },
    {
      tone: "dark",
      level: 0.1922,
    },
  ],
  full_skirt: [
    {
      tone: "dark",
      level: 0.1,
      pale: "light",
      from: 0.2,
      to: 0.5,
    },
  ],
  rib_sweater: [
    {
      tone: "main",
      level: 0.3765,
    },
  ],
  einar_coat: [
    {
      tone: "main",
      level: 0.2255,
      worn: 0.42,
    },
    {
      tone: "dark",
      level: 0.1824,
      worn: 0.42,
    },
    {
      tone: "accent",
      level: 0.1431,
      worn: 0.5,
    },
    {
      tone: "leather",
      level: 0.1922,
      worn: 0.55,
    },
    {
      tone: "light",
      level: 0.1353,
      worn: 0.35,
    },
  ],
  einar_trousers: [
    {
      tone: "dark",
      level: 0.1784,
      worn: 0.42,
    },
    {
      tone: "main",
      level: 0.1373,
      worn: 0.42,
    },
    {
      tone: "leather",
      level: 0.1412,
      worn: 0.55,
    },
  ],
  einar_boots: [
    {
      tone: "leather",
      level: 0.1882,
      worn: 0.55,
    },
    {
      tone: "sole",
      level: 0.102,
      worn: 0.6,
    },
  ],
  expedition_vest: [
    {
      tone: "main",
      level: 0.6059,
      worn: 0.48,
    },
    {
      tone: "dark",
      level: 0.2059,
      worn: 0.48,
    },
    {
      tone: "accent",
      level: 0.1588,
      worn: 0.48,
    },
    {
      tone: "leather",
      level: 0.2706,
      worn: 0.48,
    },
  ],
  hoodie_shorts: [
    {
      tone: "main",
      level: 0.1098,
      worn: 0.48,
    },
    {
      tone: "dark",
      level: 0.149,
      worn: 0.48,
    },
    {
      tone: "leather",
      level: 0.2902,
      worn: 0.48,
    },
  ],
  crew_sweatshirt: [
    {
      tone: "main",
      level: 0.4253,
      worn: 0.3,
    },
  ],
  cable_vneck: [
    {
      tone: "main",
      level: 0.2527,
      worn: 0.3,
    },
  ],
};
export const dyes: Readonly<Record<string, readonly Dye[]>> = {
  male_elegantsuit01: [
    { pick: (h, s, l) => s > 0.2 && h > 0.5 && h < 0.8 && l > 0.008, tone: "accent", level: 0.03 },
    { pick: (_h, s, l) => s < 0.2 && l > 0.42, tone: "light", level: 0.74 },
    { pick: (_h, s, l) => s < 0.35 && l <= 0.42, tone: "main", level: 0.165 },
  ],
  female_elegantsuit01: [
    {
      pick: (h, s, l) => s > 0.13 && (h > 0.88 || h < 0.07) && l > 0.05,
      tone: "dark",
      level: 0.2,
      pale: "light",
      from: 0.32,
      to: 0.5,
    },
    { pick: (_h, s, l) => s <= 0.13 && l > 0.04, tone: "main", level: 0.285 },
  ],
  male_casualsuit05: [
    { pick: (h, s, l) => s > 0.14 && h > 0.5 && h < 0.68 && l > 0.1, tone: "dark", level: 0.37 },
    {
      pick: (h, s, l) => s > 0.16 && (h > 0.88 || h < 0.07) && l > 0.05,
      tone: "accent",
      level: 0.2,
      pale: "light",
      from: 0.32,
      to: 0.5,
    },
    { pick: (_h, s, l) => s <= 0.14 && l >= 0.36, tone: "dark", level: 0.5 },
    { pick: (_h, s, l) => s <= 0.14 && l > 0.1, tone: "main", level: 0.25 },
  ],
  male_worksuit01: [
    { pick: (_h, s, l) => s < 0.05 && l >= 0.975, tone: "light", level: 1 },
    { pick: (_h, _s, l) => l > 0.2, tone: "main", level: 0.6 },
  ],
  shoes01: [{ pick: (h, s, l) => s > 0.2 && h < 0.13 && l > 0.08, tone: "leather", level: 0.36 }],
  shoes02: [{ pick: (_h, s, l) => s < 0.3 && l > 0.05, tone: "leather", level: 0.4 }],
};
