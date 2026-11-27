import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page, Locator } from "@playwright/test";
import { contactSheet } from "./contact-sheet.js";
import { hardwareRenderer, changedPixels, viewportScreenshot } from "./display-check.js";

export async function verifyShapes(
  page: Page,
  directory: string,
  save: (name: string, revision: number) => Promise<void>,
) {
  mkdirSync(directory, { recursive: true });
  console.log("Shape GPU", await hardwareRenderer(page));
  const original = await page.inputValue("#document"),
    shape = page.locator("#shape-editor"),
    stage = page.locator("#viewport");
  const shots: { name: string; image: string }[] = [];
  async function shot(name: string) {
    const png = await viewportScreenshot(page);
    writeFileSync(join(directory, name + ".png"), png);
    shots.push({ name, image: png.toString("base64") });
    return png;
  }
  async function pair(name: string, run: () => Promise<void>) {
    console.log("Exercise", name);
    const before = await shot(name + "-before");
    await run();
    const after = await shot(name + "-after");
    assert.ok((await changedPixels(page, before, after)) > 4, name + " should change the viewport");
  }
  let revision = 1;
  async function ready() {
    await page.waitForFunction(
      (n) =>
        new RegExp("revision " + n + "\\b").test(
          document.querySelector("#status-right")?.textContent ?? "",
        ) &&
        !document.querySelector("#viewport")?.hasAttribute("inert") &&
        !document.querySelector("#shape-editor")?.hasAttribute("inert"),
      revision,
      { timeout: 45000 },
    );
  }
  async function edit(run: () => Promise<unknown>) {
    await run();
    revision++;
    await ready();
    assert.equal(
      await page.locator("#banner.error:not([hidden])").count(),
      0,
      await page.locator("#banner").innerText(),
    );
  }
  async function fresh(value: string) {
    const old = await page.inputValue("#document");
    await page.selectOption("#start", value);
    await page.waitForFunction(
      (id) => document.querySelector<HTMLSelectElement>("#document")?.value !== id,
      old,
    );
    revision = 1;
    await ready();
    await page.click("#camera-front");
    await page.click("#focus-selection");
  }
  async function open(details: Locator) {
    if (!(await details.evaluate((n) => n.hasAttribute("open"))))
      await details.locator(":scope > summary").click();
  }
  const selectPart = (id: string) => page.locator('#outliner [data-part="' + id + '"]').click();
  const mode = (name: string) => shape.getByLabel("Shape mode", { exact: true }).selectOption(name);
  const action = (name: string) => shape.getByRole("button", { name, exact: true }).click();
  const sub = (name: string) =>
    shape
      .locator("details")
      .filter({ has: page.locator("summary").getByText(name, { exact: true }) });
  async function drag(x: number, y: number, dx: number, dy: number) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 8 });
    await page.mouse.up();
  }
  async function handle(kind: string) {
    const node = page.getByRole("button", { name: kind + " point 2", exact: true }),
      b = await node.boundingBox();
    assert.ok(b);
    await edit(() => drag(b.x + b.width / 2, b.y + b.height / 2, 17, -12));
  }
  await fresh("human-adult/preset/seed-491");
  await open(page.locator("#human-styling"));
  if (await page.inputValue("#human-cast")) await edit(() => page.selectOption("#human-cast", ""));
  await edit(() => page.selectOption("#human-outfit", "Shirt and chinos"));
  await pair("14-styling", async () => {
    for (const [key, value] of [
      ["faceFamily", "Soft"],
      ["faceFamilyHair", "Chosen"],
      ["facePlanes", "Sculpted"],
      ["facialHair", "Moustache"],
      ["earrings", "Hoops"],
      ["waistBag", "Dispatch folio"],
      ["handProp", "Painted folding fan"],
      ["hat", "Beret"],
    ] as const)
      await edit(() => page.selectOption("#human-" + key, value));
    await edit(() =>
      page.locator("#human-hatColor").evaluate((n) => {
        if (n instanceof HTMLInputElement) {
          n.value = "#bc753b";
          n.dispatchEvent(new Event("change"));
        }
      }),
    );
  });
  const wardrobe = page.locator("#wardrobe");
  await open(wardrobe.locator(":scope > details"));
  await open(page.locator("#tailor"));
  await pair("17-armour-and-mail", async () => {
    const button = (name: string) => wardrobe.getByRole("button", { name, exact: true }).click();
    await edit(() => button("Tailor this outfit"));
    await wardrobe.getByLabel("Tailored layer").selectOption("1");
    await edit(() => wardrobe.getByLabel("Material", { exact: true }).selectOption("mail"));
    for (const piece of [
      "cuirass",
      "armguards",
      "legguards",
      "tassets",
      "pauldrons",
      "travellingMantle",
    ]) {
      await wardrobe.getByLabel("Piece to add").selectOption(piece);
      await edit(() => button("Add piece"));
    }
  });
  await save("Armoured traveller", revision);
  await fresh("jointed-conductor");
  await open(shape);
  await selectPart("p-head-and-neck");
  await page.click("#focus-selection");
  await mode("Face");
  await pair("02-face", async () => {
    await shape.getByLabel("Face multiplier").fill("1.6");
    await edit(() => action("Shape face"));
  });
  await mode("Build");
  await pair("02-build", async () => {
    await shape.getByLabel("Build multiplier").fill("1.2");
    await edit(() => action("Shape build"));
  });
  await selectPart("p-skirt");
  await page.click("#focus-selection");
  await mode("Cloth");
  await pair("02-cloth", async () => {
    await shape.getByLabel("Hem flare").fill("1.8");
    await edit(() => action("Shape cloth"));
  });
  await selectPart("p-festival-shoulder-cape");
  await page.click("#focus-selection");
  await mode("Cage");
  await pair("34-cage", () => handle("Cage"));
  await selectPart("p-head-and-neck");
  await page.click("#focus-selection");
  const b = await stage.boundingBox();
  assert.ok(b);
  const x = b.x + b.width / 2,
    y = b.y + b.height / 2;
  await mode("Pull");
  await pair("07-pull", () => edit(() => drag(x, y, 26, 9)));
  await mode("Mark");
  await shape.getByLabel("Location name").fill("Brow");
  await pair("55-location", () => edit(() => page.mouse.click(x, y)));
  await mode("Draw");
  await shape.getByLabel("Radius (m)").fill("0.025");
  await pair("08-appendage", () =>
    edit(() => drag(x + b.width * 0.09, y - b.height * 0.2, b.width * 0.24, -b.height * 0.18)),
  );
  await page.click("#focus-selection");
  await mode("Spine");
  await pair("02-spine", () => handle("Spine"));
  await mode("Select");
  await open(sub("Spine plates"));
  await shape.getByLabel("Field rows").fill("3");
  await shape.getByLabel("Field columns").selectOption("1");
  await pair("38-field", () => edit(() => action("Grow plate field")));
  await shape.getByLabel("Plate face").selectOption("Left");
  await shape.getByLabel("Plate rows", { exact: true }).fill("4");
  await shape.getByLabel("Plate columns", { exact: true }).fill("3");
  const carrierId = await page.locator("#outliner .selected").getAttribute("data-part");
  assert.ok(carrierId);
  await pair("39-repeated-plates", () => edit(() => action("Repeat plates")));
  const platedCount = await page.locator("#outliner .row").count();
  await edit(() => page.click("#undo"));
  assert.equal(await page.locator("#outliner .row").count(), platedCount - 12);
  await edit(() => page.click("#redo"));
  assert.equal(await page.locator("#outliner .row").count(), platedCount);
  await page.locator('#outliner [data-part="' + carrierId + '"]').click();
  const source = await page.inputValue("#document"),
    part = await page.locator("#outliner .selected").getAttribute("data-part");
  assert.ok(part);
  await page.mouse.click(b.x + 6, b.y + 6);
  await page.click("#focus-selection");
  await open(sub("World scale"));
  await action("Pin height for comparison");
  await pair("50-world-scale", async () => {
    const input = shape.getByLabel("Target height (m)");
    await input.fill(String(Number(await input.inputValue()) * 1.16));
    await edit(() => action("Set height"));
    assert.match(await sub("World scale").innerText(), /as tall/);
    const heights = await shape
      .locator(".size-comparison img")
      .evaluateAll((images) => images.map((image) => image.getBoundingClientRect().height));
    assert.equal(heights.length, 2);
    assert.ok(Math.abs((heights[1] ?? 0) / (heights[0] ?? 1) - 1.16) < 0.02);
  });
  await save("Conductor shape tools", revision);
  await fresh("figure-42");
  await selectPart("p-head");
  await page.click("#focus-selection");
  await open(sub("Graft a saved part"));
  await shape.getByLabel("Source character").selectOption(source);
  await shape.getByLabel("Source part").selectOption(part);
  await pair("64-graft", () => edit(() => action("Graft branch")));
  await save("Grafted figure", revision);
  await contactSheet(page, directory, shots);
  await shape.locator(":scope > summary").click();
  await page.selectOption("#document", original);
  await page.waitForFunction(
    () =>
      !document.querySelector("#viewport")?.hasAttribute("inert") &&
      document.querySelectorAll("#outliner .row").length === 52,
  );
}
