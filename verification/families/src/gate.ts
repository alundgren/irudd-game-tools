// G4a families gate: the corpus G0 exported, split into participating and pending forms.
//
//   node --import ../../packages/document/test/support/register.ts src/locked.ts src/gate.ts [--participating]
//
// The corpus is every form in G0's export-a/export.json: tracked examples and
// seeded generator output, each checked against the SHA-256 G0 recorded. A form
// participates when its prepared fixture is checked in. For it the gate
// requires:
//
// - preparing the source again gives the same document as the fixture
// - each preset exports with no structural difference, every accessor within
//   tolerance and every embedded image pixel-identical to G0's export at the
//   same preset; a preset that produces no GLB fails
//
// Clay runs in Node. Full, Game and Portrait run in installed Chrome with a
// hardware GPU, the browser G0 exported with, under the shared GPU lock: run
// this through src/locked.ts.
//
// Any other form is pending, listed with the fields that have no ported family.
// A form that prepares cleanly without a checked-in fixture fails the gate, so
// coverage cannot lag silently. The report goes to .reference-cache/g4a/gate.json.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { bundledAssetNamed, bundledEntry, repaintOperations, type Preset } from "@irudd/character";
import { documentDigest, documentJson } from "@irudd/document";
import { authenticateReference } from "./reference.js";
import { isRecord, records } from "./glb.js";
import {
  examplesDir,
  fixturesDir,
  g0Dir,
  g0PaintDir,
  outDir,
  referenceBlobsDir,
  repository,
} from "./paths.js";
import { prepareForm, preparePacks, UnsupportedForm, type Prepared } from "./prepare.js";
import type { CharacterDocument } from "@irudd/document";
import { applyChecked } from "./apply.js";
import { openTextured, texturedPresets, type Session, type TexturedRunner } from "./browser/run.js";
import { wardrobeTarget, type Target } from "./targets.js";
import { compareGlb } from "./compare.js";
import {
  buildId,
  gateSource,
  exportAndCompare,
  exportTextured,
  isFailed,
  projectBlobs,
  readFixture,
  type Failed,
  type Row,
} from "./run.js";

/** Presets the new builders export. */
const portedPresets: ReadonlyArray<Preset> = ["clay", ...texturedPresets];
const pendingPresets: ReadonlyArray<Preset> = [];
const tolerance = 1e-5;

interface Source {
  readonly name: string;
  readonly file: string;
  readonly origin: "example" | "seeded";
}

interface PresetResult {
  readonly preset: Target;
  readonly ok: boolean;
  readonly error?: string;
  readonly structuralDifferences: number;
  readonly accessorMaxAbs: number;
  readonly maxPixelDifference: number;
  readonly referenceSha256: string;
  readonly freshSha256: string;
  readonly ms: number;
}

type Entry =
  | {
      readonly name: string;
      readonly status: "participating";
      readonly origin: Source["origin"];
      readonly digest: string;
      readonly presets: ReadonlyArray<PresetResult>;
      readonly pendingPresets: ReadonlyArray<Preset>;
    }
  | {
      readonly name: string;
      readonly status: "pending";
      readonly origin: Source["origin"];
      readonly reason: string;
      readonly fields: ReadonlyArray<string>;
    };

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

function corpus(): Map<string, string> {
  const raw: unknown = JSON.parse(readFileSync(join(g0Dir, "export-a", "export.json"), "utf8"));
  const forms = isRecord(raw) ? raw["forms"] : undefined;
  if (!isRecord(forms)) throw new Error("G0 export.json has no forms.");
  const out = new Map<string, string>();
  for (const [file, hash] of Object.entries(forms))
    if (typeof hash === "string") out.set(file.replace(/\.form\.json$/, ""), hash);
  return out;
}

function locate(name: string): Source {
  // G0 exported two raw examples from copies wrapped in the form envelope, which the workshop requires.
  const wrapped = join(g0Dir, "wrapped", name + ".form.json");
  if (existsSync(wrapped)) return { name, file: wrapped, origin: "example" };
  const example = join(examplesDir, name + ".form.json");
  if (existsSync(example)) return { name, file: example, origin: "example" };
  const seeded = join(g0Dir, "seeded", name + ".form.json");
  if (existsSync(seeded)) return { name, file: seeded, origin: "seeded" };
  throw new Error(`No source form for ${name}.`);
}

/** A field path without its part ID, so pending forms can be grouped by family. */
const fieldKind = (field: string): string =>
  field.replace(/^parts\[[^\]]*\]\s?/, "part ").replace(/^part \./, "part.");

