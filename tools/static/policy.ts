import { builtinModules } from "node:module";

export interface ProgramPolicy {
  readonly tsconfig: string;
  readonly lib: RegExp;
  readonly entries?: readonly string[];
  readonly types: readonly string[];
  readonly ambient: "none" | "node" | "dom" | "node+dom";
  readonly skipLibCheck?: Exemption & { readonly allowedDiagnostic?: RegExp };
  readonly javascript?: Exemption & { readonly files: readonly string[] };
}

export interface Exemption {
  readonly reason: string;
  readonly owner: string;
  readonly removal: string;
}

export interface ProjectPolicy {
  readonly dir: string;
  readonly name?: string;
  readonly role: string;
  readonly bundledMain?: { readonly output: string; readonly source: string };
  readonly status: "required" | "planned";
  readonly programs: readonly ProgramPolicy[];
  readonly dependencies: readonly string[];
  readonly devDependencies: readonly string[];
  readonly entries?: readonly string[];
}

const esOnly = /^(?!.*\.full$)es(5|20\d\d|next)(\.[a-z0-9]+)*$/i;
const esAndDom =
  /^((?!.*\.full$)es(5|20\d\d|next)(\.[a-z0-9]+)*|dom(\.iterable|\.asynciterable)?)$/i;

export const overridableBaseOptions: readonly string[] = [
  "lib",
  "types",
  "skipLibCheck",
  "allowImportingTsExtensions",
];

export const strictFamily: readonly string[] = [
  "noImplicitAny",
  "noImplicitThis",
  "strictNullChecks",
  "strictFunctionTypes",
  "strictBindCallApply",
  "strictPropertyInitialization",
  "strictBuiltinIteratorReturn",
  "useUnknownInCatchVariables",
  "alwaysStrict",
];

export const forbiddenOptions: readonly string[] = [
  "noCheck",
  "skipDefaultLibCheck",
  "noLib",
  "noResolve",
  "incremental",
  "composite",
  "tsBuildInfoFile",
  "allowUmdGlobalAccess",
  "typeRoots",
  "customConditions",
  "paths",
  "baseUrl",
  "rootDirs",
];

const testProgram: ProgramPolicy = {
  tsconfig: "test/tsconfig.json",
  lib: esOnly,
  types: ["node"],
  ambient: "node",
};

const electronTypes = {
  owner: "desktop",
  reason: "Electron 46 alpha names four browser types in its shared electron.d.ts.",
  removal:
    "Remove when Electron supplies main/preload declarations that compile with Node types alone.",
  allowedDiagnostic:
    /(?:^|\/)node_modules\/electron\/electron\.d\.ts\(\d+,\d+\): error TS2304: Cannot find name '(?:VideoFrame|HTMLElement|HTMLElementEventMap|EventListenerOrEventListenerObject)'\.$/,
};

