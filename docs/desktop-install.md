# Desktop installation and updates

The Windows installer follows Scope's source-install model, frozen at Scope commit `20d068f`. A per-user installer owns its own clone and builds a pinned branch commit on the person's computer. The person's project data stays outside the installation. A finished build is staged and waits until the person restarts. The app, the `irudd` CLI and the MCP server always run the same active build.

## Layout

| Path under `%LOCALAPPDATA%\irudd-game-tools` | What it holds |
| --- | --- |
| `source\` | The installer's shallow clone. Each build checks out one commit, detached, and installs from the frozen lockfile. |
| `builds\<commit>\Irudd Workshop\` | One packaged app per built commit: the pinned Electron runtime as `Irudd Workshop.exe`, with `resources\app` (see below) |
| `installation.json` | Which builds are `current`, `previous` and `prepared`. Activation moves `current` to `previous`; rollback swaps the two. The launchers read this file. |
| `current`, `previous`, `prepared` | Junctions that mirror `installation.json`, for people and tools browsing the folder |
| `Irudd Workshop.exe` | Native launcher. Start menu shortcuts point here. `--player` opens the offline player. |
| `bin\irudd.exe` | Native CLI launcher, placed on the user PATH. `irudd host` and `irudd mcp` select the headless host and the stdio MCP server. |

`resources\app` contains `dist\` (window, preload, review worker, forms, assets, licence notices and `build.json`), `dist\clients\{irudd,irudd-mcp,irudd-host}.mjs` and `dist\update\activate.mjs`. It also contains `player\player.html`, `install.ps1`, the launchers, `integration.ps1` and the generated `package.json`. That `package.json` records the root, commit, branch, origin and the Vite+ executable that built it. The clients run under the build's own executable with `ELECTRON_RUN_AS_NODE`, so the installed app needs no Node.js, pnpm, Python or test loader. They read the same `build.json` as the window. That is why `irudd version`, the MCP server's `serverInfo.version` and the window report the same build.

Settings live in `%APPDATA%\Irudd Workshop`. Host and pairing state live in `%LOCALAPPDATA%\irudd\workshop`, or `IRUDD_STATE_DIR` if it is set. Projects live in the folders the person chooses. None of them is under the installation root.

## Install and update

`install.ps1` requires Windows 11 x64 and Git. When `vp.exe` is missing, it bootstraps the Vite+ version pinned in `pnpm-workspace.yaml`, as Scope does. It holds `.install-lock` open with delete-on-close, so a killed build releases the lock. On every start it deletes leftover `builds\.preparing.*` and `builds\.removing.*` directories. Each install or update runs these steps:

1. Fetch the branch head, or the commit passed with `-Prepare`.
2. Run a forced detached checkout, then `vp install --frozen-lockfile` and `install-electron`.
3. Run `apps/desktop/scripts/package.ts` into `builds\.preparing.<id>`. It builds the player and the desktop app and bundles the four Node entries. It runs `node tools/static/bundles.ts --packaged`, then assembles the app. It compiles the launchers with the inbox .NET Framework `csc.exe` and rejects any file outside the allowed output types. Finally it smoke-tests the packaged CLI, MCP server, host and SQLite.
4. Rename the finished build into `builds\<commit>`.
5. Record the build as `prepared`, using the build's own `activate.mjs`. With `-Prepare`, the script stops here.
6. Activate the build with the same activator. Then write the Start menu shortcuts, add `bin` to the PATH and open the app.

The app checks its branch when its window loads. It runs `install.ps1 -Prepare <commit>` through the one process adapter in `apps/desktop/src/main/update/process.ts`. That adapter starts only four programs: `git ls-remote`, the installed `install.ps1`, a build's own `activate.mjs` and the root launcher. Cancel kills the build's process tree with `taskkill /T /F`. **Restart to update** runs the prepared build's own activator, so the version being started switches itself. It then asks the launcher to wait for this process to exit. The launcher then reopens the app on the same project with the same settings switches. **Previous version** swaps `current` and `previous` and reopens the app the same way. Old builds are pruned when no role names them and no process holds them.

## Switching builds safely

A switch can be killed at any moment: by a crash, a power cut, Task Manager or a closed terminal. The design keeps the installation usable through all of them:

- **One owner at a time.** Each switch, rollback, prepare or prune holds a named pipe, `\\.\pipe\irudd-workshop-activation-<hash of the root>`, that only one process can serve. Windows closes it when that process exits, killed or not, so a dead owner never leaves the installation locked and nobody has to delete a lock. A second step waits up to 10 seconds and then reports "Another update step is running". Pruning at startup skips instead of waiting.
- **One commit point.** `installation.json` is written to a temporary file, flushed and renamed over the old one. That rename is the switch. The launchers read the file with delete sharing, so the rename never waits for a launch, and a launch always sees the old or the new build, never a mixture.
- **Everything else follows.** After the commit, the launchers and the junctions are brought in line. A launcher that is running, such as an agent's `irudd mcp`, cannot be replaced on Windows. It keeps working because it reads the same file, and a later step replaces it once it exits.
- **The next step finishes the last one.** Every locked step first completes what a killed one left. It re-points the junctions from `installation.json`, places missing or outdated launchers, and removes the temporary `.current-<uuid>` junctions and unfinished `.installation-*.tmp` files. It never touches a build that a role names, a build in use or a project. The app does this when it opens. `activate.mjs repair <root>` does it on its own.
- **Preview installations.** The first preview had only junctions and an ownerless `.activation-lock` directory. The first step of this version writes `installation.json` from the junctions. If that preview was killed between its two renames of `current`, the new `.current-<uuid>` junction names the intended build. A preview lock directory is waited for, and removed only once it is 30 seconds old, because its steps took milliseconds. When rolling back into that preview, the modern updater prepares all three junctions before removing the state file. A subsequent switch inside the preview then becomes the selection that a modern build imports on startup. Preview launchers read only the `current` junction, so a broken preview installation is repaired by running `install.ps1` once.

Kill controls for tests: with `IRUDD_ACTIVATION_PAUSE=<step>`, `activate.mjs` writes `<root>\.paused-<step>` at that step and waits there until `<root>\.paused-<step>.continue` appears or the process is killed. The steps are `locked`, `committed`, `launcher-<file>`, `mirror-aside-<role>`, `converged` and `pruning`. Nothing sets the variable outside the recovery tests and the rehearsal.

The packaged desktop uses Electron's documented manual distribution layout instead of `@electron/packager`, so the lockfile gains no packaging dependency. The executable keeps Electron's version resource. The launchers, shortcuts and window carry the project icon.

## Checks and when to run them

| Check | Catches | Time | When |
| --- | --- | --- | --- |
| `pnpm --filter @irudd/desktop test` | Switching, rollback, refused foreign launchers or builds, pruning | 1.9 s, of which the three update tests take 0.3 s | Edit loop (part of `pnpm test:port`) |
| `pnpm --filter @irudd/desktop test:recovery` | Real `taskkill /F` of the activator at each step of a switch, two interrupted steps in a row, a live lock owner, the preview's stale lock and half-switched junctions, and launches of the real compiled launcher racing 12 switches while another launcher runs | about 17 s | Before changing activation, the launchers or the lock |
| `pnpm --filter @irudd/desktop package -- --out <dir>` | Missing outputs, disallowed bundle inputs, unexpected files, a packaged CLI or MCP server that cannot start, SQLite | about 2 s with `--skip-build`, plus the desktop and player builds | Before handing a package to anyone |
| `pnpm --filter @irudd/desktop rehearse` | The whole installer and update path against a disposable local origin (below) | see [measured runs](#measured-rehearsal) | Before changing `install.ps1`, launchers, packaging or the updater, and before a release |

The rehearsal writes everything under one TEMP folder: origin, install root, Start menu folder, user data, host state and projects. It never touches the person's Start menu, PATH, settings or running app, and it checks the first two before and after. With `--overlay <path>`, uncommitted files under those paths become commit A, so a change can be rehearsed before it is committed. GPU steps hold `Local\ShapeFirstWorkshopBrowser`.

Its steps are:

1. Fresh install of A, then an inventory of the installed files and the Start menu shortcuts.
2. Open A through the root launcher on a new project. Pair an agent with the CLI, then check that the window, `irudd version` and a new MCP server all report A.
3. Offline start, with the origin and network gone. The update check fails visibly, and a GPU GLB export still works.
4. Stage B in the background while the window and the CLI keep working.
5. Restart into B on the same explicit project. The document is unchanged and all three clients report B.
6. A commit that does not build fails, and B stays active with nothing left behind.
7. A canceled build leaves B active and no staging folder.
8. A retry stages D.
9. Roll back to A on the same project.
10. Restart into D.
11. Kill D's own packaged activator during a rollback, between its two renames of the `current` junction. The person's launcher still opens the committed version, A, on the same project, and the app completes the junctions.
12. Hold the lock with a live activator. The window's rollback waits, reports the busy installation and changes nothing. After that owner is killed, the normal **Check for updates** and **Restart to update** bring the app to D.

Not rehearsed: clicking the real Start menu shortcuts, because they would open the app with the person's own settings, and opening `player.html` in the person's default browser. The rehearsal checks the shortcut targets and the player's lack of network references instead.

## Measured rehearsal

One full passing run of the committed source, 26 November 2026, on the development PC (Windows 11 x64). The command was `pnpm --filter @irudd/desktop rehearse -- --keep` with no `--overlay`, so A is commit `fd3d839` exactly as committed, and B, C and D are commits the rehearsal adds on top.

Run conditions:

- Nothing else from the rehearsal's TEMP folder was running.
- The pnpm store and the Electron download cache were already warm. A first install on a new computer also downloads them, which these times do not include.
- The shared GPU lock was free, so the offline export did not wait. Earlier runs spent 180 to 316 s waiting for it.

| Step | Time |
| --- | --- |
| Install A into an empty root (clone, frozen install, build, package, `check:bundles --packaged`, activate) | 31.0 s |
| Inventory of the installed files (84 files, allowlist only) | 0.1 s |
| Open A through the launcher on a new project and pair an agent | 1.9 s |
| Window, `irudd version` and a new MCP server agree on A | 0.5 s |
| Offline start and GPU GLB export (4,437,376 bytes) | 6.9 s |
| Stage B in the background (warm build) | 6.3 s |
| Restart into B through B's own activator, same project, same revision and digest | 2.9 s |
| A commit that does not build fails, B stays | 4.2 s |
| Cancel during the dependency install, nothing left behind | 1.4 s |
| Retry stages D | 6.1 s |
| Roll back to A, same project and document | 1.8 s |
| Restart into D | 3.0 s |
| Kill D's activator between the junction renames of a rollback; the launcher opens A and the app repairs the junctions | 2.2 s (open and repair 1.6 s) |
| A live activator holds the lock: the window's rollback waits 10 s and reports it; after the kill, Check and Restart reach D | 13.5 s |

The steps took 85 s in total. `pnpm --filter @irudd/desktop test:recovery` passed separately in 12 to 17 s. After each of its seven kills, the next step repaired the installation in 3 to 49 ms, and 28 to 44 launches during 12 switches all started a whole build.

### Limitations

- Each kill happens at a named step, a paused activator stopped with `taskkill /F`. A power cut can also stop a process inside a single file-system call. NTFS keeps each rename atomic, and `installation.json` is flushed before it is renamed. A torn write of a junction or a launcher copy is not rehearsed.
- The launchers find the current build through `installation.json` alone. A preview installation's launchers read only the `current` junction until `install.ps1` or an update replaces them.
- A running launcher stays at its old version until a later step finds it idle. It reads the same file, so it starts the right build.
- A step that waits for a live owner gives up after 10 seconds, and the window then shows the busy message. The person retries. Startup pruning skips instead of waiting.
- Old versions of this code, from the first preview, take only the directory lock and not the named pipe. They are not serialized against new versions. Their own steps took milliseconds.
- The rehearsal does not click the real Start menu shortcuts or open `player.html` in the person's browser, as described above.

## Artwork

The app icon (`apps/desktop/installer/icon.ico`), a four-armed figure on the workshop's colours, was drawn for this project and is MIT-licensed with the repository.