function tryPrepare(name: string, raw: unknown): Prepared | UnsupportedForm {
  try {
    return prepareForm(name, raw);
  } catch (error) {
    if (error instanceof UnsupportedForm) return error;
    throw error;
  }
}

interface Ready {
  readonly source: Source;
  readonly sourceHashes: ReadonlySet<string>;
  readonly fixture: CharacterDocument;
  readonly digest: string;
}

function prepareCheck(
  source: Source,
  expectedHash: string,
  canonicalHash: string | undefined,
  failures: string[],
): Entry | Ready {
  const bytes = new Uint8Array(readFileSync(source.file));
  const digestOfSource = sha256(bytes);
  if (digestOfSource !== expectedHash && digestOfSource !== canonicalHash)
    failures.push(`${source.name}: source does not match the SHA-256 G0 exported`);
  const raw: unknown = JSON.parse(new TextDecoder().decode(bytes));
  const hasFixture = existsSync(join(fixturesDir, source.name + ".json"));
  const prepared = tryPrepare(source.name, raw);
  if (prepared instanceof UnsupportedForm) {
    const error = prepared;
    if (hasFixture) failures.push(`${source.name}: has a fixture but no longer prepares`);
    return {
      name: source.name,
      status: "pending",
      origin: source.origin,
      reason: "fields without a ported family",
      fields: [...new Set(error.fields.map(fieldKind))].sort(),
    };
  }
  if (!hasFixture) {
    failures.push(`${source.name}: prepares cleanly but has no checked-in fixture`);
    return {
      name: source.name,
      status: "pending",
      origin: source.origin,
      reason: "no fixture",
      fields: [],
    };
  }
  const fixture = readFixture(source.name);
  const digest = documentDigest(fixture);
  if (documentDigest(prepared.document) !== digest)
    failures.push(`${source.name}: the fixture differs from a fresh preparation`);
  const sourceHashes = new Set([expectedHash]);
  if (canonicalHash) sourceHashes.add(canonicalHash);
  return { source, sourceHashes, fixture, digest };
}

function presetResult(row: Row | Failed, failures: string[]): PresetResult {
  const preset = row.preset;
  if (isFailed(row)) {
    failures.push(`${row.name} ${preset}: no export (${row.error.split("\n")[0] ?? ""})`);
    return {
      preset,
      ok: false,
      error: row.error,
      structuralDifferences: 0,
      accessorMaxAbs: 0,
      maxPixelDifference: 0,
      referenceSha256: "",
      freshSha256: "",
      ms: 0,
    };
  }
  const accessorMaxAbs = Math.max(0, ...row.comparison.accessors.map((a) => a.maxAbs));
  const countsMatch = Object.values(row.comparison.counts).every(([a, b]) => a === b);
  const maxPixelDifference = Math.max(0, ...row.comparison.images.map((image) => image.maxChannel));
  const ok =
    row.comparison.structure.length === 0 &&
    accessorMaxAbs <= tolerance &&
    countsMatch &&
    maxPixelDifference === 0;
  if (!ok)
    failures.push(
      `${row.name} ${preset}: ${row.comparison.structure.length} structural differences, accessor max ${accessorMaxAbs}, max pixel difference ${maxPixelDifference}`,
    );
  return {
    preset,
    ok,
    structuralDifferences: row.comparison.structure.length,
    accessorMaxAbs,
    maxPixelDifference,
    referenceSha256: row.referenceSha256,
    freshSha256: row.freshSha256,
    ms: row.ms,
  };
}

interface RepaintResult {
  readonly form: string;
  readonly preset: Preset;
  readonly ok: boolean;
  readonly structuralDifferences: number;
  readonly differingPositions: number;
  readonly images: number;
  readonly changedImages: ReadonlyArray<number>;
  readonly error?: string;
}

/** A body repainted with typed operations, exported beside its unchanged form. */
interface RepaintCase {
  readonly base: Ready;
  readonly doc: CharacterDocument;
}

const bodyOf = (doc: CharacterDocument) => {
  const body = doc.parts.find((p) => p.label === "body");
  if (!body) throw new Error(`${doc.label} has no body to repaint.`);
  return body;
};

/** feline-worker's body repainted from the bundled courier sheet. */
function courierCase(base: Ready): RepaintCase {
  const courier = bundledAssetNamed("courier");
  if (!courier) throw new Error("The repaint check needs the bundled courier sheet.");
  const ops = repaintOperations(base.fixture, [bodyOf(base.fixture).id], bundledEntry(courier));
  return { base, doc: applyChecked(base.fixture, ops) };
}

