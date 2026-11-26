import { spawn } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkDesktopContract } from "./desktop-contract.ts";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const check = join(repo, "tools/static/check.ts");
const vp = join(repo, "node_modules/vite-plus/bin/vp");
const base = join(tmpdir(), `irudd-static-fixtures-${process.pid}`);
const keep = process.argv.includes("--keep");

const disable = ["oxlint", "disable-next-line"].join("-");
const disableFile = ["oxlint", "disable"].join("-");

const silentTsc = join(base, "silent-tsc.mjs");
const silentTscSource = `import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
if (args.includes("--showConfig")) {
  const real = spawnSync(process.execPath, [${JSON.stringify(join(repo, "node_modules/typescript/bin/tsc"))}, ...args], { encoding: "utf8" });
  process.stdout.write(real.stdout);
  process.exit(real.status ?? 1);
}
process.exit(2);
`;

type Files = Readonly<Record<string, string>>;

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const tsconfig = (options: Record<string, unknown>, include = ["src"]): string =>
  json({ extends: "../../tsconfig.base.json", compilerOptions: options, include });

const cleanFiles: Files = {
  "package.json": json({ name: "static-fixture", private: true, type: "module" }),
  "pnpm-workspace.yaml": "packages:\n  - packages/*\n  - apps/*\n  - verification/protocol\n",
  "tsconfig.base.json": readFileSync(join(repo, "tsconfig.base.json"), "utf8"),
  "vite.config.ts": readFileSync(join(repo, "vite.config.ts"), "utf8"),
  "tools/static/exceptions.json": "[]\n",
  "tools/static/tsconfig.json": json({
    extends: "../../tsconfig.base.json",
    compilerOptions: { allowImportingTsExtensions: true, lib: ["es2024"], types: ["node"] },
    include: ["*.ts"],
  }),
  "tools/static/check.ts":
    'import { cwd } from "node:process";\n\nexport const here = (): string => cwd();\n',
  "tools/static/fixtures.ts":
    'import { here } from "./check.ts";\n\nexport const fixture = (): string => here();\n',

  "packages/document/package.json": json({
    name: "@irudd/document",
    private: true,
    type: "module",
    exports: { ".": "./src/index.ts" },
  }),
  "packages/document/tsconfig.json": tsconfig({ lib: ["es2024"], types: [], skipLibCheck: true }),
  "packages/document/src/index.ts":
    'export type { Revision } from "./revision.js";\nexport { revise } from "./revision.js";\n',
  "packages/document/src/revision.ts":
    "export interface Revision {\n  readonly number: number;\n}\n\nexport const revise = (revision: Revision): Revision => ({ number: revision.number + 1 });\n",

  "packages/workshop/package.json": json({
    name: "@irudd/workshop",
    private: true,
    type: "module",
    exports: { ".": "./src/index.ts" },
  }),
  "packages/workshop/tsconfig.json": tsconfig({ lib: ["es2024"], types: ["node"] }),
  "packages/workshop/src/index.ts": 'export { commit } from "./service/commit.js";\n',
  "packages/workshop/src/service/commit.ts":
    'import { writeRevision } from "../storage/writer.js";\n\nexport const commit = (path: string, number: number): void => writeRevision(path, number);\n',
  "packages/workshop/src/storage/writer.ts":
    'import { writeFileSync } from "node:fs";\n\nexport const writeRevision = (path: string, number: number): void => writeFileSync(path, String(number));\n',

  "apps/desktop/package.json": json({
    name: "@irudd/desktop",
    private: true,
    type: "module",
    main: "dist/main/main.js",
  }),
  "apps/desktop/tsconfig.main.json": tsconfig(
    { lib: ["es2024"], types: ["node"], skipLibCheck: true },
    ["src/main"],
  ),
  "apps/desktop/tsconfig.preload.json": tsconfig(
    { lib: ["es2024"], types: ["node"], skipLibCheck: true },
    ["src/preload"],
  ),
  "apps/desktop/tsconfig.renderer.json": tsconfig({ lib: ["es2024", "dom"], types: [] }, [
    "src/renderer",
  ]),
  "apps/desktop/src/preload/preload.ts": "export {};\n",
  "apps/desktop/src/renderer/main.ts": "export {};\n",
  "apps/desktop/src/main/headless.ts": "export {};\n",
  "apps/desktop/src/main/main.ts":
    'import { platform } from "node:os";\n\nexport const describe = (): string => platform();\n',

  "apps/player/package.json": json({
    name: "@irudd/web-player",
    private: true,
    type: "module",
    exports: { ".": "./src/main.ts" },
  }),
  "apps/player/tsconfig.json": tsconfig({ lib: ["es2024", "dom"], types: [] }),
  "apps/player/src/main.ts":
    "export const play = (canvas: HTMLCanvasElement): number => canvas.width;\n",

  "apps/cli/package.json": json({
    name: "@irudd/cli",
    private: true,
    type: "module",
    exports: { ".": "./src/main.ts" },
    dependencies: { "@irudd/workshop": "workspace:*" },
  }),
  "apps/cli/tsconfig.json": tsconfig({ lib: ["es2024"], types: ["node"] }),
  "apps/cli/src/main.ts": "export const run = (args: readonly string[]): number => args.length;\n",

  "verification/protocol/package.json": json({
    name: "@irudd/verification-protocol",
    private: true,
    type: "module",
  }),
  "verification/protocol/tsconfig.json": tsconfig({ lib: ["es2024"], types: ["node"] }),
  "verification/protocol/src/gate.ts": "export const gate = (): boolean => true;\n",
};

