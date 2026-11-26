import assert from "node:assert/strict";
import { execFile, execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { compareGlb, type Comparison } from "./compare.js";
import { isRecord, parseGlb, records } from "./glb.js";
import { g0Dir, outDir, repository } from "./paths.js";
import { authenticateReference } from "./reference.js";

const { values } = parseArgs({
  options: {
    packaged: { type: "string" },
    commit: { type: "string" },
    keep: { type: "boolean", default: false },
  },
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
});
if (!values.packaged) throw new Error('Name the package with --packaged "DIR\\Irudd Workshop".');
const app = resolve(values.packaged);
const exe = join(app, "Irudd Workshop.exe");
const resources = join(app, "resources", "app");
const cliScript = join(resources, "dist", "clients", "irudd.mjs");
const pinned = [exe, cliScript, join(resources, "dist", "main", "main.js")];
for (const file of [...pinned, join(resources, "dist", "build.json")])
  if (!existsSync(file)) throw new Error(`Not a packaged Irudd Workshop: missing ${file}`);

const tolerance = 1e-5;
const samples = [
  { form: "figure-42", targets: ["clay", "game"] },
  { form: "plan-8950", targets: ["game"] },
  { form: "field-wardrobe", targets: ["game", "game-outfits"] },
] as const;
type Target = (typeof samples)[number]["targets"][number];

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const field = (value: unknown, ...keys: Array<string | number>): unknown =>
  keys.reduce<unknown>(
    (v, k) => (isRecord(v) ? v[k] : Array.isArray(v) ? v[Number(k)] : undefined),
    value,
  );
const text = (value: unknown, ...keys: Array<string | number>): string => {
  const v = field(value, ...keys);
  return typeof v === "string" ? v : "";
};
const hashes = (): Record<string, string> =>
  Object.fromEntries(pinned.map((file) => [file, sha256(readFileSync(file))]));

const stamp: unknown = JSON.parse(readFileSync(join(resources, "dist", "build.json"), "utf8"));
const build = text(stamp, "build");
assert.match(build, /^[0-9a-f]{40}$/, `the package's build stamp names a clean commit (${build})`);
if (values.commit) assert.equal(build, values.commit, "the package is the named commit");
const before = hashes();

const scratch = mkdtempSync(join(tmpdir(), "irudd-packaged-samples-"));
const project = join(scratch, "project");
const stateDir = join(scratch, "state");
const files = join(scratch, "exports");
mkdirSync(files);
const report = join(outDir, "packaged-samples");
mkdirSync(report, { recursive: true });

function environment(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env))
    if (
      value !== undefined &&
      key !== "ELECTRON_RUN_AS_NODE" &&
      key !== "ELECTRON_NO_ATTACH_CONSOLE"
    )
      env[key] = value;
  return { ...env, IRUDD_STATE_DIR: stateDir, ...extra };
}

interface Ran {
  readonly code: number;
  readonly value: unknown;
  readonly ms: number;
}

function cli(...args: string[]): Promise<Ran> {
  const started = performance.now();
  return new Promise((done) =>
    execFile(
      exe,
      ["--no-warnings=ExperimentalWarning", cliScript, ...args, "--project", project, "--json"],
      {
        cwd: resources,
        env: environment({ ELECTRON_RUN_AS_NODE: "1" }),
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        let value: unknown;
        try {
          value = JSON.parse(stdout);
        } catch {
          value = { stdout, stderr };
        }
        done({
          code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
          value,
          ms: Math.round(performance.now() - started),
        });
      },
    ),
  );
}

async function ok(...args: string[]): Promise<Ran> {
  const ran = await cli(...args);
  assert.equal(ran.code, 0, `irudd ${args.join(" ")}: ${JSON.stringify(ran.value).slice(0, 800)}`);
  return ran;
}

interface Head {
  readonly revision: number;
  readonly digest: string;
  readonly regions: ReadonlyMap<string, string>;
  readonly parts: ReadonlyArray<{ id: string; label: string; position: number[] }>;
}

