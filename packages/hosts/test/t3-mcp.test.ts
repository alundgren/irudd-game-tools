// The T3 MCP path against a stand-in T3 server: standard MCP authorization (metadata,
// registration, PKCE, token, revocation) and a Streamable HTTP /mcp endpoint that answers
// tools/call over SSE. It records what irudd sends. It does not reach T3 Code: the
// protocol shapes come from T3 Code v0.1.12's own bundle (see src/t3-mcp.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {
  connectT3,
  disconnectT3,
  readT3Grant,
  t3ThreadTransport,
  type DeliveryRequest,
  type RecipientRoute,
  type T3Launcher,
} from "@irudd/hosts";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "irudd-t3mcp-"));
const home = path.join(scratch, "t3home");
const grantFile = path.join(scratch, "state", "t3", "mcp-grant.json");
const busyThread = "thread:delegated-task:command%3Amcp%3Afake%3A0001";
const idleThread = "thread:idle-0002";

interface Sent {
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly auth: string | undefined;
}
const sent: Sent[] = [];
let token = "tok-0";
let challenge = "";
let revoked = false;
let answerFor: string | undefined;

const get = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const read = (req: http.IncomingMessage) =>
  new Promise<string>((resolve) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => resolve(body));
  });

const server = http.createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? "/", origin());
    const body = await read(req);
    const sendJson = (status: number, value: unknown, headers: Record<string, string> = {}) =>
      res
        .writeHead(status, { "content-type": "application/json", ...headers })
        .end(JSON.stringify(value));
    if (url.pathname === "/.well-known/oauth-authorization-server")
      return sendJson(200, {
        issuer: origin(),
        authorization_endpoint: `${origin()}/oauth/mcp/authorize`,
        token_endpoint: `${origin()}/oauth/mcp/token`,
        registration_endpoint: `${origin()}/oauth/mcp/register`,
        revocation_endpoint: `${origin()}/oauth/mcp/revoke`,
      });
    if (url.pathname === "/oauth/mcp/register") {
      const meta: unknown = JSON.parse(body);
      const uris = get(meta, "redirect_uris");
      assert.ok(
        Array.isArray(uris) && /^http:\/\/127\.0\.0\.1:\d+\/callback$/.test(String(uris[0])),
      );
      return sendJson(201, { client_id: "client-1", client_name: "irudd", redirect_uris: uris });
    }
    if (url.pathname === "/oauth/mcp/token") {
      const form = new URLSearchParams(body);
      const verifier = form.get("code_verifier") ?? "";
      const ok =
        form.get("code") === "code-1" &&
        createHash("sha256").update(verifier).digest("base64url") === challenge &&
        form.get("resource") === `${origin()}/mcp`;
      if (!ok) return sendJson(400, { error: "invalid_grant", error_description: "bad" });
      token = "tok-1";
      return sendJson(200, {
        access_token: token,
        token_type: "Bearer",
        expires_in: 30 * 86400,
        scope: "orchestration:read orchestration:operate",
      });
    }
    if (url.pathname === "/oauth/mcp/revoke") {
      revoked = new URLSearchParams(body).get("token") === token;
      return res.writeHead(200).end();
    }
    if (url.pathname === "/mcp") {
      if (req.method === "DELETE") return res.writeHead(200).end();
      if (req.headers.authorization !== `Bearer ${token}` || revoked)
        return res.writeHead(401, { "www-authenticate": 'Bearer resource_metadata="x"' }).end();
      const rpc: unknown = JSON.parse(body);
      const method = get(rpc, "method");
      const id = get(rpc, "id");
      if (method === "initialize")
        return sendJson(
          200,
          { jsonrpc: "2.0", id, result: { protocolVersion: "2025-06-18", capabilities: {} } },
          { "mcp-session-id": "sess-1" },
        );
      if (method === "notifications/initialized") return res.writeHead(202).end();
      if (method === "tools/call") {
        assert.equal(req.headers["mcp-session-id"], "sess-1");
        const params = get(rpc, "params");
        const tool = String(get(params, "name"));
        const given = get(params, "arguments");
        const args = isRecord(given) ? given : {};
        sent.push({ tool, args, auth: req.headers.authorization });
        const thread = String(args["threadId"]);
        const result =
          thread !== busyThread && thread !== idleThread
            ? { isError: true, content: [{ type: "text", text: `Thread ${thread} not found.` }] }
            : {
                content: [{ type: "text", text: "sent" }],
                structuredContent: {
                  threadId: answerFor ?? thread,
                  messageId: "message:mcp:1",
                  runId: "run:1",
                  status: "running",
                  delivery:
                    thread === idleThread
                      ? "started"
                      : args["mode"] === "auto"
                        ? "steered"
                        : "queued",
                },
              };
        res
          .writeHead(200, { "content-type": "text/event-stream" })
          .end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id, result })}\n\n`);
        return;
      }
    }
    res.writeHead(404).end();
    return undefined;
  })();
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = () => {
  const address = server.address();
  return `http://127.0.0.1:${String(typeof address === "object" && address ? address.port : 0)}`;
};
fs.mkdirSync(path.join(home, "userdata"), { recursive: true });
const runtime = (value: Record<string, unknown>) =>
  fs.writeFileSync(path.join(home, "userdata", "server-runtime.json"), JSON.stringify(value));