export const projects: readonly ProjectPolicy[] = [
  {
    dir: "packages/document",
    name: "@irudd/document",
    role: "document",
    status: "required",
    programs: [
      {
        tsconfig: "tsconfig.json",
        lib: esOnly,
        types: [],
        ambient: "none",
        skipLibCheck: {
          reason:
            "effect 4.1.5 declarations name Web APIs (AbortSignal, URL, ReadableStream, Blob, TextDecoder) that an ES-only lib does not declare. First-party sources stay fully checked and no ambient shim is added.",
          owner: "document (G1)",
          removal: "Remove when effect's declarations check under lib es2024 with types [].",
        },
      },
      testProgram,
    ],
    dependencies: ["effect"],
    devDependencies: ["@types/node"],
  },
  {
    dir: "verification/protocol",
    name: "@irudd/verification-protocol",
    role: "verification",
    status: "required",
    programs: [
      { tsconfig: "tsconfig.json", lib: esOnly, types: ["node"], ambient: "node" },
      testProgram,
    ],
    dependencies: ["@irudd/document"],
    devDependencies: ["@types/node"],
    entries: ["src/gate.ts"],
  },
  {
    dir: "verification/families",
    name: "@irudd/verification-families",
    role: "verification",
    status: "planned",
    programs: [
      { tsconfig: "tsconfig.json", lib: esAndDom, types: ["node"], ambient: "node+dom" },
      { ...testProgram, lib: esAndDom, ambient: "node+dom" },
    ],
    dependencies: ["@irudd/character", "@irudd/document", "three"],
    devDependencies: ["@types/node", "@types/three"],
    entries: ["src/prepare.ts", "src/inspect.ts"],
  },
  {
    dir: "tools/static",
    role: "tooling",
    status: "required",
    programs: [{ tsconfig: "tsconfig.json", lib: esOnly, types: ["node"], ambient: "node" }],
    dependencies: [],
    devDependencies: [],
    entries: ["check.ts", "fixtures.ts"],
  },
  {
    dir: "packages/character",
    name: "@irudd/character",
    role: "character",
    status: "planned",
    programs: [
      { tsconfig: "tsconfig.json", lib: esAndDom, types: [], ambient: "dom" },
      { ...testProgram, lib: esAndDom, ambient: "node+dom" },
    ],
    dependencies: ["@irudd/document", "effect", "meshoptimizer", "three"],
    devDependencies: ["@types/node", "@types/three"],
  },
  {
    dir: "packages/player",
    name: "@irudd/player",
    role: "player",
    status: "planned",
    programs: [
      { tsconfig: "tsconfig.json", lib: esAndDom, types: [], ambient: "dom" },
      testProgram,
    ],
    dependencies: ["three"],
    devDependencies: ["@types/node", "@types/three"],
  },
  {
    dir: "packages/workshop",
    name: "@irudd/workshop",
    role: "workshop",
    status: "planned",
    programs: [
      { tsconfig: "tsconfig.json", lib: esOnly, types: ["node"], ambient: "node" },
      testProgram,
    ],
    dependencies: ["@irudd/document", "effect", "@effect/sql-sqlite-node"],
    devDependencies: ["@types/node"],
  },
  {
    dir: "apps/desktop",
    name: "@irudd/desktop",
    role: "desktop",
    status: "planned",
    bundledMain: { output: "dist/main/main.js", source: "src/main/main.ts" },
    programs: [
      {
        tsconfig: "tsconfig.main.json",
        skipLibCheck: electronTypes,
        entries: ["src/main/main.ts", "src/main/headless.ts"],
        lib: esOnly,
        types: ["node"],
        ambient: "node",
      },
      {
        tsconfig: "tsconfig.preload.json",
        skipLibCheck: electronTypes,
        entries: ["src/preload/preload.ts"],
        lib: esOnly,
        types: ["node"],
        ambient: "node",
      },
      {
        tsconfig: "tsconfig.renderer.json",
        entries: ["src/renderer/main.ts"],
        lib: esAndDom,
        types: [],
        ambient: "dom",
      },
      { tsconfig: "scripts/tsconfig.json", lib: esAndDom, types: ["node"], ambient: "node+dom" },
      { tsconfig: "qa/tsconfig.json", lib: esAndDom, types: ["node"], ambient: "node+dom" },
    ],
    dependencies: [
      "@irudd/document",
      "@irudd/workshop",
      "@irudd/character",
      "@irudd/player",
      "effect",
      "electron",
      "three",
    ],
    devDependencies: ["@types/node", "@types/three", "@playwright/test", "vite-plus"],
  },
  {
    dir: "apps/cli",
    name: "@irudd/cli",
    role: "client",
    status: "planned",
    programs: [
      { tsconfig: "tsconfig.json", lib: esOnly, types: ["node"], ambient: "node" },
      testProgram,
    ],
    dependencies: ["@irudd/document", "@irudd/workshop", "effect"],
    devDependencies: ["@types/node"],
  },
  {
    dir: "apps/mcp",
    name: "@irudd/mcp",
    role: "client",
    status: "planned",
    programs: [
      { tsconfig: "tsconfig.json", lib: esOnly, types: ["node"], ambient: "node" },
      testProgram,
    ],
    dependencies: [
      "@irudd/document",
      "@irudd/workshop",
      "effect",
      "@modelcontextprotocol/sdk",
      "zod",
    ],
    devDependencies: ["@types/node"],
  },
  {
    dir: "apps/player",
    name: "@irudd/web-player",
    role: "web-player",
    status: "planned",
    entries: ["src/main.ts"],
    programs: [
      { tsconfig: "tsconfig.json", lib: esAndDom, types: [], ambient: "dom" },
      { tsconfig: "scripts/tsconfig.json", lib: esAndDom, types: ["node"], ambient: "node+dom" },
    ],
    dependencies: ["@irudd/player", "three"],
    devDependencies: ["@types/node", "@types/three", "vite-plus"],
  },
];

