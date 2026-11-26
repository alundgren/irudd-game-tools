import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const [label, ...extra] = process.argv.slice(2);
if (!label) throw new Error("usage: run-suite.mjs LABEL [node --test args...]");
const out = ".reference-cache/g0/suite";
await mkdir(out, { recursive: true });
const tap = `${out}/${label}.tap`;
const args = ["--test", "--test-reporter=tap", `--test-reporter-destination=${tap}`, ...extra];
const started = Date.now();
const code = await new Promise((resolve) => {
  const child = spawn(process.execPath, args, { stdio: ["ignore", "inherit", "inherit"] });
  child.on("exit", (c) => resolve(c));
});
const wallSeconds = (Date.now() - started) / 1000;
const text = await readFile(tap, "utf8");
const summary = Object.fromEntries(
  [...text.matchAll(/^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) (\d+(?:\.\d+)?)$/gm)].map(
    ([, k, v]) => [k, Number(v)],
  ),
);
const notOk = [...text.matchAll(/^\s*not ok \d+ - (.*)$/gm)].map((m) => m[1]);
const skipped = [...text.matchAll(/^\s*ok \d+ - (.*) # SKIP(.*)$/gm)].map((m) => (m[1] + " #" + m[2]).trim());
const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();
const record = {
  label,
  command: ["node", ...args].join(" "),
  commit: git("rev-parse", "HEAD"),
  dirty: git("status", "--porcelain", "--untracked-files=no") !== "",
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  workshopReferences: process.env.WORKSHOP_REFERENCES ?? "(unset)",
  exitCode: code,
  wallSeconds,
  summary,
  notOk,
  skipped,
  finishedAt: new Date().toISOString(),
};
await writeFile(`${out}/${label}.json`, JSON.stringify(record, null, 2) + "\n");
console.log(JSON.stringify({ label, exitCode: code, wallSeconds, ...summary }));
process.exit(code ?? 1);
