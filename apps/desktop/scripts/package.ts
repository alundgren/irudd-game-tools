// Package the desktop app for a per-user Windows installation:
//
//   node --import ./packages/document/test/support/register.ts \
//     apps/desktop/scripts/package.ts --out <dir> [--skip-build]
//
// Writes <dir>\Irudd Workshop\: the pinned Electron runtime renamed to
// "Irudd Workshop.exe", and in resources\app the built window, the CLI, the
// headless host and the stdio MCP server bundled for that runtime's Node, the
// single-file offline player, install.ps1 and the native launchers. Nothing
// else from the checkout ships: no sources, maps, node_modules or local
// reference material. The installed app needs no Node, pnpm or Python.
//
// install.ps1 sets IRUDD_INSTALL_ROOT, IRUDD_REPOSITORY, IRUDD_BRANCH and
// IRUDD_VP; the package then records its installation and must come from a
// clean checkout. Without them the package is unmanaged (no updates).

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { builtinModules } from "node:module";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { build } from "vite-plus";
import { humanPackFiles, humanPaintFile } from "@irudd/character/human";
import { bundleReport, repository } from "../../../tools/build/bundle-report.js";
import { appDir, electronExecutable } from "./electron.js";

const { values } = parseArgs({
  options: { out: { type: "string" }, "skip-build": { type: "boolean" } },
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
});
if (!values.out) throw new Error("Give the output directory with --out <dir>.");
if (process.platform !== "win32" || process.arch !== "x64")
  throw new Error("Package on Windows x64.");
const out = resolve(values.out);
const started = performance.now();
const timings: Record<string, number> = {};
const time = <T>(name: string, run: () => T): T => {
  const at = performance.now();
  const value = run();
  timings[name] = Math.round(performance.now() - at);
  return value;
};

const appName = "Irudd Workshop";
const register = pathToFileURL(
  join(repository, "packages", "document", "test", "support", "register.ts"),
).href;
const git = (...args: string[]): string =>
  execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();

const env = process.env;
const managed = env["IRUDD_INSTALL_ROOT"]
  ? {
      activationVersion: 1,
      root: resolve(env["IRUDD_INSTALL_ROOT"]),
      commit: git("rev-parse", "HEAD"),
      branch: env["IRUDD_BRANCH"] ?? "main",
      origin: env["IRUDD_REPOSITORY"] ?? git("remote", "get-url", "origin"),
      vp: resolve(env["IRUDD_VP"] ?? ""),
    }
  : undefined;
if (managed) {
  if (git("status", "--porcelain")) throw new Error("Install builds come from a clean checkout.");
  if (!env["IRUDD_VP"]) throw new Error("IRUDD_VP must name the Vite+ executable.");
}

// ── Build the window, the player and the clients ─────────────────────────────

const node = (script: string, cwd: string): void => {
  execFileSync(process.execPath, ["--import", register, script], { cwd, stdio: "inherit" });
};
if (!values["skip-build"]) {
  time("player build", () =>
    node(join(repository, "apps/player/scripts/build.ts"), join(repository, "apps/player")),
  );
  time("desktop build", () => node(join(appDir, "scripts/build.ts"), appDir));
}
const dist = join(appDir, "dist");
const playerPage = join(repository, "apps", "player", "dist", "player.html");
for (const file of [join(dist, "main", "main.js"), join(dist, "build.json"), playerPage])
  if (!existsSync(file)) throw new Error(`Missing ${file}. Build the desktop and player first.`);

const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const nodeExternal = (id: string): boolean =>
  builtins.has(id) || builtins.has(id.replace(/\/.*$/, ""));

/** Bundle a Node entry for the packaged runtime: everything inlined except Node built-ins. */
async function bundleNode(name: string, entry: string, outDir: string): Promise<void> {
  await build({
    configFile: false,
    root: repository,
    logLevel: "warn",
    ssr: { noExternal: true },
    build: {
      ssr: entry,
      outDir,
      emptyOutDir: false,
      target: "node26",
      rolldownOptions: {
        external: nodeExternal,
        output: { format: "esm", entryFileNames: `${name}.mjs`, codeSplitting: false },
      },
    },
    plugins: [bundleReport(name, outDir)],
  });
}

const clientsAt = performance.now();
const clients = join(dist, "clients");
rmSync(clients, { recursive: true, force: true });
await bundleNode("irudd", join(repository, "apps/cli/src/main.ts"), clients);
await bundleNode("irudd-mcp", join(repository, "apps/mcp/src/main.ts"), clients);
await bundleNode("irudd-host", join(appDir, "src/main/headless.ts"), clients);
rmSync(join(dist, "update"), { recursive: true, force: true });
await bundleNode("activate", join(appDir, "src/main/update/activate.ts"), join(dist, "update"));
timings["clients bundle"] = Math.round(performance.now() - clientsAt);

// The window, preload, player and these four bundles may load only allowed sources
// and externals (tools/static/RULES.md). A package that fails is never assembled.
time("bundle check", () =>
  execFileSync(process.execPath, [join(repository, "tools/static/bundles.ts"), "--packaged"], {
    cwd: repository,
    stdio: "inherit",
  }),
);

// ── Assemble the app directory ───────────────────────────────────────────────

const stamp: unknown = JSON.parse(readFileSync(join(dist, "build.json"), "utf8"));
const buildId =
  typeof stamp === "object" && stamp !== null && "build" in stamp && typeof stamp.build === "string"
    ? stamp.build
    : "unknown";
if (managed && buildId !== managed.commit)
  throw new Error(`The desktop build is ${buildId}, not the checked-out ${managed.commit}.`);

