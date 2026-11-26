import { app, BrowserWindow, dialog, ipcMain, session, type IpcMainInvokeEvent } from "electron";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { bundledAssets } from "@irudd/character/assets";
import { WorkshopError } from "@irudd/workshop/client";
import { packageExtension } from "@irudd/workshop/contract";
import {
  channels,
  type AppInfo,
  type CharacterFileOutcome,
  type CharacterProblem,
  type ExportRequest,
  type InspectionSave,
  type LibraryEntry,
  type ProjectState,
  type UpdateAction,
  type UpdateStatus,
  updateActions,
} from "../shared/api.js";
import { humanHosting, humanPackPaths, type HumanHosting } from "./human.js";
import { isGlb, Library, maxGlbBytes, safeName } from "./library.js";
import { isWindowMethod, openWorkshop, type WorkshopLink } from "./workshop.js";
import { registerReviewScheme, ReviewWorker } from "./review.js";
import { readInstallation } from "./update/installation.js";
import { Updater } from "./update/updates.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "..");
const rendererPage = path.join(dist, "renderer", "index.html");
const rendererUrl = pathToFileURL(rendererPage).href;
const preload = path.join(dist, "preload", "preload.cjs");
const formsDir = path.join(dist, "forms");

registerReviewScheme();

const { values: args } = parseArgs({
  args: process.argv.slice(app.isPackaged ? 1 : 2),
  options: {
    project: { type: "string" },
    create: { type: "boolean", default: false },
    hidden: { type: "boolean", default: false },
    "user-data": { type: "string" },
    open: { type: "string", multiple: true },
  },
  strict: false,
  allowPositionals: true,
});
const hidden = args.hidden === true;
if (typeof args["user-data"] === "string") app.setPath("userData", path.resolve(args["user-data"]));

function readBuild(): string {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(path.join(dist, "build.json"), "utf8"));
    if (typeof value === "object" && value !== null && "build" in value)
      return typeof value.build === "string" ? value.build : "unknown";
  } catch {}
  return "unknown";
}

let window: BrowserWindow | undefined;
let link: WorkshopLink | undefined;
let unsubscribe: (() => void) | undefined;
let lastError: string | undefined;
let untitled = false;
const unsaved = new Map<string, number>();
let generation = 0;

function canLeaveProject(): boolean {
  if (!untitled || unsaved.size === 0) return true;
  return (
    dialog.showMessageBoxSync({
      type: "question",
      message: "Discard unsaved character changes?",
      detail: "Use Save character to keep your work before leaving this untitled project.",
      buttons: ["Keep editing", "Discard changes"],
      defaultId: 0,
      cancelId: 0,
    }) === 1
  );
}

function exportDirectory(): string | undefined {
  return untitled ? path.join(app.getPath("documents"), "Irudd Workshop") : link?.directory;
}
let library: Library;
let reviewWorker: ReviewWorker | undefined;
let updater: Updater | undefined;
let hosting: Promise<HumanHosting> | undefined;
const assetsDir = path.join(dist, "assets");
const settingsFile = (): string => path.join(app.getPath("userData"), "settings.json");

function readRecent(): string[] {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
    if (
      typeof value === "object" &&
      value !== null &&
      "recent" in value &&
      Array.isArray(value.recent)
    )
      return value.recent.filter((v): v is string => typeof v === "string").slice(0, 10);
  } catch {}
  return [];
}

function remember(directory: string): void {
  const recent = [directory, ...readRecent().filter((d) => d !== directory)].slice(0, 10);
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify({ recent }, null, 2) + "\n");
}

function state(): ProjectState {
  return {
    project: link
      ? { directory: link.directory, label: link.label, mode: link.mode, untitled }
      : null,
    recent: readRecent(),
    ...(lastError === undefined ? {} : { error: lastError }),
  };
}

async function closeProject(): Promise<void> {
  unsubscribe?.();
  unsubscribe = undefined;
  const current = link;
  link = undefined;
  untitled = false;
  unsaved.clear();
  library.setProject(undefined);
  await current?.close();
}

