// G0 baseline: inventory the tracked corpus at the reference commit.
//
// usage: node verification/baseline/inventory.mjs [OUT_DIR]
//
// Run it with the reference checkout as the current directory; the script itself may live
// in another checkout (node /path/to/verification/baseline/inventory.mjs /path/to/out).
// Reads only Git-tracked files (git ls-files), so private material on the machine never
// enters the inventory. Writes OUT_DIR/inventory.json (default .reference-cache/g0).
// Every example form, every tracked GLB, every JS test module and the other example JSON
// fixtures get a SHA-256, a structural summary and the tracked files that mention them.
//
// Two hashes identify each file. "sha256" hashes the working-tree bytes of this checkout, so
// for text it follows core.autocrlf (CRLF on a default Windows clone, LF elsewhere).
// "gitBlob" is the blob id at HEAD and "canonicalSha256" hashes that blob's bytes (the LF
// form Git stores), so both agree across LF and CRLF clones. Compare checkouts by the
// canonical pair; "checkout" records which line endings the working-tree hashes saw.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { glbSummary } from "./glb.mjs";

const out = process.argv[2] ?? ".reference-cache/g0";
await mkdir(out, { recursive: true });
const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 1 << 28 }).trim();
const tracked = git("ls-files").split("\n");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
// Blob id and stored bytes of every file at HEAD, read in one git cat-file batch.
const blobOf = new Map(git("ls-tree", "-r", "--full-tree", "HEAD").split("\n").map((l) => {
  const [meta, path] = l.split("\t");
  return [path, meta.split(" ")[2]];
}));
const stored = new Map();
{
  const ids = [...new Set(blobOf.values())];
  const raw = execFileSync("git", ["cat-file", "--batch"], { input: ids.join("\n") + "\n", maxBuffer: 1 << 30 });
  for (let at = 0; at < raw.length; ) {
    const eol = raw.indexOf(10, at);
    const [id, , size] = raw.subarray(at, eol).toString().split(" ");
    stored.set(id, raw.subarray(eol + 1, eol + 1 + Number(size)));
    at = eol + 1 + Number(size) + 1;
  }
}
const canonical = (file) => ({ gitBlob: blobOf.get(file), canonicalSha256: sha256(stored.get(blobOf.get(file))) });
const eolStates = git("ls-files", "--eol").split("\n").map((l) => l.split(/\s+/)[1]);
const checkout = {
  coreAutocrlf: (() => { try { return git("config", "--get", "core.autocrlf"); } catch { return "(unset)"; } })(),
  workingTreeEol: Object.fromEntries([...new Set(eolStates)].sort().map((k) => [k, eolStates.filter((x) => x === k).length])),
  dirty: git("status", "--porcelain", "--untracked-files=no") !== "",
};
// Text files that may name an example: sources, tests, docs and trial records.
const textFiles = tracked.filter((f) => /\.(m?js|py|md|html|json)$/.test(f) && !/\.form\.json$/.test(f));
const texts = new Map(await Promise.all(textFiles.map(async (f) => [f, await readFile(f, "utf8")])));
const mentions = (needle) => [...texts].filter(([, t]) => t.includes(needle)).map(([f]) => f).sort();

// The reference tree is the current directory, which may be another checkout than this script's.
const { validateForm } = await import(pathToFileURL(resolve("character-view/recipe.js")).href);

function formSummary(file, raw) {
  const data = JSON.parse(raw);
  const wrapped = data.format !== undefined;
  const form = wrapped ? data.form : data;
  const origin = form.origin ?? null;
  const artwork = Object.entries(form.artwork ?? {}).map(([id, uri]) => {
    const m = /^data:([^;]+);base64,(.*)$/s.exec(uri);
    const bytes = m ? Buffer.from(m[2], "base64") : Buffer.alloc(0);
    // Artwork ids are "<role>-<sha256 of the decoded bytes>" (art-, side-, face-, ...).
    const hash = sha256(bytes);
    return { id, role: id.slice(0, id.lastIndexOf("-")), mime: m?.[1] ?? null, bytes: bytes.length, sha256: hash, idMatchesContent: id.endsWith("-" + hash) };
  });
  let valid = true, error = null;
  try { validateForm(structuredClone(form)); } catch (e) { valid = false; error = String(e.message ?? e); }
  const name = basename(file, ".form.json");
  return {
    file,
    name,
    sha256: sha256(raw),
    ...canonical(file),
    bytes: Buffer.byteLength(raw),
    envelope: wrapped ? data.format : "bare (no format envelope; the editor's Open form rejects it)",
    openableInEditor: data.format === "irudd.form.v1",
    validateForm: valid ? "ok" : error,
    kind: form.human ? "adult (human surface)" : origin?.kind ?? "authored parts",
    generator: origin?.generator ?? null,
    seed: origin?.seed ?? null,
    keys: Object.keys(form),
    parts: form.parts?.length ?? 0,
    poses: form.poses ? Object.keys(form.poses).length : 0,
    outfitSets: form.outfitSets ? (Array.isArray(form.outfitSets) ? form.outfitSets.length : Object.keys(form.outfitSets).length) : 0,
    occluders: form.occluders ? (Array.isArray(form.occluders) ? form.occluders.length : Object.keys(form.occluders).length) : 0,
    artwork,
    trackedGlb: tracked.includes(`examples/${name}.glb`) ? `examples/${name}.glb` : null,
    mentionedBy: mentions(name + ".form.json").concat(mentions(`"${name}"`)).filter((v, i, a) => a.indexOf(v) === i),
  };
}