interface Scenario {
  readonly name: string;
  readonly files: Files;
  readonly expect: { readonly step: string; readonly pattern: RegExp };
  readonly args?: readonly string[];
  readonly links?: Readonly<Record<string, string>>;
}

const docTs = (extra: Record<string, unknown>): string =>
  tsconfig({ lib: ["es2024"], types: [], skipLibCheck: true, ...extra });
const docIndex =
  'export type { Revision } from "./revision.js";\nexport { revise } from "./revision.js";\n';
const escapeReason = "fixture: owner tools, removal when the fixture is restored";
const documentWithEffect = json({
  name: "@irudd/document",
  private: true,
  type: "module",
  exports: { ".": "./src/index.ts" },
  dependencies: { effect: "catalog:" },
});
const effectLink = {
  "packages/document/node_modules": join(repo, "packages/document/node_modules"),
};

const transitivelyLoaded = {
  "packages/workshop/package.json": json({
    name: "@irudd/workshop",
    private: true,
    type: "module",
    exports: { ".": "./src/index.ts" },
    dependencies: { "@irudd/document": "workspace:*" },
  }),
  "packages/workshop/src/index.ts": 'export { revise } from "../../document/src/index.js";\n',
  "apps/cli/src/main.ts": 'export { revise } from "../../../packages/workshop/src/index.js";\n',
};