async function openDirectory(
  directory: string,
  create: boolean,
  inMemory = false,
): Promise<ProjectState> {
  const resolved = path.resolve(directory);
  if (link?.directory === resolved || !canLeaveProject()) return state();
  try {
    hosting ??= humanHosting(assetsDir).catch((error: unknown) => {
      hosting = undefined;
      throw error;
    });
    const { registry, starters } = await hosting;
    const next = await openWorkshop({
      directory: resolved,
      forms: formsDir,
      registry,
      starters,
      ...(reviewWorker ? { review: reviewWorker } : {}),
      ...(create
        ? {
            create: {
              label: inMemory ? "Untitled project" : path.basename(resolved) || "Workshop",
              inMemory,
            },
          }
        : {}),
    });
    await closeProject();
    link = next;
    untitled = inMemory;
    lastError = undefined;
    library.setProject(exportDirectory());
    if (!inMemory) remember(resolved);
    const offCommit = link.onCommit((notice) => {
      if (inMemory) unsaved.set(notice.documentId, ++generation);
      window?.webContents.send(channels.commit, notice);
    });
    const offSteer = link.onSteer((notice) => window?.webContents.send(channels.steer, notice));
    unsubscribe = () => {
      offCommit();
      offSteer();
    };
    window?.setTitle(`${link.label} — Irudd Workshop`);
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  }
  return state();
}

function openUntitled(): Promise<ProjectState> {
  return openDirectory(
    path.join(app.getPath("temp"), "irudd-untitled-" + randomUUID()),
    true,
    true,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exportRequest(value: unknown): ExportRequest {
  if (!isRecord(value)) throw new Error("Invalid export.");
  const { documentId, label, revision, preset, wardrobe, bytes } = value;
  if (
    typeof documentId !== "string" ||
    typeof label !== "string" ||
    typeof revision !== "number" ||
    !Number.isInteger(revision) ||
    revision < 1 ||
    typeof preset !== "string" ||
    !/^[a-z]{1,16}$/.test(preset) ||
    (wardrobe !== undefined && typeof wardrobe !== "boolean") ||
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength > maxGlbBytes ||
    !isGlb(bytes)
  )
    throw new Error("Invalid export.");
  return { documentId, label, revision, preset, ...(wardrobe ? { wardrobe } : {}), bytes };
}

function inspectionSave(value: unknown): InspectionSave {
  if (!isRecord(value) || typeof value["model"] !== "string" || !Array.isArray(value["images"]))
    throw new Error("Invalid inspection.");
  const images = value["images"].map((image: unknown) => {
    if (
      !isRecord(image) ||
      typeof image["view"] !== "string" ||
      !/^[a-z-]{1,32}$/.test(image["view"]) ||
      !(image["png"] instanceof Uint8Array) ||
      image["png"].byteLength > 64 * 1024 * 1024
    )
      throw new Error("Invalid inspection image.");
    return { view: image["view"], png: image["png"] };
  });
  return { model: value["model"], metadata: value["metadata"], images };
}

function isUpdateAction(value: unknown): value is UpdateAction {
  return updateActions.some((action) => action === value);
}

function relaunchArgs(): string[] {
  const kept: string[] = [];
  const given = process.argv.slice(app.isPackaged ? 1 : 2);
  for (let index = 0; index < given.length; index++) {
    const arg = given[index] ?? "";
    if (arg === "--create" || arg.startsWith("--project=") || arg.startsWith("--open=")) continue;
    if (arg === "--project" || arg === "--open") {
      index++;
      continue;
    }
    kept.push(arg);
  }
  return link && !untitled ? [...kept, "--project", link.directory] : kept;
}

function trusted(event: IpcMainInvokeEvent): boolean {
  return event.senderFrame?.url === rendererUrl && event.sender === window?.webContents;
}

function handle(channel: string, run: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, async (event, ...params: unknown[]) => {
    if (!trusted(event)) throw new Error("This page may not use the workshop bridge.");
    return run(...params);
  });
}

async function pickDirectory(title: string): Promise<string | undefined> {
  const options = { title, properties: ["openDirectory" as const, "createDirectory" as const] };
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? undefined : result.filePaths[0];
}

function characterFailure(error: unknown): CharacterFileOutcome {
  const detail = error instanceof WorkshopError ? error.detail : undefined;
  const listed = detail?.["diagnostics"];
  const problems: CharacterProblem[] = Array.isArray(listed)
    ? listed.flatMap((d: unknown) =>
        isRecord(d) && typeof d["code"] === "string" && typeof d["message"] === "string"
          ? [
              {
                code: d["code"],
                message: d["message"],
                path: Array.isArray(d["path"])
                  ? d["path"].filter(
                      (p: unknown): p is string | number =>
                        typeof p === "string" || typeof p === "number",
                    )
                  : [],
              },
            ]
          : [],
      )
    : [];
  return {
    ok: false,
    canceled: false,
    error: {
      _tag: error instanceof WorkshopError ? error._tag : "HostFailed",
      message: error instanceof Error ? error.message : String(error),
    },
    problems,
  };
}

async function saveCharacter(documentId: string): Promise<CharacterFileOutcome> {
  const current = link;
  if (!current) throw new Error("Open a project first.");
  const head = await current.call("current", { documentId });
  const label =
    head.ok && isRecord(head.value) && isRecord(head.value["document"])
      ? String(head.value["document"]["label"])
      : documentId;
  const options = {
    title: "Save character",
    defaultPath: path.join(app.getPath("documents"), safeName(label) + packageExtension),
    filters: [{ name: "Irudd character", extensions: [packageExtension.slice(1)] }],
  };
  const picked = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options);
  if (picked.canceled || !picked.filePath) return { ok: false, canceled: true };
  let target = path.resolve(picked.filePath);
  if (!target.toLowerCase().endsWith(packageExtension)) target += packageExtension;
  const replace = fs.existsSync(target);
  const written = replace ? `${target}.${randomUUID()}.new` : target;
  try {
    const savedGeneration = unsaved.get(documentId);
    const report = await current.characterFile("document.save", { documentId, path: written });
    if (replace) fs.renameSync(written, target);
    if (current === link && savedGeneration === unsaved.get(documentId)) unsaved.delete(documentId);
    return {
      ok: true,
      action: "saved",
      name: path.basename(target),
      documentId: report.documentId,
      label: report.label,
      revision: report.revision,
      entries: report.entries,
      assets: report.assets,
      bytes: report.bytes,
    };
  } catch (error) {
    if (replace) fs.rmSync(written, { force: true });
    return characterFailure(error);
  }
}

