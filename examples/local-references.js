// Optional comparison material that stays on the machine that made it.
// Reference rigs, scans and the fits measured from them are ignored by Git, so
// a fresh checkout has none of these files and every value below is empty.
// Studies, tests and pages ask this module and leave out what is missing.
// docs/local-references.md lists each set and the commands that rebuild it.
//
// Node reads the files directly. scripts/build.mjs replaces this module in a
// browser bundle with the values found at build time.
// Set WORKSHOP_REFERENCES=none to build and test as a fresh checkout would.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

// Bundled Node helpers run from a data: address, so they resolve from the repository root.
const root = import.meta.url.startsWith("file:")
  ? new URL("../", import.meta.url)
  : pathToFileURL(process.cwd() + "/");
const off = process.env.WORKSHOP_REFERENCES === "none";
const path = (file) => fileURLToPath(new URL(file, root));
const has = (file) => !off && existsSync(path(file));
const json = (file) => (has(file) ? JSON.parse(readFileSync(path(file), "utf8")) : null);

// Practice rigs the reference editor can load by name, and where each one lives.
export const rigFiles = {
  "mhr-rest": "examples/mhr-reference.glb",
  ...Object.fromEntries(
    ["f1", "f2", "f3", "m1", "m2", "m3"].map((id) => [
      "mhr-" + id,
      "examples/human-targets/mhr-" + id + ".glb",
    ]),
  ),
};
// Ids of the practice rigs installed here.
export const rigs = Object.keys(rigFiles).filter((id) => has(rigFiles[id]));
// Radial torso corrections measured from the rest-pose rig.
export const mhrFit = json("examples/mhr-fit.json");
// Figure parameters fitted to the six scan previews.
export const scanFits = json("examples/reference-fits.json");
// Recipes and surface corrections fitted to the six benchmark bodies in the workshop.
export const workshopFits = json("examples/workshop-body-fits.json");
// One fitted head per file, keyed by file name.
const heads = "examples/head-targets-fits/";
export const headFits = Object.fromEntries(
  (has(heads) ? readdirSync(path(heads)) : [])
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => [name.slice(0, -5), json(heads + name)]),
);
