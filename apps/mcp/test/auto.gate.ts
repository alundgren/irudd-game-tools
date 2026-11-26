import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { connect } from "@irudd/workshop/client";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const register = pathToFileURL(path.join(root, "packages/document/test/support/register.ts")).href;
const hostMain = path.join(root, "packages/workshop/src/host/main.ts");
const mcpMain = path.join(root, "apps/mcp/src/main.ts");

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "irudd-auto-"));
const project = path.join(scratch, "project");
const stateDir = path.join(scratch, "state");
const env: Record<string, string> = Object.fromEntries(
  Object.entries({ ...process.env, IRUDD_STATE_DIR: stateDir }).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  ),
);
delete env["IRUDD_PROJECT"];
delete env["IRUDD_AGENT_CREDENTIAL"];

function startHost(): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    [
      "--import",
      register,
      hostMain,
      project,
      "--create",
      "--label",
      "Auto gate",
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
      if (out.includes("\n")) resolve(child);
    });
    child.once("exit", (code) => reject(new Error(`host exited ${String(code)}: ${stderr}`)));
  });
}

function stopped(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once("exit", () => resolve());
    child.kill();
  });
}

async function status(client: Client): Promise<{ isError: boolean; text: string }> {
  const result = await client.callTool({ name: "workshop_status", arguments: {} });
  const content: unknown[] = Array.isArray(result.content) ? result.content : [];
  const first: unknown = content[0];
  const text: unknown =
    typeof first === "object" && first !== null ? Reflect.get(first, "text") : undefined;
  return { isError: result.isError === true, text: String(text) };
}

test("an unconfigured MCP server waits for the workshop and pairs itself when it opens", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", register, mcpMain],
    env,
    stderr: "pipe",
  });
  const client = new Client({ name: "claude-code", version: "1.0.0" });
  await client.connect(transport);
  let host: ChildProcess | undefined;
  try {
    const closed = await status(client);
    assert.ok(closed.isError, closed.text);
    assert.match(closed.text, /Irudd Workshop isn't running/);

    host = await startHost();
    const open = await status(client);
    assert.ok(!open.isError, open.text);
    assert.match(open.text, /claude/);

    const person = await connect({ credential: { role: "human", project }, stateDir });
    try {
      const recipients = await person.call("recipient.list", {});
      const claude = recipients.find((r) => r.agent === "claude");
      assert.equal(claude?.name, "Claude Code");
      assert.deepEqual(claude?.recipient?.route, {
        transport: "inbox",
        host: "claude-code",
        environment: "local",
      });
    } finally {
      person.close();
    }
  } finally {
    await client.close();
    if (host) await stopped(host);
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
