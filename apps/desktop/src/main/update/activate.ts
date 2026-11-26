// The installer's link step, shipped in each build as dist/update/activate.mjs
// and run with the build's own executable as Node, by install.ps1 and by the
// app when the person restarts into an update:
//
//   "Irudd Workshop.exe" activate.mjs prepare|activate <root> <build>
//   "Irudd Workshop.exe" activate.mjs rollback|repair <root>
//
// `repair` only completes what a killed operation left; every other mode
// does that first as well.
//
// Kill control for the installer rehearsal and tests: with
// IRUDD_ACTIVATION_PAUSE=<step>[,<step>...] the activator writes
// <root>\.paused-<step> when it reaches that step and waits until
// <root>\.paused-<step>.continue appears, or until it is killed there.

import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { activate, prepare, prune, repair, rollback, type Observe } from "./installation.js";

function pauses(root: string): Observe | undefined {
  const steps = new Set(
    (process.env["IRUDD_ACTIVATION_PAUSE"] ?? "")
      .split(",")
      .map((step) => step.trim())
      .filter(Boolean),
  );
  if (steps.size === 0) return undefined;
  return async (step) => {
    if (!steps.has(step)) return;
    const marker = path.join(root, `.paused-${step}`);
    writeFileSync(marker, `${process.pid}\n`);
    while (!existsSync(`${marker}.continue`)) await sleep(25);
  };
}

const [mode, root, build] = process.argv.slice(2);
try {
  if (!root) throw new Error("Give the installation root.");
  const observe = pauses(root);
  const options = observe ? { observe } : {};
  if (mode === "prepare" && build) await prepare(root, build, options);
  else if (mode === "activate" && build) {
    await activate(root, build, options);
    await prune(root, [], options);
  } else if (mode === "rollback") process.stdout.write(`${await rollback(root, options)}\n`);
  else if (mode === "repair") await repair(root, options);
  else
    throw new Error("Usage: activate.mjs prepare|activate <root> <build> | rollback|repair <root>");
} catch (error) {
  const causes: unknown[] = error instanceof AggregateError ? error.errors : [];
  for (const failure of [error, ...causes])
    process.stderr.write(`${failure instanceof Error ? failure.message : String(failure)}\n`);
  process.exitCode = 1;
}
