import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { chromium, type Browser, type Page } from "@playwright/test";
import { appDir } from "./electron.js";

const { values } = parseArgs({
  options: { keep: { type: "boolean" }, overlay: { type: "string", multiple: true } },
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
});
if (process.platform !== "win32") throw new Error("The installer rehearsal runs on Windows.");
const repository = resolve(appDir, "..", "..");
const scratch = mkdtempSync(join(tmpdir(), "irudd-install-rehearsal-"));
const origin = join(scratch, "origin.git");
const work = join(scratch, "work");
const root = join(scratch, "install");
const programs = join(scratch, "start-menu");
const userData = join(scratch, "user-data");
const stateDir = join(scratch, "state");
const project = join(scratch, "projects", "rehearsal");
const exports = join(scratch, "exports");
const app = "Irudd Workshop";
const launcher = join(root, `${app}.exe`);
const cli = join(root, "bin", "irudd.exe");
const results: { step: string; ms: number; detail?: string }[] = [];

const vp = (() => {
  const found = spawnSync("where.exe", ["vp.exe"], { encoding: "utf8" }).stdout.split(/\r?\n/)[0];
  if (!found) throw new Error("The rehearsal builds with the Vite+ on PATH (vp.exe).");
  return found.trim();
})();

function personal(): { path: string; menu: string[] } {
  const reg = spawnSync("reg.exe", ["query", "HKCU\\Environment", "/v", "Path"], {
    encoding: "utf8",
  }).stdout;
  const menuDir = join(
    process.env["APPDATA"] ?? "",
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
  );
  const menu = existsSync(menuDir) ? readdirSync(menuDir).filter((n) => /irudd/i.test(n)) : [];
  return { path: reg, menu };
}
const before = personal();

const installEnv: Record<string, string> = {
  IRUDD_INSTALL_ROOT: root,
  IRUDD_REPOSITORY: origin,
  IRUDD_BRANCH: "main",
  IRUDD_VP: vp,
  IRUDD_START_MENU: programs,
  IRUDD_NO_PATH: "1",
  IRUDD_NO_LAUNCH: "1",
};
function env(extra: Record<string, string> = {}): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env))
    if (value !== undefined && name !== "ELECTRON_RUN_AS_NODE" && !name.startsWith("IRUDD_"))
      next[name] = value;
  return {
    ...next,
    ...installEnv,
    IRUDD_STATE_DIR: stateDir,
    IRUDD_LAUNCHER_QUIET: "1",
    GIT_TERMINAL_PROMPT: "0",
    ...extra,
  };
}