async function openCharacter(): Promise<CharacterFileOutcome> {
  const current = link;
  if (!current) throw new Error("Open a project first.");
  const options = {
    title: "Open character",
    properties: ["openFile" as const],
    filters: [
      { name: "Irudd character", extensions: [packageExtension.slice(1)] },
      { name: "Document archive (JSON)", extensions: ["json"] },
    ],
  };
  const picked = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  const file = picked.canceled ? undefined : picked.filePaths[0];
  if (!file) return { ok: false, canceled: true };
  try {
    const report = await current.characterFile("document.open", { path: path.resolve(file) });
    return {
      ok: true,
      action: "opened",
      name: path.basename(file),
      documentId: report.documentId,
      label: report.label,
      revision: report.revision,
      entries: report.journal.sequence,
      assets: report.blobs.added + report.blobs.existing,
    };
  } catch (error) {
    return characterFailure(error);
  }
}

function registerBridge(build: string): void {
  const info: AppInfo = {
    build,
    versions: {
      electron: process.versions.electron ?? "",
      chrome: process.versions.chrome ?? "",
      node: process.versions.node,
    },
    hidden,
  };
  handle(channels.app, () => info);
  handle(channels.projectState, () => state());
  handle(channels.openProject, async (directory) => {
    if (typeof directory === "string" && readRecent().includes(directory))
      return openDirectory(directory, false);
    const picked = await pickDirectory("Open a workshop project");
    return picked ? openDirectory(picked, false) : state();
  });
  handle(channels.createProject, async (kind) => {
    if (kind === "untitled") return openUntitled();
    const picked = await pickDirectory("Choose an empty folder for the new project");
    if (!picked) return state();
    if (fs.existsSync(picked) && fs.readdirSync(picked).length > 0) {
      lastError = "Choose an empty folder for a new project.";
      return state();
    }
    return openDirectory(picked, true);
  });
  handle(channels.call, (method, params) => {
    if (!link)
      return { ok: false, error: { _tag: "ProjectClosed", message: "Open a project first." } };
    if (!isWindowMethod(method))
      return { ok: false, error: { _tag: "Forbidden", message: "This method is not available." } };
    return link.call(method, params);
  });
  handle(channels.library, (): LibraryEntry[] => library.list());
  handle(channels.bundledImage, async (digest) => {
    const asset = bundledAssets.find((item) => item.digest === digest);
    if (!asset) throw new Error("Unknown bundled artwork.");
    return new Uint8Array(await fs.promises.readFile(path.join(assetsDir, asset.file)));
  });
  handle(channels.humanPack, (file) => {
    const pack = humanPackPaths.find(
      (p) => typeof file === "string" && p === path.join("human", file),
    );
    if (!pack) throw new Error("Not an adult pack.");
    return new Uint8Array(fs.readFileSync(path.join(assetsDir, pack)));
  });
  handle(channels.readLibrary, (id) => (typeof id === "string" ? library.read(id) : null));
  handle(channels.openGlb, async () => {
    const options = {
      title: "Open a GLB file",
      properties: ["openFile" as const],
      filters: [{ name: "Binary glTF", extensions: ["glb"] }],
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    const file = result.canceled ? undefined : result.filePaths[0];
    return file ? library.open(file) : null;
  });
  handle(channels.saveExport, (value) => {
    const request = exportRequest(value);
    return library.saveExport(
      `${safeName(request.label)}-r${request.revision}-${request.preset}${request.wardrobe ? "-outfits" : ""}`,
      request.bytes,
    );
  });
  handle(channels.saveCharacter, (documentId) => {
    if (typeof documentId !== "string" || !/^doc-[a-z0-9-]{1,64}$/.test(documentId))
      throw new Error("Invalid document.");
    return saveCharacter(documentId);
  });
  handle(channels.openCharacter, () => openCharacter());
  handle(channels.update, (action) => {
    if (!updater || !isUpdateAction(action)) throw new Error("Invalid update action.");
    return updater.act(action);
  });
  handle(channels.saveInspection, (value) => {
    const request = inspectionSave(value);
    const project = exportDirectory();
    if (!project) throw new Error("Open a project first.");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dir = path.join(project, "inspections", `${safeName(request.model)}-${stamp}`);
    fs.mkdirSync(dir, { recursive: true });
    for (const image of request.images)
      fs.writeFileSync(path.join(dir, `${image.view}.png`), image.png);
    fs.writeFileSync(
      path.join(dir, "sheet.json"),
      JSON.stringify(request.metadata, null, 2) + "\n",
    );
    return dir;
  });
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 960,
    minHeight: 600,
    show: false,
    paintWhenInitiallyHidden: true,
    backgroundColor: "#1d2321",
    title: "Irudd Workshop",
    webPreferences: {
      preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: !hidden,
    },
  });
  const icon = path.join(path.dirname(dist), "icon.ico");
  if (fs.existsSync(icon)) win.setIcon(icon);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.once("ready-to-show", () => {
    if (!hidden) win.show();
  });
  void win.loadFile(rendererPage);
  win.on("close", (event) => {
    if (!quitting && !canLeaveProject()) event.preventDefault();
  });
  return win;
}

