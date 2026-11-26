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
