// Export prepared fixtures with the new builders and compare each against the
// fresh G0 export of its source form at the same preset.
//
//   node --import ../../packages/document/test/support/register.ts src/locked.ts src/run.ts [--preset full] NAME...
//
// Clay exports run in Node. Textured presets run in installed Chrome under
// the shared GPU lock (src/browser/run.ts). Writes the fresh GLBs and
// report.json to .reference-cache/g4a/<preset>/.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { exportCharacter, presets, type Preset } from "@irudd/character";
import { documentJson, readDocument, type CharacterDocument } from "@irudd/document";
import { bundledAsset } from "@irudd/character";
import { openTextured, type TexturedRunner } from "./browser/run.js";
import { compareGlb, type Comparison } from "./compare.js";
import { installNodeExporter } from "./node-exporter.js";
import { fixturesDir, g0Dir, outDir, repository } from "./paths.js";
import { familyRegistry } from "./prepare.js";
import { loadHumanBody } from "./human-assets.js";
import { humanAdultId } from "@irudd/character/human";
import { wardrobeTarget, type Target } from "./targets.js";
import { createHash } from "node:crypto";

export function readFixture(name: string): CharacterDocument {
  const raw: unknown = JSON.parse(readFileSync(join(fixturesDir, name + ".json"), "utf8"));
  const read = readDocument(raw, { registry: familyRegistry });
  if (!read.ok) throw new Error(`${name}: ${JSON.stringify(read.diagnostics)}`);
  return read.value;
}

export function buildId(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim();
}

export function gateSource() {
  const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
    cwd: repository,
    encoding: "utf8",
  });
  return { commit: buildId(), dirty: status.length > 0 };
}

export const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

export interface Row {
  readonly name: string;
  readonly preset: Target;
  readonly reference: string;
  readonly referenceSha256: string;
  readonly fresh: string;
  readonly freshSha256: string;
  readonly ms: number;
  readonly comparison: Comparison;
}

const isTarget = (value: string): value is Target =>
  value === wardrobeTarget || presets.some((p) => p === value);

export async function exportAndCompare(
  name: string,
  preset: Preset,
  doc: CharacterDocument = readFixture(name),
  revision = 1,
): Promise<Row> {
  if (preset !== "clay") throw new Error("Textured presets run in Chrome; use exportTextured.");
  installNodeExporter();
  const started = performance.now();
  // A native adult builds from the body pack.
  const human = doc.generation?.generator === humanAdultId ? await loadHumanBody() : undefined;
  const result = await exportCharacter(doc, {
    preset,
    revision,
    build: buildId(),
    ...(human ? { human } : {}),
  });
  return compareRow(name, preset, doc, result.bytes, Math.round(performance.now() - started));
}

/** Project blobs a document declares, i.e. its assets this build does not ship. */
export function projectBlobs(doc: CharacterDocument) {
  return doc.assets
    .filter((a) => !bundledAsset(a.digest))
    .map((a) => ({ digest: a.digest, mediaType: a.mediaType }));
}

/** A requested export that produced no GLB. */
export interface Failed {
  readonly name: string;
  readonly preset: Target;
  readonly error: string;
}

/**
 * Export documents at textured presets in Chrome and compare each with G0.
 * A preset that throws in the page comes back as a `Failed` entry, so one
 * missing output never hides the others.
 */
export async function exportTextured(
  runner: TexturedRunner,
  jobs: ReadonlyArray<{
    readonly name: string;
    readonly doc: CharacterDocument;
    readonly presets: ReadonlyArray<Target>;
  }>,
  revision = 1,
): Promise<Array<Row | Failed>> {
  const build = buildId();
  const rows: Array<Row | Failed> = [];
  for (const job of jobs) {
    const responses = await runner.exportAll([
      {
        name: job.name,
        document: documentJson(job.doc),
        presets: job.presets,
        blobs: projectBlobs(job.doc),
        revision,
        build,
      },
    ]);
    for (const preset of job.presets) {
      const r = responses.find((x) => x.name === job.name && x.preset === preset);
      rows.push(
        r?.base64
          ? compareRow(
              job.name,
              preset,
              job.doc,
              new Uint8Array(Buffer.from(r.base64, "base64")),
              r.ms,
            )
          : { name: job.name, preset, error: r?.error ?? "no output" },
      );
    }
  }
  return rows;
}

export const isFailed = (row: Row | Failed): row is Failed => "error" in row;

function compareRow(
  name: string,
  preset: Target,
  doc: CharacterDocument,
  bytes: Uint8Array,
  ms: number,
): Row {
  const result = { bytes };
  const dir = join(outDir, preset);
  mkdirSync(dir, { recursive: true });
  const fresh = join(dir, `${name}-${preset}.glb`);
  writeFileSync(fresh, result.bytes);
  const reference = join(g0Dir, "export-a", `${name}-${preset}.glb`);
  const referenceBytes = new Uint8Array(readFileSync(reference));
  return {
    name,
    preset,
    reference,
    referenceSha256: sha256(referenceBytes),
    fresh,
    freshSha256: sha256(result.bytes),
    ms,
    comparison: compareGlb(referenceBytes, result.bytes, {
      regions: new Map(doc.parts.map((p) => [p.label, p.id])),
    }),
  };
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    options: { preset: { type: "string", default: "clay" } },
    allowPositionals: true,
  });
  const preset = values.preset;
  if (!isTarget(preset)) throw new Error("Unknown preset " + preset);
  const rows: Array<Row | Failed> = [];
  const runner = preset === "clay" ? undefined : await openTextured();
  try {
    if (runner) console.log(`Chrome ${runner.session.chrome}, ${runner.session.renderer}`);
    for (const name of positionals) {
      const row = runner
        ? (await exportTextured(runner, [{ name, doc: readFixture(name), presets: [preset] }]))[0]
        : await exportAndCompare(name, "clay");
      if (!row) throw new Error(`${name}: no export`);
      rows.push(row);
      if (isFailed(row)) {
        console.log(`${name} ${preset}: FAILED ${row.error.split("\n")[0] ?? ""}`);
        process.exitCode = 1;
        continue;
      }
      const worst = Math.max(...row.comparison.accessors.map((a) => a.maxAbs));
      const pixels = Math.max(0, ...row.comparison.images.map((i) => i.maxChannel));
      console.log(
        `${name} ${preset}: ${row.comparison.structure.length} structural differences, accessor max |Δ| ${worst}, images max channel ${pixels} over ${row.comparison.images.length}, ${row.ms} ms`,
      );
    }
  } finally {
    // Release Chrome (and with it the GPU lock) even when an export fails.
    await runner?.close();
  }
  mkdirSync(join(outDir, preset), { recursive: true });
  writeFileSync(join(outDir, preset, "report.json"), JSON.stringify(rows, null, 2) + "\n");
}
