// The Rocketbox practice material is local: source models, converted targets, the recipes made
// to match them and every comparison image live in the ignored .reference-cache/rocketbox folder.
// Scripts in this folder ask for it here, and stop with one line when it is absent.
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
    console.error("Missing " + local + file + " (local Rocketbox practice material; see docs/rocketbox-study.md).");
    process.exit(1);
  }
}
/** The local recipes: [{id, title, source, stages: {name: () => form}, make}]. */
export async function loadStudies() {
  need("studies.js");
  return (await import("../../.reference-cache/rocketbox/studies.js")).rocketboxStudies;
}
