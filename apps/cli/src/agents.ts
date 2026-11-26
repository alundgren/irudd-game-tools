import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

const serverName = "irudd";

interface AgentClient {
  readonly label: string;
  readonly executable: string;
  readonly add: (command: ReadonlyArray<string>) => ReadonlyArray<string>;
  readonly remove: ReadonlyArray<string>;
  readonly get: ReadonlyArray<string>;
}

const clients: ReadonlyArray<AgentClient> = [
  {
    label: "Claude Code",
    executable: "claude",
    add: (command) => ["mcp", "add", "--scope", "user", serverName, "--", ...command],
    remove: ["mcp", "remove", "--scope", "user", serverName],
    get: ["mcp", "get", serverName],
  },
  {
    label: "Codex",
    executable: "codex",
    add: (command) => ["mcp", "add", serverName, "--", ...command],
    remove: ["mcp", "remove", serverName],
    get: ["mcp", "get", serverName],
  },
];

export const agentsUsage = `Usage: irudd agents <connect|disconnect|status> [--command <file>]

Register the workshop MCP server with the agents on this machine, so every
Claude Code and Codex session can use the running Irudd Workshop without
pairing. The installer runs "irudd agents connect"; run it again after
installing one of those agents.

  connect      Add the server "${serverName}" to the user configuration of each
               installed agent, replacing an older "${serverName}" entry.
  disconnect   Remove the "${serverName}" entry this command added.
  status       Show which agents have it.

Options:
  --command <file>   The irudd launcher to register (default: the launcher
                     running this command).
  -h, --help         Show this help.
`;

function findExecutable(name: string): string | undefined {
  const extensions =
    process.platform === "win32"
      ? (process.env["PATHEXT"] ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean)
      : [""];
  for (const dir of (process.env["PATH"] ?? "").split(path.delimiter)) {
    if (!dir) continue;
    for (const extension of extensions) {
      const candidate = path.join(dir, name + extension.toLowerCase());
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {}
    }
  }
  return undefined;
}

const quote = (value: string) =>
  /[\s"&|<>^()]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

function run(executable: string, args: ReadonlyArray<string>): { code: number; output: string } {
  const result = /\.(cmd|bat)$/i.test(executable)
    ? spawnSync(
        process.env["ComSpec"] ?? "cmd.exe",
        ["/d", "/s", "/c", `"${[executable, ...args].map(quote).join(" ")}"`],
        { encoding: "utf8", windowsVerbatimArguments: true, timeout: 60_000 },
      )
    : spawnSync(executable, [...args], { encoding: "utf8", timeout: 60_000 });
  return {
    code: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}${result.error ? String(result.error) : ""}`,
  };
}

function serverCommand(launcher: string): ReadonlyArray<string> {
  return /\.(cmd|bat)$/i.test(launcher) ? ["cmd", "/c", launcher, "mcp"] : [launcher, "mcp"];
}

const normalized = (text: string) => text.replace(/\\/g, "/").toLowerCase();

export function runAgents(
  argv: ReadonlyArray<string>,
  out: (text: string) => void,
  err: (text: string) => void,
): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: { command: { type: "string" }, help: { type: "boolean", short: "h" } },
    });
  } catch (error) {
    err(
      `irudd agents: ${error instanceof Error ? error.message : String(error)}\n\n${agentsUsage}`,
    );
    return 2;
  }
  const action = parsed.positionals[0];
  if (parsed.values.help || action === undefined) {
    out(agentsUsage);
    return parsed.values.help ? 0 : 2;
  }
  if (!["connect", "disconnect", "status"].includes(action)) {
    err(`irudd agents: unknown action ${action}.\n\n${agentsUsage}`);
    return 2;
  }
  const launcherOption = parsed.values.command ?? process.env["IRUDD_AGENT_COMMAND"];
  if (action === "connect" && !launcherOption) {
    err("irudd agents: run this through the irudd launcher, or give --command <file>.");
    return 2;
  }
  const launcher = launcherOption ? path.resolve(launcherOption) : undefined;
  let failed = false;
  let found = 0;
  for (const client of clients) {
    const executable = findExecutable(client.executable);
    if (!executable) {
      out(`${client.label}: not installed.`);
      continue;
    }
    found++;
    const current = run(executable, client.get);
    const registered = current.code === 0;
    const ours =
      registered &&
      launcher !== undefined &&
      normalized(current.output).includes(normalized(launcher));
    if (action === "status") {
      out(
        `${client.label}: ${registered ? (ours || launcher === undefined ? "connected" : `has another "${serverName}" server`) : "not connected"}.`,
      );
      continue;
    }
    if (action === "disconnect") {
      if (!registered) {
        out(`${client.label}: not connected.`);
        continue;
      }
      if (!normalized(current.output).includes("irudd")) {
        out(`${client.label}: its "${serverName}" server is not Irudd Workshop; left it alone.`);
        continue;
      }
      const removed = run(executable, client.remove);
      if (removed.code === 0) out(`${client.label}: disconnected.`);
      else {
        failed = true;
        err(`${client.label}: could not remove "${serverName}": ${removed.output.trim()}`);
      }
      continue;
    }
    if (ours) {
      out(`${client.label}: already connected.`);
      continue;
    }
    if (registered) run(executable, client.remove);
    const added = run(executable, client.add(serverCommand(launcher ?? "irudd")));
    if (added.code === 0) out(`${client.label}: connected. New sessions can use Irudd Workshop.`);
    else {
      failed = true;
      err(`${client.label}: could not add "${serverName}": ${added.output.trim()}`);
    }
  }
  if (found === 0 && action === "connect")
    out("No Claude Code or Codex found on PATH. Install one, then run irudd agents connect.");
  return failed ? 1 : 0;
}
