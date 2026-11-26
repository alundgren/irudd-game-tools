// G0 baseline: distil the cached run into verification/baseline/baseline.json.
//
// usage: G0_DIR=PATH/.reference-cache/g0 node verification/baseline/freeze.mjs [OUT_FILE]
//
// The tracked baseline holds text measurements only (counts, hashes, digests, timings and
// variance envelopes), never exported bytes or images. Its "observed" block describes this
// run; the port compares against "frozen", and "gaps" lists what this run could not cover.
// OUT_FILE defaults to baseline.json beside this script; check.mjs writes elsewhere and
// compares, so the checked-in file must regenerate byte for byte from the cache.
// Private reference material contributes text only: ids, labels, credits and hashes.
import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const G0 = process.env.G0_DIR ?? ".reference-cache/g0";
const read = async (f) => (existsSync(`${G0}/${f}`) ? JSON.parse(await readFile(`${G0}/${f}`, "utf8")) : null);
const inventory = await read("inventory.json");
const checkedIn = new URL("./baseline.json", import.meta.url);
const baselineFile = process.argv[2] ? pathToFileURL(resolve(process.argv[2])) : checkedIn;
const previousNotes = existsSync(checkedIn) ? JSON.parse(await readFile(checkedIn, "utf8")).provenance?.notes ?? [] : [];
const eol = await read("eol.json");
const pixShipped = await read("capture-shipped/pixels.json");
const pixFresh = await read("capture-fresh/pixels.json");
const reShipped = await read("capture-shipped/reencode.json");
const reFresh = await read("capture-fresh/reencode.json");
const refPublic = await read("references-public/references.json");
const refPrivate = await read("references-private/references.json");
const refConfig = await read("references-private/references-config.json");
const flows = await read("flows/flows.json");
const manifest = await read("manifest.json");
const workflows = await read("workflows.json");
const suite = Object.fromEntries(
  await Promise.all(["full-cold", "full-warm", "full-references-none"].map(async (l) => [l, await read(`suite/${l}.json`)])),
);
const modules = await read("suite/modules.json");
const exportA = await read("export-a/export.json");
const exportB = await read("export-b/export.json");
const adult = await read("export-adult/export.json");
const exportVariance = await read("export-variance.json");
const shipped = await read("shipped-vs-fresh.json");
const capShipped = await read("capture-shipped/capture.json");
const capFresh = await read("capture-fresh/capture.json");
const varShipped = await read("capture-shipped/variance.json");
const varFresh = await read("capture-fresh/variance.json");
const seededFile = (await readdir(G0)).find((f) => /^seeded-\d+\.json$/.test(f));
const seeded = seededFile ? await read(seededFile) : null;

// Content digests of fresh exports, read once from glb.mjs.
const { glbSummary } = await import("./glb.mjs");
const digestOf = async (dir, name) => glbSummary(await readFile(`${G0}/${dir}/${name}`));
const exports = {};
for (const [name, f] of Object.entries(exportA?.files ?? {})) {
  const s = await digestOf("export-a", name);
  const v = exportVariance?.rows.find((r) => r.file === name);
  exports[name] = {
    preset: f.preset, allOutfits: f.allOutfits, sha256: f.sha256, bytes: f.bytes, contentDigest: s.contentDigest,
    counts: s.counts, clips: s.animations.map((a) => a.name), integrity: s.integrity,
    exportSeconds: f.exportSeconds, status: f.status,
    repeat: v ? { sameBytes: v.sameBytes, sameContentDigest: v.sameContentDigest, sameImagePixels: v.sameImagePixels } : null,
  };
}
const adultExports = {};
for (const [name, f] of Object.entries(adult?.files ?? {})) {
  const s = await digestOf("export-adult", name);
  adultExports[name] = { preset: f.preset, sha256: f.sha256, contentDigest: s.contentDigest, counts: s.counts, integrity: s.integrity, status: f.status };
}
// Each r0 shot: the retained PNG's file hash and, from compare.py pixels, its decoded
// [width, height, mode, pixel digest]. Ports compare the decoded record; the file hash names
// the exact retained frame.
const shots = (cap, pix) =>
  Object.fromEntries(
    Object.entries(cap?.runs[0]?.glbs ?? {}).map(([k, v]) => [k, { glbSha256: v.sha256, status: v.status, stats: v.stats, portrait: v.portraitAvailable, clips: v.clips, expressions: v.expressions,
      shots: Object.fromEntries(Object.entries(v.shots).map(([s, x]) => [s, x.sha256])),
      decoded: pix && Object.fromEntries(Object.keys(v.shots).map((s) => { const d = pix.frames.r0[`${k}/${s}.png`]; return [s, d && d.sha256 === v.shots[s].sha256 ? [d.width, d.height, d.mode, d.pixelSha256] : "missing or file hash differs"]; })) }]),
  );
