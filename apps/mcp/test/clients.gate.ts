// clients gate: a real host process, CLI processes and an MCP SDK client
// driving the MCP server over stdio, all against one open project.
//
//   pnpm --filter @irudd/mcp gate:clients
//
// It covers: pairing, a seeded/preset start, the MCP handshake and tool list,
// a person's manual edit read back by the agent as a manual delta, the agent
// refused a direct edit, a proposal with a duplicate request, a stale CLI
// edit, killing and restarting the host under a live MCP server, a duplicate
// across the restart, preview, accept with the manual edit preserved, reject,
// receipts, and (on Windows) the irudd.cmd launcher.
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
const launcher = path.join(root, "apps/cli/bin/irudd.cmd");

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "irudd-clients-"));
const project = path.join(scratch, "project");
const stateDir = path.join(scratch, "state");
const env = { ...process.env, IRUDD_STATE_DIR: stateDir };
const stringEnv: Record<string, string> = Object.fromEntries(
  Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
);
const doc = "doc-gate01";

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

async function cliJson(
  ...args: string[]
): Promise<{ code: number; value: Record<string, unknown> }> {
  const ran = await cli(...args, "--json");
  let value: unknown;
  try {
    value = JSON.parse(ran.stdout);
  } catch {
    assert.fail(
      `irudd ${args.join(" ")} printed no JSON (exit ${ran.code}): ${ran.stdout}${ran.stderr}`,
    );
  }
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value));
  return { code: ran.code, value: { ...value } };
}

