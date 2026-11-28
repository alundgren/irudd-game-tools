import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page } from "@playwright/test";
import { build } from "vite-plus";
import { appDir, appEnvironment, electronExecutable } from "./electron.js";
import { callEditor, launchEditor } from "./editor-session.js";
import { changedPixels, hardwareRenderer } from "./display-check.js";
import { contactSheet } from "./contact-sheet.js";
import type {} from "../qa/shape/probe.js";

const root = resolve(appDir, "../.."),
  output = join(root, ".reference-cache/phase9-7");
mkdirSync(output, { recursive: true });
const stages = new Set((process.argv[2] ?? "all").split(","));
const run = (name: string) => stages.has("all") || stages.has(name);
const temp = mkdtempSync(join(tmpdir(), "motion-parity-"));
await build({
  configFile: false,
  logLevel: "error",
  build: {
    lib: {
      entry: join(appDir, "qa/shape/probe.ts"),
      formats: ["iife"],
      name: "ShapeQA",
      fileName: () => "probe.js",
    },
    outDir: join(temp, "probe"),
    minify: false,
  },
});
const probe = readFileSync(join(temp, "probe/probe.js"), "utf8");
const server = spawn(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    `import {workshopServer} from "./scripts/workshop.mjs"; import {readFileSync} from "node:fs";const server=workshopServer(readFileSync("dist/character-view.html","utf8").replace("<head>",'<head><meta name="workshop-agent" content="local">'));server.listen(0,"127.0.0.1",()=>console.log("http://127.0.0.1:"+server.address().port+"/"));`,
  ],
  { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
);
const url = await new Promise<string>((done, fail) => {
  server.stdout.on("data", (b: Buffer) => {
    const match = b.toString().match(/http:\/\/127\.0\.0\.1:\d+\//);
    if (match) done(match[0]);
  });
  server.once("exit", (code) => fail(new Error("Workshop exit " + code)));
});
const browser = await chromium.launch({ channel: "chrome", args: ["--use-angle=default"] });
const web = await browser.newPage({ viewport: { width: 1340, height: 920 } });
const errors: string[] = [];
const editor = await launchEditor(
  electronExecutable(),
  [
    "--project",
    join(temp, "project"),
    "--create",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--disable-background-timer-throttling",
  ],
  join(temp, "user"),
  appEnvironment({ IRUDD_STATE_DIR: join(temp, "state") }),
  errors,
  appDir,
);
const desk = editor.page;
web.setDefaultTimeout(60000);
desk.setDefaultTimeout(60000);
const motion = desk.locator("#motion-editor");
const control = (name: string) => motion.getByLabel(name, { exact: true });
const press = (name: string) => motion.getByRole("button", { name, exact: true }).click();
const webCanvas = "#pose-canvas",
  deskCanvas = "#viewport canvas";

let frame:
  | { page: Page; canvas: string; width: number; height: number; tall: number }[]
  | undefined;
async function framed(page: Page, canvas: string) {
  await settle(page);
  await page.waitForTimeout(120);
  const fixed = frame?.find((f) => f.page === page);
  const span = await page.evaluate((c) => window.shapeProbe.extent(c), canvas);
  const box = await page.locator(canvas).first().boundingBox();
  assert.ok(box);
  const height = fixed?.height ?? (span.bottom - span.top) * 1.3,
    width = (height * 560) / 440;
  const x = Math.max(
      box.x,
      Math.min(box.x + box.width - width, (span.left + span.right) / 2 - width / 2),
    ),
    y = Math.max(
      box.y,
      Math.min(box.y + box.height - height, (span.top + span.bottom) / 2 - height / 2),
    );
  const clip = { x, y, width: Math.min(width, box.width), height: Math.min(height, box.height) };
  if (page === web) return page.screenshot({ clip });
  const png = await page.locator(canvas).evaluate(async (node, area) => {
    if (!(node instanceof HTMLCanvasElement)) throw new Error("Missing viewport canvas.");
    const rect = node.getBoundingClientRect(),
      scale = node.width / rect.width,
      vertical = node.height / rect.height;
    document.getElementById("tool-select")?.click();
    return new Promise<string>((done) =>
      requestAnimationFrame(() => {
        const out = document.createElement("canvas");
        out.width = Math.round(area.width * scale);
        out.height = Math.round(area.height * vertical);
        out
          .getContext("2d")
          ?.drawImage(
            node,
            (area.x - rect.left) * scale,
            (area.y - rect.top) * vertical,
            area.width * scale,
            area.height * vertical,
            0,
            0,
            out.width,
            out.height,
          );
        done(out.toDataURL("image/png"));
      }),
    );
  }, clip);
  return Buffer.from(png.slice(png.indexOf(",") + 1), "base64");
}
async function lockFrame() {
  const spans = [];
  for (const { page, canvas } of sides()) {
    await settle(page);
    const span = await page.evaluate((c) => window.shapeProbe.extent(c), canvas);
    const box = await page.locator(canvas).first().boundingBox();
    assert.ok(box);
    spans.push({
      page,
      canvas,
      tall: Math.max(span.bottom - span.top, ((span.right - span.left) * 440) / 560),
      room: Math.min(box.height, (box.width * 440) / 560),
    });
  }
  const ratio = Math.min(1.3, ...spans.map((s) => s.room / s.tall));
  frame = spans.map((s) => ({
    page: s.page,
    canvas: s.canvas,
    width: 0,
    height: s.tall * ratio,
    tall: s.tall,
  }));
}
async function deskShot() {
  return framed(desk, deskCanvas);
}
async function webShot() {
  return framed(web, webCanvas);
}
const done: string[] = [];
async function sheet(name: string, items: { name: string; image: Buffer }[]) {
  await contactSheet(
    web,
    output,
    items.map((i) => ({ name: i.name, image: i.image.toString("base64") })),
    2,
    name + ".png",
    2,
    { width: 560, height: 440 },
  );
  done.push(name);
  console.log("Captured", name);
}
async function capture(name: string, title: string, left: Buffer, right: Buffer) {
  await contactSheet(
    web,
    output,
    [
      { name: "Browser | " + title, image: left.toString("base64") },
      { name: "Desktop | " + title, image: right.toString("base64") },
    ],
    2,
    name + ".png",
    2,
    { width: 560, height: 440 },
  );
  done.push(name);
  console.log("Captured", name);
}
async function settle(p: Page) {
  await p.evaluate(
    () => new Promise<void>((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok()))),
  );
}

