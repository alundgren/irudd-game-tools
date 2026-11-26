import type { HumanAdultParams } from "./generator.js";

type HumanStyle = HumanAdultParams["style"];

export interface HumanLook {
  readonly id: string;
  readonly label: string;
  readonly seed: number;
  readonly style: HumanStyle;
}

export const look491: HumanLook = {
  id: "look-491",
  label: "Work clothes, long centre part",
  seed: 491,
  style: {
    tailor: {
      layers: [
        {
          piece: "boots",
          height: 1.84,
          ease: 5,
          straight: 0,
          cuff: 0,
          thick: 16,
          heel: 11,
          color: "#b69473",
          sole: "#2e2c2a",
        },
        {
          piece: "trousers",
          length: 2.03,
          fit: 0.14,
          ease: 8,
          rise: 0.5,
          pockets: "back",
          hemBand: 14,
          color: "#7f493c",
        },
        {
          piece: "top",
          sleeve: 0.47,
          length: 0.56,
          ease: 7,
          neck: "crew",
          depth: 47,
          cuff: 14,
          hemBand: 14,
          pockets: "chest",
          color: "#d1aaa6",
          trim: "#a96e4c",
        },
        {
          piece: "top",
          sleeve: 1.93,
          length: 0.93,
          ease: 13,
          stiff: 0.75,
          neck: "v",
          depth: 241,
          collar: "shirt",
          front: "buttons",
          buttons: 2,
          cuff: 0,
          hemBand: 0,
          pockets: "chest and hip",
          color: "#f2ede0",
          trim: "#a96e4c",
        },
      ],
    },
    hair: "Long centre part",
    fringe: "Swept right",
    hairColor: "#624535",
    eyewear: "Upswept frames",
    necklace: "Teardrop pendant",
    clothDesign: "Quiet weave",
  },
};

export const look8973: HumanLook = {
  id: "look-8973",
  label: "Day dress, round wire frames",
  seed: 8973,
  style: {
    outfit: "Day dress",
    clothColor: "#3a6f58",
    clothSecond: "#222c47",
    clothLight: "#d3d1c9",
    accentColor: "#994b67",
    leatherColor: "#443026",
    soleColor: "#352d27",
    metalColor: "#999ca0",
    clothDesign: "Windowpane",
    clothAccent: "#994b67",
    makeup: "None",
    hairColor: "#44372f",
    fringe: "Swept left",
    eyewear: "Round wire",
    necklace: "None",
  },
};

export const unbraidedLook8950: HumanLook = {
  id: "look-8950-unbraided",
  label: "Chore jacket, berry satin",
  seed: 8950,
  style: {
    outfit: "Chore jacket",
    clothColor: "#28282a",
    clothSecond: "#adcac6",
    clothLight: "#f5f3ee",
    accentColor: "#4c6d9d",
    leatherColor: "#513b2b",
    soleColor: "#372f29",
    metalColor: "#c0c3c6",
    clothDesign: "Quiet weave",
    makeup: "Berry satin",
    hairColor: "#624535",
    fringe: "Swept right",
    eyewear: "None",
    necklace: "None",
  },
};

export const look1: HumanLook = {
  id: "look-1",
  label: "Long tunic",
  seed: 1,
  style: {
    makeup: "None",
    hairColor: "#a88659",
    fringe: "Swept right",
    eyewear: "None",
    necklace: "None",
    metalColor: "#b07446",
    clothDesign: "Pinstripe",
  },
};

export const look42: HumanLook = {
  id: "look-42",
  label: "Blue shirt",
  seed: 42,
  style: {
    makeup: "None",
    hair: "Long centre part",
    hairColor: "#504041",
    fringe: "Parted",
    eyewear: "None",
    necklace: "Pearl strand",
    metalColor: "#ae6f47",
    clothDesign: "Outfit swatch",
  },
};

export const look8713: HumanLook = {
  id: "look-8713",
  label: "Blue shirt, rose stain",
  seed: 8713,
  style: {
    makeup: "Rose stain",
    hairColor: "#a88659",
    fringe: "Swept left",
    eyewear: "None",
    necklace: "Teardrop pendant",
    clothAccent: "#5c5e9e",
    clothDesign: "Chest band",
  },
};

export const look9001: HumanLook = {
  id: "look-9001",
  label: "Striped polo",
  seed: 9001,
  style: {
    makeup: "None",
    hairColor: "#a88659",
    fringe: "Parted",
    eyewear: "None",
    necklace: "None",
    metalColor: "#927c57",
    clothAccent: "#3e4045",
    clothDesign: "Hem border",
  },
};

export const look49027675: HumanLook = {
  id: "look-49027675",
  label: "Cropped jacket",
  seed: 49027675,
  style: {
    makeup: "None",
    hairColor: "#72553d",
    fringe: "Swept right",
    eyewear: "None",
    necklace: "None",
    metalColor: "#a96a46",
    clothDesign: "Outfit swatch",
  },
};

export const look3782767734: HumanLook = {
  id: "look-3782767734",
  label: "Gardener, work shirt and shorts",
  seed: 3782767734,
  style: {
    castTop: "Work shirt",
    castBottom: "Shorts and shoes",
    makeup: "None",
    hairColor: "#995f47",
    fringe: "Swept right",
    eyewear: "None",
    necklace: "None",
    metalColor: "#b89253",
    clothDesign: "Pinstripe",
  },
};

export const look8950: HumanLook = {
  id: "look-8950",
  label: "Chore jacket, braid",
  seed: 8950,
  style: { ...unbraidedLook8950.style, hair: "Braid" },
};

export const humanLooks: ReadonlyArray<HumanLook> = [
  look491,
  look8973,
  look8950,
  look1,
  look42,
  look8713,
  look9001,
  look49027675,
  look3782767734,
];

export function dressedAdult(seeded: HumanAdultParams, look: HumanLook): HumanAdultParams {
  return { ...seeded, outfit: "Work clothes", style: { ...seeded.style, ...look.style } };
}
