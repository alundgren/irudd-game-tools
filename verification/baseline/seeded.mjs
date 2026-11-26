import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const out = process.argv[2] ?? ".reference-cache/g0";
await mkdir(`${out}/seeded`, { recursive: true });
const bundle = resolve(`${out}/seeded/generators.tmp.mjs`);
await build({
  stdin: { contents: 'export { generateWorkshopForm } from "./character-view/components.js"; export { dressHuman } from "./character-view/human-wardrobe.js"; export { validateForm } from "./character-view/recipe.js";', resolveDir: process.cwd(), loader: "js" },
  bundle: true, format: "esm", platform: "node", outfile: bundle, logLevel: "error",
  loader: { ".webp": "dataurl", ".glb": "dataurl", ".html": "text" },
  define: { WORKSHOP_MHR_LICENSE: '""' },
});
const { generateWorkshopForm, dressHuman, validateForm } = await import(pathToFileURL(bundle).href);
const SEEDS = [1, 42, 491, 8713, 8950, 8973, 8990, 9001, 49027675, 716973847, 3782767734];
const KINDS = ["adult", "plan", "figure", "human", "creature", "hybrid", "any"];
const canonical = (v) => JSON.stringify(v, (_, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const sha = (s) => createHash("sha256").update(s).digest("hex");
const rows = [];
for (const kind of KINDS)
  for (const seed of SEEDS) {
    let form, error = null;
    try {
      form = generateWorkshopForm(kind, seed);
      validateForm(structuredClone(form));
    } catch (e) { error = String(e.message ?? e); }
    const row = { kind, seed, route: kind === "adult" ? `#adult=${seed}` : `generateWorkshopForm("${kind}", ${seed})`, valid: !error, error };
    if (form) {
      const text = canonical(form);
      Object.assign(row, { sha256: sha(text), parts: form.parts?.length ?? 0, origin: form.origin ?? null, human: Boolean(form.human) });
      await writeFile(`${out}/seeded/${kind}-${seed}.form.json`, JSON.stringify({ format: "irudd.form.v1", form }));
    }
    if (kind === "adult" && form) {
      const dressed = dressHuman(form, seed);
      const text = canonical(dressed);
      rows.push(row, { kind: "adult+look", seed, route: `#adult=${seed}&look=${seed}`, valid: true, error: null, sha256: sha(text), parts: dressed.parts?.length ?? 0, origin: dressed.origin ?? null, human: Boolean(dressed.human) });
      await writeFile(`${out}/seeded/adult-look-${seed}.form.json`, JSON.stringify({ format: "irudd.form.v1", form: dressed }));
      continue;
    }
    rows.push(row);
  }
const digest = sha(rows.map((r) => `${r.kind} ${r.seed} ${r.sha256 ?? r.error}`).join("\n"));
await writeFile(`${out}/seeded-${process.pid}.json`, JSON.stringify({ node: process.version, digest, rows }, null, 2) + "\n");
console.log(JSON.stringify({ digest, forms: rows.length, invalid: rows.filter((r) => !r.valid).length, file: `${out}/seeded-${process.pid}.json` }));
