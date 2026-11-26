import { contactSheet } from "./contact-sheet.js";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { changedPixels, hardwareRenderer, viewportScreenshot } from "./display-check.js";

export async function verifyWardrobe(page: Page, directory: string) {
  mkdirSync(directory, { recursive: true });
  console.log("Wardrobe GPU", await hardwareRenderer(page));
  await page.click("#tab-workshop");
  const previous = await page.inputValue("#document");
  await page.selectOption("#start", "human-adult/preset/look-8973");
  await page.waitForFunction(
    (old) =>
      document.querySelector<HTMLSelectElement>("#document")?.value !== old &&
      /revision 1\b/.test(document.querySelector("#status-right")?.textContent ?? ""),
    previous,
  );
  await page.click("#camera-threequarter");
  await page.click("#focus-selection");
  await page.getByText("Outfits and garments", { exact: true }).click();
  const panel = page.locator("#wardrobe");
  const get = (name: string) => panel.getByLabel(name, { exact: true });
  const select = (name: string) => panel.getByRole("combobox", { name, exact: true });
  const setColour = (name: string, value: string) =>
    get(name).evaluate((node, hex) => {
      if (!(node instanceof HTMLInputElement)) throw new Error("Missing colour input.");
      node.value = hex;
      node.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
  const click = (name: string) => panel.getByRole("button", { name, exact: true }).click();
  const rows: { name: string; image: string }[] = [];
  let rev = 1;
  async function edit(action: Promise<unknown>) {
    await action;
    await page.waitForFunction(
      (r) =>
        new RegExp("revision " + r + "\\b").test(
          document.querySelector("#status-right")?.textContent ?? "",
        ),
      ++rev,
      { timeout: 60000 },
    );
    assert.equal(await page.locator("#banner.error:not([hidden])").count(), 0);
  }
  async function shot(name: string) {
    const png = await viewportScreenshot(page);
    writeFileSync(join(directory, name + ".png"), png);
    rows.push({ name, image: png.toString("base64") });
    return png;
  }
  async function after(name: string, before: Buffer) {
    const diff = await changedPixels(page, before, await shot(name));
    assert.ok(diff > 100, name + " changed " + diff + " pixels");
  }
  await panel.getByText("Tailored pieces", { exact: true }).click();
  const initial = await shot("17-before-tailoring");
  await edit(click("Tailor this outfit"));
  await select("Piece to add").selectOption("boots");
  await edit(click("Add piece"));
  await edit(click("Wear earlier"));
  const layer = select("Tailored layer");
  assert.match(await layer.locator("option:checked").innerText(), /Boots/);
  await edit(setColour("Colour", "#972738"));
  await after("17-after-tailoring", initial);
  const tailored = await shot("41-before-base");
  await edit(select("Base outfit").selectOption("Pressure suit"));
  await after("41-after-pressure-suit", tailored);
  await edit(select("Base outfit").selectOption("Base layer"));
  await edit(select("Base outfit").selectOption("Work clothes"));
  await panel.getByText("Tailored pieces", { exact: true }).click();
  await panel.getByText("Cut and layer garments", { exact: true }).click();
  const beforeCut = await shot("42-before-cut");
  for (const kind of ["Cape", "Poncho", "Tabard", "Skirt"]) {
    await select("Garment cut").selectOption(kind);
    await edit(click("Cut garment"));
    assert.equal(await select("Garment layer").locator("option:checked").innerText(), kind);
  }
  await after("42-after-four-cuts", beforeCut);
  const beforeAdjust = await shot("44-before-fit");
  assert.ok(
    Number(await get("Drop (m)").inputValue()) > 0.65,
    "the skirt starts at the adult's waist",
  );
  await panel.getByText("Trace waist to hem", { exact: true }).click();
  const canvas = panel.locator("canvas");
  for (const [x, y] of [
    [30, 18],
    [58, 18],
    [60, 50],
    [77, 96],
  ] as const)
    await canvas.click({ position: { x, y } });
  await edit(click("Apply outline"));
  await get("Drop (m)").fill("0.42");
  await get("Pleats").fill("12");
  await setColour("Fabric colour", "#ab5972");
  await edit(click("Adjust cut"));
  assert.equal(await get("Pleats").inputValue(), "12");
  await after("44-after-skirt-fit", beforeAdjust);
  await select("Garment layer").selectOption({ label: "Cape" });
  await select("Arm access").selectOption("Open sides");
  await get("Front opening (degrees)").fill("48");
  await edit(click("Adjust cut"));
  const beforeLayer = await shot("43-before-layer");
  await select("Garment layer").selectOption({ label: "Skirt" });
  await select("Visibility").selectOption("Hide");
  await edit(click("Apply layer"));
  await after("43-after-hide", beforeLayer);
  await select("Visibility").selectOption("Show");
  await setColour("Overdye", "#317a85");
  await select("Layer order").selectOption("4");
  await edit(click("Apply layer"));
  assert.equal(await select("Layer order").inputValue(), "4");
  await panel.getByText("Saved outfits", { exact: true }).click();
  await get("New outfit name").fill("Travel clothes");
  await edit(click("Save outfit"));
  await setColour("Overdye", "#cd9c55");
  await edit(click("Apply layer"));
  await edit(click("Update outfit"));
  await edit(select("Base outfit").selectOption("Anatomy"));
  const bare = await shot("45-before-wear");
  await edit(click("Wear outfit"));
  assert.equal(await select("Base outfit").inputValue(), "Work clothes");
  assert.equal(await get("Overdye").inputValue(), "#cd9c55");
  assert.equal(await select("Layer order").inputValue(), "4");
  await after("45-after-wear", bare);
  await contactSheet(page, directory, rows);
}