const sessionOf = (cap) => cap?.runs.map((r) => r.session);
const repeatsOf = (pix) => pix && { ...pix.summary, disagreements: pix.disagreements };
const motionLikeRest = (pix) => {
  if (!pix) return null;
  const f = pix.frames.r0, motion = Object.keys(f).filter((k) => k.includes("/motion-"));
  const same = motion.filter((k) => f[k].pixelSha256 === f[k.split("/")[0] + "/threequarter.png"]?.pixelSha256);
  return { motionShots: motion.length, pixelIdenticalToRestThreeQuarter: same.length, clips: [...new Set(motion.map((k) => k.split("/motion-")[1].replace(/\.png$/, "")))] };
};
// Records from browser.py with absolute machine paths left out.
const withoutPaths = (r) => r && Object.fromEntries(Object.entries(r).filter(([k]) => !["build", "command"].includes(k)));

const gaps = [];
if (!modules) gaps.push("Per-module timings missing: run time-modules.mjs.");
if (!exportA) gaps.push("Fresh exports missing: run run-g0.mjs without --skip-browser.");
const cover = workflows?.flowCoverage ?? {};
const untested = Object.values(cover).flatMap((f) => f.modules).filter((m) => !m.testModulesImporting.length && !m.testModulesNamingExports.length).map((m) => m.source);
gaps.push(
  `Agent workflows (/variation, /turnaround, /trace-map, /portrait-depth) launch a Codex job per request, so G0 does not run them. recipe.test.js drives /variation through workshopServer with a stub worker; no test module covers ${untested.filter((s) => s.startsWith("scripts/")).join(", ")}, and the other three routes are not exercised. browser.py flows drives the offline half of each AI-tab flow instead.`,
  `Reference painting needs the workshop agent: Paint is hidden in the offline editor${flows ? ` (${flows.proposal.paintGenerate.hidden ? "verified" : "NOT hidden"})` : ""} and ${untested.filter((s) => /art-variation|paint-sources|reuse-paint/.test(s)).join(", ")} have no test module; only reference-mask.js and reference-depth.js have unit tests. Painting is not frozen.`,
  "Hybrid starting forms need loaded turnarounds, so Node cannot generate them (seeded.mjs records 'Choose a loaded turnaround.' for every seed). The editor draws the seed itself, so browser.py flows freezes three drawn hybrids by their recorded seeds, not fixed seeds.",
  refConfig
    ? `The suite and the frozen build are the public configuration. The private configuration was frozen from local copies of the ignored sets: ${refConfig.sets.map((s) => `${s.name} ${s.state}`).join("; ")}. Pages that need the missing pictures or Rocketbox are not covered.`
    : "Private reference material is absent from this cache, so only the public configuration is frozen; the one skipped test needs examples/mhr-fit.json.",
  "Captures are single-machine (RTX 5070 Ti, ANGLE D3D11, Chrome headless). Cross-machine tolerance needs a second machine.",
);