async function step<T>(name: string, run: () => Promise<T> | T, detail?: (v: T) => string) {
  const started = performance.now();
  try {
    const value = await run();
    const ms = Math.round(performance.now() - started);
    const text = detail?.(value);
    results.push({ step: name, ms, ...(text ? { detail: text } : {}) });
    console.log(`ok   ${name} (${(ms / 1000).toFixed(1)} s)${text ? ` ${text}` : ""}`);
    return value;
  } catch (error) {
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

const gitIn = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8", env: env() }).trim();

function commitAll(message: string): string {
  gitIn(work, "add", "-A");
  gitIn(
    work,
    "-c",
    "user.name=Install rehearsal",
    "-c",
    "user.email=rehearsal@invalid",
    "commit",
    "--quiet",
    "-m",
    message,
  );
  gitIn(work, "push", "--quiet", "origin", "HEAD:main");
  return gitIn(work, "rev-parse", "HEAD");
}

function runCli(args: string[], extra: Record<string, string> = {}): string {
  const reply = spawnSync(cli, args, { encoding: "utf8", env: env(extra), timeout: 120_000 });
  if (reply.status !== 0)
    throw new Error(
      `irudd ${args.join(" ")} exited ${reply.status}: ${reply.stderr}${reply.stdout}`,
    );
  return reply.stdout.trim();
}
const cliBuild = (): string => {
  const reply: unknown = JSON.parse(runCli(["version", "--json"]));
  assert.ok(typeof reply === "object" && reply !== null && "build" in reply);
  return String(reply.build);
};

function link(name: string): string | undefined {
  const file = join(root, name);
  try {
    if (!lstatSync(file).isSymbolicLink()) return undefined;
  } catch {
    return undefined;
  }
  return readlinkSync(file)
    .replace(/^\\\\\?\\/, "")
    .replace(/[\\/]+$/, "");
}
const linkCommit = (name: string): string | undefined => {
  const target = link(name);
  return target ? target.split(/[\\/]/).pop() : undefined;
};
function leftovers(): string[] {
  const builds = join(root, "builds");
  return existsSync(builds) ? readdirSync(builds).filter((n) => n.startsWith(".")) : [];
}
function roles(): Record<string, string | null> {
  const value: unknown = JSON.parse(readFileSync(join(root, "installation.json"), "utf8"));
  assert.ok(typeof value === "object" && value !== null);
  const result: Record<string, string | null> = {};
  for (const name of ["current", "previous", "prepared"]) {
    const commit: unknown = Reflect.get(value, name);
    result[name] = typeof commit === "string" ? commit : null;
  }
  return result;
}
const strays = (): string[] =>
  readdirSync(root).filter((n) =>
    /^.(current|previous|prepared)-|^.installation-|^.paused-/.test(n),
  );

function activatorAt(commit: string, args: string[], pause: string): ChildProcess {
  const build = join(root, "builds", commit, app);
  return spawn(
    join(build, `${app}.exe`),
    [join(build, "resources", "app", "dist", "update", "activate.mjs"), ...args],
    {
      env: env({ ELECTRON_RUN_AS_NODE: "1", IRUDD_ACTIVATION_PAUSE: pause }),
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    },
  );
}
async function pausedAt(child: ChildProcess, step: string): Promise<void> {
  let errors = "";
  child.stderr?.on("data", (chunk: Buffer) => (errors += chunk.toString()));
  const deadline = Date.now() + 60_000;
  while (!existsSync(join(root, `.paused-${step}`))) {
    if (child.exitCode !== null) throw new Error(`The activator exited before ${step}: ${errors}`);
    if (Date.now() > deadline) throw new Error(`The activator never reached ${step}: ${errors}`);
    await new Promise((done) => setTimeout(done, 25));
  }
}
async function kill(child: ChildProcess, step: string): Promise<void> {
  if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise((done) => child.once("exit", done));
    child.kill("SIGKILL");
    await exited;
  }
  rmSync(join(root, `.paused-${step}`), { force: true });
}
async function until(check: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${what}`);
    await new Promise((done) => setTimeout(done, 250));
  }
}

async function withGpu<T>(run: () => Promise<T>): Promise<T> {
  const holder = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$m=[Threading.Mutex]::new($false,'Local\\ShapeFirstWorkshopBrowser'); try { [void]$m.WaitOne() } catch [Threading.AbandonedMutexException] {}; [Console]::Out.WriteLine('held'); [void][Console]::In.ReadLine(); $m.ReleaseMutex()",
    ],
    { stdio: ["pipe", "pipe", "inherit"] },
  );
  await new Promise<void>((done, fail) => {
    holder.stdout.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("held")) done();
    });
    holder.once("exit", () => fail(new Error("The GPU lock holder exited.")));
  });
  try {
    return await run();
  } finally {
    holder.stdin.end("\n");
  }
}

async function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => done(typeof address === "object" && address ? address.port : 0));
    });
  });
}
const port = await freePort();
const switches = ["--hidden", `--remote-debugging-port=${port}`, "--user-data", userData];
const offlineSwitches = [
  "--proxy-server=http://127.0.0.1:9",
  "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1",
];

interface Window {
  readonly browser: Browser;
  readonly page: Page;
}
let window: Window | undefined;

async function attach(previous?: string): Promise<Window> {
  const deadline = Date.now() + 120_000;
  let endpoint: string | undefined;
  while (Date.now() < deadline) {
    try {
      const reply = await fetch(`http://127.0.0.1:${port}/json/version`);
      const body: unknown = await reply.json();
      const url =
        typeof body === "object" && body !== null && "webSocketDebuggerUrl" in body
          ? String(body.webSocketDebuggerUrl)
          : undefined;
      if (url && url !== previous) {
        endpoint = url;
        break;
      }
    } catch {}
    await new Promise((done) => setTimeout(done, 250));
  }
  if (!endpoint) throw new Error("The app did not open its DevTools endpoint.");
  const browser = await chromium.connectOverCDP(endpoint);
  let page: Page | undefined;
  while (!page && Date.now() < deadline) {
    page = browser
      .contexts()
      .flatMap((c) => c.pages())
      .find((p) => p.url().endsWith("/renderer/index.html"));
    if (!page) await new Promise((done) => setTimeout(done, 250));
  }
  if (!page) throw new Error("The editor window did not appear.");
  await page.waitForSelector("body[data-ready=true]", { timeout: 60_000 });
  return { browser, page };
}

