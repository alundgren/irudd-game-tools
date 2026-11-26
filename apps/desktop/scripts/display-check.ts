import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

export async function changedPixels(page: Page, left: Buffer, right: Buffer): Promise<number> {
  return page.evaluate(
    async ([a, b]) => {
      async function pixels(base64: string): Promise<Uint8ClampedArray> {
        const image = await createImageBitmap(
          new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type: "image/png" }),
        );
        const canvas = new OffscreenCanvas(image.width, image.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Cannot compare screenshots.");
        ctx.drawImage(image, 0, 0);
        image.close();
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      }
      const [first, second] = await Promise.all([pixels(a), pixels(b)]);
      if (first.length !== second.length) throw new Error("Viewport dimensions changed.");
      let count = 0;
      for (let i = 0; i < first.length; i += 4)
        if (
          [0, 1, 2].some(
            (channel) => Math.abs((first[i + channel] ?? 0) - (second[i + channel] ?? 0)) > 12,
          )
        )
          count++;
      return count;
    },
    [left.toString("base64"), right.toString("base64")] as const,
  );
}

export async function hardwareRenderer(page: Page) {
  const gpu = await page.locator("#viewport canvas").evaluate((canvas) => {
    const gl = canvas instanceof HTMLCanvasElement && canvas.getContext("webgl2");
    const debug = gl && gl.getExtension("WEBGL_debug_renderer_info");
    if (!gl || !debug) throw new Error("Cannot identify editor GPU.");
    return String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL));
  });
  assert.doesNotMatch(gpu, /swiftshader|llvmpipe|softpipe|basic render|warp|software/i);
  return gpu;
}

export async function viewportScreenshot(page: Page) {
  const png = await page.locator("#viewport canvas").evaluate(async (canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Missing viewport canvas.");
    document.getElementById("tool-select")?.click();
    return new Promise<string>((done) =>
      requestAnimationFrame(() => done(canvas.toDataURL("image/png"))),
    );
  });
  return Buffer.from(png.slice(png.indexOf(",") + 1), "base64");
}

export async function verifyDisplay(page: Page, directory: string): Promise<string> {
  mkdirSync(directory, { recursive: true });
  const gpu = await hardwareRenderer(page);
  const shot = () => viewportScreenshot(page);
  const shading = page.getByRole("combobox", { name: "Viewport shading" });
  assert.equal(await shading.inputValue(), "studio");
  await page.click("#camera-front");
  const studio = await shot();
  writeFileSync(join(directory, "studio.png"), studio);
  await shading.selectOption("clay");
  const clay = await shot();
  writeFileSync(join(directory, "clay.png"), clay);
  const difference = await changedPixels(page, studio, clay);
  assert.ok(difference > 1000, "studio paint differs from the clay surface");
  await shading.selectOption("silhouette");
  const silhouette = await shot();
  writeFileSync(join(directory, "silhouette.png"), silhouette);
  const angles = [silhouette];
  for (const angle of ["side", "back", "threequarter"]) {
    await page.click("#camera-" + angle);
    const current = await shot();
    for (const previous of angles)
      assert.ok(
        (await changedPixels(page, previous, current)) > 200,
        "each camera angle changes the projection",
      );
    angles.push(current);
  }
  await page.click("#camera-front");
  await shading.selectOption("studio");
  assert.ok(
    (await changedPixels(page, studio, await shot())) < 100,
    "studio restores the original paint and camera",
  );
  await page
    .locator("#outliner .row")
    .filter({ has: page.getByText("head", { exact: true }) })
    .first()
    .click();
  const selected = await shot();
  await page.click("#focus-selection");
  assert.ok(
    (await changedPixels(page, selected, await shot())) > 2000,
    "focus reframes the selected head",
  );
  await page.keyboard.press("Escape");
  await page.keyboard.press("f");
  assert.ok(
    (await changedPixels(page, studio, await shot())) < 100,
    "F with an empty selection frames the whole character",
  );
  return gpu + ", studio/clay changed pixels " + difference;
}
