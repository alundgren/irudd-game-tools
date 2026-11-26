import { isJson, jsonEqual } from "@irudd/document";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import {
  readZipDirectory,
  readZipEntry,
  writeZip,
} from "../../../packages/workshop/src/service/zip.js";
import { verifyCreatures } from "./creature-check.js";
import { verifySurface } from "./surface-check.js";
import { verifyDisplay } from "./display-check.js";
import { appDir, appEnvironment } from "./electron.js";

const { values } = parseArgs({
  options: { keep: { type: "boolean" }, executable: { type: "string" } },
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
});
if (!values.executable)
  throw new Error("Give the packaged app with --executable <Irudd Workshop.exe>.");
const executable = resolve(values.executable);
const clients = join(dirname(executable), "resources", "app", "dist", "clients");
for (const file of [executable, join(clients, "irudd.mjs")])
  if (!existsSync(file)) throw new Error(`No ${file}.`);
const scratch = mkdtempSync(join(tmpdir(), "irudd-character-qa-"));
const stateDir = join(scratch, "state");
const files = join(scratch, "files");
mkdirSync(files);
const env = appEnvironment({
  IRUDD_STATE_DIR: stateDir,
  IRUDD_LAUNCHER_QUIET: "1",
  PATH: join(process.env["SystemRoot"] ?? "C:\\Windows", "System32"),
});
let documentId = "";
const results: { step: string; ms: number; detail?: string }[] = [];
const problems: string[] = [];

async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    const value = await run();
    const ms = Math.round(performance.now() - started);
    const detail = typeof value === "string" ? value : undefined;
    results.push({ step: name, ms, ...(detail ? { detail } : {}) });
    console.log(`ok   ${name} (${ms} ms)${detail ? `: ${detail}` : ""}`);
    return value;
  } catch (error) {
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    const page = app?.page;
    if (page)
      for (const id of ["status", "banner", "status-right"])
        console.log(
          `  #${id}: ${((await page.textContent(`#${id}`).catch(() => "")) ?? "").slice(0, 600)}`,
        );
    throw error;
  }
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

function picture(index: number): Uint8Array {
  const size = 16;
  const rows: number[] = [];
  for (let y = 0; y < size; y++) {
    rows.push(0);
    for (let x = 0; x < size; x++) {
      const on = (x + y + index) % 4 < 2;
      rows.push(on ? 40 + index * 23 : 230, on ? 200 - index * 17 : 90, on ? 120 : index * 25, 255);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", zlib.deflateSync(Buffer.from(rows))),
      chunk("IEND", new Uint8Array()),
    ]),
  );
}

const sha = (bytes: Uint8Array) => "sha256:" + createHash("sha256").update(bytes).digest("hex");

interface Running {
  readonly page: Page;
  readonly browser: Browser;
  answerDialogs(answers: { save?: string; open?: string }): Promise<void>;
  close(): Promise<void>;
}

async function editorPage(context: BrowserContext): Promise<Page> {
  for (let i = 0; i < 600; i++) {
    const editor = context
      .pages()
      .find((page) => /^file:.*\/dist\/renderer\/index\.html$/.test(page.url()));
    if (editor) return editor;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("The desktop editor page did not open.");
}

async function evaluateInMain(url: string, expression: string): Promise<unknown> {
  const socket = new WebSocket(url);
  await new Promise<void>((done, fail) => {
    socket.addEventListener("open", () => done(), { once: true });
    socket.addEventListener("error", () => fail(new Error("The main-process inspector refused.")), {
      once: true,
    });
  });
  try {
    const reply = await new Promise<unknown>((done, fail) => {
      socket.addEventListener("message", (event) => {
        const message: unknown = JSON.parse(String(event.data));
        if (typeof message === "object" && message !== null && Reflect.get(message, "id") === 1)
          done(message);
      });
      socket.addEventListener("close", () => fail(new Error("The inspector closed.")));
      socket.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: {
            expression,
            includeCommandLineAPI: true,
            awaitPromise: true,
            returnByValue: true,
          },
        }),
      );
    });
    const result: unknown = Reflect.get(Object(reply), "result");
    const exception: unknown = Reflect.get(Object(result), "exceptionDetails");
    if (exception) throw new Error(`Main-process evaluation failed: ${JSON.stringify(exception)}`);
    return Reflect.get(Object(Reflect.get(Object(result), "result")), "value");
  } finally {
    socket.close();
  }
}

