import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  codexQueueTransport,
  findT3Launcher,
  t3ThreadTransport,
  type DeliveryRequest,
  type RecipientRoute,
  type T3Launcher,
} from "@irudd/hosts";
import { runProcess } from "../src/process/run.js";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "irudd-hosts-"));
const record = path.join(scratch, "calls.jsonl");

const fakeT3 = path.join(scratch, "bin.mjs");
fs.writeFileSync(
  fakeT3,
  `import fs from "node:fs";
const args = process.argv.slice(2);
let stdin = "";
for await (const chunk of process.stdin) stdin += chunk;
fs.appendFileSync(${JSON.stringify(record)}, JSON.stringify({ args, stdin, env: {
  ELECTRON_RUN_AS_NODE: process.env.ELECTRON_RUN_AS_NODE ?? null,
  T3CODE_HOME: process.env.T3CODE_HOME ?? null,
  SECRET_SHOULD_NOT_PASS: process.env.SECRET_SHOULD_NOT_PASS ?? null } }) + "\\n");
const mode = fs.readFileSync(${JSON.stringify(path.join(scratch, "mode"))}, "utf8").trim();
const [verb, sub, thread] = args;
if (mode === "down") { console.error("No running T3 Code server uses C:\\\\x. Start T3 Code, then retry."); process.exit(1); }
if (mode === "missing") { console.error("Thread " + thread + " not found."); process.exit(1); }
if (mode === "crash") { console.error("Could not reach the T3 Code server at http://127.0.0.1:1. socket hang up"); process.exit(1); }
if (verb === "thread" && sub === "send")
  console.log(JSON.stringify({ threadId: mode === "wrong" ? "thread:other" : thread, messageId: "message:1", runId: "run:1", status: "queued", delivery: "queued" }));
if (verb === "thread" && sub === "show")
  console.log(JSON.stringify({ thread: { threadId: thread, status: "running", activeRunId: "run:0", pendingRequestCount: 0,
    archived: mode === "archived", providerInstanceId: "claudeAgent", model: "claude-opus-5-5", projectId: "proj-1" },
    messages: [], error: "an error text the adapter must drop" }));
`,
);
const mode = (value: string) => fs.writeFileSync(path.join(scratch, "mode"), value);
const launcher: T3Launcher = {
  executable: process.execPath,
  script: fakeT3,
  env: { ELECTRON_RUN_AS_NODE: "1" },
  source: "test",
};
interface Call {
  readonly args: ReadonlyArray<string>;
  readonly stdin: string;
  readonly env: Readonly<Record<string, unknown>>;
}
const isCall = (value: unknown): value is Call =>
  typeof value === "object" &&
  value !== null &&
  Array.isArray(Reflect.get(value, "args")) &&
  typeof Reflect.get(value, "stdin") === "string" &&
  typeof Reflect.get(value, "env") === "object";
const calls = (): Call[] =>
  fs.existsSync(record)
    ? fs
        .readFileSync(record, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line): unknown => JSON.parse(line))
        .filter(isCall)
    : [];

const thread = "thread:delegated-task:command%3Amcp%3Aabc%3Adelegate-task%3A0001";
const route: RecipientRoute = {
  transport: "t3-thread",
  host: "t3",
  environment: "local",
  project: "proj-1",
  conversation: thread,
};
const hostile = 'line one\n"; rm -rf / & echo $(whoami) %PATH% `id`';
const delivery = (r: RecipientRoute = route): DeliveryRequest => ({
  messageId: "stm-0000000000000000000000000a",
  agent: "claude",
  route: r,
  prompt: hostile,
  meta: { message_id: "stm-0000000000000000000000000a" },
});

test("T3: one exact thread, fixed verbs, message on stdin, no shell, allowlisted environment", async () => {
  fs.rmSync(record, { force: true });
  process.env["SECRET_SHOULD_NOT_PASS"] = "leak";
  const t3 = t3ThreadTransport({ launcher, home: scratch });
  mode("ok");
  const sent = await t3.deliver(delivery());
  assert.equal(sent.kind, "accepted", JSON.stringify(sent));
  assert.equal(sent.kind === "accepted" ? sent.receipt.hostMessageId : "", "message:1");
  assert.equal(sent.kind === "accepted" ? sent.receipt.delivery : "", "queued");
  const [call] = calls();
  assert.deepEqual(call?.args, ["thread", "send", thread, "-", "--json"]);
  assert.equal(call?.stdin, hostile, "the message travels on stdin, byte for byte");
  assert.equal(call?.env["ELECTRON_RUN_AS_NODE"], "1");
  assert.equal(call?.env["T3CODE_HOME"], scratch);
  assert.equal(call?.env["SECRET_SHOULD_NOT_PASS"], null, "only allowlisted variables pass");

  const checked = await t3.check(route);
  assert.equal(checked.state, "ready");
  assert.equal(checked.conversation?.busy, true);
  assert.equal(checked.conversation?.model, "claude-opus-5-5");
  assert.doesNotMatch(JSON.stringify(checked), /error text/, "no message or error text is kept");
  assert.deepEqual(calls()[1]?.args, ["thread", "show", thread, "--messages", "0", "--json"]);
});

