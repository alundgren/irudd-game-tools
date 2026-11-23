import { build } from "esbuild";
import { readFile, mkdir, writeFile } from "node:fs/promises";

const { outputFiles } = await build({
  entryPoints: ["character-view/app.js"],
  bundle: true,
  format: "iife",
  loader: {".webp": "dataurl"},
  target: "es2022",
  minify: true,
  legalComments: "inline",
  write: false,
});
const [template, css, license] = await Promise.all([
  readFile("character-view/index.html", "utf8"),
  readFile("character-view/style.css", "utf8"),
  readFile("node_modules/three/LICENSE", "utf8"),
]);
const script = outputFiles[0].text.replaceAll(/<\/script/gi, "<\\/script");
const html = template
  .replace("<!-- STYLE -->", () => "<style>" + css + "</style>")
  .replace(
    "<!-- APP -->",
    () =>
      "<!-- Three.js license\n" +
      license +
      "\n-->\n<script>" +
      script +
      "</script>",
  );
await mkdir("dist", { recursive: true });
await writeFile("dist/character-view.html", html);
console.log("Built dist/character-view.html");
