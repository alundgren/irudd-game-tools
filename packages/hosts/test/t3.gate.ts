// T3 gate: the real T3 Code adapter against this machine's running T3 server.
//
//   IRUDD_T3_GATE_THREAD=<thread id> [IRUDD_T3_GATE_PROJECT=<T3 project id>] \
//     pnpm --filter @irudd/hosts gate:t3
//
// Read-only: it runs `t3 thread show <thread> --messages 0 --json` through the
// adapter and checks the state it keeps (status, busy, provider, model, project)
// with no message or error text. It never sends. Use only a thread whose owner
// authorized the check; the end-to-end send is the steering canary
// (apps/mcp/test/t3-canary.ts), which needs its own authorization.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findT3Launcher, t3ThreadTransport } from "@irudd/hosts";

const thread = process.env["IRUDD_T3_GATE_THREAD"];
const project = process.env["IRUDD_T3_GATE_PROJECT"];

test(
  "T3 Code reports one authorized thread's state through the adapter",
  {
    skip: thread ? false : "set IRUDD_T3_GATE_THREAD to an authorized thread",
  },
  async () => {
    assert.ok(thread);
    const launcher = findT3Launcher();
    assert.ok(launcher, "T3 Code's t3 launcher is installed");
    const started = Date.now();
    const checked = await t3ThreadTransport().check({
      transport: "t3-thread",
      host: "t3",
      environment: "local",
      ...(project ? { project } : {}),
      conversation: thread,
    });
    const ms = Date.now() - started;
    process.stderr.write(
      `t3 gate: launcher ${launcher.source}; ${String(ms)} ms; ${JSON.stringify(checked)}\n`,
    );
    assert.equal(checked.state, "ready", checked.summary);
    assert.equal(checked.push, true);
    assert.equal(typeof checked.conversation?.status, "string");
    const missing = await t3ThreadTransport().check({
      transport: "t3-thread",
      host: "t3",
      environment: "local",
      conversation: "thread:irudd-gate-no-such-thread",
    });
    assert.notEqual(missing.state, "ready", "an unknown thread is never ready");
  },
);
