import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { hardwareRenderer, changedPixels, viewportScreenshot } from "./display-check.js";
import { contactSheet } from "./contact-sheet.js";

export async function verifyCreatures(
  page: Page,
  directory: string,
  save: (name: string, revision: number) => Promise<void>,
) {
  mkdirSync(directory, { recursive: true });
  console.log("Creature GPU", await hardwareRenderer(page));
  const panel = page.locator("#creature-editor"),
    rows: { name: string; image: string }[] = [];
  const field = (name: string) => panel.getByLabel(name, { exact: true });
  const click = (name: string) => panel.getByRole("button", { name, exact: true }).click();
  const original = await page.inputValue("#document");
  let revision = 1;
  async function ready() {
    await page.waitForFunction(
      () =>
        !document.querySelector("#viewport")?.hasAttribute("inert") &&
        !document.querySelector("#creature-editor")?.hasAttribute("inert"),
    );
    assert.equal(
      await page.locator("#banner.error:not([hidden])").count(),
      0,
      await page.locator("#banner").innerText(),
    );
  }
  async function fresh(action: () => Promise<unknown>) {
    const id = await page.inputValue("#document");
    await action();
    await page.waitForFunction(
      (old) =>
        document.querySelector<HTMLSelectElement>("#document")?.value !== old &&
        /revision 1\b/.test(document.querySelector("#status-right")?.textContent ?? ""),
      id,
      { timeout: 90000 },
    );
    revision = 1;
    await ready();
    await page.click("#camera-threequarter");
    await page.click("#focus-selection");
  }
  async function edit(action: () => Promise<unknown>) {
    await action();
    await page.waitForFunction(
      (n) =>
        new RegExp("revision " + n + "\\b").test(
          document.querySelector("#status-right")?.textContent ?? "",
        ),
      ++revision,
      { timeout: 90000 },
    );
    await ready();
  }
  async function expand(name: string) {
    const summary = panel.locator("summary").getByText(name, { exact: true });
    const item = summary.locator("..");
    if (!(await item.evaluate((n) => n.hasAttribute("open")))) await summary.click();
  }
  async function shot(name: string) {
    const png = await viewportScreenshot(page);
    writeFileSync(join(directory, name + ".png"), png);
    rows.push({ name, image: png.toString("base64") });
    return png;
  }
  async function compare(name: string, action: () => Promise<void>) {
    console.log("Exercise", name);
    const before = await shot(name + "-before");
    await action();
    const after = await shot(name + "-after");
    assert.ok(
      (await changedPixels(page, before, after)) > 35,
      name + " should change the visible creature",
    );
  }
  await fresh(() => page.selectOption("#start", "human-adult/preset/seed-491"));
  if (!(await panel.evaluate((n) => n.hasAttribute("open"))))
    await panel.locator(":scope > summary").click();
  await expand("Adult wings");
  await compare("20-paired-wings", async () => {
    await edit(() => click("Mount paired wings"));
    await page.click("#focus-selection");
  });
  await save("Wing study", revision);
  async function startCreature(seed: number, family = "Any", range = "Mixed") {
    await page.selectOption("#start", "creature-plan/seed");
    await page.selectOption("#creature-family", family);
    await page.selectOption("#creature-colours", range);
    await page.fill("#creature-seed", String(seed));
    await fresh(() => page.getByRole("button", { name: "Create creature", exact: true }).click());
  }
  for (let seed = 0; seed < 8; seed++) {
    await startCreature(seed);
    await shot("random-seed-" + seed);
  }
  for (const type of ["Figure", "Humanoid", "Hybrid"]) {
    await page.selectOption("#start", "workshop-form/seed");
    await page.selectOption("#creature-form", type);
    await page.selectOption("#form-frame", "female");
    await page.selectOption("#creature-colours", "Natural");
    await page.fill("#creature-seed", "18");
    await fresh(() =>
      page.getByRole("button", { name: "Create " + type.toLowerCase(), exact: true }).click(),
    );
    await shot("60-" + type.toLowerCase());
  }
  await compare("60-family-colouring", () => startCreature(8, "glider", "Fantasy"));
  await expand("Body plan");
  await compare("21-spine-handle", async () => {
    await click("Show drag handles");
    const box = await page
      .getByRole("button", { name: "Belly thickness", exact: true })
      .boundingBox();
    assert.ok(box);
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 35, { steps: 8 });
    await edit(() => page.mouse.up());
    await click("Hide drag handles");
  });
  await expand("Limb groups");
  await field("New limb kind").selectOption("tentacle");
  await compare("21-limb-group", () => edit(() => click("Add limb group")));
  await expand("Back");
  await field("Back growth").selectOption("shingles");
  await field("shoulder spikes").check();
  await compare("21-back-growth", () => edit(() => click("Apply back")));
  await expand("Shuffle");
  const variation = page.locator("#variation");
  if (!(await variation.evaluate((n) => n.hasAttribute("open"))))
    await variation.locator(":scope > summary").click();
  await page.fill(
    "#variation-decks",
    "family = swimmer | mantis\ncoat = scutes | wet skin\nskin = #347999 | #ab785d",
  );
  await page.selectOption("#variation-strength", "subtle");
  await page.click("#variation-draw");
  await field("Shuffle scope").selectOption("Head");
  await compare("22-shuffle-head", () => edit(() => click("Shuffle region")));
  for (const scope of ["Equipment", "Worn layers"]) {
    await field("Shuffle scope").selectOption(scope);
    await edit(() => click("Shuffle region"));
  }
  await expand("Colours and coat");
  await compare("23-coat-generation", () => edit(() => click("Generate coat")));
  await field("Coat family").selectOption("pelt");
  await field("Markings").selectOption("Bands");
  await field("Hide").fill("#ae5132");
  await compare("23-markings", () => edit(() => click("Apply coat and colours")));
  await save("Creature study", revision);
  await contactSheet(page, directory, rows);
  await page.selectOption("#document", original);
  await page.waitForFunction(() =>
    /revision 1\b/.test(document.querySelector("#status-right")?.textContent ?? ""),
  );
  await ready();
}
