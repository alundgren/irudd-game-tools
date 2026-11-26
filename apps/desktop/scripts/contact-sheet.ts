import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

export async function contactSheet(
  page: Page,
  directory: string,
  rows: { name: string; image: string }[],
) {
  const sheet = await page.evaluate(async (entries) => {
    const canvas = document.createElement("canvas");
    canvas.width = 760;
    canvas.height = Math.ceil(entries.length / 2) * 260;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Cannot make contact sheet.");
    ctx.fillStyle = "#263032";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = "16px sans-serif";
    for (const [i, entry] of entries.entries()) {
      const img = await createImageBitmap(
        new Blob([Uint8Array.from(atob(entry.image), (c) => c.charCodeAt(0))], {
          type: "image/png",
        }),
      );
      const scale = Math.min(372 / img.width, 228 / img.height),
        w = img.width * scale,
        h = img.height * scale;
      const x = (i % 2) * 380,
        y = Math.floor(i / 2) * 260;
      ctx.drawImage(img, x + (380 - w) / 2, y, w, h);
      img.close();
      ctx.fillStyle = "#fff";
      ctx.fillText(entry.name.replaceAll("-", " "), x + 12, y + 249);
    }
    return canvas.toDataURL("image/png").split(",")[1] ?? "";
  }, rows);
  writeFileSync(join(directory, "contact-sheet.png"), Buffer.from(sheet, "base64"));
}
