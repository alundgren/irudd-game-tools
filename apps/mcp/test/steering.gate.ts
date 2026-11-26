// steering gate: a real host process, CLI processes for the person and for a
// paired agent (--credential), and an MCP SDK client driving `irudd mcp
// --channel` over stdio, all against one open project.
//
//   pnpm --filter @irudd/mcp gate:steering
//
// It covers: binding a Claude channel route to the exact MCP server instance,
// a person's manual edit, a steering message pushed to the MCP client as
// `notifications/claude/channel` and confirmed back to the host, the agent's
// inbox, acknowledgement, manual-change cursor, proposal and applied receipt
// over MCP; an inbox-only (Codex) route worked entirely with the agent CLI;
// killing and restarting the host under the live channel; and revocation.
//
// The host runs with --no-push, so it never calls T3 Code or Codex. The SDK
// client stands in for Claude Code: this proves what the irudd side sends,
// not that a Claude Code session displays it (see docs/workshop-steering.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const register = pathToFileURL(path.join(root, "packages/document/test/support/register.ts")).href;
const hostMain = path.join(root, "packages/workshop/src/host/main.ts");
const cliMain = path.join(root, "apps/cli/src/main.ts");
const mcpMain = path.join(root, "apps/mcp/src/main.ts");

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "irudd-steering-"));
const project = path.join(scratch, "project");
const stateDir = path.join(scratch, "state");
const env = { ...process.env, IRUDD_STATE_DIR: stateDir, IRUDD_AGENT_COMMAND: "irudd" };
const stringEnv: Record<string, string> = Object.fromEntries(
  Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
);
const doc = "doc-steer01";

interface Ran {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function cli(...args: string[]): Promise<Ran> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["--import", register, cliMain, ...args, "--project", project],
      { env, windowsHide: true },
      (error, stdout, stderr) => {
        const code = error && typeof error.code === "number" ? error.code : error ? 1 : 0;
        resolve({ code, stdout, stderr });
      },
    );
  });
}

async function cliJson(...args: string[]): Promise<{ code: number; value: unknown }> {
  const ran = await cli(...args, "--json");
  try {
    return { code: ran.code, value: JSON.parse(ran.stdout) };
  } catch {
    assert.fail(
      `irudd ${args.join(" ")} printed no JSON (exit ${ran.code}): ${ran.stdout}${ran.stderr}`,
    );
  }
}

const field = (value: unknown, ...keys: Array<string | number>): unknown =>
  keys.reduce<unknown>(
    (v, k) => (typeof v === "object" && v !== null ? Reflect.get(v, k) : undefined),
    value,
  );

function startHost(create: boolean): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    [
      "--import",
      register,
      hostMain,
      project,
      ...(create ? ["--create", "--label", "Steering gate"] : []),
      "--json",
      "--durability",
      "normal",
      "--no-push",
    ],
    { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  return new Promise((resolve, reject) => {
    let out = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      if (out.includes("\n")) resolve(child);
    });
    child.once("exit", (code) => reject(new Error(`host exited ${String(code)}: ${stderr}`)));
  });
}

function killed(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once("exit", () => resolve());
    child.kill();
  });
}

async function tool(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const content: unknown[] = Array.isArray(result.content) ? result.content : [];
  const body = String(field(content[0], "text"));
  const split = body.indexOf("\n\n");
  const value: unknown = split >= 0 ? JSON.parse(body.slice(split + 2)) : null;
  return {
    isError: result.isError === true,
    summary: split >= 0 ? body.slice(0, split) : body,
    value,
  };
}