async function launch(extra: string[]): Promise<Running> {
  const child = spawn(
    executable,
    [
      "--hidden",
      "--inspect=0",
      "--remote-debugging-port=0",
      "--user-data",
      join(scratch, "user-data"),
      ...extra,
    ],
    { cwd: dirname(executable), env, stdio: ["ignore", "ignore", "pipe"] },
  );
  const exited = new Promise<void>((done) => child.once("exit", () => done()));
  try {
    const { devtools, inspector } = await new Promise<{ devtools: string; inspector: string }>(
      (done, fail) => {
        let text = "";
        const timer = setTimeout(
          () => fail(new Error(`No endpoints: ${text.slice(-800)}`)),
          60_000,
        );
        child.stderr?.on("data", (data: Buffer) => {
          text += data.toString();
          const devtools = /DevTools listening on (ws:\/\/\S+)/.exec(text)?.[1];
          const inspector = /Debugger listening on (ws:\/\/\S+)/.exec(text)?.[1];
          if (devtools && inspector) {
            clearTimeout(timer);
            done({ devtools, inspector });
          }
        });
        child.once("exit", (code) =>
          fail(new Error(`The app exited with ${code}: ${text.slice(-800)}`)),
        );
      },
    );
    const browser = await chromium.connectOverCDP(devtools);
    const context = browser.contexts()[0];
    if (!context) throw new Error("The app has no browser context.");
    const page = await editorPage(context);
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(`console: ${message.text()}`);
    });
    await page.waitForSelector("body[data-ready=true]", { timeout: 60_000 });
    return {
      page,
      browser,
      async answerDialogs(answers) {
        const value = await evaluateInMain(
          inspector,
          `(() => {
            const { dialog } = require("electron");
            const answers = ${JSON.stringify(answers)};
            if (answers.save) dialog.showSaveDialog = async () => ({ canceled: false, filePath: answers.save });
            if (answers.open) dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [answers.open] });
            return "answered";
          })()`,
        );
        assert.equal(value, "answered");
      },
      async close() {
        await page.evaluate(() => window.close()).catch(() => undefined);
        const timeout = setTimeout(() => child.kill(), 20_000);
        await exited;
        clearTimeout(timeout);
        assert.equal(child.exitCode, 0, "the app quit cleanly");
      },
    };
  } catch (error) {
    if (child.exitCode === null) child.kill();
    await exited;
    throw error;
  }
}

async function call(page: Page, method: string, params: unknown): Promise<unknown> {
  const outcome = await page.evaluate(
    async ([m, p]) => {
      const api: unknown = Reflect.get(window, "workshop");
      const fn: unknown = Reflect.get(Object(api), "call");
      const callable = (f: unknown): f is (method: string, params: unknown) => Promise<unknown> =>
        typeof f === "function";
      if (!callable(fn)) throw new Error("No workshop bridge.");
      return await fn(m, p);
    },
    [method, params] as const,
  );
  const ok: unknown = Reflect.get(Object(outcome), "ok");
  if (ok !== true) throw new Error(`${method}: ${JSON.stringify(outcome)}`);
  return Reflect.get(Object(outcome), "value");
}

let requests = 0;
async function apply(page: Page, expectedRevision: number, command: unknown): Promise<unknown> {
  requests += 1;
  const result = await call(page, "apply", {
    request: {
      format: "irudd.command",
      version: 1,
      requestId: `qa-character-${process.pid}-${requests}`,
      documentId,
      expectedRevision,
      command,
    },
  });
  return result;
}

async function waitRevision(page: Page, at: number): Promise<void> {
  await page.waitForFunction(
    (n) =>
      new RegExp(`revision ${n}\\b`).test(
        document.querySelector("#status-right")?.textContent ?? "",
      ),
    at,
    { timeout: 20_000 },
  );
}

