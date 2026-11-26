import { readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "vite-plus";
import { bundleReport, repository } from "../../../tools/build/bundle-report.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const outDir = join(root, "dist");

function notices(): string {
  const three = readFileSync(join(repository, "node_modules/three/LICENSE"), "utf8");
  const project = readFileSync(join(repository, "LICENSE"), "utf8");
  return `<!-- Three.js license\n${three}\n${project}\n-->`;
}

function replaceTag(html: string, file: string, open: string, close: string, body: string): string {
  const start = html.search(new RegExp(`${open}[^>]*["/]${file.replaceAll(".", "[.]")}"[^>]*>`));
  if (start < 0) throw new Error(`The page does not reference ${file}.`);
  const end = html.indexOf(close, start) + close.length;
  return html.slice(0, start) + body + html.slice(end);
}

function singleFile(): Plugin {
  return {
    name: "irudd-single-file",
    enforce: "post",
    generateBundle(_options, bundle) {
      const page = bundle["index.html"];
      if (!page || page.type !== "asset" || typeof page.source !== "string")
        throw new Error("The player page was not emitted.");
      let html = page.source;
      for (const [file, output] of Object.entries(bundle)) {
        if (output.type === "chunk") {
          const code = output.code.replaceAll(/<\/script/gi, "<\\/script");
          html = replaceTag(
            html,
            file,
            "<script",
            "</script>",
            `<script type="module">${code}</script>`,
          );
          delete bundle[file];
        } else if (file.endsWith(".css") && typeof output.source === "string") {
          html = replaceTag(html, file, "<link", ">", `<style>${output.source}</style>`);
          delete bundle[file];
        }
      }
      page.source = html.replace("</head>", () => `${notices()}\n</head>`);
    },
  };
}

await build({
  configFile: false,
  root,
  base: "./",
  logLevel: "warn",
  build: {
    outDir,
    emptyOutDir: true,
    target: "es2022",
    assetsInlineLimit: () => true,
    cssCodeSplit: false,
    modulePreload: false,
    rolldownOptions: { output: { codeSplitting: false } },
  },
  plugins: [singleFile(), bundleReport("player", outDir, { "index.html": "player.html" })],
});

renameSync(join(outDir, "index.html"), join(outDir, "player.html"));
console.log("Built " + join(outDir, "player.html"));