export const privilegedAdapters: readonly { readonly path: string; readonly reason: string }[] = [
  {
    path: "^apps/desktop/scripts/(launch|qa|qa-player|qa-review|package|rehearse)\\.ts$",
    reason: "Build, launch and verify the desktop distribution and its installer.",
  },
  { path: "^tools/", reason: "Local tooling starts compilers and linters." },
  { path: "^verification/", reason: "Gates start local processes." },
  { path: "^apps/desktop/src/main/update/", reason: "Stage and activate managed source updates." },
  {
    path: "^apps/cli/src/agents\\.ts$",
    reason: "Register the MCP server through the claude and codex command-line tools.",
  },
];

export const bundledStyles: ReadonlyMap<string, readonly string[]> = new Map([
  ["packages/player/src/player.css", ["renderer", "player"]],
]);

export const bundleProbes = [
  {
    name: "main",
    output: "apps/desktop/dist/main/main.js",
    entry: "apps/desktop/src/main/main.ts",
    allowedSource:
      /^(apps\/desktop\/src\/(main|shared)|packages\/(document|workshop|hosts|character|player)\/src)\//,
  },
  {
    name: "preload",
    output: "apps/desktop/dist/preload/preload.cjs",
    entry: "apps/desktop/src/preload/preload.ts",
    allowedSource: /^apps\/desktop\/src\/(preload|shared)\//,
  },
  {
    name: "renderer",
    output: "apps/desktop/dist/renderer/index.html",
    entry: "apps/desktop/src/renderer/main.ts",
    allowedSource:
      /^(apps\/desktop\/src\/(renderer|shared)|packages\/(document|character|player)\/src)\//,
  },
  {
    name: "player",
    output: "apps/player/dist/player.html",
    entry: "apps/player/src/main.ts",
    allowedSource: /^(apps\/player\/(src\/|index\.html$)|packages\/player\/src\/)/,
  },
] as const;

export const packagedBundleProbes = [
  {
    name: "irudd",
    output: "apps/desktop/dist/clients/irudd.mjs",
    entry: "apps/cli/src/main.ts",
    allowedSource:
      /^(apps\/cli\/src|packages\/document\/src|packages\/workshop\/src\/(client|contract|wire))\//,
  },
  {
    name: "irudd-mcp",
    output: "apps/desktop/dist/clients/irudd-mcp.mjs",
    entry: "apps/mcp/src/main.ts",
    allowedSource:
      /^(apps\/mcp\/src|packages\/document\/src|packages\/workshop\/src\/(client|contract|wire))\//,
  },
  {
    name: "irudd-host",
    output: "apps/desktop/dist/clients/irudd-host.mjs",
    entry: "apps/desktop/src/main/headless.ts",
    allowedSource:
      /^(?:packages\/(?:document|workshop|hosts)\/src\/|packages\/character\/src\/(?:human\/|creature\/(?:generator|index|draw|body|forms)\.ts$|library\/anchors\.ts$|random\.ts$|(?:assets|paint\/(?:repaint|art-fit|panel|trace-build|trace))\.ts$)|apps\/desktop\/src\/main\/(?:headless|human|art)\.ts$)/,
  },
  {
    name: "activate",
    output: "apps/desktop/dist/update/activate.mjs",
    entry: "apps/desktop/src/main/update/activate.ts",
    allowedSource: /^apps\/desktop\/src\/main\/update\//,
  },
] as const;

const nodeBuiltins = [
  ...new Set(builtinModules.map((name) => name.replace(/^node:/, "").replace(/\/.*$/, ""))),
].sort();
const builtin = `^(node:)?(${nodeBuiltins.join("|")})(/|$)`;
const privileged =
  "^(node:)?(child_process|cluster|worker_threads|vm|inspector|v8|repl|module)(/|$)";
