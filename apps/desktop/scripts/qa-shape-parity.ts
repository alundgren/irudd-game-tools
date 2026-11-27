import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Page } from "@playwright/test";
import { build } from "vite-plus";
import { launchEditor, callEditor } from "./editor-session.js";
import { appDir, electronExecutable, appEnvironment } from "./electron.js";
import { contactSheet } from "./contact-sheet.js";
import type {} from "../qa/shape/probe.js";

const root = resolve(appDir, "../.."),
  dir = join(root, ".reference-cache/phase9-1"),
  work = mkdtempSync(join(tmpdir(), "shape-parity-"));
mkdirSync(dir, { recursive: true });
const problems: string[] = [];
const started = performance.now();
async function launch(name: string) {
  return launchEditor(
    electronExecutable(),
    [
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--project",
      join(work, name),
      "--create",
    ],
    join(work, "user-" + name),
    appEnvironment({ IRUDD_STATE_DIR: join(work, "state-" + name) }),
    problems,
    appDir,
  );
}
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
    outDir: join(work, "probe"),
    minify: false,
  },
});
const probe = readFileSync(join(work, "probe/probe.js"), "utf8");
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-angle=default"],
});
const web = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const editor = await launch("first"),
  desk = editor.page;
const stud = desk.locator("#shape-editor"),
  modes = stud.getByLabel("Shape mode", { exact: true });

const saved: { id: string; file: string; hash: string }[] = [];
let seq = 0;

async function frame(p: Page) {
  await p.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
}
async function expand(name: string) {
  const element = desk.locator(name);
  if (!(await element.evaluate((el) => el.hasAttribute("open"))))
    await element.locator(":scope > summary").click();
}
async function nativeId(name: string) {
  const key = await desk
    .locator("#outliner .row")
    .evaluateAll(
      (nodes, n) =>
        nodes
          .find((row) => row.firstElementChild?.textContent?.toLowerCase() === n.toLowerCase())
          ?.getAttribute("data-part"),
      name,
    );
  assert.ok(key, "Missing desktop part " + name);
  return key;
}
async function part(name: string, focus = true) {
  const id = await nativeId(name);

  await desk.locator('#outliner [data-part="' + id + '"]').click();
  await web.selectOption("#target", name);
  if (focus) {
    await desk.click("#focus-selection");
    await web.click("#focus");
  }
  await Promise.all([frame(desk), frame(web)]);
}
const arm = "right forearm",
  head = "head and neck",
  cape = "festival shoulder cape";
