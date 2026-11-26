import { spawn } from "node:child_process";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";

const system = (): string => process.env["SystemRoot"] ?? "C:\\Windows";
const powerShell = (): string =>
  path.join(system(), "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

function environment(extra: Readonly<Record<string, string>>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env))
    if (value !== undefined && name !== "ELECTRON_RUN_AS_NODE") env[name] = value;
  Object.assign(env, extra);
  env["GIT_TERMINAL_PROMPT"] = "0";
  return env;
}

interface RunOptions {
  readonly cwd: string;
  readonly signal: AbortSignal;
  readonly env?: Readonly<Record<string, string>>;
  readonly onOutput?: (tail: string) => void;
}

function run(command: string, args: ReadonlyArray<string>, options: RunOptions): Promise<string> {
  options.signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: environment(options.env ?? {}),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    let killing: Promise<void> | undefined;
    const receive = (chunk: string): void => {
      output = (output + stripVTControlCharacters(chunk)).slice(-16_000);
      options.onOutput?.(output);
    };
    child.stdout.setEncoding("utf8").on("data", receive);
    child.stderr.setEncoding("utf8").on("data", receive);
    const abort = (): void => {
      if (child.pid === undefined) return;
      killing = new Promise((done) => {
        const killer = spawn(
          path.join(system(), "System32", "taskkill.exe"),
          ["/PID", String(child.pid), "/T", "/F"],
          { stdio: "ignore", windowsHide: true },
        );
        killer.once("error", () => {
          child.kill();
          done();
        });
        killer.once("close", () => done());
      });
    };
    options.signal.addEventListener("abort", abort, { once: true });
    child.once("error", reject);
    child.once("close", (code) => {
      void (async () => {
        await killing;
        options.signal.removeEventListener("abort", abort);
        if (options.signal.aborted)
          reject(new Error("Stopped before it finished: canceled or timed out."));
        else if (code !== 0) reject(new Error(output.trim() || `Exited with code ${code}.`));
        else resolve(output.trim());
      })();
    });
  });
}

export async function remoteHead(
  source: string,
  branch: string,
  signal: AbortSignal,
): Promise<string> {
  const reply = await run("git", ["ls-remote", "origin", `refs/heads/${branch}`], {
    cwd: source,
    signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
  });
  const match = /^([0-9a-f]{40})\s+refs\/heads\//m.exec(reply);
  if (!match?.[1]) throw new Error(`The origin has no branch ${branch}.`);
  return match[1];
}

export function prepareBuild(
  installer: string,
  commit: string,
  env: Readonly<Record<string, string>>,
  cwd: string,
  signal: AbortSignal,
  onOutput: (tail: string) => void,
): Promise<string> {
  return run(
    powerShell(),
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      installer,
      "-Prepare",
      commit,
    ],
    {
      cwd,
      env,
      signal: AbortSignal.any([signal, AbortSignal.timeout(45 * 60_000)]),
      onOutput,
    },
  );
}

export function activateBuild(build: string, root: string): Promise<string> {
  return run(
    path.join(build, "Irudd Workshop", "Irudd Workshop.exe"),
    [
      path.join(build, "Irudd Workshop", "resources", "app", "dist", "update", "activate.mjs"),
      "activate",
      root,
      build,
    ],
    {
      cwd: root,
      env: { ELECTRON_RUN_AS_NODE: "1" },
      signal: AbortSignal.timeout(120_000),
    },
  );
}

export function relaunch(launcher: string, args: ReadonlyArray<string>): void {
  const child = spawn(launcher, ["--wait-pid", String(process.pid), ...args], {
    detached: true,
    stdio: "ignore",
    env: environment({}),
    windowsHide: false,
  });
  child.unref();
}
