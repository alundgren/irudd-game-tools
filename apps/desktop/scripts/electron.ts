import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const appDir = fileURLToPath(new URL("../", import.meta.url));

export function electronExecutable(): string {
  const pkg = join(appDir, "node_modules", "electron");
  const name = readFileSync(join(pkg, "path.txt"), "utf8").trim();
  return join(pkg, "dist", name);
}

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