runtime({
  version: 1,
  pid: process.pid,
  origin: origin(),
  ownerId: "owner-1",
  serverVersion: "0.1.12",
});

// The CLI fallback: a recording stand-in for T3's bin.mjs.
const record = path.join(scratch, "cli.jsonl");
const fakeCli = path.join(scratch, "bin.mjs");
fs.writeFileSync(
  fakeCli,
  `import fs from "node:fs";
const args = process.argv.slice(2);
for await (const _ of process.stdin) {}
fs.appendFileSync(${JSON.stringify(record)}, JSON.stringify(args) + "\\n");
console.log(JSON.stringify({ threadId: args[2], messageId: "message:cli", runId: "run:cli", status: "queued", delivery: "queued" }));
`,
);
const launcher: T3Launcher = {
  executable: process.execPath,
  script: fakeCli,
  env: {},
  source: "test",
};
const cliCalls = () =>
  fs.existsSync(record) ? fs.readFileSync(record, "utf8").trim().split("\n").filter(Boolean) : [];

const route = (conversation: string, delivery?: "mid-turn" | "next-turn"): RecipientRoute => ({
  transport: "t3-thread",
  host: "t3",
  environment: "local",
  conversation,
  ...(delivery ? { delivery } : {}),
});
const message = (r: RecipientRoute, id = "stm-0000000000000000000000000a"): DeliveryRequest => ({
  messageId: id,
  agent: "canary-a",
  route: r,
  prompt: "Use my earlier brow choice.",
  meta: { message_id: id },
});
const transport = () => t3ThreadTransport({ launcher, home, grantFile });

test("without a grant, T3 routes queue through the CLI, and mid-turn says so", async () => {
  const outcome = await transport().deliver(message(route(busyThread, "mid-turn")));
  assert.equal(outcome.kind, "accepted");
  assert.equal(outcome.kind === "accepted" ? outcome.receipt.via : "", "t3-cli");
  assert.equal(outcome.kind === "accepted" ? outcome.receipt.turn : "", "next-turn");
  assert.equal(sent.length, 0);
  assert.equal(cliCalls().length, 1);
});

