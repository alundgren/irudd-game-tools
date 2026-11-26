// G0 baseline: inventory and build the reference in an LF and a CRLF clone.
//
// usage: node PATH/TO/verification/baseline/eol.mjs SOURCE_REPO WORK_DIR OUT_DIR [--build]
//
// Makes WORK_DIR/lf (core.autocrlf=false) and WORK_DIR/crlf (core.autocrlf=true) as shared
// clones of SOURCE_REPO detached at 2761eb14, unless they already exist there at that commit,
// and runs inventory.mjs in each. --build also runs `npm ci` where node_modules is missing
// and `npm run build`, recording the dist hashes. Writes OUT_DIR/eol-lf/inventory.json,
// OUT_DIR/eol-crlf/inventory.json and OUT_DIR/eol.json, which checks that
//   - every gitBlob and canonicalSha256 agrees between the two clones,
//   - LF working-tree hashes equal the canonical hashes,
//   - CRLF working-tree hashes equal the frozen sha256 values in baseline.json,
// and lists which hashes depend on the checkout's line endings.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const [source, work, out] = process.argv.slice(2).filter((a) => !a.startsWith("--")).map((p) => resolve(p));
const withBuild = process.argv.includes("--build");
if (!out) throw new Error("usage: eol.mjs SOURCE_REPO WORK_DIR OUT_DIR [--build]");
const REF = "2761eb14c04a96f91d9e68159347c741ae1f7e98";
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();
const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const frozen = JSON.parse(await readFile(join(HERE, "baseline.json"), "utf8")).frozen;

const clones = {};
for (const [mode, autocrlf] of [["lf", "false"], ["crlf", "true"]]) {
  const dir = join(work, mode);
  if (!existsSync(dir)) {
    await mkdir(work, { recursive: true });
    execFileSync("git", ["clone", "-q", "--shared", "--no-checkout", source, dir]);
    git(dir, "config", "core.autocrlf", autocrlf);
    git(dir, "checkout", "-q", "--detach", REF);
  }
  if (git(dir, "rev-parse", "HEAD") !== REF) throw new Error(`${dir} is not at ${REF}`);
  if (git(dir, "config", "--get", "core.autocrlf") !== autocrlf) throw new Error(`${dir} core.autocrlf is not ${autocrlf}`);
  const target = join(out, `eol-${mode}`);
  execFileSync(process.execPath, [join(HERE, "inventory.mjs"), target], { cwd: dir, stdio: ["ignore", "ignore", "inherit"] });
  const inventory = JSON.parse(await readFile(join(target, "inventory.json"), "utf8"));
  let build = null;
  if (withBuild) {
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const run = (args) => { const r = spawnSync(npm, args, { cwd: dir, encoding: "utf8", shell: process.platform === "win32" }); if (r.status !== 0) throw new Error(`${npm} ${args.join(" ")} failed in ${dir}`); };
    if (!existsSync(join(dir, "node_modules"))) run(["ci", "--no-audit", "--no-fund"]);
    run(["run", "build"]);
    build = Object.fromEntries(readdirSync(join(dir, "dist")).filter((f) => f.endsWith(".html")).sort().map((f) => [f, sha(join(dir, "dist", f))]));
  }
  clones[mode] = { dir, inventory, build };
}

// Every inventoried file record, keyed by path.
const records = (inv) => new Map([...inv.forms, ...inv.glbs, ...inv.otherFixtures, ...inv.testModules, ...inv.licenses].map((r) => [r.file, r]));
const lf = records(clones.lf.inventory), crlf = records(clones.crlf.inventory);
const frozenSha = new Map([...frozen.corpus.forms, ...frozen.corpus.glbs, ...frozen.corpus.otherFixtures, ...(frozen.corpus.licenses ?? [])].map((r) => [r.file, r.sha256]));
const mismatch = (pred) => [...lf.keys()].filter((f) => !pred(f));
const checks = {
  sameFiles: JSON.stringify([...lf.keys()].sort()) === JSON.stringify([...crlf.keys()].sort()),
  canonicalAgrees: mismatch((f) => lf.get(f).gitBlob === crlf.get(f)?.gitBlob && lf.get(f).canonicalSha256 === crlf.get(f)?.canonicalSha256),
  lfWorkingTreeIsCanonical: mismatch((f) => lf.get(f).sha256 === lf.get(f).canonicalSha256),
  crlfWorkingTreeMatchesFrozen: mismatch((f) => !frozenSha.has(f) || crlf.get(f).sha256 === frozenSha.get(f)),
  canonicalAggregatesAgree: JSON.stringify(clones.lf.inventory.hashes.canonical) === JSON.stringify(clones.crlf.inventory.hashes.canonical),
  crlfAggregatesMatchFrozen: ["package.json", "package-lock.json", "corpus", "tests"].every((k) => clones.crlf.inventory.hashes[k] === frozen.corpus.hashes[k]),
};
const eolDependent = [...lf.keys()].filter((f) => lf.get(f).sha256 !== crlf.get(f).sha256);
const record = {
  generatedAt: new Date().toISOString(),
  referenceCommit: REF,
  clones: Object.fromEntries(Object.entries(clones).map(([m, c]) => [m, { checkout: c.inventory.checkout, hashes: c.inventory.hashes, build: c.build }])),
  checks,
  passed: checks.sameFiles && checks.canonicalAggregatesAgree && checks.crlfAggregatesMatchFrozen &&
    !checks.canonicalAgrees.length && !checks.lfWorkingTreeIsCanonical.length && !checks.crlfWorkingTreeMatchesFrozen.length,
  workingTreeHashDependsOnEol: { files: eolDependent.length, of: lf.size, binaryOrNewlineFree: lf.size - eolDependent.length },
  buildDependsOnEol: withBuild ? JSON.stringify(clones.lf.build) !== JSON.stringify(clones.crlf.build) : null,
};
await writeFile(join(out, "eol.json"), JSON.stringify(record, null, 2) + "\n");
console.log(JSON.stringify({ passed: record.passed, checks: Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, Array.isArray(v) ? v.length + " mismatches" : v])), workingTreeHashDependsOnEol: record.workingTreeHashDependsOnEol, builds: withBuild ? { lf: clones.lf.build, crlf: clones.crlf.build } : "skipped" }, null, 1));
process.exit(record.passed ? 0 : 1);
