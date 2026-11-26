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
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { connect, type WorkshopClient } from "@irudd/workshop/client";
import { appDir, appEnvironment, electronExecutable } from "./electron.js";

const { values } = parseArgs({
  options: { keep: { type: "boolean" }, executable: { type: "string" }, scale: { type: "string" } },
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
});
const keep = values.keep === true;
const scale = values.scale === undefined ? undefined : Number(values.scale);
if (scale !== undefined && (!Number.isFinite(scale) || scale <= 0))
  throw new Error("--scale requires a positive display scale factor.");
const installed = values.executable ? resolve(values.executable) : undefined;
const scratch = mkdtempSync(join(tmpdir(), "irudd-desktop-qa-"));
const projectDir = join(scratch, "project");
const userData = join(scratch, "user-data");
const stateDir = join(scratch, "state");
const repository = resolve(appDir, "..", "..");
const distribution = join(scratch, "Workshop App");
if (!installed) {
  mkdirSync(distribution);
  copyFileSync(join(appDir, "package.json"), join(distribution, "package.json"));
  cpSync(join(appDir, "dist"), join(distribution, "dist"), { recursive: true });
}
const results: { step: string; ms: number; detail?: string }[] = [];
const problems: string[] = [];

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
      for (const id of ["status", "banner", "agents", "proposals", "history", "sheet-status"])
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
  const found = Promise.withResolvers<Page>();
  const watched = new Set<Page>();
  const inspect = (): void => {
    const editor = context
      .pages()
      .find((page) => /^file:.*\/dist\/renderer\/index\.html$/.test(page.url()));
    if (editor) found.resolve(editor);
  };
  const watch = (page: Page): void => {
    if (watched.has(page)) return;
    watched.add(page);
    page.on("framenavigated", inspect);
    inspect();
  };
  context.on("page", watch);
  const timeout = setTimeout(
    () => found.reject(new Error("The desktop editor page did not open.")),
    60_000,
  );
  try {
    context.pages().forEach(watch);
    return await found.promise;
  } finally {
    clearTimeout(timeout);
    context.off("page", watch);
    for (const page of watched) page.off("framenavigated", inspect);
  }
}

