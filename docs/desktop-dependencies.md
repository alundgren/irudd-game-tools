# Desktop port dependency baseline

Selection date: 2026-11-25. These are proposed exact pins for the desktop port. The existing web workshop stays at the workspace root, where its `three` and `esbuild` pins come from the same catalog. Use the exact Electron prerelease below for the first build. Record any later pin change as a deliberate dependency update. Record the selection in the pnpm catalog and commit the frozen lockfile, including transitives.

| Component | Intended pin | Scope |
| --- | --- | --- |
| Node.js (build tools) | 26.13.1 LTS | Pin the managed build runtime used by local and installed builds. |
| pnpm | 12.23.0 | Workspace install with a frozen lockfile. |
| Vite+ CLI and workspace package | 1.8.0 | Bootstrap the matching CLI. Use the Vite engine alias selected by Vite+ (`@voidzero-dev/vite-plus-core@8.3.8001`). |
| Oxlint / Oxfmt | 1.94.0 / 0.79.0 | Exact versions supplied by Vite+ 1.8.0. Use the workspace CLI for lint and read-only format checks. |
| oxlint-tsgolint | 7.0.2007 | Backend for Oxlint's type-aware rules (`no-unsafe-*`). It embeds its own TypeScript 7.0 build for lint types only; `tsc` remains the type checker. |
| dependency-cruiser | 18.9.0 | Resolve and check the transitive import graph from production entries. Inspect emitted bundle inputs and externals at build time. |
| @swc/core | 1.16.22 | Parser for dependency-cruiser. TypeScript 7.0.2 has no compiler API that dependency-cruiser 18.9 accepts (it needs <7 or ≥7.1). Drop it once a TypeScript 7.1 pin is selected. |
| TypeScript | 7.0.2 | Official compiler for strict checks. |
| Electron | 46.0.0-alpha.13 | Desktop main/preload, interactive and review renderers. Bundles Node 26.13.1 and Chromium 160.0.8168.0. |
| @types/node | 26.6.10 | Pin the same declarations for the desktop main process and Node build tools. Electron supplies its own Electron declarations. |
| @electron/packager | 20.3.0 | Assemble the per-user app on the installation machine, following Scope. |
| effect | 4.1.5 | Command validation and cancellable jobs. |
| @effect/sql-sqlite-node | 4.1.5 | Effect SQL adapter for the built-in `node:sqlite`. Electron pins the shipped SQLite engine. Record `SELECT sqlite_version()` in the packaged-app check. |
| three / @types/three | 0.187.0 / 0.187.0 | Rendering, GLB exchange and types. Already the workshop's renderer version. |
| meshoptimizer | 1.1.1 | Typed mesh simplification for Game and Portrait export. Uses the same embedded simplifier as Three r187. |
| @modelcontextprotocol/sdk / zod | 1.32.2 / 4.6.7 | MCP server and its required schema peer. Derive the public tool contract from the document commands. |
| @playwright/test | 1.65.1 | Dev-only desktop/player integration gates. Existing ordinary tests can keep using `node:test`. |
| esbuild | 0.28.2 | Retain the current single-file offline HTML builder during transition. Revisit once Vite+ reproduces the offline artifacts. |

The catalog is in `pnpm-workspace.yaml`, the runtime pin in `.node-version` and the package manager in `packageManager`. `@types/node` 26.6.10 is newer than pnpm's default minimum release age, so `minimumReleaseAgeExclude` lists it. Only esbuild may run an install script; `@swc/core` gets its binary from optional dependencies. [Static rules](../tools/static/RULES.md) describes `pnpm check`.

Vercel UI is an optional experiment. Vite+ brings tsrs and Vitest transitively. The port uses official TypeScript for its compiler gate and can run its ordinary tests with node:test. Python and Blender remain offline asset tools. Agent hosts are external programs and their observed versions belong in the host integration evidence.

## Verify the chosen combination

A local Windows preflight on 2026-11-25 launched Electron 46.0.0-alpha.13 with Node 26.13.1 and Chromium 160.0.8168.0. Its main process wrote, closed and reopened a SQLite 3.54.1 database. A sandboxed renderer created a WebGL 2 context on the RTX 5070 Ti using ANGLE/D3D11. Install the binary with `pnpm exec install-electron`; a launcher running inside an Electron-based agent host must clear inherited `ELECTRON_RUN_AS_NODE` when starting the desktop executable. The pinned Effect SQL adapter also wrote and reopened a database on standalone Node 26.13.1.

Run a frozen install once on the managed build runtime. Package and launch a clean desktop build, open SQLite through the selected adapter, commit and reopen a project, connect an actual MCP client, and render a tracked GLB using Three.js. Record packaged Electron, Chromium, Node and SQLite versions. At 100% and 150% display scale, capture a fixed-size review image and verify its decoded dimensions and all four frame corners. Exercise one staged update and a deliberately failed update before accepting the pins. Published package metadata and engine ranges guided the selection; this combined smoke check belongs to implementation.

Scope's installer and updater are the implementation reference. Freeze its behavior at commit `20d068f` when comparing paths, user prompts, restart, cancellation and recovery. Bootstrap and update may download from the network. After install, ordinary editing, export and playback work offline.

[Scope installation and updates](https://github.com/alundgren/irudd-scope/tree/20d068f) · [Node release index](https://nodejs.org/dist/index.json) · [Electron runtime versions](https://releases.electronjs.org/release/v46.0.0-alpha.13) · [Vite+ manifest](https://registry.npmjs.org/vite-plus/1.8.0) · [Effect SQL adapter](https://registry.npmjs.org/@effect/sql-sqlite-node/4.1.5) · [Three.js manifest](https://registry.npmjs.org/three/0.187.0) · [MCP SDK manifest](https://registry.npmjs.org/@modelcontextprotocol/sdk/1.32.2)
