import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { changedPixels, hardwareRenderer, viewportScreenshot } from "./display-check.js";
import { contactSheet } from "./contact-sheet.js";

export async function verifyMotion(
  page: Page,
  directory: string,
  save: (name: string, revision: number) => Promise<void>,
) {
  mkdirSync(directory, { recursive: true });
  const gpu = await hardwareRenderer(page);
  const originalDocument = await page.inputValue("#document");
  const originalStatus = await page.textContent("#status-right");
  const panel = page.locator("#motion-editor");
  const control = (name: string) => panel.getByLabel(name, { exact: true });
  const click = (name: string) => panel.getByRole("button", { name, exact: true }).click();
  const rows: { name: string; image: string }[] = [];
  let revision = 1;
  const clip = control("Pose or clip");
  async function shot(name: string) {
    const png = await viewportScreenshot(page);
    rows.push({ name, image: png.toString("base64") });
    writeFileSync(join(directory, name + ".png"), png);
    return png;
  }
  async function edit(action: () => Promise<unknown>) {
    await action();
    await page.waitForFunction(
      (n) =>
        !!document.querySelector("#banner.error:not([hidden])") ||
        (new RegExp("revision " + n + "\\b").test(
          document.querySelector("#status-right")?.textContent ?? "",
        ) &&
          !document.querySelector("#motion-editor")?.hasAttribute("inert")),
      ++revision,
      { timeout: 90000 },
    );
    assert.equal(
      await page.locator("#banner.error:not([hidden])").count(),
      0,
      await page.locator("#banner").innerText(),
    );
  }
  async function start(match: string) {
    const id = await page.inputValue("#document");
    const choice = await page
      .locator("#start option")
      .evaluateAll(
        (items, q) =>
          items.flatMap((o) =>
            o instanceof HTMLOptionElement && o.value.includes(q) ? [o.value] : [],
          )[0],
        match,
      );
    assert.ok(choice, "Starter " + match);
    await page.selectOption("#start", choice);
    await page.waitForFunction(
      (old) =>
        document.querySelector<HTMLSelectElement>("#document")?.value !== old &&
        /revision 1\b/.test(document.querySelector("#status-right")?.textContent ?? ""),
      id,
      { timeout: 90000 },
    );
    revision = 1;
    if (!(await panel.evaluate((p) => p.hasAttribute("open"))))
      await panel.locator("summary").click();
    await page.click("#camera-threequarter");
    await page.click("#focus-selection");
  }
  async function frames(who: string, motion: string) {
    await clip.selectOption(motion);
    let last: Buffer | undefined;
    for (const target of [0.12, 0.4, 0.73]) {
      await click("Play");
      await page.waitForFunction(
        (t) => {
          const slider = document.querySelector<HTMLInputElement>(
            '#motion-editor [aria-label="Clip time"]',
          );
          if (!slider || slider.valueAsNumber < t) return false;
          const pause = Array.from(
            document.querySelectorAll<HTMLButtonElement>("#motion-editor button"),
          ).find((b) => b.textContent === "Pause");
          pause?.click();
          return !!pause;
        },
        target,
        { polling: "raf" },
      );
      const png = await shot(who + "-" + motion + "-" + Math.round(target * 100));
      if (last)
        assert.ok((await changedPixels(page, last, png)) > 30, motion + " changes the pose");
      last = png;
    }
    const timeline = control("Clip time");
    await timeline.fill("0.25");
    assert.equal(await timeline.inputValue(), "0.25");
    assert.equal(await panel.getByRole("button", { name: "Play", exact: true }).count(), 1);
  }
  async function namedPose(title: string, match: RegExp) {
    await clip.selectOption("Rest");
    const joint = control("Joint");
    const labels = await joint.locator("option").allTextContents();
    const label = labels.find((s) => match.test(s));
    assert.ok(label, labels.join(", "));
    await joint.selectOption({ label });
    await control("Step (degrees or metres)").fill("35");
    const before = await viewportScreenshot(page);
    await click("Increase joint");
    const after = await shot(title);
    assert.ok(
      (await changedPixels(page, before, after)) > 20,
      "Joint adjustment moves the surface",
    );
    await control("Pose name").fill(title);
    await edit(() => click("Save pose"));
    assert.equal(await clip.inputValue(), "Pose · " + title);
  }
  await start("human-adult/preset/seed-491");
  await edit(() => control("Standing posture").selectOption("Guarded"));
  await shot("16-guarded-posture");
  await frames("human", "Walk");
  await clip.selectOption("Idle");
  await click("Play");
  await click("Pause");
  await control("Show joints").check();
  await shot("46-joints");
  await control("Show joints").uncheck();
  await namedPose("Raised shoulder", /upper arm.*joint 1/i);
  await edit(() => page.click("#undo"));
  assert.ok(!(await clip.locator("option").allTextContents()).includes("Pose · Raised shoulder"));
  await edit(() => page.click("#redo"));
  await save("Human motion", revision);
  await start("four-hand-courier");
  await edit(() => click("Bend elbow"));
  await edit(() => click("Open elbow"));
  await control("Sleeve colour").fill("#804456");
  await edit(() => click("Recut sleeves"));
  await edit(() =>
    control("Hold carry pose").evaluate((n) => {
      if (n instanceof HTMLInputElement) n.click();
    }),
  );
  await shot("35-cut-sleeves-and-carry");
  await save("Arm motion", revision);
  await start("portrait-gaze");
  await page.locator('#outliner [data-part="p-head-and-neck"]').click();
  await page.click("#focus-selection");
  await page.click("#camera-front");
  await clip.selectOption("Gaze");
  await click("Play");
  await click("Pause");
  await clip.selectOption("Rest");
  const original = await viewportScreenshot(page);
  await control("Horizontal gaze").fill("1");
  await control("Vertical gaze").fill("0.6");
  const looking = await shot("47-gaze");
  assert.ok((await changedPixels(page, original, looking)) > 10, "The fitted eyes turn");
  await control("Expression").selectOption("Smile");
  await control("Expression strength").fill("0.8");
  assert.ok((await changedPixels(page, looking, await shot("47-gaze-and-smile"))) > 10);
  await start("arched-glider");
  await frames("creature", "Fly");
  await clip.selectOption("Walk");
  await click("Play");
  await click("Pause");
  await namedPose("Folded wing", /left arm.*joint 1/i);
  await save("Creature motion", revision);
  await panel.locator("summary").click();
  await contactSheet(page, directory, rows);
  await page.selectOption("#document", originalDocument);
  await page.waitForFunction(
    (status) => document.querySelector("#status-right")?.textContent === status,
    originalStatus,
  );
  return gpu;
}