test("connect: registration, the person's approval, PKCE token exchange, a private grant", async () => {
  const info = await connectT3({
    home,
    grantFile,
    timeoutMs: 10_000,
    onAuthorizeUrl: (url) => {
      // The person approves in T3; T3 redirects back with a code.
      const authorize = new URL(url);
      assert.equal(authorize.origin, origin());
      assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
      assert.equal(authorize.searchParams.get("resource"), `${origin()}/mcp`);
      challenge = authorize.searchParams.get("code_challenge") ?? "";
      const back = new URL(authorize.searchParams.get("redirect_uri") ?? "");
      back.searchParams.set("code", "code-1");
      back.searchParams.set("state", authorize.searchParams.get("state") ?? "");
      back.searchParams.set("iss", origin());
      void fetch(back);
    },
  });
  assert.equal(info.origin, origin());
  assert.equal(info.ownerId, "owner-1");
  assert.doesNotMatch(JSON.stringify(info), /tok-1/, "what is shown never holds the token");
  assert.equal(readT3Grant(grantFile)?.accessToken, "tok-1");
  if (process.platform !== "win32") assert.equal(fs.statSync(grantFile).mode & 0o777, 0o600);
});

test("mid-turn: t3_thread_send mode auto with the message ID as clientRequestId; the receipt says steered", async () => {
  sent.length = 0;
  const before = cliCalls().length;
  const outcome = await transport().deliver(message(route(busyThread, "mid-turn")));
  assert.equal(outcome.kind, "accepted", JSON.stringify(outcome));
  const receipt = outcome.kind === "accepted" ? outcome.receipt : undefined;
  assert.equal(receipt?.via, "t3-mcp");
  assert.equal(receipt?.delivery, "steered");
  assert.equal(receipt?.turn, "mid-turn");
  assert.deepEqual(sent[0]?.args, {
    threadId: busyThread,
    message: "Use my earlier brow choice.",
    mode: "auto",
    clientRequestId: "stm-0000000000000000000000000a",
  });
  assert.equal(sent[0]?.auth, "Bearer tok-1");
  assert.equal(cliCalls().length, before, "the CLI was not used");

  // Next-turn routes queue; an idle thread starts a new turn.
  assert.equal(
    (await transport().deliver(message(route(busyThread)))).kind === "accepted" &&
      sent[1]?.args["mode"],
    "queue",
  );
  const idle = await transport().deliver(message(route(idleThread, "mid-turn")));
  assert.equal(idle.kind === "accepted" ? idle.receipt.turn : "", "new-turn");
});

test("only the exact thread: refusals and answers for another thread are never accepted", async () => {
  assert.equal(
    (await transport().deliver(message(route("thread:someone-else", "mid-turn")))).kind,
    "rejected",
  );
  answerFor = "thread:other";
  const wrong = await transport().deliver(message(route(busyThread, "mid-turn")));
  answerFor = undefined;
  assert.equal(wrong.kind, "unknown");
});

test("a grant is scoped to its server and owner; a T3 authorization refusal stops delivery", async () => {
  const stored = readT3Grant(grantFile);
  assert.ok(stored);
  runtime({ version: 1, pid: process.pid, origin: "http://127.0.0.1:1", ownerId: "owner-1" });
  sent.length = 0;
  const moved = await transport().deliver(message(route(busyThread, "mid-turn")));
  assert.equal(moved.kind === "accepted" ? moved.receipt.via : "", "t3-cli");
  assert.equal(sent.length, 0);
  runtime({ version: 1, pid: process.pid, origin: origin(), ownerId: "owner-2" });
  const reinstalled = await transport().deliver(message(route(busyThread, "mid-turn")));
  assert.equal(reinstalled.kind === "accepted" ? reinstalled.receipt.via : "", "t3-cli");
  runtime({ version: 1, pid: process.pid, origin: origin(), ownerId: "owner-1" });

  revoked = true;
  const callsBeforeRefusal = cliCalls();
  const refused = await transport().deliver(message(route(busyThread, "mid-turn")));
  assert.equal(refused.kind, "rejected");
  assert.deepEqual(cliCalls(), callsBeforeRefusal);
  assert.equal(sent.length, 0);
  revoked = false;
});

test("disconnect revokes the grant at T3 and deletes it", async () => {
  const done = await disconnectT3(home, grantFile);
  assert.deepEqual(done, { removed: true, revoked: true });
  assert.equal(fs.existsSync(grantFile), false);
  server.close();
});
