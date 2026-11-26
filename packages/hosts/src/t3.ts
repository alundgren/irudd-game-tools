import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { baseEnvironment, runProcess, type ProcessResult } from "./process/run.js";
import { callT3Tool, findT3Server, readT3Grant, usableGrant } from "./t3-mcp.js";
import type {
  DeliveryOutcome,
  DeliveryRequest,
  RecipientRoute,
  RouteCheck,
  SteeringTransport,
} from "./types.js";

export interface T3Launcher {
  readonly executable: string;
  readonly script: string;
  readonly env: Readonly<Record<string, string>>;
  readonly source: string;
}

export interface T3Options {
  readonly launcher?: T3Launcher;
  readonly home?: string;
  readonly sendTimeoutMs?: number;
  readonly checkTimeoutMs?: number;
  readonly grantFile?: string;
}

const turns: Readonly<Record<string, "mid-turn" | "next-turn" | "new-turn" | "restarted">> = {
  steered: "mid-turn",
  queued: "next-turn",
  started: "new-turn",
  restarted: "restarted",
};

const threadId = /^[A-Za-z0-9][A-Za-z0-9:%._~-]{0,511}$/;

export function findT3Launcher(home = defaultHome()): T3Launcher | undefined {
  const bin = path.join(home, "bin");
  const candidates =
    process.platform === "win32" ? [path.join(bin, "t3.cmd")] : [path.join(bin, "t3")];
  for (const file of candidates) {
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const run =
      /^"([^"\r\n]+)" "([^"\r\n]+\.mjs)" %\*\s*$/m.exec(text) ??
      /^\s*(?:exec\s+)?"([^"\r\n]+)" "([^"\r\n]+\.mjs)" "\$@"\s*$/m.exec(text);
    const executable = run?.[1];
    const script = run?.[2];
    if (!executable || !script || !fs.existsSync(executable) || !scriptExists(script)) continue;
    const env: Record<string, string> = {
      T3CODE_CLI_PATH: file,
      T3CODE_HOME: home,
    };
    if (/ELECTRON_RUN_AS_NODE=1/.test(text)) env["ELECTRON_RUN_AS_NODE"] = "1";
    if (/T3CODE_DESKTOP_CLI_LAUNCHER=1/.test(text)) env["T3CODE_DESKTOP_CLI_LAUNCHER"] = "1";
    return { executable, script, env, source: file };
  }
  return undefined;
}

function scriptExists(script: string): boolean {
  if (fs.existsSync(script)) return true;
  const archive = /^(.*?\.asar)[\\/]/i.exec(script)?.[1];
  return (
    archive !== undefined && fs.statSync(archive, { throwIfNoEntry: false })?.isFile() === true
  );
}

function defaultHome(): string {
  return process.env["T3CODE_HOME"] ?? path.join(os.homedir(), ".t3");
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function lastJson(stdout: string): Record<string, unknown> | undefined {
  const lines = stdout.split(/\r?\n/).filter((line) => line.trim().startsWith("{"));
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const value: unknown = JSON.parse(lines[i] ?? "");
      if (isRecord(value)) return value;
    } catch {}
  }
  return undefined;
}

function firstLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? ""
  ).slice(0, 400);
}

function notSent(stderr: string): boolean {
  return /No running T3 Code server uses|is not a thread id|The message is empty|does not hold a JSON Schema/.test(
    stderr,
  );
}

function missingThread(stderr: string): boolean {
  return /not found|does not exist|no thread|unknown thread|archived/i.test(stderr);
}

const str = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
};

