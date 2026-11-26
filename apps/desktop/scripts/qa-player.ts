// Hidden player check on the hardware GPU.
//
//   pnpm --filter @irudd/desktop qa:player
//
// Builds apps/desktop/qa/player into apps/desktop/qa/dist (never part of the
// app build or its dist), then runs it in a never-shown Electron window
// against the tracked example GLBs. See qa/player/page.ts for what it checks.

import { spawn } from "node:child_process";
import { builtinModules } from "node:module";
import { join } from "node:path";
import { build } from "vite-plus";
import { repository } from "../../../tools/build/bundle-report.js";
import { appDir, appEnvironment, electronExecutable } from "./electron.js";

const source = join(appDir, "qa", "player");
const out = join(appDir, "qa", "dist");
const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

await build({
  configFile: false,
  root: source,
  base: "./",
  logLevel: "warn",
  build: {
    outDir: join(out, "page"),
    emptyOutDir: true,
    target: "es2024",
    modulePreload: false,
    chunkSizeWarningLimit: 4096,
  },
});

await build({
  configFile: false,
  root: appDir,
  logLevel: "warn",
  ssr: { noExternal: true, external: ["electron"] },
  build: {
    ssr: join(source, "host.ts"),
    outDir: join(out, "host"),
    emptyOutDir: true,
    target: "node26",
    rolldownOptions: {
      external: (id) => id === "electron" || builtins.has(id),
      output: { format: "esm", entryFileNames: "host.mjs", codeSplitting: false },
    },
  },
});

const child = spawn(electronExecutable(), [join(out, "host", "host.mjs")], {
  stdio: ["ignore", "inherit", "inherit"],
  env: appEnvironment({
    IRUDD_QA_PAGE: join(out, "page"),
    IRUDD_QA_EXAMPLES: join(repository, "examples"),
  }),
});
const code = await new Promise<number>((resolve) => child.on("exit", (c) => resolve(c ?? 1)));
console.log(code === 0 ? "player check passed" : "player check FAILED");
process.exitCode = code;