const adultFile = join(work, "adult.form.json");
execFileSync(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    `import {generatedHuman} from './character-view/human-form.js';import {writeFileSync} from 'node:fs';writeFileSync(process.argv[1],JSON.stringify({format:'irudd.form.v1',form:generatedHuman(491,'any')}));`,
    adultFile,
  ],
  { cwd: root },
);
async function fresh(adult: boolean) {
  const old = await desk.inputValue("#document");
  await desk.selectOption("#start", adult ? "human-adult/preset/seed-491" : "jointed-conductor");
  await desk.waitForFunction(
    (v) =>
      document.querySelector<HTMLSelectElement>("#document")?.value !== v &&
      !document.querySelector("#viewport")?.hasAttribute("inert"),
    old,
    { timeout: 60000 },
  );
  await expand("#shape-editor");
  await web
    .locator("#openfile")
    .setInputFiles(adult ? adultFile : join(root, "examples/jointed-conductor.form.json"));
  await web.waitForFunction(() =>
    document.querySelector("#status")?.textContent?.includes("Form opened"),
  );
  for (const selector of ["#human-brush", "#pull-tool", "#place-branch", "#branch-tool"]) {
    const el = web.locator(selector);
    if ((await el.isVisible()) && (await el.getAttribute("aria-pressed")) === "true")
      await el.click();
  }
  await web.click('[data-mode="Color"]');
  await desk.click("#camera-front");
  await web.click('[data-angle="Front"]');
  await Promise.all([frame(desk), frame(web)]);
}
async function activate(mode: string, button: string) {
  await modes.selectOption(mode);
  if ((await web.locator(button).getAttribute("aria-pressed")) !== "true") await web.click(button);
}
async function revision() {
  const text = await desk.locator("#status-right").innerText();
  const n = /revision (\d+)/i.exec(text)?.[1];
  assert.ok(n, text);
  return Number(n);
}
async function ready(n: number) {
  await desk.waitForFunction(
    (value) =>
      new RegExp("revision " + value + "\\b").test(
        document.querySelector("#status-right")?.textContent ?? "",
      ) &&
      !document.querySelector("#viewport")?.hasAttribute("inert") &&
      !document.querySelector("#shape-editor")?.hasAttribute("inert"),
    n,
    { timeout: 25000 },
  );
  await frame(desk);
}
async function digest(p = desk) {
  const r = await callEditor(p, "current", { documentId: await p.inputValue("#document") });
  const h: unknown = Reflect.get(Object(r), "documentDigest");
  assert.equal(typeof h, "string");
  return String(h);
}
async function checkHistory(run: () => Promise<void>) {
  const n = await revision(),
    before = await digest();
  await run();
  await ready(n + 1);
  const after = await digest();
  assert.notEqual(before, after);
  await desk.click("#undo");
  await ready(n + 2);
  assert.equal(await digest(), before);
  await desk.click("#redo");
  await ready(n + 3);
  assert.equal(await digest(), after);
}
async function point(p: Page, name: string, u: number, v: number, dx: number, dy: number) {
  const id = p === web ? name : await nativeId(name);
  return p.evaluate(([id, u, v, x, y]) => window.shapeProbe.point(id, u, v, x, y), [
    id,
    u,
    v,
    dx,
    dy,
  ] as const);
}
async function drag(p: Page, name: string, u: number, v: number, dx: number, dy: number) {
  const { start, end } = await point(p, name, u, v, dx, dy);
  console.log(p === web ? "Browser stroke" : "Desktop stroke", name, start, end);
  await p.mouse.move(start.x, start.y);
  await p.mouse.down();
  await p.mouse.move(end.x, end.y, { steps: 8 });
  await frame(p);
  await p.mouse.up();
  await frame(p);
}
async function cancelStroke(p: Page, name: string, skin: boolean, draw = false) {
  const before = await geom(p, name),
    { start, end } = await point(p, name, 0.65, 0.65, 0.035, 0.012);
  const session = await p.context().newCDPSession(p);
  try {
    await session.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    await p.mouse.move(start.x, start.y);
    await frame(p);
    const ring =
      p === desk ? p.locator(".skin-brush-ring") : p.locator("#stage div[style*='border-radius']");
    const hover = skin ? (await ring.boundingBox())?.width : undefined;
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...start, id: 1 }],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ ...end, id: 1 }],
    });
    await frame(p);
    if (skin && hover !== undefined) {
      const active = await ring.boundingBox();
      assert.ok(active && active.width >= hover - 0.5, "effective brush ring");
    }
    if (!draw) assert.ok(movement(before, await geom(p, name)) > 0.0005, "live geometry preview");
    await session.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await frame(p);
    assert.equal(movement(before, await geom(p, name)), 0, "cancel restores the mesh");
  } finally {
    await session.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await session.detach();
  }
}
async function pick(p: Page, name: string, u: number, v: number) {
  const { start } = await point(p, name, u, v, 0, 0);
  await p.mouse.click(start.x, start.y);
  await frame(p);
}
async function geom(p: Page, name: string) {
  const id = p === web ? name : await nativeId(name);
  return p.evaluate((key) => window.shapeProbe.geometry(key), id);
}
function movement(a: number[], b: number[]) {
  assert.ok(a.length && b.length, "The subject must be rendered in both frames.");
  if (a.length === b.length)
    return a.reduce((maximum, x, i) => Math.max(maximum, Math.abs(x - (b[i] ?? x))), 0);
  const separation = (left: number[], right: number[]) => {
    let maximum = 0;
    for (let i = 0; i < left.length; i += 3 * Math.max(1, Math.floor(left.length / 1800))) {
      let nearest = Infinity;
      for (let j = 0; j < right.length; j += 3) {
        const dx = (left[i] ?? 0) - (right[j] ?? 0),
          dy = (left[i + 1] ?? 0) - (right[j + 1] ?? 0),
          dz = (left[i + 2] ?? 0) - (right[j + 2] ?? 0);
        nearest = Math.min(nearest, dx * dx + dy * dy + dz * dz);
      }
      maximum = Math.max(maximum, nearest);
    }
    return Math.sqrt(maximum);
  };
  return Math.max(separation(a, b), separation(b, a));
}
async function pictures(center: readonly [number, number, number], height: number, yaw: number) {
  await Promise.all([frame(desk), frame(web)]);
  return Promise.all(
    [web, desk].map(async (p) =>
      Buffer.from(
        await p.evaluate(([at, span, angle]) => window.shapeProbe.capture(at, span, angle), [
          center,
          height,
          yaw,
        ] as const),
        "base64",
      ),
    ),
  );
}
async function paired(id: string, title: string, action: () => Promise<void>, subject?: string) {
  console.log(id, title);
  const skin = id.startsWith("S"),
    placing = id.startsWith("B"),
    draw = id.startsWith("D");
  const focus =
    id === "B2-mounted"
      ? "Painted shield"
      : id === "D3-opposite"
        ? "rib cage"
        : placing || draw
          ? head
          : (subject ?? (id === "V4" ? cape : arm));
  const center = await web.evaluate((part) => window.shapeProbe.centre(part), focus);
  if (placing && id !== "B2-mounted") center[1] -= 0.12;
  const height =
    id === "B2-mounted"
      ? 0.42
      : id === "D3-opposite"
        ? 1.0
        : placing
          ? 0.72
          : draw
            ? 0.56
            : skin
              ? 0.32
              : id === "V2"
                ? 1.8
                : id === "V4"
                  ? 0.68
                  : id === "V5"
                    ? 0.56
                    : 0.34;
  const yaw = skin ? 0.68 : id === "P2" ? 0.78 : 0.12;
  const visibleParts = () =>
    Promise.all([web, desk].map((p) => p.evaluate(() => window.shapeProbe.names().length)));
  const count = !subject && (placing || draw || id === "V5") ? await visibleParts() : undefined;
  const before = await pictures(center, height, yaw);
  console.log("Captured before");
  const vertices = subject
    ? await Promise.all([geom(web, subject), geom(desk, subject)])
    : undefined;
  await action();
  console.log("Applied", id);
  if (subject && vertices) {
    const movementWeb = movement(vertices[0], await geom(web, subject)),
      movementDesk = movement(vertices[1], await geom(desk, subject));
    console.log("Maximum displacement (m)", movementWeb, movementDesk);
    assert.ok(
      Math.min(movementDesk, movementWeb) > 0.001,
      id + " must move actual vertices in both workshops",
    );
  }
  if (count) {
    const after = await visibleParts();
    const gain = after.map((n, i) => n - (count[i] ?? 0));
    assert.ok(
      gain.every((n) => n > 0),
      id + " must add visible geometry in both workshops",
    );
    assert.equal(gain[0], gain[1]);
    if (id === "V5") assert.equal(gain[0], 12);
  }
  const after = await pictures(center, height, yaw);
  await writePair(id, title, before, after);
}
async function writePair(id: string, title: string, before: Buffer[], after: Buffer[]) {
  const image = await web.evaluate(
    async ({ rows, title }) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1120;
      canvas.height = 846;
      const c = canvas.getContext("2d");
      if (!c) throw new Error("2D unavailable");
      c.fillStyle = "#202a2c";
      c.fillRect(0, 0, 1120, 846);
      c.fillStyle = "white";
      c.font = "22px sans-serif";
      c.fillText(title, 12, 29);
      for (const [j, row] of rows.entries())
        for (const [k, png] of row.entries()) {
          const image = await createImageBitmap(
            new Blob([Uint8Array.from(atob(png), (x) => x.charCodeAt(0))], { type: "image/png" }),
          );
          const ratio = Math.min(554 / image.width, 370 / image.height);
          const x = k * 560,
            y = 42 + j * 400;
          c.fillStyle = "#fff";
          c.font = "16px sans-serif";
          c.fillText((k ? "Desktop" : "Browser") + (j ? " after" : " before"), x + 10, y + 16);
          c.drawImage(
            image,
            x + (560 - image.width * ratio) / 2,
            y + 23,
            image.width * ratio,
            image.height * ratio,
          );
          image.close();
        }
      return canvas.toDataURL().split(",")[1] ?? "";
    },
    {
      rows: [before, after].map((row) => row.map((b) => b.toString("base64"))),
      title: id + "   " + title,
    },
  );
  writeFileSync(join(dir, id + ".png"), Buffer.from(image, "base64"));
}
async function highlightDetail(id: string) {
  const path = join(dir, id + ".png");
  const image = await web.evaluate(async (encoded) => {
    const input = await createImageBitmap(
      new Blob([Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))], { type: "image/png" }),
    );
    if (input.height !== 846) {
      input.close();
      return encoded;
    }
    const canvas = document.createElement("canvas");
    canvas.width = input.width;
    canvas.height = 1080;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("2D unavailable");
    ctx.fillStyle = "#202a2c";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(input, 0, 0);
    for (let col = 0; col < 2; col++) {
      const left = col * 560,
        size = 112;
      const before = ctx.getImageData(left, 65, 560, 370).data,
        after = ctx.getImageData(left, 465, 560, 370).data;
      let best = -1,
        cropX = 0,
        cropY = 0;
      for (let y = 0; y <= 370 - size; y += 8)
        for (let x = 0; x <= 560 - size; x += 8) {
          let score = 0;
          for (let j = y; j < y + size; j += 5)
            for (let i = x; i < x + size; i += 5) {
              const k = 4 * (j * 560 + i);
              score += Math.min(
                80,
                Math.abs((before[k] ?? 0) - (after[k] ?? 0)) +
                  Math.abs((before[k + 1] ?? 0) - (after[k + 1] ?? 0)) +
                  Math.abs((before[k + 2] ?? 0) - (after[k + 2] ?? 0)),
              );
            }
          if (score > best) {
            best = score;
            cropX = x;
            cropY = y;
          }
        }
      if (best <= 0)
        throw new Error("No visible change in the " + (col ? "desktop" : "browser") + " render");
      for (const [index, label] of ["before", "after"].entries()) {
        const x = left + 45 + index * 248;
        ctx.fillStyle = "white";
        ctx.font = "16px sans-serif";
        ctx.fillText("Detail ? " + label, x, 858);
        ctx.drawImage(input, left + cropX, 65 + 400 * index + cropY, size, size, x, 866, 202, 202);
      }
    }
    input.close();
    return canvas.toDataURL().split(",")[1] ?? "";
  }, readFileSync(path).toString("base64"));
  writeFileSync(path, Buffer.from(image, "base64"));
  return { name: id, image };
}
async function save() {
  const hash = await digest(),
    id = await desk.inputValue("#document"),
    file = join(work, "study-" + ++seq + ".irudd-character");
  await editor.answerDialogs({ save: file });
  await desk.click("#character-save");
  await desk.waitForFunction(
    (n) => document.querySelector("#status")?.textContent?.includes(n),
    "study-" + seq + ".irudd-character",
  );
  saved.push({ hash, id, file });
}
async function checkbox(p: Page, name: string, state: boolean) {
  const element = p === desk ? stud.getByLabel(name, { exact: true }) : p.locator(name);
  await element.setChecked(state);
}
async function halfPull(
  name: string,
  skin: boolean,
  mode: string,
  size: number,
  sym: boolean,
  u: number,
  v: number,
  dx: number,
  dy: number,
) {
  const map: Record<string, string> = {
    "Screen plane": "move",
    Normal: "normal",
    "Soften corrections": "soften",
  };
  await stud.getByLabel("Reach (cm)").fill(String(size));
  await stud.getByLabel("Drag direction").selectOption(mode);
  await checkbox(desk, skin ? "Mirror across the character" : "Mirror across this part", sym);
  await web.locator(skin ? "#human-brush-size" : "#pull-size").fill(String(size));
  await web.selectOption(
    skin ? "#human-brush-mode" : "#pull-direction",
    skin ? (map[mode] ?? "move") : mode,
  );
  await checkbox(web, skin ? "#human-brush-mirror" : "#pull-mirror", sym);
  await drag(web, name, u, v, dx, dy);
  await checkHistory(() => drag(desk, name, u, v, dx, dy));
}
async function pulls() {
  await fresh(false);
  await part(head);
  await activate("Pull", "#pull-tool");
  const initial = await revision();
  for (const p of [web, desk]) {
    await cancelStroke(p, head, false);
    await pick(p, head, 0.6, 0.6);
  }
  assert.equal(await revision(), initial);
  for (const [id, title, mode, size, sym, u, v, dx, dy] of [
    ["P1", "Pull the jaw in the view plane", "Screen plane", 10, false, 0.22, 0.72, -0.065, -0.015],
    [
      "P2",
      "Raise the surface and indent along its normal",
      "Normal",
      12,
      false,
      0.7,
      0.64,
      0,
      0.085,
    ],
    ["P3", "Increase reach across the part", "Screen plane", 20, false, 0.53, 0.67, 0.045, 0.05],
    ["P4", "Mirror a lateral pull", "Screen plane", 9, true, 0.18, 0.74, -0.065, -0.01],
  ] as const) {
    await paired(id, title, () => halfPull(head, false, mode, size, sym, u, v, dx, dy), head);
    if (id === "P2") await halfPull(head, false, mode, size, sym, u, v, 0, -0.055);
  }
  await save();
}
async function adult() {
  await fresh(true);
  const region = "chest";
  await part(region);
  await activate("Sculpt skin", "#human-brush");
  await stud.getByLabel("Reach (cm)").fill("2");
  await web.fill("#human-brush-size", "2");
  const unchanged = await revision();
  for (const p of [web, desk]) await cancelStroke(p, region, true);
  await stud.getByRole("button", { name: "Remove surface corrections" }).click();
  assert.equal(await revision(), unchanged);
  for (const [id, title, mode, size, sym, u, v, dx, dy] of [
    ["S1", "Pull across the chest and rib cage", "Screen plane", 16, false, 0.68, 0.82, 0.075, 0],
    ["S2", "Adjust the brush reach", "Screen plane", 12, false, 0.72, 0.42, 0.07, 0.02],
    [
      "S3",
      "Mirror the correction on the other side",
      "Screen plane",
      15,
      true,
      0.72,
      0.48,
      0.08,
      0,
    ],
    ["S4", "Raise and sink connected skin", "Normal", 16, false, 0.68, 0.55, 0, 0.08],
    ["S5", "Soften existing corrections", "Soften corrections", 16, true, 0.72, 0.55, 0.22, 0],
  ] as const) {
    const adjacent =
      id === "S1" ? await Promise.all([geom(web, "rib cage"), geom(desk, "rib cage")]) : undefined;
    await paired(id, title, () => halfPull(region, true, mode, size, sym, u, v, dx, dy), region);
    if (adjacent) {
      assert.ok(movement(adjacent[0], await geom(web, "rib cage")) > 0.001);
      assert.ok(movement(adjacent[1], await geom(desk, "rib cage")) > 0.001);
    }
    if (id === "S4") await halfPull(region, true, mode, size, sym, u, v, 0, -0.05);
  }
  await save();
  await paired(
    "S6",
    "Remove all surface corrections",
    async () => {
      await web.click("#human-brush-clear");
      await checkHistory(() =>
        stud.getByRole("button", { name: "Remove surface corrections" }).click(),
      );
    },
    region,
  );
  await save();
}
async function draws() {
  await fresh(false);
  await part(head);
  await activate("Draw", "#branch-tool");
  const unchanged = await revision();
  for (const p of [web, desk]) await cancelStroke(p, head, false, true);
  assert.equal(await revision(), unchanged);
  for (const [id, title, kind, radius, sym, u, v, dx, dy] of [
    ["D1", "Seat a horn where the stroke starts", "Horn", 0.035, false, 0.23, 0.52, -0.16, 0.08],
    ["D2", "Draw a tail", "Tail", 0.05, false, 0.74, 0.54, 0.18, 0.06],
    ["D2-fin", "Draw a thin fin", "Fin", 0.05, false, 0.67, 0.68, 0.13, -0.04],
    ["D2-limb", "Draw a walking limb", "Walking limb", 0.035, false, 0.32, 0.7, -0.14, -0.08],
    ["D3", "Mirror a drawn appendage", "Horn", 0.04, true, 0.73, 0.66, 0.14, -0.08],
  ] as const) {
    await stud.getByLabel("Appendage", { exact: true }).selectOption(kind);
    await web.selectOption("#branch-type", kind);
    const colour = kind === "Fin" ? "#559dad" : kind === "Tail" ? "#d99c58" : "#987453";
    await stud.getByLabel("Branch colour").fill(colour);
    await web.locator("#branch-color").fill(colour);
    await stud.getByLabel("Radius (m)").fill(String(radius));
    await web.fill("#branch-radius", String(radius * 100));
    await checkbox(web, "#branch-mirror", sym);
    await checkbox(desk, "Mirror across the character", sym);
    await paired(id, title, async () => {
      await drag(web, head, u, v, dx, dy);
      await checkHistory(() => drag(desk, head, u, v, dx, dy));
      const added = await web.inputValue("#target");
      assert.match(added, new RegExp(kind, "i"));
    });
  }
  await save();
}
async function livePointers() {
  for (const [id, title, mode, button, name] of [
    ["P1-live", "Part pull during a drag", "Pull", "#pull-tool", head],
    ["D1-live", "Appendage stroke before release", "Draw", "#branch-tool", head],
    ["B1-pin", "Marked branch anchor", "Place branch", "#place-branch", arm],
    ["S2-ring", "Requested and effective brush reach", "Sculpt skin", "#human-brush", "chest"],
  ] as const) {
    await fresh(id === "S2-ring");
    await part(name);
    await activate(mode, button);
    if (id === "S2-ring") {
      await web.fill("#human-brush-size", "2");
      await stud.getByLabel("Reach (cm)").fill("2");
    }
    const before: Buffer[] = [],
      active: Buffer[] = [];
    for (const p of [web, desk]) {
      const { start, end } = await point(
        p,
        name,
        0.58,
        0.62,
        id === "D1-live" ? 0.08 : 0.035,
        0.022,
      );
      const { w, h } = await p.evaluate(() => ({ w: innerWidth, h: innerHeight }));
      const x = Math.max(0, Math.min(w - 420, Math.round((start.x + end.x) / 2 - 210)));
      const y = Math.max(0, Math.min(h - 340, Math.round((start.y + end.y) / 2 - 170)));
      const clip = { x, y, width: 420, height: 340 };
      const snapshot = () => (p === desk ? editor.capture(clip) : p.screenshot({ clip }));
      await p.mouse.move(start.x, start.y);
      await frame(p);
      const ring =
        p === web
          ? p.locator("#stage div[style*='border-radius']")
          : desk.locator(".skin-brush-ring");
      const hover = id === "S2-ring" ? await ring.boundingBox() : null;
      if (id === "S2-ring") assert.ok(hover, "Show the hover brush");
      before.push(await snapshot());
      if (id === "B1-pin") {
        await p.mouse.click(start.x, start.y);
        if (p === web) assert.match(await web.locator("#place-hint").innerText(), /Marked/);
        else await desk.locator(".branch-anchor").waitFor({ state: "visible" });
      } else {
        await p.mouse.down();
        await p.mouse.move(end.x, end.y, { steps: 6 });
      }
      await frame(p);
      if (hover) {
        const effective = await ring.boundingBox();
        assert.ok(effective && effective.width > hover.width + 0.5);
      }
      active.push(await snapshot());
      if (id !== "B1-pin") await p.mouse.up();
      await frame(p);
    }
    await writePair(id, title, before, active);
    console.log("Captured", id);
  }
}
async function posedSkin() {
  await fresh(true);
  const left = "left forearm",
    right = "right forearm",
    guard = "Brush guard";
  const sample: unknown = JSON.parse(readFileSync(adultFile, "utf8")),
    form: unknown = Reflect.get(Object(sample), "form"),
    parts: unknown = Reflect.get(Object(form), "parts");
  assert.ok(Array.isArray(parts));
  const forearm: unknown = parts.find((o: unknown) => Reflect.get(Object(o), "id") === left);
  assert.ok(forearm);
  Reflect.set(Object(forearm), "rotation", [0, 0, 35]);
  const position = [0, 0, 0.085],
    size = [0.16, 0.14, 0.18],
    color = "#9e6858";
  parts.push({
    id: guard,
    parent: "chest",
    shape: "box",
    position,
    size,
    color,
    rotation: [0, 0, 0],
  });
  const file = join(work, "posed.form.json");
  writeFileSync(file, JSON.stringify(sample));
  await web.locator("#openfile").setInputFiles(file);
  const documentId = await desk.inputValue("#document"),
    angle = (35 * Math.PI) / 360;
  await callEditor(desk, "apply", {
    request: {
      format: "irudd.command",
      version: 1,
      requestId: "qa-posed-skin",
      expectedRevision: await revision(),
      documentId,
      command: {
        type: "edit",
        ops: [
          {
            op: "part.set",
            part: await nativeId(left),
            set: { rotation: [0, 0, Math.sin(angle), Math.cos(angle)] },
          },
          {
            op: "part.add",
            part: {
              id: "p-brush-guard",
              label: guard,
              parent: await nativeId("chest"),
              shape: "box",
              position,
              size,
              color,
              rotation: [0, 0, 0, 1],
              sculpt: [],
              features: {},
            },
          },
        ],
      },
    },
  });
  await ready(2);
  await part(guard);
  await activate("Sculpt skin", "#human-brush");
  const initial = await revision();
  for (const p of [web, desk]) await drag(p, guard, 0.5, 0.5, 0.025, 0);
  assert.equal(await revision(), initial);
  await part(left);
  await web.click('[data-angle="Front"]');
  await desk.click("#camera-front");
  await part(left);
  await web.selectOption("#human-brush-mode", "soften");
  await stud.getByLabel("Drag direction").selectOption("Soften corrections");
  for (const p of [web, desk]) await drag(p, left, 0.55, 0.55, 0.055, 0);
  assert.equal(await revision(), initial);
  const other = await Promise.all([geom(web, right), geom(desk, right)]);
  await paired(
    "S3-posed",
    "Mirror a stroke from a turned forearm",
    () => halfPull(left, true, "Screen plane", 12, true, 0.55, 0.55, 0.07, 0.03),
    left,
  );
  assert.ok(movement(other[0], await geom(web, right)) > 0.001);
  assert.ok(movement(other[1], await geom(desk, right)) > 0.001);
  await save();
}
async function mirroredAttachments() {
  await fresh(true);
  await part(arm, false);
  await activate("Draw", "#branch-tool");
  await checkbox(web, "#branch-mirror", true);
  await checkbox(desk, "Mirror across the character", true);
  await stud.getByLabel("Appendage", { exact: true }).selectOption("Horn");
  await web.selectOption("#branch-type", "Horn");
  await stud.getByLabel("Radius (m)").fill(".045");
  await web.fill("#branch-radius", "4.5");
  await paired("D3-opposite", "Draw a mirrored pair from the forearm", async () => {
    await drag(web, arm, 0.38, 0.5, -0.13, 0.055);
    await checkHistory(() => drag(desk, arm, 0.38, 0.5, -0.13, 0.055));
    const doc = await callEditor(desk, "current", {
        documentId: await desk.inputValue("#document"),
      }),
      parts: unknown = Reflect.get(Object(Reflect.get(Object(doc), "document")), "parts");
    assert.ok(Array.isArray(parts));
    const parents = parts
      .filter((p: unknown) => /^(left|right) horn$/i.test(String(Reflect.get(Object(p), "label"))))
      .map((p: unknown) => String(Reflect.get(Object(p), "parent")))
      .sort();
    assert.deepEqual(parents, [await nativeId(arm), await nativeId("left forearm")].sort());
  });
  await save();
}
async function capacity() {
  await fresh(false);
  const sample: unknown = JSON.parse(
    readFileSync(join(root, "examples/jointed-conductor.form.json"), "utf8"),
  );
  const form: unknown = Reflect.get(Object(sample), "form"),
    parts: unknown = Reflect.get(Object(form), "parts");
  assert.ok(Array.isArray(parts));
  const pulls = Array.from({ length: 63 }, () => ({
    at: [0, 0, 0],
    reach: [0.007, 0.007, 0.007],
    offset: [0, 0, 0],
  }));
  const source: unknown = parts.find((p: unknown) => Reflect.get(Object(p), "id") === head);
  assert.ok(source);
  Reflect.set(Object(source), "pulls", pulls);
  const documentId = await desk.inputValue("#document"),
    partId = await nativeId(head);
  const additions = 128 - parts.length,
    ops: object[] = [
      { op: "feature.set", part: partId, feature: "figure.pulls", value: { pulls } },
    ];
  for (let i = 0; i < additions; i++) {
    const label = "Spare " + i,
      size = [0.007, 0.007, 0.007],
      position = [0, 0, 0],
      color = "#887752";
    parts.push({ id: label, shape: "ellipsoid", position, size, color, rotation: [0, 0, 0] });
    ops.push({
      op: "part.add",
      part: {
        id: "p-spare-" + i,
        label,
        shape: "ellipsoid",
        parent: null,
        position,
        size,
        color,
        rotation: [0, 0, 0, 1],
        sculpt: [],
        features: {},
      },
    });
  }
  const file = join(work, "capacity.form.json");
  writeFileSync(file, JSON.stringify(sample));
  await web.locator("#openfile").setInputFiles(file);
  await web.waitForFunction(
    () => document.querySelector<HTMLSelectElement>("#target")?.options.length === 129,
  );
  await callEditor(desk, "apply", {
    request: {
      format: "irudd.command",
      version: 1,
      requestId: "qa-shape-capacity",
      expectedRevision: await revision(),
      documentId,
      command: { type: "edit", ops },
    },
  });
  await ready(2);
  await part(head, false);
  await activate("Pull", "#pull-tool");
  await halfPull(head, false, "Screen plane", 7, false, 0.48, 0.7, -0.035, 0.02);
  const before = await revision();
  for (const p of [web, desk]) await drag(p, head, 0.55, 0.52, 0.05, 0.02);
  assert.match(await web.locator("#status").innerText(), /64/);
  assert.match(await desk.locator("#banner").innerText(), /64/);
  await activate("Draw", "#branch-tool");
  for (const p of [web, desk]) await drag(p, head, 0.55, 0.52, 0.1, 0.06);
  assert.match(await web.locator("#status").innerText(), /128/);
  assert.match(await desk.locator("#banner").innerText(), /128/);
  await part(arm, false);
  await activate("Place branch", "#place-branch");
  for (const p of [web, desk]) {
    await frame(p);
    await pick(p, arm, 0.5, 0.5);
    await pick(p, head, 0.4, 0.6);
  }
  assert.match(await web.locator("#place-hint").innerText(), /128/);
  assert.match(await desk.locator("#banner").innerText(), /128/);
  assert.equal(await revision(), before);
}
async function placementGestures() {
  await fresh(false);
  await part(arm, false);
  await activate("Place branch", "#place-branch");
  const initial = await revision();
  for (const p of [web, desk]) {
    const viewport = p.locator(p === web ? "#viewport" : "#viewport canvas").first();
    const box = await viewport.boundingBox();
    assert.ok(box);
    const x = box.x + box.width * 0.14,
      y = box.y + box.height * 0.25;
    await p.mouse.click(x, y);
    await frame(p);
    if (p === web) assert.match(await web.locator("#place-hint").innerText(), /visible surface/);
    else assert.equal(await desk.locator(".branch-anchor").count(), 0);
    await pick(p, arm, 0.48, 0.56);
    const orientation = () => p.evaluate(() => window.shapeProbe.camera());
    const before = await orientation();
    await p.mouse.move(x, y);
    await p.mouse.down();
    await p.mouse.move(x + 35, y + 12, { steps: 5 });
    await p.mouse.up();
    await frame(p);
    assert.notDeepEqual(await orientation(), before, "drag between picks must orbit");
    if (p === web) {
      assert.match(await web.locator("#place-hint").innerText(), /Marked/);
      await web.click("#place-branch");
    } else {
      await desk.locator(".branch-anchor").waitFor({ state: "attached" });
      await modes.selectOption("Draw");
      assert.equal(await desk.locator(".branch-anchor").count(), 0);
    }
  }
  assert.equal(await revision(), initial);
}
async function branches() {
  for (const [id, title, copy, scale, twist, axis, depth] of [
    ["B1", "Pick a child anchor on a selected branch", true, 100, 0, "surface", 8],
    ["B2", "Move a branch intact", false, 100, 0, "surface", 8],
    ["B3", "Copy a branch intact", true, 100, 0, "surface", 8],
    ["B4", "Scale around the anchor", true, 165, 0, "surface", 8],
    ["B5", "Turn about the surface normal", true, 115, 80, "surface", 8],
    ["B5-view", "Turn about the view axis", true, 115, -65, "view", 8],
    ["B6", "Seat the branch inside the receiving surface", true, 100, 20, "surface", 65],
  ] as const) {
    await fresh(false);
    if (id === "B3") {
      await desk.locator("#viewport canvas").first().focus();
      await desk.keyboard.press("Escape");
      await web.selectOption("#target", "");
    } else await part(arm, false);
    await activate("Place branch", "#place-branch");
    await stud
      .getByLabel("Placement", { exact: true })
      .selectOption(copy ? "Copy branch" : "Move branch");
    await web.selectOption("#place-mode", copy ? "copy" : "move");
    await stud.getByLabel("Branch size (%)").fill(String(scale));
    await web.fill("#place-scale", String(scale));
    await stud
      .getByLabel("Turn around")
      .selectOption(axis === "view" ? "View axis" : "Surface normal");
    await web.selectOption("#place-axis", axis);
    await stud.getByLabel("Turn (degrees)").fill(String(twist));
    await web.fill("#place-twist", String(twist));
    await stud.getByLabel("Seat inside surface (mm)").fill(String(depth));
    await web.fill("#place-depth", String(depth));
    const anchor = id === "B1" ? "right hand" : arm;
    await paired(
      id,
      title,
      async () => {
        if (id === "B1") {
          await pick(web, head, 0.5, 0.5);
          assert.match(await web.locator("#place-hint").innerText(), /children/);
          await pick(desk, head, 0.5, 0.5);
          assert.equal(await desk.locator(".branch-anchor").count(), 0);
        }
        await pick(web, anchor, 0.4, 0.4);
        assert.match(await web.locator("#place-hint").innerText(), /Marked/);
        if (id === "B2") {
          await pick(web, "right hand", 0.5, 0.5);
          assert.match(await web.locator("#place-hint").innerText(), /outside/);
        }
        if (id === "B6") {
          await web.fill("#place-depth", "120");
          await pick(web, head, 0.22, 0.55);
          assert.match(await web.locator("#place-hint").innerText(), /depth/);
          await web.fill("#place-depth", String(depth));
        }
        await pick(web, head, 0.22, 0.55);
        assert.match(await web.locator("#status").innerText(), /Moved|Copied/);
        await checkHistory(async () => {
          await pick(desk, anchor, 0.4, 0.4);
          await desk.locator(".branch-anchor").waitFor({ state: "attached" });
          if (id === "B2") {
            await pick(desk, "right hand", 0.5, 0.5);
            assert.match(await desk.locator("#banner").innerText(), /outside/);
          }
          if (id === "B6") {
            await stud.getByLabel("Seat inside surface (mm)").fill("120");
            await pick(desk, head, 0.22, 0.55);
            assert.match(await desk.locator("#banner").innerText(), /100/);
            await stud.getByLabel("Seat inside surface (mm)").fill(String(depth));
          }
          await pick(desk, head, 0.22, 0.55);
        });
      },
      copy ? undefined : arm,
    );
    await save();
  }
}