async function until<T>(read: () => Promise<T>, done: (v: T) => boolean, what: string): Promise<T> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline)
      assert.fail(`timed out waiting for ${what}: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test(
  "steering through a real host: channel push, inbox, ack, cursor, applied, restart",
  { timeout: 180_000 },
  async () => {
    const timings: Record<string, number> = {};
    const started = Date.now();
    let host = await startHost(true);
    timings["host start"] = Date.now() - started;
    let client: Client | undefined;
    try {
      const claude = await cliJson("pair", "claude", "--name", "Claude");
      const codex = await cliJson("pair", "codex", "--name", "Codex");
      const claudeCredential = String(field(claude.value, "credentialFile"));
      const codexCredential = String(field(codex.value, "credentialFile"));
      assert.equal((await cliJson("new", doc, "--preset", "default")).code, 0);

      // The channel server: an SDK client in place of Claude Code.
      const pushes: Array<{ content: string; meta: Record<string, string> }> = [];
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: ["--import", register, mcpMain, "--credential", claudeCredential, "--channel"],
        env: stringEnv,
        stderr: "pipe",
      });
      client = new Client({ name: "claude-code", version: "gate" });
      client.fallbackNotificationHandler = (notification) => {
        if (notification.method === "notifications/claude/channel") {
          const content = String(field(notification.params, "content"));
          const metaValue = field(notification.params, "meta");
          const meta: Record<string, string> = {};
          if (typeof metaValue === "object" && metaValue !== null)
            for (const [k, v] of Object.entries(metaValue)) meta[k] = String(v);
          pushes.push({ content, meta });
        }
        return Promise.resolve();
      };
      let t = Date.now();
      await client.connect(transport);
      timings["mcp initialize"] = Date.now() - t;
      assert.ok(
        field(client.getServerCapabilities(), "experimental", "claude/channel") !== undefined,
      );
      for (const name of ["read_inbox", "ack_steering", "report_applied"])
        assert.ok(
          (await client.listTools()).tools.some((x) => x.name === name),
          name,
        );

      // The person sees the connected instance and binds exactly that one.
      t = Date.now();
      const seen = await until(
        () => cliJson("recipients"),
        (r) =>
          Array.isArray(field(r.value, 0, "channels")) &&
          field(r.value, 0, "channels", 0) !== undefined,
        "the channel instance",
      );
      timings["channel visible to the person"] = Date.now() - t;
      const instance = String(field(seen.value, 0, "channels", 0, "instance"));
      assert.match(instance, /^chn-[0-9a-f]{24}$/);
      const unproven = await cli(
        "route",
        "claude",
        "--claude-channel",
        "chn-000000000000000000000000",
      );
      assert.equal(unproven.code, 5, unproven.stderr);
      assert.equal((await cliJson("route", "claude", "--claude-channel", instance)).code, 0);

      // The person's manual edit, then a message about it.
      const shown = await cliJson("show", doc);
      const part = String(field(shown.value, "document", "parts", 1, "id"));
      assert.equal((await cliJson("rename", doc, part, "Left foreleg", "--base", "1")).code, 0);
      t = Date.now();
      const sent = await cliJson(
        "send",
        "claude",
        "Build on my foreleg rename.",
        "--doc",
        doc,
        "--request-id",
        "gate-steer-0001",
      );
      assert.equal(sent.code, 0);
      const messageId = String(field(sent.value, "messageId"));
      await until(
        () => Promise.resolve(pushes.length),
        (n) => n >= 1,
        "the channel push",
      );
      timings["send to channel notification"] = Date.now() - t;
      assert.equal(pushes[0]?.meta["message_id"], messageId);
      assert.match(pushes[0]?.content ?? "", /Build on my foreleg rename\./);
      assert.match(pushes[0]?.content ?? "", new RegExp(`ack ${messageId}`));
      const accepted = await until(
        () => cliJson("message", messageId),
        (m) => field(m.value, "status") === "host-accepted",
        "host acceptance",
      );
      assert.equal(field(accepted.value, "delivery", "receipt", "delivery"), "channel-notified");
      // The duplicate send is the same message and is not pushed again.
      const again = await cliJson(
        "send",
        "claude",
        "Build on my foreleg rename.",
        "--doc",
        doc,
        "--request-id",
        "gate-steer-0001",
      );
      assert.equal(field(again.value, "messageId"), messageId);

      // The agent works over MCP: inbox, ack, manual changes, proposal, applied.
      const inbox = await tool(client, "read_inbox");
      assert.equal(field(inbox.value, "messages", 0, "messageId"), messageId);
      const since = Number(field(inbox.value, "messages", 0, "cursor", "since"));
      const acked = await tool(client, "ack_steering", { messageId });
      assert.ok(!acked.isError, acked.summary);
      const manual = await tool(client, "read_changes", { documentId: doc, since, by: "human" });
      assert.equal(field(manual.value, "deltas", 0, "actor", "kind"), "human");
      const proposed = await tool(client, "propose_change", {
        documentId: doc,
        baseRevision: 2,
        proposalId: "prop-tail",
        summary: "Longer tail to balance the foreleg",
        steer: { tail: { length: 1.3 } },
        requestId: "gate-steer-prop-0001",
      });
      assert.ok(!proposed.isError, proposed.summary);
      const applied = await tool(client, "report_applied", {
        messageId,
        documentId: doc,
        requestId: "gate-steer-prop-0001",
      });
      // A proposal awaits the person; it applies only when they accept that version.
      assert.equal(field(applied.value, "status"), "proposed", applied.summary);
      assert.equal(field(applied.value, "applied"), null);
      assert.equal((await cliJson("accept", doc, "prop-tail", "--base", "head")).code, 0);
      const decided = await until(
        () => cliJson("message", messageId),
        (m) => field(m.value, "status") === "applied",
        "applied after acceptance",
      );
      assert.equal(field(decided.value, "applied", "via"), "proposal-accepted");
      assert.equal(field(decided.value, "applied", "acceptedBy", "kind"), "human");

      // Codex has no push into a running session here: an inbox-only route, worked with the CLI.
      assert.equal(
        (
          await cliJson(
            "route",
            "codex",
            "--inbox",
            "codex",
            "--conversation",
            "019a0000-0000-7000-8000-00000000c0de",
          )
        ).code,
        0,
      );
      const view = await cliJson("recipients", "codex");
      assert.equal(field(view.value, 0, "availability", "state"), "inbox-only");
      const forCodex = await cliJson("send", "codex", "Check the tail proposal.", "--doc", doc);
      const codexMessage = String(field(forCodex.value, "messageId"));
      assert.equal(field(forCodex.value, "status"), "inbox-only");
      const codexInbox = await cliJson("inbox", "--credential", codexCredential);
      assert.equal(field(codexInbox.value, "messages", 0, "messageId"), codexMessage);
      const wrongAgent = await cli("ack", codexMessage, "--credential", claudeCredential);
      assert.notEqual(wrongAgent.code, 0, "another agent cannot acknowledge it");
      assert.equal((await cliJson("ack", codexMessage, "--credential", codexCredential)).code, 0);
      const codexProposal = await cliJson(
        "propose",
        doc,
        "prop-codex",
        "--base",
        "head",
        "--summary",
        "Rename the foreleg back",
        "--op",
        JSON.stringify({ op: "part.rename", part, label: "Foreleg" }),
        "--request-id",
        "gate-codex-prop-0001",
        "--credential",
        codexCredential,
      );
      assert.equal(codexProposal.code, 0, JSON.stringify(codexProposal.value));
      assert.equal(
        (
          await cliJson(
            "applied",
            codexMessage,
            "--doc",
            doc,
            "--request-id",
            "gate-codex-prop-0001",
            "--credential",
            codexCredential,
          )
        ).code,
        0,
      );
      assert.equal(field((await cliJson("message", codexMessage)).value, "status"), "proposed");
      assert.equal((await cliJson("reject", doc, "prop-codex")).code, 0);
      await until(
        () => cliJson("message", codexMessage),
        (m) => field(m.value, "status") === "proposal-discarded",
        "discarded after rejection",
      );
      const personAsAgent = await cli("send", "claude", "spoof", "--credential", codexCredential);
      assert.notEqual(personAsAgent.code, 0, "an agent credential cannot send steering");

      // Kill the host under the live channel, restart it: the same instance re-watches.
      t = Date.now();
      await killed(host);
      host = await startHost(false);
      const secondId = "gate-steer-0002";
      const second = await until(
        () => cliJson("send", "claude", "After the restart.", "--request-id", secondId),
        (r) => r.code === 0,
        "send after restart",
      );
      const secondMessage = String(field(second.value, "messageId"));
      await until(
        () => cliJson("message", secondMessage),
        (m) => field(m.value, "status") === "host-accepted",
        "push after restart",
      );
      timings["restart to second push"] = Date.now() - t;
      assert.ok(pushes.some((p) => p.meta["message_id"] === secondMessage));
      assert.equal(
        pushes.filter((p) => p.meta["message_id"] === messageId).length,
        1,
        "no repeat of the first",
      );

      // Revocation: open messages are revoked and the route is unbound.
      const pending = await cliJson(
        "send",
        "claude",
        "Never read.",
        "--request-id",
        "gate-steer-0003",
      );
      const pendingId = String(field(pending.value, "messageId"));
      assert.equal((await cliJson("unpair", "claude")).code, 0);
      assert.equal(field((await cliJson("message", pendingId)).value, "status"), "revoked");
      const outbox = await cliJson("outbox");
      assert.ok(Array.isArray(field(outbox.value, "messages")));
      process.stderr.write(`steering gate timings (ms): ${JSON.stringify(timings)}\n`);
    } finally {
      await client?.close();
      await killed(host);
    }
  },
);
