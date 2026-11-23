import { build } from "esbuild";
import { readFile, mkdir, writeFile } from "node:fs/promises";

await mkdir("dist", { recursive: true });
const license = await readFile("node_modules/three/LICENSE", "utf8");
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
      loader: { ".webp": "dataurl" },
      target: "es2022",
      minify: true,
      legalComments: "inline",
      write: false,
    }),
    readFile(template, "utf8"),
    styles ? readFile(styles, "utf8") : Promise.resolve(""),
  ]);
  const js = outputFiles[0].text.replaceAll(/<\/script/gi, "<\\/script");
  const content = html
    .replace("<!-- STYLE -->", () => "<style>" + css + "</style>")
    .replace(
      "<!-- APP -->",
      () =>
        "<!-- Three.js license\n" +
        license +
        "\n" +
        meshoptNotice +
        "\n-->\n<script>" +
        js +
        "</script>",
    );
  await writeFile(destination, content);
  console.log("Built " + destination);
}
await Promise.all([
  page(
    "character-view/app.js",
    "character-view/index.html",
    "dist/character-view.html",
    "character-view/style.css",
  ),
  page(
    "examples/play-model.js",
    "examples/play-model.html",
    "dist/play-model.html",
  ),
]);