async function mountedPlate() {
  await fresh(false);
  const carrier = "Painted shield",
    label = "Mounted plate";
  const position = [-0.01, -0.17, 0.09],
    size = [0.13, 0.14, 0.045],
    color = "#f9f5e9";
  const sample: unknown = JSON.parse(
    readFileSync(join(root, "examples/jointed-conductor.form.json"), "utf8"),
  );
  const parts: unknown = Reflect.get(Object(Reflect.get(Object(sample), "form")), "parts");
  assert.ok(Array.isArray(parts));
  const shin: unknown = parts.find((p: unknown) => Reflect.get(Object(p), "id") === "right shin");
  assert.ok(shin);
  const browserPaint: unknown = Reflect.get(Object(shin), "paint");
  assert.ok(browserPaint);
  const shieldPosition = [0.65, 0, 0.05],
    shieldSize = [1, 1, 1],
    knots = [
      [0, -0.23, 0, 0.1, 0.09],
      [0, 0.01, 0, 0.14, 0.13],
      [0, 0.18, 0, 0.1, 0.08],
    ];
  parts.push({
    id: carrier,
    parent: "body",
    shape: "sweep",
    position: shieldPosition,
    rotation: [0, 0, 0],
    size: shieldSize,
    color: "#96765d",
    knots,
    paint: browserPaint,
  });
  const browserPose = { position, size, rotation: [0, 0, 0] };
  parts.push({
    id: label,
    parent: carrier,
    shape: "scute",
    color,
    surface: "scales",
    ...browserPose,
    mount: browserPose,
  });
  const file = join(work, "mounted.form.json");
  writeFileSync(file, JSON.stringify(sample));
  await web.locator("#openfile").setInputFiles(file);
  const desktopPose = { position, size, rotation: [0, 0, 0, 1] };
  const id = await desk.inputValue("#document"),
    base = await revision();
  const current = await callEditor(desk, "current", { documentId: id }),
    nativeParts: unknown = Reflect.get(Object(Reflect.get(Object(current), "document")), "parts");
  assert.ok(Array.isArray(nativeParts));
  const shinId = await nativeId("right shin"),
    nativeShin: unknown = nativeParts.find((p: unknown) => Reflect.get(Object(p), "id") === shinId);
  const paint: unknown = Reflect.get(
    Object(Reflect.get(Object(nativeShin), "features")),
    "figure.paint",
  );
  const atlas: unknown = Reflect.get(Object(nativeShin), "paint");
  assert.ok(atlas && paint);
  await callEditor(desk, "apply", {
    request: {
      format: "irudd.command",
      version: 1,
      requestId: "qa-mounted",
      expectedRevision: base,
      documentId: id,
      command: {
        type: "edit",
        ops: [
          {
            op: "part.add",
            part: {
              id: "p-shield",
              label: carrier,
              paint: atlas,
              parent: await nativeId("body"),
              shape: "box",
              color: "#96765d",
              position: shieldPosition,
              size: shieldSize,
              rotation: [0, 0, 0, 1],
              sculpt: [],
              features: {
                "figure.assembly": { order: 124 },
                "figure.paint": paint,
                "figure.sweep": { knots },
              },
            },
          },
          {
            op: "part.add",
            part: {
              id: "p-mounted",
              label,
              parent: "p-shield",
              shape: "box",
              color,
              ...desktopPose,
              sculpt: [],
              features: {
                "figure.scute": { mount: desktopPose },
                "figure.finish": { surface: "scales" },
                "figure.assembly": { order: 125 },
              },
            },
          },
        ],
      },
    },
  });
  await ready(base + 1);
  await part(carrier);
  await web.click('[data-angle="Front"]');
  await desk.click("#camera-front");
  await part(carrier);
  await part(label, false);
  await activate("Place branch", "#place-branch");
  await stud.getByLabel("Placement", { exact: true }).selectOption("Move branch");
  await web.selectOption("#place-mode", "move");
  await stud.getByLabel("Turn (degrees)").fill("35");
  await web.fill("#place-twist", "35");
  await paired(
    "B2-mounted",
    "Refit a painted plate at its destination",
    async () => {
      for (const p of [web, desk]) {
        const move = async () => {
          await pick(p, label, 0.5, 0.5);
          if (p === web) assert.match(await web.locator("#place-hint").innerText(), /Marked/);
          else await desk.locator(".branch-anchor").waitFor({ state: "attached" });
          await pick(p, carrier, 0.57, 0.15);
        };
        if (p === desk) await checkHistory(move);
        else {
          await move();
          assert.match(await web.locator("#status").innerText(), /Moved/);
        }
      }
    },
    label,
  );
  await save();
}
async function rechecks() {
  await fresh(false);
  await part(head);
  await modes.selectOption("Face");
  await web.click('[data-op="face"]');
  const slider = web.locator("#jaw");
  await slider.focus();
  await paired(
    "V1",
    "Jaw shape in Face mode",
    async () => {
      await slider.press("End");
      await web.click("#apply");
      await stud.getByLabel("Face multiplier").fill("1.4");
      await checkHistory(() => stud.getByRole("button", { name: "Shape face" }).click());
    },
    head,
  );
  await save();
  await fresh(false);
  await modes.selectOption("Build");
  await web.click('[data-op="build"]');
  await paired(
    "V2",
    "Body mass in Build mode",
    async () => {
      await web.locator("#mass").focus();
      await web.locator("#mass").press("End");
      await web.click("#apply");
      await stud.getByLabel("Build multiplier").fill("1.4");
      await checkHistory(() => stud.getByRole("button", { name: "Shape build" }).click());
    },
    "body",
  );
  await save();
  await fresh(false);
  await part(head);
  await activate("Pull", "#pull-tool");
  await paired(
    "V3",
    "Surface pull changes the jaw silhouette",
    () => halfPull(head, false, "Screen plane", 14, false, 0.18, 0.72, -0.095, -0.035),
    head,
  );
  await save();
}
async function cageAndPlates() {
  await fresh(false);
  await part(cape);
  await modes.selectOption("Cage");
  const buildParts = web
    .locator("details")
    .filter({ has: web.locator("#cage-corner") })
    .last();
  if (!(await buildParts.evaluate((el) => el.hasAttribute("open"))))
    await buildParts.locator(":scope > summary").click();
  await web.selectOption("#cage-face", "8");
  await web.selectOption("#cage-corner", "19");
  await paired(
    "V4",
    "Drag a cape control corner",
    async () => {
      for (const page of [web, desk]) {
        const partId = page === web ? cape : await nativeId(cape);
        const position = await page.evaluate(
          (id) => window.shapeProbe.corner(id, [-0.255, -0.13, 0.255], -0.16, -0.045),
          partId,
        );
        const gesture = async () => {
          const box =
            page === desk
              ? await desk.getByRole("button", { name: "Cage point 20", exact: true }).boundingBox()
              : null;
          const start = box
            ? { x: box.x + box.width / 2, y: box.y + box.height / 2 }
            : position.start;
          await page.mouse.move(start.x, start.y);
          await page.mouse.down();
          await page.mouse.move(
            start.x + position.end.x - position.start.x,
            start.y + position.end.y - position.start.y,
            { steps: 12 },
          );
          await page.mouse.up();
          await frame(page);
        };
        if (page === desk) await checkHistory(gesture);
        else await gesture();
      }
    },
    cape,
  );
  await save();
  await fresh(false);
  await part(arm);
  const plates = stud
    .locator("details")
    .filter({ has: desk.getByLabel("Repeated plate width (cm)") })
    .last();
  if (!(await plates.evaluate((el) => el.hasAttribute("open"))))
    await plates.locator(":scope > summary").click();
  if (!(await buildParts.evaluate((el) => el.hasAttribute("open"))))
    await buildParts.locator(":scope > summary").click();
  await paired("V5", "Repeat plates along the forearm", async () => {
    await web.selectOption("#repeat-side", "Front");
    await web.fill("#repeat-count", "4");
    await web.fill("#repeat-cols", "3");
    await web.fill("#repeat-width", "10");
    await stud.getByLabel("Repeated plate width (cm)").fill("10");
    await stud.getByLabel("Start along spine").fill("0.18");
    await stud.getByLabel("End along spine").fill("0.88");
    await stud.getByLabel("Plate colour").fill("#d4c6a7");
    await web.click("#repeat");
    await checkHistory(() =>
      stud.getByRole("button", { name: "Repeat plates", exact: true }).click(),
    );
  });
  await save();
}
try {
  await web.addInitScript(probe);
  await desk.addInitScript(probe);
  await desk.reload();
  await web.goto(pathToFileURL(join(root, "dist/character-view.html")).href);
  for (const [p, selector] of [
    [web, "#viewport"],
    [desk, "#viewport canvas"],
  ] as const) {
    const gpu = await p
      .locator(selector)
      .first()
      .evaluate((el) => {
        const gl = el instanceof HTMLCanvasElement && el.getContext("webgl2"),
          ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
        if (!gl || !ext) throw new Error("Missing WebGL2");
        return String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
      });
    console.log("Renderer", gpu);
    assert.doesNotMatch(gpu, /swiftshader|llvmpipe|warp|software/i);
  }
  const suites = {
    pulls,
    adult,
    draws,
    placementGestures,
    mirroredAttachments,
    posedSkin,
    livePointers,
    branches,
    mountedPlate,
    capacity,
    rechecks,
    cageAndPlates,
  };
  if (process.argv[2] && process.argv[2] !== "sheet" && !Object.hasOwn(suites, process.argv[2]))
    throw new Error("Unknown shape QA group " + process.argv[2]);
  for (const [name, run] of Object.entries(suites)) {
    if (process.argv[2] && process.argv[2] !== name) continue;
    const begin = performance.now();
    await run();
    console.log(name + " passed in " + Math.round((performance.now() - begin) / 1000) + " s");
  }
  if (!process.argv[2] || process.argv[2] === "sheet") {
    const ids =
      "P1 P1-live P2 P3 P4 S1 S2 S2-ring S3 S3-posed S4 S5 S6 D1 D1-live D2 D2-fin D2-limb D3 D3-opposite B1 B1-pin B2 B2-mounted B3 B4 B5 B5-view B6 V1 V2 V3 V4 V5".split(
        " ",
      );
    const images = [];
    for (const id of ids) images.push(await highlightDetail(id));
    await contactSheet(web, dir, images, 2);
  }
  for (const [i, study] of saved.entries()) {
    const loaded = await launch("reload-" + i);
    try {
      await loaded.answerDialogs({ open: study.file });
      await loaded.page.click("#character-open");
      await loaded.page.waitForFunction(
        (id) => document.querySelector<HTMLSelectElement>("#document")?.value === id,
        study.id,
      );
      assert.equal(await digest(loaded.page), study.hash);
    } finally {
      await loaded.close();
    }
  }
  assert.deepEqual(problems, []);
  console.log(
    "Reopened " +
      saved.length +
      " saved studies. Completed in " +
      Math.round((performance.now() - started) / 1000) +
      " s.",
  );
} catch (e) {
  console.error("Browser", await web.locator("#status,#failure,#place-hint").allTextContents());
  console.error("Desktop", await desk.locator("#status,#status-right,#banner").allTextContents());
  throw e;
} finally {
  await editor.close();
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}
