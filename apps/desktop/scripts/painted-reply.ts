import assert from "node:assert/strict";
import type { Page } from "@playwright/test";

export async function paintJacket(page: Page, sheet: Uint8Array) {
  const result = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = "data:image/webp;base64," + base64;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < canvas.height; y++) {
      const height = ((2 * y) / canvas.height) % 1;
      if (height < 0.18 || height > 0.62) continue;
      for (let x = 0; x < canvas.width; x++) {
        const u = ((2 * x) / canvas.width) % 1;
        const front = x < canvas.width / 2 && y < canvas.height / 2;
        if (front && u > 0.43 && u < 0.585 && height < 0.31) continue;
        if (height < 0.215 && u > 0.39 && u < 0.62) continue;
        const i = (y * canvas.width + x) * 4;
        const [r = 0, g = 0, b = 0] = pixels.data.subarray(i, i + 3);
        if (r <= g || b >= g || r > 1.65 * g) continue;
        const light = r * 0.35 + g * 0.55 + b * 0.1;
        pixels.data[i] = light * 0.48;
        pixels.data[i + 1] = light * 1.24;
        pixels.data[i + 2] = light * 1.36;
      }
    }
    ctx.putImageData(pixels, 0, 0);
    return canvas.toDataURL("image/webp", 0.98).split(",")[1];
  }, Buffer.from(sheet).toString("base64"));
  assert.ok(result);
  return Buffer.from(result, "base64");
}

export async function depthReply(page: Page, front: Uint8Array) {
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const n = bitmap.width;
    const canvas = new OffscreenCanvas(n, n);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Missing 2D context.");
    ctx.drawImage(bitmap, 0, 0);
    const image = ctx.getImageData(0, 0, n, n);
    const px = image.data;
    const spans: ([number, number] | null)[] = [];
    let top = n;
    let bottom = -1;
    for (let y = 0; y < n; y++) {
      let lo = -1;
      let hi = -1;
      for (let x = 0; x < n; x++) {
        const i = 4 * (y * n + x);
        const r = px[i] ?? 0;
        const g = px[i + 1] ?? 0;
        const b = px[i + 2] ?? 0;
        const keyed = Math.min(r, b) > 108 && Math.min(r, b) > g * 1.7 + 32;
        if (keyed || (px[i + 3] ?? 0) < 190) continue;
        if (lo < 0) lo = x;
        hi = x;
      }
      spans.push(hi > lo ? [lo, hi] : null);
      if (hi > lo) {
        top = Math.min(top, y);
        bottom = y;
      }
    }
    for (let y = 0; y < n; y++) {
      const span = spans[y];
      const v = (y - (top + bottom) / 2) / ((bottom - top) / 2 || 1);
      for (let x = 0; x < n; x++) {
        const i = 4 * (y * n + x);
        let g = 0;
        if (span) {
          const u = (x - (span[0] + span[1]) / 2) / ((span[1] - span[0]) / 2 || 1);
          g = Math.round(70 + 175 * Math.sqrt(Math.max(0, 1 - u * u)) * (1 - 0.25 * v * v));
        }
        px[i] = g;
        px[i + 1] = g;
        px[i + 2] = g;
        px[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const out = new Uint8Array(await blob.arrayBuffer());
    let text = "";
    for (let i = 0; i < out.length; i += 0x8000)
      text += String.fromCharCode(...out.subarray(i, i + 0x8000));
    return btoa(text);
  }, Buffer.from(front).toString("base64"));
}

export async function paintPortraitHair(page: Page, source: string) {
  const png = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("Cannot paint portrait");
    ctx.drawImage(img, 0, 0);
    const image = ctx.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < image.data.length; i += 4) {
      const y = Math.floor(i / 4 / c.width) % (c.height / 2);
      const [r = 0, g = 0, b = 0] = image.data.subarray(i, i + 3);
      if (y > c.height * 0.38 || r < 50 || g < 45 || r - g > 45 || g - b > 48 || b > r * 1.1)
        continue;
      image.data[i] = r * 0.76;
      image.data[i + 1] = g * 0.57;
      image.data[i + 2] = b * 0.48;
    }
    ctx.putImageData(image, 0, 0);
    return c.toDataURL("image/webp", 0.97).split(",")[1];
  }, source);
  assert.ok(png);
  return Buffer.from(png, "base64");
}
