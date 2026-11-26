// G0 baseline: fast independent recheck of baseline.json against the pinned source.
//
// usage: node PATH/TO/verification/baseline/check.mjs [--build] [--g0 DIR] [--frames N|all] [--run DIR]
//
// Run it in a clean checkout of 2761eb14 (LF or CRLF, after `npm ci`). Without a browser,
// GPU or provider it regenerates, into a temporary directory:
//   - the inventory: counts, every gitBlob and canonicalSha256, the canonical aggregates and
//     licence titles must equal baseline.json; working-tree sha256 values must equal the
//     frozen ones in a CRLF checkout and the canonical ones in an LF checkout
//   - workflows.json, which must equal frozen.workflows
//   - the seeded generator digest
//   - with --build, `npm run build` (this rewrites dist/), whose hashes must equal the frozen
//     build for this checkout's line endings
// With --g0 DIR (a G0 cache) it also reruns freeze.mjs on that cache, which must reproduce the
// checked-in baseline.json byte for byte, and re-decodes N r0 capture frames per capture set
// (default 24) with compare.py frames. With --run DIR (the .reference-cache/g0 of a fresh
// run-g0.mjs run, --quick is enough) it compares that run's exports by content digest, its r0
// captures by decoded pixels, its offline flow statuses and its public reference view with the
// frozen records. Prints one line per check and exits 1 on a mismatch.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
const baselineText = readFileSync(join(HERE, "baseline.json"), "utf8");
const { frozen } = JSON.parse(baselineText);
const tmp = mkdtempSync(join(tmpdir(), "g0-check-"));
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? " · " + detail : ""}`); };
const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();
const node = (script, ...a) => execFileSync(process.execPath, [join(HERE, script), ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");

const head = git("rev-parse", "HEAD");
check("checkout is 2761eb14", head.startsWith("2761eb14"), head);
check("tracked files clean", git("status", "--porcelain", "--untracked-files=no") === "");

// Inventory
node("inventory.mjs", tmp);
const inv = JSON.parse(readFileSync(join(tmp, "inventory.json"), "utf8"));
const crlf = (inv.checkout.workingTreeEol["w/crlf"] ?? 0) > 0;
const mode = crlf ? "CRLF" : "LF";
const c = frozen.corpus;
check("inventory counts", isDeepStrictEqual(inv.counts, c.counts));
check("canonical aggregates (package.json, lock, corpus, tests, python tests, licences)", isDeepStrictEqual(inv.hashes.canonical, c.hashes.canonical));
check(`working-tree aggregates for a ${mode} checkout`, crlf
  ? ["package.json", "package-lock.json", "corpus", "tests"].every((k) => inv.hashes[k] === c.hashes[k])
  : ["package.json", "package-lock.json"].every((k) => inv.hashes[k] === c.hashes.canonical[k].canonicalSha256) &&
    ["corpus", "tests"].every((k) => inv.hashes[k] === c.hashes.canonical[k]));
const rows = (list, frozenList, pick) => {
  const want = new Map(frozenList.map((r) => [r.file ?? r[0], r]));
  return list.filter((r) => { const f = want.get(r.file); return !f || !pick(r, f); }).map((r) => r.file);
};
const same = (r, f) => r.gitBlob === f.gitBlob && r.canonicalSha256 === (f.canonicalSha256 ?? r.canonicalSha256) && r.sha256 === (crlf ? f.sha256 : r.canonicalSha256);
const tuple = (r, f) => r.gitBlob === f[2] && r.canonicalSha256 === f[3] && r.sha256 === (crlf ? f[1] : f[3]);
for (const [name, list, want, pick] of [["forms", inv.forms, c.forms, same], ["glbs", inv.glbs, c.glbs, (r, f) => r.gitBlob === f.gitBlob && r.sha256 === f.sha256],
  ["other fixtures", inv.otherFixtures, c.otherFixtures, same], ["licences", inv.licenses, c.licenses, (r, f) => same(r, f) && r.title === f.title],
  ["test modules", inv.testModules, c.testModules.files, tuple]]) {
  const bad = rows(list, want, pick);
  check(`${name}: ${list.length} records by gitBlob, canonicalSha256 and ${mode} sha256`, list.length === want.length && !bad.length, bad.slice(0, 5).join(", "));
}

// Workflows and seeded generators
node("workflows.mjs", tmp);
check("workflows.json equals frozen.workflows", isDeepStrictEqual(JSON.parse(readFileSync(join(tmp, "workflows.json"), "utf8")), frozen.workflows));
const seeded = JSON.parse(node("seeded.mjs", tmp).trim().split("\n").pop());
check("seeded generator digest", seeded.digest === frozen.seeded.digest, seeded.digest.slice(0, 16));

if (args.includes("--build")) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const r = spawnSync(npm, ["run", "build"], { encoding: "utf8", shell: process.platform === "win32", env: { ...process.env, WORKSHOP_REFERENCES: "none" } });
  const dist = Object.fromEntries(readdirSync("dist").filter((f) => f.endsWith(".html")).sort().map((f) => [f, sha(join("dist", f))]));
  const want = crlf ? frozen.build.runs[0] : frozen.lineEndings?.clones.lf.build;
  check(`public build hashes for a ${mode} checkout`, r.status === 0 && isDeepStrictEqual(dist, want), JSON.stringify(dist));
}

const g0 = opt("--g0");
if (g0) {
  const out = join(tmp, "baseline.json");
  execFileSync(process.execPath, [join(HERE, "freeze.mjs"), out], { env: { ...process.env, G0_DIR: g0 }, stdio: ["ignore", "ignore", "inherit"] });
  check("freeze.mjs on the cache reproduces baseline.json byte for byte", readFileSync(out, "utf8") === baselineText);
  for (const section of ["shipped", "fresh"]) {
    const dir = join(g0, `capture-${section}`);
    if (!existsSync(dir)) { check(`capture-${section} present`, false); continue; }
    const r = spawnSync("python", [join(HERE, "compare.py"), "frames", dir, join(HERE, "baseline.json"), section, opt("--frames") ?? "24"], { encoding: "utf8" });
    check(`capture-${section} r0 frames: file hash and decoded pixels`, r.status === 0, r.stdout.trim());
  }
}
// A fresh run (run-g0.mjs, usually --quick --skip-suite) compared with the frozen records.
const run = opt("--run");
if (run) {
  const { glbSummary } = await import("./glb.mjs");
  const read = (f) => (existsSync(join(run, f)) ? JSON.parse(readFileSync(join(run, f), "utf8")) : null);
  for (const [dir, want] of [["export-a", frozen.exports.files], ["export-b", frozen.exports.files], ["export-adult", frozen.exports.adultRoute]]) {
    const files = Object.keys(read(`${dir}/export.json`)?.files ?? {});
    const bad = files.filter((f) => glbSummary(readFileSync(join(run, dir, f))).contentDigest !== want[f]?.contentDigest);
    check(`${dir}: ${files.length} fresh exports by content digest`, files.length > 0 && !bad.length, bad.join(", "));
  }
  for (const section of ["shipped", "fresh"]) {
    const pix = read(`capture-${section}/pixels.json`), want = frozen.captures[section].r0;
    const shots = Object.entries(pix?.frames.r0 ?? {});
    const bad = shots.filter(([k, d]) => { const [g, s] = [k.split("/")[0], k.split("/")[1].replace(/\.png$/, "")];
      return !isDeepStrictEqual(want[g]?.decoded?.[s], [d.width, d.height, d.mode, d.pixelSha256]); }).map(([k]) => k);
    const sameFile = shots.filter(([k, d]) => want[k.split("/")[0]]?.shots[k.split("/")[1].replace(/\.png$/, "")] === d.sha256).length;
    check(`capture-${section}: ${shots.length} r0 shots by decoded pixels`, shots.length > 0 && !bad.length, `${sameFile}/${shots.length} also byte-identical${bad.length ? "; differ: " + bad.slice(0, 5).join(", ") : ""}`);
  }
  const flows = read("flows/flows.json");
  if (flows) {
    const statuses = (f) => f.proposal.rounds.map((r) => [r.requestStatus, r.staleProposal, r.importStatus, r.inspectStatus ?? null, r.decisionStatus, r.refinements?.map((x) => [x.status, x.replyStatus, x.inspectStatus, x.previousReview]) ?? null]);
    check("flows: offline AI-tab statuses", isDeepStrictEqual(statuses(flows), statuses(frozen.flows)));
    check("flows: hybrid forms reopen with the same content digest", flows.hybrid.generated.every((h) => h.reopenedSameContent && h.status === "Generated a new starting form."));
  }
  const pub = read("references-public/references.json");
  if (pub) {
    const view = (r) => ({ formsTab: r.formsTab, studyList: r.studyList, fit3dReference: r.fit3dReference, routes: r.routes });
    check("references: public build hides the reference studies as frozen", isDeepStrictEqual(view(pub), view(frozen.referenceMaterial.public)));
  }
}
console.log(results.every(Boolean) ? "all checks passed" : `${results.filter((x) => !x).length} check(s) failed`);
process.exit(results.every(Boolean) ? 0 : 1);