export function t3ThreadTransport(options: T3Options = {}): SteeringTransport {
  const home = options.home ?? defaultHome();
  const launcher = () => options.launcher ?? findT3Launcher(home);
  const grant = () => {
    if (!options.grantFile) return undefined;
    const stored = readT3Grant(options.grantFile);
    return stored && usableGrant(stored, findT3Server(home)) ? stored : undefined;
  };
  const run = (
    found: T3Launcher,
    args: ReadonlyArray<string>,
    stdin: string | undefined,
    timeoutMs: number,
  ): Promise<ProcessResult> =>
    runProcess({
      executable: found.executable,
      args: [found.script, ...args],
      ...(stdin === undefined ? {} : { stdin }),
      env: { ...baseEnvironment(), ...found.env, T3CODE_HOME: home },
      timeoutMs,
    });
  const precheck = (route: RecipientRoute): string | undefined => {
    if (route.transport !== "t3-thread") return "Not a T3 thread route.";
    if (route.environment !== "local")
      return `irudd reaches only this machine's T3 server; environment ${route.environment} is not supported yet.`;
    if (!threadId.test(route.conversation)) return `${route.conversation} is not a T3 thread ID.`;
    return undefined;
  };

  return {
    transport: "t3-thread",

    async check(route): Promise<RouteCheck> {
      const problem = precheck(route);
      if (problem) return { state: "gone", push: false, summary: problem, conversation: null };
      if (route.transport !== "t3-thread")
        return { state: "gone", push: false, summary: "Not a T3 route.", conversation: null };
      const found = launcher();
      if (!found)
        return {
          state: "offline",
          push: false,
          summary: `T3 Code's t3 command is not installed under ${home}.`,
          conversation: null,
        };
      const result = await run(
        found,
        ["thread", "show", route.conversation, "--messages", "0", "--json"],
        undefined,
        options.checkTimeoutMs ?? 15_000,
      );
      if (result.kind === "not-started")
        return { state: "offline", push: false, summary: result.detail, conversation: null };
      if (result.code !== 0 || result.timedOut) {
        const reason = firstLine(result.stderr) || `t3 exited with ${String(result.code)}`;
        return {
          state: missingThread(result.stderr) ? "gone" : "offline",
          push: false,
          summary: result.timedOut ? "T3 Code did not answer in time." : reason,
          conversation: null,
        };
      }
      const reply = lastJson(result.stdout);
      const thread = reply && isRecord(reply["thread"]) ? reply["thread"] : undefined;
      if (!thread)
        return {
          state: "offline",
          push: false,
          summary: "T3 Code answered with an unexpected shape.",
          conversation: null,
        };
      const status = str(thread, "status") ?? "unknown";
      const project = str(thread, "projectId");
      const provider = str(thread, "providerInstanceId");
      const model = str(thread, "model");
      const busy = thread["activeRunId"] !== null && thread["activeRunId"] !== undefined;
      const pending =
        typeof thread["pendingRequestCount"] === "number" ? thread["pendingRequestCount"] : 0;
      const conversation = {
        status,
        busy,
        ...(provider === undefined ? {} : { provider }),
        ...(model === undefined ? {} : { model }),
        ...(project === undefined ? {} : { project }),
      };
      if (str(thread, "threadId") !== route.conversation)
        return {
          state: "gone",
          push: false,
          summary: "T3 Code answered for another thread.",
          conversation: null,
        };
      if (thread["archived"] === true)
        return { state: "gone", push: false, summary: "The thread is archived.", conversation };
      if (route.project !== undefined && project !== undefined && project !== route.project)
        return {
          state: "gone",
          push: false,
          summary: `The thread belongs to T3 project ${project}, not ${route.project}.`,
          conversation,
        };
      const midTurn = route.delivery === "mid-turn";
      const connected = grant() !== undefined;
      return {
        state: "ready",
        push: true,
        summary: busy
          ? midTurn && connected
            ? `T3 thread is ${status}; T3 steers the message into the running turn when its provider supports that, otherwise queues it.`
            : midTurn
              ? `T3 thread is ${status}; mid-turn delivery needs "irudd t3 connect", so a message is queued as its next turn.`
              : `T3 thread is ${status}; a message is queued as its next turn.`
          : pending > 0
            ? `T3 thread waits for ${pending} answer(s); a message is queued for it.`
            : `T3 thread is ${status}; a message starts its next turn.`,
        conversation,
      };
    },

    async deliver(request: DeliveryRequest): Promise<DeliveryOutcome> {
      const route = request.route;
      const problem = precheck(route);
      if (problem || route.transport !== "t3-thread")
        return { kind: "rejected", detail: problem ?? "Not a T3 route." };
      const connected = grant();
      if (connected) return sendOverMcp(connected.origin, connected.accessToken, request);
      const found = launcher();
      if (!found)
        return { kind: "offline", detail: `T3 Code's t3 command is not installed under ${home}.` };
      const result = await run(
        found,
        ["thread", "send", route.conversation, "-", "--json"],
        request.prompt,
        options.sendTimeoutMs ?? 30_000,
      );
      if (result.kind === "not-started") return { kind: "offline", detail: result.detail };
      if (result.timedOut)
        return { kind: "unknown", detail: "t3 thread send did not finish in time." };
      const reply = lastJson(result.stdout);
      if (result.code === 0 && reply) {
        const sentTo = str(reply, "threadId");
        const hostMessageId = str(reply, "messageId");
        const runId = str(reply, "runId");
        const delivery = str(reply, "delivery");
        if (sentTo !== route.conversation)
          return {
            kind: "unknown",
            detail: `T3 Code reported thread ${sentTo ?? "(none)"} instead of ${route.conversation}.`,
          };
        return {
          kind: "accepted",
          receipt: {
            transport: "t3-thread",
            ...(hostMessageId === undefined ? {} : { hostMessageId }),
            ...(runId === undefined ? {} : { runId }),
            ...(delivery === undefined ? {} : { delivery }),
            ...(delivery !== undefined && turns[delivery] ? { turn: turns[delivery] } : {}),
            via: "t3-cli",
            at: Date.now(),
          },
        };
      }
      const reason = firstLine(result.stderr) || `t3 exited with ${String(result.code)}`;
      if (notSent(result.stderr)) return { kind: "offline", detail: reason };
      if (missingThread(result.stderr)) return { kind: "rejected", detail: reason };
      return { kind: "unknown", detail: reason };
    },
  };
}

