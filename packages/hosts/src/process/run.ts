import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface ProcessCall {
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly stdin?: string;
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly maxOutputBytes?: number;
}

export type ProcessResult =
  | { readonly kind: "not-started"; readonly detail: string }
  | {
      readonly kind: "exited";
      readonly code: number | null;
      readonly signal: string | null;
      readonly stdout: string;
      readonly stderr: string;
      readonly timedOut: boolean;
      readonly truncated: boolean;
      readonly ms: number;
    };

export class InvalidProcessCall extends Error {}

const inherited = [
  "PATH",
  "Path",
  "SystemRoot",
  "windir",
  "ComSpec",
  "USERPROFILE",
  "HOME",
  "LOCALAPPDATA",
  "APPDATA",
  "ProgramData",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERNAME",
  "USER",
  "LOGNAME",
  "COMPUTERNAME",
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
  "XDG_DATA_HOME",
  "XDG_RUNTIME_DIR",
  "LANG",
] as const;

export function baseEnvironment(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of inherited) {
    const value = source[key];
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

function validate(call: ProcessCall): void {
  if (!path.isAbsolute(call.executable))
    throw new InvalidProcessCall(`${call.executable} is not an absolute path.`);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(call.executable);
  } catch {
    throw new InvalidProcessCall(`${call.executable} does not exist.`);
  }
  if (!stat.isFile()) throw new InvalidProcessCall(`${call.executable} is not a file.`);
  if (/\.(cmd|bat|ps1)$/i.test(call.executable))
    throw new InvalidProcessCall(
      `${call.executable} needs a shell; adapters start the program itself.`,
    );
  for (const arg of call.args)
    if (arg.includes("\0")) throw new InvalidProcessCall("An argument contains a NUL byte.");
  for (const [key, value] of Object.entries(call.env))
    if (key.includes("=") || value.includes("\0"))
      throw new InvalidProcessCall(`Environment variable ${key} is malformed.`);
}

export function runProcess(call: ProcessCall): Promise<ProcessResult> {
  try {
    validate(call);
  } catch (error) {
    return Promise.resolve({
      kind: "not-started",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  const limit = call.maxOutputBytes ?? 4 * 1024 * 1024;
  const started = performance.now();
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(call.executable, [...call.args], {
        shell: false,
        windowsHide: true,
        env: { ...call.env },
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({
        kind: "not-started",
        detail: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let bytes = 0;
    let truncated = false;
    let timedOut = false;
    let spawned = false;
    const collect = (into: Buffer[]) => (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > limit) {
        truncated = true;
        child.kill();
        return;
      }
      into.push(chunk);
    };
    child.stdout?.on("data", collect(out));
    child.stderr?.on("data", collect(err));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, call.timeoutMs);
    child.once("spawn", () => {
      spawned = true;
      child.stdin?.end(call.stdin ?? "");
    });
    child.stdin?.on("error", () => undefined);
    child.once("error", (error) => {
      if (spawned) return;
      clearTimeout(timer);
      resolve({ kind: "not-started", detail: error.message });
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (!spawned) return;
      resolve({
        kind: "exited",
        code,
        signal,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        timedOut,
        truncated,
        ms: Math.round(performance.now() - started),
      });
    });
  });
}

export function findOnPath(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env["PATH"] ?? env["Path"] ?? "";
  const file = process.platform === "win32" ? `${name}.exe` : name;
  for (const dir of raw.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, file);
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  return undefined;
}
