// Codex: queue steering for one saved Codex session with Codex's own CLI.
//
//   codex queue --thread <uuid> --message <text>
//
// Verified against codex-cli 0.172.0: the command sends `thread/queue/add` to an
// app server for that thread and fails with "no rollout found for thread id …"
// when the session does not exist. Without `--resume` it only queues: it never
// starts or resumes a turn, so this adapter never runs a model. A Codex TUI
// attached to the same app server sees the queue change (the protocol has a
// `thread/queue/changed` notification); a TUI with its own in-process server
// takes the queued message when the session next runs. Live pickup by an already
// running TUI is not verified here.
//
// The message is passed as one argument (Codex has no stdin form for queue);
// there is no shell, so it is never parsed as a command line.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { baseEnvironment, findOnPath, runProcess } from "./process/run.js";
import type { DeliveryOutcome, RouteCheck, SteeringTransport } from "./types.js";

export interface CodexOptions {
  /** The codex executable. Default: `codex` (codex.exe on Windows) on PATH. */
  readonly executable?: string;
  /** CODEX_HOME. Default: $CODEX_HOME or ~/.codex. */
  readonly home?: string;
  readonly timeoutMs?: number;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Whether a saved session (rollout file) with this ID exists. Reads file names only. */
export function codexSessionExists(home: string, id: string): boolean {
  const roots = [path.join(home, "sessions"), path.join(home, "archived_sessions")];
  const visit = (dir: string, depth: number): boolean => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.includes(id)) return true;
      if (entry.isDirectory() && depth < 4 && visit(path.join(dir, entry.name), depth + 1))
        return true;
    }
    return false;
  };
  return roots.some((root) => visit(root, 0));
}

export function codexQueueTransport(options: CodexOptions = {}): SteeringTransport {
  const home = options.home ?? process.env["CODEX_HOME"] ?? path.join(os.homedir(), ".codex");
  const executable = () => options.executable ?? findOnPath("codex");
  return {
    transport: "codex-queue",

    check(route): Promise<RouteCheck> {
      if (route.transport !== "codex-queue" || !uuid.test(route.conversation))
        return Promise.resolve({
          state: "gone",
          push: false,
          summary: "Not a Codex session route.",
          conversation: null,
        });
      if (!executable())
        return Promise.resolve({
          state: "offline",
          push: false,
          summary: "The codex command is not on PATH.",
          conversation: null,
        });
      if (!codexSessionExists(home, route.conversation))
        return Promise.resolve({
          state: "gone",
          push: false,
          summary: `No saved Codex session ${route.conversation} under ${home}.`,
          conversation: null,
        });
      return Promise.resolve({
        state: "ready",
        push: true,
        summary:
          "Codex queues the message for this session. A TUI on the same app server shows it; otherwise the session takes it when it next runs.",
        conversation: { status: "saved" },
      });
    },

    async deliver(request): Promise<DeliveryOutcome> {
      const route = request.route;
      if (route.transport !== "codex-queue" || !uuid.test(route.conversation))
        return { kind: "rejected", detail: "Not a Codex session route." };
      const program = executable();
      if (!program) return { kind: "offline", detail: "The codex command is not on PATH." };
      const result = await runProcess({
        executable: program,
        args: ["queue", "--thread", route.conversation, "--message", request.prompt],
        env: { ...baseEnvironment(), CODEX_HOME: home },
        timeoutMs: options.timeoutMs ?? 60_000,
      });
      if (result.kind === "not-started") return { kind: "offline", detail: result.detail };
      if (result.timedOut)
        return { kind: "unknown", detail: "codex queue did not finish in time." };
      if (result.code === 0)
        return {
          kind: "accepted",
          receipt: {
            transport: "codex-queue",
            delivery: "queued",
            turn: "next-turn",
            via: "codex-cli",
            at: Date.now(),
          },
        };
      const reason =
        result.stderr
          .split(/\r?\n/)
          .find((l) => l.trim())
          ?.trim()
          .slice(0, 400) ?? `codex exited with ${String(result.code)}`;
      if (/no rollout found|invalid thread/i.test(result.stderr))
        return { kind: "rejected", detail: reason };
      return { kind: "unknown", detail: reason };
    },
  };
}
