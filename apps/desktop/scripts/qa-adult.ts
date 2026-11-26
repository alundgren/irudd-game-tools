import assert from "node:assert/strict";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { readProvenance } from "@irudd/character";
import { humanSlot } from "@irudd/character/human";
import { BaseSlot, decodeWith, transportOffset } from "@irudd/document";
import { connect, type WorkshopClient } from "@irudd/workshop/client";
import { appDir, appEnvironment, electronExecutable } from "./electron.js";

const { values } = parseArgs({
  options: { keep: { type: "boolean" }, out: { type: "string" } },
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
});
const keep = values.keep === true;
const repository = resolve(appDir, "..", "..");
const outDir = resolve(values.out ?? join(repository, ".reference-cache", "g4a", "human-desktop"));
const scratch = mkdtempSync(join(tmpdir(), "irudd-desktop-adult-"));
const projectDir = join(scratch, "project");
const userData = join(scratch, "user-data");
const stateDir = join(scratch, "state");
const distribution = join(scratch, "Workshop App");
mkdirSync(distribution);
copyFileSync(join(appDir, "package.json"), join(distribution, "package.json"));
cpSync(join(appDir, "dist"), join(distribution, "dist"), { recursive: true });
const results: { step: string; ms: number; detail?: string }[] = [];
const problems: string[] = [];
const presets = ["clay", "full", "game"] as const;

async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    const value = await run();
    results.push({ step: name, ms: Math.round(performance.now() - started) });
    console.log(`ok   ${name} (${Math.round(performance.now() - started)} ms)`);
    return value;
  } catch (error) {
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    const page = app?.page;
    if (page)
      for (const id of ["status", "banner", "proposals", "history"])
        console.log(
          `  #${id}: ${((await page.textContent(`#${id}`).catch(() => "")) ?? "").slice(0, 400)}`,
        );
    throw error;
  }
}

interface Running {
  readonly page: Page;
  readonly browser: Browser;
  close(): Promise<void>;
}

async function editorPage(context: BrowserContext): Promise<Page> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const editor = context
      .pages()
      .find((page) => /^file:.*\/dist\/renderer\/index\.html$/.test(page.url()));
    if (editor) return editor;
    if (Date.now() > deadline) throw new Error("The desktop editor page did not open.");
    await new Promise((done) => setTimeout(done, 100));
  }
}