async function openWeb(hash: string) {
  if (await web.locator("#pose-room[open]").count()) await web.click("#pose-cancel");
  await web.goto(url + "#x", { waitUntil: "domcontentloaded" });
  await web.goto(url + hash, { waitUntil: "domcontentloaded", timeout: 120000 });
  await web.waitForFunction(
    () => {
      try {
        return window.shapeProbe.names().length > 3 || !!document.querySelector("#motion option");
      } catch {
        return false;
      }
    },
    undefined,
    { timeout: 120000 },
  );
  await web.waitForTimeout(1500);
}
async function openDesk(match: string) {
  const id = await desk.inputValue("#document");
  const choice = await desk
    .locator("#start option")
    .evaluateAll(
      (items, q) =>
        items.flatMap((o) =>
          o instanceof HTMLOptionElement && o.value.includes(q) ? [o.value] : [],
        )[0],
      match,
    );
  assert.ok(choice, "Starter " + match);
  await desk.selectOption("#start", choice);
  await desk.waitForFunction(
    (old) =>
      document.querySelector<HTMLSelectElement>("#document")?.value !== old &&
      /revision 1\b/.test(document.querySelector("#status-right")?.textContent ?? ""),
    id,
    { timeout: 120000 },
  );
}
async function poseRooms() {
  await web.click("[data-tab=sculpt]");
  await web.click("#pose-open");
  await web.locator("#pose-room[open]").waitFor();
  await web.click("#pose-front");
  if (!(await motion.evaluate((p) => p.hasAttribute("open"))))
    await motion.locator("summary").click();
  await control("Show joints").check();
  await press("Front view");
  await desk.click("#focus-selection").catch(() => undefined);
}

type Vec = [number, number, number];
const sides = () =>
  [
    { page: web, canvas: webCanvas },
    { page: desk, canvas: deskCanvas },
  ] as const;
const distance = (a: readonly number[], b: readonly number[]) =>
  Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));