function startHost(
  create: boolean,
): Promise<{ child: ChildProcess; ready: Record<string, unknown> }> {
  const child = spawn(
    process.execPath,
    [
      "--import",
      register,
      hostMain,
      project,
      ...(create ? ["--create", "--label", "Clients gate"] : []),
      "--json",
      "--durability",
      "normal",
    ],
    { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  return new Promise((resolve, reject) => {
    let out = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      const line = out.split("\n")[0];
      if (out.includes("\n") && line) {
        const ready: unknown = JSON.parse(line);
        if (typeof ready === "object" && ready !== null) resolve({ child, ready: { ...ready } });
      }
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

interface ToolReply {
  readonly isError: boolean;
  readonly summary: string;
  readonly value: unknown;
}

async function tool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolReply> {
  const result = await client.callTool({ name, arguments: args });
  const content: unknown[] = Array.isArray(result.content) ? result.content : [];
  const first: unknown = content[0];
  const text: unknown =
    typeof first === "object" && first !== null ? Reflect.get(first, "text") : undefined;
  assert.equal(typeof text, "string");
  const body = String(text);
  const split = body.indexOf("\n\n");
  let value: unknown = null;
  if (split >= 0) value = JSON.parse(body.slice(split + 2));
  return {
    isError: result.isError === true,
    summary: split >= 0 ? body.slice(0, split) : body,
    value,
  };
}

const field = (value: unknown, ...keys: Array<string | number>): unknown =>
  keys.reduce<unknown>(
    (v, k) => (typeof v === "object" && v !== null ? Reflect.get(v, k) : undefined),
    value,
  );

test(
  "CLI and an MCP SDK client share one host, across a host restart",
  { timeout: 120_000 },
  async () => {
    const started = Date.now();
    const timings: Record<string, number> = {};
    const mark = (name: string, since: number) => (timings[name] = Date.now() - since);

    let t = Date.now();
    let host = await startHost(true);
    mark("host start (create)", t);
    try {
      const pair = await cliJson("pair", "claude", "--name", "Claude");
      assert.equal(pair.code, 0);
      const credentialFile = String(pair.value["credentialFile"]);
      assert.ok(fs.existsSync(credentialFile));

      const created = await cliJson("new", doc, "--preset", "default");
      assert.equal(created.code, 0, JSON.stringify(created.value));
      assert.equal(field(created.value, "receipt", "revision"), 1);

      // A real MCP handshake over stdio.
      t = Date.now();
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: ["--import", register, mcpMain, "--credential", credentialFile],
        env: stringEnv,
        stderr: "pipe",
      });
      const client = new Client({ name: "clients-gate", version: "1.0.0" });
      await client.connect(transport);
      mark("mcp initialize", t);
      assert.equal(client.getServerVersion()?.name, "irudd-workshop");
      const tools = (await client.listTools()).tools.map((x) => x.name).sort();
      for (const name of [
        "workshop_status",
        "read_document",
        "read_changes",
        "propose_change",
        "preview_proposal",
        "check_request",
      ])
        assert.ok(tools.includes(name), `missing tool ${name}`);
      for (const forbidden of ["accept_proposal", "set_policy", "pair_agent"])
        assert.ok(!tools.includes(forbidden));

      t = Date.now();
      const status = await tool(client, "workshop_status");
      mark("first mcp call (connects to host)", t);
      assert.ok(!status.isError, status.summary);
      assert.equal(field(status.value, "you", "actor", "id"), "claude");
      assert.equal(field(status.value, "you", "role"), "agent");

      const first = await tool(client, "read_document", { documentId: doc });
      assert.equal(field(first.value, "revision"), 1);
      const part = String(field(first.value, "document", "parts", 1, "id"));

      // A person's manual edit through the CLI, then the agent reads it as a manual delta.
      const manual = await cliJson("rename", doc, part, "Left foreleg", "--base", "1");
      assert.equal(manual.code, 0, JSON.stringify(manual.value));
      const delta = await tool(client, "read_changes", { documentId: doc, since: 1, by: "human" });
      assert.equal(field(delta.value, "deltas", "length"), 1);
      assert.equal(field(delta.value, "deltas", 0, "actor", "kind"), "human");

      // Direct edits are off for agents; the host answers proposal-required.
      const direct = await tool(client, "edit_document", {
        documentId: doc,
        baseRevision: 2,
        ops: [{ op: "part.rename", part, label: "Agent rename" }],
        requestId: "gate-direct-0001",
      });
      assert.ok(direct.isError);
      assert.equal(field(direct.value, "diagnostics", 0, "code"), "proposal-required");

      // A proposal, then the same request again: one commit, one replay.
      const proposal = {
        documentId: doc,
        baseRevision: 2,
        proposalId: "prop-tail",
        summary: "Longer tail for balance",
        steer: { tail: { length: 1.3 } },
        requestId: "gate-proposal-0001",
      };
      const proposed = await tool(client, "propose_change", proposal);
      assert.ok(!proposed.isError, proposed.summary);
      assert.equal(field(proposed.value, "kind"), "committed");
      const duplicate = await tool(client, "propose_change", proposal);
      assert.equal(field(duplicate.value, "kind"), "replayed");

      // A stale CLI edit is rejected with nothing written.
      const stale = await cliJson("rename", doc, part, "Stale", "--base", "1");
      assert.equal(stale.code, 4);
      assert.equal(field(stale.value, "diagnostics", 0, "code"), "stale-revision");

      // Kill the host under a live MCP server, then restart it.
      t = Date.now();
      await killed(host.child);
      const down = await tool(client, "read_document", { documentId: doc });
      assert.ok(down.isError);
      assert.match(down.summary, /HostUnavailable|ConnectionLost/);
      const downCli = await cli("status");
      assert.equal(downCli.code, 3);
      assert.match(downCli.stderr, /has stopped|not answering/);
      host = await startHost(false);
      mark("kill and restart host", t);
      assert.notEqual(host.ready["instance"], undefined);

      const replayAfterRestart = await tool(client, "propose_change", proposal);
      assert.ok(!replayAfterRestart.isError, replayAfterRestart.summary);
      assert.equal(
        field(replayAfterRestart.value, "kind"),
        "replayed",
        "a duplicate across a restart replays",
      );
      const receipt = await tool(client, "check_request", {
        documentId: doc,
        requestId: "gate-proposal-0001",
      });
      assert.equal(field(receipt.value, "command"), "proposal.create");

      // The person previews and accepts; the manual edit survives.
      const preview = await cliJson("preview", doc, "prop-tail");
      assert.equal(preview.code, 0);
      assert.equal(preview.value["stale"], false);
      const accepted = await cliJson("accept", doc, "prop-tail", "--base", "2");
      assert.equal(accepted.code, 0, JSON.stringify(accepted.value));
      assert.equal(field(accepted.value, "receipt", "revision"), 3);
      const head = await tool(client, "read_document", { documentId: doc });
      assert.equal(field(head.value, "revision"), 3);
      assert.equal(field(head.value, "document", "parts", 1, "label"), "Left foreleg");
      assert.equal(field(head.value, "document", "generation", "params", "tail", "length"), 1.3);

      // A second proposal, rejected by the person.
      const second = await tool(client, "propose_change", {
        documentId: doc,
        baseRevision: 3,
        proposalId: "prop-legs",
        summary: "Six legs",
        steer: { legs: { pairs: 3 } },
        requestId: "gate-proposal-0002",
      });
      assert.equal(field(second.value, "kind"), "committed");
      const rejected = await cliJson("reject", doc, "prop-legs");
      assert.equal(rejected.code, 0);
      const legs = await tool(client, "preview_proposal", {
        documentId: doc,
        proposalId: "prop-legs",
      });
      assert.equal(field(legs.value, "proposal", "status"), "discarded");

      const human = await cliJson("receipt", doc, String(field(accepted.value, "requestId")));
      assert.equal(human.code, 0);
      assert.equal(human.value["command"], "proposal.accept");

      if (process.platform === "win32") {
        t = Date.now();
        const viaLauncher = await new Promise<Ran>((resolve) => {
          execFile(
            "cmd.exe",
            ["/d", "/s", "/c", `""${launcher}" status --project "${project}" --json"`],
            { env, windowsHide: true, windowsVerbatimArguments: true },
            (error, stdout, stderr) =>
              resolve({
                code: error && typeof error.code === "number" ? error.code : 0,
                stdout,
                stderr,
              }),
          );
        });
        mark("irudd.cmd status", t);
        assert.equal(viaLauncher.code, 0, viaLauncher.stderr);
        assert.equal(field(JSON.parse(viaLauncher.stdout), "you", "kind"), "human");
      }

      await client.close();
    } finally {
      await killed(host.child);
      timings["total"] = Date.now() - started;
      process.stdout.write(`# clients gate timings (ms): ${JSON.stringify(timings)}\n`);
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  },
);
