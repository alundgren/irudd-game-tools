import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { hardwareRenderer, changedPixels, viewportScreenshot } from "./display-check.js";
import { contactSheet } from "./contact-sheet.js";

export async function verifySurface(
  page: Page,
  directory: string,
  saveFace: (revision: number) => Promise<void>,
) {
  mkdirSync(directory, { recursive: true });
  console.log("Surface GPU", await hardwareRenderer(page));
  const panel = page.locator("#surface-editor"),
    rows: { name: string; image: string }[] = [];
  const get = (name: string) => panel.getByLabel(name, { exact: true }),
    click = (name: string) => panel.getByRole("button", { name, exact: true }).click();
  async function expand(title: string) {
    const box = panel
      .locator("details")
      .filter({ has: page.locator("summary").getByText(title, { exact: true }) });
    if (!(await box.evaluate((n) => n.hasAttribute("open")))) await box.locator("summary").click();
  }
  async function shot(name: string) {
    const png = await viewportScreenshot(page);
    writeFileSync(join(directory, name + ".png"), png);
    rows.push({ name, image: png.toString("base64") });
    return png;
  }
  let revision = 1;
  async function edit(action: () => Promise<unknown>) {
    await action();
    await page.waitForFunction(
      (r) =>
        new RegExp("revision " + r + "\\b").test(
          document.querySelector("#status-right")?.textContent ?? "",
        ),
      ++revision,
      { timeout: 45000 },
    );
    await page.waitForFunction(
      () => !document.querySelector("#surface-editor")?.hasAttribute("inert"),
    );
    assert.equal(
      await page.locator("#banner.error:not([hidden])").count(),
      0,
      await page.locator("#banner").innerText(),
    );
  }
  async function compare(id: string, action: () => Promise<void>, visual = true) {
    console.log("Exercise", id);
    const before = await shot(id + "-before");
    await action();
    const after = await shot(id + "-after");
    if (visual)
      assert.ok(
        (await changedPixels(page, before, after)) > 20,
        id + " should change the visible surface",
      );
  }
  const focus = () => page.click("#focus-selection");
  async function moveAside(centimetres: number) {
    await expand("Shape nudge");
    await get("Operation").selectOption("Move (cm)");
    await get("Axis").selectOption("X");
    await get("Amount").fill(String(centimetres));
    await edit(() => click("Apply shape nudge"));
  }
  async function add(shape: string) {
    await expand("Build parts");
    await get("New part shape").selectOption(shape);
    await edit(() => click("Add part"));
    return selected();
  }
  async function selected() {
    const id = await page.locator("#outliner .selected").getAttribute("data-part");
    assert.ok(id);
    return id;
  }
  async function select(id: string) {
    await page.locator('#outliner [data-part="' + id + '"]').click();
  }
  async function tint(name: string, value: string) {
    await get(name).evaluate((n, v) => {
      if (!(n instanceof HTMLInputElement)) throw new Error("Missing colour");
      n.value = v;
    }, value);
  }
  if (!(await panel.evaluate((n) => n.hasAttribute("open"))))
    await panel.locator(":scope > summary").click();
  await expand("Face marks");
  const humanHead = page
    .locator("#outliner .row")
    .filter({ has: page.getByText("head", { exact: true }) })
    .first();
  if (await humanHead.count()) {
    await humanHead.click();
    await focus();
  }
  await get("New face mark").selectOption("Paint band");
  await compare("18-face-mark", async () => {
    await edit(() => click("Add face mark"));
    await get("Strength").fill("1");
    await edit(() => click("Apply face mark"));
  });
  await saveFace(revision);
  const starter = await page
    .locator("#start option")
    .evaluateAll((options) =>
      options
        .map((o) => o.getAttribute("value") ?? "")
        .find((v) => v === "frame-creature" || v.startsWith("frame-creature/")),
    );
  assert.ok(starter);
  await page.selectOption("#start", starter);
  await page.waitForFunction(
    () =>
      document
        .querySelector<HTMLSelectElement>("#document")
        ?.value.startsWith("doc-frame-creature-") &&
      /revision 1\b/.test(document.querySelector("#status-right")?.textContent ?? ""),
  );
  revision = 1;
  const head = await add("head");
  await expand("Shape nudge");
  await get("Operation").selectOption("Move (cm)");
  await get("Amount").fill("70");
  await edit(() => click("Apply shape nudge"));
  await focus();
  await compare("01-nudge", async () => {
    for (const [operation, axis, amount] of [
      ["Size (%)", "Y", "22"],
      ["Move (cm)", "X", "2"],
      ["Turn (degrees)", "Y", "20"],
    ] as const) {
      await get("Operation").selectOption(operation);
      await get("Axis").selectOption(axis);
      await get("Amount").fill(amount);
      await edit(() => click("Apply shape nudge"));
    }
  });
  await expand("Movable eyes");
  await compare("28-eyes", async () => {
    await edit(() => click("Fit from face paint"));
    await tint("Iris colour", "#31b6e6");
    await edit(() => click("Fit eyes"));
  });
  await expand("Hair groom");
  await get("Hair pattern").selectOption("Coils");
  await compare("29-groom", () => edit(() => click("Apply groom")));
  const accessory = await add("ellipsoid");
  await select(head);
  await expand("Rigid accessories");
  await get("Attach pieces").selectOption(accessory);
  await get("Face clearance (mm)").fill("6");
  await compare("25-accessory", () => edit(() => click("Fit accessory")));
  await select(accessory);
  await focus();
  await expand("Material and roles");
  await compare("40-material", async () => {
    await get("Surface finish").selectOption("fur");
    await get("Clothing region").selectOption("accessory");
    await get("Movement role").selectOption("rigid");
    await tint("Part colour", "#4d963c");
    await edit(() => click("Apply material"));
  });
  await expand("Surface markings");
  await get("Marking pattern").selectOption("Rosettes");
  await tint("Marking colour", "#eec8ac");
  await compare("32-markings", () => edit(() => click("Apply markings")));
  await expand("Build parts");
  await compare("33-build", async () => {
    await edit(() => click("Duplicate branch"));
    await edit(() => click("Mirror branch"));
    await edit(() => click("Remove branch"));
  });
  await select(accessory);
  const lobe = await add("ellipsoid");
  await expand("Shape nudge");
  await get("Operation").selectOption("Move (cm)");
  await get("Axis").selectOption("Y");
  await get("Amount").fill("-9");
  await edit(() => click("Apply shape nudge"));
  await expand("Shared skin");
  await edit(() => click("Join shared skin"));
  await select(accessory);
  await focus();
  await expand("Shared skin");
  await get("Skin texture").selectOption("scales");
  await tint("Skin tint", "#317f79");
  await compare("31-joined-skin", () => edit(() => click("Join shared skin")));
  await select(lobe);
  const guide = await add("sweep");
  await focus();
  await expand("Guide strands");
  await get("Strand count").fill("52");
  await compare("30-guide-strands", () => edit(() => click("Grow strands")));
  await moveAside(-90);
  await select(accessory);
  const seat = await add("sweep");
  await focus();
  await expand("Seat on parent");
  await get("Seat depth (mm)").fill("24");
  await compare(
    "37-seat",
    async () => {
      await edit(() => click("Seat surface"));
      await edit(() => click("Release surface"));
      await edit(() => click("Seat surface"));
    },
    false,
  );
  await select(head);
  const hand = await add("sweep");
  await moveAside(90);
  await expand("Material and roles");
  await get("Clothing region").selectOption("hand");
  await edit(() => click("Apply material"));
  await expand("Hand");
  await edit(() => click("Fit palm and fingers"));
  await page.click("#camera-threequarter");
  await focus();
  await expand("Hand");
  await get("Fingers").fill("3");
  await get("Finger curl").fill("0.72");
  await compare("36-hand", () => edit(() => click("Shape hand")));
  await edit(() => page.click("#undo"));
  assert.equal(await get("Fingers").inputValue(), "4");
  await edit(() => page.click("#redo"));
  assert.equal(await get("Fingers").inputValue(), "3");
  await contactSheet(page, directory, rows);
  return { revision, head, accessory, guide, seat, hand };
}
