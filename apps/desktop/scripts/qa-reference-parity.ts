import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { chromium, type Page } from "@playwright/test";
import { appDir, electronExecutable, appEnvironment } from "./electron.js";
import { launchEditor, callEditor } from "./editor-session.js";
import { openDetails } from "./qa-field-parity.js";
import { contactSheet } from "./contact-sheet.js";
import { build } from "vite-plus";
import type {} from "../qa/shape/probe.js";

const stages = ["body", "head", "marks", "family", "studio"];
const requested = process.argv[2];
if (!requested || requested === "all") {
  const runDir = mkdtempSync(join(tmpdir(), "irudd-comparison-"));
  try {
    for (const stage of stages)
      execFileSync(
        process.execPath,
        [...process.execArgv, resolve(appDir, "scripts/qa-reference-parity.ts"), stage],
        {
          cwd: appDir,
          stdio: "inherit",
          windowsHide: true,
          env: { ...process.env, IRUDD_REFERENCE_RUN: runDir },
        },
      );
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
  process.exit(0);
}
if (!stages.includes(requested)) throw new Error("Unknown comparison group " + requested);
const root = resolve(appDir, "../.."),
  dir = join(root, ".reference-cache/phase9-4"),
  work = mkdtempSync(join(tmpdir(), "reference-parity-"));
const fixtures = join(dir, "fixtures");
mkdirSync(fixtures, { recursive: true });
execFileSync(process.execPath, ["scripts/reference-parity-fixtures.mjs", fixtures], { cwd: root });
const server = spawn(process.execPath, ["scripts/workshop.mjs"], {
  cwd: root,
  env: { ...process.env, WORKSHOP_PORT: "0" },
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
const url = await new Promise<string>((done, reject) => {
  server.stdout.on("data", (data: Buffer) => {
    const match = data.toString().match(/http:\/\/127.0.0.1:\d+\//);
    if (match) done(match[0]);
  });
  server.once("error", reject);
  server.once("exit", (code) => reject(new Error("Workshop exit " + code)));
});
const errors: string[] = [];
const editor = await launchEditor(
  electronExecutable(),
  [
    "--project",
    join(work, "study"),
    "--create",
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
  ],
  join(work, "user"),
  appEnvironment({ IRUDD_STATE_DIR: join(work, "state") }),
  errors,
  appDir,
);
const browser = await chromium.launch({ channel: "chrome", args: ["--use-angle=default"] });
const web = await browser.newPage({ viewport: { width: 1440, height: 950 } }),
  desk = editor.page;
const pages = [web, desk] as const;
const both = async (fn: (p: Page) => Promise<unknown>) => {
  await Promise.all(pages.map(fn));
};
const rid = (id: string) => "#hfit-" + id;
const click = (id: string) => both((p) => p.locator(rid(id)).click({ timeout: 240000 }));
const choose = (id: string, value: string) =>
  both((p) => p.selectOption(rid(id), value, { timeout: 240000 }));
const fill = (id: string, value: string) =>
  both(async (p) => {
    await p.locator(rid(id)).fill(value);
    await p.locator(rid(id)).press("Tab");
  });
const check = (id: string, checked: boolean) => both((p) => p.locator(rid(id)).setChecked(checked));
async function note(p: Page) {
  return p.locator("#hfit-note").innerText();
}
async function ready() {
  await both((p) =>
    p.waitForFunction(
      () => !document.querySelector<HTMLButtonElement>("#hfit-browse")?.disabled,
      null,
      { timeout: 240000 },
    ),
  );
}
async function inputFile(id: string, file: string) {
  await both((p) => p.locator(rid(id)).setInputFiles(file));
  await ready();
}
async function source(file: string) {
  await inputFile("file", join(fixtures, file));
  for (const p of pages)
    assert.ok((await p.locator("#hfit-facts").innerText()).includes(file), await note(p));
}
async function action(id: string) {
  await click(id);
  await ready();
}
async function expand(p: Page, id: string) {
  const el = p.locator(id);
  if (!(await el.evaluate((el) => el.hasAttribute("open"))))
    await el.locator(":scope > summary").click();
}
const captures: { id: number; name: string }[] = [];
async function capture(
  id: number,
  title: string,
  part?: string,
  evidence: string[] = [],
  portraits?: string[],
) {
  await both(async (p) => {
    if (part) await p.locator(part).scrollIntoViewIfNeeded();
    await p.evaluate(
      () =>
        new Promise<void>((done) => {
          setTimeout(done, 150);
          requestAnimationFrame(() => requestAnimationFrame(() => done()));
        }),
    );
  });
  const shots =
    portraits ??
    (await Promise.all(
      pages.map(async (p) => {
        const modal = p.locator("#hfit-room[open]");
        const area = (await modal.count()) ? modal : p.locator("body");
        if (p === desk) {
          const box = await area.boundingBox();
          assert.ok(box);
          const clip = {
            x: Math.round(box.x),
            y: Math.round(box.y),
            width: Math.floor(box.width),
            height: Math.floor(box.height),
          };
          return (await editor.capture(clip)).toString("base64");
        }
        return (await area.screenshot({ timeout: 120000 })).toString("base64");
      }),
    ));
  const bytes = await web.evaluate(
    async ({ shots, title, evidence }) => {
      const images = await Promise.all(
        shots.map(async (s) =>
          createImageBitmap(new Blob([Uint8Array.from(atob(s), (c) => c.charCodeAt(0))])),
        ),
      );
      const w = Math.max(...images.map((i) => i.width)),
        h = Math.max(...images.map((i) => Math.ceil((w * i.height) / i.width)));
      const canvas = document.createElement("canvas");
      canvas.width = 2 * w;
      canvas.height = h + 44 + (evidence.length ? 58 : 0);
      const c = canvas.getContext("2d");
      if (!c) throw new Error("Missing canvas context.");
      c.fillStyle = "#223632";
      c.fillRect(0, 0, canvas.width, canvas.height);
      c.fillStyle = "white";
      c.font = "20px sans-serif";
      images.forEach((img, i) => {
        c.drawImage(img, w * i, 44, w, (w * img.height) / img.width);
        c.fillText((i ? "Desktop" : "Browser") + "   ·   " + title, w * i + 14, 29);
        if (evidence[i]) c.fillText(evidence[i] ?? "", w * i + 14, h + 79, w - 28);
        img.close();
      });
      return canvas.toDataURL().split(",")[1] ?? "";
    },
    { shots, title, evidence },
  );
  const name =
    String(id).padStart(2, "0") +
    "-" +
    title
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replace(/-$/, "");
  writeFileSync(join(dir, name + ".png"), Buffer.from(bytes, "base64"));
  captures.push({ id, name });
  console.log("PASS", id, title);
}
async function launchAdult() {
  await web.locator("#openfile").setInputFiles(join(fixtures, "adult.form.json"));
  await web.waitForFunction(() =>
    document.querySelector("#status")?.textContent?.includes("Form opened"),
  );
  const old = await desk.inputValue("#document");
  await desk.selectOption("#start", "human-adult/preset/seed-491");
  await desk.waitForFunction(
    (old) =>
      document.querySelector<HTMLSelectElement>("#document")?.value !== old &&
      !document.querySelector("#viewport")?.hasAttribute("inert"),
    old,
    { timeout: 120000 },
  );
  await expand(desk, "#portrait-editor");
}
async function room() {
  await web.locator("#human-fit-open").evaluate((b: HTMLButtonElement) => b.click());
  await desk.getByRole("button", { name: "Fit 3D reference", exact: true }).click();
  await both((p) => p.locator("#hfit-room[open]").waitFor());
}
async function bodyChecks() {
  await capture(1, "Editable adult");
  await source("transformed-skinned.gltf");
  for (const p of pages)
    assert.match(await p.locator("#hfit-facts").innerText(), /2 (?:drawn )?meshes|meshes\s*2/i);
  await capture(2, "Choose local reference", "#hfit-facts");
  const file = readFileSync(join(fixtures, "cm.glb")).toString("base64");
  await both((p) =>
    p.locator("#hfit-stage").evaluate((stage, file) => {
      const d = new DataTransfer();
      d.items.add(new File([Uint8Array.from(atob(file), (c) => c.charCodeAt(0))], "dropped.glb"));
      stage.dispatchEvent(
        new DragEvent("drop", { dataTransfer: d, bubbles: true, cancelable: true }),
      );
    }, file),
  );
  await ready();
  await both((p) =>
    p.waitForFunction(() =>
      document.querySelector("#hfit-facts")?.textContent?.includes("dropped.glb"),
    ),
  );
  await capture(3, "Dropped reference", "#hfit-facts");
  for (const name of ["corrupt.glb", "empty.gltf", "nonfinite.glb", "draco.gltf"]) {
    await inputFile("file", join(fixtures, name));
    for (const p of pages) assert.match(await p.locator("#hfit-facts").innerText(), /dropped.glb/);
  }
  await inputFile("file", join(fixtures, "too-large.glb"));
  for (const p of pages) assert.match(await note(p), /750,000/);
  await capture(4, "Rejected oversized reference");
  for (const [i, key] of ["rest", "f1", "f2", "f3", "m1", "m2", "m3"].entries()) {
    await choose("source", "mhr-" + key);
    await ready();
    await action("run");
    for (const p of pages)
      assert.equal(await p.locator("#hfit-steps li").count(), 1, await note(p));
    await capture(5 + i, "MHR " + key + " fit", "#hfit-table");
  }
  await applySave("builtin-body");
  await room();
  await ready();
  for (const p of pages) assert.equal(await p.inputValue("#hfit-source"), "mhr-m3");
  await capture(12, "Reopened linked model", "#hfit-facts");
  await action("run");
  await action("run");
  await action("undo");
  for (const p of pages) assert.equal(await p.locator("#hfit-steps li").count(), 1);
  await capture(13, "Undo one staged fit", "#hfit-steps");
  await action("reset");
  await both((p) => expand(p, "#hfit-alignment"));
  for (const [i, unit] of ["auto", "m", "cm", "mm", "in", "ft", "stature"].entries()) {
    await choose("units", "auto");
    await source(unit + ".glb");
    await choose("units", unit);
    await capture(14 + i, "Source units " + unit, "#hfit-units");
  }
  await choose("units", "m");
  await source("m.glb");
  for (const up of ["z", "y"]) await choose("up", up);
  for (const turn of ["0", "90", "180", "270", "0"]) await choose("turn", turn);
  await fill("nudge-x", "65");
  await fill("nudge-y", "30");
  await fill("nudge-z", "40");
  await capture(21, "Manual alignment", "#hfit-nudge-z");
  await check("match-stature", false);
  await check("match-arms", false);
  await capture(22, "Retain stature and rest pose", "#hfit-match-arms");
  await fill("nudge-x", "0");
  await fill("nudge-y", "0");
  await fill("nudge-z", "0");
  await check("match-stature", true);
  await check("match-arms", true);
  await action("run");
  for (const [i, m] of ["side", "wipe", "overlay", "deviation"].entries()) {
    await both((p) => p.click('#hfit-views [data-view="' + m + '"]'));
    if (m === "wipe" || m === "overlay")
      await both((p) =>
        p.locator(m === "wipe" ? "#hfit-wipe" : "#hfit-opacity").press("ArrowRight"),
      );
    await check("original", true);
    await check("original", false);
    await capture(23 + i, "Comparison " + m);
  }
  for (const f of ["whole", "trunk", "arms", "legs", "head"]) await choose("frame", f);
  for (const angle of ["0", "1.5708", "3.1416", "0.62"])
    await both((p) => p.click('#hfit-angles [data-angle="' + angle + '"]'));
  await capture(27, "Frame and turn head");
  await capture(28, "Regional distance and bias", "#hfit-table");
  await action("view-score");
  for (const p of pages) assert.match(await p.locator("#hfit-view-reading").innerText(), /depth/);
  await capture(29, "Camera view measurement", "#hfit-view-reading");
  await action("reset");
  for (const [i, region] of ["whole", "head", "trunk", "arms", "legs"].entries()) {
    await choose("region", region);
    await check("measure", true);
    await action("run");
    await check("measure", false);
    await action("run");
    for (const p of pages)
      assert.equal(await p.locator("#hfit-steps li").count(), 2, await note(p));
    await capture(30 + i, "Fit " + region + " region", "#hfit-steps");
    await action("reset");
  }
}
async function headClick(p: Page, pane: 0 | 1, x: number, y: number, height: number) {
  const canvas = p.locator("#hfit-canvas");
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  assert.ok(box);
  const extent = Math.max(0.174 * height, (0.142 * height * 2 * box.height) / box.width);
  await p.mouse.click(
    box.x + box.width * (0.25 + pane * 0.5) + (x * box.height) / extent,
    box.y + box.height * 0.5 - (y * box.height) / extent,
  );
}
async function front() {
  await choose("frame", "head");
  await both((p) => p.click('#hfit-angles [data-angle="0"]'));
}
async function heads() {
  await source("bust.glb");
  await choose("kind", "head");
  await front();
  await click("landmarks");
  await click("landmarks");
  await click("landmarks");
  for (const [x, y] of [
    [0.041, 0.017],
    [-0.041, 0.017],
    [0, -0.066],
  ] as const)
    for (const pane of [0, 1] as const) await both((p) => headClick(p, pane, x, y, 1.77));
  for (const p of pages)
    assert.match(await p.locator("#hfit-landmark-instruction").innerText(), /RMS/);
  await capture(35, "Three head landmarks", "#hfit-landmark-instruction");
  await check("measure", true);
  await check("contour", true);
  await check("eyes", true);
  await action("run");
  for (const p of pages) assert.equal(await p.locator("#hfit-steps li").count(), 1, await note(p));
  await capture(36, "Fit contours with protected eyes", "#hfit-steps");
  await click("mask");
  for (const [i, kind] of ["patch", "above", "below"].entries()) {
    await choose("mask-kind", kind);
    if (kind === "patch") await both((p) => p.locator("#hfit-mask-size").press("End"));
    await both((p) =>
      headClick(
        p,
        0,
        kind === "patch" ? 0.034 : 0,
        kind === "above" ? 0.058 : kind === "below" ? -0.056 : -0.014,
        1.77,
      ),
    );
    for (const p of pages) assert.equal(await p.isEnabled("#hfit-mask-undo"), true, await note(p));
    await capture(37 + i, "Hide " + kind, "#hfit-mask-reading");
    await click("mask-undo");
  }
  await choose("mask-kind", "patch");
  await both((p) => headClick(p, 0, 0.025, -0.019, 1.77));
  await click("mask-clear");
  await capture(40, "Show masked skin again", "#hfit-mask-reading");
  await click("mask");
  await click("feature");
  await check("feature-mirror", true);
  await both((p) => p.locator("#hfit-feature-reach").press("End"));
  await both((p) => headClick(p, 0, 0.022, -0.024, 1.77));
  await both((p) => headClick(p, 1, 0.014, -0.019, 1.77));
  for (const p of pages) assert.ok((await p.locator("#hfit-steps li").count()) > 0, await note(p));
  await capture(41, "Mirror a feature pull", "#hfit-feature-reading");
  await source("one-sided.glb");
  await front();
  await click("landmarks");
  for (const [x, y] of [
    [0.035, 0.012],
    [-0.035, 0.012],
    [0, -0.055],
  ] as const)
    for (const pane of [0, 1] as const) await both((p) => headClick(p, pane, x, y, 1.77));
  await check("measure", false);
  await action("run");
  for (const p of pages) assert.equal(await p.locator("#hfit-steps li").count(), 1, await note(p));
  await applySave("isolated-head");
}
async function markedChecks() {
  await choose("kind", "body");
  await choose("units", "auto");
  await source("m.glb");
  await front();
  await click("prop");
  const marks: unknown = JSON.parse(readFileSync(join(fixtures, "marks.json"), "utf8"));
  const data: unknown = Reflect.get(Object(marks), "proportions");
  const names = await web.locator("#hfit-prop-pick option").allTextContents();
  let i = 0;
  if (!data || typeof data !== "object") throw new Error("Missing proportion fixture coordinates.");
  for (const [key, pair] of Object.entries(data)) {
    await choose("prop-pick", key);
    assert.ok(Array.isArray(pair));
    for (const v of pair) {
      assert.ok(Array.isArray(v) && typeof v[0] === "number" && typeof v[1] === "number");
      await both((p) => headClick(p, 0, Number(v[0]), Number(v[1]) - 1.83 * 0.937, 1.83));
    }
    for (const p of pages)
      assert.equal(await p.locator("#hfit-prop-list tbody tr").count(), i + 1, await note(p));
    await capture(42 + i, "Mark " + names[i], "#hfit-prop-list");
    i++;
  }
  await both((p) => p.locator("#hfit-prop-list tbody tr").last().getByRole("button").click());
  await choose("prop-pick", "mouthWidth");
  for (const x of [-0.032, 0.032])
    await both((p) => headClick(p, 0, x, 1.633 - 1.83 * 0.937, 1.83));
  await both(async (p) => {
    const options = p.locator("#hfit-prop-controls input:checked");
    if ((await options.count()) > 1)
      await options.last().evaluate((box: HTMLInputElement) => box.click());
  });
  await action("prop-fit");
  for (const p of pages) assert.ok(await p.locator("#hfit-steps li").count(), await note(p));
  await capture(54, "Fit marked proportions together", "#hfit-prop-list");
  await click("prop");
}
async function snapshot(p: Page = desk) {
  const current = await callEditor(p, "current", { documentId: await p.inputValue("#document") });
  return String(Reflect.get(Object(current), "documentDigest"));
}
async function applySave(label: string) {
  const before = await snapshot();
  await click("apply");
  await both((p) => p.locator("#hfit-room").waitFor({ state: "hidden" }));
  const after = await snapshot();
  assert.notEqual(after, before);
  const savedWeb = web.waitForEvent("download");
  await web.locator("#save").evaluate((b: HTMLButtonElement) => b.click());
  const browserFile = join(work, label + ".form.json");
  await (await savedWeb).saveAs(browserFile);
  await web.locator("#openfile").setInputFiles(browserFile);
  await web.waitForFunction(() =>
    document.querySelector("#status")?.textContent?.includes("Form opened"),
  );
  await desk.click("#undo");
  await desk.waitForFunction(() => !document.querySelector("#viewport")?.hasAttribute("inert"));
  for (let i = 0; i < 80 && (await snapshot()) !== before; i++)
    await new Promise((done) => setTimeout(done, 50));
  assert.equal(await snapshot(), before);
  await desk.click("#redo");
  for (let i = 0; i < 80 && (await snapshot()) !== after; i++)
    await new Promise((done) => setTimeout(done, 50));
  assert.equal(await snapshot(), after);
  const file = join(work, label + ".irudd-character");
  await editor.answerDialogs({ save: file });
  await desk.click("#character-save");
  await desk.waitForFunction(
    (name) => document.querySelector("#status")?.textContent?.includes(name),
    label + ".irudd-character",
  );
  assert.ok(existsSync(file));
  const loaded = await launchEditor(
    electronExecutable(),
    ["--project", join(work, label + "-reopen"), "--create"],
    join(work, label + "-userdata"),
    appEnvironment({ IRUDD_STATE_DIR: join(work, label + "-state") }),
    errors,
    appDir,
  );
  try {
    await loaded.answerDialogs({ open: file });
    await loaded.page.click("#character-open");
    const id = await desk.inputValue("#document");
    await loaded.page.waitForFunction(
      (id) => document.querySelector<HTMLSelectElement>("#document")?.value === id,
      id,
    );
    assert.equal(await snapshot(loaded.page), after);
    console.log("Verified one History edit and fresh-project reload", label);
  } finally {
    await loaded.close();
  }
}
async function families() {
  await choose("kind", "body");
  await choose("units", "auto");
  await choose("source", "mhr-f1");
  await ready();
  await front();
  await both((p) => expand(p, "#hfit-family"));
  const familyNeutral = join(dir, "mhr-neutral.glb");
  assert.ok(
    existsSync(familyNeutral),
    "Prepare the MHR family neutral using scripts/family-transfer/build-neutral.py.",
  );
  await inputFile("family-file", familyNeutral);
  await action("family-run");
  for (const p of pages)
    assert.match(await p.locator("#hfit-family-reading").innerText(), /registered/);
  await capture(55, "Register neutral and fit member", "#hfit-family-reading");
  await source("bust.glb");
  for (const p of pages) assert.equal(await p.isDisabled("#hfit-family-run"), true);
  await capture(56, "Reject unrelated member", "#hfit-family-reading");
  await source("mhr-order.glb");
  await action("family-run");
  for (const p of pages) {
    assert.match(await note(p), /order|differently/);
    assert.equal(await p.locator("#hfit-steps li").count(), 0);
  }
  await choose("source", "mhr-f2");
  await ready();
  await check("family-measure", false);
  await check("family-detail", false);
  for (const p of pages) assert.equal(await p.isDisabled("#hfit-family-run"), true);
  for (const [i, [measure, detail]] of [
    [true, false],
    [false, true],
    [true, true],
  ].entries()) {
    await check("family-measure", Boolean(measure));
    await check("family-detail", Boolean(detail));
    await action("family-run");
    for (const p of pages) assert.match(await note(p), /matched points/);
    await capture(
      57 + i,
      ["Transfer measurements", "Transfer per vertex layer", "Transfer measurements and layer"][
        i
      ] ?? "Family",
      "#hfit-steps",
    );
    if (i < 2) await click("undo");
  }
  await click("family-clear");
  for (const p of pages) assert.equal(await p.isDisabled("#hfit-family-clear"), true);
  await capture(60, "Remove fine head layer", "#hfit-steps");
  await click("undo");
  await choose("region", "trunk");
  await action("run");
  for (const p of pages) assert.equal(await p.isEnabled("#hfit-family-clear"), true, await note(p));
  await front();
  await capture(61, "Keep transferred head on body fit", "#hfit-steps");
  await applySave("head-family");
}
async function studio() {
  await click("close");
  await web.click('[data-tab="sculpt"]');
  async function style(key: string, value: string) {
    await both(async (p) => {
      const field = p.locator((p === web ? "#adult-" : "#human-") + key);
      await openDetails(field);
      await field.selectOption(p === desk && key === "cast" && value === "None" ? "" : value, {
        timeout: 120000,
      });
    });
    await desk.waitForFunction(() => !document.querySelector("#viewport")?.hasAttribute("inert"));
  }
  async function visibleFrame() {
    await both((p) => p.evaluate(() => new Promise<void>((done) => setTimeout(done, 350))));
  }
  async function portraits(yaw: number, preset = false) {
    await web.locator('[data-mode="Color"]').click();
    await visibleFrame();
    return Promise.all(
      pages.map((p) =>
        p.evaluate(
          async ([h, y, a]) => {
            const encoded = window.shapeProbe.capture([0, y, 0], h, a);
            const bitmap = await createImageBitmap(
              new Blob([Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))]),
            );
            const canvas = document.createElement("canvas");
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const ctx = canvas.getContext("2d");
            if (!ctx) throw new Error("Cannot frame portrait");
            ctx.drawImage(bitmap, 0, 0);
            const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            let lo = canvas.width,
              hi = 0;
            for (let py = Math.floor(canvas.height * 0.3); py < canvas.height * 0.58; py += 4) {
              const bg = 4 * py * canvas.width;
              for (let x = 0; x < canvas.width; x += 3) {
                const at = bg + 4 * x;
                if (
                  [0, 1, 2].some((c) => Math.abs((pixels[at + c] ?? 0) - (pixels[c] ?? 0)) > 18)
                ) {
                  lo = Math.min(lo, x);
                  hi = Math.max(hi, x);
                }
              }
            }
            const center = hi > lo ? (lo + hi) / 2 : bitmap.width / 2;
            const scale = 640 / bitmap.height;
            canvas.width = canvas.height = 640;
            ctx.fillStyle =
              "rgb(" + [pixels[0] ?? 0, pixels[1] ?? 0, pixels[2] ?? 0].join(",") + ")";
            ctx.fillRect(0, 0, 640, 640);
            ctx.drawImage(bitmap, 320 - scale * center, 0, bitmap.width * scale, 640);
            bitmap.close();
            return canvas.toDataURL().split(",")[1] ?? "";
          },
          [preset ? 0.59 : 0.47, preset ? 1.53 : 1.63, yaw] as const,
        ),
      ),
    );
  }
  async function artwork(id: number, title: string, field: string, yaw = 0.26) {
    const labels = await Promise.all(
      pages.map(async (p) => {
        const c = p.locator((p === web ? "#adult-" : "#human-") + field);
        await openDetails(c);
        return c.evaluate(
          (s: HTMLSelectElement) =>
            (s.labels?.[0]?.firstChild?.textContent ?? "").trim() +
            " · " +
            (s.selectedOptions[0]?.textContent ?? ""),
        );
      }),
    );
    const shots = await portraits(yaw, id === 66);
    await capture(id, title, undefined, labels, shots);
    return shots;
  }
  await style("faceFamily", "Studio Rain");
  await web.selectOption("#human-group", "Face");
  await web.selectOption("#human-parameter", "jaw");
  await web.locator("#human-delta").press("End");
  await web.click("#human-apply");
  await web.locator("#human-delta").press("End");
  await web.click("#human-apply");
  await openDetails(desk.locator("#human-region"));
  await desk.selectOption("#human-region", "Face");
  await desk.selectOption("#human-axis", "jaw");
  await desk.locator("#human-measurement").press("End");
  await visibleFrame();
  await expand(desk, "#motion-editor");
  await desk.getByLabel("Expression", { exact: true }).selectOption("Smile");
  await desk.getByLabel("Expression strength", { exact: true }).press("End");
  await desk.getByLabel("Horizontal gaze", { exact: true }).press("End");
  await web.selectOption("#face-pose", "Smile");
  await web.locator("#face-pose-amount").press("End");
  await web.locator("#look-x").press("End");
  await artwork(62, "Choose Studio Rain", "faceFamily");
  await desk.getByLabel("Expression", { exact: true }).selectOption("Rest");
  await desk.getByRole("button", { name: "Centre gaze" }).click();
  await desk.locator("#motion-editor > summary").click();
  await web.selectOption("#face-pose", "Rest");
  await web.click("#look-center");
  await style("faceFamilyHair", "Family");
  for (const p of pages) assert.ok(await p.isDisabled(p === web ? "#adult-hair" : "#human-hair"));
  await artwork(63, "Family ribbon ponytail", "faceFamilyHair", 2.35);
  await style("faceFamilyHair", "Chosen");
  await style("hair", "Ribbon ponytail");
  for (const field of ["hat", "eyewear", "earrings"]) {
    const v = await web
      .locator("#adult-" + field + " option")
      .evaluateAll((opts) =>
        opts
          .map((o) => o.getAttribute("value") ?? o.textContent ?? "")
          .find((s) => s && s !== "None"),
      );
    if (v) await style(field, v);
  }
  await artwork(64, "Chosen hair and accessories", "hair");
  await style("faceFamily", "None");
  await artwork(65, "Restore native face and styling", "faceFamily");
  await style("cast", "Gardener");
  assert.ok(await web.isDisabled("#adult-faceFamily"));
  assert.equal(await desk.locator("#human-faceFamily:enabled").count(), 0);
  await style("cast", "None");
  const saved = join(work, "studio.glb");
  async function exportGlb() {
    const dl = web.waitForEvent("download", { timeout: 180000 });
    await web.locator("#glb").evaluate((b: HTMLButtonElement) => b.click());
    await (await dl).saveAs(saved);
    await desk.click("#export");
    await desk.waitForFunction(
      () => document.querySelector("#status")?.textContent?.startsWith("Exported"),
      null,
      { timeout: 180000 },
    );
    const exportsDir = join(work, "study", "exports");
    const glbs = readdirSync(exportsDir)
      .filter((f) => f.endsWith(".glb"))
      .sort(
        (a, b) => statSync(join(exportsDir, a)).mtimeMs - statSync(join(exportsDir, b)).mtimeMs,
      );
    assert.ok(glbs.length);
    const credits: string[] = [];
    for (const f of [saved, join(exportsDir, glbs.at(-1) ?? "")]) {
      const data = readFileSync(f),
        header = data.toString("utf8", 20, 20 + data.readUInt32LE(12));
      assert.match(header, /Blender Foundation/i);
      assert.match(header, /CC BY|creativecommons.org/i);
      credits.push(
        "Exported GLB · Rain Rig · " +
          (header.match(/Blender Foundation/i)?.[0] ?? "") +
          " · CC BY 4.0",
      );
    }
    return credits;
  }
  await exportGlb();
  await desk.click("#tab-workshop");
  await web.click('[data-tab="sculpt"]');
  const clothing = "Hoodie and joggers";
  await style("outfit", clothing);
  await both(async (p) => {
    const preset = p.getByRole("button", {
      name: "Start a Studio Rain person",
      includeHidden: true,
    });
    await openDetails(preset);
    await preset.click();
  });
  for (const p of pages)
    assert.equal(await p.inputValue(p === web ? "#adult-outfit" : "#human-outfit"), clothing);
  const shots = await artwork(66, "Start a Studio Rain person", "faceFamily");
  const credits = await exportGlb();
  await capture(67, "Export studio artwork attribution", undefined, credits, shots);
}
async function sheet() {
  const run = process.env["IRUDD_REFERENCE_RUN"];
  if (run) writeFileSync(join(run, requested + ".txt"), captures.map((x) => x.name).join("\n"));
  const full = !!run && requested === "studio";
  const names = full
    ? stages.flatMap((stage) =>
        readFileSync(join(run, stage + ".txt"), "utf8")
          .trim()
          .split("\n"),
      )
    : captures.map((x) => x.name);
  if (full) {
    assert.deepEqual(
      names.map((n) => Number(n.slice(0, 2))).sort((a, b) => a - b),
      Array.from({ length: 67 }, (_, i) => i + 1),
    );
  }
  const all = names.map((name) => ({
    name,
    image: readFileSync(join(dir, name + ".png")).toString("base64"),
  }));
  if (all.length)
    await contactSheet(
      web,
      dir,
      all,
      1,
      full ? "contact-sheet.png" : "contact-" + requested + ".png",
      4,
    );
}
try {
  if (requested === "studio") {
    const outDir = join(work, "probe");
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
        outDir,
      },
    });
    const script = readFileSync(join(outDir, "probe.js"), "utf8");
    await both((p) => p.addInitScript(script));
    await desk.reload();
  }
  await desk.setViewportSize({ width: 1440, height: 950 });
  await web.goto(url);
  await launchAdult();
  await room();
  for (const p of pages) {
    const gpu = await p.locator("#hfit-canvas").evaluate((c: HTMLCanvasElement) => {
      const gl = c.getContext("webgl2");
      const ext = gl?.getExtension("WEBGL_debug_renderer_info");
      if (!gl || !ext) throw new Error("Missing hardware WebGL2");
      return String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
    });
    assert.doesNotMatch(gpu, /swiftshader|software|llvmpipe|warp/i);
    console.log("Renderer", gpu);
  }
  const suite = process.argv[2] ?? "all";
  if (suite === "all" || suite === "body") await bodyChecks();
  if (suite === "all" || suite === "head") await heads();
  if (suite === "all" || suite === "marks") {
    await both((p) => expand(p, "#hfit-alignment"));
    await markedChecks();
  }
  if (suite === "all" || suite === "family") {
    await both((p) => expand(p, "#hfit-alignment"));
    await families();
  }
  if (suite === "all" || suite === "studio") {
    if (!(await desk.locator("#hfit-room[open]").count())) await room();
    await studio();
  }
  await sheet();
  assert.deepEqual(errors, []);
} finally {
  await editor.close();
  await browser.close();
  server.kill();
  rmSync(work, { recursive: true, force: true });
}