const packageLayouts = (name: string): string[] => [
  `(^|/)node_modules/\\.pnpm/[^/]+/node_modules/${name}/`,
  `(^|/)node_modules/${name}/`,
];
const pkg = (name: string): string => packageLayouts(name).join("|");
const electron = `^electron$|${pkg("electron")}`;
const effectCore = packageLayouts("effect")
  .map((layout) => `${layout}dist/[A-Za-z0-9]+\\.js$`)
  .join("|");
const platformModules = [
  builtin,
  electron,
  pkg("three"),
  pkg("@effect/sql-sqlite-node"),
  "^packages/(workshop|hosts)/",
  "^apps/",
];
const desktopModules = [builtin, electron, "^apps/desktop/", "^packages/(workshop|hosts)/"];

export interface GraphRule {
  readonly name: string;
  readonly severity: "error";
  readonly comment: string;
  readonly from: Record<string, unknown>;
  readonly to: Record<string, unknown>;
}

export const graphRules: readonly GraphRule[] = [
  {
    name: "not-to-unresolvable",
    severity: "error",
    comment: "Every literal import, re-export and dynamic import must resolve to a real module.",
    from: {},
    to: { couldNotResolve: true },
  },
  {
    name: "not-to-undeclared-package",
    severity: "error",
    comment: "Import only packages declared in the importing package's manifest (strict pnpm).",
    from: {},
    to: { dependencyTypes: ["npm-no-pkg", "npm-unknown"] },
  },
  {
    name: "no-circular",
    severity: "error",
    comment: "Port modules form an acyclic graph.",
    from: { path: "^(packages|apps|tools)/" },
    to: { circular: true },
  },
  {
    name: "port-modules-are-typescript",
    severity: "error",
    comment:
      "Port modules reach no first-party JavaScript, which tsc does not check; list a transitional file in a program's javascript exemption.",
    from: { path: "^(packages|apps|tools|verification)/" },
    to: { path: "\\.[cm]?jsx?$", pathNot: ["(^|/)node_modules/", ...transitionalJavaScript()] },
  },
  {
    name: "packages-not-to-apps",
    severity: "error",
    comment: "Dependencies point from apps to packages, never back.",
    from: { path: "^packages/" },
    to: { path: "^apps/" },
  },
  {
    name: "document-only-effect",
    severity: "error",
    comment:
      "Document logic imports its own modules and effect's core modules only: no effect host families, Node, DOM, Electron, SQLite or Three.",
    from: { path: "^packages/document/src/" },
    to: { pathNot: ["^packages/document/src/", effectCore] },
  },
  {
    name: "document-reaches-no-platform",
    severity: "error",
    comment: "No path from document logic reaches a platform module, including through barrels.",
    from: { path: "^packages/document/src/" },
    to: { path: platformModules, reachable: true },
  },
  {
    name: "player-reaches-no-desktop",
    severity: "error",
    comment: "The offline player never reaches desktop, storage, host or Node modules.",
    from: { path: "^(apps/player|packages/player)/" },
    to: { path: desktopModules, reachable: true },
  },
  {
    name: "client-reaches-no-storage-writer",
    severity: "error",
    comment: "CLI and MCP clients talk to the service; they never reach the storage writer.",
    from: { path: "^apps/(cli|mcp)/" },
    to: { path: "^packages/workshop/src/storage/", reachable: true },
  },
  {
    name: "revision-writes-through-service",
    severity: "error",
    comment: "Only the project service imports the storage writer.",
    from: { path: "^packages/", pathNot: "^packages/workshop/src/(service|storage)/" },
    to: { path: "^packages/workshop/src/storage/" },
  },
  {
    name: "electron-only-in-desktop",
    severity: "error",
    comment: "Electron is imported by the desktop app only.",
    from: { pathNot: "^apps/desktop/" },
    to: { path: electron },
  },
  {
    name: "privileged-apis-in-named-adapters",
    severity: "error",
    comment: "Process, worker and VM APIs are confined to named adapters.",
    from: { pathNot: privilegedAdapters.map((adapter) => adapter.path) },
    to: { path: privileged },
  },
];

function transitionalJavaScript(): string[] {
  return projects.flatMap((project) =>
    project.programs.flatMap((program) =>
      (program.javascript?.files ?? []).map(
        (file) => `^${`${project.dir}/${file}`.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
      ),
    ),
  );
}
