import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = import.meta.url.startsWith("file:")
  ? new URL("../", import.meta.url)
  : pathToFileURL(process.cwd() + "/");
const off = process.env.WORKSHOP_REFERENCES === "none";
const path = (file) => fileURLToPath(new URL(file, root));
const has = (file) => !off && existsSync(path(file));
const json = (file) => (has(file) ? JSON.parse(readFileSync(path(file), "utf8")) : null);

export const rigFiles = {
  "mhr-rest": "examples/mhr-reference.glb",
  ...Object.fromEntries(
    ["f1", "f2", "f3", "m1", "m2", "m3"].map((id) => [
      "mhr-" + id,
      "examples/human-targets/mhr-" + id + ".glb",
    ]),
  ),
};
export const rigs = Object.keys(rigFiles).filter((id) => has(rigFiles[id]));
export const mhrFit = json("examples/mhr-fit.json");
export const scanFits = json("examples/reference-fits.json");
export const workshopFits = json("examples/workshop-body-fits.json");
const heads = "examples/head-targets-fits/";
export const headFits = Object.fromEntries(
  (has(heads) ? readdirSync(path(heads)) : [])
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => [name.slice(0, -5), json(heads + name)]),
);
