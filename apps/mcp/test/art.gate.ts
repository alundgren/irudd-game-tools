// art gate: a real headless host process, CLI processes for the person and
// the paired agent (--credential), and an MCP SDK client driving `irudd mcp`
// over stdio, all against one open project.
//
//   pnpm --filter @irudd/mcp gate:art
//
// It covers a brief with two picture attachments sent from the CLI, the agent
// reading it over MCP with the pictures as image content, its variation reply
// drafted as its own proposal, the person's preview, accept and undo; a reply
// after the person's manual edit (stale, head kept); a depth brief answered
// from the agent CLI and recorded (no depth family yet), then saved to disk
// and compared byte for byte; a person's import with its stated author and
// licence; an accepted MCP reply whose picture becomes a credited asset; a
// duplicate and a replayed reply; cancellation; and an invalid reply. The host runs with --no-push and
// an inbox route, so it never calls T3 Code, Claude Code or Codex; no model
// makes these pictures. The SDK client stands in for the paired session.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { crc32, deflateSync } from "node:zlib";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const register = pathToFileURL(path.join(root, "packages/document/test/support/register.ts")).href;
const hostMain = path.join(root, "packages/workshop/src/host/main.ts");
const cliMain = path.join(root, "apps/cli/src/main.ts");
const mcpMain = path.join(root, "apps/mcp/src/main.ts");

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "irudd-art-gate-"));
const project = path.join(scratch, "project");
const stateDir = path.join(scratch, "state");
const env = { ...process.env, IRUDD_STATE_DIR: stateDir };
const stringEnv: Record<string, string> = Object.fromEntries(
  Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
);
const doc = "doc-artgate1";

/** A solid PNG with a square mark, written to the scratch directory. */
function png(
  name: string,
  width: number,
  height: number,
  rgb: readonly [number, number, number],
): string {
  const chunk = (type: string, data: Uint8Array) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0, 0);
    return Buffer.concat([len, body, crc]);
  };
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const mark = x > width / 3 && x < width / 2 && y > height / 3 && y < height / 2;
      raw.set(
        mark ? [255 - rgb[0], 255 - rgb[1], 255 - rgb[2]] : rgb,
        y * (width * 3 + 1) + 1 + x * 3,
      );
    }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const bytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
  const file = path.join(scratch, name);
  fs.writeFileSync(file, bytes);
  return file;
}

const sha = (bytes: Uint8Array) => "sha256:" + createHash("sha256").update(bytes).digest("hex");

interface Ran {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function cli(...args: string[]): Promise<Ran> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [
        "--import",
        register,
        cliMain,
        ...args,
        ...(args.includes("--credential") ? [] : ["--project", project]),
      ],
      { env, windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
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
      "Art gate",
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
    content,
  };
}

const request = async (...args: string[]): Promise<string> => {
  const sent = await cliJson("art", "request", doc, "--agent", "claude", ...args);
  assert.equal(sent.code, 0, JSON.stringify(sent.value));
  return String(field(sent.value, "artId"));
};

