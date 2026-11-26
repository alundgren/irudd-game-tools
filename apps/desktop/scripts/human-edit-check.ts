import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { decodeWith } from "@irudd/document";
import { HumanAdultParams, measurementGroups } from "@irudd/character/human";
import type { WorkshopClient } from "@irudd/workshop/client";
import { changedPixels, hardwareRenderer, viewportScreenshot } from "./display-check.js";

export async function verifyHumanEditing(page: Page, agent: WorkshopClient, directory: string) {
  mkdirSync(directory, { recursive: true });
  console.log("Human editing GPU", await hardwareRenderer(page));
  await page.selectOption("#start", "human-adult/seed");
  await page.selectOption("#human-archetype", "neutral");
  await page.selectOption("#human-colours", "Natural");
  await page.evaluate(() => {
    const original = crypto.getRandomValues.bind(crypto);
    const seeds = [491, 8950, 42];
    crypto.getRandomValues = (buffer) => {
      if (buffer instanceof Uint32Array && buffer.length === 1 && seeds.length) {
        buffer[0] = seeds.shift() ?? 0;
        if (!seeds.length) crypto.getRandomValues = original;
        return buffer;
      }
      return original(buffer);
    };
  });
  const previous = await page.inputValue("#document");
  await page.getByRole("button", { name: "Create human", exact: true }).click();
  await page.waitForFunction(
    (old) =>
      document.querySelector<HTMLSelectElement>("#document")?.value !== old &&
      /revision 1\b/.test(document.querySelector("#status-right")?.textContent ?? ""),
    previous,
  );
  const id = await page.inputValue("#document");
  let rev = 1;
  const current = async () => {
    const view = await agent.call("inspect", { documentId: id });
    assert.equal(view.revision, rev);
    assert.equal(view.history.length, rev);
    const generation: unknown = Reflect.get(Object(view.document), "generation");
    const read = decodeWith(HumanAdultParams, Reflect.get(Object(generation), "params"));
    assert.ok(read.ok);
    return read.value;
  };
  const shot = async (name: string) => {
    const png = await viewportScreenshot(page);
    writeFileSync(join(directory, name + ".png"), png);
    return png;
  };
  const change = async (action: Promise<unknown>, name: string) => {
    await action;
    rev++;
    await page.waitForFunction(
      (n) =>
        new RegExp(`revision ${n}\\b`).test(
          document.querySelector("#status-right")?.textContent ?? "",
        ),
      rev,
      { timeout: 60_000 },
    );
    assert.equal(await page.locator("#banner.error:not([hidden])").count(), 0);
    return shot(name);
  };
  const setValue = (id: string, value: string) =>
    page.locator(id).evaluate((node, v) => {
      if (!(node instanceof HTMLInputElement)) throw new Error("No editor input.");
      node.value = v;
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
  const click = (name: string) => page.getByRole("button", { name, exact: true }).click();
  const start = await current();
  assert.equal(start.seed, 491);
  assert.equal(start.human["frame"], 0);
  assert.equal(start.outfit, "Work clothes");
  assert.ok(start.style.outfit);
  await page.click("#camera-front");
  await shot("01-start");
  await page
    .locator("#outliner .row")
    .filter({ has: page.getByText("head", { exact: true }) })
    .click();
  await page.click("#focus-selection");
  await page.keyboard.press("Escape");
  const originalFace = await shot("02-original-face");
  await page.selectOption("#human-region", "Face");
  const faceShot = await change(click("Reroll Face"), "03-face-reroll");
  assert.ok((await changedPixels(page, originalFace, faceShot)) > 200);
  const face = await current();
  const other = (p: HumanAdultParams) =>
    Object.fromEntries(
      Object.entries(p.human).filter(([axis]) => !Object.hasOwn(measurementGroups.Face, axis)),
    );
  assert.deepEqual(other(face), other(start));
  assert.notDeepEqual(face.human, start.human);
  await page.click("#human-appearance summary");
  const skinShot = await change(setValue("#human-skin", "#754d3d"), "04-skin");
  assert.equal((await current()).skin, "#754d3d");
  assert.ok((await changedPixels(page, faceShot, skinShot)) > 200);
  const eyeShot = await change(page.selectOption("#human-eye", "blue"), "05-eyes");
  assert.equal((await current()).eyeColor, "blue");
  assert.ok((await changedPixels(page, skinShot, eyeShot)) > 10, "iris colour visibly changed");
  await change(page.selectOption("#human-complexion", "Portrait Sunworn"), "06-complexion");
  assert.equal((await current()).complexion, "Portrait Sunworn");
  await change(click("Restore source skin tone"), "07-source-skin");
  assert.equal((await current()).skin, start.skin);
  await page.click("#focus-selection");
  await page.click("#human-styling summary");
  await page.selectOption("#human-direction", "Workwear");
  await change(click("Try a new outfit and hairstyle"), "08-new-look");
  const look = await current();
  assert.notEqual(look.style.outfit, start.style.outfit);
  assert.notEqual(look.style.hair, start.style.hair);
  assert.deepEqual(look.human, face.human);
  await page.selectOption("#human-region", "Body");
  await page.selectOption("#human-axis", "height");
  const before = await shot("09-before-measurement");
  const measure = page.locator("#human-measurement");
  await measure.focus();
  const resized = await change(measure.press("PageUp"), "10-stature");
  assert.ok(Number((await current()).human["height"]) > Number(look.human["height"]));
  assert.ok((await changedPixels(page, before, resized)) > 200);
  await change(page.click("#undo"), "11-undo");
  assert.deepEqual(await current(), look);
  await change(click("Show base shape"), "12-base");
  assert.equal((await current()).outfit, "Anatomy");
  await change(click("Show current outfit"), "13-outfit");
  assert.deepEqual(await current(), look);
  await change(page.selectOption("#human-hair", "Side-swept pixie"), "14-hairstyle");
  assert.equal((await current()).style.hair, "Side-swept pixie");
  await change(page.selectOption("#human-outfit", "Chore jacket"), "15-clothing");
  await change(setValue("#human-clothColor", "#435e82"), "16-cloth-colour");
  assert.equal((await current()).style.clothColor, "#435e82");
  for (const [key, value] of [
    ["fringe", "Off the face"],
    ["browStyle", "Lifted arch"],
    ["makeup", "Berry satin"],
    ["armInk", "Fern frond"],
    ["eyewear", "Round wire"],
    ["necklace", "Pearl strand"],
    ["clothDesign", "Windowpane"],
    ["secondDesign", "Herringbone"],
  ] as const) {
    await change(page.selectOption("#human-" + key, value), "16-" + key);
    assert.equal((await current()).style[key], value);
  }
  for (const [key, value] of [
    ["hairColor", "#413027"],
    ["clothSecond", "#2e3548"],
    ["clothLight", "#d9c8b3"],
    ["accentColor", "#a0643e"],
    ["clothAccent", "#958866"],
    ["leatherColor", "#593e30"],
    ["soleColor", "#312822"],
    ["metalColor", "#a89a70"],
  ] as const) {
    await change(setValue("#human-" + key, value), "16-" + key);
    assert.equal((await current()).style[key], value);
  }
  await change(page.selectOption("#human-cast", "Gardener"), "17-cast");
  await change(setValue("#human-castShape", "0.8"), "18-cast-shape");
  await change(setValue("#human-castPigment", "0.6"), "19-cast-pigment");
  assert.equal((await current()).style.castPigment, 0.6);
  await change(page.selectOption("#human-castTop", "Striped polo"), "20-cast-top");
  await change(page.selectOption("#human-castBottom", "Shorts and shoes"), "21-cast-bottom");
  assert.equal((await current()).style.castBottom, "Shorts and shoes");
}
