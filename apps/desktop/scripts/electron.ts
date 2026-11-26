// Locate the pinned Electron executable and start the built app with a clean
// environment. Shared by the launcher and the verification run.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const appDir = fileURLToPath(new URL("../", import.meta.url));

/** The Electron executable `pnpm exec install-electron` placed in node_modules. */
export function electronExecutable(): string {
  const pkg = join(appDir, "node_modules", "electron");
  const name = readFileSync(join(pkg, "path.txt"), "utf8").trim();
  return join(pkg, "dist", name);
}

/**
 * The environment for the desktop executable. An Electron-based host (an
 * editor or agent shell) may export ELECTRON_RUN_AS_NODE, which would make
 * the app start as plain Node; the launcher always clears it.
 */
export function appEnvironment(
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...process.env, ...extra }))
    if (
      value !== undefined &&
      key !== "ELECTRON_RUN_AS_NODE" &&
      key !== "ELECTRON_NO_ATTACH_CONSOLE"
    )
      env[key] = value;
  return env;
}