test(
  "paired art through a real host, the CLI and the MCP server",
  { timeout: 180_000 },
  async () => {
    const timings: Record<string, number> = {};
    const started = Date.now();
    const host = await startHost();
    timings["host start"] = Date.now() - started;
    let client: Client | undefined;
    try {
      const claude = await cliJson("pair", "claude", "--name", "Claude");
      const credential = String(field(claude.value, "credentialFile"));
      assert.equal((await cliJson("new", doc, "--preset", "default")).code, 0);
      assert.equal((await cliJson("route", "claude", "--inbox", "claude-code")).code, 0);
      const shown = await cliJson("show", doc);
      const part = String(field(shown.value, "document", "parts", 1, "id"));
      const front = png("front.png", 512, 512, [200, 140, 100]);
      const side = png("side.png", 512, 512, [100, 140, 200]);

      const caps = await cliJson("art", "capabilities");
      assert.equal(field(caps.value, "producer"), "paired-agent");

      // A variation brief with two pictures, from the person's CLI.
      let mark = Date.now();
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: ["--import", register, mcpMain, "--credential", credential],
        env: stringEnv,
        stderr: "pipe",
      });
      client = new Client({ name: "paired-agent", version: "gate" });
      await client.connect(transport);

      await tool(client, "workshop_status");
      const variationId = await request(
        "--kind",
        "variation",
        "--direction",
        "Give it a heron's head.",
        "--attach",
        `front=${front}`,
        "--attach",
        `side=${side}`,
        "--part",
        part,
      );
      timings["request with 2 pictures"] = Date.now() - mark;

      const listed = await tool(client, "art_requests");
      assert.equal(listed.isError, false, listed.summary);
      assert.match(listed.summary, new RegExp(variationId));
      mark = Date.now();
      const brief = await tool(client, "art_brief", { artId: variationId });
      timings["art_brief with 2 images"] = Date.now() - mark;
      const images = brief.content.filter((c) => field(c, "type") === "image");
      assert.equal(images.length, 2);
      assert.deepEqual(
        images.map((c) => sha(Buffer.from(String(field(c, "data")), "base64"))),
        [front, side].map((f) => sha(fs.readFileSync(f))),
        "the conversation sees the exact attached bytes",
      );

      const submissionId = "gate-variation-0001";
      const reply = {
        artId: variationId,
        submissionId,
        summary: "Heron head",
        operations: [{ op: "part.rename", part, label: "Heron head" }],
      };
      const submitted = await tool(client, "art_submit", reply);
      assert.equal(submitted.isError, false, submitted.summary);
      assert.equal(field(submitted.value, "submission", "state"), "proposed");
      assert.deepEqual(field(submitted.value, "submission", "by"), {
        kind: "agent",
        id: "claude",
        name: "Claude",
      });
      const proposal = String(field(submitted.value, "submission", "proposal", "id"));
      const replayed = await tool(client, "art_submit", reply);
      assert.equal(field(replayed.value, "outcome"), "replayed");
      const duplicate = await tool(client, "art_submit", {
        ...reply,
        submissionId: "gate-variation-0002",
      });
      assert.equal(field(duplicate.value, "submission", "duplicateOf"), submissionId);

      // The person reviews it like any proposal.
      const proposals = await cliJson("proposals", doc);
      assert.ok(JSON.stringify(proposals.value).includes(proposal));
      assert.equal((await cli("preview", doc, proposal)).code, 0);
      assert.equal((await cliJson("accept", doc, proposal, "--base", "head")).code, 0);
      const outbox = await cliJson("art", "show", variationId);
      assert.equal(field(outbox.value, "submissions", 0, "proposal", "status"), "accepted");
      assert.equal(field(outbox.value, "steering", "status"), "applied");
      assert.equal((await cliJson("undo", doc, "2", "--base", "head")).code, 0);

      // A reply after the person's manual edit is drafted on the brief's revision.
      const staleId = await request(
        "--kind",
        "variation",
        "--direction",
        "Lengthen the neck.",
        "--attach",
        `front=${front}`,
      );
      assert.equal(
        (await cliJson("rename", doc, part, "Person's skull", "--base", "head")).code,
        0,
      );
      const stale = await tool(client, "art_submit", {
        artId: staleId,
        summary: "Long neck",
        operations: [{ op: "part.rename", part, label: "Neck" }],
      });
      assert.equal(field(stale.value, "submission", "source", "stale"), true);
      const head = await cliJson("show", doc);
      assert.equal(field(head.value, "revision"), 4);
      assert.equal(field(head.value, "document", "parts", 1, "label"), "Person's skull");

      // An invalid reply is recorded and proposes nothing.
      const invalid = await tool(client, "art_submit", {
        artId: staleId,
        summary: "Bad",
        operations: [{ op: "part.rename", part: "p-missing", label: "x" }],
      });
      assert.equal(invalid.isError, true);
      assert.equal(field(invalid.value, "submission", "state"), "rejected");

      // A depth brief answered from the agent's CLI: checked, recorded, saved.
      const depthId = await request(
        "--kind",
        "depth",
        "--direction",
        "Depth of the face.",
        "--attach",
        `front=${front}`,
        "--attach",
        `side=${side}`,
      );
      const depth = png("depth.png", 512, 512, [120, 120, 120]);
      const answered = await cliJson(
        "art",
        "submit",
        depthId,
        "--image",
        depth,
        "--summary",
        "Face depth",
        "--credential",
        credential,
      );
      assert.equal(answered.code, 0, JSON.stringify(answered.value));
      assert.equal(field(answered.value, "submission", "state"), "recorded");
      const imported = await cliJson(
        "art",
        "submit",
        depthId,
        "--image",
        png("import.png", 512, 512, [60, 60, 60]),
        "--summary",
        "Imported depth",
        "--author",
        "Ada Weaver",
        "--license",
        "CC-BY-4.0",
      );
      assert.equal(field(imported.value, "submission", "via"), "person-import");
      assert.deepEqual(field(imported.value, "submission", "reply", "attribution"), {
        author: "Ada Weaver",
        license: "CC-BY-4.0",
      });

      // An accepted MCP reply credits the picture it adds; the person's import above was only recorded.
      const creditId = await request(
        "--kind",
        "variation",
        "--direction",
        "Keep the depth pass as a reference.",
      );
      const credited = await tool(client, "art_submit", {
        artId: creditId,
        summary: "Depth reference",
        attribution: { author: "the paired conversation's image tool", license: "CC0-1.0" },
        operations: [
          {
            op: "asset.add",
            asset: {
              digest: sha(fs.readFileSync(depth)),
              mediaType: "image/png",
              byteLength: fs.statSync(depth).size,
              role: "reference",
            },
          },
        ],
      });
      assert.equal(credited.isError, false, credited.summary);
      const creditProposal = String(field(credited.value, "submission", "proposal", "id"));
      assert.equal((await cliJson("accept", doc, creditProposal, "--base", "head")).code, 0);
      const creditedDoc = await cliJson("show", doc);
      assert.deepEqual(
        field(creditedDoc.value, "document", "extensions", "irudd.asset-credits", "assets", 0),
        {
          digest: sha(fs.readFileSync(depth)),
          via: "paired-agent",
          submittedBy: { kind: "agent", id: "claude", name: "Claude" },
          art: { id: creditId, kind: "variation" },
          summary: "Depth reference",
          author: "the paired conversation's image tool",
          license: "CC0-1.0",
        },
      );
      assert.ok(
        !JSON.stringify(field(creditedDoc.value, "document")).includes(credential),
        "the credit holds no credential path",
      );
      const saveDir = path.join(scratch, "saved");
      const saved = await cliJson("art", "show", depthId, "--out", saveDir);
      assert.equal(saved.code, 0);
      assert.equal(
        sha(fs.readFileSync(path.join(saveDir, "attachment-1-front.png"))),
        sha(fs.readFileSync(front)),
      );
      assert.equal(
        sha(
          fs.readFileSync(
            path.join(saveDir, `reply-${String(field(answered.value, "submission", "seq"))}.png`),
          ),
        ),
        sha(fs.readFileSync(depth)),
      );
      assert.ok(fs.existsSync(path.join(saveDir, "brief.json")));

      // A cancelled brief refuses the agent's later reply.
      const cancelId = await request("--kind", "variation", "--direction", "Never mind.");
      assert.equal((await cliJson("art", "cancel", cancelId)).code, 0);
      const late = await tool(client, "art_submit", {
        artId: cancelId,
        summary: "Late",
        operations: [{ op: "part.rename", part, label: "Late" }],
      });
      assert.equal(late.isError, true);
      assert.match(late.summary, /ArtClosed/);

      // The agent cannot send or cancel briefs.
      const agentRequest = await cli(
        "art",
        "request",
        doc,
        "--agent",
        "claude",
        "--kind",
        "variation",
        "--direction",
        "x",
        "--credential",
        credential,
      );
      assert.notEqual(agentRequest.code, 0);

      timings["total"] = Date.now() - started;
      process.stdout.write(`art gate timings (ms): ${JSON.stringify(timings)}\n`);
    } finally {
      await client?.close();
      await killed(host);
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  },
);
