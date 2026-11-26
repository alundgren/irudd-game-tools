import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { Schema } from "effect";
import {
  AssetEntry,
  PartId,
  affinePoint,
  applyOperations,
  assetCredits,
  createRegistry,
  decodeOperations,
  documentDigest,
  familyFeatures,
  figureHull,
  figurePaint,
  figurePortraitDepth,
  figureSweep,
  frameCreature,
  partPlacements,
  sha256Digest,
  validateDocument,
  type CharacterDocument,
} from "@irudd/document";
import { bundledAssetNamed, repaintOperations } from "@irudd/character";
import { bundledAssets } from "@irudd/character/assets";
import { panelCanvas, panelFromPixels, type Panel } from "@irudd/character/art-fit";
import { traceBuildOperations, type TraceBuildRegion } from "@irudd/character/trace-build";
import {
  connect,
  readArtFile,
  readArtifact,
  uploadArt,
  type WorkshopClient,
} from "@irudd/workshop/client";
import { appDir, appEnvironment, electronExecutable } from "./electron.js";

const { values } = parseArgs({
  options: { keep: { type: "boolean" }, packaged: { type: "string" }, out: { type: "string" } },
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
});
const keep = values.keep === true;
const scratch = mkdtempSync(join(tmpdir(), "irudd-desktop-qa-art-"));
const projectDir = join(scratch, "project");
const userData = join(scratch, "user-data");
const stateDir = join(scratch, "state");
const evidence = join(scratch, "evidence");
mkdirSync(evidence);
const repository = resolve(appDir, "..", "..");
const traceOut = resolve(
  values.out ?? join(repository, ".reference-cache", "g4a", "trace-desktop"),
);
const distribution = join(scratch, "Workshop App");
const executable = values.packaged
  ? resolve(values.packaged, "Irudd Workshop.exe")
  : electronExecutable();
if (!values.packaged) {
  mkdirSync(distribution);
  copyFileSync(join(appDir, "package.json"), join(distribution, "package.json"));
  cpSync(join(appDir, "dist"), join(distribution, "dist"), { recursive: true });
}
const registry = createRegistry({ features: familyFeatures, generators: [frameCreature] });
const results: { step: string; ms: number; detail?: unknown }[] = [];
const problems: string[] = [];

let app: { page: Page; browser: Browser; pid: number; close(): Promise<void> } | undefined;
let appLog = "";
const appEvents: string[] = [];
let appExited: Promise<void> = Promise.resolve();

async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    const value = await run();
    const ms = Math.round(performance.now() - started);
    results.push({ step: name, ms });
    console.log(`ok   ${name} (${ms} ms)`);
    return value;
  } catch (error) {
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    const page = app?.page;
    if (page)
      for (const id of ["status", "banner", "art", "proposals"])
        console.log(
          `  #${id}: ${((await page.textContent(`#${id}`).catch(() => "")) ?? "").slice(0, 600)}`,
        );
    await Promise.race([appExited, new Promise((done) => setTimeout(done, 5000))]);
    for (const event of appEvents) console.log(`  app: ${event}`);
    if (appLog)
      console.log(`  app stderr (tail):
${appLog}`);
    throw error;
  }
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