// Measured observations the port should know about, computed from this run.
const findings = [];
const ev = exportVariance?.summary;
if (ev) findings.push(`Fresh exports repeat in content: ${ev.sameContentDigest}/${ev.files} share the content digest and ${ev.sameImagePixels}/${ev.files} the decoded image pixels across a forward and a reverse run, but only ${ev.sameBytes}/${ev.files} are byte-identical. The embedded images are identical; GLTFExporter writes them into the binary buffer in encode-completion order, so bufferView order and file hash vary. Identify artifacts by file hash and compare parity by content digest and pixels.`);
if (exportA) findings.push(`The editor's Open form rejects ${Object.keys(exportA.rejected).join(" and ")} ("${Object.values(exportA.rejected)[0]}"): they lack the irudd.form.v1 envelope. Their exports come from wrapped copies.`);
if (shipped) {
  const rows = shipped.rows.filter((r) => r.fresh);
  findings.push(`Tracked GLBs come from earlier builds: ${shipped.summary.sameStructure}/${rows.length} match the fresh Game export's structure. ${rows.filter((r) => r.countDiffs?.images).length} differ in image count and ${rows.filter((r) => JSON.stringify(r.clipsShipped) !== JSON.stringify(r.clipsFresh)).length} in clip list; ${shipped.rows.filter((r) => !r.fresh).map((r) => r.shipped).join(", ")} has no source form. Use them as playback fixtures and the fresh exports as export expectations.`);
}
if (inventory) {
  const withCopyright = inventory.glbs.filter((g) => g.asset.copyright).length;
  const freshCopyright = (await Promise.all(Object.keys(exports).map((n) => digestOf("export-a", n)))).filter((s) => s.asset.copyright).length;
  findings.push(`Provenance: ${withCopyright}/${inventory.glbs.length} tracked GLBs and ${freshCopyright}/${Object.keys(exports).length} fresh exports carry asset.copyright; none carry asset.extras. The build embeds the asset credit in the HTML only.`);
  findings.push(`Artwork: ${inventory.counts.artworkBlobs} blobs in ${inventory.counts.formsWithArtwork} forms, all content-addressed as <role>-<sha256 of bytes> (${inventory.forms.flatMap((f) => f.artwork).filter((a) => a.idMatchesContent).length} match).`);
}
if (seeded) findings.push(`Seeded generators are deterministic across processes (digest ${seeded.digest.slice(0, 16)}); entropy enters at ${workflows?.randomness?.filter((r) => r.source !== "identity/time").length ?? "?"} UI seed-draw sites and ${workflows?.randomness?.filter((r) => r.source === "identity/time").length ?? "?"} revision-id/time sites.`);
if (manifest?.builds) findings.push(`npm run build is byte-reproducible (${manifest.builds.reproducible}).`);
if (varShipped && varFresh) findings.push(`Same-machine capture repeatability: ${varShipped.envelope.identical}/${varShipped.envelope.comparisons} tracked-GLB shots and ${varFresh.envelope.identical}/${varFresh.envelope.comparisons} fresh-export shots byte-identical; worst difference ${Math.max(varShipped.envelope.maxDiff, varFresh.envelope.maxDiff)} level on ${(Math.max(varShipped.envelope["maxShare>0"], varFresh.envelope["maxShare>0"]) * 100).toFixed(5)} % of pixels.`);
if (pixShipped && pixFresh) {
  const d = [...pixShipped.disagreements, ...pixFresh.disagreements];
  const changed = [...(varShipped?.envelope.changed ?? []), ...(varFresh?.envelope.changed ?? [])];
  findings.push(`Changed captures: ${d.map((x) => `${x.shot} in repeat ${x.outliers.join(", ")} (${x.consensus.join(" and ")} agree)`).join("; ") || "none"}${changed.length ? ", " + changed.map((c) => `${c["pixels>0"]} pixel(s) off by up to ${c.maxDiff} level against r0`).join("; ") : ""}. Every retained frame is a ${[...new Set([...pixShipped.summary.modes, ...pixFresh.summary.modes])].join("/")} PNG. Against r0, ${pixShipped.summary.againstFirstRepeat.sameFile}/${pixShipped.summary.againstFirstRepeat.comparisons} tracked and ${pixFresh.summary.againstFirstRepeat.sameFile}/${pixFresh.summary.againstFirstRepeat.comparisons} fresh repeats have the same file hash and ${pixShipped.summary.againstFirstRepeat.samePixels} and ${pixFresh.summary.againstFirstRepeat.samePixels} the same pixel digest, so Chrome's PNG encoding was itself repeatable here.`);
}
if (reShipped && reFresh) {
  const n = reShipped.summary.frames + reFresh.summary.frames;
  const same = (k, m) => reShipped.summary[k][m] + reFresh.summary[k][m];
  findings.push(`PNG re-encoding (${reShipped.summary.encoder}, compression 1 and 9) of all ${n} r0 frames changes the file hash of ${n - same("level1", "sameFile")} (level 1) and ${n - same("level9", "sameFile")} (level 9) and keeps width, height, mode and pixel digest for ${same("level1", "samePixels")} and ${same("level9", "samePixels")}. Compare captures by the decoded record; the file hash only identifies the retained Chrome frame.`);
}
const motion = [motionLikeRest(pixShipped), motionLikeRest(pixFresh)];
if (motion[0] && motion[1]) findings.push(`Motion coverage is thin: each GLB's motion sample is its first clip at 50 % of the timeline, which is ${motion[0].clips.concat(motion[1].clips).filter((v, i, a) => a.indexOf(v) === i).join(", ")} for every GLB, and ${motion[0].pixelIdenticalToRestThreeQuarter}/${motion[0].motionShots} tracked and ${motion[1].pixelIdenticalToRestThreeQuarter}/${motion[1].motionShots} fresh motion shots are pixel-identical to the rest three-quarter shot.`);
if (eol) findings.push(`Line endings: working-tree hashes follow core.autocrlf. ${eol.workingTreeHashDependsOnEol.files}/${eol.workingTreeHashDependsOnEol.of} inventoried files hash differently in an LF and a CRLF clone of 2761eb14, while every gitBlob and canonicalSha256 agrees. The frozen sha256 values and build hashes come from a CRLF (Windows default) checkout; an LF clone builds character-view.html ${eol.clones.lf.build?.["character-view.html"]?.slice(0, 12)}… and play-model.html ${eol.clones.lf.build?.["play-model.html"]?.slice(0, 12)}…, because the bundle embeds the checkout's text bytes. Compare corpora by the canonical pair.`);
const mhrLicense = inventory?.licenses.find((l) => l.file === "docs/licenses/mhr-apache-2.0.txt");
const privateStudies = Object.values(refPrivate?.studies ?? {});
if (refPrivate && refConfig) {
  const mhr = privateStudies.find((s) => s.asset.extras?.license);
  const lic = mhr?.asset.extras.license;
  findings.push(`Private references switch on ${refConfig.values.installed.rigs.length} practice rigs, ${privateStudies.length} "3D reference fits" studies (${refPublic?.studyList.count ?? "?"} → ${refPrivate.studyList.count} studies), the Forms link (${refPublic?.formsTab.compareMhrLinks ?? "?"} → ${refPrivate.formsTab.compareMhrLinks}) and dist/rig-study.html, which #compare-mhr opens from file://. WORKSHOP_REFERENCES=none in the same checkout rebuilds the public hashes (${JSON.stringify(refConfig.builds.referencesNone.dist) === JSON.stringify(manifest?.builds?.runs?.[0] ?? null)}).`);
  if (lic) findings.push(`Exports of an MHR fit carry asset.extras {referenceRigs, license}; the license is the build's docs/licenses/mhr-apache-2.0.txt text (${lic.sha256 === mhrLicense?.sha256 ? "equal to its working-tree sha256" : "NOT equal to its working-tree sha256"}; ${lic.lfSha256 === mhrLicense?.canonicalSha256 ? "LF-normalised it equals the canonical hash" : "LF-normalised it does NOT equal the canonical hash"}). The Lee Perry-Smith fit carries {referenceRigs, headScan} with the CC BY 3.0 credit, and both credits appear in asset.copyright.`);
}
if (flows) {
  const [a, b] = flows.proposal.rounds;
  findings.push(`Offline AI tab (no provider, ${flows.proposal.connected ?? "no workshop-agent meta"}): Generate exports form-request.json ("${a.requestStatus}"); a stale proposal is refused ("${a.staleProposal}"); an echo proposal opens for review ("${a.importStatus}"); Inspect export reports "${a.inspectStatus}"; two refinement rounds export requests carrying the inspected views, the second adds the earlier-versus-current sheets (${a.refinements?.[1]?.previousReview}); Accept → "${a.decisionStatus}", Discard → "${b.decisionStatus}". An attached image travels in the next request (${b.references.length} reference).`);
  findings.push(`Hybrid starting forms generate in the editor (${flows.hybrid.generated.map((h) => `seed ${h.origin?.seed}: ${h.parts} parts`).join(", ")}); each saved form reopens and re-exports with the same content digest (${flows.hybrid.generated.filter((h) => h.reopenedSameContent).length}/${flows.hybrid.generated.length}).`);
}