async function regionOf(page: Page, name: string) {
  if (page === web) return name;
  const found = await control("Joint")
    .locator("option")
    .evaluateAll(
      (items, wanted) =>
        items.flatMap((o) =>
          o instanceof HTMLOptionElement && o.textContent?.startsWith(wanted + " · joint")
            ? [o.value]
            : [],
        )[0],
      name,
    );
  assert.ok(found, "Joint " + name);
  const parsed: unknown = JSON.parse(found);
  assert.ok(Array.isArray(parsed) && typeof parsed[0] === "string");
  return parsed[0];
}
async function jointAt(page: Page, canvas: string, name: string, station = 0): Promise<Vec> {
  await settle(page);
  const region = await regionOf(page, name);
  const found = await page.evaluate(([c, r, s]) => window.shapeProbe.joint(c, r, s), [
    canvas,
    region,
    station,
  ] as const);
  return [found.world[0] ?? 0, found.world[1] ?? 0, found.world[2] ?? 0];
}
async function joints(region: string, station = 0) {
  return Promise.all(sides().map((s) => jointAt(s.page, s.canvas, region, station)));
}
async function choose(joint: string, tool: string) {
  await web.selectOption("#pose-joint", { label: joint });
  await web.selectOption("#pose-mode", tool);
  await control("Joint").selectOption({ label: joint });
  await control("Joint adjustment").selectOption(tool);
}
async function drag(across: number, down: number, above = 0) {
  for (const { page, canvas } of sides()) {
    await settle(page);
    const scale = (frame?.find((f) => f.page === page)?.tall ?? 400) / 400,
      dx = across * scale,
      dy = down * scale;
    const handle = await page.evaluate((c) => window.shapeProbe.handle(c), canvas);
    const at = { x: handle.x, y: handle.y - above };
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(at.x + (dx * i) / 12, at.y + (dy * i) / 12);
    await page.mouse.up();
  }
}
async function clickAt(name: string, station = 0) {
  for (const { page, canvas } of sides()) {
    await settle(page);
    const region = await regionOf(page, name);
    const at = await page.evaluate(([c, r, s]) => window.shapeProbe.joint(c, r, s), [
      canvas,
      region,
      station,
    ] as const);
    await page.mouse.click(at.x, at.y);
  }
}
async function notes() {
  await settle(web);
  await settle(desk);
  return [await web.innerText("#pose-note"), await motion.locator(".pose-note").innerText()];
}
async function expectNotes(pattern: RegExp) {
  const both = await notes();
  for (const text of both) assert.match(text, pattern, both.join(" / "));
  return both;
}
async function step(axis: string, amount: string, sign: 1 | -1) {
  await web.selectOption("#pose-axis", { label: axis });
  await web.fill("#pose-step", amount);
  await web.click(sign > 0 ? "#pose-plus" : "#pose-minus");
  await control("Axis").selectOption({ label: axis });
  await control("Step (degrees or metres)").fill(amount);
  await press(sign > 0 ? "Increase joint" : "Decrease joint");
}
async function undoAll() {
  for (let i = 0; i < 60 && !(await web.locator("#pose-undo").isDisabled()); i++)
    await web.click("#pose-undo");
  const undo = motion.getByRole("button", { name: "Undo pose edit", exact: true });
  for (let i = 0; i < 60 && !(await undo.isDisabled()); i++) await undo.click();
}
async function elbow(direction: string) {
  await web.selectOption("#pose-elbow-direction", { label: direction });
  await control("Point elbow").selectOption({ label: direction });
}
async function turn(degrees: string) {
  await web.fill("#pose-elbow-turn", degrees);
  await web.locator("#pose-elbow-turn").dispatchEvent("change");
  await control("Elbow turn in degrees").fill(degrees);
  await control("Elbow turn in degrees").dispatchEvent("change");
}
async function both(name: string, title: string) {
  await capture(name, title, await webShot(), await deskShot());
}
const moved = (before: Vec[], after: Vec[], least: number) =>
  before.forEach((b, i) =>
    assert.ok(
      distance(b, after[i] ?? b) > least,
      title(i) + " moved " + distance(b, after[i] ?? b),
    ),
  );
const held = (before: Vec[], after: Vec[], most: number) =>
  before.forEach((b, i) =>
    assert.ok(distance(b, after[i] ?? b) < most, title(i) + " held " + distance(b, after[i] ?? b)),
  );
const title = (i: number) => (i ? "Desktop" : "Browser");

