import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { createServer, type Server } from "node:net";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export const appFolder = "Irudd Workshop";
export const appExecutable = "Irudd Workshop.exe";
export const launchers = [
  { file: "Irudd Workshop.exe", target: "Irudd Workshop.exe" },
  { file: "irudd.exe", target: path.join("bin", "irudd.exe") },
] as const;

const commitPattern = /^[0-9a-f]{40}$/;
export const linkNames = ["current", "previous", "prepared"] as const;
export type LinkName = (typeof linkNames)[number];
export type InstallationState = Partial<Record<LinkName, string>>;

export const stateFile = "installation.json";
const legacyLock = ".activation-lock";
const legacyLockStaleMs = 30_000;

export type Observe = (step: string) => void | Promise<void>;
export interface OperationOptions {
  readonly observe?: Observe;
  readonly wait?: number;
}

export interface Installation {
  readonly activationVersion?: 1;
  readonly root: string;
  readonly commit: string;
  readonly branch: string;
  readonly origin: string;
  readonly vp: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function codeOf(error: unknown): unknown {
  return error instanceof Error && "code" in error ? error.code : undefined;
}

export function readInstallation(appDirectory: string): Installation | undefined {
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(path.join(appDirectory, "package.json"), "utf8"));
  } catch {
    return undefined;
  }
  if (!isRecord(manifest)) return undefined;
  const value = manifest["iruddInstallation"];
  if (!isRecord(value)) return undefined;
  const { root, commit, branch, origin, vp, activationVersion } = value;
  if (activationVersion !== undefined && activationVersion !== 1)
    throw new Error(
      "This build uses a newer installation protocol. Run its installer to activate it.",
    );
  if (
    typeof root !== "string" ||
    !path.win32.isAbsolute(root) ||
    typeof commit !== "string" ||
    !commitPattern.test(commit) ||
    typeof branch !== "string" ||
    !/^[\w./-]{1,200}$/.test(branch) ||
    typeof origin !== "string" ||
    origin.length === 0 ||
    typeof vp !== "string" ||
    !path.win32.isAbsolute(vp)
  )
    throw new Error("The installation record is invalid. Run install.ps1 again.");
  return {
    root,
    commit,
    branch,
    origin,
    vp,
    ...(activationVersion === 1 ? { activationVersion } : {}),
  };
}

export function buildDirectory(root: string, commit: string): string {
  return path.join(root, "builds", commit);
}

export function appDirectoryOf(build: string): string {
  return path.join(build, appFolder, "resources", "app");
}

function key(file: string): string {
  return path.resolve(file).toLowerCase();
}

export function samePath(left: string, right: string): boolean {
  return key(left) === key(right);
}

export function commitOf(root: string, build: string): string {
  const name = path.basename(build);
  if (!samePath(path.dirname(build), path.join(root, "builds")) || !commitPattern.test(name))
    throw new Error(`${build} is not a build of this installation.`);
  return name;
}

export function validateBuild(root: string, build: string): Installation {
  const commit = commitOf(root, build);
  if (!existsSync(path.join(build, appFolder, appExecutable)))
    throw new Error(`The build ${commit.slice(0, 12)} is incomplete. Run install.ps1 again.`);
  const installation = readInstallation(appDirectoryOf(build));
  if (!installation || installation.commit !== commit || !samePath(installation.root, root))
    throw new Error(`The build ${commit.slice(0, 12)} belongs to another installation or commit.`);
  return installation;
}

function stripNamespace(target: string): string {
  if (target.startsWith("\\\\?\\UNC\\")) return `\\\\${target.slice(8)}`;
  return target.startsWith("\\\\?\\") ? target.slice(4) : target;
}

function removeLink(file: string): void {
  try {
    unlinkSync(file);
  } catch (error) {
    const code = codeOf(error);
    if (code === "ENOENT") return;
    if (code !== "EISDIR" && code !== "EPERM" && code !== "ERR_FS_EISDIR") throw error;
    rmdirSync(file);
  }
}