async function launch(extra: string[]): Promise<Running> {
  const child = spawn(
    installed ?? electronExecutable(),
    [
      ...(installed ? [] : [distribution]),
      "--hidden",
      "--remote-debugging-port=0",
      ...(scale !== undefined ? [`--force-device-scale-factor=${scale}`] : []),
      "--user-data",
      userData,
      ...extra,
    ],
    {
      cwd: installed ? dirname(installed) : distribution,
      env: appEnvironment({
        IRUDD_STATE_DIR: stateDir,
        ...(installed && process.platform === "win32"
          ? { PATH: join(process.env["SystemRoot"] ?? "C:\\Windows", "System32") }
          : {}),
      }),
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

async function revision(page: Page): Promise<number> {
  const text = (await page.textContent("#status-right")) ?? "";
  const match = /revision (\d+)/.exec(text);
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

async function decodeInPage(
  page: Page,
  file: string,
): Promise<{ width: number; height: number; corners: number[][] }> {
  const base64 = readFileSync(file).toString("base64");
  return page.evaluate(async (data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2D context.");
    ctx.drawImage(bitmap, 0, 0);
    const px = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data];
    const w = bitmap.width - 1;
    const h = bitmap.height - 1;
    return {
      width: bitmap.width,
      height: bitmap.height,
      corners: [px(0, 0), px(w, 0), px(0, h), px(w, h)],
    };
  }, base64);
}

let agent: WorkshopClient | undefined;
let app: Running | undefined;
try {
  app = await step("launch hidden on a new project", () =>
    launch(["--project", projectDir, "--create"]),
  );
  let page = app.page;
  const info = await page.evaluate(() => {
    const canvas = document.querySelector("#viewport canvas");
    return {
      status: document.querySelector("#status-right")?.textContent ?? "",
      dpr: devicePixelRatio,
      canvas:
        canvas instanceof HTMLCanvasElement
          ? [canvas.width, canvas.height, canvas.clientWidth, canvas.clientHeight]
          : [],
      visible: document.visibilityState,
    };
  });
  if (scale !== undefined)
    assert.equal(info.dpr, scale, "requested device scale in the real window");
  results.push({ step: "viewport", ms: 0, detail: JSON.stringify(info) });
  const [cw = 0, ch = 0, cssW = 0, cssH = 0] = info.canvas;
  assert.ok(Math.abs(cw - cssW * info.dpr) <= info.dpr, "viewport is drawn at device resolution");
  assert.ok(Math.abs(ch - cssH * info.dpr) <= info.dpr, "viewport is drawn at device resolution");
  assert.equal(existsSync(join(projectDir, "workshop.sqlite")), true);

  await step("start the marsh-draw-3 form", async () => {
    await page.selectOption("#start", "marsh-draw-3");
    await page.waitForSelector("#outliner [data-part]");
    await waitRevision(page, 1);
  });

  await step("select a part in the outliner", async () => {
    await page.click('#outliner [data-part="p-head"]');
    await page.waitForSelector('#outliner .row.selected[data-part="p-head"]');
  });

  await step("rename with one commit", async () => {
    await page.dblclick('#outliner [data-part="p-head"]');
    await page.fill("#outliner input", "snout");
    await page.press("#outliner input", "Enter");
    await waitRevision(page, 2);
    await page.waitForSelector('#outliner [data-part="p-head"] >> text=snout');
  });

  await step("resize with one commit", async () => {
    const size = page.locator("#properties .triple").first().locator("input").first();
    await size.fill("2.1");
    await size.press("Tab");
    await waitRevision(page, 3);
    const history = await page.locator("#history li").count();
    assert.equal(history, 3, "create, rename and resize are three revisions");
  });

  await step("undo and redo", async () => {
    await page.click("#viewport");
    await page.keyboard.press("Control+z");
    await waitRevision(page, 4);
    assert.equal(await page.locator("#history li.undone").count(), 1);
    await page.keyboard.press("Control+Shift+z");
    await waitRevision(page, 5);
  });

  const documentId = await page.inputValue("#document");

  await step("pair an agent and connect it", async () => {
    await page.fill("#agents input", "qa-agent");
    await page.click("#agents button:has-text('Pair')");
    await page.waitForSelector("#agents p:has-text('Paired qa-agent')");
    const file = join(stateDir, "hosts");
    const credential = readdirSync(file)
      .map((key) => join(file, key, "agents", "qa-agent.json"))
      .find((candidate) => existsSync(candidate));
    assert.ok(credential, "the pairing wrote a credential file");
    agent = await connect({
      credential: { role: "agent", file: credential },
      client: { name: "desktop-qa", version: "1" },
      stateDir,
    });
  });

  const at = await revision(page);
  const envelope = (command: unknown, expected = at) => ({
    request: {
      format: "irudd.command",
      version: 1,
      requestId: `qa-${crypto.randomUUID()}`,
      documentId,
      expectedRevision: expected,
      command,
    },
  });

  await step("an agent's direct edit needs a proposal", async () => {
    assert.ok(agent);
    const result = await agent.call(
      "apply",
      envelope({ type: "edit", ops: [{ op: "part.rename", part: "p-body", label: "torso" }] }),
    );
    assert.equal(result.kind, "rejected");
    if (result.kind === "rejected")
      assert.ok(result.diagnostics.some((d) => d.code === "proposal-required"));
  });

  await step("preview and accept an agent proposal", async () => {
    assert.ok(agent);
    const created = await agent.call(
      "apply",
      envelope({
        type: "proposal.create",
        proposal: "prop-qa-torso",
        summary: "Call the body torso",
        content: { kind: "ops", ops: [{ op: "part.rename", part: "p-body", label: "torso" }] },
      }),
    );
    assert.equal(created.kind, "committed", JSON.stringify(created));
    await page.waitForSelector("#proposals .proposal:has-text('Call the body torso')");
    await page.click("#proposals .proposal button:has-text('Preview')");
    await page.waitForSelector("#banner:has-text('Previewing')");
    assert.equal(await revision(page), at, "a preview commits nothing");
    await page.click("#banner button:has-text('Accept')");
    await waitRevision(page, at + 1);
    await page.waitForSelector('#outliner [data-part="p-body"] >> text=torso');
    const author = await page.locator("#history li").first().textContent();
    assert.match(author ?? "", /qa-agent/);
  });

  await step("a stale proposal that conflicts with a manual edit", async () => {
    assert.ok(agent);
    const created = await agent.call(
      "apply",
      envelope(
        {
          type: "proposal.create",
          proposal: "prop-qa-stale",
          summary: "Call the head beak",
          content: { kind: "ops", ops: [{ op: "part.rename", part: "p-head", label: "beak" }] },
        },
        1,
      ),
    );
    assert.equal(created.kind, "committed", JSON.stringify(created));
    const card = "#proposals .proposal:has-text('Call the head beak')";
    await page.waitForSelector(card);
    await page.click(`${card} button:has-text('Preview')`);
    await page.waitForSelector("#banner:has-text('moved on')");
    const banner = (await page.textContent("#banner")) ?? "";
    results.push({ step: "conflict banner", ms: 0, detail: banner.slice(0, 300) });
    const before = await revision(page);
    await page.click("#banner button:has-text('Accept')");
    await page.waitForSelector("#banner.error");
    assert.equal(await revision(page), before, "a conflicting accept commits nothing");
    await page.click(`${card} button:has-text('Reject')`);
    await page.waitForSelector(card, { state: "detached" });
    assert.equal(await revision(page), before, "a discard appends no revision");
    await page.waitForSelector('#outliner [data-part="p-head"] >> text=snout');
  });

  await step("an agent may edit directly once the person allows it", async () => {
    assert.ok(agent);
    await page.click("#properties input[type=checkbox]");
    await page.waitForFunction(() => {
      const box = document.querySelector("#properties input[type=checkbox]");
      return (
        box instanceof HTMLInputElement &&
        box.checked &&
        !document.querySelector("#banner.error:not([hidden])")
      );
    });
    const now = await revision(page);
    const direct = await agent.call(
      "apply",
      envelope(
        { type: "edit", ops: [{ op: "part.set", part: "p-body", set: { color: "#556b2f" } }] },
        now,
      ),
    );
    assert.equal(direct.kind, "committed", JSON.stringify(direct));
    await waitRevision(page, now + 1);
    const history = await page.locator("#history li").first().textContent();
    assert.match(history ?? "", /qa-agent/);
  });

  const position = async (part: string): Promise<number[]> => {
    assert.ok(agent);
    const head = await agent.call("inspect", { documentId });
    const parts: unknown = Reflect.get(Object(head.document), "parts");
    const found: unknown = Array.isArray(parts)
      ? parts.find((p: unknown) => Reflect.get(Object(p), "id") === part)
      : undefined;
    const value: unknown = Reflect.get(Object(found), "position");
    assert.ok(Array.isArray(value), `${part} has a position`);
    return value.map(Number);
  };
  const xArrow = () =>
    page.evaluate(async () => {
      const canvas = document.querySelector("#viewport canvas");
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error("No viewport canvas.");
      const frame = (tool: string) =>
        new Promise<ImageBitmap>((resolve, reject) => {
          const b = document.getElementById(tool);
          if (!(b instanceof HTMLButtonElement)) throw new Error(`No #${tool}.`);
          b.click();
          requestAnimationFrame(() => createImageBitmap(canvas).then(resolve, reject));
        });
      const pixels = (bitmap: ImageBitmap) => {
        const c = new OffscreenCanvas(bitmap.width, bitmap.height);
        const g = c.getContext("2d");
        if (!g) throw new Error("No 2D context.");
        g.drawImage(bitmap, 0, 0);
        return g.getImageData(0, 0, bitmap.width, bitmap.height).data;
      };
      const plain = pixels(await frame("tool-select"));
      const moving = await frame("tool-move");
      const lit = pixels(moving);
      const points: [number, number][] = [];
      for (let i = 0; i < lit.length; i += 4) {
        const [r, g, b] = [lit[i] ?? 0, lit[i + 1] ?? 0, lit[i + 2] ?? 0];
        const changed =
          Math.abs(r - (plain[i] ?? 0)) +
          Math.abs(g - (plain[i + 1] ?? 0)) +
          Math.abs(b - (plain[i + 2] ?? 0));
        if (changed > 60 && r > 150 && g < 90 && b < 90)
          points.push([(i / 4) % moving.width, Math.floor(i / 4 / moving.width)]);
      }
      if (points.length < 20) throw new Error(`Only ${points.length} red gizmo pixels.`);
      const mx = points.reduce((s, p) => s + p[0], 0) / points.length;
      const my = points.reduce((s, p) => s + p[1], 0) / points.length;
      let sxx = 0;
      let sxy = 0;
      let syy = 0;
      for (const [x, y] of points) {
        sxx += (x - mx) ** 2;
        sxy += (x - mx) * (y - my);
        syy += (y - my) ** 2;
      }
      const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      const ux = Math.cos(angle);
      const uy = Math.sin(angle);
      const along = points
        .map((p) => ({ p, t: (p[0] - mx) * ux + (p[1] - my) * uy }))
        .sort((a, b) => a.t - b.t);
      const pick = along[Math.floor(along.length * 0.85)]?.p ?? [mx, my];
      const rect = canvas.getBoundingClientRect();
      const scale = rect.width / canvas.width;
      return {
        x: rect.left + (pick[0] + 0.5) * scale,
        y: rect.top + (pick[1] + 0.5) * scale,
        ux,
        uy,
        red: points.length,
        dpr: canvas.width / rect.width,
      };
    });

  await step("move a part along one gizmo axis with one commit, then undo", async () => {
    await page.click('#outliner [data-part="p-body"]');
    await page.waitForSelector('#outliner .row.selected[data-part="p-body"]');
    const arrow = await xArrow();
    const before = await position("p-body");
    const head = await position("p-head");
    const at = await revision(page);
    await page.mouse.move(arrow.x, arrow.y);
    await page.mouse.down();
    await page.mouse.move(arrow.x + arrow.ux * 60, arrow.y + arrow.uy * 60, { steps: 12 });
    assert.equal(await revision(page), at, "a drag in progress commits nothing");
    assert.deepEqual(await position("p-body"), before, "the stored part stays put during the drag");
    await page.mouse.up();
    await waitRevision(page, at + 1);
    const after = await position("p-body");
    const delta = after.map((v, i) => v - (before[i] ?? 0));
    assert.ok(Math.abs(delta[0] ?? 0) > 0.002, `the move went along X: ${delta.join(", ")}`);
    assert.ok(
      Math.abs(delta[1] ?? 0) < 1e-6 && Math.abs(delta[2] ?? 0) < 1e-6,
      `only X changed: ${delta.join(", ")}`,
    );
    assert.deepEqual(await position("p-head"), head, "the head keeps its own placement");
    const latest = (await page.locator("#history li").first().textContent()) ?? "";
    assert.match(latest, /^r\d+.*Move /, `the newest revision is the person's move: ${latest}`);
    assert.doesNotMatch(latest, /qa-agent/, "the move is attributed to the person");
    results.push({
      step: "gizmo move",
      ms: 0,
      detail: `${arrow.red} red px at DPR ${arrow.dpr.toFixed(2)}; delta ${delta.map((d) => d.toFixed(4)).join(", ")}; ${latest.slice(0, 120)}`,
    });
    await page.click("#undo");
    await waitRevision(page, at + 2);
    assert.deepEqual(await position("p-body"), before, "undo puts the part back");
  });

  await step("orbiting the view commits nothing", async () => {
    await page.click("#tool-select");
    const at = await revision(page);
    const box = await page.locator("#viewport canvas").boundingBox();
    assert.ok(box);
    await page.mouse.move(box.x + 24, box.y + 24);
    await page.mouse.down();
    await page.mouse.move(box.x + 160, box.y + 90, { steps: 10 });
    await page.mouse.up();
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
    assert.equal(await revision(page), at, "an orbit appends no revision");
    assert.equal((await agent?.call("inspect", { documentId }))?.revision, at);
  });

  await step("another edit during a drag cancels the move visibly", async () => {
    assert.ok(agent);
    await page.click('#outliner [data-part="p-body"]');
    const arrow = await xArrow();
    const before = await position("p-body");
    const at = await revision(page);
    await page.mouse.move(arrow.x, arrow.y);
    await page.mouse.down();
    await page.mouse.move(arrow.x + arrow.ux * 50, arrow.y + arrow.uy * 50, { steps: 10 });
    const remote = await agent.call("apply", {
      request: {
        format: "irudd.command",
        version: 1,
        requestId: `qa-${crypto.randomUUID()}`,
        documentId,
        expectedRevision: at,
        command: {
          type: "edit",
          ops: [{ op: "part.set", part: "p-body", set: { color: "#6b4f2f" } }],
        },
      },
    });
    assert.equal(remote.kind, "committed", JSON.stringify(remote));
    await page.waitForSelector("#banner.error:not([hidden]):has-text('Move cancelled')");
    await page.mouse.move(arrow.x + arrow.ux * 80, arrow.y + arrow.uy * 80, { steps: 4 });
    await page.mouse.up();
    await waitRevision(page, at + 1);
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
    const head = await agent.call("inspect", { documentId });
    assert.equal(head.revision, at + 1, "only the agent's edit was appended");
    assert.deepEqual(await position("p-body"), before, "the cancelled move changed nothing");
    results.push({
      step: "drag conflict banner",
      ms: 0,
      detail: ((await page.textContent("#banner")) ?? "").slice(0, 200),
    });
    await page.click("#banner button:has-text('Dismiss')");
  });

  await step("steer the paired agent: bind, send, acknowledge, apply, cancel", async () => {
    assert.ok(agent);
    await page.waitForSelector("#steering .steer-identity:has-text('qa-agent')");
    const unbound = (await page.textContent("#steering .steer-identity")) ?? "";
    assert.match(unbound, /pairing pair-[0-9a-f]{16}/, "the identity names the current pairing");
    await page.selectOption(
      "#steering select[aria-label='How to reach the conversation']",
      "inbox",
    );
    await page.fill("#steering .steer-bind label:has-text('Conversation') input", "qa-session");
    await page.click("#steering .steer-bind button:has-text('Bind')");
    await page.waitForSelector("#steering .steer-route:has-text('Agent inbox for qa-session')");
    await page.waitForSelector("#steering .steer-identity .badge:has-text('inbox-only')");
    await page.fill("#steering textarea", "Make the tail longer");
    await page.click("#steering button:has-text('Send to qa-agent')");
    const item = "#steering .steer-messages li:has-text('Make the tail longer')";
    await page.waitForSelector(`${item}[data-status='inbox-only']`);
    await page.waitForSelector(`${item} .step.on:has-text('In inbox')`);
    const inbox = await agent.call("inbox.read", {});
    const message = inbox.messages.find((m) => m.text === "Make the tail longer");
    assert.ok(message, "the agent reads the message from its inbox");
    assert.equal(message.documentId, documentId, "the message refers to the character on screen");
    await agent.call("inbox.ack", { messageId: message.messageId });
    await page.waitForSelector(`${item} .step.on:has-text('Agent acknowledged')`);
    const now = await revision(page);
    const requestId = `qa-${crypto.randomUUID()}`;
    const edit = await agent.call("apply", {
      request: {
        format: "irudd.command",
        version: 1,
        requestId,
        documentId,
        expectedRevision: now,
        command: {
          type: "edit",
          ops: [{ op: "part.rename", part: "p-body", label: "long torso" }],
        },
      },
    });
    assert.equal(edit.kind, "committed", JSON.stringify(edit));
    await agent.call("inbox.applied", { messageId: message.messageId, documentId, requestId });
    await page.waitForSelector(`${item} .step.on:has-text('Applied in revision ${now + 1}')`);

    await page.fill("#steering textarea", "Suggest a longer tail as a proposal");
    await page.click("#steering button:has-text('Send to qa-agent')");
    const drafted = "#steering .steer-messages li:has-text('Suggest a longer tail')";
    await page.waitForSelector(`${drafted}[data-status='inbox-only']`);
    const draftMessage = (await agent.call("inbox.read", {})).messages.find(
      (m) => m.text === "Suggest a longer tail as a proposal",
    );
    assert.ok(draftMessage);
    await agent.call("inbox.ack", { messageId: draftMessage.messageId });
    const proposed = await revision(page);
    const draftRequest = `qa-${crypto.randomUUID()}`;
    const draft = await agent.call("apply", {
      request: {
        format: "irudd.command",
        version: 1,
        requestId: draftRequest,
        documentId,
        expectedRevision: proposed,
        command: {
          type: "proposal.create",
          proposal: "prop-qa-tail",
          summary: "Longer tail",
          content: {
            kind: "ops",
            ops: [{ op: "part.rename", part: "p-body", label: "tailed torso" }],
          },
        },
      },
    });
    assert.equal(draft.kind, "committed", JSON.stringify(draft));
    await agent.call("inbox.applied", {
      messageId: draftMessage.messageId,
      documentId,
      requestId: draftRequest,
    });
    await page.waitForSelector(`${drafted}[data-status='proposed']`);
    await page.waitForSelector(
      `${drafted} .step.review:has-text('Awaiting review (proposal prop-qa-tail v1)')`,
    );
    assert.doesNotMatch(
      (await page.textContent(drafted)) ?? "",
      /Applied in revision|Accepted in revision/,
      "a pending proposal is not shown as applied",
    );
    const card = "#proposals .proposal:has-text('Longer tail')";
    await page.click(`${card} button:has-text('Preview')`);
    await page.waitForSelector("#banner:has-text('Previewing')");
    const reviewed = await revision(page);
    await page.click("#banner button:has-text('Accept')");
    await waitRevision(page, reviewed + 1);
    await page.waitForSelector(`${drafted}[data-status='applied']`);
    await page.waitForSelector(
      `${drafted} .step.on:has-text('Accepted in revision ${reviewed + 1}')`,
    );

    await page.fill("#steering textarea", "Never mind the ears");
    await page.click("#steering button:has-text('Send to qa-agent')");
    const second = "#steering .steer-messages li:has-text('Never mind the ears')";
    await page.click(`${second} button:has-text('Cancel')`);
    await page.waitForSelector(`${second}[data-status='cancelled']`);
    results.push({
      step: "steering identity",
      ms: 0,
      detail: ((await page.textContent("#steering .steer-identity")) ?? "").slice(0, 300),
    });
  });

  await step("export the head as a clay GLB and play it", async () => {
    await page.click("#export");
    await page.waitForSelector("#library:not([hidden])");
    await page.waitForSelector(".pl-status:has-text('m tall')");
    const clips = await page.locator(".pl-controls select").nth(4).locator("option").count();
    assert.ok(clips > 1, "the export carries clips");
    const exports = readdirSync(join(projectDir, "exports"));
    assert.equal(exports.length, 1);
    results.push({ step: "export file", ms: 0, detail: exports.join(",") });
  });

  await step("save a fixed-size inspection sheet without touching the live view", async () => {
    await page.click("#save-sheet");
    await page.waitForSelector("#sheet-status:has-text('Saved to')");
    const dirs = readdirSync(join(projectDir, "inspections"));
    assert.equal(dirs.length, 1);
    const dir = join(projectDir, "inspections", dirs[0] ?? "");
    const sheet: unknown = JSON.parse(readFileSync(join(dir, "sheet.json"), "utf8"));
    results.push({
      step: "sheet",
      ms: 0,
      detail: JSON.stringify(Reflect.get(Object(sheet), "gpu")),
    });
    for (const view of ["threequarter", "front", "side", "back", "overhead"]) {
      const decoded = await decodeInPage(page, join(dir, `${view}.png`));
      assert.equal(decoded.width, 512);
      assert.equal(decoded.height, 512);
      for (const corner of decoded.corners)
        assert.equal(corner[3], 255, `${view} corner is opaque`);
    }
  });

  const finalRevision = await (async () => {
    await page.click("#tab-workshop");
    return revision(page);
  })();
  agent?.close();
  agent = undefined;
  await step("quit", () => (app ? app.close() : Promise.resolve()));
  app = undefined;

  await step("reopen the project and find the same head", async () => {
    app = await launch(["--open", join(repository, "examples", "fen-crown.glb")]);
    page = app.page;
    await page.waitForSelector("#outliner [data-part]");
    assert.equal(await revision(page), finalRevision);
    await page.waitForSelector('#outliner [data-part="p-head"] >> text=snout');
    await page.waitForSelector('#outliner [data-part="p-body"] >> text=torso');
  });
  await step("a GLB opened with --open has no recipe and still plays", async () => {
    await page.click("#tab-library");
    await page.click("#library-list li:has-text('fen-crown.glb')");
    await page.waitForSelector(".pl-status:has-text('fen-crown.glb')");
    await page.waitForSelector(".pl-origin:has-text('No workshop recipe')");
  });
  await step("quit again", () => (app ? app.close() : Promise.resolve()));
  app = undefined;
} finally {
  agent?.close();
  await app?.close().catch(() => undefined);
  console.log(JSON.stringify({ results, problems, scratch: keep ? scratch : undefined }, null, 2));
  if (!keep) rmSync(scratch, { recursive: true, force: true });
}
if (problems.length) {
  console.error("Page errors were reported.");
  process.exitCode = 1;
}
