import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = new URL("../", import.meta.url);
const present = (file) => existsSync(fileURLToPath(new URL(file, root)));
const six = (prefix, suffix) =>
  ["f1", "f2", "f3", "m1", "m2", "m3"].map((id) => prefix + id + suffix);

export const mhrArchive = {
  url: "https://github.com/facebookresearch/MHR/releases/download/v1.0.1/assets.zip",
  sha256: "e4f4f205cd87c0fa106577ba1de4fc763e4eb197c924461d2ef7e6944e9d6b94",
  file: ".reference-cache/mhr/assets.zip",
};

export const referenceSets = [
  {
    name: "Momentum Human Rig, rest pose",
    source: "https://github.com/facebookresearch/MHR/releases/tag/v1.0.1 (Apache-2.0)",
    files: ["examples/mhr-reference.glb", "examples/mhr-fit.json"],
    enables:
      "dist/rig-study.html, the measured torso study and the rest-pose entry under Fit a 3D reference",
    rebuild: [
      "node scripts/local-references.mjs --fetch",
      "extract assets/lod1.fbx from .reference-cache/mhr/assets.zip",
      "blender -b --factory-startup --python-exit-code 1 --python scripts/export-mhr-reference.py -- .reference-cache/mhr/lod1.fbx examples/mhr-reference.glb",
      "node scripts/fit-rig-surface.mjs",
    ],
  },
  {
    name: "Six MHR benchmark bodies",
    source: "https://github.com/facebookresearch/MHR/releases/tag/v1.0.1 (Apache-2.0)",
    files: [
      "examples/human-targets/manifest.json",
      "examples/human-targets/mhr-regions.u8",
      ...six("examples/human-targets/mhr-", ".glb"),
    ],
    enables: "the six benchmark adults under Fit a 3D reference and every benchmark script",
    rebuild: [
      "node scripts/local-references.mjs --fetch",
      "python scripts/human-benchmark/build-targets.py .reference-cache/mhr",
    ],
  },
  {
    name: "Benchmark fits and pictures",
    source: "measured from the six benchmark bodies",
    files: [
      ...six("examples/human-targets-fits/mhr-", ".json"),
      "docs/media/human-benchmark/results.json",
    ],
    enables: "benchmark result tables and comparison sheets",
    rebuild: [
      "python scripts/human-benchmark/run.py .reference-cache/human-benchmark",
      "python scripts/human-benchmark/report.py .reference-cache/human-benchmark",
      "python scripts/human-benchmark/tables.py",
    ],
  },
  {
    name: "Workshop fits to the six bodies",
    source: "measured from the six benchmark bodies in the running workshop",
    files: ["examples/workshop-body-fits.json", "docs/media/workshop-body-fits.webp"],
    enables: "six editable fits and their comparison sheet",
    rebuild: [
      "npm start",
      "python scripts/check-workshop-fits.py .reference-cache/ui-fit --workshop http://127.0.0.1:4179",
    ],
  },
  {
    name: "Scan preview studies",
    source: "the pages listed in examples/body-references.json",
    files: [
      "examples/reference-fits.json",
      ...["f01", "f03", "f08", "m04", "m08", "m09"].map(
        (id) => "docs/media/scan-study-" + id + ".webp",
      ),
    ],
    enables: "six body scan studies",
    rebuild: [
      "python scripts/body-fidelity.py .reference-cache/body-scans --fit",
      "copy .reference-cache/body-scans/reference-fits.json to examples/reference-fits.json",
    ],
  },
  {
    name: "Scanned head fits",
    source: "the scans listed in scripts/head-study/hs_targets.py",
    files: ["examples/head-targets-fits/lee-perry-smith.json"],
    enables: "the editable head study",
    rebuild: [
      "python scripts/head-study/prepare-targets.py .reference-cache/head-study",
      "python scripts/head-study/run.py .reference-cache/head-study --install",
    ],
  },
  {
    name: "Rocketbox dressed avatars",
    source: "https://github.com/microsoft/Microsoft-Rocketbox (MIT)",
    files: [".reference-cache/rocketbox/studies.js", ".reference-cache/rocketbox/LICENSE-rocketbox.txt"],
    enables: "the separate comparison page dist/rocketbox-study.html",
    rebuild: [
      "node scripts/rocketbox-study/fetch.mjs",
      "run the two Blender lines it prints (scripts/rocketbox-study/convert-fbx.py)",
      "copy .reference-cache/rocketbox/studies.js from the machine that fitted the recipes",
      "node scripts/rocketbox-study/build.mjs",
    ],
  },
];

export function localReferencesPlugin() {
  return {
    name: "local-references",
    setup(build) {
      build.onLoad({ filter: /[\\/]examples[\\/]local-references\.js$/ }, async () => {
        const found = await import("../examples/local-references.js");
        return {
          loader: "js",
          contents: Object.entries(found)
            .map(([name, value]) => "export const " + name + " = " + JSON.stringify(value) + ";")
            .join("\n"),
        };
      });
    },
  };
}

async function sha256(file) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}
export async function fetchArchive(archive = mhrArchive, base = root) {
  const file = fileURLToPath(new URL(archive.file, base));
  if (!existsSync(file)) {
    console.log("Downloading " + archive.url);
    await mkdir(new URL(".", pathToFileURL(file)), { recursive: true });
    const reply = await fetch(archive.url);
    if (!reply.ok) throw new Error("Download failed with status " + reply.status + ".");
    await pipeline(Readable.fromWeb(reply.body), createWriteStream(file + ".part"));
    const digest = await sha256(file + ".part");
    if (digest !== archive.sha256) {
      await rm(file + ".part");
      throw new Error("The download has SHA-256 " + digest + ", expected " + archive.sha256 + ".");
    }
    await rename(file + ".part", file);
  } else if ((await sha256(file)) !== archive.sha256)
    throw new Error(file + " does not match SHA-256 " + archive.sha256 + ". Remove it and fetch again.");
  console.log("Verified " + file);
  return file;
}

function report() {
  let installed = 0;
  for (const set of referenceSets) {
    const missing = set.files.filter((file) => !present(file));
    const state = !missing.length ? "installed" : missing.length === set.files.length ? "absent" : "partial";
    if (state === "installed") installed++;
    console.log("\n" + set.name + ": " + state);
    console.log("  enables  " + set.enables);
    if (!missing.length) continue;
    console.log("  source   " + set.source);
    if (state === "partial") console.log("  missing  " + missing.join(", "));
    set.rebuild.forEach((step, i) => console.log("  " + (i ? "        " : "rebuild ") + " " + step));
  }
  console.log(
    "\n" + installed + " of " + referenceSets.length + " optional reference sets installed. " +
      "The workshop builds and its tests pass with none.",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = process.argv.slice(2);
  if (options.some((option) => option !== "--fetch")) {
    console.error("Usage: node scripts/local-references.mjs [--fetch]");
    process.exit(1);
  }
  if (options.includes("--fetch")) await fetchArchive();
  else report();
}