const scenarios: readonly Scenario[] = [
  {
    name: "client directly imports a transitive workspace sibling",
    files: {
      ...transitivelyLoaded,
      "apps/cli/src/main.ts": 'export { revise } from "../../../packages/document/src/index.js";\n',
    },
    expect: { step: "graph", pattern: /undeclared-workspace-import: apps\/cli/ },
  },
  {
    name: "formatting violation",
    files: { "packages/document/src/revision.ts": "export   const  messy = {a:1}\n" },
    expect: {
      step: "format",
      pattern: /packages\/document\/src\/revision\.ts is not Oxfmt-formatted/,
    },
  },
  {
    name: "lint correctness error",
    files: {
      "packages/document/src/index.ts":
        'export type { Revision } from "./revision.js";\nexport { revise } from "./revision.js";\n\nexport const stop = (): void => {\n  debugger;\n};\n',
    },
    expect: { step: "lint", pattern: /no-debugger/ },
  },
  {
    name: "explicit any",
    files: {
      "packages/document/src/loose.ts": "export const loose = (value: any): unknown => value;\n",
    },
    expect: { step: "lint", pattern: /no-explicit-any/ },
  },
  {
    name: "unguarded type assertion",
    files: {
      "packages/document/src/index.ts":
        'export type { Revision } from "./revision.js";\nexport { revise } from "./revision.js";\n\nexport const count = (value: unknown): number => value as number;\n',
    },
    expect: { step: "lint", pattern: /consistent-type-assertions/ },
  },
  {
    name: "unused lint disable",
    files: {
      "packages/document/src/index.ts": `export type { Revision } from "./revision.js";\n// ${disable} no-debugger -- fixture: nothing on the next line needs this\nexport { revise } from "./revision.js";\n`,
    },
    expect: { step: "lint", pattern: /Unused .*disable directive/i },
  },
  {
    name: "unexplained lint escape",
    files: {
      "packages/document/src/index.ts": `export type { Revision } from "./revision.js";\nexport { revise } from "./revision.js";\n\nexport const stop = (): void => {\n  // ${disable} no-debugger\n  debugger;\n};\n`,
    },
    expect: { step: "escapes", pattern: /explain the exception/ },
  },
  {
    name: "non-literal dynamic import",
    files: {
      "apps/desktop/src/main/main.ts":
        'import { platform } from "node:os";\n\nconst name = platform() === "win32" ? "node:fs" : "node:path";\n\nexport const describe = async (): Promise<unknown> => import(name);\n',
    },
    expect: { step: "lint", pattern: /no-dynamic-require/ },
  },
  {
    name: "desktop declaration error outside Electron",
    files: {
      "apps/desktop/src/main/extra.d.ts": "export type BadHeader = HTMLElement;\n",
    },
    expect: { step: "types", pattern: /extra\.d\.ts.*TS2304: Cannot find name 'HTMLElement'/ },
  },
  {
    name: "strict type error",
    files: {
      "packages/document/src/revision.ts":
        "export interface Revision {\n  readonly number: number;\n}\n\nexport const revise = (revision: Revision): Revision => ({ number: `${revision.number}` });\n",
    },
    expect: { step: "types", pattern: /error TS2322/ },
  },
  {
    name: "DOM lib in document",
    files: {
      "packages/document/tsconfig.json": tsconfig({
        lib: ["es2024", "dom"],
        types: [],
        skipLibCheck: true,
      }),
    },
    expect: { step: "types", pattern: /lib "dom" is not allowed for document/ },
  },
  {
    name: "ambient Node declarations leak into document",
    files: {
      "packages/document/src/revision.ts":
        '/// <reference types="node" />\nexport interface Revision {\n  readonly number: number;\n}\n\nexport const revise = (revision: Revision): Revision => ({ number: revision.number + 1 });\n',
    },
    expect: { step: "types", pattern: /Node declarations leak into the program/ },
  },
  {
    name: "path alias in document",
    files: {
      "packages/document/tsconfig.json": tsconfig({
        lib: ["es2024"],
        types: [],
        skipLibCheck: true,
        paths: { "#platform": ["../workshop/src/index.ts"] },
      }),
    },
    expect: { step: "types", pattern: /paths aliases are not allowed/ },
  },
  {
    name: "document reaches platform through a barrel",
    files: {
      "packages/document/src/index.ts":
        'export type { Revision } from "./revision.js";\nexport { revise } from "./revision.js";\nexport { commit } from "../../workshop/src/index.js";\n',
    },
    expect: {
      step: "graph",
      pattern: /document-reaches-no-platform: packages\/document\/src\/index\.ts → (fs|node:fs)/,
    },
  },
  {
    name: "document imports an undeclared package",
    files: {
      "packages/document/src/index.ts":
        'export type { Revision } from "./revision.js";\nexport { revise } from "./revision.js";\nexport { Vector3 } from "three";\n',
    },
    expect: {
      step: "graph",
      pattern: /not-to-undeclared-package: packages\/document\/src\/index\.ts/,
    },
  },
  {
    name: "desktop import in the offline player",
    files: {
      "apps/player/src/main.ts":
        'export { describe } from "../../desktop/src/main/main.js";\n\nexport const play = (canvas: HTMLCanvasElement): number => canvas.width;\n',
    },
    expect: {
      step: "graph",
      pattern:
        /player-reaches-no-desktop: apps\/player\/src\/main\.ts → apps\/desktop\/src\/main\/main\.ts/,
    },
  },
  {
    name: "literal dynamic desktop import in the offline player",
    files: {
      "apps/player/src/main.ts":
        'export const play = (canvas: HTMLCanvasElement): number => canvas.width;\n\nexport const leak = async (): Promise<unknown> => import("node:fs");\n',
    },
    expect: {
      step: "graph",
      pattern: /player-reaches-no-desktop: apps\/player\/src\/main\.ts → (fs|node:fs)/,
    },
  },
  {
    name: "client imports the storage writer",
    files: {
      "apps/cli/src/main.ts":
        'import { writeRevision } from "../../../packages/workshop/src/storage/writer.js";\n\nexport const run = (args: readonly string[]): void => writeRevision(args[0] ?? "out", args.length);\n',
    },
    expect: {
      step: "graph",
      pattern:
        /client-reaches-no-storage-writer: apps\/cli\/src\/main\.ts → packages\/workshop\/src\/storage\/writer\.ts/,
    },
  },
  {
    name: "storage writer imported outside the service",
    files: {
      "packages/workshop/src/index.ts":
        'export { commit } from "./service/commit.js";\nexport { writeRevision } from "./storage/writer.js";\n',
    },
    expect: {
      step: "graph",
      pattern: /revision-writes-through-service: packages\/workshop\/src\/index\.ts/,
    },
  },
  {
    name: "package imports an app",
    files: {
      "packages/workshop/src/index.ts":
        'export { commit } from "./service/commit.js";\nexport { describe } from "../../../apps/desktop/src/main/main.js";\n',
    },
    expect: {
      step: "graph",
      pattern: /packages-not-to-apps: packages\/workshop\/src\/index\.ts → apps\/desktop/,
    },
  },
  {
    name: "privileged API outside a named adapter",
    files: {
      "packages/workshop/src/service/commit.ts":
        'import { execFileSync } from "node:child_process";\nimport { writeRevision } from "../storage/writer.js";\n\nexport const commit = (path: string, number: number): void => {\n  execFileSync("git", ["status"]);\n  writeRevision(path, number);\n};\n',
    },
    expect: {
      step: "graph",
      pattern: /privileged-apis-in-named-adapters: packages\/workshop\/src\/service\/commit\.ts/,
    },
  },
  {
    name: "electron outside the desktop app",
    files: {
      "apps/cli/src/main.ts":
        'export { app } from "electron";\n\nexport const run = (args: readonly string[]): number => args.length;\n',
    },
    expect: {
      step: "graph",
      pattern: /electron-only-in-desktop: apps\/cli\/src\/main\.ts → electron/,
    },
  },
  {
    name: "circular modules",
    files: {
      "packages/document/src/revision.ts":
        'import { label } from "./label.js";\n\nexport interface Revision {\n  readonly number: number;\n}\n\nexport const revise = (revision: Revision): Revision => ({ number: revision.number + label().length });\n',
      "packages/document/src/label.ts":
        'import { revise } from "./revision.js";\n\nexport const label = (): string => String(revise);\n',
    },
    expect: { step: "graph", pattern: /no-circular/ },
  },
  {
    name: "stale scoped exception",
    files: {
      "tools/static/exceptions.json": json([
        {
          rule: "client-reaches-no-storage-writer",
          from: "apps/cli/src/main.ts",
          to: "packages/workshop/src/storage/writer.ts",
          owner: "fixture",
          removal: "fixture",
        },
      ]),
    },
    expect: { step: "graph", pattern: /stale exception client-reaches-no-storage-writer/ },
  },
  {
    name: "package with no shipped entries",
    files: {
      "apps/cli/package.json": json({
        name: "@irudd/cli",
        private: true,
        type: "module",
      }),
    },
    expect: { step: "manifests", pattern: /apps\/cli has no shipped entries/ },
  },
  {
    name: "workspace package without a policy",
    files: {
      "packages/extra/package.json": json({ name: "@irudd/extra", private: true, type: "module" }),
    },
    expect: {
      step: "manifests",
      pattern: /packages\/extra is a workspace package with no static policy/,
    },
  },
  {
    name: "dependency pinned outside the catalog",
    files: {
      "packages/document/package.json": json({
        name: "@irudd/document",
        private: true,
        type: "module",
        exports: { ".": "./src/index.ts" },
        dependencies: { effect: "^4.1.5" },
      }),
    },
    expect: { step: "manifests", pattern: /dependencies\.effect is "\^4\.1\.5"; use "catalog:"/ },
  },
  {
    name: "workspace package imports map",
    files: {
      "packages/document/package.json": json({
        name: "@irudd/document",
        private: true,
        type: "module",
        exports: "./src/index.ts",
        imports: { "#revision": { types: "./src/revision.ts", default: "./src/index.ts" } },
      }),
    },
    expect: { step: "manifests", pattern: /package imports maps/ },
  },
  {
    name: "unapproved root dependency",
    files: {
      "package.json": json({
        name: "static-fixture",
        dependencies: { "sample-package": "catalog:" },
      }),
    },
    expect: { step: "manifests", pattern: /sample-package is outside the root dependency policy/ },
  },
  {
    name: "compiler tracing must not write",
    files: { "packages/document/tsconfig.json": docTs({ generateTrace: "./trace" }) },
    expect: {
      step: "types",
      pattern: /generateTrace is outside the read-only compiler option policy/,
    },
  },
  {
    name: "replacement standard libraries",
    files: { "packages/document/tsconfig.json": docTs({ libReplacement: true }) },
    expect: {
      step: "types",
      pattern: /libReplacement is outside the read-only compiler option policy/,
    },
  },
  {
    name: "noImplicitAny false under strict",
    files: {
      "packages/document/tsconfig.json": docTs({ noImplicitAny: false }),
      "packages/document/src/index.ts": `${docIndex}\nexport const loose = (value) => value;\n`,
    },
    expect: { step: "types", pattern: /noImplicitAny false weakens strict/ },
  },
  {
    name: "strictNullChecks false under strict",
    files: { "packages/document/tsconfig.json": docTs({ strictNullChecks: false }) },
    expect: { step: "types", pattern: /strictNullChecks false weakens strict/ },
  },
  {
    name: "base invariant weakened",
    files: { "packages/document/tsconfig.json": docTs({ noUncheckedIndexedAccess: false }) },
    expect: {
      step: "types",
      pattern: /noUncheckedIndexedAccess must stay true from tsconfig\.base\.json/,
    },
  },
  {
    name: "noEmit false with an output directory",
    files: {
      "packages/document/tsconfig.json": docTs({ noEmit: false, outDir: "out", rootDir: "src" }),
    },
    expect: { step: "types", pattern: /noEmit must stay true/ },
  },
  {
    name: "incremental build state",
    files: { "packages/document/tsconfig.json": docTs({ incremental: true }) },
    expect: { step: "types", pattern: /incremental writes build state/ },
  },
  {
    name: "composite build state",
    files: { "packages/document/tsconfig.json": docTs({ composite: true }) },
    expect: { step: "types", pattern: /composite writes build state/ },
  },
  {
    name: "failing compiler without a readable diagnostic",
    files: {},
    args: ["--tsc", silentTsc],
    expect: { step: "types", pattern: /tsc exited 2 without a readable diagnostic/ },
  },
  {
    name: "allowJs with a JavaScript entry",
    files: {
      "packages/document/tsconfig.json": docTs({ allowJs: true }),
      "packages/document/package.json": json({
        name: "@irudd/document",
        private: true,
        type: "module",
        exports: { ".": "./src/main.js" },
      }),
      "packages/document/src/main.js":
        'export { revise } from "./revision.js";\n\nexport const broken = () => (1).notAMethod();\n',
    },
    expect: {
      step: "types",
      pattern: /allowJs\/checkJs needs a transitional javascript exemption/,
    },
  },
  {
    name: "JavaScript behind a declaration file",
    files: {
      "packages/workshop/src/service/legacy.js": "export const stamp = (value) => value.id;\n",
      "packages/workshop/src/service/legacy.d.ts":
        "export declare const stamp: (value: { readonly id: number }) => number;\n",
      "packages/workshop/src/service/commit.ts":
        'import { writeRevision } from "../storage/writer.js";\nimport { stamp } from "./legacy.js";\n\nexport const commit = (path: string, number: number): void =>\n  writeRevision(path, stamp({ id: number }));\n',
    },
    expect: {
      step: "graph",
      pattern:
        /port-modules-are-typescript: packages\/workshop\/src\/service\/commit\.ts → packages\/workshop\/src\/service\/legacy\.js/,
    },
  },
  {
    name: "source outside every program",
    files: {
      "packages/workshop/scripts/seed.ts":
        "export const seed = (count: number): string => count.toFixed();\n",
    },
    expect: {
      step: "types",
      pattern: /packages\/workshop\/scripts\/seed\.ts is outside every tsconfig program/,
    },
  },
  {
    name: "unchecked JavaScript beside the sources",
    files: {
      "packages/workshop/src/loader.mjs":
        "export const resolve = (specifier) => specifier.trim();\n",
    },
    expect: {
      step: "types",
      pattern: /packages\/workshop\/src\/loader\.mjs is JavaScript outside every tsconfig program/,
    },
  },
  {
    name: "first-party declaration file in document",
    files: {
      "packages/document/src/platform.d.ts":
        "declare function fetch(url: string): Promise<unknown>;\n",
      "packages/document/src/index.ts": `${docIndex}\nexport const load = (): Promise<unknown> => fetch("https://example.invalid");\n`,
    },
    expect: {
      step: "types",
      pattern: /packages\/document\/src\/platform\.d\.ts is a first-party declaration file/,
    },
  },
  {
    name: "declare global in document",
    files: {
      "packages/document/src/index.ts": `${docIndex}\ndeclare global {\n  var process: { readonly env: Readonly<Record<string, string | undefined>> };\n}\n\nexport const home = (): string | undefined => process.env["HOME"];\n`,
    },
    expect: { step: "types", pattern: /index\.ts: declare global adds ambient globals/ },
  },
  {
    name: "ambient module declaration in document",
    files: {
      "packages/document/src/index.ts": `${docIndex}\ndeclare module "node:fs" {\n  export function readFileSync(path: string): string;\n}\n`,
    },
    expect: { step: "types", pattern: /declare module "node:fs" is an ambient module/ },
  },
  {
    name: "reference lib dom in document",
    files: { "packages/document/src/index.ts": `/// <reference lib="dom" />\n${docIndex}` },
    expect: { step: "lint", pattern: /triple-slash-reference/ },
  },
  {
    name: "lib leak through a reference in document",
    files: { "packages/document/src/index.ts": `/// <reference lib="dom" />\n${docIndex}` },
    expect: { step: "types", pattern: /lib "dom" leaks into the program/ },
  },
  {
    name: "JSON.parse result used without narrowing",
    files: {
      "packages/document/src/index.ts": `${docIndex}\nexport const read = (text: string): number => JSON.parse(text).a.b;\n`,
    },
    expect: { step: "lint", pattern: /no-unsafe-member-access/ },
  },
  {
    name: "Reflect.get reads a global",
    files: {
      "packages/document/src/index.ts": `${docIndex}\nexport const home = (): unknown => Reflect.get(globalThis, "process").env;\n`,
    },
    expect: { step: "lint", pattern: /no-unsafe-member-access/ },
  },
  {
    name: "getBuiltinModule outside a named adapter",
    files: {
      "packages/workshop/src/service/commit.ts":
        'import { writeRevision } from "../storage/writer.js";\n\nexport const commit = (path: string, number: number): void => {\n  const runtime = process;\n  runtime.getBuiltinModule("node:path");\n  writeRevision(path, number);\n};\n',
    },
    expect: { step: "lint", pattern: /no-restricted-properties/ },
  },
  {
    name: "createRequire outside a named adapter",
    files: {
      "packages/workshop/src/service/commit.ts":
        'import { createRequire } from "node:module";\nimport { writeRevision } from "../storage/writer.js";\n\nconst load = createRequire(import.meta.url);\n\nexport const commit = (path: string, number: number): unknown => {\n  writeRevision(path, number);\n  return load("node:child_process");\n};\n',
    },
    expect: {
      step: "graph",
      pattern:
        /privileged-apis-in-named-adapters: packages\/workshop\/src\/service\/commit\.ts → (node:)?module/,
    },
  },
  {
    name: "effect host family in document",
    files: {
      "packages/document/package.json": documentWithEffect,
      "packages/document/src/index.ts": `${docIndex}export * as Http from "effect/http";\n`,
    },
    links: effectLink,
    expect: {
      step: "graph",
      pattern: /document-only-effect: packages\/document\/src\/index\.ts → .*effect\/dist\/http\//,
    },
  },
  {
    name: "package gitignore hides a source",
    files: {
      "packages/document/.gitignore": "src/loose.ts\n",
      "packages/document/src/loose.ts": "export   const loose = (value: any): unknown => value\n",
    },
    expect: {
      step: "coverage",
      pattern: /packages\/document\/src\/loose\.ts is hidden from lint and format/,
    },
  },
  {
    name: "root gitignore hides a source",
    files: {
      ".gitignore": "packages/document/src/loose.ts\n",
      "packages/document/src/loose.ts": "export   const loose = (value: any): unknown => value\n",
    },
    expect: {
      step: "coverage",
      pattern: /packages\/document\/src\/loose\.ts is hidden from lint and format/,
    },
  },
  {
    name: "package-local lint configuration",
    files: {
      "packages/document/.oxlintrc.json": json({ rules: { "typescript/no-explicit-any": "off" } }),
    },
    expect: {
      step: "coverage",
      pattern: /packages\/document\/\.oxlintrc\.json: package-local lint, format or ignore/,
    },
  },
  {
    name: "escape names two rules",
    files: {
      "packages/document/src/index.ts": `${docIndex}\nexport const stop = (): void => {\n  // ${disable} no-debugger, no-console -- ${escapeReason}\n  debugger;\n};\n`,
    },
    expect: { step: "escapes", pattern: /name exactly one rule per escape/ },
  },
  {
    name: "file-wide lint disable",
    files: {
      "packages/document/src/index.ts": `/* ${disableFile} no-debugger -- ${escapeReason} */\n${docIndex}\nexport const stop = (): void => {\n  debugger;\n};\n`,
    },
    expect: { step: "escapes", pattern: /file- and block-wide disables are not allowed/ },
  },
  {
    name: "escape of a guard rule",
    files: {
      "packages/document/src/index.ts": `${docIndex}\n// ${disable} typescript-eslint/ban-ts-comment -- ${escapeReason}\n// @ts-ignore\nexport const count: number = "one";\n`,
    },
    expect: {
      step: "escapes",
      pattern: /typescript-eslint\/ban-ts-comment guards the type and graph checks/,
    },
  },
];