async function head(documentId: string): Promise<Head> {
  const shown = await ok("show", documentId);
  const parts = records(field(shown.value, "document", "parts")).map((p) => ({
    id: text(p, "id"),
    label: text(p, "label"),
    position: Array.isArray(p["position"]) ? p["position"].map(Number) : [],
  }));
  return {
    revision: Number(field(shown.value, "revision")),
    digest: text(shown.value, "documentDigest"),
    regions: new Map(parts.map((p) => [p.label, p.id])),
    parts,
  };
}

interface Exported {
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly ms: number;
  readonly gpu: string;
}

async function exportAt(documentId: string, at: Head, target: Target, name: string) {
  const file = join(files, `${name}.glb`);
  const ran = await ok(
    "export",
    documentId,
    "--preset",
    target === "game-outfits" ? "game" : target,
    ...(target === "game-outfits" ? ["--wardrobe"] : []),
    "--revision",
    String(at.revision),
    "--out",
    file,
  );
  const bytes = new Uint8Array(readFileSync(file));
  const manifest = ran.value;
  assert.equal(sha256(bytes), text(manifest, "glb", "sha256"), `${name}: bytes are the manifest's`);
  assert.equal(
    text(manifest, "source", "documentDigest"),
    at.digest,
    `${name}: the revision's digest`,
  );
  const gpu = text(manifest, "gpu", "renderer");
  assert.ok(
    field(manifest, "gpu", "software") !== true && !/swiftshader|llvmpipe|software/i.test(gpu),
    `${name}: rendered on a hardware GPU, not ${gpu}`,
  );
  const provenance = field(parseGlb(bytes).json, "asset", "extras", "irudd");
  assert.equal(text(provenance, "build"), build, `${name}: stamped with the package's build`);
  assert.equal(Number(field(provenance, "revision")), at.revision, `${name}: stamped revision`);
  return { bytes, sha256: sha256(bytes), ms: ran.ms, gpu } satisfies Exported;
}

const inventory = (): Record<string, unknown> => {
  const raw: unknown = JSON.parse(
    readFileSync(join(repository, "verification/baseline/baseline.json"), "utf8"),
  );
  const listed = field(raw, "frozen", "exports", "files");
  if (!isRecord(listed)) throw new Error("Missing the frozen G0 export inventory.");
  return listed;
};
const frozen = inventory();

interface Verdict {
  readonly ok: boolean;
  readonly structure: number;
  readonly counts: boolean;
  readonly accessorMaxAbs: number;
  readonly maxPixel: number;
  readonly comparison: Comparison;
}

function verdict(comparison: Comparison): Verdict {
  const accessorMaxAbs = Math.max(0, ...comparison.accessors.map((a) => a.maxAbs));
  const maxPixel = Math.max(0, ...comparison.images.map((i) => i.maxChannel));
  const counts = Object.values(comparison.counts).every(([a, b]) => a === b);
  const structure = comparison.structure.length;
  return {
    ok: structure === 0 && counts && accessorMaxAbs <= tolerance && maxPixel === 0,
    structure,
    counts,
    accessorMaxAbs,
    maxPixel,
    comparison,
  };
}

function againstG0(form: string, target: Target, fresh: Exported, at: Head) {
  const name = `${form}-${target}.glb`;
  const reference = new Uint8Array(readFileSync(join(g0Dir, "export-a", name)));
  const referenceSha256 = sha256(reference);
  assert.ok(
    authenticateReference(join(g0Dir, "export-a"), name, referenceSha256, frozen[name]),
    `${name} is G0's frozen export`,
  );
  return {
    reference: name,
    referenceSha256,
    ...verdict(compareGlb(reference, fresh.bytes, { regions: at.regions })),
  };
}

const jointCount = (bytes: Uint8Array): number[] =>
  records(parseGlb(bytes).json["skins"]).map((s) =>
    Array.isArray(s["joints"]) ? s["joints"].length : 0,
  );

