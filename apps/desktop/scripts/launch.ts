import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { appDir, appEnvironment, electronExecutable } from "./electron.js";

if (!existsSync(join(appDir, "dist", "main", "main.js"))) {
  console.error("Build the app first: pnpm --filter @irudd/desktop build");
  process.exit(1);
}

const child = spawn(
  electronExecutable(),
  [appDir, ...process.argv.slice(2).filter((a) => a !== "--")],
  {
    env: appEnvironment(),
    stdio: "inherit",
    windowsHide: false,
  },
);
child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
