import { build } from "esbuild";
import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { localReferencesPlugin } from "./local-references.mjs";
import { headFits, mhrFit, rigs, scanFits, workshopFits } from "../examples/local-references.js";

await mkdir("dist", { recursive: true });
const license = await readFile("node_modules/three/LICENSE", "utf8");
const projectLicense = await readFile("LICENSE", "utf8");
const mhrLicense = await readFile("docs/licenses/mhr-apache-2.0.txt", "utf8");
const assetCredit = "Adult body, controls and selected apparel derived from CC0 MakeHuman / MPFB community system assets. See docs/licenses/makehuman-cc0.md." + (headFits["lee-perry-smith"] ? " Lee Perry-Smith study derived from Infinite, 3D Head Scan by Lee Perry-Smith (www.triplegangers.com, www.ir-ltd.net), CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/). Modified by fitting editable facial geometry." : "");
const meshoptNotice = (
  await readFile(
    "node_modules/three/examples/jsm/libs/meshopt_simplifier.module.js",
    "utf8",
  )
)
  .split("\n")
  .slice(0, 2)
  .join("\n");
async function page(entry, template, destination, styles) {
  const [{ outputFiles }, html, css] = await Promise.all([
    build({
      entryPoints: [entry],
      bundle: true,
      format: "iife",
      loader: { ".webp": "dataurl", ".glb": "dataurl", ".html": "text" },
      target: "es2022",
      define: { WORKSHOP_MHR_LICENSE: JSON.stringify(mhrLicense) },
      plugins: [localReferencesPlugin()],
      minify: true,
      legalComments: "inline",
      write: false,
    }),
    readFile(template, "utf8"),
    styles ? readFile(styles, "utf8") : Promise.resolve(""),
  ]);
  const js = outputFiles[0].text.replaceAll(/<\/script/gi, "<\\/script");
  const content = html
    .replace("<template data-workshop-style></template>", () => "<style>" + css + "</style>")
    .replace(
      "<template data-workshop-app></template>",
      () =>
        "<!-- Three.js license\n" +
        license +
        "\n" +
        projectLicense + "\n" + (entry === "character-view/entry.js" ? assetCredit + "\n" : "") + meshoptNotice +
        "\n-->\n<script>" +
        js +
        "</script>",
    );
  await writeFile(destination, content);
  console.log("Built " + destination);
}
const rigStudy = Boolean(mhrFit) && rigs.includes("mhr-rest");
if (!rigStudy) await rm("dist/rig-study.html", { force: true });
await Promise.all([
  page(
    "character-view/entry.js",
    "character-view/index.html",
    "dist/character-view.html",
    "character-view/style.css",
  ),
  ...(rigStudy
    ? [page("examples/rig-study-standalone.js", "examples/rig-study.html", "dist/rig-study.html")]
    : []),
  page(
    "examples/play-model.js",
    "examples/play-model.html",
    "dist/play-model.html",
  ),
]);
const included = [
  ...rigs.map((id) => "rig " + id),
  ...(mhrFit ? ["torso fit"] : []),
  ...(scanFits ? ["scan fits"] : []),
  ...Object.keys(workshopFits?.fits ?? {}).map((id) => "body fit " + id),
  ...Object.keys(headFits).map((id) => "head fit " + id),
];
console.log(
  included.length
    ? "Local reference studies included: " + included.join(", ")
    : "No local reference material found. Built without the reference studies (docs/local-references.md).",
);