async function waitStatus(page: Page, pattern: RegExp): Promise<string> {
  await page.waitForFunction(
    (source) => new RegExp(source).test(document.querySelector("#status")?.textContent ?? ""),
    pattern.source,
    { timeout: 30_000 },
  );
  return (await page.textContent("#status")) ?? "";
}

const asNode = { ...env, ELECTRON_RUN_AS_NODE: "1" };
const clientArgs = (entry: string, args: ReadonlyArray<string>) => [
  "--no-warnings=ExperimentalWarning",
  join(clients, entry),
  ...args,
];

function irudd(...args: string[]): { code: number; out: string; err: string } {
  const run = spawnSync(executable, clientArgs("irudd.mjs", args), {
    env: asNode,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
  });
  return { code: run.status ?? -1, out: run.stdout, err: run.stderr };
}

function entries(file: string): Map<string, Uint8Array> {
  const bytes = new Uint8Array(readFileSync(file));
  return new Map(readZipDirectory(bytes).map((e) => [e.name, readZipEntry(bytes, e)] as const));
}

function repack(
  source: string,
  name: string,
  change: (f: Map<string, Uint8Array>) => void,
): string {
  const f = entries(source);
  change(f);
  const target = join(files, name);
  writeFileSync(
    target,
    writeZip([...f].map(([n, b]) => ({ name: n, bytes: b, deflate: !n.startsWith("assets/") }))),
  );
  return target;
}

let app: Running | undefined;
let host: ChildProcess | undefined;