const baseline = {
  item: "workshop-desktop-port / inventory (G0) / check baseline",
  reference: { commit: manifest?.referenceCommit, inventoryCheckout: inventory?.commit, runtimeTreeVsReference: inventory?.runtimeTreeVsReference },
  // Where each kind of evidence ran. A shared checkout can move while a long run is in flight,
  // so each record names the commit it saw; runtime identity is checked against the reference.
  provenance: {
    suite: Object.fromEntries(Object.entries(suite).map(([k, v]) => [k, v && { commit: v.commit, dirty: v.dirty, finishedAt: v.finishedAt }])),
    inventory: inventory && { commit: inventory.commit, generatedAt: inventory.generatedAt },
    build: manifest?.builds && { files: manifest.builds.runs[0], note: "exports and captures load these exact files from the cached build directory" },
    pipelineEndCommit: manifest?.commit,
    // G0_NOTES (a JSON array of strings) replaces the hand-written notes; otherwise they are kept.
    notes: process.env.G0_NOTES ? JSON.parse(process.env.G0_NOTES) : previousNotes,
  },
  toolchain: manifest?.toolchain,
  dependencies: inventory?.dependencies,
  frozen: {
    corpus: {
      // sha256 = working-tree bytes of the checkout named in "checkout"; gitBlob and
      // canonicalSha256 = the stored (LF) blob, equal in every clone. See eol.mjs.
      checkout: inventory?.checkout,
      hashes: inventory?.hashes,
      counts: inventory?.counts,
      forms: inventory?.forms.map((f) => ({ file: f.file, sha256: f.sha256, gitBlob: f.gitBlob, canonicalSha256: f.canonicalSha256, envelope: f.envelope, openableInEditor: f.openableInEditor, validateForm: f.validateForm, kind: f.kind, generator: f.generator, seed: f.seed, parts: f.parts, poses: f.poses, outfitSets: f.outfitSets, occluders: f.occluders, artwork: f.artwork.map((a) => ({ role: a.role, mime: a.mime, bytes: a.bytes, sha256: a.sha256, idMatchesContent: a.idMatchesContent })), trackedGlb: f.trackedGlb })),
      glbs: inventory?.glbs.map((g) => ({ file: g.file, sha256: g.sha256, gitBlob: g.gitBlob, contentDigest: g.contentDigest, sourceForm: g.sourceForm, counts: g.counts, clips: g.animations.map((a) => a.name), morphTargets: [...new Set(g.meshes.flatMap((m) => m.targetNames))], copyright: g.asset.copyright, provenanceExtras: g.asset.extras, integrity: g.integrity })),
      otherFixtures: inventory?.otherFixtures.map((f) => ({ file: f.file, sha256: f.sha256, gitBlob: f.gitBlob, canonicalSha256: f.canonicalSha256, format: f.format, mentionedBy: f.mentionedBy })),
      licenses: inventory?.licenses,
      testModules: { js: inventory?.testModules.length, python: inventory?.pythonTests, aggregateSha256: inventory?.hashes.tests, canonicalAggregateSha256: inventory?.hashes.canonical?.tests,
        files: inventory?.testModules.map((t) => [t.file, t.sha256, t.gitBlob, t.canonicalSha256]) },
    },
    lineEndings: eol && { referenceCommit: eol.referenceCommit, passed: eol.passed, checks: eol.checks, workingTreeHashDependsOnEol: eol.workingTreeHashDependsOnEol,
      buildDependsOnEol: eol.buildDependsOnEol, clones: eol.clones },
    suite: Object.fromEntries(Object.entries(suite).map(([k, v]) => [k, v && { command: v.command, workshopReferences: v.workshopReferences, exitCode: v.exitCode, wallSeconds: v.wallSeconds, ...v.summary, skippedTests: v.skipped, failedTests: v.notOk }])),
    seeded: seeded && { digest: seeded.digest, deterministicAcrossProcesses: manifest?.seeded?.deterministic, rows: seeded.rows.map((r) => ({ kind: r.kind, seed: r.seed, route: r.route, sha256: r.sha256 ?? null, valid: r.valid, error: r.error })) },
    build: manifest?.builds,
    exports: exportA && { session: exportA.session, readyRoute: exportA.readyRoute, presets: exportA.presets, rejected: exportA.rejected, pageErrors: exportA.pageErrors, files: exports, adultRoute: adultExports },
    exportRepeatability: exportVariance?.summary,
    shippedVsFresh: shipped,
    captures: {
      decoded: "r0.*.decoded[shot] = [width, height, PNG mode, SHA-256 of the pixels as 8-bit RGBA rows]; r0.*.shots[shot] = SHA-256 of the retained PNG file",
      shipped: capShipped && { sessions: sessionOf(capShipped), envelope: varShipped?.envelope, worst: varShipped?.worst?.slice(0, 5), repeats: repeatsOf(pixShipped), reencode: reShipped?.summary, motion: motionLikeRest(pixShipped), r0: shots(capShipped, pixShipped) },
      fresh: capFresh && { sessions: sessionOf(capFresh), envelope: varFresh?.envelope, worst: varFresh?.worst?.slice(0, 5), repeats: repeatsOf(pixFresh), reencode: reFresh?.summary, motion: motionLikeRest(pixFresh), r0: shots(capFresh, pixFresh) },
    },
    workflows,
    // Offline (no provider) AI tab and hybrid starting forms driven in the editor.
    flows: flows && { session: flows.session, image: { file: flows.image.file.replaceAll("\\", "/").split("/").slice(-2).join("/"), sha256: flows.image.sha256 }, buildFiles: flows.buildFiles, hybrid: flows.hybrid, proposal: flows.proposal },
    // What the optional private references switch on, from a local install. Text only.
    referenceMaterial: refConfig && {
      config: { commit: refConfig.commit, trackedClean: refConfig.trackedClean, shell: refConfig.shell, sets: refConfig.sets, values: refConfig.values, installed: refConfig.installed, builds: refConfig.builds, focusedTests: refConfig.focused },
      public: withoutPaths(refPublic),
      private: withoutPaths(refPrivate),
    },
  },
  observed: {
    moduleTimings: modules && { sequentialWallSeconds: modules.sequentialWallSeconds, tests: modules.tests, pass: modules.pass, skipped: modules.skipped, fail: modules.fail, slowest: modules.rows.slice(0, 20).map((r) => ({ file: r.file, wallSeconds: r.wallSeconds, tests: r.tests })), fastestCount: modules.rows.filter((r) => r.wallSeconds < 1.5).length, all: modules.rows.map((r) => [r.file, r.wallSeconds, r.tests]) },
    steps: manifest?.steps,
  },
  findings,
  gaps,
};
// Indent the outer levels and keep each leaf record on one line, so a diff names the entry.
const pretty = (v, depth = 0, pad = "") =>
  depth >= 4 || v === null || typeof v !== "object" || !Object.keys(v).length
    ? JSON.stringify(v)
    : Array.isArray(v)
      ? v.every((x) => x === null || typeof x !== "object")
        ? JSON.stringify(v)
        : "[\n" + v.map((x) => pad + " " + pretty(x, depth + 1, pad + " ")).join(",\n") + "\n" + pad + "]"
      : "{\n" + Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => pad + " " + JSON.stringify(k) + ": " + pretty(x, depth + 1, pad + " ")).join(",\n") + "\n" + pad + "}";
await writeFile(baselineFile, pretty(baseline) + "\n");
console.log("wrote", baselineFile.pathname, JSON.stringify({ forms: baseline.frozen.corpus.forms?.length, glbs: baseline.frozen.corpus.glbs?.length, exports: Object.keys(exports).length, gaps: gaps.length }));
