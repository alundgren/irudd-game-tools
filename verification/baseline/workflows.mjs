// G0 baseline: inventory the reference workshop's user-visible entry points from source.
//
// usage: node verification/baseline/workflows.mjs [OUT_DIR]
//
// Static inventory, no browser: every editor tab, panel heading, button and file input in
// character-view/index.html; the URL fragment routes of the editor and the standalone
// player; the workshop server's GET files and POST agent endpoints; the editor's
// randomness entry points (where a gesture draws a fresh seed); and the test modules that
// cover each review and agent flow (flowCoverage). The port maps each row to a
// new entry point or a recorded scope decision. Writes OUT_DIR/workflows.json.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const out = process.argv[2] ?? ".reference-cache/g0";
await mkdir(out, { recursive: true });
const html = await readFile("character-view/index.html", "utf8");
const text = (s) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const tabs = [...html.matchAll(/<button data-tab="([^"]+)"[^>]*>([^<]*)</g)].map(([, id, label]) => ({ id, label: label.trim() }));
// Split on panel sections so each control is attributed to its tab and heading.
const panels = [];
const sectionRe = /<section\b[^>]*data-panel="([^"]+)"[^>]*>([\s\S]*?)<\/section\s*>/g;
for (const [, tab, body] of html.matchAll(sectionRe)) {
  const heading = text(/<h2[^>]*>([\s\S]*?)<\/h2>/.exec(body)?.[1] ?? "");
  const buttons = [...body.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button\s*>/g)].map(([, attrs, label]) => ({ id: /id="([^"]+)"/.exec(attrs)?.[1] ?? null, label: text(label) }));
  const inputs = [...body.matchAll(/<input\b([^>]*)>/g)].map(([, a]) => ({ id: /id="([^"]+)"/.exec(a)?.[1] ?? null, type: /type="([^"]+)"/.exec(a)?.[1] ?? "text", accept: /accept="([^"]+)"/.exec(a)?.[1] ?? null }));
  const selects = [...body.matchAll(/<select\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/select\s*>/g)].map(([, id, opts]) => ({ id, options: [...opts.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]) }));
  panels.push({ tab, heading, buttons, fileInputs: inputs.filter((i) => i.type === "file"), selects, controls: buttons.length + inputs.length + selects.length });
}
const allButtons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button\s*>/g)].length;
const app = await readFile("character-view/app.js", "utf8");
const player = await readFile("examples/play-model.js", "utf8");
const server = await readFile("scripts/workshop.mjs", "utf8");
const params = (src) => [...new Set([...src.matchAll(/params\.(?:get|has)\("([^"]+)"\)/g)].map((m) => m[1]))];
const randomness = execFileSync("git", ["grep", "-nE", "Math\\.random|crypto\\.(getRandomValues|randomUUID)|Date\\.now\\(\\)", "--", "character-view/*.js", "examples/*.js", "scripts/*.mjs", ":!*.test.js"], { encoding: "utf8" })
  .trim().split("\n").map((l) => { const [file, line, ...rest] = l.split(":"); const code = rest.join(":").trim(); return { file, line: Number(line), source: /randomUUID|Date\.now/.test(code) ? "identity/time" : "seed draw at a gesture", code: code.slice(0, 160) }; });
// Which test modules exercise each review and agent flow: modules that import the flow's
// source file and modules that name one of its exports. browser.py flows drives the same
// flows offline in the editor; this list says what the unit suite covers on its own.
const testModules = execFileSync("git", ["ls-files", "*.test.js", "*.test.mjs"], { encoding: "utf8" }).trim().split("\n");
const testText = new Map(await Promise.all(testModules.map(async (f) => [f, await readFile(f, "utf8")])));
const flowModules = {
  "Proposal review (Import proposal, Show current, Accept, Discard, Keep candidate)": ["character-view/recipe.js#readProposal", "character-view/variations.js#agentDesign"],
  "Export review (Inspect export, Show earlier export, refinement attachments)": ["character-view/export-review.js", "character-view/coverage-review.js"],
  "Refinement (Export refinement request, Load reply, Back)": ["character-view/recipe.js#readProposal", "character-view/variations.js#makeBrief"],
  "Visual references (Add reference)": ["character-view/visual-references.js"],
  "Reference painting (Paint, reuse paint)": ["character-view/art-variation.js", "character-view/paint-sources.js", "character-view/reuse-paint-editor.js", "character-view/reference-mask.js", "character-view/reference-depth.js"],
  "Agent server (/variation, /turnaround, /trace-map, /portrait-depth)": ["scripts/workshop.mjs", "scripts/codex-worker.mjs", "scripts/art-direction.mjs"],
};
const flowCoverage = Object.fromEntries(await Promise.all(Object.entries(flowModules).map(async ([flow, refs]) => {
  const rows = await Promise.all(refs.map(async (ref) => {
    const [file, only] = ref.split("#");
    const src = await readFile(file, "utf8");
    const exported = only ? [only] : [...src.matchAll(/^export (?:async )?(?:function\*? |const |let |class )(\w+)/gm)].map((m) => m[1]);
    const stem = file.split("/").pop().replace(/\.m?js$/, "");
    const importRe = new RegExp(`from\\s+["'][./]*(?:[\\w-]+/)*${stem}(?:\\.m?js)?["']`);
    const importers = testModules.filter((t) => importRe.test(testText.get(t)));
    const naming = exported.length ? testModules.filter((t) => exported.some((name) => new RegExp(`\\b${name}\\b`).test(testText.get(t)))) : [];
    return { source: ref, exports: exported, testModulesImporting: importers, testModulesNamingExports: naming };
  }));
  // A "file#name" source counts only the modules that name that export.
  const covering = rows.flatMap((r) => r.testModulesNamingExports.concat(r.source.includes("#") ? [] : r.testModulesImporting));
  return [flow, { modules: rows, testModules: [...new Set(covering)].sort() }];
})));
const record = {
  editor: {
    tabs,
    panels,
    buttonCount: allButtons,
    fragmentRoutes: { params: params(app), notes: ["#study=ID opens an examples/studies.js study", "#adult=SEED[&look=SEED] draws a seeded adult and optionally dresses it", "#form=SLUG fetches /examples/SLUG.form.json and needs the workshop server", "#compare-mhr opens the private rig comparison when installed", "#study=ID&compare=3d opens the 3D practice reference"] },
    openForm: "Forms > Open form accepts only {format: 'irudd.form.v1', form}; anything else reports 'Choose a saved form.'",
    exportPresets: (/<select id="export-detail">([\s\S]*?)<\/select>/.exec(html)?.[1].match(/value="([^"]+)"/g) ?? []).map((v) => v.slice(7, -1)),
  },
  player: { fragmentRoutes: params(player), cameraPresets: [...player.matchAll(/^\s+"?([a-z-]+)"?: \[[-\d., ]+\],$/gm)].map((m) => m[1]), notes: ["#model=SLUG needs http(s) and fetches /examples/SLUG.glb", "Character file input opens any GLB offline"] },
  workshopServer: {
    get: ["/ and /dist/character-view.html (built editor, marked workshop-agent=local)", "/play-model.html", "docs, licenses, media, README, LICENSE, examples/*.form.json and *.glb by pattern", "/examples/human-targets/mhr-[fm][123].glb (private, when present)"],
    post: [...new Set([...server.matchAll(/"\/(variation|turnaround|trace-map|portrait-depth)"/g)].map((m) => "/" + m[1]))],
    guards: ["Host must be the local address", "Origin must equal the server URL and Content-Type application/json", "one job at a time (409)", "trace-map 240 s, others 420 s timeout"],
    agentLaunch: "codex-worker.mjs starts a Codex job per request (application-launched model session)",
  },
  randomness,
  flowCoverage,
};
await writeFile(`${out}/workflows.json`, JSON.stringify(record, null, 2) + "\n");
console.log(JSON.stringify({ tabs: tabs.length, panels: panels.length, buttons: allButtons, editorRoutes: record.editor.fragmentRoutes.params, playerRoutes: record.player.fragmentRoutes, cameraPresets: record.player.cameraPresets, post: record.workshopServer.post, randomnessSites: randomness.length }, null, 1));