function open(args: string[]): void {
  const at = performance.now();
  const started = spawnSync(launcher, [...switches, ...args], { env: env(), timeout: 30_000 });
  if (performance.now() - at > 10_000) throw new Error("The launcher waited for the app.");
  if (started.status !== 0) throw new Error(`The launcher failed: ${started.stderr.toString()}`);
}

async function endpointUrl(): Promise<string | undefined> {
  try {
    const body: unknown = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    return typeof body === "object" && body !== null && "webSocketDebuggerUrl" in body
      ? String(body.webSocketDebuggerUrl)
      : undefined;
  } catch {
    return undefined;
  }
}

async function closeWindow(): Promise<void> {
  if (!window) return;
  await window.page.evaluate(() => globalThis.close()).catch(() => undefined);
  await window.browser.close().catch(() => undefined);
  window = undefined;
  const deadline = Date.now() + 30_000;
  while ((await endpointUrl()) && Date.now() < deadline)
    await new Promise((done) => setTimeout(done, 250));
}

interface Status {
  readonly phase: string;
  readonly message: string;
  readonly current?: string;
  readonly next?: string;
  readonly previous?: string;
  readonly output?: string;
}
function isStatus(value: unknown): value is Status {
  return typeof value === "object" && value !== null && "phase" in value && "message" in value;
}
async function bridge(method: string, arg?: unknown): Promise<unknown> {
  if (!window) throw new Error("No window.");
  return window.page.evaluate(
    async ([name, value]) => {
      const api: unknown = Reflect.get(globalThis, "workshop");
      const fn: unknown =
        typeof api === "object" && api !== null ? Reflect.get(api, name) : undefined;
      if (typeof fn !== "function") throw new Error(`window.workshop.${name} is missing.`);
      const reply: unknown = await Reflect.apply(fn, api, value === undefined ? [] : [value]);
      return reply;
    },
    [method, arg] as const,
  );
}

async function update(action: string): Promise<Status> {
  if (!window) throw new Error("No window.");
  const status = await bridge("update", action);
  if (!isStatus(status)) throw new Error("The update bridge returned an unexpected status.");
  return status;
}
async function waitPhase(phases: string[], timeoutMs: number): Promise<Status> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await update("status");
    if (phases.includes(status.phase)) return status;
    if (Date.now() > deadline)
      throw new Error(
        `Still ${status.phase}: ${status.message} ${status.output?.slice(-1500) ?? ""}`,
      );
    await new Promise((done) => setTimeout(done, 1000));
  }
}
async function windowBuild(): Promise<string> {
  if (!window) throw new Error("No window.");
  const info = await bridge("app");
  assert.ok(typeof info === "object" && info !== null && "build" in info);
  return String(info.build);
}
async function projectInfo(): Promise<string> {
  if (!window) throw new Error("No window.");
  const state = await bridge("projectState");
  const directory: unknown =
    typeof state === "object" && state !== null && "project" in state && state.project
      ? Reflect.get(state.project, "directory")
      : undefined;
  return String(directory);
}

async function reopen(action: "restart" | "rollback"): Promise<void> {
  if (!window) throw new Error("No window.");
  const previous = await endpointUrl();
  await bridge("update", action).catch(() => undefined);
  await window.browser.close().catch(() => undefined);
  window = await attach(previous);
}