function junctionTarget(file: string): string | undefined {
  let stat;
  try {
    stat = lstatSync(file);
  } catch {
    return undefined;
  }
  if (!stat.isSymbolicLink())
    throw new Error(`${file} is not an installation link. Move it aside and retry.`);
  return path.resolve(stripNamespace(readlinkSync(file)).replace(/[\\/]+$/, ""));
}

export function readLink(root: string, name: LinkName): string | undefined {
  return junctionTarget(path.join(root, name));
}

function commitIn(root: string, target: string | undefined): string | undefined {
  if (target === undefined) return undefined;
  try {
    return commitOf(root, target);
  } catch {
    return undefined;
  }
}

const strayLink = /^\.(current|previous|prepared)-[0-9a-f-]{36}(\.old)?$/;

function legacyState(root: string): InstallationState {
  const state: InstallationState = {};
  for (const name of linkNames) {
    const commit = commitIn(root, readLink(root, name));
    if (commit) state[name] = commit;
  }
  if (state.current) return state;
  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    return state;
  }
  const strays = entries
    .map((entry) => ({ entry, match: strayLink.exec(entry) }))
    .filter(({ match }) => match?.[1] === "current")
    .sort((left, right) => Number(Boolean(left.match?.[2])) - Number(Boolean(right.match?.[2])));
  for (const { entry } of strays) {
    const commit = commitIn(root, junctionTarget(path.join(root, entry)));
    if (commit && existsSync(path.join(buildDirectory(root, commit), appFolder, appExecutable))) {
      state.current = commit;
      break;
    }
  }
  return state;
}

function parseState(text: string): InstallationState {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value) || value["version"] !== 1)
    throw new Error(`${stateFile} has an unknown format. Run install.ps1 again.`);
  const state: InstallationState = {};
  for (const name of linkNames) {
    const commit = value[name];
    if (commit === undefined || commit === null) continue;
    if (typeof commit !== "string" || !commitPattern.test(commit))
      throw new Error(`${stateFile} names an invalid ${name} build. Run install.ps1 again.`);
    state[name] = commit;
  }
  return state;
}

export function readState(root: string): InstallationState {
  let text: string;
  try {
    text = readFileSync(path.join(root, stateFile), "utf8");
  } catch (error) {
    if (codeOf(error) === "ENOENT") return legacyState(root);
    throw error;
  }
  return parseState(text);
}

export function buildOf(root: string, name: LinkName): string | undefined {
  const commit = readState(root)[name];
  return commit === undefined ? undefined : buildDirectory(root, commit);
}

async function renameRetrying(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      const code = codeOf(error);
      if (attempt >= 40 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw error;
      await sleep(50);
    }
  }
}