try {
  await web.addInitScript(probe);
  await desk.addInitScript(probe);
  await desk.reload();
  await desk.locator("#start option").nth(1).waitFor({ state: "attached" });
  console.log("Desktop hardware", await hardwareRenderer(desk));
  if (run("wrist")) {
    await openWeb("#adult=491");
    await openDesk("human-adult/preset/seed-491");
    await desk.selectOption("#display-mode", "clay");
    await poseRooms();
    await lockFrame();
    const hand = "right hand · joint 1";
    await choose(hand, "reach");
    assert.equal(await web.locator("#pose-reach-controls").isVisible(), true);
    assert.equal(await motion.locator(".pose-reach").isVisible(), true);
    const rest = await joints("right hand");
    const restElbow = await joints("right forearm");
    await drag(-70, -110);
    await expectNotes(/Wrist reached the target\. The hand kept its orientation\./);
    const reached = await joints("right hand");
    moved(rest, reached, 0.05);
    await both("01-guide-wrist-drag", "Guide wrist: drag the target");
    await undoAll();
    held(rest, await joints("right hand"), 0.002);
    await both("02-undo-pose-edit", "Undo pose edit restores the arm");
    await drag(-260, -300);
    await expectNotes(/At full reach, \d+\.\d cm from the target\./);
    await both("03-full-reach", "Target out of reach");
    await undoAll();
    await step("Y", "0.25", 1);
    await step("Z", "0.25", 1);
    await expectNotes(/Wrist reached the target/);
    const nudged = await joints("right hand");
    nudged.forEach((n, i) =>
      assert.ok(Math.abs(n[1] - (rest[i]?.[1] ?? 0) - 0.25) < 0.01, title(i) + " nudge " + n[1]),
    );
    await both("04-nudge-target", "Nudge the wrist target 0.25 m up and forward");
    const original = await joints("right forearm");
    moved(restElbow, original, 0.01);
    const bends: Record<string, Vec[]> = {};
    for (const [label, name] of [
      ["Toward floor", "05-elbow-down"],
      ["Character left", "06-elbow-left"],
      ["Character right", "07-elbow-right"],
      ["Toward back", "08-elbow-back"],
    ] as const) {
      await elbow(label);
      await expectNotes(/Wrist reached the target/);
      bends[label] = await joints("right forearm");
      moved(original, bends[label] ?? original, 0.01);
      held(nudged, await joints("right hand"), 0.002);
      await both(name, "Point elbow: " + label);
    }
    await elbow("Along existing bend");
    await turn("90");
    await expectNotes(/Wrist reached the target/);
    moved(original, await joints("right forearm"), 0.01);
    await both("09-elbow-turn", "Elbow turn 90 degrees");
    await turn("0");
    await undoAll();
    await web.click("#pose-reach-surface");
    await press("Choose a point on the model");
    assert.equal(await web.getAttribute("#pose-reach-surface", "aria-pressed"), "true");
    await clickAt("chest");
    await expectNotes(/Wrist reached the target|At full reach/);
    const chest = await joints("chest");
    const onChest = await joints("right hand");
    onChest.forEach((h, i) =>
      assert.ok(
        distance(h, chest[i] ?? h) < 0.3,
        title(i) + " chest " + distance(h, chest[i] ?? h),
      ),
    );
    assert.equal(
      await motion
        .getByRole("button", { name: "Choose a point on the model", exact: true })
        .getAttribute("aria-pressed"),
      "false",
    );
    await both("10-surface-point", "Choose a point on the model (chest)");
  }
  if (run("courier")) {
    await openWeb("#form=four-hand-courier");
    await openDesk("four-hand-courier");
    await desk.selectOption("#display-mode", "clay");
    await poseRooms();
    await lockFrame();
    await choose("left hand · joint 1", "reach");
    await step("X", "0.2", -1);
    await step("Y", "0.3", 1);
    await expectNotes(/Wrist reached the target|At full reach/);
    const bent = await joints("left forearm");
    await both("11-elbow-original-courier", "Four-hand courier: elbow along existing bend");
    await elbow("Give other arms room");
    await expectNotes(/Wrist reached the target|At full reach/);
    const clear = await joints("left forearm");
    console.log(
      "clear moved",
      bent.map((b, i) => distance(b, clear[i] ?? b)),
    );
    moved(bent, clear, 0.01);
    console.log(
      "browser vs desktop elbow",
      distance(bent[0] ?? [0, 0, 0], bent[1] ?? [0, 0, 0]),
      distance(clear[0] ?? [0, 0, 0], clear[1] ?? [0, 0, 0]),
    );
    held([clear[0] ?? [0, 0, 0]], [clear[1] ?? [0, 0, 0]], 0.005);
    await both("12-elbow-clear", "Point elbow: give other arms room");
  }
  if (run("tip")) {
    await openWeb("#form=six-legged-crawler");
    await openDesk("six-legged-crawler");
    await desk.selectOption("#display-mode", "clay");
    await poseRooms();
    await lockFrame();
    const leg = "left leg 1 thigh · joint 1";
    const together = async (label: string) => {
      await web.selectOption("#pose-scope", { label });
      await control("Pose together").selectOption({ label });
    };
    const feet = async () => ({
      own: await joints("left leg 1 foot"),
      twin: await joints("right leg 1 foot"),
      far: await joints("left leg 3 foot"),
    });
    await choose(leg, "tip");
    assert.deepEqual(await web.locator("#pose-scope option").allTextContents(), [
      "This joint only",
      "Left and right together",
      "All 6 legs",
    ]);
    assert.deepEqual(await control("Pose together").locator("option").allTextContents(), [
      "This joint only",
      "Left and right together",
      "All 6 legs",
    ]);
    const rest = await feet();
    await drag(0, -60);
    await expectNotes(/The limb tip reached the target\./);
    let now = await feet();
    moved(rest.own, now.own, 0.02);
    held(rest.twin, now.twin, 0.002);
    await both("13-tip-one", "Guide limb tip: this joint only");
    await undoAll();
    await together("Left and right together");
    await drag(0, -60);
    await expectNotes(/2 limb tips moved together\./);
    now = await feet();
    moved(rest.twin, now.twin, 0.02);
    held(rest.far, now.far, 0.002);
    await both("14-tip-pair", "Guide limb tip: left and right together");
    await undoAll();
    await together("All 6 legs");
    await drag(0, -60);
    await expectNotes(/6 limb tips moved together\./);
    moved(rest.far, (await feet()).far, 0.02);
    await both("15-tip-kind", "Guide limb tip: all 6 legs");
    await undoAll();
    await choose(leg, "rotate");
    await together("Left and right together");
    await step("X", "25", 1);
    now = await feet();
    moved(rest.own, now.own, 0.02);
    moved(rest.twin, now.twin, 0.02);
    held(rest.far, now.far, 0.002);
    await both("16-rotate-pair", "Rotate: left and right together");
    await undoAll();
    await together("All 6 legs");
    await step("X", "25", 1);
    moved(rest.far, (await feet()).far, 0.02);
    await both("17-rotate-kind", "Rotate: all 6 legs");
    await undoAll();
    await choose(leg, "translate");
    await together("This joint only");
    await step("Y", "0.06", 1);
    moved(rest.own, (await feet()).own, 0.03);
    await both("18-move-joint", "Move the joint 6 cm");
    await web.click("#pose-reset");
    await press("Relax joint");
    held(rest.own, (await feet()).own, 0.002);
    await both("19-relax-joint", "Relax joint returns it to rest");
    await undoAll();
    await choose("body · joint 1", "translate");
    for (const set of [true, false]) {
      await web.setChecked("#pose-plant", set);
      await control("Keep the other feet planted").setChecked(set);
      await step("Y", "0.05", -1);
      const after = await feet();
      if (set) {
        held(rest.far, after.far, 0.003);
        held(rest.own, after.own, 0.003);
        await both("20-plant-feet", "Lower the body: the feet stay planted");
      } else moved(rest.far, after.far, 0.03);
      await undoAll();
    }
    for (const { page, canvas } of sides()) {
      const box = await page.locator(canvas).first().boundingBox();
      assert.ok(box);
      await page.mouse.move(box.x + 30, box.y + 30);
      await page.mouse.down();
      await page.mouse.move(box.x + 200, box.y + 60, { steps: 8 });
      await page.mouse.up();
    }
    const orbited = [await webShot(), await deskShot()];
    await web.click("#pose-front");
    await press("Front view");
    const front = [await webShot(), await deskShot()];
    await sheet("21-front-view", [
      { name: "Browser | Orbited", image: orbited[0] ?? Buffer.alloc(0) },
      { name: "Desktop | Orbited", image: orbited[1] ?? Buffer.alloc(0) },
      { name: "Browser | Front view", image: front[0] ?? Buffer.alloc(0) },
      { name: "Desktop | Front view", image: front[1] ?? Buffer.alloc(0) },
    ]);
  }
  if (run("save")) {
    await openWeb("#adult=491");
    await openDesk("human-adult/preset/seed-491");
    await desk.selectOption("#display-mode", "clay");
    await poseRooms();
    await lockFrame();
    await choose("left hand · joint 1", "reach");
    await drag(80, -120);
    await expectNotes(/Wrist reached the target/);
    const posed = await joints("left hand");
    await web.fill("#pose-name", "Reach QA");
    await control("Pose name").fill("Reach QA");
    const state = async () =>
      callEditor(desk, "current", { documentId: await desk.inputValue("#document") });
    const revisionShown = (r: number) =>
      desk.waitForFunction(
        (n) =>
          document
            .querySelector<HTMLSelectElement>("#document")
            ?.selectedOptions[0]?.textContent?.endsWith("r" + n),
        r,
      );
    const before = await state();
    const revision = Number(Reflect.get(Object(before), "revision"));
    await web.click("#pose-save");
    await web.locator("#pose-room").waitFor({ state: "hidden" });
    await press("Save pose");
    await revisionShown(revision + 1);
    const after = await state();
    assert.equal(Reflect.get(Object(after), "revision"), revision + 1);
    for (const [id, digest, r] of [
      ["undo", Reflect.get(Object(before), "documentDigest"), revision + 2],
      ["redo", Reflect.get(Object(after), "documentDigest"), revision + 3],
    ] as const) {
      await desk.click("#" + id);
      await revisionShown(r);
      assert.equal(Reflect.get(Object(await state()), "documentDigest"), digest);
    }
    const id = await desk.inputValue("#document"),
      file = join(temp, "reach.irudd-character");
    await editor.answerDialogs({ save: file });
    await desk.click("#character-save");
    await desk.waitForFunction(() =>
      document.querySelector("#status")?.textContent?.includes("reach.irudd-character"),
    );
    const next = await launchEditor(
      electronExecutable(),
      ["--project", join(temp, "reopen"), "--create"],
      join(temp, "profile-reopen"),
      appEnvironment({ IRUDD_STATE_DIR: join(temp, "state-reopen") }),
      errors,
      appDir,
    );
    try {
      const page = next.page;
      await page.addInitScript(probe);
      await page.reload();
      await page.locator("#start option").nth(1).waitFor({ state: "attached" });
      await next.answerDialogs({ open: file });
      await page.click("#character-open");
      await page.waitForFunction(
        (d) => document.querySelector<HTMLSelectElement>("#document")?.value === d,
        id,
      );
      assert.equal(
        Reflect.get(
          Object(await callEditor(page, "current", { documentId: id })),
          "documentDigest",
        ),
        Reflect.get(Object(after), "documentDigest"),
      );
      await page.selectOption("#display-mode", "clay");
      const panel = page.locator("#motion-editor");
      if (!(await panel.evaluate((p) => p.hasAttribute("open"))))
        await panel.locator("summary").click();
      const clip = panel.getByLabel("Pose or clip", { exact: true });
      await clip.locator("option").nth(1).waitFor({ state: "attached" });
      const listed = await clip.locator("option").allTextContents();
      console.log("Reopened clips", listed.join(" | "));
      const label = listed.find((t) => t.includes("Reach QA"));
      assert.ok(label, "Saved pose listed after reopening");
      await clip.selectOption({ label });
      await panel.getByLabel("Show joints", { exact: true }).check();
      await panel.getByRole("button", { name: "Front view", exact: true }).click();
      const values = await panel
        .getByLabel("Joint", { exact: true })
        .locator("option")
        .evaluateAll((items) =>
          items.flatMap((o) =>
            o instanceof HTMLOptionElement && o.textContent?.startsWith("left hand · joint")
              ? [o.value]
              : [],
          ),
        );
      const part: unknown = JSON.parse(values[0] ?? "[]");
      await settle(page);
      const reopened = (
        await page.evaluate(([c, r]) => window.shapeProbe.joint(c, r, 0), [
          deskCanvas,
          Array.isArray(part) ? String(part[0]) : "",
        ] as const)
      ).world;
      const was = posed[1] ?? [0, 0, 0];
      assert.ok(distance(reopened, was) < 0.003, "Reopened wrist " + distance(reopened, was));
      await web.click("#pose-open");
      await web.locator("#pose-room[open]").waitFor();
      await web.click("#pose-front");
      held([posed[0] ?? [0, 0, 0]], [await jointAt(web, webCanvas, "left hand")], 0.003);
      const deskFrame = frame?.find((f) => f.page === desk);
      if (deskFrame) frame?.push({ ...deskFrame, page });
      await capture(
        "22-save-ik-pose",
        "Saved IK pose after save and reopen",
        await webShot(),
        await framed(page, deskCanvas),
      );
    } finally {
      await next.close();
    }
  }
  if (run("face")) {
    const face = async (name: string, amount = 100) => {
      await web.selectOption("#face-pose", name);
      if (name !== "Rest") {
        await web.locator("#face-pose-amount").fill(String(amount));
        await web.locator("#face-pose-amount").dispatchEvent("input");
      }
      await control("Expression").selectOption(name);
      if (name !== "Rest") await control("Expression strength").fill(String(amount / 100));
      await settle(web);
      await settle(desk);
      await web.waitForTimeout(300);
    };
    const gaze = async (x: number, y: number) => {
      await web.locator("#look-x").fill(String(x * 100));
      await web.locator("#look-x").dispatchEvent("input");
      await web.locator("#look-y").fill(String(y * 100));
      await web.locator("#look-y").dispatchEvent("input");
      await control("Horizontal gaze").fill(String(x));
      await control("Vertical gaze").fill(String(y));
      await web.waitForTimeout(300);
    };
    const weights = async () =>
      Promise.all([web, desk].map((p) => p.evaluate(() => window.shapeProbe.influences())));
    let centre: readonly [number, number, number] = [0, 0, 0];
    const crop = async () =>
      Promise.all(
        [web, desk].map(async (p) =>
          Buffer.from(
            await p.evaluate(([c]) => window.shapeProbe.capture(c, 0.3, 0), [centre] as const),
            "base64",
          ),
        ),
      );
    const compare = async (name: string, label: string, rest: Buffer[], least = 300) => {
      const shot = await crop();
      for (const [i, image] of shot.entries()) {
        const changed = await changedPixels(web, rest[i] ?? image, image);
        console.log(name, title(i), "changed", changed);
        assert.ok(changed > least, title(i) + " " + label + " changed " + changed);
      }
      await sheet(name, [
        { name: "Browser | Rest", image: rest[0] ?? Buffer.alloc(0) },
        { name: "Desktop | Rest", image: rest[1] ?? Buffer.alloc(0) },
        { name: "Browser | " + label, image: shot[0] ?? Buffer.alloc(0) },
        { name: "Desktop | " + label, image: shot[1] ?? Buffer.alloc(0) },
      ]);
    };
    const open = async (hash: string, starter: string) => {
      await openWeb(hash);
      await openDesk(starter);
      await web.click("[data-tab=sculpt]");
      await web.click('[data-mode="Clay"]');
      await desk.selectOption("#display-mode", "clay");
      if (!(await motion.evaluate((p) => p.hasAttribute("open"))))
        await motion.locator("summary").click();
      const names = (await web.evaluate(() => window.shapeProbe.names())).filter(
        (n): n is string => typeof n === "string",
      );
      const head = names.find((n) => /^head$/i.test(n)) ?? names.find((n) => /head/i.test(n));
      centre = head
        ? await web.evaluate((h) => window.shapeProbe.centre(h), head)
        : await web.evaluate(() => window.shapeProbe.crown());
      await desk.waitForTimeout(800);
    };
    await open("#form=portrait-gaze", "portrait-gaze");
    await face("Rest");
    const rest = await crop();
    for (const [name, label, file] of [
      ["Smile", "Smile", "23-smile"],
      ["Blink", "Blink", "24-blink"],
      ["BrowLift", "Raise brows", "25-raise-brows"],
    ] as const) {
      await face(name);
      for (const [i, w] of (await weights()).entries())
        assert.ok(Math.abs((w[name] ?? 0) - 1) < 0.02, title(i) + " " + name + " " + w[name]);
      await compare(file, label, rest);
    }
    await face("Smile", 40);
    for (const [i, w] of (await weights()).entries())
      assert.ok(Math.abs((w["Smile"] ?? 0) - 0.4) < 0.02, title(i) + " Smile 40% " + w["Smile"]);
    await compare("26-expression-amount", "Smile at 40%", rest, 100);
    await face("Rest");
    await web.click('[data-mode="Color"]');
    await desk.selectOption("#display-mode", "studio");
    await web.waitForTimeout(500);
    const colour = await crop();
    await gaze(1, 0);
    for (const [i, w] of (await weights()).entries())
      assert.ok(
        Math.max(w["LookLeft"] ?? 0, w["LookRight"] ?? 0) > 0.9,
        title(i) + " look across " + JSON.stringify(w),
      );
    await compare("27-gaze-across", "Look across", colour);
    await gaze(0, 1);
    for (const [i, w] of (await weights()).entries())
      assert.ok((w["LookUp"] ?? 0) > 0.9, title(i) + " look up " + JSON.stringify(w));
    await compare("28-gaze-up", "Look up", colour);
    const raised = await crop();
    await web.click("#look-center");
    await motion.getByRole("button", { name: "Centre gaze", exact: true }).click();
    await web.waitForTimeout(300);
    for (const [i, w] of (await weights()).entries())
      assert.ok(
        Math.max(w["LookLeft"] ?? 0, w["LookRight"] ?? 0, w["LookUp"] ?? 0, w["LookDown"] ?? 0) <
          0.01,
        title(i) + " centred " + JSON.stringify(w),
      );
    const centred = await crop();
    await sheet("29-gaze-centre", [
      { name: "Browser | Look up", image: raised[0] ?? Buffer.alloc(0) },
      { name: "Desktop | Look up", image: raised[1] ?? Buffer.alloc(0) },
      { name: "Browser | Centre gaze", image: centred[0] ?? Buffer.alloc(0) },
      { name: "Desktop | Centre gaze", image: centred[1] ?? Buffer.alloc(0) },
    ]);
    await open("#adult=491", "human-adult/preset/seed-491");
    await face("Rest");
    const adult = await crop();
    await face("Smile");
    await compare("30-adult-smile", "Adult authored smile", adult);
    await web.selectOption("#motion", "Idle");
    await control("Pose or clip").selectOption("Idle");
    await web.waitForTimeout(600);
    for (const [i, w] of (await weights()).entries())
      assert.ok(
        Math.abs((w["Smile"] ?? 0) - 1) < 0.02,
        title(i) + " smile during clip " + w["Smile"],
      );
    await compare("31-expression-during-clip", "Smile held while Idle plays", adult);
  }
  if (run("smooth")) {
    await web.goto("about:blank");
    if (await motion.evaluate((p) => p.hasAttribute("open")))
      await motion.locator("summary").click();
    const families = await desk
      .locator("#creature-family option")
      .evaluateAll((items) => items.map((o) => (o instanceof HTMLOptionElement ? o.value : "")));
    const wanted = ["grazer", "stalker", "glider", "brute", "wader", "swimmer"].filter((f) =>
      families.includes(f),
    );
    console.log("families", families.join(","), "using", wanted.join(","));
    assert.ok(wanted.length >= 4, "At least four creature families");
    for (const [index, family] of wanted.entries()) {
      await web.goto(url + "#x", { waitUntil: "domcontentloaded" });
      const old = await desk.inputValue("#document");
      await desk.selectOption("#start", "creature-plan/seed");
      await desk.selectOption("#creature-family", family);
      await desk.fill("#creature-seed", "33");
      await desk.getByRole("button", { name: "Create creature", exact: true }).click();
      await desk.waitForFunction(
        (k) =>
          document.querySelector<HTMLSelectElement>("#document")?.value !== k &&
          !document.querySelector("#viewport")?.hasAttribute("inert"),
        old,
      );
      const read = await callEditor(desk, "inspect", {
        documentId: await desk.inputValue("#document"),
      });
      const plan: unknown = Reflect.get(
        Object(Reflect.get(Object(Reflect.get(Object(read), "document")), "generation")),
        "params",
      );
      const planFile = join(temp, family + ".plan.json"),
        file = join(temp, family + ".form.json");
      writeFileSync(planFile, JSON.stringify(plan));
      execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          "import {buildCreature} from './character-view/creature-plan.js';import {readFileSync,writeFileSync} from 'node:fs';writeFileSync(process.argv[2],JSON.stringify({format:'irudd.form.v1',form:buildCreature(JSON.parse(readFileSync(process.argv[1])))}));",
          planFile,
          file,
        ],
        { cwd: root },
      );
      await web.locator("#openfile").setInputFiles(file);
      await web.waitForFunction(() =>
        document.querySelector("#status")?.textContent?.includes("Form opened"),
      );
      await web.waitForTimeout(1200);
      const key = await desk
        .locator("#outliner .row")
        .evaluateAll((nodes) =>
          nodes
            .find((row) => row.firstElementChild?.textContent?.toLowerCase() === "body")
            ?.getAttribute("data-part"),
        );
      assert.ok(key);
      await web.waitForFunction(() => {
        try {
          return window.shapeProbe.surface("body").length > 0;
        } catch {
          return false;
        }
      });
      await desk.waitForFunction((k) => {
        try {
          return window.shapeProbe.surface(k).length > 0;
        } catch {
          return false;
        }
      }, key);
      const [webBody] = await web.evaluate(() => window.shapeProbe.surface("body"));
      const [deskBody] = await desk.evaluate((k) => window.shapeProbe.surface(k), key);
      assert.ok(webBody, family + " browser body");
      assert.ok(deskBody, family + " desktop body");
      console.log(family, "web", JSON.stringify(webBody), "desk", JSON.stringify(deskBody));
      assert.ok(
        deskBody.vertices >= webBody.vertices * 0.8,
        family + " desktop body vertices " + deskBody.vertices + " vs " + webBody.vertices,
      );
      assert.equal(deskBody.flat, false);
      await web.click("[data-tab=sculpt]");
      await web.click('[data-mode="Clay"]');
      await desk.selectOption("#display-mode", "clay");
      await web.waitForTimeout(600);
      const centre = await web.evaluate(() => window.shapeProbe.centre("body"));
      const [left, right] = await Promise.all(
        [web, desk].map(async (p) =>
          Buffer.from(
            await p.evaluate(([c]) => window.shapeProbe.capture(c, 1.3, Math.PI / 2), [
              centre,
            ] as const),
            "base64",
          ),
        ),
      );
      await capture(
        String(32 + index) + "-smooth-" + family,
        "Smooth " + family + " body (seed 33, Clay)",
        left ?? Buffer.alloc(0),
        right ?? Buffer.alloc(0),
      );
      if (index === 0) {
        await poseRooms();
        await lockFrame();
        assert.equal(await web.isChecked("#pose-plant"), true);
        assert.equal(await control("Keep the other feet planted").isChecked(), true);
        await web.selectOption("#pose-joint", { label: "left leg 1 thigh · joint 1" });
        await web.selectOption("#pose-mode", "tip");
        await control("Joint").selectOption({ label: "leg 0 1 l · joint 1" });
        await control("Joint adjustment").selectOption("tip");
        const planted = async () => [
          await jointAt(web, webCanvas, "left leg 2 foot"),
          await jointAt(desk, deskCanvas, "leg 0 0 l pad"),
        ];
        const lifted = async () => [
          await jointAt(web, webCanvas, "left leg 1 foot"),
          await jointAt(desk, deskCanvas, "leg 0 1 l pad"),
        ];
        const [hold, lift] = [await planted(), await lifted()];
        await drag(0, -50, 14);
        await expectNotes(/The limb tip reached the target\./);
        moved(lift, await lifted(), 0.02);
        held(hold, await planted(), 0.003);
        await both("38-plan-tip-planted", "Creature plan: guide a leg tip, other feet planted");
        await web.click("#pose-cancel");
        await motion.locator("summary").click();
        await desk.waitForFunction(
          () => !document.querySelector("#motion-editor")?.hasAttribute("open"),
        );
      }
    }
  }
  if (stages.has("all"))
    await contactSheet(
      web,
      output,
      done.map((n) => ({
        name: n,
        image: readFileSync(join(output, n + ".png")).toString("base64"),
      })),
      1,
      "contact-sheet.png",
      3,
      { width: 640, height: 252 },
    );
  assert.deepEqual(errors, []);
} finally {
  if (errors.length) console.log(errors.join("\n"));
  await editor.close();
  await browser.close();
  server.kill();
  rmSync(temp, { recursive: true, force: true });
}
