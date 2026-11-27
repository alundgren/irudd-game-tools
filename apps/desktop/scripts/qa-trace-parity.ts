import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { connect } from "@irudd/workshop/client";
import { chromium, type Locator, type Page } from "@playwright/test";
import { appDir, appEnvironment, electronExecutable } from "./electron.js";
import { launchEditor, callEditor } from "./editor-session.js";
import { hardwareRenderer, viewportScreenshot } from "./display-check.js";
import { contactSheet } from "./contact-sheet.js";
import { openDetails } from "./qa-field-parity.js";

const root = resolve(appDir, "../.."),
  output = join(root, ".reference-cache/phase9-6");
mkdirSync(output, { recursive: true });
const stage = process.argv[2] ?? "all";
const temp = mkdtempSync(join(tmpdir(), "trace-parity-"));
const server = spawn(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    `import {workshopServer} from "./scripts/workshop.mjs"; import {readFileSync} from "node:fs";const server=workshopServer(readFileSync("dist/character-view.html","utf8").replace("<head>",'<head><meta name="workshop-agent" content="local">'));server.listen(0,"127.0.0.1",()=>console.log("http://127.0.0.1:"+server.address().port+"/"));`,
  ],
  { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
);
const url = await new Promise<string>((resolve, reject) => {
  server.stdout.on("data", (b: Buffer) => {
    const match = b.toString().match(/http:\/\/127\.0\.0\.1:\d+\//);
    if (match) resolve(match[0]);
  });
  server.once("error", reject);
  server.once("exit", (code) => reject(new Error("Workshop exit " + code)));
});
const browser = await chromium.launch({ channel: "chrome", args: ["--use-angle=default"] });
const web = await browser.newPage({ viewport: { width: 1340, height: 920 } });
const errors: string[] = [];
const editor = await launchEditor(
  electronExecutable(),
  [
    ...(stage === "compare" ? ["--study", "mhr-torso"] : []),
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
const webTrace = web.locator("#trace-dialog"),
  deskTrace = desk.locator("#portrait-dialog");
web.setDefaultTimeout(45000);
desk.setDefaultTimeout(45000);
async function shown(page: Page, area: Locator, focus: Locator) {
  await focus.scrollIntoViewIfNeeded();
  const box = await area.boundingBox();
  assert.ok(box);
  const size = page.viewportSize();
  assert.ok(size);
  const x = Math.max(0, box.x),
    y = Math.max(0, box.y);
  return page.screenshot({
    clip: {
      x,
      y,
      width: Math.min(box.x + box.width, size.width) - x,
      height: Math.min(box.y + box.height, size.height) - y,
    },
  });
}
async function capture(name: string, left?: Locator | Buffer, right?: Locator) {
  const a = Buffer.isBuffer(left)
    ? left
    : left
      ? await left.screenshot()
      : await web.locator("#viewport").screenshot();
  let b: Buffer;
  if (right) {
    await right.evaluate((el) => el.scrollIntoView({ block: "center" }));
    const rect = await right.boundingBox();
    assert.ok(rect);
    const viewport = await desk.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    const x = Math.max(0, Math.floor(rect.x)),
      y = Math.max(0, Math.floor(rect.y));
    const bounds = {
      x,
      y,
      width: Math.min(Math.ceil(rect.width), viewport.w - x),
      height: Math.min(Math.ceil(rect.height), viewport.h - y),
    };
    await editor.capture(bounds);
    b = await editor.capture(bounds);
  } else b = await viewportScreenshot(desk);
  await contactSheet(
    web,
    output,
    [
      { name: "Browser | " + name.slice(3), image: a.toString("base64") },
      { name: "Desktop | " + name.slice(3), image: b.toString("base64") },
    ],
    2,
    name + ".png",
    2,
    { width: 560, height: 440 },
  );
  console.log("Captured", name);
}
async function clickAt(
  page: Page,
  canvas: Locator,
  points: readonly (readonly [number, number])[],
) {
  await canvas.scrollIntoViewIfNeeded();
  const b = await canvas.boundingBox();
  assert.ok(b);
  for (const [x, y] of points) await page.mouse.click(b.x + x * b.width, b.y + y * b.height);
}
async function trace(adding = false, atlas = "courier") {
  await web.click("[data-tab=files]");
  await web.click("#trace-open");
  await openDetails(desk.locator("#portrait-actions"));
  await desk
    .getByRole("button", {
      name: adding ? "Trace another region" : "Trace a new character",
      exact: true,
    })
    .click();
  await web.selectOption("#trace-art", atlas);
  await web.selectOption("#trace-method", "sweep");
  await desk.getByLabel("Registered turnaround").selectOption({ label: atlas });
  await desk.getByLabel("Front outline marks").waitFor();
  if (adding) await web.selectOption("#trace-mode", "add");
}
async function hover(y: number) {
  for (const [page, canvas] of [
    [web, webTrace.locator("canvas").nth(1)],
    [desk, desk.getByLabel("Profile outline marks")],
  ] as const) {
    const b = await canvas.boundingBox();
    assert.ok(b);
    await page.mouse.move(b.x + 0.7 * b.width, b.y + y * b.height);
  }
}
async function refused(pattern: RegExp) {
  await web.click("#trace-add");
  await desk.click("#portrait-apply");
  await desk.waitForFunction(() => !!document.querySelector("#portrait-status")?.textContent);
  assert.match(await web.innerText("#trace-feedback"), pattern);
  assert.match(await desk.innerText("#portrait-status"), pattern);
}
async function points(view: 0 | 1, marks: readonly (readonly [number, number])[]) {
  await clickAt(web, webTrace.locator("canvas").nth(view), marks);
  await clickAt(
    desk,
    desk.getByLabel((view === 0 ? "Front" : "Profile") + " outline marks"),
    marks,
  );
}
async function apply() {
  await web.click("#trace-add");
  await desk.click("#portrait-apply");
  await webTrace.waitFor({ state: "hidden" });
  await deskTrace.waitFor({ state: "hidden" });
  await colour();
}
async function colour() {
  await web.click('[data-mode="Color"]');
  await web.click('[data-angle="3/4"]');
  await desk.click("#camera-threequarter");
}
async function name(label: string) {
  await web.fill("#trace-name", label);
  await desk.getByLabel("Region name").fill(label);
}
async function docState() {
  return callEditor(desk, "current", { documentId: await desk.inputValue("#document") });
}
async function closed() {
  await desk.waitForFunction(
    () =>
      !document.querySelector<HTMLDialogElement>("#portrait-dialog")?.open ||
      !!document.querySelector("#portrait-status")?.textContent,
  );
  assert.equal(await desk.innerText("#portrait-status"), "");
  await webTrace.waitFor({ state: "hidden" });
  await deskTrace.waitFor({ state: "hidden" });
}
const saved: { id: string; file: string; digest: string }[] = [];
async function save(name: string) {
  const id = await desk.inputValue("#document"),
    file = join(temp, name + ".irudd-character");
  const state = await docState();
  const digest: unknown = Reflect.get(Object(state), "documentDigest");
  assert.equal(typeof digest, "string");
  await editor.answerDialogs({ save: file });
  await desk.click("#character-save");
  await desk.waitForFunction(
    (name) => document.querySelector("#status")?.textContent?.includes(name + ".irudd-character"),
    name,
  );
  saved.push({ id, file, digest: String(digest) });
}
async function historyEdit(action: () => Promise<void>) {
  const before = await docState(),
    previous: unknown = Reflect.get(Object(before), "documentDigest");
  const revision = Number(Reflect.get(Object(before), "revision"));
  await action();
  const after = await docState(),
    expected: unknown = Reflect.get(Object(after), "documentDigest");
  assert.equal(Reflect.get(Object(after), "revision"), revision + 1);
  assert.notEqual(expected, previous);
  for (const [id, digest] of [
    ["undo", previous],
    ["redo", expected],
  ] as const) {
    await desk.click("#" + id);
    await desk.waitForFunction(
      (r) =>
        document
          .querySelector<HTMLSelectElement>("#document")
          ?.selectedOptions[0]?.textContent?.endsWith("r" + r),
      id === "undo" ? revision + 2 : revision + 3,
    );
    assert.equal(Reflect.get(Object(await docState()), "documentDigest"), digest);
  }
}
const map = {
  format: "irudd.trace-map.v1",
  height: 1.75,
  regions: [
    { id: "Body", method: "loft", front: [], side: [] },
    {
      id: "Crest",
      parent: "Body",
      method: "path",
      spine: [
        [0.48, 0.18, 0.5, 0.18, 0.04, 0.04],
        [0.5, 0.13, 0.52, 0.13, 0.03, 0.03],
        [0.54, 0.1, 0.54, 0.1, 0.02, 0.02],
        [0.58, 0.08, 0.55, 0.08, 0.01, 0.01],
      ],
    },
  ],
} as const;

try {
  await web.goto(url + "#form=feline-worker", { waitUntil: "domcontentloaded", timeout: 120000 });
  await web.locator("#target option[value=muzzle]").waitFor({ state: "attached" });
  if (stage === "compare") {
    assert.equal(await desk.inputValue("#study-choice"), "study.mhr-torso");
    assert.match(JSON.stringify(await docState()), /radialFit/);
  } else await desk.selectOption("#start", "feline-worker");
  await desk.locator('#outliner [data-part="p-body"]').waitFor({ state: "attached" });
  const gpu = await hardwareRenderer(desk);
  console.log("Desktop hardware", gpu);
  const webGpu = await web.locator("#viewport").evaluate((el) => {
    const gl = el instanceof HTMLCanvasElement && el.getContext("webgl2");
    const e = gl && gl.getExtension("WEBGL_debug_renderer_info");
    return gl && e ? String(gl.getParameter(e.UNMASKED_RENDERER_WEBGL)) : "";
  });
  assert.ok(webGpu);
  assert.doesNotMatch(webGpu, /swiftshader|software|llvmpipe|warp/i);
  console.log("Browser hardware", webGpu);
  if (stage === "all" || stage === "compare") {
    await web.goto(url + "#study=mhr-torso");
    await web.click("[data-tab=files]");
    await web.waitForFunction(
      () => document.querySelector<HTMLSelectElement>("#studies")?.value === "mhr-torso",
    );
    await openDetails(desk.locator("#study-choice"));
    const right = desk.context().waitForEvent("page");
    await desk.click("#study-rig");
    const rig = await right;
    const left = web.context().waitForEvent("page");
    await web.locator('a[href="#compare-mhr"]').click();
    const browserRig = await left;
    try {
      for (const page of [rig, browserRig]) {
        await page
          .locator("#result")
          .filter({ hasText: "mean radial error" })
          .waitFor({ timeout: 90000 });
        await page.click("#oblique");
      }
      const stage = await rig.locator("#stage").boundingBox();
      assert.ok(stage);
      const rect = {
        x: Math.floor(stage.x),
        y: Math.floor(stage.y),
        width: Math.ceil(stage.width),
        height: Math.ceil(stage.height),
      };
      await editor.capture(rect, "/renderer/rig-study.html");
      const compare = [
        {
          name: "Browser",
          image: (await browserRig.locator("#stage").screenshot()).toString("base64"),
        },
        {
          name: "Desktop",
          image: (await editor.capture(rect, "/renderer/rig-study.html")).toString("base64"),
        },
      ];
      await contactSheet(web, output, compare, 2, "19-rig-comparison.png", 2, {
        width: 710,
        height: 410,
      });
      const id = await desk.inputValue("#document");
      await rig.locator("#editor").dispatchEvent("click");
      await desk.waitForFunction(
        (id) => document.querySelector<HTMLSelectElement>("#document")?.value !== id,
        id,
      );
      assert.match(JSON.stringify(await docState()), /radialFit/);
    } finally {
      await browserRig.close();
      if (!rig.isClosed()) await rig.close();
    }
  }
  if (stage === "all" || stage === "launch") {
    const launched = await launchEditor(
      electronExecutable(),
      [
        "--study",
        "mhr-f1",
        "--compare",
        "3d",
        "--project",
        join(temp, "launch"),
        "--create",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
      ],
      join(temp, "launch-user"),
      appEnvironment({ IRUDD_STATE_DIR: join(temp, "launch-state") }),
      errors,
      appDir,
    );
    try {
      await web.goto(url + "#study=mhr-f1&compare=3d", { waitUntil: "load" });
      await web.reload();
      for (const page of [web, launched.page])
        await page.waitForFunction(
          () =>
            document.querySelector<HTMLSelectElement>("#hfit-source")?.value === "mhr-f1" &&
            !!document.querySelector("#hfit-facts")?.textContent?.includes("female-typical 1"),
          undefined,
          { timeout: 90000 },
        );
      assert.equal(await launched.page.inputValue("#study-choice"), "study.mhr-f1");
      const stage = await launched.page.locator("#hfit-stage").boundingBox();
      assert.ok(stage);
      const rect = {
        x: Math.max(0, Math.floor(stage.x)),
        y: Math.max(0, Math.floor(stage.y)),
        width: Math.ceil(stage.width),
        height: Math.ceil(stage.height),
      };
      await launched.capture(rect);
      const shots = [
        {
          name: "Browser | launch study with 3D comparison",
          image: (await web.locator("#hfit-stage").screenshot()).toString("base64"),
        },
        {
          name: "Desktop | launch study with 3D comparison",
          image: (await launched.capture(rect)).toString("base64"),
        },
      ];
      await contactSheet(web, output, shots, 2, "34-launch-study-comparison.png", 2, {
        width: 560,
        height: 440,
      });
      console.log("Captured 34-launch-study-comparison");
      await web.click("#hfit-close");
      await web.locator("#hfit-room").waitFor({ state: "hidden" });
    } finally {
      await launched.close();
    }
  }
  if (stage === "optional") {
    await web.click("[data-tab=files]");
    await openDetails(desk.locator("#study-choice"));
    assert.equal(await web.locator('#studies option[value^="scan-"]').count(), 0);
    assert.equal(await desk.locator('#study-choice option[value^="scan-"]').count(), 0);
    assert.equal(await desk.locator("#study-rig").isHidden(), true);
    assert.equal(await web.locator('a[href="#compare-mhr"]').count(), 0);
    await web.selectOption("#studies", "ranger");
    await web.click("#study");
    await desk.selectOption("#study-choice", "study.ranger");
    await desk.click("#open-study");
    await desk.waitForFunction(() =>
      document.querySelector<HTMLSelectElement>("#document")?.value.includes("studyranger"),
    );
    await web.click('[data-mode="Color"]');
    await capture("26-without-private-studies");
  }
  if (stage === "all" || stage === "catalogue") {
    const ids = await web
      .locator("#studies option")
      .evaluateAll((opts) => opts.map((o) => o.getAttribute("value") ?? ""));
    await openDetails(desk.locator("#study-choice"));
    const actual = await desk
      .locator("#study-choice > option")
      .evaluateAll((opts) =>
        opts.map((o) => (o.getAttribute("value") ?? "").replace(/^study\./, "")),
      );
    assert.deepEqual(actual, ids);
    for (const id of ids) {
      await web.click("[data-tab=files]");
      await web.selectOption("#studies", id);
      await web.click("#study");
      const old = await desk.inputValue("#document");
      await desk.selectOption("#study-choice", id.startsWith("scan-") ? id : "study." + id);
      await desk.click("#open-study");
      await desk.waitForFunction(
        (old) =>
          document.querySelector<HTMLSelectElement>("#document")?.value !== old ||
          document.querySelector("#banner")?.textContent?.startsWith("Could not start"),
        old,
      );
      assert.notEqual(await desk.inputValue("#document"), old, await desk.innerText("#banner"));
      await desk.waitForFunction(() => document.querySelector("#start")?.matches(":enabled"));
      assert.doesNotMatch(await desk.innerText("#banner"), /could not|failed|unsupported/i, id);
      await desk.locator("#viewport").waitFor();
      await desk.evaluate(
        () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
      );
      assert.deepEqual(errors, [], id);
      console.log("Opened", id);
      const shot = {
        "salt-road-warden": "18-study-catalogue",
        "mhr-f1": "35-editable-mhr-fit",
        "lee-perry-smith": "36-head-scan-study",
      }[id];
      if (shot) await capture(shot);
    }
  }
  if (stage === "all" || stage === "scans") {
    for (const [i, id] of ["f01", "f03", "f08", "m04", "m08", "m09"].entries()) {
      await web.click("[data-tab=files]");
      await web.selectOption("#studies", "scan-" + id);
      await openDetails(desk.locator("#study-choice"));
      await desk.selectOption("#study-choice", "scan-" + id);
      const source = await web.getAttribute("#study-source", "href");
      assert.ok(source);
      assert.equal(await desk.getAttribute("#study-source", "href"), source);
      await web.click("#study");
      await web.click('[data-mode="Color"]');
      const current = await desk.inputValue("#document");
      await desk.click("#open-study");
      await desk.waitForFunction(
        (old) => document.querySelector<HTMLSelectElement>("#document")?.value !== old,
        current,
      );
      await desk.locator('#outliner [data-part="p-body"]').waitFor({ state: "attached" });
      const state = JSON.stringify(await docState());
      assert.ok(state.includes("sectionProfile"));
      await capture(String(20 + i) + "-scan-" + id);
    }
  }
  if (stage === "all" || stage === "trace") {
    await trace();
    await name("Courier");
    await capture(
      "01-registered-turnaround",
      webTrace.locator(".trace-guides"),
      deskTrace.locator(".trace-guides"),
    );
    const front = [
        [0.42, 0.2],
        [0.58, 0.2],
        [0.58, 0.53],
        [0.42, 0.53],
      ] as const,
      side = [
        [0.44, 0.2],
        [0.55, 0.2],
        [0.55, 0.53],
        [0.44, 0.53],
      ] as const;
    await points(0, front);
    await points(1, side);
    await hover(0.36);
    await capture(
      "02-paired-outlines",
      webTrace.locator(".trace-guides"),
      deskTrace.locator(".trace-guides"),
    );
    await web.click("#trace-undo");
    await desk.getByRole("button", { name: "Undo point" }).click();
    await capture(
      "03-correct-outline",
      webTrace.locator(".trace-guides"),
      deskTrace.locator(".trace-guides"),
    );
    await web.click("#trace-clear");
    await desk.getByRole("button", { name: "Clear outlines" }).click();
    await points(0, front.slice(0, 2));
    await refused(/three points/);
    await capture("27-open-outline-refused", webTrace, deskTrace);
    await web.click("#trace-clear");
    await desk.getByRole("button", { name: "Clear outlines" }).click();
    await points(0, front);
    await points(1, side);
    await web.fill("#trace-height", "7");
    await desk.getByLabel("Subject height (m)").fill("7");
    await refused(/height between 0\.15 and 6/);
    await capture("28-height-refused", webTrace, deskTrace);
    await web.fill("#trace-height", "1.75");
    await desk.getByLabel("Subject height (m)").fill("1.75");
    await apply();
    await capture("04-rounded-loft");
    await save("Rounded loft");
    for (const [webMethod, desktopMethod, number] of [
      ["volume", "hull", "05-solid-hull"],
      ["same", "membrane", "06-same-direction"],
      ["opposite", "membrane", "07-opposite-direction"],
      ["path", "path", "08-centreline"],
    ] as const) {
      await trace();
      await name(number.slice(3));
      await web.selectOption("#trace-method", webMethod);
      await desk.getByLabel("Region shape").selectOption(desktopMethod);
      if (desktopMethod === "membrane")
        await desk.getByLabel("Matching edges").selectOption(webMethod);
      if (desktopMethod === "path") {
        await web.fill("#trace-radius", "9");
        await desk.getByLabel("Root radius as % of height").fill("9");
        const line = [
          [0.48, 0.2],
          [0.55, 0.28],
          [0.49, 0.37],
          [0.57, 0.46],
        ] as const;
        await points(0, line);
        await points(1, line.slice(0, 2));
        await web.click("#trace-add");
        await desk.click("#portrait-apply");
        assert.match(await web.innerText("#trace-feedback"), /points/);
        assert.match(await desk.innerText("#portrait-status"), /points/);
        await capture("09-unmatched-points", webTrace, deskTrace);
        await points(1, line.slice(2));
      } else {
        await points(0, front);
        await points(1, side);
      }
      await apply();
      await capture(number);
      await save(number.slice(3));
    }
    await trace();
    await name("Whole silhouette");
    await apply();
    await capture("30-full-silhouette");
    await save("Whole silhouette");
    await trace();
    const sheet = join(root, "character-view/trader.atlas.webp");
    await web.locator("#trace-file").setInputFiles(sheet);
    await desk.getByLabel("Import artwork").setInputFiles(sheet);
    await web.locator("#trace-feedback", { hasText: "Turnaround ready." }).waitFor();
    await desk.locator("#portrait-dialog p", { hasText: "Turnaround ready." }).waitFor();
    assert.match(await web.locator("#trace-art option:checked").innerText(), /^Imported art/);
    assert.match(
      await desk.getByLabel("Registered turnaround").locator("option:checked").innerText(),
      /^Imported art/,
    );
    await name("Imported trader");
    await points(0, [
      [0.4, 0.15],
      [0.6, 0.15],
      [0.6, 0.6],
      [0.4, 0.6],
    ]);
    await points(1, [
      [0.42, 0.15],
      [0.58, 0.15],
      [0.58, 0.6],
      [0.42, 0.6],
    ]);
    await capture(
      "29-imported-artwork",
      webTrace.locator(".trace-guides"),
      deskTrace.locator(".trace-guides"),
    );
    await apply();
    await save("Imported trader");
  }
  if (stage === "all" || stage === "details") {
    await trace(false, "foremanPortrait");
    await name("Portrait");
    await apply();
    const root = desk.locator('#outliner [data-part="p-traced-body"]');
    await root.click();
    await web.selectOption("#target", "Portrait");
    await trace(true, "foremanPortrait");
    await web.click("#trace-face");
    await desk.getByLabel("Region shape").selectOption("face");
    await points(0, [
      [0.4, 0.39],
      [0.58, 0.39],
      [0.5, 0.51],
      [0.5, 0.61],
      [0.5, 0.72],
    ]);
    await capture(
      "11-five-landmarks",
      webTrace.locator(".trace-guides"),
      deskTrace.locator(".trace-guides"),
    );
    await historyEdit(async () => {
      await web.click("#trace-face-apply");
      await desk.click("#portrait-apply");
      await closed();
    });
    await save("Landmarks");
    await root.click();
    await trace(true, "foremanPortrait");
    await web.click("#trace-depth");
    await desk.getByLabel("Region shape").selectOption("depth");
    await points(0, [[0.5, 0.53]]);
    await points(1, [[0.35, 0.53]]);
    await web.fill("#trace-depth-radius", "17");
    await desk.getByLabel("Depth influence as % of height").fill("17");
    await capture(
      "12-paired-depth",
      webTrace.locator(".trace-guides"),
      deskTrace.locator(".trace-guides"),
    );
    await historyEdit(async () => {
      await web.click("#trace-depth-apply");
      await desk.click("#portrait-apply");
      await closed();
    });
    await save("Depth");
    await root.click();
    await trace(true);
    await name("Portrait");
    await points(0, [
      [0.4, 0.25],
      [0.59, 0.25],
      [0.57, 0.5],
      [0.43, 0.5],
    ]);
    await points(1, [
      [0.43, 0.25],
      [0.57, 0.25],
      [0.55, 0.5],
      [0.43, 0.5],
    ]);
    await historyEdit(apply);
    assert.match(JSON.stringify(await docState()), /Portrait 2/);
    await capture("10-attached-region");
    await save("Attachment");
    await root.click();
    await web.selectOption("#target", "Portrait");
    await trace(true, "tidebell");
    await name("Crest");
    await web.selectOption("#trace-method", "path");
    await desk.getByLabel("Region shape").selectOption("path");
    await web.fill("#trace-radius", "6");
    await desk.getByLabel("Root radius as % of height").fill("6");
    const crest = [
      [0.5, 0.2],
      [0.62, 0.12],
      [0.75, 0.08],
      [0.88, 0.07],
    ] as const;
    await points(0, crest);
    await points(1, crest);
    await historyEdit(apply);
    assert.match(JSON.stringify(await docState()), /"label":"Crest"/);
    await capture("31-attached-centreline");
    await save("Attached centreline");
    await web.click("[data-tab=files]");
    await openDetails(web.locator("#reuse-regions"));
    await web.selectOption("#reuse-source", "Crest");
    await web.selectOption("#reuse-regions", ["Portrait", "Portrait 2"]);
    await web.click("#reuse-apply");
    await web.locator("#status", { hasText: "same source sheet" }).waitFor();
    await root.click();
    await openDetails(desk.locator("#portrait-actions"));
    await desk.getByRole("button", { name: "Reuse turnaround", exact: true }).click();
    await desk.getByLabel("Existing sheet").selectOption({ label: "Crest" });
    const regions = desk.getByLabel("Regions to repaint");
    const portraits = await regions
      .locator("option")
      .evaluateAll((opts) =>
        opts
          .filter((o) => ["Portrait", "Portrait 2"].includes(o.textContent ?? ""))
          .map((o) => o.getAttribute("value") ?? ""),
      );
    assert.equal(portraits.length, 2);
    await regions.selectOption(portraits);
    await desk.click("#portrait-apply");
    await desk.locator("#portrait-status", { hasText: "same source sheet" }).waitFor();
    await capture(
      "32-mixed-sheets-refused",
      await shown(web, web.locator("aside"), web.locator("#status")),
      deskTrace,
    );
    await desk.click("#portrait-close");
    await deskTrace.waitFor({ state: "hidden" });
    await trace();
    await web.click("#trace-biped");
    await desk.getByLabel("Region shape").selectOption("biped");
    await desk.click("#portrait-apply");
    await closed();
    await capture("13-articulated-biped");
    await save("Biped");
    await trace();
    await desk.getByLabel("Region shape").selectOption("map");
    const partMap = {
      name: "map.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(map)),
    };
    await web.locator("#trace-map-file").setInputFiles(partMap);
    await desk.getByLabel("Part map", { exact: true }).setInputFiles(partMap);
    await desk.click("#portrait-apply");
    await closed();
    await capture("14-imported-map");
    await save("Part map");
  }
  if (stage === "all" || stage === "agent") {
    await desk.click("#agents details:not([open]) > summary");
    await desk.fill("#agents input", "trace-qa");
    await desk.click("#agents button:has-text('Pair')");
    await desk.waitForSelector("#agents p:has-text('Paired trace-qa')");
    const stateDir = join(temp, "state"),
      hosts = join(stateDir, "hosts");
    const file = readdirSync(hosts)
      .map((id) => join(hosts, id, "agents", "trace-qa.json"))
      .find(existsSync);
    assert.ok(file);
    await callEditor(desk, "recipient.bind", {
      agent: "trace-qa",
      route: { transport: "inbox", host: "claude-code", environment: "local" },
    });
    const author = await connect({
      credential: { role: "agent", file },
      client: { name: "trace-qa", version: "1" },
      stateDir,
    });
    try {
      await web.route("**/trace-map", (route) => route.fulfill({ json: map }));
      await trace();
      await desk.getByLabel("Region shape").selectOption("agent");
      const direction = "Articulate the painted crest";
      await web.fill("#trace-steering", direction);
      await desk.getByLabel("Agent steering (optional)").fill(direction);
      await web.click("#trace-agent-fit");
      await desk.click("#portrait-apply");
      await desk.waitForFunction(() =>
        document.querySelector("#portrait-fields")?.textContent?.includes("Waiting for the agent"),
      );
      let request = (await author.call("art.list", { all: true })).requests[0];
      for (let i = 0; !request && i < 600; i++) {
        await new Promise<void>((r) => setTimeout(r, 100));
        request = (await author.call("art.list", { all: true })).requests[0];
      }
      assert.ok(request);
      assert.equal(request.brief.direction, direction);
      assert.equal(request.brief.intent, "character");
      assert.equal(request.attachments.length, 3);
      await author.call("art.submit", {
        artId: request.artId,
        submissionId: "qa-trace-map",
        reply: {
          format: "irudd.art-reply",
          version: 1,
          kind: "trace",
          summary: "Articulated crest",
          traceMap: map,
        },
      });
      await closed();
      await colour();
      await capture("15-agent-fitted-map");
      await save("Agent map");
      let release = () => {};
      const held = new Promise<void>((done) => {
        release = done;
      });
      await web.unroute("**/trace-map");
      await web.route("**/trace-map", async (route) => {
        await held;
        await route.fulfill({ json: map }).catch(() => undefined);
      });
      const webForm = await web
        .locator("#target option")
        .evaluateAll((o) => o.map((e) => e.getAttribute("value")));
      const documents = await desk.locator("#document option").count();
      await trace();
      await desk.getByLabel("Region shape").selectOption("agent");
      await web.click("#trace-agent-fit");
      await desk.click("#portrait-apply");
      let pending = (await author.call("art.list", { all: true })).requests.find(
        (r) => r.artId !== request.artId,
      );
      for (let i = 0; !pending && i < 600; i++) {
        await new Promise<void>((r) => setTimeout(r, 100));
        pending = (await author.call("art.list", { all: true })).requests.find(
          (r) => r.artId !== request.artId,
        );
      }
      assert.ok(pending);
      await web.click("#trace-cancel");
      await desk.click("#portrait-close");
      release();
      await author
        .call("art.submit", {
          artId: pending.artId,
          submissionId: "qa-late-trace-map",
          reply: {
            format: "irudd.art-reply",
            version: 1,
            kind: "trace",
            summary: "Late crest",
            traceMap: map,
          },
        })
        .catch(() => undefined);
      await new Promise<void>((r) => setTimeout(r, 2000));
      assert.deepEqual(
        await web
          .locator("#target option")
          .evaluateAll((o) => o.map((e) => e.getAttribute("value"))),
        webForm,
      );
      assert.equal(await desk.locator("#document option").count(), documents);
      const settled = (await author.call("art.list", { all: true })).requests.find(
        (r) => r.artId === pending?.artId,
      );
      assert.equal(settled?.state, "cancelled");
      await capture("33-closed-agent-fit");
    } finally {
      author.close();
    }
  }
  if (stage === "all" || stage === "reuse") {
    await web.goto(url + "#form=festival-conductor");
    await web.locator("#target option[value=body]").waitFor({ state: "attached" });
    await desk.selectOption("#start", "festival-conductor");
    await desk.locator('#outliner [data-part="p-left-foot"]').waitFor();
    await web.click("[data-tab=files]");
    await openDetails(web.locator("#reuse-regions"));
    await openDetails(desk.locator("#portrait-actions"));
    await desk.getByRole("button", { name: "Reuse turnaround", exact: true }).click();
    await web.selectOption("#reuse-source", "body");
    await desk.getByLabel("Existing sheet").selectOption({ label: "body" });
    await web.selectOption("#reuse-regions", [
      "left foot",
      "left shin",
      "left thigh",
      "right foot",
      "right shin",
      "right thigh",
    ]);
    await desk
      .getByLabel("Regions to repaint")
      .selectOption([
        "p-left-foot",
        "p-left-shin",
        "p-left-thigh",
        "p-right-foot",
        "p-right-shin",
        "p-right-thigh",
      ]);
    await capture("16-reuse-selection", web.locator("#reuse-turnaround"), deskTrace);
    await historyEdit(async () => {
      await web.click("#reuse-apply");
      await desk.click("#portrait-apply");
      await deskTrace.waitFor({ state: "hidden" });
    });
    await web.click("[data-tab=sculpt]");
    await web.click('[data-mode="Color"]');
    await web.click('[data-angle="Front"]');
    await desk.click("#camera-front");
    await capture("17-repainted-regions");
    await save("Repainted");
  }
  for (const [i, item] of saved.entries()) {
    const next = await launchEditor(
      electronExecutable(),
      ["--project", join(temp, "reopen" + i), "--create"],
      join(temp, "profile" + i),
      appEnvironment({ IRUDD_STATE_DIR: join(temp, "new-state" + i) }),
      errors,
      appDir,
    );
    try {
      await next.answerDialogs({ open: item.file });
      await next.page.click("#character-open");
      await next.page.waitForFunction(
        (id) => document.querySelector<HTMLSelectElement>("#document")?.value === id,
        item.id,
      );
      const reread = await callEditor(next.page, "current", { documentId: item.id });
      assert.equal(Reflect.get(Object(reread), "documentDigest"), item.digest);
    } finally {
      await next.close();
    }
  }
  assert.deepEqual(errors, []);
} catch (error) {
  console.error(
    "Browser",
    await web.locator("#trace-feedback,#status").allTextContents(),
    "Desktop",
    await desk.locator("#portrait-status,#banner,#status").allTextContents(),
  );
  throw error;
} finally {
  const images = readdirSync(output)
    .filter((file) => /^\d\d-.*\.png$/.test(file))
    .sort()
    .map((file) => ({
      name: file.slice(0, -4),
      image: readFileSync(join(output, file)).toString("base64"),
    }));
  if (images.length)
    await contactSheet(web, output, images, 1, "contact-sheet.png", 2, { width: 750, height: 330 });
  await editor.close();
  await browser.close();
  server.kill();
  rmSync(temp, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
}