/**
 * harbour-trader's body repainted with the sheet G0 accepted in its own
 * selected-body repaint (verification/baseline/paint.py). The typed
 * operations must give exactly the document that preparing G0's saved form
 * gives: the body's atlas, the new sheet's asset and every retained occluder.
 * A missing or mismatched recording fails, so the check cannot pass vacuously.
 */
function oracleCase(base: Ready, failures: string[]): RepaintCase | undefined {
  const fail = (message: string): undefined => {
    failures.push(`repaint oracle: ${message}`);
    return undefined;
  };
  const recordFile = join(g0PaintDir, "paint.json");
  const paintedFile = join(g0PaintDir, "painted.form.json");
  if (!existsSync(recordFile) || !existsSync(paintedFile))
    return fail(`no recording in ${g0PaintDir}; run verification/baseline/paint.py`);
  const record: unknown = JSON.parse(readFileSync(recordFile, "utf8"));
  if (!isRecord(record)) return fail("paint.json is not an object");
  const session = record["session"];
  const artwork = record["artworkSha256"];
  if (
    typeof record["sourceForm"] !== "string" ||
    !base.sourceHashes.has(record["sourceForm"]) ||
    JSON.stringify(record["changedAtlasBindings"]) !== JSON.stringify(["body"]) ||
    record["wholeFormEqualAfterReopen"] !== true ||
    JSON.stringify(record["pageErrors"]) !== "[]" ||
    !isRecord(session) ||
    session["softwareFallback"] !== false ||
    typeof artwork !== "string"
  )
    return fail("the recording is not a clean hardware repaint of this harbour-trader source");
  const painted = tryPrepare(base.source.name, JSON.parse(readFileSync(paintedFile, "utf8")));
  if (painted instanceof UnsupportedForm) return fail(painted.message);
  const digest = "sha256:" + artwork;
  const bytes = painted.blobs.get(digest);
  const sheet = painted.document.assets.find((a) => a.digest === digest);
  if (!bytes || !sheet || sha256(bytes) !== artwork)
    return fail("the saved form does not carry the accepted sheet's bytes");
  mkdirSync(referenceBlobsDir, { recursive: true });
  writeFileSync(join(referenceBlobsDir, digest.replace(":", "-")), bytes);
  const doc = applyChecked(
    base.fixture,
    repaintOperations(base.fixture, [bodyOf(base.fixture).id], sheet),
  );
  if (documentDigest(doc) !== documentDigest(painted.document)) {
    const ours = documentJson(doc);
    const theirs = documentJson(painted.document);
    const field = (value: unknown, key: string) =>
      JSON.stringify(isRecord(value) ? value[key] : undefined);
    const keys = new Set([
      ...Object.keys(isRecord(ours) ? ours : {}),
      ...Object.keys(isRecord(theirs) ? theirs : {}),
    ]);
    const differing = [...keys].filter((k) => field(ours, k) !== field(theirs, k));
    return fail(`the repainted document differs from G0's saved form in ${differing.join(", ")}`);
  }
  return { base, doc };
}

/**
 * Export each repainted case next to its unchanged form. Geometry and
 * structure must be identical and the body's texture must change: exactly one
 * baked image at Full (its neighbours keep theirs, because the old sheet keeps
 * the body as an occluder), and the shared atlas at Game.
 */
async function repaintCheck(
  runner: TexturedRunner,
  cases: ReadonlyArray<RepaintCase>,
  fresh: (name: string, preset: Preset) => Uint8Array,
  failures: string[],
): Promise<RepaintResult[]> {
  const presets: ReadonlyArray<Preset> = ["full", "game"];
  const responses = await runner.exportAll(
    cases.map((c) => ({
      name: c.base.source.name + "-repainted",
      document: documentJson(c.doc),
      presets,
      blobs: projectBlobs(c.doc),
      revision: 1,
      build: buildId(),
    })),
  );
  return cases.flatMap(({ base }) =>
    presets.map((preset): RepaintResult => {
      const form = base.source.name;
      const r = responses.find((x) => x.name === form + "-repainted" && x.preset === preset);
      if (!r?.base64) {
        failures.push(`repaint ${form} ${preset}: no export`);
        return {
          form,
          preset,
          ok: false,
          structuralDifferences: 0,
          differingPositions: 0,
          images: 0,
          changedImages: [],
          error: r?.error ?? "no output",
        };
      }
      const c = compareGlb(fresh(form, preset), new Uint8Array(Buffer.from(r.base64, "base64")));
      const differingPositions = c.accessors
        .filter((a) => a.use === "POSITION")
        .reduce((n, a) => n + a.differing, 0);
      const changedImages = c.images.filter((i) => i.maxChannel > 0).map((i) => i.index);
      const ok =
        c.structure.length === 0 &&
        differingPositions === 0 &&
        (preset === "full" ? changedImages.length === 1 : changedImages.length > 0);
      if (!ok)
        failures.push(
          `repaint ${form} ${preset}: ${c.structure.length} structural differences, ${differingPositions} moved positions, images changed ${JSON.stringify(changedImages)}`,
        );
      return {
        form,
        preset,
        ok,
        structuralDifferences: c.structure.length,
        differingPositions,
        images: c.images.length,
        changedImages,
      };
    }),
  );
}

