import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const S = (name) => join(HERE, name);

const flags = new Set(process.argv.slice(2));
const quick = flags.has("--quick");
const G0 = ".reference-cache/g0";
const log = [];
const sh = (cmd, args, opts = {}) => {
  const started = Date.now();
  console.log("$", cmd, args.join(" "));
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: false, ...opts });
  const entry = { command: [cmd, ...args].join(" "), exitCode: r.status, seconds: (Date.now() - started) / 1000 };
  log.push(entry);
  if (r.status !== 0 && !opts.allowFail) throw new Error(`failed: ${entry.command}`);
  return entry;
};
const py = (args) =>
  process.platform === "win32"
    ? sh("powershell", ["-NoProfile", "-File", S("gpu-lock.ps1"), ...args])
    : sh("python3", args);
const sha = async (f) => createHash("sha256").update(await readFile(f)).digest("hex");
const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();
await mkdir(G0, { recursive: true });

sh(process.execPath, [S("inventory.mjs"), G0]);
sh(process.execPath, [S("workflows.mjs"), G0]);
const seededRuns = [];
for (let i = 0; i < 2; i++) {
  const out = execFileSync(process.execPath, [S("seeded.mjs"), G0], { encoding: "utf8" });
  seededRuns.push(JSON.parse(out.trim().split("\n").pop()));
}
if (!flags.has("--skip-suite")) {
  sh(process.execPath, [S("run-suite.mjs"), "full-cold"]);
  sh(process.execPath, [S("run-suite.mjs"), "full-warm"]);
  sh(process.execPath, [S("run-suite.mjs"), "full-references-none"], { env: { ...process.env, WORKSHOP_REFERENCES: "none" } });
}
const builds = [];
for (let i = 0; i < 2; i++) {
  sh(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], { shell: process.platform === "win32" });
  builds.push(Object.fromEntries(await Promise.all((await readdir("dist")).filter((f) => f.endsWith(".html")).sort().map(async (f) => [f, await sha(`dist/${f}`)]))));
}
await mkdir(`${G0}/build`, { recursive: true });
for (const f of Object.keys(builds[1])) await copyFile(`dist/${f}`, `${G0}/build/${f}`);

if (!flags.has("--skip-browser")) {
  await mkdir(`${G0}/wrapped`, { recursive: true });
  const inventory = JSON.parse(await readFile(`${G0}/inventory.json`, "utf8"));
  const forms = [];
  for (const f of inventory.forms) {
    if (f.openableInEditor) { forms.push(f.file); continue; }
    const wrapped = `${G0}/wrapped/${f.name}.form.json`;
    await writeFile(wrapped, JSON.stringify({ format: "irudd.form.v1", form: JSON.parse(await readFile(f.file, "utf8")) }));
    forms.push(f.file, wrapped);
  }
  const seededForms = ["plan-8950", "plan-8990", "figure-42", "creature-42", "human-42"].map((n) => `${G0}/seeded/${n}.form.json`);
  const all = quick ? forms.slice(0, 3) : [...forms, ...seededForms];
  py([S("browser.py"), "export", `${G0}/build`, `${G0}/export-a`, ...all, "--outfits"]);
  py([S("browser.py"), "export", `${G0}/build`, `${G0}/export-b`, ...all, "--outfits", "--reverse"]);
  py([S("browser.py"), "adult", `${G0}/build`, `${G0}/export-adult`, ...(quick ? ["42"] : ["1", "42", "491"])]);
  sh("python", [S("compare.py"), "exports", `${G0}/export-a`, `${G0}/export-b`, `${G0}/export-variance.json`]);
  sh("python", [S("compare.py"), "shipped", `${G0}/export-a`, `${G0}/shipped-vs-fresh.json`]);
  const shipped = inventory.glbs.map((g) => g.file);
  py([S("browser.py"), "capture", `${G0}/build`, `${G0}/capture-shipped`, ...(quick ? shipped.slice(0, 3) : shipped), "--repeat", "3"]);
  const fresh = (await readdir(`${G0}/export-a`)).filter((f) => f.endsWith("-game.glb")).sort().map((f) => `${G0}/export-a/${f}`);
  py([S("browser.py"), "capture", `${G0}/build`, `${G0}/capture-fresh`, ...(quick ? fresh.slice(0, 3) : fresh), "--repeat", "2"]);
  for (const dir of [`${G0}/capture-shipped`, `${G0}/capture-fresh`]) {
    sh("python", [S("compare.py"), "captures", dir]);
    sh("python", [S("compare.py"), "pixels", dir]);
    sh("python", [S("compare.py"), "reencode", dir, `${dir}/reencode.json`, ...(quick ? ["24"] : [])]);
  }
  py([S("browser.py"), "flows", `${G0}/build`, `${G0}/flows`, "character-view/armour-devices.webp"]);
  if (existsSync("examples/mhr-reference.glb")) {
    sh(process.execPath, [S("references.mjs"), `${G0}/references-private`]);
    py([S("browser.py"), "references", "dist", `${G0}/references-private`]);
  }
  py([S("browser.py"), "references", `${G0}/build`, `${G0}/references-public`]);
}

const python = execFileSync("python", ["-c", "import sys,PIL,numpy;from importlib.metadata import version;print(sys.version.split()[0],PIL.__version__,numpy.__version__,version('playwright'))"], { encoding: "utf8" }).trim().split(" ");
const manifest = {
  plan: "workshop-desktop-port · item inventory (G0) · check baseline",
  generatedAt: new Date().toISOString(),
  commit: git("rev-parse", "HEAD"),
  referenceCommit: git("rev-parse", "2761eb14"),
  runtimeTreeVsReference: git("diff", "--stat", "2761eb14", "HEAD", "--", ".", ":!AGENTS.md", ":!docs", ":!verification") || "identical outside AGENTS.md, docs/ and verification/",
  toolchain: { node: process.version, npm: execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["--version"], { encoding: "utf8", shell: process.platform === "win32" }).trim(), python: python[0], pillow: python[1], numpy: python[2], playwright: python[3], platform: `${process.platform}-${process.arch}` },
  privateReferencesPresent: ["examples/mhr-reference.glb", "examples/mhr-fit.json", "examples/reference-fits.json", "examples/workshop-body-fits.json"].filter((f) => existsSync(f)),
  seeded: { runs: seededRuns, deterministic: seededRuns.every((r) => r.digest === seededRuns[0].digest) },
  builds: { runs: builds, reproducible: JSON.stringify(builds[0]) === JSON.stringify(builds[1]) },
  steps: log,
};
await writeFile(`${G0}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
console.log(`wrote ${G0}/manifest.json`);
