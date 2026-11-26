// The seeded adult as the built desktop app exports it, against G0: the
// revision-1 exports apps/desktop/scripts/qa-adult.ts saves from the real
// app's review worker (Electron's Chromium on the hardware GPU), compared whole
// with .reference-cache/human-oracle/adult-491-PRESET.glb: structure, every
// accessor and every image by decoded pixels.
//
//   node --import ../../packages/document/test/support/register.ts src/human-desktop.ts [DIR]
//
// DIR defaults to .reference-cache/g4a/human-desktop. A missing export fails.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { compareGlb, type ImageComparison } from "./compare.js";
import { loadHumanBody } from "./human-assets.js";
import { adultStore, documentOf, humanOracleDir } from "./human-clay.js";
import { outDir } from "./paths.js";

const dir = resolve(process.argv[2] ?? join(outDir, "human-desktop"));
const presets = ["clay", "full", "game"] as const;

/**
 * Seed 491's face colour differs from G0 at the lash line by one level in at
 * most two pixels in some runs, as src/human-textured.ts records. Anything
 * beyond it fails.
 */
const residual = { index: 1, maxChannel: 1, pixels: 2 };
const within = (i: ImageComparison) =>
  i.index === residual.index &&
  i.maxChannel <= residual.maxChannel &&
  i.differingPixels <= residual.pixels;

// G0 names each joint's region by the part label; the desktop's document by
// stable part IDs, which the QA saves beside its exports.
const regionsFile = join(dir, "regions.json");
if (!existsSync(regionsFile))
  throw new Error(`No region map at ${regionsFile}; run the desktop QA.`);
const saved: unknown = JSON.parse(readFileSync(regionsFile, "utf8"));
if (typeof saved !== "object" || saved === null)
  throw new Error("The region map is not an object.");
const regions = new Map(
  Object.entries(saved).filter((e): e is [string, string] => typeof e[1] === "string"),
);
// The desktop's document holds the same parts as the seeded adult's.
const doc = documentOf(adultStore(await loadHumanBody()).generated(491));
const labels = doc.parts.map((p) => p.label).sort();
if (JSON.stringify([...regions.keys()].sort()) !== JSON.stringify(labels))
  throw new Error("The desktop's adult does not have the seeded adult's parts.");
const rows: Array<Record<string, unknown>> = [];
let failed = false;
for (const preset of presets) {
  const file = join(dir, `adult-491-${preset}.glb`);
  if (!existsSync(file)) {
    failed = true;
    console.log(`adult 491 ${preset}: no desktop export at ${file}`);
    rows.push({ preset, error: `no export ${file}` });
    continue;
  }
  const comparison = compareGlb(
    readFileSync(join(humanOracleDir, `adult-491-${preset}.glb`)),
    readFileSync(file),
    { regions },
  );
  const accessors = comparison.accessors.filter((a) => a.maxAbs > 1e-6);
  const images = comparison.images.filter((i) => i.maxChannel > 0 && !within(i));
  const kept = comparison.images.filter((i) => i.maxChannel > 0 && within(i));
  if (comparison.structure.length || accessors.length || images.length) failed = true;
  rows.push({ preset, knownResidual: kept.map((i) => i.index), ...comparison });
  console.log(
    `adult 491 ${preset} from the desktop: ${comparison.structure.length} structure, ` +
      `${accessors.length} of ${comparison.accessors.length} accessor uses and ` +
      `${images.length} of ${comparison.images.length} images differ` +
      (kept.length ? `; image ${residual.index} within its recorded residual` : ""),
  );
  for (const d of comparison.structure.slice(0, 12))
    console.log(
      `  structure ${d.path}: ${JSON.stringify(d.reference)} → ${JSON.stringify(d.fresh)}`.slice(
        0,
        240,
      ),
    );
  for (const a of accessors.slice(0, 12))
    console.log(`  accessor ${a.use}: ${a.differing}/${a.values} differ, max ${a.maxAbs}`);
  for (const i of images)
    console.log(`  image ${i.index}: max ${i.maxChannel}, ${i.differingPixels} pixels differ`);
}
writeFileSync(join(dir, "report.json"), JSON.stringify({ rows }, null, 2));
process.exitCode = failed ? 1 : 0;