const passing: readonly Scenario[] = [
  {
    name: "declared dependencies bring in their own workspace dependencies",
    files: transitivelyLoaded,
    expect: { step: "", pattern: /^$/ },
  },
  {
    name: "module-private brand in document",
    files: {
      "packages/document/src/revision.ts":
        "declare const revisionBrand: unique symbol;\n\nexport type RevisionNumber = number & { readonly [revisionBrand]: true };\n\nexport interface Revision {\n  readonly number: number;\n}\n\nexport const revise = (revision: Revision): Revision => ({ number: revision.number + 1 });\n",
    },
    expect: { step: "", pattern: /^$/ },
  },
  {
    name: "effect core module in document",
    files: {
      "packages/document/package.json": documentWithEffect,
      "packages/document/src/index.ts": `${docIndex}export { Schema } from "effect";\n`,
    },
    links: effectLink,
    expect: { step: "", pattern: /^$/ },
  },
];

const scopedException: Scenario = {
  name: "exact scoped exception",
  files: {
    ...scenarios.find((scenario) => scenario.name === "client imports the storage writer")?.files,
    "tools/static/exceptions.json": json([
      {
        rule: "client-reaches-no-storage-writer",
        from: "apps/cli/src/main.ts",
        to: "packages/workshop/src/storage/writer.ts",
        owner: "fixture",
        removal: "Remove when the client uses the service connection.",
      },
    ]),
  },
  expect: { step: "", pattern: /^$/ },
};