const forms = [];
for (const f of tracked.filter((f) => /^examples\/[^/]+\.form\.json$/.test(f)).sort())
  forms.push(formSummary(f, await readFile(f, "utf8")));

const glbs = [];
for (const f of tracked.filter((f) => f.endsWith(".glb")).sort()) {
  const bytes = await readFile(f);
  const name = basename(f, ".glb");
  glbs.push({
    file: f,
    sha256: sha256(bytes),
    ...canonical(f),
    sourceForm: tracked.includes(`examples/${name}.form.json`) ? `examples/${name}.form.json` : null,
    mentionedBy: mentions(name + ".glb"),
    ...glbSummary(bytes),
  });
}

const otherFixtures = [];
for (const f of tracked.filter((f) => /^examples\/[^/]+\.json$/.test(f) && !f.endsWith(".form.json")).sort()) {
  const raw = await readFile(f, "utf8");
  const data = JSON.parse(raw);
  otherFixtures.push({ file: f, sha256: sha256(raw), ...canonical(f), bytes: Buffer.byteLength(raw), topKeys: Object.keys(data).slice(0, 20), format: data.format ?? null, mentionedBy: mentions(basename(f)) });
}

const testModules = [];
for (const f of tracked.filter((f) => /\.test\.m?js$/.test(f)).sort())
  testModules.push({ file: f, sha256: sha256(await readFile(f)), ...canonical(f) });
const pythonTests = tracked.filter((f) => /(^|\/)test_[^/]+\.py$/.test(f)).sort();

// Licence and credit records the port must carry with bundled art and code.
const licenses = [];
for (const f of tracked.filter((f) => f.startsWith("docs/licenses/")).sort()) {
  const t = await readFile(f, "utf8");
  // The title is the first non-empty line without its line ending, heading marks or padding.
  licenses.push({ file: f, sha256: sha256(t), ...canonical(f), title: t.split(/\r?\n/).find((l) => l.trim())?.replace(/^#+\s*/, "").trim().slice(0, 120) ?? "" });
}
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const installed = Object.fromEntries(
  Object.entries(lock.packages).filter(([k]) => k.startsWith("node_modules/")).map(([k, v]) => [k.slice(13), { version: v.version, integrity: v.integrity ?? null, optional: v.optional ?? false }]),
);

const record = {
  generatedAt: new Date().toISOString(),
  commit: git("rev-parse", "HEAD"),
  referenceCommit: "2761eb14",
  checkout,
  runtimeTreeVsReference: git("diff", "--stat", "2761eb14", "HEAD", "--", ".", ":!AGENTS.md", ":!docs", ":!verification") || "identical outside AGENTS.md, docs/ and verification/",
  trackedFiles: tracked.length,
  hashes: {
    "package.json": sha256(await readFile("package.json")),
    "package-lock.json": sha256(await readFile("package-lock.json")),
    corpus: sha256([...forms, ...glbs, ...otherFixtures].map((x) => x.file + " " + x.sha256).join("\n")),
    tests: sha256(testModules.map((x) => x.file + " " + x.sha256).join("\n")),
    // The same aggregates over stored (Git blob) bytes, equal in LF and CRLF clones.
    canonical: {
      "package.json": canonical("package.json"),
      "package-lock.json": canonical("package-lock.json"),
      corpus: sha256([...forms, ...glbs, ...otherFixtures].map((x) => x.file + " " + x.canonicalSha256).join("\n")),
      tests: sha256(testModules.map((x) => x.file + " " + x.canonicalSha256).join("\n")),
      pythonTests: sha256(pythonTests.map((f) => f + " " + canonical(f).canonicalSha256).join("\n")),
      licenses: sha256(licenses.map((x) => x.file + " " + x.canonicalSha256).join("\n")),
    },
  },
  counts: {
    forms: forms.length,
    wrappedForms: forms.filter((f) => f.openableInEditor).length,
    bareForms: forms.filter((f) => !f.openableInEditor).map((f) => f.file),
    formsWithArtwork: forms.filter((f) => f.artwork.length).length,
    artworkBlobs: forms.reduce((n, f) => n + f.artwork.length, 0),
    glbs: glbs.length,
    glbsWithoutSourceForm: glbs.filter((g) => !g.sourceForm).map((g) => g.file),
    formsWithoutTrackedGlb: forms.filter((f) => !f.trackedGlb).map((f) => f.file),
    jsTestModules: testModules.length,
    pythonTestModules: pythonTests.length,
    otherFixtures: otherFixtures.length,
  },
  dependencies: { direct: { ...lock.packages[""].dependencies, ...lock.packages[""].devDependencies }, installed },
  forms,
  glbs,
  otherFixtures,
  licenses,
  testModules,
  pythonTests,
};
await writeFile(`${out}/inventory.json`, JSON.stringify(record, null, 2) + "\n");
console.log(JSON.stringify(record.counts, null, 2));