/** Export every ready form at each preset: clay in Node, the rest in one Chrome session. */
async function exportReady(
  ready: ReadonlyArray<Ready>,
  failures: string[],
  frozen: (file: string) => boolean,
): Promise<{ entries: Entry[]; session: Session | undefined; repaint: RepaintResult[] }> {
  const results = new Map<string, PresetResult[]>(ready.map((r) => [r.source.name, []]));
  for (const r of ready)
    results
      .get(r.source.name)
      ?.push(presetResult(await exportAndCompare(r.source.name, "clay", r.fixture), failures));
  let session: Session | undefined;
  let repaint: RepaintResult[] = [];
  if (ready.length && texturedPresets.length) {
    const runner = await openTextured();
    try {
      session = runner.session;
      // An artist can choose Game as their first export after opening the app.
      // Check the leather bump map before any other export warms the surface kit.
      const coldName = "moraine-mantle-repair";
      const cold = ready.find((r) => r.source.name === coldName);
      if (!cold) throw new Error(`Missing cold Game export fixture ${coldName}.`);
      const [first] = await exportTextured(runner, [
        { name: coldName, doc: cold.fixture, presets: ["game"] },
      ]);
      if (!first) throw new Error(`Missing cold Game export for ${coldName}.`);
      presetResult(first, failures);
      const rows = await exportTextured(
        runner,
        ready.map((r) => ({
          name: r.source.name,
          doc: r.fixture,
          // G0 also exported a wardrobe form's saved outfits; that export must verify too.
          presets: frozen(`${r.source.name}-${wardrobeTarget}.glb`)
            ? [...texturedPresets, wardrobeTarget]
            : texturedPresets,
        })),
      );
      for (const row of rows) results.get(row.name)?.push(presetResult(row, failures));
      const cases: RepaintCase[] = [];
      const feline = ready.find((r) => r.source.name === "feline-worker");
      if (feline) cases.push(courierCase(feline));
      const harbour = ready.find((r) => r.source.name === "harbour-trader");
      const oracle = harbour && oracleCase(harbour, failures);
      if (oracle) cases.push(oracle);
      if (!harbour) failures.push("repaint oracle: harbour-trader does not participate");
      repaint = await repaintCheck(
        runner,
        cases,
        (name, preset) => {
          const row = rows.find((x) => x.name === name && x.preset === preset);
          if (!row || isFailed(row)) throw new Error(`${name} ${preset} did not export.`);
          return new Uint8Array(readFileSync(row.fresh));
        },
        failures,
      );
    } finally {
      await runner.close();
    }
  }
  const entries = ready.map((r): Entry => ({
    name: r.source.name,
    status: "participating",
    origin: r.source.origin,
    digest: r.digest,
    presets: results.get(r.source.name) ?? [],
    pendingPresets,
  }));
  return { entries, session, repaint };
}