class Mcp {
  private readonly child: ChildProcess;
  private buffer = "";
  private readonly waiting = new Map<number, (reply: Record<string, unknown>) => void>();
  private id = 0;
  constructor(credential: string) {
    this.child = spawn(cli, ["mcp", "--credential", credential], {
      env: env(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
      this.buffer += chunk;
      let newline;
      while ((newline = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (!line) continue;
        const message: unknown = JSON.parse(line);
        if (typeof message === "object" && message !== null && "id" in message) {
          const resolveReply = this.waiting.get(Number(message.id));
          if (resolveReply) resolveReply({ ...message });
        }
      }
    });
  }
  request(method: string, params: unknown): Promise<Record<string, unknown>> {
    const id = ++this.id;
    return new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error(`MCP ${method} timed out.`)), 60_000);
      this.waiting.set(id, (reply) => {
        clearTimeout(timer);
        done(reply);
      });
      this.child.stdin?.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  async version(): Promise<string> {
    const reply = await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "install-rehearsal", version: "1" },
    });
    this.child.stdin?.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n",
    );
    const result = reply["result"];
    const info: unknown =
      typeof result === "object" && result !== null ? Reflect.get(result, "serverInfo") : undefined;
    return String(typeof info === "object" && info !== null ? Reflect.get(info, "version") : "");
  }
  async status(): Promise<string> {
    const reply = await this.request("tools/call", { name: "workshop_status", arguments: {} });
    if (reply["error"]) throw new Error(JSON.stringify(reply["error"]));
    return JSON.stringify(reply["result"]).slice(0, 300);
  }
  close(): Promise<void> {
    return new Promise((done) => {
      this.child.once("exit", () => done());
      this.child.stdin?.end();
      setTimeout(() => this.child.kill(), 10_000).unref();
    });
  }
}

async function agreeOn(expected: string, credential: string, label: string): Promise<string> {
  const gui = await windowBuild();
  const fromCli = cliBuild();
  const mcp = new Mcp(credential);
  try {
    const fromMcp = await mcp.version();
    await mcp.status();
    assert.equal(gui, expected, `${label}: the window runs ${gui}`);
    assert.equal(fromCli, expected, `${label}: the CLI runs ${fromCli}`);
    assert.equal(fromMcp, expected, `${label}: the MCP server runs ${fromMcp}`);
  } finally {
    await mcp.close();
  }
  return expected.slice(0, 12);
}

