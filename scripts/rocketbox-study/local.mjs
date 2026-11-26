import { existsSync } from "node:fs";

export const local = ".reference-cache/rocketbox/";
export const revision = "0943055db6ec570bcef9f2c8b41c9e5467c808f9";
export const targets = [
  { name: "female-adult-04", folder: "Adults/Female_Adult_04", model: "Female_Adult_04", textures: "f004" },
  { name: "gardener-male-01", folder: "Professions/Gardener_Male_01", model: "Gardener_Male_01", textures: "m106" },
];

export function need(...files) {
  for (const file of files.length ? files : [""]) {
    if (existsSync(local + file)) continue;
    console.error("Missing " + local + file + " (local Rocketbox practice material; see docs/local-references.md).");
    process.exit(1);
  }
}
export async function loadStudies() {
  need("studies.js");
  return (await import("../../.reference-cache/rocketbox/studies.js")).rocketboxStudies;
}