async function launch(): Promise<NonNullable<typeof app>> {
  const child = spawn(
    executable,
    [
      ...(values.packaged ? [] : [distribution]),
      "--hidden",
      "--remote-debugging-port=0",
      "--user-data",
      userData,
      "--project",
      projectDir,
      "--create",
    ],
    {
      cwd: values.packaged ? resolve(values.packaged) : distribution,
      env: appEnvironment({ IRUDD_STATE_DIR: stateDir }),
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  const exited = new Promise<void>((done) => child.once("exit", () => done()));
  appExited = exited;
  let closing = false;
  child.stderr.on("data", (chunk: Buffer) => {
    appLog = (appLog + chunk.toString()).slice(-4000);
  });
  child.once("exit", (code, signal) => {
    if (!closing) appEvents.push(`the app exited with ${code ?? signal}`);
  });
  const endpoint = await new Promise<string>((done, fail) => {
    let text = "";
    const timer = setTimeout(() => fail(new Error(`No DevTools endpoint: ${text}`)), 60_000);
    child.stderr.on("data", (chunk: Buffer) => {
      text += chunk.toString();
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(text);
      if (match?.[1]) {
        clearTimeout(timer);
        done(match[1]);
      }
    });
    child.once("exit", (code) => fail(new Error(`The app exited with ${code}: ${text}`)));
  });
  const browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  if (!context) throw new Error("The app has no browser context.");
  const page = await editorPage(context);
  page.on("crash", () => appEvents.push("the editor page crashed"));
  page.on("close", () => {
    if (!closing) appEvents.push("the editor page closed");
  });
  browser.on("disconnected", () => {
    if (!closing) appEvents.push("the app's DevTools connection closed");
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
  await page.waitForSelector("body[data-ready=true]", { timeout: 60_000 });
  const pid = child.pid;
  assert.ok(pid);
  return {
    page,
    browser,
    pid,
    async close() {
      closing = true;
      await page.evaluate(() => window.close()).catch(() => undefined);
      const timeout = setTimeout(() => child.kill(), 20_000);
      await exited;
      clearTimeout(timeout);
      assert.equal(child.exitCode, 0, "the app quit cleanly");
    },
  };
}

interface AppProcess {
  pid: number;
  name: string;
  path: string;
  type: string;
  mb: number;
}

function processTree(root: number, withRoot = false): ReadonlyArray<AppProcess> {
  if (process.platform !== "win32") return [];
  const raw = execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine,WorkingSetSize | ConvertTo-Json -Compress",
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const parsed: unknown = JSON.parse(raw);
  const rows = (Array.isArray(parsed) ? parsed : []).flatMap((r: unknown) => {
    const pid = Number(Reflect.get(Object(r), "ProcessId"));
    const parent = Number(Reflect.get(Object(r), "ParentProcessId"));
    return [
      {
        pid,
        parent,
        name: String(Reflect.get(Object(r), "Name")),
        path: String(Reflect.get(Object(r), "ExecutablePath") ?? ""),
        type:
          /--type=(\S+)/.exec(String(Reflect.get(Object(r), "CommandLine") ?? ""))?.[1] ??
          "browser",
        mb: Math.round(Number(Reflect.get(Object(r), "WorkingSetSize") ?? 0) / 1e6),
      },
    ];
  });
  const tree = new Set([root]);
  for (let grew = true; grew;) {
    grew = false;
    for (const r of rows)
      if (tree.has(r.parent) && !tree.has(r.pid)) {
        tree.add(r.pid);
        grew = true;
      }
  }
  return rows.filter((r) => tree.has(r.pid) && (withRoot || r.pid !== root));
}

function appMemory(label: string): void {
  if (!app) return;
  const tree = processTree(app.pid, true);
  const sample = tree.map((p) => `${p.type} ${p.mb} MB`).join(", ");
  appEvents.push(`memory ${label}: ${sample}`);
  results.push({
    step: `memory ${label}`,
    ms: 0,
    detail: tree.map((p) => ({ type: p.type, mb: p.mb })),
  });
}

function auditProcesses(label: string): void {
  if (!app) return;
  const electron = basename(executable).toLowerCase();
  const tree = processTree(app.pid);
  const foreign = tree.filter((p) => p.name.toLowerCase() !== electron);
  results.push({
    step: `process tree ${label}`,
    ms: 0,
    detail: { processes: tree.length, names: [...new Set(tree.map((p) => p.name))] },
  });
  assert.deepEqual(foreign, [], `${label}: only Electron's own processes run under the app`);
}

const decodeEntry = Schema.decodeUnknownSync(AssetEntry);
const decodePart = Schema.decodeUnknownSync(PartId);

function ownRepaint(base: CharacterDocument, digest: string, byteLength: number) {
  const ops: unknown = JSON.parse(
    JSON.stringify(
      repaintOperations(
        base,
        [decodePart("p-body")],
        decodeEntry({ digest, mediaType: "image/webp", byteLength, role: "paint-atlas" }),
      ),
    ),
  );
  const decoded = decodeOperations(ops);
  assert.ok(decoded.ok);
  const applied = applyOperations(base, decoded.value, {
    registry,
    retired: new Set(),
    idFor: (slot) => {
      throw new Error(`No generated slots in a repaint: ${slot}`);
    },
  });
  assert.ok(applied.ok);
  const checked = validateDocument(applied.value, { registry });
  assert.ok(checked.ok);
  return checked.value;
}

async function panelEvidence(page: Page, name: string): Promise<void> {
  const shown = await page.evaluate(async () => {
    const root = document.querySelector("#art");
    const images = [...(root?.querySelectorAll("img") ?? [])].filter(
      (img) => img instanceof HTMLImageElement,
    );
    await Promise.all(images.map((img) => img.decode().catch(() => undefined)));
    return {
      text: root instanceof HTMLElement ? root.innerText : "",
      images: images.map((img) => ({
        title: img.title,
        alt: img.alt,
        width: img.naturalWidth,
        height: img.naturalHeight,
      })),
    };
  });
  assert.ok(shown.images.length > 0 && shown.images.every((i) => i.width > 0 && i.height > 0));
  writeFileSync(join(evidence, `${name}.json`), JSON.stringify(shown, null, 2));
}

async function editorPixels(page: Page): Promise<number[]> {
  return page.evaluate(async () => {
    const canvas = document.querySelector("#viewport canvas");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Missing viewport canvas.");
    document.getElementById("tool-select")?.click();
    const bitmap = await new Promise<ImageBitmap>((resolve, reject) =>
      requestAnimationFrame(() => createImageBitmap(canvas).then(resolve, reject)),
    );
    const context = new OffscreenCanvas(192, 192).getContext("2d");
    if (!context) throw new Error("Missing 2D context.");
    context.drawImage(bitmap, 0, 0, 192, 192);
    bitmap.close();
    return Array.from(context.getImageData(0, 0, 192, 192).data);
  });
}

function changedPixels(a: number[], b: number[]): number {
  let changed = 0;
  for (let i = 0; i < a.length; i += 4) {
    if ([0, 1, 2].some((c) => Math.abs((a[i + c] ?? 0) - (b[i + c] ?? 0)) > 3)) changed++;
  }
  return changed;
}

function windowCall(page: Page, method: string, params: unknown): Promise<unknown> {
  return page.evaluate(
    async ([m, p]) => {
      const api: unknown = Reflect.get(globalThis, "workshop");
      const call: unknown = Reflect.get(Object(api), "call");
      if (typeof call !== "function") throw new Error("The window has no workshop bridge.");
      const outcome: unknown = await Reflect.apply(call, api, [m, p]);
      return outcome;
    },
    [method, params] as const,
  );
}

async function revision(page: Page): Promise<number> {
  const match = /revision (\d+)/.exec((await page.textContent("#status-right")) ?? "");
  return match ? Number(match[1]) : 0;
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

async function sendBrief(
  page: Page,
  brief: {
    kind: string;
    direction: string;
    part?: string;
    views: ReadonlyArray<string>;
  },
): Promise<void> {
  const art = page.locator("#art");
  const before = await art.locator(".art-request").count();
  await art.locator('select[aria-label="Kind of artwork"]').selectOption(brief.kind);
  if (brief.part) {
    const tick = art.locator(`.art-parts label[title="${brief.part}"] input`);
    if (!(await tick.isChecked())) await tick.check();
  }
  await art.locator('textarea[aria-label="Direction"]').fill(brief.direction);
  for (const [i, role] of brief.views.entries()) {
    await art.locator('select[aria-label="Attachment role"]').selectOption(role);
    await art.locator("button:has-text('Add editor view')").click();
    await art.locator(".art-compose .art-figure").nth(i).waitFor({ timeout: 20_000 });
  }
  await art.locator('textarea[aria-label="Direction"]').fill(brief.direction);
  await art.locator('textarea[aria-label="Direction"]').dispatchEvent("input");
  await art.locator("button:has-text('Send brief')").click();
  await page.waitForFunction(
    (n) => document.querySelectorAll("#art .art-request").length > n,
    before,
    { timeout: 20_000 },
  );
}

async function latest(agent: WorkshopClient, documentId: string) {
  const listed = await agent.call("art.list", { documentId, all: true });
  const request = listed.requests.at(-1);
  assert.ok(request);
  return request;
}

const courier = bundledAssetNamed("courier");
assert.ok(courier);
const courierBytes = new Uint8Array(readFileSync(join(repository, "character-view", courier.file)));
let agent: WorkshopClient | undefined;
let credentialFile = "";
try {
  app = await step("launch hidden on a new project", launch);
  const page = app.page;
  auditProcesses("at launch");

  await step("start feline-worker", async () => {
    await page.selectOption("#start", "feline-worker");
    await page.waitForSelector("#outliner [data-part]");
    await waitRevision(page, 1);
  });
  const documentId = await page.inputValue("#document");

  await step("pair the agent and bind its inbox", async () => {
    await page.click("#agents details:not([open]) > summary");
    await page.fill("#agents input", "claude");
    await page.click("#agents button:has-text('Pair')");
    await page.waitForSelector("#agents p:has-text('Paired claude')");
    const hosts = join(stateDir, "hosts");
    const credential = readdirSync(hosts)
      .map((key) => join(hosts, key, "agents", "claude.json"))
      .find((candidate) => existsSync(candidate));
    assert.ok(credential);
    credentialFile = credential;
    const bound = await windowCall(page, "recipient.bind", {
      agent: "claude",
      route: { transport: "inbox", host: "claude-code", environment: "local" },
    });
    assert.equal(Reflect.get(Object(bound), "ok"), true, JSON.stringify(bound));
    agent = await connect({
      credential: { role: "agent", file: credential },
      client: { name: "desktop-qa-art", version: "1" },
      stateDir,
    });
    await page.waitForSelector('#art select[aria-label="Paired agent"] option[value="claude"]', {
      state: "attached",
    });
  });
  assert.ok(agent);
  const paired = agent;

  const base = await paired.call("current", { documentId });
  assert.ok(base.document);
  const baseDoc = base.document;
  const other = baseDoc.parts.find((p) => p.id !== "p-body")?.id;
  assert.ok(other);
  const bodyAtlas = baseDoc.parts.find((p) => p.id === "p-body")?.paint?.atlas;
  assert.ok(bodyAtlas, "feline-worker's body is painted");

  const turnaround = await step("send a turnaround brief with an editor view", async () => {
    await sendBrief(page, {
      kind: "turnaround",
      direction: "Repaint the body as a courier; keep the cut and registration.",
      part: "p-body",
      views: ["whole"],
    });
    const r = await latest(paired, documentId);
    assert.equal(r.brief.kind, "turnaround");
    assert.deepEqual(r.brief.parts, ["p-body"]);
    assert.equal(r.brief.revision, 1);
    assert.deepEqual(
      r.attachments.map((a) => [a.role, a.mediaType]),
      [
        ["whole", "image/png"],
        ["source-sheet", "image/webp"],
      ],
    );
    assert.equal(r.attachments[1]?.digest, bodyAtlas, "the current sheet goes with the brief");
    for (const a of r.attachments) {
      const file = await readArtFile(paired, r.artId, a.digest);
      assert.equal(sha256Digest(file.bytes), a.digest);
      assert.equal(file.bytes.byteLength, a.byteLength);
      writeFileSync(
        join(evidence, `turnaround-${a.role}.${a.mediaType.split("/")[1]}`),
        file.bytes,
      );
    }
    const whole = r.attachments[0];
    assert.ok(whole && whole.width >= 64 && whole.height >= 64);
    const inbox = await paired.call("inbox.read", { all: true });
    assert.ok(
      JSON.stringify(inbox).includes(r.artId),
      "the brief reached the agent's inbox as a steering message",
    );
    return r;
  });

  await step("the agent's sheet is proposed, previewed, accepted and undone", async () => {
    const before = await editorPixels(page);
    await assert.rejects(
      paired.call("project.image", { digest: bodyAtlas, offset: 0 }),
      /person|forbidden/i,
    );
    const staged = await uploadArt(paired, courierBytes, "image/webp");
    const submitted = await paired.call("art.submit", {
      artId: turnaround.artId,
      submissionId: "qa-courier-0001",
      reply: {
        format: "irudd.art-reply",
        version: 1,
        kind: "turnaround",
        summary: "Courier body",
        image: staged.digest,
      },
    });
    assert.equal(submitted.submission.state, "proposed");
    await page.waitForSelector("#art .art-reply.art-proposed img[src^='blob:']", {
      timeout: 20_000,
    });
    await page.waitForSelector("#proposals .proposal:has-text('Courier body')");
    await page
      .locator("#proposals .proposal:has-text('Courier body') button:has-text('Preview')")
      .click();
    await page.waitForSelector("#banner:has-text('Previewing')");
    const proposed = await editorPixels(page);
    const pixelsChanged = changedPixels(before, proposed);
    assert.ok(
      pixelsChanged > 40,
      `The proposed paint must change the model before acceptance (${pixelsChanged} pixels).`,
    );
    assert.equal(await revision(page), 1);
    await page.locator("#art button:has-text('Add editor view')").click();
    await page.waitForSelector("#art p:has-text('leave the proposal preview')");
    assert.equal(await page.locator("#art .art-compose .art-figure").count(), 0);
    await page.locator("#banner button:has-text('Accept')").click();
    await waitRevision(page, 2);
    assert.equal(
      changedPixels(proposed, await editorPixels(page)),
      0,
      "Accepted paint matches its preview.",
    );
    const accepted = (await paired.call("current", { documentId })).document;
    assert.ok(accepted);
    assert.equal(accepted.parts.find((p) => p.id === "p-body")?.paint?.atlas, courier.digest);
    const own = ownRepaint(baseDoc, courier.digest, courier.byteLength);
    assert.equal(
      assetCredits(accepted).has(courier.digest),
      false,
      "a returned bundled sheet keeps its original ownership",
    );
    assert.equal(documentDigest(accepted), documentDigest(own), "the person's own repaint");
    await page.waitForSelector("#art .art-reply:has-text('accepted in revision 2')");
    const composer = page.locator("#art .art-compose");
    const requests = page.locator("#art .art-request");
    const count = await requests.count();
    await requests.first().getByRole("button", { name: "Prepare updated brief" }).click();
    assert.equal(await requests.count(), count);
    assert.equal(await composer.getByLabel("Direction").inputValue(), turnaround.brief.direction);
    assert.equal(await composer.locator(".art-figure").count(), 0);
    const send = composer.getByRole("button", { name: "Send brief" });
    assert.ok(await send.isDisabled());
    await composer.getByLabel("Attachment role").selectOption("front");
    await composer.getByRole("button", { name: "Add editor view" }).click();
    await composer.locator(".art-figure").waitFor();
    await send.evaluate((button) => {
      if (!(button instanceof HTMLButtonElement))
        throw new Error("Expected the Send brief button.");
      button.click();
      button.click();
    });
    await requests.nth(count).waitFor();
    const updated = await latest(paired, documentId);
    assert.equal(updated.brief.revision, 2);
    assert.deepEqual(
      updated.attachments.map((a) => a.role),
      ["front", "source-sheet"],
    );
    assert.equal(updated.attachments[1]?.digest, courier.digest);
    assert.notEqual(updated.attachments[0]?.digest, turnaround.attachments[0]?.digest);
    assert.equal(
      (await paired.call("art.list", { documentId, all: true })).requests.length,
      count + 1,
    );
    await composer.getByLabel("Direction").fill("Use the committed body.");
    await composer.getByRole("button", { name: "Add editor view" }).click();
    await composer.locator(".art-figure").waitFor();
    await page.locator("#viewport").focus();
    await page.keyboard.press("Control+z");
    await waitRevision(page, 3);
    await composer.locator(".art-figure").waitFor({ state: "detached" });
    assert.equal(await composer.getByLabel("Direction").inputValue(), "Use the committed body.");
    assert.ok(await send.isDisabled());
    assert.equal(
      changedPixels(before, await editorPixels(page)),
      0,
      "Undo restores the original paint.",
    );
    results.push({
      step: "painted editor pixels",
      ms: 0,
      detail: { width: 192, height: 192, pixelsChanged },
    });
    const undone = (await paired.call("current", { documentId })).document;
    assert.equal(undone?.parts.find((p) => p.id === "p-body")?.paint?.atlas, bodyAtlas);
    await panelEvidence(page, "art-panel-accepted");
  });

  await step("a reply after the person's edit is stale and keeps the head", async () => {
    await sendBrief(page, {
      kind: "turnaround",
      direction: "Try the courier again on the undone body.",
      part: "p-body",
      views: ["whole"],
    });
    const r = await latest(paired, documentId);
    assert.equal(r.brief.revision, 3);
    const renamed = await windowCall(page, "apply", {
      request: {
        format: "irudd.command",
        version: 1,
        requestId: `qa-rename-${crypto.randomUUID()}`,
        documentId,
        expectedRevision: 3,
        command: { type: "edit", ops: [{ op: "part.rename", part: other, label: "crown" }] },
      },
    });
    assert.equal(
      Reflect.get(Object(Reflect.get(Object(renamed), "value")), "kind"),
      "committed",
      JSON.stringify(renamed),
    );
    await waitRevision(page, 4);
    const reply = {
      format: "irudd.art-reply",
      version: 1,
      kind: "turnaround",
      summary: "Courier again",
      image: courier.digest,
    } as const;
    const first = await paired.call("art.submit", {
      artId: r.artId,
      submissionId: "qa-stale-0001",
      reply,
    });
    assert.deepEqual(first.submission.source, { baseRevision: 3, headAtSubmit: 4, stale: true });
    const repeat = await paired.call("art.submit", {
      artId: r.artId,
      submissionId: "qa-stale-0002",
      reply,
    });
    assert.equal(repeat.submission.duplicateOf, "qa-stale-0001");
    assert.equal(await revision(page), 4, "the head stays the person's");
    await page.waitForSelector("#art .art-reply:has-text('the head was 4')");
    await page.waitForSelector("#art .art-reply:has-text('same reply as qa-stale-0001')");
    await page.waitForSelector("#art button:has-text('Prepare updated brief')");
    await page
      .locator("#proposals .proposal:has-text('Courier again') button:has-text('Preview')")
      .first()
      .click();
    await page.waitForSelector("#banner:has-text('The document has moved on')");
    await page.locator("#banner button:has-text('Back to the document')").click();
    assert.equal(await revision(page), 4);
    const head = (await paired.call("current", { documentId })).document;
    assert.equal(head?.parts.find((p) => p.id === other)?.label, "crown");
    assert.equal(head?.parts.find((p) => p.id === "p-body")?.paint?.atlas, bodyAtlas);
    await panelEvidence(page, "art-panel-stale");
  });

  const portraitHead = "p-head-and-neck";
  const portraitId = await step("start coastal-biologist and select its traced head", async () => {
    await page.selectOption("#start", "coastal-biologist");
    await page.waitForFunction(
      (old) => {
        const select = document.querySelector("#document");
        return select instanceof HTMLSelectElement && select.value !== "" && select.value !== old;
      },
      documentId,
      { timeout: 60_000 },
    );
    await waitRevision(page, 1);
    await page.waitForSelector(`#outliner [data-part="${portraitHead}"]`, { timeout: 60_000 });
    await page.click(`#outliner [data-part="${portraitHead}"]`);
    return page.inputValue("#document");
  });
  const portraitStart = await paired.call("current", { documentId: portraitId });
  assert.ok(portraitStart.document);
  const portraitDoc = portraitStart.document;
  const baseRevision = portraitStart.revision;
  const headOf = (doc: CharacterDocument | null | undefined) => {
    const part = doc?.parts.find((p) => p.id === portraitHead);
    assert.ok(part, `the document has ${portraitHead}`);
    return part;
  };
  const baseHead = headOf(portraitDoc);
  assert.ok(baseHead.paint?.atlas, "the head is painted");

  async function sendFitBrief(kind: "depth" | "trace", direction: string): Promise<boolean> {
    const art = page.locator("#art");
    const before = await art.locator(".art-request").count();
    await art.locator('select[aria-label="Kind of artwork"]').selectOption(kind);
    const pick = art.locator(`.art-parts label[title="${portraitHead}"] input[type=radio]`);
    await pick.waitFor({ timeout: 20_000 });
    const preselected = await pick.isChecked();
    if (!preselected) await pick.check();
    if (kind === "depth")
      assert.equal(
        await art.locator('.art-parts label[title="p-body"]').count(),
        0,
        "only painted portraits are offered for depth",
      );
    await art.getByRole("button", { name: "Add sheet views" }).click();
    await art.locator(".art-compose .art-figure").nth(1).waitFor({ timeout: 20_000 });
    await art.locator('textarea[aria-label="Direction"]').fill(direction);
    await art.locator('textarea[aria-label="Direction"]').dispatchEvent("input");
    await art.locator("button:has-text('Send brief')").click();
    await page.waitForFunction(
      (n) => document.querySelectorAll("#art .art-request").length > n,
      before,
      { timeout: 20_000 },
    );
    return preselected;
  }

  async function previewAndAccept(summary: string, at: number) {
    const before = await editorPixels(page);
    const card = page.locator(`#proposals .proposal:has-text('${summary}')`);
    await card.waitFor({ timeout: 20_000 });
    await card.locator("button:has-text('Preview')").click();
    await page.waitForSelector("#banner:has-text('Previewing')");
    const proposed = await editorPixels(page);
    const changed = changedPixels(before, proposed);
    assert.ok(changed > 0, `the previewed fit changes the drawn face (${changed} pixels)`);
    assert.equal(await revision(page), at, "a preview commits nothing");
    await page.locator("#banner button:has-text('Accept')").click();
    await waitRevision(page, at + 1);
    assert.equal(changedPixels(proposed, await editorPixels(page)), 0, "accepted as previewed");
    return { before, changed };
  }

  async function clayPositions(at: number): Promise<Map<string, number[]>> {
    const exported = await paired.call("review.export", {
      documentId: portraitId,
      revision: at,
      preset: "clay",
    });
    const { bytes } = await readArtifact(paired, exported.glb.sha256);
    writeFileSync(join(evidence, `portrait-r${at}-clay.glb`), bytes);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const jsonLength = view.getUint32(12, true);
    const gltf: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
    const bin = new DataView(bytes.buffer, bytes.byteOffset + 20 + jsonLength + 8);
    const list = (key: string): unknown[] => {
      const value: unknown = Reflect.get(Object(gltf), key);
      return Array.isArray(value) ? value : [];
    };
    const num = (o: unknown, key: string) => Number(Reflect.get(Object(o), key) ?? 0);
    const out = new Map<string, number[]>();
    for (const node of list("nodes")) {
      const mesh: unknown = Reflect.get(Object(node), "mesh");
      if (typeof mesh !== "number") continue;
      const values: number[] = [];
      const primitives: unknown = Reflect.get(Object(list("meshes")[mesh]), "primitives");
      for (const primitive of Array.isArray(primitives) ? primitives : []) {
        const attributes: unknown = Reflect.get(Object(primitive), "attributes");
        const position: unknown = Reflect.get(Object(attributes), "POSITION");
        if (typeof position !== "number") continue;
        const accessor = list("accessors")[position];
        const bufferView = list("bufferViews")[num(accessor, "bufferView")];
        const start = num(bufferView, "byteOffset") + num(accessor, "byteOffset");
        const stride = num(bufferView, "byteStride") || 12;
        for (let i = 0; i < num(accessor, "count"); i++)
          for (let k = 0; k < 3; k++) values.push(bin.getFloat32(start + i * stride + 4 * k, true));
      }
      out.set(String(Reflect.get(Object(node), "name")), values);
    }
    return out;
  }

  async function movedNodes(from: number, to: number): Promise<Record<string, number>> {
    const a = await clayPositions(from);
    const b = await clayPositions(to);
    assert.deepEqual([...b.keys()].sort(), [...a.keys()].sort(), "the same exported nodes");
    const out: Record<string, number> = {};
    for (const [name, before] of a) {
      const after = b.get(name) ?? [];
      assert.equal(after.length, before.length, `${name} keeps its vertices`);
      let most = 0;
      for (let i = 0; i < before.length; i++)
        most = Math.max(most, Math.abs((after[i] ?? 0) - (before[i] ?? 0)));
      if (most > 1e-6) out[name] = Math.round(most * 1e6) / 1e6;
    }
    return out;
  }

  async function measuredPanel(png: Uint8Array): Promise<Panel> {
    const rgba = await page.evaluate(
      async ([base64, size]) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const ctx = new OffscreenCanvas(size, size).getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("Missing 2D context.");
        ctx.drawImage(bitmap, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        let text = "";
        for (let i = 0; i < data.length; i += 0x8000)
          text += String.fromCharCode(...data.subarray(i, i + 0x8000));
        return btoa(text);
      },
      [Buffer.from(png).toString("base64"), panelCanvas] as const,
    );
    return panelFromPixels(new Uint8ClampedArray(Buffer.from(rgba, "base64")), panelCanvas);
  }

  const cliMain = join(repository, "apps", "cli", "src", "main.ts");
  const register = pathToFileURL(
    join(repository, "packages", "document", "test", "support", "register.ts"),
  ).href;
  function agentCli(...args: string[]): unknown {
    const out = execFileSync(
      process.execPath,
      ["--import", register, cliMain, ...args, "--credential", credentialFile, "--json"],
      {
        env: appEnvironment({ IRUDD_STATE_DIR: stateDir }),
        encoding: "utf8",
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    const parsed: unknown = JSON.parse(out);
    return parsed;
  }
  const replied = (result: unknown, field: string): unknown =>
    Reflect.get(Object(Reflect.get(Object(result), "submission")), field);

  const depthBrief = await step(
    "a depth brief fits the selected head and carries its sheet panels",
    async () => {
      const preselected = await sendFitBrief("depth", "A front depth pass of this portrait.");
      const r = await latest(paired, portraitId);
      assert.equal(r.brief.kind, "depth");
      assert.deepEqual(r.brief.parts, [portraitHead]);
      assert.equal(r.brief.revision, baseRevision);
      assert.equal(r.apply.available, true, r.apply.reason ?? "no reason");
      assert.equal(r.apply.translator, "portrait-depth");
      assert.deepEqual(
        r.attachments.map((a) => [a.role, a.mediaType, a.width, a.height]),
        [
          ["front", "image/png", panelCanvas, panelCanvas],
          ["side", "image/png", panelCanvas, panelCanvas],
        ],
      );
      const views = await Promise.all(
        r.attachments.map(async (a) => (await readArtFile(paired, r.artId, a.digest)).bytes),
      );
      const [front, side] = views;
      assert.ok(front && side);
      writeFileSync(join(evidence, "depth-front.png"), front);
      writeFileSync(join(evidence, "depth-side.png"), side);
      results.push({ step: "depth brief", ms: 0, detail: { preselected } });
      return { r, front, panels: [await measuredPanel(front), await measuredPanel(side)] as const };
    },
  );

  const depthRevision = await step(
    "the agent's CLI depth pass is previewed, accepted, exported, deduplicated and undone",
    async () => {
      const pass = await page.evaluate(async (base64) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const n = bitmap.width;
        const canvas = new OffscreenCanvas(n, n);
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("Missing 2D context.");
        ctx.drawImage(bitmap, 0, 0);
        const image = ctx.getImageData(0, 0, n, n);
        const px = image.data;
        const spans: ([number, number] | null)[] = [];
        let top = n;
        let bottom = -1;
        for (let y = 0; y < n; y++) {
          let lo = -1;
          let hi = -1;
          for (let x = 0; x < n; x++) {
            const i = 4 * (y * n + x);
            const r = px[i] ?? 0;
            const g = px[i + 1] ?? 0;
            const b = px[i + 2] ?? 0;
            const keyed = Math.min(r, b) > 108 && Math.min(r, b) > g * 1.7 + 32;
            if (keyed || (px[i + 3] ?? 0) < 190) continue;
            if (lo < 0) lo = x;
            hi = x;
          }
          spans.push(hi > lo ? [lo, hi] : null);
          if (hi > lo) {
            top = Math.min(top, y);
            bottom = y;
          }
        }
        for (let y = 0; y < n; y++) {
          const span = spans[y];
          const v = (y - (top + bottom) / 2) / ((bottom - top) / 2 || 1);
          for (let x = 0; x < n; x++) {
            const i = 4 * (y * n + x);
            let g = 0;
            if (span) {
              const u = (x - (span[0] + span[1]) / 2) / ((span[1] - span[0]) / 2 || 1);
              g = Math.round(70 + 175 * Math.sqrt(Math.max(0, 1 - u * u)) * (1 - 0.25 * v * v));
            }
            px[i] = g;
            px[i + 1] = g;
            px[i + 2] = g;
            px[i + 3] = 255;
          }
        }
        ctx.putImageData(image, 0, 0);
        const blob = await canvas.convertToBlob({ type: "image/png" });
        const out = new Uint8Array(await blob.arrayBuffer());
        let text = "";
        for (let i = 0; i < out.length; i += 0x8000)
          text += String.fromCharCode(...out.subarray(i, i + 0x8000));
        return btoa(text);
      }, Buffer.from(depthBrief.front).toString("base64"));
      const file = join(evidence, "depth-pass.png");
      writeFileSync(file, Buffer.from(pass, "base64"));
      const reply = ["--image", file, "--summary", "Portrait depth pass"];
      const artId = depthBrief.r.artId;
      const submitted = agentCli(
        "art",
        "submit",
        artId,
        ...reply,
        "--submission-id",
        "qa-depth-0001",
      );
      assert.equal(replied(submitted, "state"), "proposed", JSON.stringify(submitted));
      assert.equal(replied(submitted, "translator"), "portrait-depth");
      const { before, changed } = await previewAndAccept("Portrait depth pass", baseRevision);
      const accepted = (await paired.call("current", { documentId: portraitId })).document;
      assert.ok(accepted);
      const depth = figurePortraitDepth.read(headOf(accepted).features);
      assert.equal(depth?.field?.mix, 0.88, "the head carries the fitted depth field");
      assert.deepEqual(
        depth?.pins,
        figurePortraitDepth.read(baseHead.features)?.pins,
        "its depth pins stay",
      );
      assert.deepEqual(
        accepted.parts.filter((p) => p.id !== portraitHead),
        portraitDoc.parts.filter((p) => p.id !== portraitHead),
        "every other part stays",
      );
      const moved = await movedNodes(baseRevision, baseRevision + 1);
      assert.ok(Object.keys(moved).length > 0, "the exported face moved");
      for (const name of Object.keys(moved)) assert.match(name, /head_and_neck/i, name);
      const repeat = agentCli("art", "submit", artId, ...reply, "--submission-id", "qa-depth-0002");
      assert.equal(replied(repeat, "duplicateOf"), "qa-depth-0001");
      assert.equal(await revision(page), baseRevision + 1, "a duplicate commits nothing");
      await page.locator("#viewport").focus();
      await page.keyboard.press("Control+z");
      await waitRevision(page, baseRevision + 2);
      const undone = (await paired.call("current", { documentId: portraitId })).document;
      assert.deepEqual(headOf(undone), baseHead, "undo restores the head");
      assert.equal(changedPixels(before, await editorPixels(page)), 0, "undo redraws the old face");
      results.push({
        step: "depth fit",
        ms: 0,
        detail: { pixelsChanged: changed, glbMoved: moved },
      });
      await panelEvidence(page, "art-panel-depth");
      return baseRevision + 2;
    },
  );

  await step(
    "a trace map's face marks and depth pairs fit the head; its other regions are named",
    async () => {
      const preselected = await sendFitBrief(
        "trace",
        "Mark the face and match depth points in both views.",
      );
      const r = await latest(paired, portraitId);
      assert.equal(r.brief.kind, "trace");
      assert.deepEqual(r.brief.parts, [portraitHead]);
      assert.equal(r.brief.revision, depthRevision);
      assert.equal(r.apply.translator, "trace-fit");
      assert.deepEqual(
        r.attachments.map((a) => [a.role, a.width]),
        [
          ["front", 768],
          ["side", 768],
        ],
      );
      for (const a of r.attachments)
        writeFileSync(
          join(evidence, `trace-${a.role}.png`),
          (await readArtFile(paired, r.artId, a.digest)).bytes,
        );
      const now = (await paired.call("current", { documentId: portraitId })).document;
      assert.equal(headOf(now).paint?.atlas, baseHead.paint?.atlas);
      const [f, s] = depthBrief.panels;
      const binding = figurePaint.read(baseHead.features);
      assert.ok(binding?.portrait);
      const portrait = binding.portrait;
      const first = binding.rest[0];
      const last = binding.rest[binding.rest.length - 1];
      assert.ok(first && last);
      const base = (first[1] + binding.offset[1]) / binding.height;
      const span = (last[1] + binding.offset[1]) / binding.height - base;
      const centre = portrait.frame?.centerX ?? 0;
      const mark = (x: number, y: number): [number, number] => [
        (x * f.span + f.mid) / f.size,
        (f.feet - (y * span + base) * f.span) / f.size,
      ];
      const half = (portrait.width * 1.04 * 0.85 * span) / 2;
      const lips = portrait.mouth - 0.25 * (portrait.mouth - portrait.chin);
      const marks = [
        mark(centre - half, portrait.eyes),
        mark(centre + half, portrait.eyes),
        mark(centre, portrait.nose),
        mark(centre, lips),
        mark(centre, portrait.chin),
      ];
      const pair = (y: number): [number, number, number, number, number] => {
        const [fx, fy] = mark(centre, y);
        const sy = (s.feet - ((f.feet - fy * f.size) / f.span) * s.span) / s.size;
        const row = Math.round(sy * s.size);
        let edge = -1;
        for (let x = 0; x < s.size && edge < 0; x++) if (s.mask[row * s.size + x]) edge = x;
        assert.ok(edge >= 0, `the profile has the subject at ${sy}`);
        return [fx, fy, (edge + 3) / s.size, sy, 0.08];
      };
      const outline = (top: number, bottom: number) => [
        [0.4, top],
        [0.6, top],
        [0.6, bottom],
        [0.4, bottom],
      ];
      const traceMap = {
        format: "irudd.trace-map.v1",
        height: 0.32,
        regions: [
          {
            id: portraitHead,
            method: "loft",
            front: outline(0.05, 0.2),
            side: outline(0.05, 0.2),
            faceLandmarks: marks,
            depthPairs: [pair(portrait.nose), pair(lips)],
          },
          {
            id: "collar",
            parent: portraitHead,
            method: "volume",
            front: outline(0.18, 0.22),
            side: outline(0.18, 0.22),
          },
        ],
      };
      const file = join(evidence, "trace-map.json");
      writeFileSync(file, JSON.stringify(traceMap, null, 2));
      const submitted = agentCli(
        "art",
        "submit",
        r.artId,
        "--trace-map",
        file,
        "--summary",
        "Face marks and depth pairs",
        "--submission-id",
        "qa-trace-0001",
      );
      assert.equal(replied(submitted, "state"), "proposed", JSON.stringify(submitted));
      await page.waitForSelector("#proposals .proposal:has-text('Not built: collar')", {
        timeout: 20_000,
      });
      const { changed } = await previewAndAccept("Face marks and depth pairs", depthRevision);
      const fitted = (await paired.call("current", { documentId: portraitId })).document;
      assert.ok(fitted);
      const after = figurePaint.read(headOf(fitted).features);
      assert.ok(after?.portrait);
      assert.ok(
        Math.abs(after.portrait.mouth - lips) < 1e-3,
        "the lips are where the agent marked",
      );
      assert.ok(after.portrait.width > portrait.width, "the face is calibrated wider");
      assert.deepEqual(after.rest, binding.rest, "the traced cross sections stay");
      const pins = figurePortraitDepth.read(headOf(fitted).features)?.pins ?? [];
      const prior = figurePortraitDepth.read(baseHead.features)?.pins ?? [];
      assert.equal(pins.length, Math.min(24, prior.length + 2), "both depth pairs became pins");
      assert.equal(fitted.parts.length, portraitDoc.parts.length, "the collar is not built");
      assert.deepEqual(
        fitted.parts.filter((p) => p.id !== portraitHead),
        portraitDoc.parts.filter((p) => p.id !== portraitHead),
        "every other part stays",
      );
      const moved = await movedNodes(depthRevision, depthRevision + 1);
      assert.ok(Object.keys(moved).length > 0, "the exported face moved");
      for (const name of Object.keys(moved)) assert.match(name, /head_and_neck/i, name);
      const inspected = await paired.call("review.inspect", {
        documentId: portraitId,
        revision: depthRevision + 1,
        preset: "clay",
        sheets: ["portrait"],
      });
      assert.ok(inspected.images.length > 0, "the review worker drew the fitted face");
      for (const image of inspected.images)
        writeFileSync(
          join(evidence, `trace-fitted-${image.name}`),
          (await readArtifact(paired, image.sha256)).bytes,
        );
      results.push({
        step: "trace fit",
        ms: 0,
        detail: {
          preselected,
          pixelsChanged: changed,
          glbMoved: moved,
          gpu: inspected.gpu,
          portraitImages: inspected.images.map((i) => i.name),
        },
      });
      await panelEvidence(page, "art-panel-trace");
    },
  );

  await step(
    "a person's depth import becomes their own proposal; cancel refuses later replies",
    async () => {
      await sendFitBrief("depth", "A front depth map for the portrait.");
      const r = await latest(paired, portraitId);
      const front = r.attachments[0];
      assert.ok(front);
      const card = page.locator("#art .art-request", { hasText: "A front depth map" });
      await card.locator("input[type=file]").setInputFiles(join(evidence, "depth-pass.png"));
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Artist or studio").fill("QA studio");
      await dialog.getByLabel("Source").fill("QA editor capture");
      await dialog.getByLabel("Credit").fill("QA artist");
      await dialog.getByLabel("License").fill("CC0-1.0");
      await dialog.getByRole("button", { name: "Import artwork" }).click();
      await card.locator(".art-reply.art-proposed").waitFor({ timeout: 20_000 });
      const view = await paired.call("art.get", { artId: r.artId });
      assert.equal(view.submissions[0]?.via, "person-import");
      assert.deepEqual(view.submissions[0]?.reply.attribution, {
        author: "QA studio",
        source: "QA editor capture",
        credit: "QA artist",
        license: "CC0-1.0",
      });
      assert.equal(view.submissions[0]?.state, "proposed");
      await card.locator("button:has-text('Cancel request')").click();
      await card.locator("text=cancelled").first().waitFor({ timeout: 20_000 });
      await assert.rejects(
        paired.call("art.submit", {
          artId: r.artId,
          submissionId: "qa-late-0001",
          reply: {
            format: "irudd.art-reply",
            version: 1,
            kind: "depth",
            summary: "Late",
            image: front.digest,
          },
        }),
        /ArtClosed|closed|cancel/i,
      );
    },
  );

  await step(
    "a trace brief that builds adds the agent's regions as parts on the body's sheet, as G0 builds them",
    async () => {
      const at = (await paired.call("current", { documentId: portraitId })).revision;
      const before = (await paired.call("current", { documentId: portraitId })).document;
      assert.ok(before);
      const body = before.parts.find((p) => p.id === "p-body");
      const atlas = body?.paint?.atlas;
      assert.ok(body && atlas, "the body is painted");
      const art = page.locator("#art");
      const count = await art.locator(".art-request").count();
      await art.locator('select[aria-label="Kind of artwork"]').selectOption("trace");
      await art.locator('select[aria-label="Trace intent"]').selectOption("build");
      const pick = art.locator('.art-parts label[title="p-body"] input[type=radio]');
      await pick.waitFor({ timeout: 20_000 });
      await pick.check();
      await art.getByRole("button", { name: "Add sheet views" }).click();
      await art.locator(".art-compose .art-figure").nth(1).waitFor({ timeout: 20_000 });
      const direction = "Trace a satchel, a hood, a cape and a strap on the body's sheet.";
      await art.locator('textarea[aria-label="Direction"]').fill(direction);
      await art.locator('textarea[aria-label="Direction"]').dispatchEvent("input");
      await art.locator("button:has-text('Send brief')").click();
      await page.waitForFunction(
        (n) => document.querySelectorAll("#art .art-request").length > n,
        count,
        { timeout: 20_000 },
      );
      const r = await latest(paired, portraitId);
      assert.equal(r.brief.kind, "trace");
      assert.equal(r.brief.intent, "build");
      assert.deepEqual(r.brief.parts, ["p-body"]);
      assert.equal(r.brief.revision, at);
      assert.equal(r.apply.translator, "trace-build");
      const shown: unknown = Reflect.get(Object(agentCli("art", "show", r.artId)), "apply");
      assert.equal(
        Reflect.get(Object(shown), "translator"),
        "trace-build",
        "the agent's CLI sees the build",
      );

      const asset = bundledAssets.find((a) => a.digest === atlas);
      assert.ok(asset, "the body paints from a shipped sheet");
      const sheet = readFileSync(join(repository, "character-view", asset.file));
      const quadrants = await page.evaluate(
        async ([base64, mediaType, size]) => {
          const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
          const url = URL.createObjectURL(new Blob([bytes], { type: mediaType }));
          const img = document.createElement("img");
          await new Promise((done, fail) => {
            img.onload = done;
            img.onerror = fail;
            img.src = url;
          });
          URL.revokeObjectURL(url);
          const out: string[] = [];
          for (let q = 0; q < 4; q++) {
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = size;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            if (!ctx) throw new Error("Missing 2D context.");
            ctx.drawImage(
              img,
              ((q % 2) * img.width) / 2,
              (Math.floor(q / 2) * img.height) / 2,
              img.width / 2,
              img.height / 2,
              0,
              0,
              size,
              size,
            );
            const data = ctx.getImageData(0, 0, size, size).data;
            let text = "";
            for (let i = 0; i < data.length; i += 0x8000)
              text += String.fromCharCode(...data.subarray(i, i + 0x8000));
            out.push(btoa(text));
          }
          return out;
        },
        [sheet.toString("base64"), asset.mediaType, panelCanvas] as const,
      );
      const [f, s, back, left] = quadrants.map((q) =>
        panelFromPixels(new Uint8ClampedArray(Buffer.from(q, "base64")), panelCanvas),
      );
      assert.ok(f && s && back && left, "the sheet has four views");
      const panels = [f, s, back, left] as const;
      const fp = (u: number, h: number): [number, number] => [
        (f.mid + u * f.span) / f.size,
        (f.feet - h * f.span) / f.size,
      ];
      const sp = (u: number, h: number): [number, number] => [
        (s.mid + u * s.span) / s.size,
        (s.feet - h * s.span) / s.size,
      ];
      const rect = (p: typeof fp, u0: number, u1: number, h0: number, h1: number) => [
        p(u0, h1),
        p(u1, h1),
        p(u1, h0),
        p(u0, h0),
      ];
      const regions: TraceBuildRegion[] = [
        {
          id: "body",
          method: "loft",
          front: rect(fp, -0.15, 0.15, 0.45, 0.8),
          side: rect(sp, -0.1, 0.1, 0.45, 0.8),
        },
        {
          id: "satchel",
          parent: "body",
          method: "volume",
          motionRole: "rigid",
          outfitRole: "accessory",
          front: rect(fp, 0.02, 0.14, 0.46, 0.56),
          side: rect(sp, -0.08, 0.08, 0.46, 0.56),
        },
        {
          id: "hood",
          parent: "body",
          method: "loft",
          outfitRole: "head",
          front: rect(fp, -0.09, 0.09, 0.86, 0.99),
          side: rect(sp, -0.09, 0.09, 0.86, 0.99),
        },
        {
          id: "cape",
          parent: "body",
          method: "membrane",
          correspondence: "same",
          thickness: 0.012,
          front: rect(fp, -0.15, 0.15, 0.6, 0.78),
          side: rect(sp, 0, 0.1, 0.6, 0.78),
        },
        {
          id: "strap",
          parent: "satchel",
          method: "path",
          spine: [0.42, 0.34, 0.26, 0.18, 0.1].map(
            (h): [number, number, number, number, number, number] => [
              ...fp(0.06, h),
              ...sp(0, h),
              0.03,
              0.03,
            ],
          ),
        },
        {
          id: "ghost",
          parent: "body",
          method: "volume",
          front: rect(fp, -0.48, -0.4, 0.02, 0.1),
          side: rect(sp, -0.48, -0.4, 0.02, 0.1),
        },
      ];
      const traceMap = { format: "irudd.trace-map.v1", height: 1.77, regions };
      const file = join(evidence, "trace-build-map.json");
      writeFileSync(file, JSON.stringify(traceMap, null, 2));
      const summary = "Satchel, hood, cape and strap";
      const submitted = agentCli(
        "art",
        "submit",
        r.artId,
        "--trace-map",
        file,
        "--summary",
        summary,
        "--submission-id",
        "qa-build-0001",
      );
      assert.equal(replied(submitted, "state"), "proposed", JSON.stringify(submitted));
      assert.equal(replied(submitted, "translator"), "trace-build");
      await page.waitForSelector("#proposals .proposal:has-text('Not built: ghost')", {
        timeout: 20_000,
      });
      const expected = traceBuildOperations(before, "p-body", regions, panels, 1.77);
      const proposalId = String(Reflect.get(Object(replied(submitted, "proposal")), "id"));
      const draft = await paired.call("draft", { documentId: portraitId, proposalId });
      assert.ok(draft.ok);
      const proposed = draft.ok ? draft.preview : before;
      const added = (doc: CharacterDocument) =>
        doc.parts.filter((p) => !before.parts.some((q) => q.id === p.id));
      const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : 1);
      const stored: unknown = JSON.parse(JSON.stringify(expected.built.map((b) => b.part)));
      assert.deepEqual(
        added(proposed),
        Array.isArray(stored) ? stored.sort(byId) : stored,
        "the proposal is exactly the build of the measured sheet",
      );
      const placements = partPlacements(proposed, registry);
      const anchor = placements.get("p-body")?.frame;
      assert.ok(anchor);
      const origin = figurePaint.read(body.features)?.offset ?? [0, 0, 0];
      const compared: Record<string, unknown> = {};
      const built = expected.built.map((b) => {
        const part = proposed.parts.find((p) => p.id === b.part.id);
        assert.ok(part);
        const world = placements.get(part.id)?.frame;
        assert.ok(world);
        compared[b.region] = { method: b.method, part: part.id, parent: part.parent };
        return {
          region: b.region,
          method: b.method,
          part: part.id,
          parent: part.parent,
          hull: figureHull.read(part.features),
          paint: figurePaint.read(part.features),
          knots: figureSweep.read(part.features)?.knots,
          world: affinePoint(world, [0, 0, 0]),
        };
      });
      mkdirSync(traceOut, { recursive: true });
      writeFileSync(
        join(traceOut, "trace-build.json"),
        JSON.stringify({
          sheet: asset.file,
          height: figurePaint.read(body.features)?.height,
          anchorShift: affinePoint(anchor, [0, 0, 0]).map((v, i) => v - (origin[i] ?? 0)),
          panels: panels.map((p) => ({
            size: p.size,
            mid: p.mid,
            feet: p.feet,
            span: p.span,
            mask: Buffer.from(p.mask).toString("base64"),
          })),
          map: traceMap,
          built,
          missed: expected.missed,
        }),
      );
      assert.deepEqual(
        expected.built.map((b) => [b.region, b.part.parent]),
        [
          ["satchel", "p-body"],
          ["hood", "p-body"],
          ["cape", "p-body"],
          ["strap", "p-satchel"],
        ],
      );
      appMemory("before the build is accepted");
      const { before: drawn, changed } = await previewAndAccept(summary, at);
      appMemory("after the build is accepted");
      const accepted = (await paired.call("current", { documentId: portraitId })).document;
      assert.ok(accepted);
      assert.deepEqual(accepted, proposed, "accepted exactly as proposed");
      assert.deepEqual(
        accepted.parts.filter((p) => before.parts.some((q) => q.id === p.id)),
        before.parts,
        "every existing part stays",
      );
      const vertices = (meshes: Map<string, number[]>) => {
        const counts = new Map<string, number>();
        for (const values of meshes.values())
          for (let i = 0; i < values.length; i += 3) {
            const key = `${values[i]},${values[i + 1]},${values[i + 2]}`;
            counts.set(key, (counts.get(key) ?? 0) + 1);
          }
        return counts;
      };
      const was = vertices(await clayPositions(at));
      const now = vertices(await clayPositions(at + 1));
      let kept = 0;
      let total = 0;
      for (const [key, n] of was) {
        total += n;
        kept += Math.min(n, now.get(key) ?? 0);
      }
      assert.equal(kept, total, "every existing exported vertex stays");
      const addedVertices = [...now.values()].reduce((a, b) => a + b, 0) - total;
      assert.ok(addedVertices > 1000, `the built parts add ${addedVertices} vertices`);
      const sheets = async (revisionAt: number) =>
        paired.call("review.inspect", {
          documentId: portraitId,
          revision: revisionAt,
          preset: "full",
          sheets: ["body"],
        });
      appMemory("after the clay exports");
      const drawnBefore = await sheets(at);
      const drawnAfter = await sheets(at + 1);
      for (const image of drawnAfter.images)
        writeFileSync(
          join(evidence, `trace-built-${image.name}`),
          (await readArtifact(paired, image.sha256)).bytes,
        );
      const differ = drawnAfter.images.filter(
        (image, i) => image.sha256 !== drawnBefore.images[i]?.sha256,
      ).length;
      assert.ok(differ > 0, "the drawn body shows the built parts");
      appMemory("after the body is drawn");
      appEvents.push(
        `full exports: ${drawnBefore.glb.byteLength} bytes before, ${drawnAfter.glb.byteLength} after the build`,
      );
      const repeat = agentCli(
        "art",
        "submit",
        r.artId,
        "--trace-map",
        file,
        "--summary",
        summary,
        "--submission-id",
        "qa-build-0002",
      );
      assert.equal(replied(repeat, "duplicateOf"), "qa-build-0001");
      appMemory("after the duplicate");
      await page.locator("#viewport").focus();
      await page.keyboard.press("Control+z");
      await waitRevision(page, at + 2);
      assert.deepEqual(
        (await paired.call("current", { documentId: portraitId })).document?.parts,
        before.parts,
        "undo removes the built parts",
      );
      assert.equal(
        changedPixels(drawn, await editorPixels(page)),
        0,
        "undo redraws the old figure",
      );
      await page.keyboard.press("Control+Shift+z");
      await waitRevision(page, at + 3);
      assert.deepEqual(
        (await paired.call("current", { documentId: portraitId })).document?.parts,
        accepted.parts,
        "redo brings them back",
      );
      results.push({
        step: "trace build",
        ms: 0,
        detail: {
          pixelsChanged: changed,
          built: compared,
          kept: expected.kept,
          missed: expected.missed,
          addedVertices,
          bodyImagesChanged: differ,
          fullExportBytes: [drawnBefore.glb.byteLength, drawnAfter.glb.byteLength],
          gpu: drawnAfter.gpu,
        },
      });
      await panelEvidence(page, "art-panel-trace-build");
    },
  );

  auditProcesses("after the art flows");
  assert.deepEqual(problems, [], "no page errors");
  paired.close();
  agent = undefined;
  await step("quit", () => app?.close() ?? Promise.resolve());
  app = undefined;
  writeFileSync(join(evidence, "report.json"), JSON.stringify({ results, problems }, null, 2));
  console.log(`evidence: ${evidence}`);
} finally {
  agent?.close();
  if (app) await app.close().catch(() => undefined);
  if (!keep) rmSync(scratch, { recursive: true, force: true });
}