const rows: Array<Record<string, unknown>> = [];
const steps: Array<Record<string, unknown>> = [];
let failed = false;
const desktop = spawn(
  exe,
  ["--hidden", "--user-data", join(scratch, "user-data"), "--project", project, "--create"],
  {
    cwd: app,
    env: environment({}),
    stdio: ["ignore", "ignore", "pipe"],
  },
);
let desktopErr = "";
desktop.stderr.on(
  "data",
  (chunk: Buffer) => (desktopErr = (desktopErr + chunk.toString()).slice(-4000)),
);

async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    const value = await run();
    const ms = Math.round(performance.now() - started);
    steps.push({ step: name, ms });
    console.log(`ok   ${name} (${ms} ms)`);
    return value;
  } catch (error) {
    steps.push({ step: name, error: error instanceof Error ? error.message : String(error) });
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

try {
  const version = await step("the packaged CLI reports the stamped build", async () => {
    const ran = await ok("version");
    assert.equal(text(ran.value, "build"), build);
    return ran.value;
  });
  const renderer = await step(
    "the packaged desktop serves its review worker on the hardware GPU",
    async () => {
      for (let i = 0; i < 600; i++) {
        const caps = await cli("review");
        if (caps.code === 0 && field(caps.value, "available") === true) {
          assert.equal(text(caps.value, "renderer", "info", "build"), build, "the worker's build");
          const gpu = text(caps.value, "renderer", "info", "gpu", "renderer");
          assert.ok(
            field(caps.value, "renderer", "info", "gpu", "software") !== true,
            `hardware rendering, not ${gpu}`,
          );
          return field(caps.value, "renderer", "info");
        }
        if (desktop.exitCode !== null) throw new Error(`The desktop exited: ${desktopErr}`);
        await new Promise((r) => setTimeout(r, 200));
      }
      throw new Error(`No review worker within 120 s: ${desktopErr}`);
    },
  );

  const heads = new Map<string, Head>();
  for (const { form, targets } of samples) {
    const documentId = `doc-${form}`;
    const at = await step(`irudd new ${documentId} --starter ${form}`, async () => {
      await ok("new", documentId, "--starter", form);
      return head(documentId);
    });
    heads.set(form, at);
    for (const target of targets)
      await step(`${form} ${target} from the packaged CLI equals G0`, async () => {
        const fresh = await exportAt(documentId, at, target, `${form}-${target}`);
        const result = againstG0(form, target, fresh, at);
        const { comparison, ...summary } = result;
        rows.push({
          form,
          target,
          revision: at.revision,
          digest: at.digest,
          sha256: fresh.sha256,
          ms: fresh.ms,
          gpu: fresh.gpu,
          ...summary,
          comparison,
        });
        if (target === "game-outfits") {
          const scenes = records(parseGlb(fresh.bytes).json["scenes"]).length;
          assert.ok(scenes > 1, `the wardrobe export holds one scene per outfit (${scenes})`);
        }
        assert.ok(
          result.ok,
          `${result.structure} structural differences (${comparison.structure
            .slice(0, 3)
            .map((d) => d.path)
            .join(
              ", ",
            )}), counts equal ${String(result.counts)}, accessor max ${result.accessorMaxAbs}, max pixel ${result.maxPixel}`,
        );
      });
  }

  const figure = heads.get("figure-42");
  assert.ok(figure);
  const documentId = "doc-figure-42";
  const rest = await exportAt(documentId, figure, "clay", "figure-42-rest");
  const forearm = figure.parts.find((p) => p.label === "left forearm");
  assert.ok(forearm);
  const [fx = 0, fy = 0, fz = 0] = forearm.position;
  const edited = await step(
    "moving the left forearm 2 cm changes the exported positions",
    async () => {
      await ok(
        "edit",
        documentId,
        "--base",
        String(figure.revision),
        "--op",
        JSON.stringify({
          op: "part.set",
          part: forearm.id,
          set: { position: [fx + 0.02, fy, fz] },
        }),
        "--summary",
        "Move the left forearm",
      );
      const at = await head(documentId);
      assert.equal(at.revision, figure.revision + 1);
      assert.notEqual(at.digest, figure.digest);
      const moved = await exportAt(documentId, at, "clay", "figure-42-edited");
      const result = verdict(compareGlb(rest.bytes, moved.bytes, { regions: at.regions }));
      const positions = result.comparison.accessors.find((a) => a.use === "POSITION");
      assert.ok((positions?.differing ?? 0) > 0, "the forearm's vertices moved");
      rows.push({
        form: "figure-42",
        target: "clay",
        edit: "left forearm +2 cm",
        revision: at.revision,
        sha256: moved.sha256,
        structure: result.structure,
        positionsDiffering: positions?.differing ?? 0,
        positionsMaxAbs: positions?.maxAbs ?? 0,
      });
      return at;
    },
  );
  await step("undoing the edit restores the digest and G0 parity", async () => {
    await ok("undo", documentId, String(edited.revision), "--base", String(edited.revision));
    const at = await head(documentId);
    assert.equal(at.digest, figure.digest, "the undone document is the starter's");
    const undone = await exportAt(documentId, at, "clay", "figure-42-undone");
    const same = verdict(compareGlb(rest.bytes, undone.bytes, { regions: at.regions }));
    assert.ok(same.ok, "the undone export is the rest export");
    const result = againstG0("figure-42", "clay", undone, at);
    const { comparison: _comparison, ...summary } = result;
    rows.push({
      form: "figure-42",
      target: "clay",
      edit: "undone",
      revision: at.revision,
      sha256: undone.sha256,
      ...summary,
    });
    assert.ok(result.ok, "the undone export equals G0");
    heads.set("figure-42", at);
  });
  await step("moving the left thigh 35.08 m keeps every joint of the rig", async () => {
    const at = heads.get("figure-42");
    assert.ok(at);
    const thigh = at.parts.find((p) => p.label === "left thigh");
    assert.ok(thigh);
    const [tx = 0, ty = 0, tz = 0] = thigh.position;
    await ok(
      "edit",
      documentId,
      "--base",
      String(at.revision),
      "--op",
      JSON.stringify({ op: "part.set", part: thigh.id, set: { position: [tx + 35.08, ty, tz] } }),
    );
    const far = await head(documentId);
    const moved = await exportAt(documentId, far, "clay", "figure-42-thigh-far");
    const joints = { rest: jointCount(rest.bytes), far: jointCount(moved.bytes) };
    rows.push({
      form: "figure-42",
      target: "clay",
      edit: "left thigh +35.08 m",
      revision: far.revision,
      sha256: moved.sha256,
      joints,
    });
    assert.deepEqual(joints.far, joints.rest, "the same joints in every skin");
  });

  const after = hashes();
  assert.deepEqual(after, before, "the package's bytes did not change during the run");
  writeFileSync(
    join(report, "report.json"),
    JSON.stringify({ build, version, renderer, pinned: before, tolerance, rows }, null, 2) + "\n",
  );
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  if (desktop.exitCode === null && desktop.pid)
    try {
      execFileSync("taskkill", ["/PID", String(desktop.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      desktop.kill();
    }
  writeFileSync(
    join(report, "steps.json"),
    JSON.stringify({ build, failed, steps }, null, 2) + "\n",
  );
  const parity = rows.filter((r) => "ok" in r);
  console.log(
    `\n${failed ? "FAILED" : "passed"}: build ${build}, ${parity.filter((r) => r["ok"] === true).length}/${parity.length} G0 comparisons, report ${report}`,
  );
  if (values.keep || failed) console.log(`kept ${scratch}`);
  else rmSync(scratch, { recursive: true, force: true });
}
process.exitCode = failed ? 1 : 0;
