// T3 steering canary: one steering message into one existing, authorized T3 thread,
// followed through to the paired agent's acknowledgement and applied receipt.
//
//   IRUDD_CANARY_THREAD=<thread id> IRUDD_CANARY_T3_PROJECT=<T3 project id> \
//   [IRUDD_CANARY_MID_TURN=1] [IRUDD_CANARY_LIVE=1] [IRUDD_CANARY_WAIT_MIN=30] pnpm --filter @irudd/mcp canary:t3
//
// Without IRUDD_CANARY_LIVE=1 the host runs with --no-push and never calls T3 Code:
// a dry run of every step up to the send. With it, the host's real t3-thread adapter
// sends exactly one message to IRUDD_CANARY_THREAD. Only run it live for a thread
// whose owner authorized this canary.
//
// What it does, as the person, in a new temporary project:
//   1. creates a character from the quayside-merchant form and makes a manual jaw edit;
//   2. pairs one agent (canary-a) and binds it to the thread, nothing else;
//   3. sends "use my earlier brow choice" tagged IRUDD_STEER_CANARY. The text never
//      states the brow value; the agent has to bring it from its own conversation;
//   4. waits for the agent, authenticated by its pairing, to acknowledge, read the
//      manual changes, propose and link the proposal. It stops at "proposed": the
//      proposal awaits the person, and this script never accepts it, so a canary
//      never counts as applied. Accepting is the person's separate decision.
// It never starts a conversation and never reads the thread's messages. The
// evidence file keeps the send result, host acceptance, agent steps and the
// proposal apart. The agent's credential stays in the host's state directory; the
// message names only its path.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const register = pathToFileURL(path.join(root, "packages/document/test/support/register.ts")).href;
const hostMain = path.join(root, "packages/workshop/src/host/main.ts");
const cliMain = path.join(root, "apps/cli/src/main.ts");
const forms = path.join(root, "verification/families/fixtures");
const launcher = path.join(
  root,
  "apps/cli/bin",
  process.platform === "win32" ? "irudd.cmd" : "irudd",
);

const thread = process.env["IRUDD_CANARY_THREAD"];
const t3Project = process.env["IRUDD_CANARY_T3_PROJECT"];
const live = process.env["IRUDD_CANARY_LIVE"] === "1";
const midTurn = process.env["IRUDD_CANARY_MID_TURN"] === "1";
const waitMs = Number(process.env["IRUDD_CANARY_WAIT_MIN"] ?? "30") * 60_000;
if (!thread || !t3Project) {
  process.stderr.write("Set IRUDD_CANARY_THREAD and IRUDD_CANARY_T3_PROJECT.\n");
  process.exit(2);
}

const agent = "canary-a";
const doc = "doc-canary01";
const requestId = "canary-steer-0001";
const project =
  process.env["IRUDD_CANARY_PROJECT"] ??
  fs.mkdtempSync(path.join(os.tmpdir(), live ? "irudd-canary-" : "irudd-canary-dry-"));
const evidenceFile = path.join(project, "canary-evidence.json");
const env = { ...process.env, IRUDD_AGENT_COMMAND: launcher };

const field = (value: unknown, ...keys: Array<string | number>): unknown =>
  keys.reduce<unknown>(
    (v, k) => (typeof v === "object" && v !== null ? Reflect.get(v, k) : undefined),
    value,
  );

function cli(...args: string[]): Promise<{ code: number; value: unknown; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [
        "--import",
        register,
        cliMain,
        ...args,
        ...(args[0] === "t3" ? [] : ["--project", project]),
        "--json",
      ],
      { env, windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error && typeof error.code === "number" ? error.code : error ? 1 : 0;
        let value: unknown = null;
        try {
          value = JSON.parse(stdout);
        } catch {
          value = stdout.trim();
        }
        resolve({ code, value, stderr: stderr.trim() });
      },
    );
  });
}

async function must(...args: string[]): Promise<unknown> {
  const ran = await cli(...args);
  if (ran.code !== 0)
    throw new Error(
      `irudd ${args[0] ?? ""} exited ${String(ran.code)}: ${ran.stderr} ${JSON.stringify(ran.value)}`,
    );
  return ran.value;
}

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
      "Steering canary",
      "--forms",
      forms,
      "--agent-command",
      launcher,
      "--json",
      ...(live ? [] : ["--no-push"]),
    ],
    { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  child.stderr?.on("data", (chunk: Buffer) => process.stderr.write(`[host] ${chunk.toString()}`));
  return new Promise((resolve, reject) => {
    let out = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      if (out.includes("\n")) resolve(child);
    });
    child.once("exit", (code) => reject(new Error(`host exited ${String(code)}`)));
  });
}

