import { execFileSync, spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

const label = process.argv[2] ?? "modules";
const files = execFileSync("git", ["ls-files", "*.test.js", "*.test.mjs"], { encoding: "utf8" }).trim().split("\n").sort();
await mkdir(".reference-cache/g0/suite", { recursive: true });
const rows = [];
for (const file of files) {
  const started = Date.now();
  let tap = "";
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, ["--test", "--test-reporter=tap", file], { stdio: ["ignore", "pipe", "inherit"] });
    child.stdout.on("data", (d) => (tap += d));
    child.on("exit", resolve);
  });
  const n = (k) => Number(new RegExp(`^# ${k} (\\d+)`, "m").exec(tap)?.[1] ?? NaN);
  const row = { file, wallSeconds: (Date.now() - started) / 1000, exitCode: code, tests: n("tests"), pass: n("pass"), fail: n("fail"), skipped: n("skipped") };
  rows.push(row);
  console.log(JSON.stringify(row));
}
rows.sort((a, b) => b.wallSeconds - a.wallSeconds);
const total = rows.reduce((s, r) => s + r.wallSeconds, 0);
const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
await writeFile(
  `.reference-cache/g0/suite/${label}.json`,
  JSON.stringify({ label, node: process.version, modules: rows.length, sequentialWallSeconds: total, tests: sum("tests"), pass: sum("pass"), fail: sum("fail"), skipped: sum("skipped"), finishedAt: new Date().toISOString(), rows }, null, 2) + "\n",
);
console.log(JSON.stringify({ modules: rows.length, sequentialWallSeconds: total, tests: sum("tests"), pass: sum("pass"), fail: sum("fail"), skipped: sum("skipped") }));
