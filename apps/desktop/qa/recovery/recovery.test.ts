import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, before, test } from "node:test";
import {
  activate,
  appDirectoryOf,
  buildDirectory,
  linkNames,
  prune,
  readLink,
  readState,
  repair,
  rollback,
  stateFile,
  type InstallationState,
} from "../../src/main/update/installation.js";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const register = pathToFileURL(
  path.resolve(desktop, "..", "..", "packages", "document", "test", "support", "register.ts"),
).href;
const activator = path.join(desktop, "src", "main", "update", "activate.ts");
const system = process.env["SystemRoot"] ?? "C:\\Windows";
const scratch = mkdtempSync(path.join(tmpdir(), "irudd-recovery-test-"));
const launcherDirectory = path.join(scratch, "launchers");
after(() => rmSync(scratch, { recursive: true, force: true }));

before(() => {
  mkdirSync(launcherDirectory);
  const compiler = path.join(system, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
  for (const cli of [false, true])
    execFileSync(
      compiler,
      [
        "/nologo",
        "/platform:x64",
        cli ? "/target:exe" : "/target:winexe",
        ...(cli ? ["/define:IRUDD_CLI"] : []),
        `/out:${path.join(launcherDirectory, cli ? "irudd.exe" : "Irudd Workshop.exe")}`,
        path.join(desktop, "installer", "launcher.cs"),
      ],
      { stdio: ["ignore", "pipe", "inherit"], windowsHide: true },
    );
});

const commit = (n: number): string => String(n).repeat(40).slice(0, 40);
let roots = 0;
const newRoot = (): string => path.join(scratch, `root-${++roots}`);

function fakeBuild(root: string, id: string, launcherMark = "1"): string {
  const build = buildDirectory(root, id);
  const app = appDirectoryOf(build);
  mkdirSync(path.join(app, "bin"), { recursive: true });
  mkdirSync(path.join(app, "dist", "clients"), { recursive: true });
  const runtime = path.join(build, "Irudd Workshop", "Irudd Workshop.exe");
  try {
    linkSync(process.execPath, runtime);
  } catch {
    copyFileSync(process.execPath, runtime);
  }
  for (const file of ["Irudd Workshop.exe", "irudd.exe"])
    writeFileSync(
      path.join(app, "bin", file),
      Buffer.concat([readFileSync(path.join(launcherDirectory, file)), Buffer.from(launcherMark)]),
    );
  writeFileSync(
    path.join(app, "dist", "clients", "irudd.mjs"),
    `if (process.argv[2] === "hold") { console.log("holding"); setInterval(() => {}, 1000); }\n` +
      `else console.log(${JSON.stringify(id)});\n`,
  );
  writeFileSync(
    path.join(app, "package.json"),
    JSON.stringify({
      name: "irudd-workshop",
      iruddInstallation: {
        root,
        commit: id,
        branch: "main",
        origin: "C:\\o.git",
        vp: "C:\\vp.exe",
      },
    }),
  );
  return build;
}

function launch(root: string, ...args: string[]): Promise<{ code: number | null; out: string }> {
  return new Promise((done) => {
    const child = spawn(path.join(root, "bin", "irudd.exe"), args, { windowsHide: true });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.once("error", (error) => done({ code: -1, out: String(error) }));
    child.once("close", (code) => done({ code, out: out.trim() }));
  });
}

function startActivator(args: string[], pause: string): ChildProcess {
  return spawn(process.execPath, ["--import", register, activator, ...args], {
    env: { ...process.env, IRUDD_ACTIVATION_PAUSE: pause },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

async function pausedAt(root: string, args: string[], step: string): Promise<ChildProcess> {
  const child = startActivator(args, step);
  let errors = "";
  child.stderr?.on("data", (chunk: Buffer) => (errors += chunk.toString()));
  const marker = path.join(root, `.paused-${step}`);
  const deadline = Date.now() + 30_000;
  while (!existsSync(marker)) {
    assert.equal(child.exitCode, null, `the activator exited before ${step}: ${errors}`);
    assert.ok(Date.now() < deadline, `the activator never reached ${step}: ${errors}`);
    await sleep(20);
  }
  return child;
}

async function killAt(root: string, args: string[], step: string): Promise<void> {
  const child = await pausedAt(root, args, step);
  const exited = new Promise((done) => child.once("exit", done));
  execFileSync(path.join(system, "System32", "taskkill.exe"), ["/PID", String(child.pid), "/F"], {
    stdio: "ignore",
  });
  await exited;
  rmSync(path.join(root, `.paused-${step}`), { force: true });
}

function leftovers(root: string): string[] {
  const found = readdirSync(root).filter(
    (entry) => /^\.(current|previous|prepared)-/.test(entry) || entry.startsWith(".installation-"),
  );
  for (const entry of readdirSync(path.join(root, "bin")))
    if (entry.endsWith(".new")) found.push(`bin\\${entry}`);
  return found;
}

function assertWhole(root: string, expected: InstallationState): void {
  assert.deepEqual(readState(root), expected);
  for (const name of linkNames)
    assert.equal(readLink(root, name)?.split(path.sep).pop(), expected[name], `${name} junction`);
  assert.deepEqual(leftovers(root), []);
  assert.ok(expected.current);
  for (const file of ["Irudd Workshop.exe", "irudd.exe"]) {
    const placed = path.join(root, file === "irudd.exe" ? "bin" : "", file);
    const shipped = path.join(appDirectoryOf(buildDirectory(root, expected.current)), "bin", file);
    assert.ok(readFileSync(placed).equals(readFileSync(shipped)), `${file} is the current build's`);
  }
}

async function installedTwice(root: string): Promise<string> {
  await activate(root, fakeBuild(root, commit(1), "a"));
  await activate(root, fakeBuild(root, commit(2), "b"));
  return fakeBuild(root, commit(3), "c");
}

test("a kill at any step of an activation leaves the old or the new build, and the next step completes it", async () => {
  const steps = [
    "locked",
    "committed",
    "launcher-Irudd Workshop.exe",
    "launcher-irudd.exe",
    "mirror-aside-previous",
    "mirror-aside-current",
    "converged",
  ];
  const timings: string[] = [];
  for (const step of steps) {
    const root = newRoot();
    const c = await installedTwice(root);
    await killAt(root, ["activate", root, c], step);
    const switched = step !== "locked";
    const expected = switched
      ? { current: commit(3), previous: commit(2) }
      : { current: commit(2), previous: commit(1) };
    assert.deepEqual(readState(root), expected, `state after a kill at ${step}`);
    const launched = await launch(root, "version");
    assert.deepEqual(launched, { code: 0, out: expected.current }, `launch after ${step}`);
    const started = performance.now();
    await repair(root, { wait: 0 });
    timings.push(`${step} ${Math.round(performance.now() - started)} ms`);
    assertWhole(root, expected);
    await activate(root, c);
    assertWhole(root, { current: commit(3), previous: commit(2) });
  }
  console.log(`  repaired after kills: ${timings.join(", ")}`);
});

test("interrupted twice, then repaired: the last committed step wins", async () => {
  const root = newRoot();
  const c = await installedTwice(root);
  await killAt(root, ["activate", root, c], "mirror-aside-current");
  assert.equal(readLink(root, "current"), undefined, "the reviewer's state: no current junction");
  await killAt(root, ["rollback", root], "committed");
  assert.deepEqual((await launch(root, "version")).out, commit(2));
  await killAt(root, ["activate", root, c], "locked");
  await repair(root, { wait: 0 });
  assertWhole(root, { current: commit(2), previous: commit(3) });
});

test("a live owner keeps the lock; nobody deletes it; a killed owner frees it at once", async () => {
  const root = newRoot();
  await installedTwice(root);
  const owner = await pausedAt(root, ["rollback", root], "locked");
  await assert.rejects(rollback(root, { wait: 300 }), /Another update step is running/);
  assert.deepEqual(await prune(root), [], "pruning skips while another step runs");
  assert.deepEqual(readState(root), { current: commit(2), previous: commit(1) });
  const done = new Promise<number | null>((resolve) => owner.once("exit", resolve));
  writeFileSync(path.join(root, ".paused-locked.continue"), "");
  assert.equal(await done, 0, "the owner finishes its rollback");
  rmSync(path.join(root, ".paused-locked"));
  rmSync(path.join(root, ".paused-locked.continue"));
  assertWhole(root, { current: commit(1), previous: commit(2) });

  await killAt(root, ["rollback", root], "locked");
  const started = performance.now();
  await rollback(root, { wait: 0 });
  assert.ok(performance.now() - started < 2_000, "no wait for a dead owner");
  assertWhole(root, { current: commit(2), previous: commit(1) });
});

test("the preview's stale lock directory and half-switched junctions are repaired", async () => {
  const root = newRoot();
  const a = fakeBuild(root, commit(4));
  const b = fakeBuild(root, commit(5));
  mkdirSync(path.join(root, "bin"), { recursive: true });
  copyFileSync(
    path.join(appDirectoryOf(a), "bin", "irudd.exe"),
    path.join(root, "bin", "irudd.exe"),
  );
  symlinkSync(a, path.join(root, "previous"), "junction");
  symlinkSync(b, path.join(root, ".current-11111111-2222-3333-4444-555555555555"), "junction");
  symlinkSync(a, path.join(root, ".current-11111111-2222-3333-4444-555555555555.old"), "junction");
  const lock = path.join(root, ".activation-lock");
  mkdirSync(lock);
  await assert.rejects(repair(root, { wait: 300 }), /Another update step is running/);
  assert.ok(existsSync(lock), "a recent lock may still have a live owner");
  const old = new Date(Date.now() - 60_000);
  utimesSync(lock, old, old);
  await repair(root, { wait: 0 });
  assert.ok(!existsSync(lock));
  assert.ok(existsSync(path.join(root, stateFile)));
  assertWhole(root, { current: commit(5), previous: commit(4) });
  assert.deepEqual(await launch(root, "version"), { code: 0, out: commit(5) });
  assert.ok(lstatSync(a).isDirectory() && lstatSync(b).isDirectory(), "no build was touched");
});

test("launches racing switches always start a whole build; a running launcher is replaced later", async () => {
  const root = newRoot();
  const c = await installedTwice(root);
  const holder = spawn(path.join(root, "bin", "irudd.exe"), ["hold"], { stdio: "pipe" });
  await new Promise((done) => holder.stdout.once("data", done));
  await activate(root, c);
  const placed = readFileSync(path.join(root, "bin", "irudd.exe"));
  assert.ok(!placed.equals(readFileSync(path.join(appDirectoryOf(c), "bin", "irudd.exe"))));
  assert.equal((await launch(root, "version")).out, commit(3));
  let switching = true;
  const switches = (async () => {
    let count = 0;
    for (; count < 12; count++) {
      await rollback(root);
      await sleep(40);
    }
    switching = false;
    return count;
  })();
  const results: { code: number | null; out: string }[] = [];
  while (switching)
    results.push(...(await Promise.all([1, 2, 3, 4].map(() => launch(root, "version")))));
  assert.equal(await switches, 12);
  assert.ok(results.length >= 4);
  for (const result of results)
    assert.ok(
      result.code === 0 && [commit(2), commit(3)].includes(result.out),
      JSON.stringify(result),
    );
  const exited = new Promise((done) => holder.once("exit", done));
  execFileSync(
    path.join(system, "System32", "taskkill.exe"),
    ["/PID", String(holder.pid), "/T", "/F"],
    {
      stdio: "ignore",
    },
  );
  await exited;
  await prune(root);
  assertWhole(root, readState(root));
  console.log(`  ${results.length} launches during 12 switches, all whole`);
});