let failed = false;
try {
  const A = await step(
    "create the local origin at A",
    () => {
      const branch = gitIn(repository, "rev-parse", "--abbrev-ref", "HEAD");
      execFileSync("git", [
        "clone",
        "--quiet",
        "--bare",
        "--single-branch",
        "--branch",
        branch,
        repository,
        origin,
      ]);
      if (branch !== "main") gitIn(origin, "branch", "-m", branch, "main");
      gitIn(origin, "symbolic-ref", "HEAD", "refs/heads/main");
      execFileSync("git", ["clone", "--quiet", origin, work]);
      const overlay = values.overlay ?? [];
      if (overlay.length === 0) return gitIn(work, "rev-parse", "HEAD");
      const changed = execFileSync(
        "git",
        ["status", "--porcelain", "--untracked-files=all", "--", ...overlay],
        { cwd: repository, encoding: "utf8" },
      )
        .split("\n")
        .filter(Boolean);
      for (const line of changed) {
        const file = line.slice(3).replace(/^.* -> /, "");
        const from = join(repository, file);
        const to = join(work, file);
        if (existsSync(from)) {
          mkdirSync(dirname(to), { recursive: true });
          copyFileSync(from, to);
        } else rmSync(to, { force: true });
      }
      return commitAll("Rehearsal A: overlay of the working tree");
    },
    (c) => c.slice(0, 12),
  );

  await step("install A fresh (cold)", () => {
    const run = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "$ErrorActionPreference = 'Stop'; Get-Content -LiteralPath $env:IRUDD_TEST_BOOTSTRAP -Raw | Invoke-Expression",
      ],
      {
        cwd: scratch,
        env: { ...env(), IRUDD_TEST_BOOTSTRAP: join(work, "install.ps1") },
        encoding: "utf8",
        timeout: 60 * 60_000,
      },
    );
    if (run.status !== 0)
      throw new Error(
        `install.ps1 failed:\n${run.stdout.slice(-4000)}\n${run.stderr.slice(-4000)}`,
      );
    assert.equal(linkCommit("current"), A);
    assert.ok(existsSync(launcher) && existsSync(cli), "launchers at the root");
    assert.equal(link("prepared"), undefined);
  });

  await step(
    "inventory: only the runtime and built outputs",
    () => {
      const resources = join(root, "builds", A, app, "resources", "app");
      const files: string[] = [];
      const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true }))
          if (entry.isDirectory()) walk(join(dir, entry.name));
          else files.push(relative(resources, join(dir, entry.name)).split(sep).join("/"));
      };
      walk(resources);
      const bad = files.filter((f) =>
        /(?:^|\/)(?:node_modules|src|test|scripts|examples|verification|\.reference-cache)\/|\.(?:ts|map|py|glb|sqlite)$|mhr|benchmark|reference-fits|body-fits/i.test(
          f,
        ),
      );
      assert.deepEqual(bad, [], "no development or private files");
      const player = readFileSync(join(resources, "player", "player.html"), "utf8");
      assert.ok(
        !/(?:src|href)=["']https?:/i.test(player),
        "the player loads nothing from the network",
      );
      return files.length;
    },
    (n) => `${n} files`,
  );

  await step("Start menu entries point at the launcher (private folder)", () => {
    const shortcuts = readdirSync(programs).sort();
    assert.deepEqual(shortcuts, ["Irudd Player.lnk", "Irudd Workshop.lnk"]);
    const read = (name: string): string =>
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${join(programs, name)}'); $s.TargetPath + '|' + $s.Arguments`,
        ],
        { encoding: "utf8" },
      ).trim();
    assert.equal(read("Irudd Workshop.lnk").toLowerCase(), `${launcher}|`.toLowerCase());
    assert.equal(read("Irudd Player.lnk").toLowerCase(), `${launcher}|"--player"`.toLowerCase());
  });

  const credential = await step(
    "open A through the launcher on a new project; CLI pairs an agent",
    async () => {
      mkdirSync(dirname(project), { recursive: true });
      open(["--project", project, "--create"]);
      window = await attach();
      assert.equal(resolve(await projectInfo()).toLowerCase(), project.toLowerCase());
      runCli(["new", "doc-rehearsal01", "--starter", "harbour-trader", "--project", project]);
      const paired: unknown = JSON.parse(
        runCli(["pair", "rehearsal-agent", "--project", project, "--json"]),
      );
      assert.ok(typeof paired === "object" && paired !== null && "credentialFile" in paired);
      return String(paired.credentialFile);
    },
  );
  await step(
    "A: window, CLI and MCP report one build",
    () => agreeOn(A, credential, "A"),
    (s) => s,
  );
  const revisionOf = (): string => {
    const shown: unknown = JSON.parse(
      runCli(["show", "doc-rehearsal01", "--project", project, "--json"]),
    );
    assert.ok(typeof shown === "object" && shown !== null);
    const revision: unknown = Reflect.get(shown, "revision");
    const documentDigest: unknown = Reflect.get(shown, "documentDigest");
    assert.equal(typeof revision, "number");
    assert.match(String(documentDigest), /^sha256:[0-9a-f]{64}$/);
    return `${String(revision)} ${String(documentDigest)}`;
  };
  const revisionA = revisionOf();

  await step(
    "offline: start without origin or network, export a GLB on the GPU",
    async () => {
      await closeWindow();
      renameSync(origin, `${origin}.away`);
      try {
        open(["--project", project, ...offlineSwitches]);
        window = await attach();
        const status = await waitPhase(["error"], 120_000);
        assert.equal(status.current, A);
        const glb = join(exports, "offline.glb");
        await withGpu(async () => {
          runCli([
            "export",
            "doc-rehearsal01",
            "--project",
            project,
            "--preset",
            "game",
            "--out",
            glb,
          ]);
        });
        const bytes = readFileSync(glb);
        assert.equal(bytes.subarray(0, 4).toString("latin1"), "glTF");
        await closeWindow();
        return `${status.phase}: ${status.message}; GLB ${bytes.byteLength} bytes`;
      } finally {
        renameSync(`${origin}.away`, origin);
      }
    },
    (s) => s,
  );

  const B = commitAll(
    (() => {
      appendFileSync(join(work, "docs", "desktop-dependencies.md"), "\n<!-- rehearsal B -->\n");
      return "Rehearsal B";
    })(),
  );
  await step("stage B in the background while the window keeps working (warm build)", async () => {
    open(["--project", project]);
    window = await attach();
    await update("check");
    const building = await waitPhase(["building", "ready", "error"], 120_000);
    assert.notEqual(building.phase, "error", building.output ?? "");
    if (building.phase === "building") {
      runCli(["status", "--project", project]);
      await bridge("projectState");
    }
    const ready = await waitPhase(["ready", "error"], 45 * 60_000);
    assert.equal(ready.phase, "ready", ready.output ?? "");
    assert.equal(ready.next, B);
    assert.equal(linkCommit("prepared"), B);
    assert.equal(linkCommit("current"), A, "staging leaves A current");
    assert.equal(await windowBuild(), A, "the window keeps running A");
  });
  await step(
    "restart into B on the same project; data intact",
    async () => {
      await reopen("restart");
      assert.equal(resolve(await projectInfo()).toLowerCase(), project.toLowerCase());
      assert.equal(linkCommit("current"), B);
      assert.equal(linkCommit("previous"), A);
      assert.equal(link("prepared"), undefined);
      assert.equal(revisionOf(), revisionA, "the document kept its head");
      return agreeOn(B, credential, "B");
    },
    (s) => s,
  );

  const C = commitAll(
    (() => {
      appendFileSync(
        join(work, "apps", "desktop", "src", "main", "main.ts"),
        "\nthis is not TypeScript;\n",
      );
      return "Rehearsal C: a commit that does not build";
    })(),
  );
  await step(
    "a failing build leaves B in use",
    async () => {
      await update("check");
      const status = await waitPhase(["error", "ready"], 45 * 60_000);
      assert.equal(status.phase, "error");
      assert.ok((status.output ?? "").length > 0, "the failure carries the build log");
      assert.equal(linkCommit("current"), B);
      assert.equal(link("prepared"), undefined);
      assert.ok(!existsSync(join(root, "builds", C)), "no build of C");
      assert.deepEqual(leftovers(), []);
      assert.equal(cliBuild(), B);
      await bridge("projectState");
      return status.message;
    },
    (s) => s,
  );

  const D = commitAll(
    (() => {
      const main = join(work, "apps", "desktop", "src", "main", "main.ts");
      writeFileSync(main, readFileSync(main, "utf8").replace("\nthis is not TypeScript;\n", ""));
      appendFileSync(join(work, "docs", "desktop-dependencies.md"), "<!-- rehearsal D -->\n");
      return "Rehearsal D";
    })(),
  );
  await step(
    "cancel a running build: B stays, nothing left behind",
    async () => {
      await update("check");
      await waitPhase(["building"], 120_000);
      const started = Date.now();
      for (;;) {
        const status = await update("status");
        assert.equal(status.phase, "building", status.message);
        if (/Installing build dependencies/.test(status.output ?? "")) break;
        assert.ok(Date.now() - started < 120_000, "the build never reached its dependency install");
        await new Promise((done) => setTimeout(done, 100));
      }
      const canceled = await update("cancel");
      assert.equal(canceled.phase, "idle", canceled.message);
      assert.match(canceled.message, /canceled/i);
      const deadline = Date.now() + 30_000;
      while (
        (leftovers().length > 0 || existsSync(join(root, ".install-lock"))) &&
        Date.now() < deadline
      )
        await new Promise((done) => setTimeout(done, 500));
      assert.equal(linkCommit("current"), B);
      assert.equal(link("prepared"), undefined);
      assert.ok(!existsSync(join(root, "builds", D)), "no build of D");
      return `leftovers after kill: ${JSON.stringify(leftovers())}, lock ${existsSync(join(root, ".install-lock"))}`;
    },
    (s) => s,
  );
  await step("retry stages D", async () => {
    await update("check");
    const ready = await waitPhase(["ready", "error"], 45 * 60_000);
    assert.equal(ready.phase, "ready", ready.output ?? "");
    assert.equal(ready.next, D);
    assert.equal(ready.previous, A);
  });
  await step(
    "roll back to A on the same project; data intact",
    async () => {
      await reopen("rollback");
      assert.equal(resolve(await projectInfo()).toLowerCase(), project.toLowerCase());
      assert.equal(linkCommit("current"), A);
      assert.equal(linkCommit("previous"), B);
      assert.equal(revisionOf(), revisionA);
      return agreeOn(A, credential, "rollback");
    },
    (s) => s,
  );
  await step(
    "the reopened A offers D again; restart into D",
    async () => {
      const ready = await waitPhase(["ready", "error"], 10 * 60_000);
      assert.equal(ready.phase, "ready", ready.output ?? "");
      assert.equal(ready.next, D);
      await reopen("restart");
      assert.equal(linkCommit("current"), D);
      assert.equal(linkCommit("previous"), A);
      assert.deepEqual(roles(), { current: D, previous: A, prepared: null });
      return agreeOn(D, credential, "D");
    },
    (s) => s,
  );
  await step(
    "a switch killed between its junction renames: the launcher starts the committed version and the app completes it",
    async () => {
      await closeWindow();
      const step = "mirror-aside-current";
      const rolling = activatorAt(D, ["rollback", root], step);
      try {
        await pausedAt(rolling, step);
      } finally {
        await kill(rolling, step);
      }
      assert.deepEqual(
        roles(),
        { current: A, previous: D, prepared: null },
        "the rollback committed",
      );
      assert.equal(link("current"), undefined, "no current junction, as the review found");
      assert.ok(strays().length > 0, "the killed switch left its temporary junctions");
      const reopened = performance.now();
      open(["--project", project]);
      window = await attach();
      assert.equal(await windowBuild(), A);
      assert.equal(cliBuild(), A);
      await until(
        () => linkCommit("current") === A && strays().length === 0,
        30_000,
        "the app's repair",
      );
      assert.equal(linkCommit("previous"), D);
      assert.equal(revisionOf(), revisionA);
      return `opened and repaired in ${((performance.now() - reopened) / 1000).toFixed(1)} s`;
    },
    (s) => s,
  );
  await step(
    "a live update step keeps the lock; once its owner is killed, Check and Restart update normally",
    async () => {
      const offered = await waitPhase(["ready", "error"], 10 * 60_000);
      assert.equal(offered.phase, "ready", offered.output ?? "");
      assert.equal(offered.next, D);
      const step = "locked";
      const owner = activatorAt(A, ["repair", root], step);
      try {
        await pausedAt(owner, step);
        const refused = await update("rollback");
        assert.equal(refused.phase, "error");
        assert.match(refused.output ?? "", /Another update step is running/);
        assert.equal(owner.exitCode, null, "the owner is still alive and still holds the lock");
        assert.deepEqual(roles(), { current: A, previous: D, prepared: D });
      } finally {
        await kill(owner, step);
      }
      void update("check");
      const ready = await waitPhase(["ready", "error"], 10 * 60_000);
      assert.equal(ready.phase, "ready", ready.output ?? "");
      assert.equal(ready.next, D);
      await reopen("restart");
      assert.deepEqual(roles(), { current: D, previous: A, prepared: null });
      assert.equal(linkCommit("current"), D);
      assert.deepEqual(strays(), []);
      assert.equal(revisionOf(), revisionA);
      return agreeOn(D, credential, "after the killed owner");
    },
    (s) => s,
  );
  await closeWindow();

  await step("the person's Start menu and PATH are unchanged", () => {
    const after = personal();
    assert.equal(after.path, before.path);
    assert.deepEqual(after.menu, before.menu);
  });
} catch {
  failed = true;
} finally {
  await closeWindow().catch(() => undefined);
  const report = join(scratch, "rehearsal.json");
  writeFileSync(report, JSON.stringify({ scratch, port, results, failed }, null, 2) + "\n");
  console.log(`Report: ${report}`);
  if (!values.keep && !failed) {
    for (const name of ["current", "previous", "prepared"])
      rmSync(join(root, name), { force: true });
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5 });
  } else console.log(`Kept ${scratch}`);
  const total = results.reduce((sum, r) => sum + r.ms, 0);
  console.log(`${failed ? "FAILED" : "Passed"} after ${(total / 1000).toFixed(0)} s of steps.`);
  process.exitCode = failed ? 1 : 0;
}
