import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launchEditor, callEditor } from "./editor-session.js";
import { type Page } from "@playwright/test";
import { loadHumanPacks, evaluateHuman } from "@irudd/character/human";
import { appDir, electronExecutable, appEnvironment } from "./electron.js";
import { viewportScreenshot, changedPixels, hardwareRenderer } from "./display-check.js";
import { portraitContactSheet } from "./contact-sheet.js";

const started = performance.now();
const root = resolve(appDir, "../.."),
  directory = join(root, ".reference-cache", "phase8b");
mkdirSync(directory, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "irudd-portraits-"));
const saved: { file: string; id: string; state: string }[] = [];
const problems: string[] = [];
async function launch(project: string) {
  return launchEditor(
    electronExecutable(),
    ["--project", join(work, project), "--create"],
    join(work, "user-" + project),
    appEnvironment({ IRUDD_STATE_DIR: join(work, "state-" + project) }),
    problems,
    resolve(appDir),
  );
}
let running = await launch("first");
let page = running.page;
async function ready(revision: number) {
  await page.waitForFunction(
    (n) =>
      new RegExp("revision " + n + "\\b").test(
        document.querySelector("#status-right")?.textContent ?? "",
      ) && !document.querySelector("#viewport")?.hasAttribute("inert"),
    revision,
    { timeout: 60000 },
  );
}
async function state(p: Page, id: string) {
  const result = await callEditor(p, "current", { documentId: id });
  const digest: unknown = Reflect.get(Object(result), "documentDigest");
  assert.equal(typeof digest, "string");
  return String(digest);
}
async function save(label: string) {
  const id = await page.inputValue("#document"),
    file = join(work, label + ".irudd-character");
  await running.answerDialogs({ save: file });
  await page.click("#character-save");
  await page.waitForFunction(
    (name) => document.querySelector("#status")?.textContent?.includes(name + ".irudd-character"),
    label,
  );
  saved.push({ file, id, state: await state(page, id) });
}
async function changeDoc(act: () => Promise<unknown>) {
  const old = await page.inputValue("#document");
  await act();
  await page.waitForFunction(
    (id) =>
      !!document.querySelector<HTMLSelectElement>("#document")?.value &&
      document.querySelector<HTMLSelectElement>("#document")?.value !== id,
    old,
  );
  await ready(1);
}
const fresh = (value: string) => changeDoc(() => page.selectOption("#start", value));
async function expand(id: string) {
  if (!(await page.locator(id).evaluate((n) => n.hasAttribute("open"))))
    await page.locator(id + " > summary").click();
}
async function select(id: string) {
  await page.locator('#outliner [data-part="' + id + '"]').click();
}
async function action(name: string) {
  await expand("#portrait-editor");
  await page.getByRole("button", { name, exact: true }).click();
}
async function marks(label: string, points: readonly (readonly [number, number])[]) {
  const canvas = page.getByLabel(label + " marks", { exact: true });
  await canvas.waitFor();
  await canvas.scrollIntoViewIfNeeded();
  const bounds = await canvas.boundingBox();
  assert.ok(bounds);
  for (const [x, y] of points)
    await page.mouse.click(bounds.x + bounds.width * x, bounds.y + bounds.height * y);
}
async function apply(at: number) {
  await page.click("#portrait-apply");
  await page.waitForFunction(
    () =>
      !document.querySelector<HTMLDialogElement>("#portrait-dialog")?.open ||
      !!document.querySelector("#portrait-status")?.textContent,
  );
  assert.equal(await page.textContent("#portrait-status"), "");
  await ready(at);
}
async function shot(name: string) {
  const bytes = await viewportScreenshot(page);
  writeFileSync(join(directory, name + ".png"), bytes);
  return bytes;
}
async function inspectionImage(selector: string, name: string) {
  const img = page.locator(selector).first();
  await img.waitFor({ timeout: 90000 });
  const png = await img.evaluate(async (node) => {
    if (!(node instanceof HTMLImageElement)) throw new Error("Missing inspection view.");
    await node.decode();
    const canvas = document.createElement("canvas");
    canvas.width = node.naturalWidth;
    canvas.height = node.naturalHeight;
    const g = canvas.getContext("2d");
    if (!g) throw new Error("Missing canvas.");
    g.drawImage(node, 0, 0);
    return canvas.toDataURL("image/png").split(",")[1] ?? "";
  });
  writeFileSync(join(directory, name + ".png"), Buffer.from(png, "base64"));
}
async function pair(name: string, act: () => Promise<void>) {
  console.log("Exercise " + name);
  const before = await shot(name + "-before");
  await act();
  const after = await shot(name + "-after"),
    n = await changedPixels(page, before, after);
  assert.ok(n > 250, name + " changed " + n + " pixels");
}
try {
  console.log("Portrait GPU", await hardwareRenderer(page));
  const body = await loadHumanPacks((file) =>
    readFileSync(join(root, "packages/character/assets/human", file)),
  );
  const points = evaluateHuman(body, { height: 1.46, weight: 1, frame: 1, muscle: 0.8 }).positions,
    vertices = [];
  for (let i = 0; i < points.length; i += 3)
    vertices.push("v " + Array.from(points.subarray(i, i + 3)).join(" "));
  const obj = join(work, "short-broad.obj");
  writeFileSync(obj, vertices.join("\n"));
  const sheet = join(root, "character-view/coast-portrait.atlas.webp");
  const images = await page.evaluate(async (base64) => {
    const src = await createImageBitmap(
      new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))]),
    );
    function quadrant(index: number) {
      const c = document.createElement("canvas");
      c.width = c.height = 512;
      const g = c.getContext("2d");
      if (!g) throw new Error("No canvas");
      g.drawImage(
        src,
        ((index % 2) * src.width) / 2,
        (Math.floor(index / 2) * src.height) / 2,
        src.width / 2,
        src.height / 2,
        0,
        0,
        512,
        512,
      );
      if (index === 0) {
        g.fillStyle = "rgba(20,75,204,.85)";
        g.beginPath();
        g.moveTo(160, 95);
        g.lineTo(232, 85);
        g.lineTo(395, 308);
        g.lineTo(339, 366);
        g.fill();
      }
      return c.toDataURL().split(",")[1] ?? "";
    }
    const c = document.createElement("canvas");
    c.width = c.height = 384;
    const g = c.getContext("2d");
    if (!g) throw new Error("No canvas");
    const field = g.createImageData(c.width, c.height);
    for (let row = 0; row < c.height; row++)
      for (let col = 0; col < c.width; col++) {
        const x = (col - 192) / 145,
          y = (row - 192) / 175,
          oval = 1 - x * x - y * y;
        const bump = (cx: number, cy: number, w: number, h: number) =>
          Math.exp(-(((x - cx) / w) ** 2 + ((y - cy) / h) ** 2));
        const nose = 100 * bump(0, 0.08, 0.17, 0.23) + 34 * bump(0, -0.12, 0.14, 0.43);
        const cheeks = 38 * (bump(-0.42, 0.1, 0.27, 0.24) + bump(0.42, 0.1, 0.27, 0.24));
        const brow = 20 * bump(0, -0.32, 0.74, 0.15),
          lips = 38 * bump(0, 0.43, 0.3, 0.13),
          chin = 28 * bump(0, 0.69, 0.37, 0.23);
        const shade =
          oval > 0
            ? Math.min(255, 23 + 86 * Math.sqrt(oval) + nose + cheeks + brow + lips + chin)
            : 0;
        field.data.set([shade, shade, shade, 255], 4 * (row * c.width + col));
      }
    g.putImageData(field, 0, 0);
    return [quadrant(0), quadrant(1), c.toDataURL().split(",")[1] ?? "", quadrant(3)];
  }, readFileSync(sheet).toString("base64"));
  const [front, side, depth, right] = ["front", "side", "depth", "right"].map((s, i) => {
    const path = join(work, s + ".png");
    writeFileSync(path, Buffer.from(images[i] ?? "", "base64"));
    return path;
  });
  assert.ok(front && side && depth && right);
  await fresh("human-adult/preset/seed-491");
  await expand("#human-styling");
  let rev = 1;
  if (await page.inputValue("#human-cast")) {
    await page.selectOption("#human-cast", "");
    await ready(++rev);
  }
  await page.click("#camera-front");
  await page.click("#focus-selection");
  await pair("06-reference-build", async () => {
    await action("Fit 3D reference");
    await page.getByLabel("3D reference file").setInputFiles(obj);
    await apply(++rev);
  });
  const head = page
    .locator("#outliner .row")
    .filter({ has: page.locator("span").getByText("head", { exact: true }) })
    .first();
  await head.click();
  await page.click("#focus-selection");
  await pair("19-native-portrait", async () => {
    await action("Paint native portrait");
    await page.getByLabel("Front portrait", { exact: true }).setInputFiles(front);
    await marks("Front portrait", [
      [0.38, 0.38],
      [0.61, 0.38],
      [0.5, 0.66],
    ]);
    await page.getByLabel("Right-facing profile (optional)", { exact: true }).setInputFiles(right);
    await marks("Right-facing profile (optional)", [
      [0.68, 0.38],
      [0.88, 0.52],
      [0.79, 0.66],
    ]);
    await apply(++rev);
  });
  await save("Native portrait");
  await pair("15-studio-head", async () => {
    await page.selectOption("#human-faceFamily", "Studio Rain");
    await ready(++rev);
  });
  await save("Studio head");
  await fresh("figure-42");
  await select("p-head");
  await page.click("#camera-front");
  await page.click("#focus-selection");
  await pair("24-landmarks", async () => {
    await action("Match facial landmarks");
    await page.getByLabel("Portrait", { exact: true }).setInputFiles(front);
    await marks("Model face", [
      [0.44, 0.43],
      [0.56, 0.43],
      [0.5, 0.64],
      [0.46, 0.57],
    ]);
    await marks("Portrait", [
      [0.38, 0.38],
      [0.61, 0.38],
      [0.5, 0.87],
      [0.25, 0.62],
    ]);
    await apply(2);
  });
  await page.click("#camera-side");
  await pair("26-profile", async () => {
    await action("Trace side portrait");
    await page.getByLabel("Side portrait", { exact: true }).setInputFiles(side);
    await page.getByLabel("Facing").selectOption("left");
    await marks("Side portrait", [
      [0.24, 0.29],
      [0.17, 0.38],
      [0.06, 0.47],
      [0.22, 0.53],
      [0.18, 0.67],
      [0.34, 0.84],
    ]);
    await apply(3);
  });
  await save("Landmark profile");
  await expand("#study-shelf");
  await page.selectOption("#study-choice", "coastal-biologist");
  await pair("66-reference-study", async () => {
    await changeDoc(() => page.click("#open-study"));
  });
  const faceId = await page
    .locator("#outliner .row")
    .filter({ hasText: /head and neck/i })
    .first()
    .getAttribute("data-part");
  assert.ok(faceId);
  await select(faceId);
  await page.click("#focus-selection");
  await page.click("#camera-side");
  await pair("27-depth", async () => {
    await action("Adjust portrait depth");
    await page.getByLabel("Grayscale depth map", { exact: true }).setInputFiles(depth);
    await page.getByLabel("Grayscale depth map marks").waitFor();
    await apply(2);
  });
  await action("Adjust portrait depth");
  await page.getByLabel("Depth strength").focus();
  await page.getByLabel("Depth strength").press("Home");
  for (let i = 0; i < 6; i++) await page.getByLabel("Depth strength").press("PageUp");
  await apply(3);
  await save("Depth study");
  await shot("59-game-inspection-before");
  await expand("#export-options");
  await page.getByRole("button", { name: "Inspect game export", exact: true }).click();
  await page.waitForSelector("#game-results img", { timeout: 90000 });
  assert.match(await page.innerText("#game-results"), /triangles.*joints/);
  assert.ok((await page.locator("#game-results img").count()) >= 2);
  await inspectionImage("#game-results img", "59-game-inspection-after");
  await page.click("#inspection-close");

  await action("Trace a new character");
  await page
    .getByLabel("Turnaround sheet")
    .setInputFiles(join(root, "character-view/courier.atlas.webp"));
  await page.getByLabel("Region name").fill("Courier body");
  await marks("Front outline", [
    [0.46, 0.15],
    [0.54, 0.15],
    [0.6, 0.21],
    [0.56, 0.34],
    [0.6, 0.47],
    [0.56, 0.53],
    [0.43, 0.53],
    [0.4, 0.47],
    [0.44, 0.34],
    [0.4, 0.21],
  ]);
  await marks("Profile outline", [
    [0.46, 0.15],
    [0.53, 0.15],
    [0.55, 0.23],
    [0.54, 0.35],
    [0.55, 0.5],
    [0.44, 0.53],
    [0.43, 0.43],
    [0.44, 0.33],
    [0.43, 0.25],
  ]);
  await changeDoc(() => page.click("#portrait-apply"));
  await select("p-traced-body");
  await page.click("#camera-front");
  await page.click("#focus-selection");
  await page.locator("#viewport canvas").hover();
  await page.mouse.wheel(0, 550);
  await page.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
  await pair("61-hand-traced-head", async () => {
    await action("Trace another region");
    await page.getByLabel("Region name").fill("Courier head");
    await page.getByLabel("Region shape").selectOption("hull");
    await marks("Front outline", [
      [0.48, 0.025],
      [0.53, 0.025],
      [0.56, 0.065],
      [0.55, 0.118],
      [0.53, 0.15],
      [0.53, 0.175],
      [0.47, 0.175],
      [0.47, 0.145],
      [0.44, 0.118],
      [0.44, 0.07],
    ]);
    await marks("Profile outline", [
      [0.47, 0.022],
      [0.53, 0.023],
      [0.565, 0.06],
      [0.56, 0.112],
      [0.53, 0.14],
      [0.54, 0.175],
      [0.48, 0.175],
      [0.48, 0.14],
      [0.45, 0.128],
      [0.44, 0.082],
    ]);
    await apply(2);
  });
  await select("p-traced-body");
  await pair("62-reused-sheet", async () => {
    await action("Reuse turnaround");
    await page
      .getByLabel("Sheet file")
      .setInputFiles(join(root, "character-view/trader.atlas.webp"));
    await apply(3);
  });
  const traced = await page.inputValue("#document"),
    painted = await state(page, traced);
  await page.click("#undo");
  await ready(4);
  assert.notEqual(await state(page, traced), painted);
  await page.click("#redo");
  await ready(5);
  assert.equal(await state(page, traced), painted);
  await save("Hand traced courier");
  await page.fill("#variation-name", "Courier alternate");
  await changeDoc(() => page.click("#save-variation"));
  await select("p-traced-body");
  await page.click("#camera-front");
  await page.click("#focus-selection");
  await pair("65-saved-variation", async () => {
    await action("Reuse turnaround");
    const existing = page.getByLabel("Existing sheet");
    const source = await existing.locator("option").nth(1).getAttribute("value");
    assert.ok(source);
    await existing.selectOption(source);
    await apply(2);
  });
  assert.equal(await state(page, traced), painted);
  await save("Courier alternate");
  await shot("63-static-export-before");
  await expand("#export-options");
  await page.uncheck("#export-motion");
  await page.selectOption("#export-preset", "game");
  await page.click("#export");
  await page.waitForFunction(
    () => document.querySelector("#status")?.textContent?.startsWith("Exported"),
    undefined,
    { timeout: 90000 },
  );
  await page.waitForFunction(() =>
    /0 skeletons.*0 clips/.test(
      document.querySelector("#player-controls .pl-status")?.textContent ?? "",
    ),
  );
  await page.getByRole("button", { name: "Inspection sheet", exact: true }).click();
  await inspectionImage("#player-controls .pl-shots img", "63-static-export-after");
  const dir = join(work, "first", "exports"),
    glb = readFileSync(join(dir, readdirSync(dir).find((n) => n.endsWith(".glb")) ?? "missing"));
  const json: unknown = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString());
  assert.ok(
    typeof json === "object" && json !== null && !("skins" in json) && !("animations" in json),
  );
  await portraitContactSheet(page, directory);
  await running.close();
  running = await launch("second");
  page = running.page;
  const opened = new Set<string>();
  for (const s of saved) {
    if (opened.has(s.id)) {
      await running.close();
      running = await launch("reload-" + opened.size);
      page = running.page;
      opened.clear();
    }
    opened.add(s.id);
    await running.answerDialogs({ open: s.file });
    await page.click("#character-open");
    await page.waitForFunction(
      (id) => document.querySelector<HTMLSelectElement>("#document")?.value === id,
      s.id,
    );
    assert.equal(await state(page, s.id), s.state);
  }
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await expand("#portrait-editor");
    await page.getByRole("button", { name: "Trace a new character" }).click();
    const bounds = await page.locator("#portrait-dialog").boundingBox();
    assert.ok(
      bounds && bounds.width <= width && bounds.x >= 0,
      "Trace dialog fits " + width + " px",
    );
    await page.click("#portrait-close");
  }
  assert.deepEqual(problems, []);
  console.log(
    `Reopened ${saved.length} character files in ${Math.round((performance.now() - started) / 1000)} seconds.`,
  );
} catch (e) {
  console.error(e);
  console.error(
    await page
      .locator("#status,#status-right,#banner,#portrait-status,#game-results")
      .allTextContents(),
  );
  throw e;
} finally {
  await running.close();
  rmSync(work, { recursive: true, force: true });
}
