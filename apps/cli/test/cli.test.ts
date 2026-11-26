// Fast CLI checks that need no host: help, usage errors and the message an
// operator sees when no host owns the project. Writes against a running host
// are covered by the clients gate (apps/mcp/test/clients.gate.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const register = pathToFileURL(path.join(root, "packages/document/test/support/register.ts")).href;
const main = path.join(root, "apps/cli/src/main.ts");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "irudd-cli-"));
const env = { ...process.env, IRUDD_STATE_DIR: path.join(scratch, "state"), IRUDD_PROJECT: "" };

function irudd(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["--import", register, main, ...args],
      { env, cwd: scratch, windowsHide: true },
      (error, stdout, stderr) =>
        resolve({ code: error && typeof error.code === "number" ? error.code : 0, stdout, stderr }),
    );
  });
}

test("help, usage errors and a missing host give an operator the next step", async () => {
  // Concurrent: each run is a cold Node start, and none needs a host.
  const [help, verb, unknown, noProject, badOption, noHost] = await Promise.all([
    irudd("help"),
    irudd("accept", "--help"),
    irudd("frobnicate"),
    irudd("list"),
    irudd("show", "doc-x1234", "--project", scratch, "--nope"),
    irudd("status", "--project", path.join(scratch, "absent")),
  ]);
  assert.equal(help.code, 0, help.stderr);
  for (const name of [
    "status",
    "new",
    "show",
    "changes",
    "edit",
    "preview",
    "accept",
    "reject",
    "pair",
    "receipt",
    "save",
    "open",
  ])
    assert.ok(help.stdout.includes(`\n  ${name} `), `help lists ${name}`);
  assert.match(help.stdout, /--base/);
  assert.equal(verb.code, 0);
  assert.match(verb.stdout, /--request-id <id>/);
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /irudd help/);
  assert.equal(noProject.code, 2);
  assert.match(noProject.stderr, /--project <dir>/);
  assert.equal(badOption.code, 2);
  assert.equal(noHost.code, 3);
  assert.match(noHost.stderr, /No workshop host is running for .*irudd host/);
  fs.rmSync(scratch, { recursive: true, force: true });
});