async function writeState(root: string, state: InstallationState): Promise<void> {
  const record = {
    version: 1,
    current: state.current ?? null,
    previous: state.previous ?? null,
    prepared: state.prepared ?? null,
  };
  const temporary = path.join(root, `.installation-${randomUUID()}.tmp`);
  const handle = openSync(temporary, "wx");
  try {
    writeSync(handle, `${JSON.stringify(record, null, 2)}\n`);
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  try {
    await renameRetrying(temporary, path.join(root, stateFile));
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

async function pointLink(
  root: string,
  name: LinkName,
  build: string | undefined,
  observe: Observe | undefined,
): Promise<void> {
  const link = path.join(root, name);
  const existing = readLink(root, name);
  if (build === undefined) {
    if (existing !== undefined) removeLink(link);
    return;
  }
  if (existing !== undefined && samePath(existing, build)) return;
  commitOf(root, build);
  const temporary = path.join(root, `.${name}-${randomUUID()}`);
  const aside = `${temporary}.old`;
  symlinkSync(build, temporary, "junction");
  try {
    if (existing !== undefined) {
      renameSync(link, aside);
      await observe?.(`mirror-aside-${name}`);
    }
    renameSync(temporary, link);
  } finally {
    removeLink(temporary);
    removeLink(aside);
  }
}

function ownLauncher(file: string): boolean {
  try {
    return readFileSync(file).includes(Buffer.from("Irudd Workshop launcher v1", "utf16le"));
  } catch {
    return false;
  }
}

function sameBytes(left: string, right: string): boolean {
  try {
    return readFileSync(left).equals(readFileSync(right));
  } catch {
    return false;
  }
}

function checkLaunchers(root: string): void {
  for (const launcher of launchers) {
    const target = path.join(root, launcher.target);
    if (existsSync(target) && !ownLauncher(target))
      throw new Error(`${target} is not this installation's launcher. Move it aside and retry.`);
  }
}

async function placeLauncher(
  root: string,
  build: string,
  launcher: (typeof launchers)[number],
  observe: Observe | undefined,
): Promise<void> {
  const source = path.join(appDirectoryOf(build), "bin", launcher.file);
  const target = path.join(root, launcher.target);
  if (sameBytes(source, target)) return;
  if (existsSync(target) && !ownLauncher(target))
    throw new Error(`${target} is not this installation's launcher. Move it aside and retry.`);
  mkdirSync(path.dirname(target), { recursive: true });
  const staged = `${target}.${randomUUID()}.new`;
  copyFileSync(source, staged);
  try {
    renameSync(staged, target);
  } catch (error) {
    const code = codeOf(error);
    if (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY") throw error;
  } finally {
    rmSync(staged, { force: true });
  }
  await observe?.(`launcher-${launcher.file}`);
}

function junctionOnlyBuild(root: string, state: InstallationState): boolean {
  if (!state.current) return false;
  const build = buildDirectory(root, state.current);
  if (!existsSync(path.join(build, appFolder, appExecutable))) return false;
  if (readInstallation(appDirectoryOf(build))?.activationVersion === 1) return false;
  const launcher = path.join(appDirectoryOf(build), "bin", appExecutable);
  return !readFileSync(launcher).includes(Buffer.from(stateFile, "utf16le"));
}

async function mirrorRoles(
  root: string,
  state: InstallationState,
  observe?: Observe,
): Promise<void> {
  for (const name of linkNames) {
    const commit = state[name];
    await pointLink(root, name, commit ? buildDirectory(root, commit) : undefined, observe);
  }
}

async function converge(
  root: string,
  state: InstallationState,
  observe: Observe | undefined,
): Promise<void> {
  if (state.current) {
    const current = buildDirectory(root, state.current);
    if (existsSync(path.join(current, appFolder, appExecutable))) {
      for (const launcher of launchers) await placeLauncher(root, current, launcher, observe);
    }
  }
  await mirrorRoles(root, state, observe);
  for (const entry of readdirSync(root)) {
    const file = path.join(root, entry);
    if (strayLink.test(entry) && lstatSync(file).isSymbolicLink()) removeLink(file);
    else if (/^\.installation-[0-9a-f-]{36}\.tmp$/.test(entry)) rmSync(file, { force: true });
  }
  for (const launcher of launchers) {
    const directory = path.dirname(path.join(root, launcher.target));
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory))
      if (entry.startsWith(`${launcher.file}.`) && entry.endsWith(".new"))
        rmSync(path.join(directory, entry), { force: true });
  }
  if (junctionOnlyBuild(root, state)) rmSync(path.join(root, stateFile), { force: true });
}

function lockName(root: string): string {
  const digest = createHash("sha256").update(key(root)).digest("hex").slice(0, 32);
  return `\\\\.\\pipe\\irudd-workshop-activation-${digest}`;
}

function listen(server: Server, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(name, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

const busy = (): Error =>
  new Error("Another update step is running for this installation. Wait for it and retry.");

async function clearLegacyLock(root: string, deadline: number): Promise<void> {
  const lock = path.join(root, legacyLock);
  for (;;) {
    let stat;
    try {
      stat = lstatSync(lock);
    } catch {
      return;
    }
    if (!stat.isDirectory())
      throw new Error(`${lock} is not a lock this app made. Move it aside and retry.`);
    if (Date.now() - stat.mtimeMs > legacyLockStaleMs) {
      rmdirSync(lock);
      return;
    }
    if (Date.now() > deadline) throw busy();
    await sleep(200);
  }
}

async function withLock<T>(
  root: string,
  options: OperationOptions,
  run: (state: InstallationState) => Promise<T>,
): Promise<T> {
  const deadline = Date.now() + (options.wait ?? 10_000);
  const name = lockName(root);
  let server: Server;
  for (;;) {
    server = createServer();
    try {
      await listen(server, name);
      break;
    } catch (error) {
      server.close();
      if (codeOf(error) !== "EADDRINUSE") throw error;
      if (Date.now() > deadline) throw busy();
      await sleep(100);
    }
  }
  try {
    await options.observe?.("locked");
    await clearLegacyLock(root, deadline);
    const state = readState(root);
    if (state.current && !existsSync(path.join(root, stateFile))) await writeState(root, state);
    await converge(root, state, undefined);
    return await run(state);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
}

async function commitState(
  root: string,
  next: InstallationState,
  observe: Observe | undefined,
): Promise<void> {
  if (junctionOnlyBuild(root, next)) {
    await mirrorRoles(root, next, observe);
    rmSync(path.join(root, stateFile), { force: true });
  } else await writeState(root, next);
  await observe?.("committed");
  await converge(root, next, observe);
  await observe?.("converged");
}

export async function repair(root: string, options: OperationOptions = {}): Promise<void> {
  await withLock(root, options, async () => {});
}

export async function prepare(
  root: string,
  build: string,
  options: OperationOptions = {},
): Promise<void> {
  validateBuild(root, build);
  const commit = commitOf(root, build);
  await withLock(root, options, async (state) => {
    if (state.prepared === commit) return;
    await commitState(root, { ...state, prepared: commit }, options.observe);
  });
}

export async function activate(
  root: string,
  build: string,
  options: OperationOptions = {},
): Promise<void> {
  validateBuild(root, build);
  const commit = commitOf(root, build);
  await withLock(root, options, async (state) => {
    checkLaunchers(root);
    const next: InstallationState = { ...state, current: commit };
    if (state.current && state.current !== commit) next.previous = state.current;
    if (state.prepared === commit) delete next.prepared;
    await commitState(root, next, options.observe);
  });
}

export async function rollback(root: string, options: OperationOptions = {}): Promise<string> {
  return withLock(root, options, async (state) => {
    if (!state.previous) throw new Error("There is no earlier version to return to.");
    const previous = buildDirectory(root, state.previous);
    validateBuild(root, previous);
    checkLaunchers(root);
    const next: InstallationState = { ...state, current: state.previous };
    if (state.current) next.previous = state.current;
    else delete next.previous;
    await commitState(root, next, options.observe);
    return previous;
  });
}

export async function prune(
  root: string,
  keep: ReadonlyArray<string> = [],
  options: OperationOptions = {},
): Promise<string[]> {
  try {
    return await withLock(root, { wait: 0, ...options }, async (state) => {
      const builds = path.join(root, "builds");
      const kept = new Set(keep.map(key));
      for (const name of linkNames) {
        const commit = state[name];
        if (commit) kept.add(key(buildDirectory(root, commit)));
      }
      const removed: string[] = [];
      let entries;
      try {
        entries = readdirSync(builds, { withFileTypes: true });
      } catch {
        return removed;
      }
      for (const entry of entries) {
        const directory = path.join(builds, entry.name);
        if (entry.isDirectory() && /^\.removing\.[0-9a-f]{32}$/.test(entry.name)) {
          rmSync(directory, { recursive: true, force: true });
          continue;
        }
        if (!entry.isDirectory() || !commitPattern.test(entry.name) || kept.has(key(directory)))
          continue;
        const removing = path.join(builds, `.removing.${randomUUID().replaceAll("-", "")}`);
        try {
          renameSync(directory, removing);
        } catch {
          continue;
        }
        await options.observe?.("pruning");
        rmSync(removing, { recursive: true, force: true });
        removed.push(entry.name);
      }
      for (const launcher of launchers) {
        const directory = path.dirname(path.join(root, launcher.target));
        if (!existsSync(directory)) continue;
        for (const name of readdirSync(directory))
          if (name.startsWith(`${launcher.file}.`) && name.endsWith(".old"))
            try {
              rmSync(path.join(directory, name), { force: true });
            } catch {}
      }
      return removed;
    });
  } catch (error) {
    if (error instanceof Error && error.message === busy().message) return [];
    throw error;
  }
}