async function sendOverMcp(
  origin: string,
  accessToken: string,
  request: DeliveryRequest,
): Promise<DeliveryOutcome> {
  const route = request.route;
  if (route.transport !== "t3-thread") return { kind: "rejected", detail: "Not a T3 route." };
  const result = await callT3Tool(
    origin,
    accessToken,
    "t3_thread_send",
    {
      threadId: route.conversation,
      message: request.prompt,
      mode: route.delivery === "mid-turn" ? "auto" : "queue",
      clientRequestId: request.messageId,
    },
    30_000,
  );
  switch (result.kind) {
    case "unauthorized":
      return { kind: "rejected", detail: result.detail };
    case "not-sent":
      return { kind: "offline", detail: result.detail };
    case "unknown":
      return {
        kind: "unknown",
        detail: `${result.detail} Resending is safe: T3 deduplicates by the message ID.`,
      };
    case "answered":
      break;
  }
  if (result.isError) {
    const detail = result.text || "T3 Code refused the message.";
    return { kind: "rejected", detail };
  }
  const reply = isRecord(result.structured) ? result.structured : undefined;
  const sentTo = reply ? str(reply, "threadId") : undefined;
  if (!reply || sentTo !== route.conversation)
    return {
      kind: "unknown",
      detail: `T3 Code reported thread ${sentTo ?? "(none)"} instead of ${route.conversation}.`,
    };
  const hostMessageId = str(reply, "messageId");
  const runId = str(reply, "runId");
  const delivery = str(reply, "delivery");
  const turn = delivery === undefined ? undefined : turns[delivery];
  return {
    kind: "accepted",
    receipt: {
      transport: "t3-thread",
      ...(hostMessageId === undefined ? {} : { hostMessageId }),
      ...(runId === undefined ? {} : { runId }),
      ...(delivery === undefined ? {} : { delivery }),
      ...(turn === undefined ? {} : { turn }),
      via: "t3-mcp",
      at: Date.now(),
    },
  };
}