test("T3: outcomes say whether anything may have been sent", async () => {
  const t3 = t3ThreadTransport({ launcher, home: scratch });
  mode("down");
  assert.equal((await t3.deliver(delivery())).kind, "offline", "server not running: nothing sent");
  mode("missing");
  assert.equal((await t3.deliver(delivery())).kind, "rejected");
  assert.equal((await t3.check(route)).state, "gone");
  mode("crash");
  assert.equal((await t3.deliver(delivery())).kind, "unknown", "mid-call failures are unknown");
  mode("wrong");
  assert.equal((await t3.deliver(delivery())).kind, "unknown", "an answer for another thread");
  mode("archived");
  assert.equal((await t3.check(route)).state, "gone");
  mode("ok");
  assert.equal((await t3.check({ ...route, project: "proj-2" })).state, "gone");
  const before = calls().length;
  assert.equal(
    (await t3.deliver(delivery({ ...route, environment: "env-linked" }))).kind,
    "rejected",
  );
  assert.equal(
    (await t3.deliver(delivery({ ...route, conversation: "thread id with spaces" }))).kind,
    "rejected",
  );
  assert.equal(calls().length, before, "invalid routes never start a process");
  const noT3 = t3ThreadTransport({ home: path.join(scratch, "nowhere") });
  assert.equal((await noT3.deliver(delivery())).kind, "offline");
});

test("T3: the launcher is read from T3's own t3.cmd / t3 script, never run", () => {
  const home = path.join(scratch, "t3home");
  fs.mkdirSync(path.join(home, "bin"), { recursive: true });
  const exe = process.execPath;
  if (process.platform === "win32")
    fs.writeFileSync(
      path.join(home, "bin", "t3.cmd"),
      [
        "@echo off",
        'set "ELECTRON_RUN_AS_NODE=1"',
        'set "T3CODE_DESKTOP_CLI_LAUNCHER=1"',
        `"${exe}" "${fakeT3}" %*`,
        "exit /b %ERRORLEVEL%",
      ].join("\r\n"),
    );
  else
    fs.writeFileSync(
      path.join(home, "bin", "t3"),
      ["#!/bin/sh", "export ELECTRON_RUN_AS_NODE=1", `exec "${exe}" "${fakeT3}" "$@"`].join("\n"),
    );
  const found = findT3Launcher(home);
  assert.equal(found?.executable, exe);
  assert.equal(found?.script, fakeT3);
  assert.equal(found?.env["ELECTRON_RUN_AS_NODE"], "1");
  assert.equal(findT3Launcher(path.join(scratch, "empty")), undefined);

  const asarHome = path.join(scratch, "t3asar");
  fs.mkdirSync(path.join(asarHome, "bin"), { recursive: true });
  const archive = path.join(scratch, "server.asar");
  fs.writeFileSync(archive, "");
  const inside = path.join(archive, "apps", "server", "dist", "bin.mjs");
  const line =
    process.platform === "win32" ? `"${exe}" "${inside}" %*` : `exec "${exe}" "${inside}" "$@"`;
  fs.writeFileSync(
    path.join(asarHome, "bin", process.platform === "win32" ? "t3.cmd" : "t3"),
    line,
  );
  assert.equal(findT3Launcher(asarHome)?.script, inside);
  fs.rmSync(archive);
  assert.equal(findT3Launcher(asarHome), undefined, "a removed app is not found");
});

test("process calls refuse shells, relative programs and NUL bytes before starting anything", async () => {
  const cmd = path.join(scratch, "x.cmd");
  fs.writeFileSync(cmd, "@echo off");
  for (const executable of [cmd, "node", path.join(scratch, "missing.exe")]) {
    const result = await runProcess({ executable, args: [], env: {}, timeoutMs: 1000 });
    assert.equal(result.kind, "not-started", executable);
  }
  const nul = await runProcess({
    executable: process.execPath,
    args: ["a\0b"],
    env: {},
    timeoutMs: 1000,
  });
  assert.equal(nul.kind, "not-started");
  const slow = await runProcess({
    executable: process.execPath,
    args: ["-e", "setTimeout(() => {}, 10000)"],
    env: {},
    timeoutMs: 200,
  });
  assert.equal(slow.kind === "exited" && slow.timedOut, true);
});

test("Codex: a route is ready only for a saved session; malformed routes never start a process", async () => {
  const home = path.join(scratch, "codex");
  const uuid = "019a1234-5678-7abc-8def-0123456789ab";
  fs.mkdirSync(path.join(home, "sessions", "2026", "11", "26"), { recursive: true });
  fs.writeFileSync(path.join(home, "sessions", "2026", "11", "26", `rollout-x-${uuid}.jsonl`), "");
  const codex = codexQueueTransport({ executable: process.execPath, home });
  const codexRoute: RecipientRoute = {
    transport: "codex-queue",
    host: "codex",
    environment: "local",
    conversation: uuid,
  };
  assert.equal((await codex.check(codexRoute)).state, "ready");
  assert.equal(
    (await codex.check({ ...codexRoute, conversation: "019a0000-0000-7000-8000-000000000000" }))
      .state,
    "gone",
  );
  fs.rmSync(record, { force: true });
  assert.equal(
    (await codex.deliver(delivery({ ...codexRoute, conversation: "--resume" }))).kind,
    "rejected",
  );
  assert.equal((await codex.deliver(delivery(route))).kind, "rejected", "a T3 route");
  assert.deepEqual(calls(), [], "nothing ran");
  const missing = codexQueueTransport({ executable: path.join(scratch, "no-codex.exe"), home });
  assert.equal((await missing.deliver(delivery(codexRoute))).kind, "offline");
});