const evidence: Record<string, unknown> = {
  mode: live ? "live" : "dry (--no-push: T3 Code is never called)",
  project,
  document: doc,
  agent,
  requestId,
  recipient: { thread, t3Project, requestedDelivery: midTurn ? "mid-turn" : "next-turn" },
};
const save = () => fs.writeFileSync(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`);
const step = (name: string, value: unknown) => {
  evidence[name] = value;
  save();
  process.stdout.write(`${name}: ${JSON.stringify(value)}\n`);
};

const host = await startHost();
try {
  step("host", { pid: host.pid, agentCommand: launcher });

  // 1. The person's character and manual jaw edit.
  await must("new", doc, "--starter", "quayside-merchant");
  const shown = await must("show", doc);
  const appearance = field(shown, "document", "features", "character.appearance");
  if (typeof appearance !== "object" || appearance === null)
    throw new Error("the quayside-merchant form has no character.appearance");
  const sculpt = field(appearance, "sculpt");
  const jawEdit = {
    ...appearance,
    sculpt: { ...(typeof sculpt === "object" && sculpt !== null ? sculpt : {}), jaw: 1.3 },
  };
  const edited = await must(
    "edit",
    doc,
    "--base",
    "head",
    "--summary",
    "Stronger jaw",
    "--op",
    JSON.stringify({ op: "feature.set", feature: "character.appearance", value: jawEdit }),
    "--request-id",
    "canary-person-jaw-0001",
  );
  step("personJawEdit", { revision: field(edited, "revision"), jaw: 1.3 });

  // 2. Pair one agent and bind it to the one authorized thread.
  const paired = await must("pair", agent, "--name", "Canary A");
  step("pairing", {
    pairingId: field(paired, "pairingId"),
    credentialFile: field(paired, "credentialFile"),
  });
  if (live && midTurn && field(await must("t3", "status"), "usable") !== true)
    throw new Error("Mid-turn verification needs the person's T3 grant before sending.");
  await must(
    "route",
    agent,
    "--t3-thread",
    thread,
    "--t3-project",
    t3Project,
    ...(midTurn ? ["--mid-turn"] : []),
  );
  const recipients = await must("recipients", agent);
  step("recipientCheck", field(recipients, 0));
  if (live && field(recipients, 0, "availability", "state") !== "ready")
    throw new Error("the thread is not ready; nothing was sent");

  if (live && midTurn && field(recipients, 0, "availability", "conversation", "busy") !== true)
    throw new Error("Mid-turn verification needs a busy paired conversation before sending.");

  // 3. The steering message. It never states the brow value.
  const text =
    "IRUDD_STEER_CANARY: use my earlier brow choice. Build on my manual jaw change in this document.";
  const sent = await cli("send", agent, text, "--doc", doc, "--request-id", requestId);
  step("sendResult", { code: sent.code, value: sent.value, stderr: sent.stderr });
  const messageId = String(field(sent.value, "messageId"));
  if (!live && process.platform === "win32") {
    // The agent's side, as the message tells it: the launcher with its credential path.
    const credential = String(field(paired, "credentialFile"));
    const inbox = await new Promise<string>((resolve) => {
      execFile(
        "cmd.exe",
        ["/d", "/s", "/c", `""${launcher}" inbox --credential "${credential}" --json"`],
        { env: process.env, windowsHide: true, windowsVerbatimArguments: true },
        (_error, stdout) => resolve(stdout),
      );
    });
    let ids: unknown = null;
    try {
      const value: unknown = JSON.parse(inbox);
      const list = field(value, "messages");
      ids = Array.isArray(list) ? list.map((m) => field(m, "messageId")) : null;
    } catch {
      ids = inbox.slice(0, 400);
    }
    step("dryAgentInbox", { launcher, inbox: ids });
  }

  // 4. Host acceptance, then the agent's own steps, each recorded once.
  const deadline = Date.now() + (live ? waitMs : 5_000);
  const seen = new Set<string>();
  for (;;) {
    const message = await must("message", messageId);
    const status = String(field(message, "status"));
    if (!seen.has(status)) {
      seen.add(status);
      step(`status:${status}`, {
        at: new Date().toISOString(),
        delivery: field(message, "delivery"),
        acknowledged: field(message, "acknowledged"),
        report: field(message, "report"),
        review: field(message, "review"),
        applied: field(message, "applied"),
      });
    }
    if (["proposed", "applied", "failed", "revoked", "cancelled"].includes(status)) break;
    if (Date.now() > deadline) {
      step("timeout", { status });
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  step("proposals", await must("proposals", doc));
  step("outbox", await must("outbox"));
  process.stdout.write(`evidence: ${evidenceFile}\n`);
} finally {
  host.kill();
}