function frozenInventory() {
  const raw: unknown = JSON.parse(
    readFileSync(join(repository, "verification/baseline/baseline.json"), "utf8"),
  );
  const frozen = isRecord(raw) && raw["frozen"];
  const exports = isRecord(frozen) && frozen["exports"];
  const files = isRecord(exports) && exports["files"];
  if (!isRecord(files) || Object.keys(files).length === 0)
    throw new Error("Missing frozen G0 export inventory.");
  const corpus = isRecord(frozen) && frozen["corpus"];
  const forms = isRecord(corpus) && corpus["forms"];
  const canonicalHashes = new Map<string, string>();
  for (const form of records(forms)) {
    const rawHash = form["sha256"];
    const canonical = form["canonicalSha256"];
    if (typeof rawHash !== "string" || typeof canonical !== "string")
      throw new Error("Missing frozen canonical form hash.");
    canonicalHashes.set(rawHash, canonical);
  }
  if (canonicalHashes.size === 0) throw new Error("Missing frozen form inventory.");
  return { files, expected: Object.keys(files).sort(), canonicalHashes };
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { participating: { type: "boolean", default: false } } });
  const started = performance.now();
  const source = gateSource();
  // The native adults are prepared against the adult body pack.
  await preparePacks();
  const failures: string[] = [];
  const checked: Array<Entry | Ready> = [];
  const { files, expected, canonicalHashes } = frozenInventory();
  for (const [name, hash] of [...corpus()].sort(([a], [b]) => a.localeCompare(b)))
    checked.push(prepareCheck(locate(name), hash, canonicalHashes.get(hash), failures));
  const ready = checked.filter((c): c is Ready => "fixture" in c);
  const exported = await exportReady(ready, failures, (file) => Object.hasOwn(files, file));
  const byName = new Map(exported.entries.map((e) => [e.name, e]));
  const entries = checked
    .map((c) => ("fixture" in c ? byName.get(c.source.name) : c))
    .filter((e) => e !== undefined);
  const participating = entries.filter((e) => e.status === "participating");
  const pending = entries.filter((e) => e.status === "pending");
  const blockers = new Map<string, number>();
  for (const e of pending)
    if (e.status === "pending")
      for (const f of e.fields) blockers.set(f, (blockers.get(f) ?? 0) + 1);
  const verified = new Set<string>();
  for (const entry of participating) {
    for (const preset of entry.presets) {
      if (!preset.ok) continue;
      const name = `${entry.name}-${preset.preset}.glb`;
      if (authenticateReference(join(g0Dir, "export-a"), name, preset.referenceSha256, files[name]))
        verified.add(name);
      else failures.push(`${name}: comparison reference differs from the frozen G0 content`);
    }
  }
  const outstanding = expected.filter((file) => !verified.has(file));
  const endSource = gateSource();
  if (source.commit !== endSource.commit || source.dirty !== endSource.dirty)
    failures.push("The source checkout changed during verification.");
  if (!values.participating && source.dirty)
    failures.push("Promotion requires a clean source checkout.");
  const complete = outstanding.length === 0 && failures.length === 0;
  const report = {
    source,
    endSource,
    complete,
    expectedExports: expected.length,
    verifiedExports: expected.length - outstanding.length,
    outstanding,
    corpus: entries.length,
    participating: participating.map((e) => e.name),
    pending: pending.map((e) => e.name),
    portedPresets,
    pendingPresets,
    tolerances: { accessorMaxAbs: tolerance, pixelChannel: 0 },
    browser: exported.session ?? null,
    repaint: exported.repaint,
    blockers: Object.fromEntries(
      [...blockers].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    ),
    failures,
    ms: Math.round(performance.now() - started),
    entries,
  };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "gate.json"), JSON.stringify(report, null, 2) + "\n");
  for (const e of participating)
    if (e.status === "participating")
      for (const p of e.presets)
        console.log(
          `${p.ok ? "ok  " : "FAIL"} ${e.name} ${p.preset}: ${p.error ? "no export" : `${p.structuralDifferences} structural, accessor max ${p.accessorMaxAbs}, pixel max ${p.maxPixelDifference}`}, ${p.ms} ms`,
        );
  console.log(
    `${participating.length} of ${entries.length} forms participate at ${portedPresets.join(", ")}; ${pending.length} pending.`,
  );
  for (const r of exported.repaint)
    console.log(
      `${r.ok ? "ok  " : "FAIL"} repaint ${r.form} body ${r.preset}: ${r.structuralDifferences} structural, ${r.differingPositions} moved positions, images changed ${JSON.stringify(r.changedImages)} of ${r.images}`,
    );
  if (exported.session)
    console.log(`Chrome ${exported.session.chrome}, ${exported.session.renderer ?? "no renderer"}`);
  for (const f of failures) console.error("FAIL " + f);
  console.log(`Report: ${join(outDir, "gate.json")} (${report.ms} ms)`);
  console.log(
    `${report.verifiedExports}/${expected.length} frozen exports verified. Promotion ${complete ? "ready" : "incomplete"}.`,
  );
  if (failures.length || (!values.participating && !complete)) process.exitCode = 1;
}
