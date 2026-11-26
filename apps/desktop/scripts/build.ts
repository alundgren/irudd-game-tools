import { execFileSync } from "node:child_process";
import { builtinModules } from "node:module";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite-plus";
import { bundledAssets, codeNotices } from "@irudd/character";
import { humanPackFiles, humanPaintFile, rocketboxLicense } from "@irudd/character/human";
import { bundleReport, repository } from "../../../tools/build/bundle-report.js";
import { stageForms } from "./forms.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = join(root, "dist");

const builtins = new Set(
  builtinModules.flatMap((name) => [name, `node:${name}`, name.replace(/^node:/, "")]),
);
const nodeExternal = (id: string): boolean =>
  id === "electron" || builtins.has(id) || builtins.has(id.replace(/\/.*$/, ""));

function commit(): string {
  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repository,
      encoding: "utf8",
    }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain", "--", "apps/desktop", "packages"], {
      cwd: repository,
      encoding: "utf8",
    }).trim();
    return dirty ? `${head}+dirty` : head;
  } catch {
    return "unknown";
  }
}

rmSync(dist, { recursive: true, force: true });

const started = performance.now();

await build({
  configFile: false,
  root: join(root, "src", "renderer"),
  base: "./",
  logLevel: "warn",
  build: {
    outDir: join(dist, "renderer"),
    emptyOutDir: true,
    target: "es2024",
    modulePreload: false,
    chunkSizeWarningLimit: 4096,
    rolldownOptions: {
      input: {
        index: join(root, "src", "renderer", "index.html"),
        review: join(root, "src", "renderer", "review", "review.html"),
      },
    },
  },
  plugins: [bundleReport("renderer", join(dist, "renderer"))],
});

await build({
  configFile: false,
  root,
  logLevel: "warn",
  ssr: { noExternal: true, external: ["electron"] },
  build: {
    ssr: join(root, "src", "preload", "preload.ts"),
    outDir: join(dist, "preload"),
    emptyOutDir: true,
    target: "node26",
    rolldownOptions: {
      external: ["electron"],
      output: { format: "cjs", entryFileNames: "preload.cjs", codeSplitting: false },
    },
  },
  plugins: [bundleReport("preload", join(dist, "preload"))],
});

await build({
  configFile: false,
  root,
  logLevel: "warn",
  ssr: { noExternal: true, external: ["electron"] },
  build: {
    ssr: join(root, "src", "main", "main.ts"),
    outDir: join(dist, "main"),
    emptyOutDir: true,
    target: "node26",
    rolldownOptions: {
      external: nodeExternal,
      output: { format: "esm", entryFileNames: "main.js", codeSplitting: false },
    },
  },
  plugins: [bundleReport("main", join(dist, "main"))],
});

const { forms } = stageForms(repository, join(dist, "forms"));

mkdirSync(join(dist, "assets"), { recursive: true });
for (const asset of bundledAssets)
  copyFileSync(join(repository, "character-view", asset.file), join(dist, "assets", asset.file));

mkdirSync(join(dist, "assets", "human"), { recursive: true });
for (const pack of [...humanPackFiles, humanPaintFile])
  copyFileSync(
    join(repository, "packages", "character", "assets", "human", pack.file),
    join(dist, "assets", "human", pack.file),
  );

mkdirSync(join(dist, "licenses"), { recursive: true });
copyFileSync(join(repository, "LICENSE"), join(dist, "licenses", "irudd-game-tools.txt"));
for (const name of ["makehuman-cc0", "hsrd-100-cc-by-4.0"])
  copyFileSync(
    join(repository, "docs", "licenses", `${name}.md`),
    join(dist, "licenses", `${name}.txt`),
  );
writeFileSync(join(dist, "licenses", "rocketbox-mit.txt"), rocketboxLicense + "\n");
for (const notice of codeNotices)
  copyFileSync(
    join(repository, "packages", "character", "node_modules", notice.name, notice.licenseFile),
    join(dist, "licenses", `${notice.name}.txt`),
  );
writeFileSync(
  join(dist, "licenses", "notices.json"),
  JSON.stringify(
    {
      code: codeNotices,
      humanPacks: [...humanPackFiles, humanPaintFile],
      artwork: bundledAssets.map((a) => ({ file: a.file, digest: a.digest, origin: a.origin })),
    },
    null,
    2,
  ) + "\n",
);

writeFileSync(
  join(dist, "build.json"),
  JSON.stringify({ build: commit(), builtAt: new Date().toISOString(), forms }, null, 2) + "\n",
);
console.log(`Built ${dist} in ${Math.round(performance.now() - started)} ms`);
