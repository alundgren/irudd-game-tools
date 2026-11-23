export const outfits = ["Base layer", "Work clothes", "Pressure suit"];
export const values = {
  height: [1.56, 1.64, 1.72, 1.8, 1.88, 1.96],
  build: ["Slender", "Athletic", "Broad"],
  hair: ["Crop", "Sweep", "Coils"],
  palette: ["Tide", "Ochre", "Clay", "Polar"],
};
export const initial = [
  {
    name: "Mara",
    height: 1.64,
    build: "Broad",
    hair: "Sweep",
    palette: "Tide",
    outfit: "Pressure suit",
    skin: "#ab7555",
    hairColor: "#352c29",
  },
  {
    name: "Ivo",
    height: 1.88,
    build: "Slender",
    hair: "Coils",
    palette: "Ochre",
    outfit: "Work clothes",
    skin: "#82563f",
    hairColor: "#292624",
  },
];

export function reroll(recipe, key, draw) {
  const alternatives = values[key].filter((value) => value !== recipe[key]);
  return {
    ...recipe,
    [key]: alternatives[Math.floor(draw * alternatives.length)],
  };
}
