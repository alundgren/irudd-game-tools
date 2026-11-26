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
