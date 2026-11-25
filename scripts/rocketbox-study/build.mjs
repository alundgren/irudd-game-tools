// Builds dist/rocketbox-study.html, the local comparison page, and optionally writes the two
// editable forms. The targets, their licence and the recipes live in .reference-cache/rocketbox,
// which is never committed. Fetch and convert them first (see docs/rocketbox-study.md), then run
// from the repository root:
//   node scripts/rocketbox-study/build.mjs [--forms] [--out path/to/page.html]
import { build } from "esbuild";
import { existsSync } from "node:fs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { loadStudies, local, need } from "./local.mjs";

need("", "studies.js", "LICENSE-rocketbox.txt", "targets/female-adult-04.glb", "targets/gardener-male-01.glb");
// compare.mjs measures where each adult stands front to back. Without it the adults stay where they are made.
if (!existsSync(local + "placement.json")) await writeFile(local + "placement.json", "{}\n");
const args = process.argv.slice(2);
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : "dist/rocketbox-study.html";
const [three, project, rocketbox, html] = await Promise.all([
  readFile("node_modules/three/LICENSE", "utf8"),
  readFile("LICENSE", "utf8"),
  readFile(local + "LICENSE-rocketbox.txt", "utf8"),
  readFile("scripts/rocketbox-study/page.html", "utf8"),
]);
const { outputFiles } = await build({
  entryPoints: ["scripts/rocketbox-study/page.js"],
  bundle: true,
  format: "iife",
  loader: { ".webp": "dataurl", ".glb": "dataurl", ".html": "text" },
  target: "es2022",
  define: { WORKSHOP_MHR_LICENSE: '""' },
  minify: true,
  legalComments: "inline",
  write: false,
});
const js = outputFiles[0].text.replaceAll(/<\/script/gi, "<\\/script");
await mkdir(dirname(out), { recursive: true });
await writeFile(
  out,
  html.replace(
    "<!-- APP -->",
    () =>
      "<!-- Three.js license\n" + three + "\n" + project +
      "\nAdult body and selected apparel derived from CC0 MakeHuman / MPFB community system assets. See docs/licenses/makehuman-cc0.md.\n" +
      "\nThe two target avatars are modified copies from the Microsoft Rocketbox Avatar Library.\n" + rocketbox +
      "\n-->\n<script>" + js + "</script>",
  ),
);
console.log("Built " + out);

if (args.includes("--forms")) {
  const rocketboxStudies = await loadStudies();
  await mkdir(local + "forms", { recursive: true });
  const { validateForm } = await import("../../character-view/recipe.js");
  for (const study of rocketboxStudies) {
    const form = study.make();
    validateForm(form);
    const file = local + "forms/" + study.id + ".form.json";
    await writeFile(file, JSON.stringify({ format: "irudd.form.v1", form }) + "\n");
    console.log("Wrote " + file);
  }
}