const linkPaths = [
  "node_modules",
  ...new Set(scenarios.concat(passing).flatMap((scenario) => Object.keys(scenario.links ?? {}))),
];

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function removeFixtures(): void {
  if (!existsSync(base)) return;
  for (const name of readdirSync(base)) {
    for (const path of linkPaths) {
      const link = join(base, name, path);
      if (isLink(link)) unlinkSync(link);
    }
  }
  rmSync(base, { recursive: true, force: true });
}

function snapshot(root: string, dir = root, out = new Map<string, string>()): Map<string, string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === "node_modules" || name === "static-report.json") continue;
    const stats = statSync(path);
    if (stats.isDirectory()) snapshot(root, path, out);
    else
      out.set(path.slice(root.length + 1).replaceAll("\\", "/"), `${stats.size}:${stats.mtimeMs}`);
  }
  return out;
}

function write(root: string, files: Files): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

interface Outcome {
  readonly code: number;
  readonly findings: readonly { readonly step: string; readonly message: string }[];
  readonly ms: number;
  readonly output: string;
  readonly wrote: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function node(args: readonly string[], cwd: string): Promise<{ code: number; output: string }> {
  return new Promise((done) => {
    const child = spawn(process.execPath, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("close", (code) => done({ code: code ?? 1, output }));
  });
}

async function runCheck(root: string, args: readonly string[] = []): Promise<Outcome> {
  const report = join(root, "static-report.json");
  rmSync(report, { force: true });
  const before = snapshot(root);
  const start = performance.now();
  const { code, output } = await node([check, "--root", root, "--json", report, ...args], repo);
  const ms = Math.round(performance.now() - start);
  const after = snapshot(root);
  const wrote = [...new Set([...before.keys(), ...after.keys()])].filter(
    (path) => before.get(path) !== after.get(path),
  );
  const findings: { step: string; message: string }[] = [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(report, "utf8"));
    const results = isRecord(parsed) ? records(parsed["results"]) : [];
    for (const result of results) {
      for (const finding of records(result["findings"])) {
        const { step, message } = finding;
        if (typeof step === "string" && typeof message === "string")
          findings.push({ step, message });
      }
    }
  } catch {
    findings.push({ step: "report", message: output });
  }
  return { code, findings, ms, output, wrote };
}

async function fresh(name: string, links: Readonly<Record<string, string>> = {}): Promise<string> {
  const root = join(base, name.replaceAll(/[^a-z0-9]+/gi, "-"));
  mkdirSync(root, { recursive: true });
  write(root, cleanFiles);
  symlinkSync(join(repo, "node_modules"), join(root, "node_modules"), "junction");
  for (const [path, target] of Object.entries(links)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    symlinkSync(target, join(root, path), "junction");
  }
  await node([vp, "fmt", "."], root);
  return root;
}

function restore(root: string, scenario: Scenario): void {
  for (const path of Object.keys(scenario.files)) rmSync(join(root, path), { force: true });
  const original: Record<string, string> = {};
  for (const path of Object.keys(scenario.files)) {
    const text = cleanFiles[path];
    if (text !== undefined) original[path] = text;
  }
  write(root, original);
  if (scenario.name === "workspace package without a policy")
    rmSync(join(root, "packages/extra"), { recursive: true });
}

async function main(): Promise<number> {
  removeFixtures();
  mkdirSync(base, { recursive: true });
  writeFileSync(silentTsc, silentTscSource);
  let failures = 0;
  let checks = 0;
  const report = (ok: boolean, text: string): void => {
    if (!ok) failures += 1;
    console.log(`${ok ? "ok  " : "FAIL"} ${text}`);
  };
  const readOnly = (name: string, outcome: Outcome): void => {
    checks += 1;
    if (outcome.wrote.length > 0) report(false, `${name}: check wrote ${outcome.wrote.join(", ")}`);
  };

  const desktopRoot = join(base, "electron-contract");
  const mainEntry = "apps/desktop/src/main/main.ts";
  const preloadEntry = "apps/desktop/src/preload/preload.ts";
  const mainSource =
    'import { BrowserWindow as Window } from "electron"; new Window({webPreferences:{sandbox:true, contextIsolation:true, nodeIntegration:false, webSecurity:true}});';
  write(desktopRoot, { [mainEntry]: mainSource });
  checkDesktopContract(desktopRoot, "main", [mainEntry]);
  const unexpectedBridge =
    'import {contextBridge} from "electron"; contextBridge.exposeInMainWorld("workshop", {extra: () => 1});';
  for (const [kind, entry, source, diagnostic] of [
    [
      "main",
      mainEntry,
      mainSource.replace("sandbox:true", "sandbox:false"),
      "webPreferences.sandbox",
    ],
    [
      "main",
      mainEntry,
      mainSource.replace("webSecurity:true", "webSecurity:true, ...override"),
      "object key",
    ],
    ["preload", preloadEntry, unexpectedBridge, "reviewed methods"],
  ] as const) {
    write(desktopRoot, { [entry]: source });
    let message = "";
    try {
      checkDesktopContract(desktopRoot, kind, [entry]);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    report(message.includes(diagnostic), `desktop build contract rejects ${diagnostic}`);
  }

  const cleanRoot = await fresh("clean");
  const clean = await runCheck(cleanRoot);
  readOnly("clean fixture", clean);
  report(clean.code === 0 && clean.findings.length === 0, `clean fixture passes (${clean.ms} ms)`);
  if (clean.code !== 0) console.log(clean.output);

  const queue = [...scenarios, ...passing, scopedException];
  const worker = async (): Promise<void> => {
    for (let scenario = queue.shift(); scenario !== undefined; scenario = queue.shift()) {
      const root = await fresh(scenario.name, scenario.links);
      write(root, scenario.files);
      const expected = scenario.expect;
      if (expected.step === "") {
        await node([vp, "fmt", "."], root);
        const passed = await runCheck(root);
        readOnly(scenario.name, passed);
        report(passed.code === 0, `${scenario.name}: passes (${passed.ms} ms)`);
        if (passed.code !== 0) console.log(passed.output);
        continue;
      }
      const broken = await runCheck(root, scenario.args);
      readOnly(scenario.name, broken);
      const hit = broken.findings.find(
        (f) => f.step === expected.step && expected.pattern.test(f.message),
      );
      report(
        broken.code !== 0 && hit !== undefined,
        `${scenario.name}: exit ${broken.code}, ${expected.step} → ${hit?.message.split("\n")[0] ?? "expected diagnostic missing"} (${broken.ms} ms)`,
      );
      if (hit === undefined) console.log(broken.output);
      restore(root, scenario);
      await node([vp, "fmt", "."], root);
      const fixed = await runCheck(root);
      readOnly(`${scenario.name} (restored)`, fixed);
      report(fixed.code === 0, `${scenario.name}: passes again after removal (${fixed.ms} ms)`);
      if (fixed.code !== 0) console.log(fixed.output);
    }
  };
  const start = performance.now();
  await Promise.all([worker(), worker(), worker(), worker()]);
  console.log(
    `${failures === 0 ? "all fixtures behaved" : `${failures} fixture failures`}: ${scenarios.length + passing.length + 2} scenarios, ${checks} read-only check runs, in ${Math.round(performance.now() - start)} ms`,
  );
  if (!keep) removeFixtures();
  else console.log(`fixtures kept in ${base}`);
  return failures === 0 ? 0 : 1;
}

process.exitCode = await main();