const projectB = join(scratch, "project-b");
const projectC = join(scratch, "project-c");
const saved = join(files, "Portable walker.irudd-character");
try {
  app = await step("launch without a project file or folder", () => launch([]));
  let page = app.page;
  await page.waitForFunction(
    () => document.querySelector("#character-open")?.hasAttribute("disabled") === false,
  );
  await step("create a random human in memory and save it only on request", async () => {
    assert.equal(await page.textContent("#project-label"), "Untitled project");
    const info = await call(page, "project.info", {});
    const directory: unknown = Reflect.get(Object(info), "directory");
    assert.equal(Reflect.get(Object(info), "file"), ":memory:");
    assert.ok(typeof directory === "string");
    assert.equal(existsSync(directory), false);
    assert.ok((await page.locator("#start option").count()) > 60);
    await page.evaluate(() => {
      const sample = crypto.getRandomValues.bind(crypto);
      crypto.getRandomValues = (array) => {
        if (array instanceof Uint32Array && array.length === 1) {
          crypto.getRandomValues = sample;
          array[0] = 491;
          return array;
        }
        return sample(array);
      };
    });
    await page.getByRole("button", { name: "New random creature", exact: true }).click();
    await page.click("#creature-cancel");
    await page.getByRole("button", { name: "New random human", exact: true }).click();
    await page.getByRole("button", { name: "Create human", exact: true }).click();
    await waitRevision(page, 1);
    await page.waitForSelector("#outliner [data-part]");
    assert.equal(await page.locator("#outliner [data-part]").count(), 52);
    assert.equal(existsSync(directory), false);
    const humanFile = join(files, "First human.irudd-character");
    assert.ok(app);
    await app.answerDialogs({ save: humanFile });
    await page.click("#character-save");
    await waitStatus(page, /Saved /);
    assert.ok(existsSync(humanFile));
  });
  await step(
    "inspect the random human in three display modes, four angles and selection focus",
    () => verifyDisplay(page, resolve(appDir, "../../.reference-cache/parity/display")),
  );
  const studies: { id: string; file: string; revision: number; document: unknown }[] = [];
  async function saveStudy(name: string, revision: number) {
    const id = await page.inputValue("#document"),
      file = join(files, name + ".irudd-character");
    const document: unknown = Reflect.get(
      Object(await call(page, "current", { documentId: id })),
      "document",
    );
    await app?.answerDialogs({ save: file });
    await page.click("#character-save");
    await waitStatus(page, new RegExp("as " + name));
    studies.push({ id, file, revision, document });
  }
  await step("generate, sculpt and coat creatures and mount adult wings", () =>
    verifyCreatures(page, resolve(appDir, "../../.reference-cache/phase6"), saveStudy),
  );
  const details = await step("paint, fit and shape surfaces in the workshop", () =>
    verifySurface(page, resolve(appDir, "../../.reference-cache/phase5"), (revision) =>
      saveStudy("Face marks", revision),
    ),
  );
  await saveStudy("Surface study", details.revision);
  const parts = await step(
    "start a character from New character from… (frame creature)",
    async () => {
      await page
        .waitForFunction(() => document.querySelectorAll("#start option").length > 1, null, {
          timeout: 20_000,
        })
        .catch(() => undefined);
      const option = await page.$$eval("#start option", (options) =>
        options
          .map((o) => o.getAttribute("value") ?? "")
          .find((v) => v === "frame-creature" || v.startsWith("frame-creature/")),
      );
      assert.ok(option, "the frame-creature starter is offered");
      await page.selectOption("#start", option);
      await waitRevision(page, 1);
      documentId = await page.inputValue("#document");
      assert.match(documentId, /^doc-frame-creature-/);
      await apply(page, 1, {
        type: "edit",
        ops: [{ op: "document.label", label: "Portable walker" }],
      });
      await waitRevision(page, 2);
      const current: unknown = await call(page, "current", { documentId });
      const list: unknown = Reflect.get(Object(Reflect.get(Object(current), "document")), "parts");
      assert.ok(Array.isArray(list) && list.length >= 2);
      return list.map((p: unknown) => String(Reflect.get(Object(p), "id")));
    },
  );
  const [first = "", second = ""] = parts;
  const pictures = Array.from({ length: 9 }, (_, i) => picture(i));
  await step("stage nine small pictures and declare them", async () => {
    for (const bytes of pictures)
      await call(page, "art.put", {
        digest: sha(bytes),
        mediaType: "image/png",
        offset: 0,
        total: bytes.length,
        base64: Buffer.from(bytes).toString("base64"),
      });
    await apply(page, 2, {
      type: "edit",
      ops: pictures.map((bytes, i) => ({
        op: "asset.add",
        asset: {
          digest: sha(bytes),
          mediaType: "image/png",
          byteLength: bytes.length,
          role: i === 0 ? "paint-atlas" : "reference",
        },
      })),
    });
    await waitRevision(page, 3);
    return `${pictures.reduce((n, p) => n + p.length, 0)} bytes in 9 PNGs`;
  });
  await step("recolour a part, rename it, add a pose and namespaced metadata", async () => {
    await apply(page, 3, {
      type: "edit",
      ops: [{ op: "part.set", part: first, set: { color: "#6a8f4e" } }],
    });
    await apply(page, 4, {
      type: "edit",
      ops: [{ op: "part.rename", part: first, label: "Carried trunk" }],
    });
    await apply(page, 5, {
      type: "edit",
      ops: [
        {
          op: "pose.set",
          pose: {
            id: "pose-wave",
            label: "Wave",
            joints: [{ part: second, rotation: [0, 0, 0.6, 0.8] }],
          },
        },
      ],
    });
    await apply(page, 6, {
      type: "edit",
      ops: [{ op: "extension.set", namespace: "com.example.notes", value: { mood: "curious" } }],
    });
    await waitRevision(page, 7);
    await page.waitForFunction(() =>
      document.querySelector("#outliner")?.textContent?.includes("Carried trunk"),
    );
  });
  await step(
    "a catalog dependency is refused because this desktop installs no catalog",
    async () => {
      const result: unknown = await apply(page, 7, {
        type: "edit",
        ops: [
          {
            op: "catalog.set",
            dependency: { id: "irudd.parts", digest: `sha256:${"c".repeat(64)}` },
          },
        ],
      });
      assert.equal(Reflect.get(Object(result), "kind"), "rejected");
      const text = JSON.stringify(result);
      assert.match(text, /catalog-missing/);
      return "rejected with catalog-missing; nothing written";
    },
  );
  await step("rename by mistake, then click Undo", async () => {
    await apply(page, 7, {
      type: "edit",
      ops: [{ op: "part.rename", part: second, label: "Oops" }],
    });
    await waitRevision(page, 8);
    await page.click("#undo");
    await waitRevision(page, 9);
    await page.waitForFunction(
      () => !document.querySelector("#outliner")?.textContent?.includes("Oops"),
    );
  });
  const savedText = await step("click Save character… and write the file", async () => {
    await app?.answerDialogs({ save: saved });
    await page.click("#character-save");
    const text = await waitStatus(page, /^Saved /);
    assert.ok(existsSync(saved));
    const f = entries(saved);
    const names = [...f.keys()];
    assert.deepEqual(names.slice(0, 3), ["manifest.json", "document.json", "history.jsonl"]);
    assert.equal(names.filter((n) => /^assets\/[0-9a-f]{64}\.png$/.test(n)).length, 9);
    for (const bytes of pictures)
      assert.deepEqual(
        f.get(`assets/${sha(bytes).slice(7)}.png`),
        bytes,
        "picture bytes unchanged",
      );
    const manifest: unknown = JSON.parse(new TextDecoder().decode(f.get("manifest.json")));
    assert.deepEqual(Reflect.get(Object(manifest), "metadata"), ["com.example.notes"]);
    return `${text} (${readFileSync(saved).length} bytes)`;
  });
  void savedText;
  await step("quit project A", async () => {
    await app?.close();
    app = undefined;
  });

  app = await step("launch again on a fresh project B", () =>
    launch(["--project", projectB, "--create"]),
  );
  page = app.page;
  await page.waitForFunction(
    () => document.querySelector("#character-open")?.hasAttribute("disabled") === false,
  );
  const brokenArt = repack(saved, "missing-picture.irudd-character", (f) => {
    const name = [...f.keys()].find((n) => n.startsWith("assets/"));
    if (name) f.delete(name);
  });
  const brokenPose = repack(saved, "bad-pose.irudd-character", (f) => {
    const doc: unknown = JSON.parse(new TextDecoder().decode(f.get("document.json")));
    const poses: unknown = Reflect.get(Object(doc), "poses");
    assert.ok(Array.isArray(poses));
    Reflect.set(Object(poses[0]), "joints", [{ part: "p-missing", rotation: [0, 0, 0, 1] }]);
    f.set("document.json", new TextEncoder().encode(JSON.stringify(doc)));
  });
  for (const [file, expected] of [
    [brokenArt, /lacks/],
    [brokenPose, /Pose pose-wave names a missing part p-missing/],
  ] as const)
    await step(
      `Open character… refuses ${file.split(/[\\/]/).pop() ?? ""} and lists the problem`,
      async () => {
        await app?.answerDialogs({ open: file });
        await page.click("#character-open");
        await page.waitForSelector("#banner:not([hidden]) .problems li", { timeout: 20_000 });
        const banner = (await page.textContent("#banner")) ?? "";
        assert.match(banner, /nothing was written/);
        assert.match(banner, expected);
        const docs: unknown = await call(page, "documents", {});
        assert.ok(Array.isArray(docs) && docs.length === 0, "no document written");
        await page.click("#banner button");
        return banner.replace(/\s+/g, " ").slice(0, 200);
      },
    );
  await step("Open character… opens the saved file with its history and pictures", async () => {
    await app?.answerDialogs({ open: saved });
    await page.click("#character-open");
    const text = await waitStatus(page, /^Opened /);
    assert.equal(await page.inputValue("#document"), documentId);
    await waitRevision(page, 9);
    await page.waitForFunction(() =>
      document.querySelector("#outliner")?.textContent?.includes("Carried trunk"),
    );
    const inspect: unknown = await call(page, "inspect", { documentId });
    const doc: unknown = Reflect.get(Object(inspect), "document");
    const poses: unknown = Reflect.get(Object(doc), "poses");
    assert.ok(Array.isArray(poses) && Reflect.get(Object(poses[0]), "id") === "pose-wave");
    assert.deepEqual(Reflect.get(Object(doc), "extensions"), {
      "com.example.notes": { mood: "curious" },
    });
    const assets: unknown = Reflect.get(Object(doc), "assets");
    assert.ok(Array.isArray(assets) && assets.length === 9);
    for (const bytes of pictures) {
      const read: unknown = await call(page, "project.image", { digest: sha(bytes), offset: 0 });
      assert.equal(Reflect.get(Object(read), "base64"), Buffer.from(bytes).toString("base64"));
    }
    const history: unknown = Reflect.get(Object(inspect), "history");
    assert.ok(Array.isArray(history) && history.length === 9);
    assert.equal(
      Reflect.get(Object(history[7]), "undone"),
      true,
      "the mistaken rename stays undone",
    );
    return text;
  });
  await step("Redo brings back the undone rename; Undo removes it again", async () => {
    await page.click("#redo");
    await waitRevision(page, 10);
    await page.waitForFunction(() =>
      document.querySelector("#outliner")?.textContent?.includes("Oops"),
    );
    await page.click("#undo");
    await waitRevision(page, 11);
    await page.waitForFunction(
      () => !document.querySelector("#outliner")?.textContent?.includes("Oops"),
    );
  });

  const cliSaved = join(files, "from-cli.irudd-character");
  await step("irudd save writes the character from project B's desktop host", async () => {
    const run = irudd("save", documentId, cliSaved, "--project", projectB);
    assert.equal(run.code, 0, run.err);
    assert.ok(existsSync(cliSaved));
    return run.out.split("\n")[0] ?? "";
  });
  await step(
    "reopen the saved wing, creature and surface studies and verify every edit",
    async () => {
      for (const study of studies) {
        await app?.answerDialogs({ open: study.file });
        await page.click("#character-open");
        await page.waitForFunction(
          (id) => document.querySelector<HTMLSelectElement>("#document")?.value === id,
          study.id,
        );
        await waitRevision(page, study.revision);
        const restored: unknown = Reflect.get(
          Object(await call(page, "current", { documentId: study.id })),
          "document",
        );
        assert.ok(isJson(restored) && isJson(study.document));
        assert.ok(jsonEqual(restored, study.document), "Every saved edit survived reopening.");
      }
      await page.locator('#outliner [data-part="' + details.hand + '"]').click();
      const surface = page.locator("#surface-editor");
      await surface.locator(":scope > summary").click();
      await surface
        .locator("summary")
        .filter({ hasText: /^Hand$/ })
        .click();
      assert.equal(await surface.getByLabel("Fingers", { exact: true }).inputValue(), "3");
    },
  );
  await step("quit project B", async () => {
    await app?.close();
    app = undefined;
  });
  await step("the packaged headless host serves a fresh project C", async () => {
    host = spawn(executable, clientArgs("irudd-host.mjs", [projectC, "--create"]), {
      env: asNode,
      stdio: "ignore",
      windowsHide: true,
    });
    for (let i = 0; i < 200; i++) {
      if (irudd("status", "--project", projectC).code === 0) return;
      await new Promise((done) => setTimeout(done, 150));
    }
    throw new Error("The headless host did not come up.");
  });
  await step("irudd open refuses a damaged file with diagnostics and exit 4", async () => {
    const run = irudd("open", brokenArt, "--project", projectC);
    assert.equal(run.code, 4, run.out + run.err);
    assert.match(run.out, /nothing was written/);
    const list = irudd("list", "--project", projectC, "--json");
    assert.deepEqual(JSON.parse(list.out), []);
    return run.out.split("\n").slice(0, 2).join(" | ");
  });
  await step("irudd open opens the CLI-saved file in project C", async () => {
    const run = irudd("open", cliSaved, "--project", projectC);
    assert.equal(run.code, 0, run.err);
    const history = irudd("history", documentId, "--project", projectC);
    assert.equal(history.code, 0, history.err);
    const show = irudd("show", documentId, "--project", projectC, "--json");
    assert.match(show.out, /Carried trunk/);
    assert.match(show.out, /com\.example\.notes/);
    return run.out.split("\n")[0] ?? "";
  });
} finally {
  if (app) await app.close().catch(() => undefined);
  if (host && host.exitCode === null) {
    const stopped = new Promise((done) => host?.once("exit", done));
    host.kill();
    await stopped;
  }
  console.log(JSON.stringify({ executable, scratch, results, problems }, null, 2));
  if (!values.keep) rmSync(scratch, { recursive: true, force: true, maxRetries: 10 });
}
assert.deepEqual(problems, [], "no page errors");
