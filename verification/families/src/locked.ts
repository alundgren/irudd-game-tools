// Run a Node script under the shared GPU lock on Windows (gpu-lock.ps1), so
// hardware browser jobs from different sessions take turns. Elsewhere the
// script runs directly.
//
//   node --import ../../packages/document/test/support/register.ts src/locked.ts SCRIPT ARGS...

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const [script, ...args] = process.argv.slice(2);
if (!script) throw new Error("Name the script to run under the GPU lock.");
const register = new URL("../../../packages/document/test/support/register.ts", import.meta.url)
  .href;
const node = [process.execPath, "--import", register, script, ...args];
const lock = fileURLToPath(new URL("../gpu-lock.ps1", import.meta.url));
const run =
  process.platform === "win32"
    ? spawnSync("powershell", ["-NoProfile", "-File", lock, ...node], { stdio: "inherit" })
    : spawnSync(node[0] ?? process.execPath, node.slice(1), { stdio: "inherit" });
process.exitCode = run.status ?? 1;