app.enableSandbox();
app.setAppUserModelId("alundgren.irudd-game-tools");

app.on("web-contents-created", (_event, contents) => {
  contents.on("will-attach-webview", (event) => event.preventDefault());
});

let quitting = false;
app.on("before-quit", (event) => {
  if (quitting || !link) return;
  event.preventDefault();
  if (window && !window.isDestroyed() && !canLeaveProject()) return;
  quitting = true;
  void closeProject().finally(() => app.quit());
});

app.on("window-all-closed", () => app.quit());

async function start(): Promise<void> {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  library = new Library(app.getPath("userData"));
  const build = readBuild();
  let personWindowLoaded = (): void => undefined;
  const personWindow = new Promise<void>((resolve) => {
    personWindowLoaded = resolve;
  });
  reviewWorker = new ReviewWorker({
    rendererDir: path.join(dist, "renderer"),
    assetsDir,
    build,
    versions: { electron: process.versions.electron ?? "", chrome: process.versions.chrome ?? "" },
    after: personWindow,
  });
  const appDirectory = path.dirname(dist);
  let installation;
  try {
    installation = readInstallation(appDirectory);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
  }
  updater = new Updater({
    appDirectory,
    installation,
    onChange: (status: UpdateStatus) => window?.webContents.send(channels.updateStatus, status),
    relaunchArgs,
    quit: () => app.quit(),
  });
  registerBridge(build);
  for (const file of Array.isArray(args.open) ? args.open : [])
    if (typeof file === "string") library.open(file);
  const startup = typeof args.project === "string" ? args.project : readRecent()[0];
  if (startup && (args.create === true || fs.existsSync(startup)))
    await openDirectory(startup, args.create === true);
  else if (typeof args.project !== "string") await openUntitled();
  window = createWindow();
  window.webContents.once("did-finish-load", () => {
    personWindowLoaded();
    void updater?.prune();
    void updater?.check();
  });
  window.on("closed", () => {
    personWindowLoaded();
    window = undefined;
    reviewWorker?.close();
  });
}

app.whenReady().then(start, (error: unknown) => {
  console.error(error);
  app.exit(1);
});