const bundle = join(out, appName);
const resources = join(bundle, "resources", "app");
time("assemble", () => {
  rmSync(bundle, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  // Electron's documented manual distribution: its runtime with the app in resources\app.
  const runtime = resolve(electronExecutable(), "..");
  cpSync(runtime, bundle, { recursive: true });
  renameSync(join(bundle, "electron.exe"), join(bundle, `${appName}.exe`));
  rmSync(join(bundle, "resources", "default_app.asar"), { force: true });
  mkdirSync(resources, { recursive: true });
  cpSync(dist, join(resources, "dist"), {
    recursive: true,
    filter: (source) => !source.endsWith(".inputs.json"),
  });
  mkdirSync(join(resources, "player"));
  copyFileSync(playerPage, join(resources, "player", "player.html"));
  copyFileSync(join(repository, "install.ps1"), join(resources, "install.ps1"));
  copyFileSync(join(repository, "LICENSE"), join(resources, "LICENSE"));
  copyFileSync(join(appDir, "installer", "icon.ico"), join(resources, "icon.ico"));
  const desktop: unknown = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8"));
  const version =
    typeof desktop === "object" && desktop !== null && "version" in desktop
      ? String(desktop.version)
      : "0.0.0";
  writeFileSync(
    join(resources, "package.json"),
    JSON.stringify(
      {
        name: "irudd-workshop",
        productName: appName,
        version,
        private: true,
        type: "module",
        main: "dist/main/main.js",
        ...(managed ? { iruddInstallation: managed } : {}),
      },
      null,
      2,
    ) + "\n",
  );
});

// ── Native launchers ─────────────────────────────────────────────────────────

time("launchers", () => {
  const bin = join(resources, "bin");
  mkdirSync(bin);
  const compiler = join(
    env["SystemRoot"] ?? "C:\\Windows",
    "Microsoft.NET",
    "Framework64",
    "v4.0.30319",
    "csc.exe",
  );
  for (const cli of [false, true])
    execFileSync(
      compiler,
      [
        "/nologo",
        "/optimize+",
        "/platform:x64",
        cli ? "/target:exe" : "/target:winexe",
        ...(cli ? ["/define:IRUDD_CLI"] : []),
        `/win32icon:${join(appDir, "installer", "icon.ico")}`,
        `/out:${join(bin, cli ? "irudd.exe" : `${appName}.exe`)}`,
        join(appDir, "installer", "launcher.cs"),
      ],
      { stdio: ["ignore", "pipe", "inherit"], windowsHide: true, timeout: 60_000 },
    );
  copyFileSync(join(appDir, "installer", "integration.ps1"), join(bin, "integration.ps1"));
});

// ── Contents: only the runtime and built outputs ─────────────────────────────

const allowed = /\.(?:m?js|cjs|json|html|css|webp|png|ico|txt|exe|ps1)$|^LICENSE$/;
const forbidden =
  /(?:^|[\\/])(?:node_modules|\.git|\.reference-cache|src|scripts|test|verification|examples)(?:[\\/]|$)|\.(?:ts|map|py|glb|sqlite)$/i;
const files: { path: string; bytes: number }[] = [];
const walk = (directory: string): void => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else
      files.push({
        path: relative(resources, file).split(sep).join("/"),
        bytes: statSync(file).size,
      });
  }
};
walk(resources);
const humanPacks = new Set<string>();
for (const pack of [...humanPackFiles, humanPaintFile]) {
  const path = `dist/assets/human/${pack.file}`;
  const bytes = readFileSync(join(resources, path));
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (bytes.length !== pack.byteLength || digest !== pack.digest)
    throw new Error(`The packaged ${path} differs from the declared adult data pack.`);
  humanPacks.add(path);
}
const problems = files.filter(
  (file) =>
    forbidden.test(file.path) ||
    (!humanPacks.has(file.path) && !allowed.test(file.path.replace(/^.*\//, ""))),
);
if (problems.length > 0)
  throw new Error(`Unexpected files in the package: ${problems.map((p) => p.path).join(", ")}`);

// ── Smoke: the packaged runtime runs the clients and opens SQLite ─────────────

const executable = join(bundle, `${appName}.exe`);
const asNode = (args: string[]): string =>
  execFileSync(executable, ["--no-warnings=ExperimentalWarning", ...args], {
    cwd: resources,
    env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
  }).trim();
const smoke = time("smoke", () => {
  const cli: unknown = JSON.parse(
    asNode([join(resources, "dist/clients/irudd.mjs"), "version", "--json"]),
  );
  const cliBuild =
    typeof cli === "object" && cli !== null && "build" in cli ? cli.build : undefined;
  if (cliBuild !== buildId)
    throw new Error(`The packaged CLI reports ${String(cliBuild)}, not ${buildId}.`);
  asNode([join(resources, "dist/clients/irudd-mcp.mjs"), "--help"]);
  asNode([join(resources, "dist/clients/irudd-host.mjs"), "--help"]);
  const runtime: unknown = JSON.parse(
    asNode([
      "-e",
      'const { DatabaseSync } = require("node:sqlite"); const db = new DatabaseSync(":memory:"); const row = db.prepare("SELECT sqlite_version() AS v").get(); db.close(); console.log(JSON.stringify({ electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, sqlite: row.v }))',
    ]),
  );
  return runtime;
});

const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
const report = {
  build: buildId,
  managed: managed !== undefined,
  runtime: smoke,
  app: { files: files.length, bytes },
  timings: { ...timings, total: Math.round(performance.now() - started) },
};
console.log(JSON.stringify(report, null, 2));
console.log(`Packaged ${appName} at ${bundle}`);
