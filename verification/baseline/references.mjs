// G0 baseline: freeze what the optional private reference material switches on.
//
// usage: node PATH/TO/verification/baseline/references.mjs OUT_DIR
//
// Run it in a reference checkout (2761eb14 or runtime-identical) where the private sets from
// docs/local-references.md are installed at their ignored paths. It records, as text only:
//   - each optional set from scripts/local-references.mjs: present, partial or absent, and the
//     SHA-256 and size of every installed file (never the bytes)
//   - the values examples/local-references.js exposes: rig ids and fit ids
//   - `npm run build` with the references and again with WORKSHOP_REFERENCES=none: the
//     build's own "included" line, the dist files and their hashes
//   - the focused tests that need the material (radial-fit and local-references modules)
// and writes OUT_DIR/references-config.json. browser.py references drives the built pages.
// The checkout's dist/ is rebuilt, so use a scratch checkout, not one someone is serving.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const out = process.argv[2];
if (!out) throw new Error("usage: references.mjs OUT_DIR");
await mkdir(out, { recursive: true });
const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();
const files = (p) => (statSync(p).isDirectory() ? readdirSync(p).sort().flatMap((n) => files(join(p, n).replaceAll("\\", "/"))) : [p]);
const { referenceSets } = await import(pathToFileURL(resolve("scripts/local-references.mjs")).href);
const sets = referenceSets.map((s) => {
  const present = s.files.filter((f) => existsSync(f));
  return { name: s.name, source: s.source, state: present.length === s.files.length ? "installed" : present.length ? "partial" : "absent",
    missing: s.files.filter((f) => !existsSync(f)), enables: s.enables };
});
// Every ignored file under the private paths the workshop reads, hashed.
const privatePaths = ["examples/mhr-reference.glb", "examples/mhr-fit.json", "examples/reference-fits.json", "examples/workshop-body-fits.json",
  "examples/human-targets", "examples/human-targets-fits", "examples/head-targets-fits"];
const installed = privatePaths.filter((p) => existsSync(p)).flatMap(files).map((f) => ({ file: f, bytes: statSync(f).size, sha256: sha(f),
  ignored: spawnSync("git", ["check-ignore", "-q", f]).status === 0 }));

const node = (code, env = {}) => execFileSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", env: { ...process.env, ...env } });
const valuesCode = `import * as r from "./examples/local-references.js";
console.log(JSON.stringify({ rigs: r.rigs, mhrFit: r.mhrFit ? Object.keys(r.mhrFit) : null, scanFits: r.scanFits ? Object.keys(r.scanFits) : null,
  workshopFits: r.workshopFits ? Object.keys(r.workshopFits.fits ?? {}) : null, headFits: Object.keys(r.headFits) }));`;
const values = { installed: JSON.parse(node(valuesCode)), referencesNone: JSON.parse(node(valuesCode, { WORKSHOP_REFERENCES: "none" })) };

const links = (html) => html.split('href="#compare-mhr"').length - 1;
const shell = { "character-view/index.html": links(readFileSync("character-view/index.html", "utf8")),
  entryRemovesLinkWithoutRig: readFileSync("character-view/entry.js", "utf8").includes(`document.querySelector('a[href="#compare-mhr"]')?.closest("p")?.remove()`) };
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
function build(env) {
  const r = spawnSync(npm, ["run", "build"], { encoding: "utf8", shell: process.platform === "win32", env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error("build failed: " + r.stderr);
  return { workshopReferences: env.WORKSHOP_REFERENCES ?? "(unset)", included: r.stdout.split("\n").find((l) => /reference/.test(l))?.trim(),
    dist: Object.fromEntries(readdirSync("dist").filter((f) => f.endsWith(".html")).sort().map((f) => [f, sha(`dist/${f}`)])),
    // The tracked shell keeps the rig comparison link; entry.js removes it at run time when absent.
    compareMhrLinksInEditorHtml: links(readFileSync("dist/character-view.html", "utf8")) };
}
const builds = { withReferences: build({}), referencesNone: build({ WORKSHOP_REFERENCES: "none" }) };
builds.restored = build({}); // leave the checkout built with its references again

const tests = ["character-view/radial-fit.test.js", "examples/local-references.test.js"];
const tap = spawnSync(process.execPath, ["--test", "--test-reporter=tap", ...tests], { encoding: "utf8" });
const count = (k) => Number(new RegExp(`^# ${k} (\\d+)$`, "m").exec(tap.stdout)?.[1]);
const focused = { modules: tests, exitCode: tap.status, tests: count("tests"), pass: count("pass"), fail: count("fail"), skipped: count("skipped"),
  skippedTests: [...tap.stdout.matchAll(/^\s*ok \d+ - (.*) # SKIP(.*)$/gm)].map((m) => (m[1] + " #" + m[2]).trim()) };

const record = { generatedAt: new Date().toISOString(), commit: git("rev-parse", "HEAD"),
  trackedClean: git("status", "--porcelain", "--untracked-files=no") === "", shell, sets, installed, values, builds, focused };
await writeFile(join(out, "references-config.json"), JSON.stringify(record, null, 2) + "\n");
console.log(JSON.stringify({ sets: sets.map((s) => s.name + ": " + s.state), files: installed.length, builds: Object.fromEntries(Object.entries(builds).map(([k, v]) => [k, v.dist])), focused }, null, 1));