async function launch(extra: string[]): Promise<Running> {
  const child = spawn(
    electronExecutable(),
    [distribution, "--hidden", "--remote-debugging-port=0", "--user-data", userData, ...extra],
    {
      cwd: distribution,
      env: appEnvironment({ IRUDD_STATE_DIR: stateDir }),
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  const exited = new Promise<void>((done) => child.once("exit", () => done()));
  try {
    const endpoint = await new Promise<string>((done, fail) => {
      let text = "";
      const timer = setTimeout(
        () => fail(new Error(`No DevTools endpoint: ${text.slice(-800)}`)),
        60_000,
      );
      child.stderr.on("data", (chunk: Buffer) => {
        text += chunk.toString();
        const match = /DevTools listening on (ws:\/\/\S+)/.exec(text);
        if (match?.[1]) {
          clearTimeout(timer);
          done(match[1]);
        }
      });
      child.once("exit", (code) =>
        fail(new Error(`The app exited with ${code}: ${text.slice(-800)}`)),
      );
    });
    const browser = await chromium.connectOverCDP(endpoint);
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

async function waitRevision(page: Page, at: number): Promise<void> {
  await page.waitForFunction(
    (n) =>
      new RegExp(`revision ${n}\\b`).test(
        document.querySelector("#status-right")?.textContent ?? "",
      ),
    at,
    { timeout: 30_000 },
  );
}

async function exportAt(page: Page, preset: string): Promise<string> {
  const exportsDir = join(projectDir, "exports");
  const before = new Set(existsSync(exportsDir) ? readdirSync(exportsDir) : []);
  await page.click("#tab-workshop");
  await page.selectOption("#export-preset", preset);
  await page.click("#export");
  await page.waitForFunction(
    () =>
      /Exported|Export failed/.test(document.querySelector("#status")?.textContent ?? "") ||
      !!document.querySelector("#banner.error:not([hidden])"),
    undefined,
    { timeout: 180_000 },
  );
  const banner = await page.locator("#banner.error:not([hidden])").count();
  if (banner) throw new Error((await page.textContent("#banner")) ?? "Export failed.");
  const added = readdirSync(exportsDir).filter((f) => !before.has(f));
  assert.equal(added.length, 1, `one new ${preset} export`);
  return join(exportsDir, added[0] ?? "");
}

function binaryChunk(bytes: Buffer): Buffer {
  const jsonLength = bytes.readUInt32LE(12);
  const at = 20 + jsonLength;
  return bytes.subarray(at + 8, at + 8 + bytes.readUInt32LE(at));
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

interface AdultPart {
  readonly id: string;
  readonly label: string;
  readonly slot: unknown;
  readonly position: ReadonlyArray<number>;
}

function adultOf(doc: unknown): {
  readonly parts: ReadonlyArray<AdultPart>;
  readonly params: Record<string, unknown>;
  readonly human: Record<string, unknown>;
  readonly base: (slot: unknown) => BaseSlot;
} {
  if (!isRecord(doc) || !Array.isArray(doc["parts"])) throw new Error("Not a document.");
  const parts = doc["parts"].filter(isRecord).map((p) => ({
    id: String(p["id"]),
    label: String(p["label"]),
    slot: p["slot"],
    position: Array.isArray(p["position"]) ? p["position"].map(Number) : [],
  }));
  const generation = doc["generation"];
  const params = isRecord(generation) ? generation["params"] : undefined;
  if (!isRecord(params) || !isRecord(params["human"]))
    throw new Error("The document carries no adult parameters.");
  const base = isRecord(generation) ? generation["base"] : undefined;
  const slots =
    isRecord(base) && Array.isArray(base["slots"]) ? base["slots"].filter(isRecord) : [];
  return {
    parts,
    params,
    human: params["human"],
    base(slot) {
      const read = decodeWith(
        BaseSlot,
        slots.find((b) => b["slot"] === slot),
      );
      if (!read.ok) throw new Error(`No base slot ${String(slot)}.`);
      return read.value;
    },
  };
}

let agent: WorkshopClient | undefined;
let app: Running | undefined;
try {
  app = await step("launch hidden on a new project", () =>
    launch(["--project", projectDir, "--create"]),
  );
  const page = app.page;

  await step("the starter menu offers the adult's presets and a new seed", async () => {
    const options = await page
      .locator("#start option")
      .evaluateAll((list) => list.map((o) => (o instanceof HTMLOptionElement ? o.value : "")));
    for (const seed of [491, 8950, 8990, 716973847])
      assert.ok(options.includes(`human-adult/preset/seed-${seed}`), `preset seed-${seed}`);
    assert.ok(options.includes("human-adult/seed"), "a new seeded adult");
  });

  await step("start the adult from its seed-491 preset", async () => {
    await page.selectOption("#start", "human-adult/preset/seed-491");
    await waitRevision(page, 1);
    await page.waitForSelector("#outliner [data-part]");
    assert.equal(await page.locator("#banner.error:not([hidden])").count(), 0, "no error banner");
    const regions = await page.locator("#outliner [data-part]").count();
    assert.equal(regions, 52, "52 editable body regions");
  });

  await step("pair an agent and connect it", async () => {
    await page.fill("#agents input", "qa-agent");
    await page.click("#agents button:has-text('Pair')");
    await page.waitForSelector("#agents p:has-text('Paired qa-agent')");
    const hosts = join(stateDir, "hosts");
    const credential = readdirSync(hosts)
      .map((key) => join(hosts, key, "agents", "qa-agent.json"))
      .find((candidate) => existsSync(candidate));
    assert.ok(credential, "the pairing wrote a credential file");
    agent = await connect({
      credential: { role: "agent", file: credential },
      client: { name: "desktop-adult-qa", version: "1" },
      stateDir,
    });
  });

  const documentId = await page.inputValue("#document");
  const head = async () => {
    assert.ok(agent);
    return adultOf((await agent.call("inspect", { documentId })).document);
  };
  const started = await head();

  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, "regions.json"),
    JSON.stringify(Object.fromEntries(started.parts.map((p) => [p.label, p.id])), null, 2),
  );
  for (const preset of presets)
    await step(`export revision 1 at ${preset}`, async () => {
      const file = await exportAt(page, preset);
      copyFileSync(file, join(outDir, `adult-491-${preset}.glb`));
    });

  const forearm = started.parts.find((p) => p.slot === humanSlot("lowerarm_l"));
  assert.ok(forearm, "the left forearm is a part");
  const moved = (forearm.position[0] ?? 0) + 0.02;

  await step("move the left forearm by hand in the properties", async () => {
    await page.click("#tab-workshop");
    await page.click(`#outliner [data-part="${forearm.id}"]`);
    await page.waitForSelector(`#outliner .row.selected[data-part="${forearm.id}"]`);
    const x = page.locator("#properties .triple").nth(1).locator("input").first();
    await x.fill(moved.toFixed(6));
    await x.press("Tab");
    await waitRevision(page, 2);
  });
  const edited = await head();

  await step("accept the agent's steer to more muscle after a preview", async () => {
    assert.ok(agent);
    const { params, human } = await head();
    const created = await agent.call("apply", {
      request: {
        format: "irudd.command",
        version: 1,
        requestId: `qa-${crypto.randomUUID()}`,
        documentId,
        expectedRevision: 2,
        command: {
          type: "proposal.create",
          proposal: "prop-qa-muscle",
          summary: "More muscle",
          content: {
            kind: "ops",
            ops: [
              { op: "generation.steer", params: { ...params, human: { ...human, muscle: 0.1 } } },
            ],
          },
        },
      },
    });
    assert.equal(created.kind, "committed", JSON.stringify(created));
    await page.waitForSelector("#proposals .proposal:has-text('More muscle')");
    await page.click("#proposals .proposal button:has-text('Preview')");
    await page.waitForSelector("#banner:has-text('Previewing')");
    await page.click("#banner button:has-text('Accept')");
    await waitRevision(page, 3);
  });

  await step("export revision 3 fresh at full: the steer and the hand edit both hold", async () => {
    const file = await exportAt(page, "full");
    const provenance = readProvenance(readFileSync(file));
    assert.ok(isRecord(provenance), "the export carries its provenance");
    assert.ok(agent);
    const view = await agent.call("inspect", { documentId });
    assert.equal(provenance["revision"], 3);
    assert.equal(provenance["document"], documentId);
    assert.equal(provenance["digest"], view.documentDigest, "exported from the steered head");
    const doc = adultOf(view.document);
    assert.equal(doc.human["muscle"], 0.1, "the steer took");
    const before = edited.parts.find((p) => p.id === forearm.id);
    const held = doc.parts.find((p) => p.id === forearm.id);
    assert.ok(before && held);
    assert.ok(Math.abs((before.position[0] ?? 0) - moved) < 1e-6, "the hand edit committed");
    const [x = 0, y = 0, z = 0] = before.position;
    const carried = transportOffset([x, y, z], edited.base(forearm.slot), doc.base(forearm.slot));
    const steeredBase = doc.base(forearm.slot).position;
    for (let d = 0; d < 3; d++)
      assert.ok(
        Math.abs((held.position[d] ?? 0) - (carried[d] ?? 0)) < 1e-9,
        `the hand edit is carried through the steer (axis ${d})`,
      );
    assert.ok(
      Math.abs((held.position[0] ?? 0) - (steeredBase[0] ?? 0)) > 0.01,
      "the forearm still stands off the steered base",
    );
    results.push({
      step: "held edit",
      ms: 0,
      detail: `forearm ${JSON.stringify(held.position)}, steered base ${JSON.stringify(steeredBase)}`,
    });
    const first = readFileSync(
      join(
        projectDir,
        "exports",
        readdirSync(join(projectDir, "exports")).find((f) => f.includes("-r1-full")) ?? "",
      ),
    );
    assert.notDeepEqual(
      binaryChunk(first),
      binaryChunk(readFileSync(file)),
      "the steered body is a new shape",
    );
  });

  agent?.close();
  agent = undefined;
  await step("quit", () => (app ? app.close() : Promise.resolve()));
  app = undefined;
} finally {
  agent?.close();
  await app?.close().catch(() => undefined);
  const report = { results, problems, out: outDir, scratch: keep ? scratch : undefined };
  console.log(JSON.stringify(report, null, 2));
  if (!keep) rmSync(scratch, { recursive: true, force: true });
}
if (problems.length) {
  console.error("Page errors were reported.");
  process.exitCode = 1;
}
