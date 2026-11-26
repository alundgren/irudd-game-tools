import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadHumanBody } from "./human-assets.js";
import {
  adultClayReferences,
  adultStore,
  checkClay,
  clayBytes,
  documentOf,
  humanOracleDir,
} from "./human-clay.js";
import { installNodeExporter } from "./node-exporter.js";
import { outDir } from "./paths.js";

installNodeExporter();
const started = performance.now();
const body = await loadHumanBody();
const store = adultStore(body);
const rows: Array<{ seed: number; ms?: number; failures: ReadonlyArray<string> }> = [];
for (const { seed, sha256 } of adultClayReferences) {
  const file = join(humanOracleDir, `adult-${seed}-clay.glb`);
  if (!existsSync(file)) {
    rows.push({ seed, failures: [`no reference export at ${file}`] });
    continue;
  }
  const reference = readFileSync(file);
  const digest = createHash("sha256").update(reference).digest("hex");
  if (digest !== sha256) {
    rows.push({ seed, failures: [`${file} has SHA-256 ${digest}, not the recorded ${sha256}`] });
    continue;
  }
  const t = performance.now();
  try {
    const doc = documentOf(store.generated(seed));
    const check = checkClay(reference, await clayBytes(doc, body), doc);
    rows.push({
      seed,
      ms: Math.round(performance.now() - t),
      failures: [
        ...check.comparison.structure.map((d) => `structure ${d.path}`),
        ...check.accessors,
        ...check.meshes.map((key) => `mesh ${key} is not bit-identical`),
      ],
    });
  } catch (error) {
    rows.push({ seed, failures: [error instanceof Error ? error.message : String(error)] });
  }
}
const verified = rows.filter((r) => !r.failures.length).length;
mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, "human-gate.json"),
  JSON.stringify(
    { verified, expected: rows.length, ms: Math.round(performance.now() - started), rows },
    null,
    2,
  ),
);
for (const row of rows)
  console.log(
    `${row.failures.length ? "FAIL" : "ok  "} adult ${row.seed}${row.ms === undefined ? "" : ` ${row.ms} ms`}${row.failures.length ? ": " + row.failures.slice(0, 4).join("; ") : ""}`,
  );
console.log(`human adult clay: ${verified}/${rows.length} verified`);
if (verified !== rows.length) process.exitCode = 1;
