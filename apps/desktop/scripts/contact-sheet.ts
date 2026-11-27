import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

export async function portraitContactSheet(page: Page, directory: string) {
  const names = readdirSync(directory);
  const files = names
    .filter(
      (n) => n.endsWith("-before.png") && names.includes(n.replace("-before.png", "-after.png")),
    )
    .sort();
  return contactSheet(
    page,
    directory,
    files
      .flatMap((before) => [before, before.replace("-before.png", "-after.png")])
      .map((name) => ({
        name: name.slice(0, -4),
        image: readFileSync(join(directory, name)).toString("base64"),
      })),
  );
}

export async function contactSheet(
  page: Page,
  directory: string,
  rows: { name: string; image: string }[],
  scale = 1,
  filename = "contact-sheet.png",
  columns = 2,
  cell = { width: 380, height: 260 },
) {
  const sheet = await page.evaluate(
    async ({ entries, scale, columns, cell }) => {
      const canvas = document.createElement("canvas");
      canvas.width = cell.width * columns * scale;
      canvas.height = Math.ceil(entries.length / columns) * cell.height * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Cannot make contact sheet.");
      ctx.scale(scale, scale);
      ctx.fillStyle = "#263032";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.font = "16px sans-serif";
      for (const [i, entry] of entries.entries()) {
        const img = await createImageBitmap(
          new Blob([Uint8Array.from(atob(entry.image), (c) => c.charCodeAt(0))], {
            type: "image/png",
          }),
        );
        const scale = Math.min((cell.width - 8) / img.width, (cell.height - 32) / img.height),
          w = img.width * scale,
          h = img.height * scale;
        const x = (i % columns) * cell.width,
          y = Math.floor(i / columns) * cell.height;
        ctx.drawImage(img, x + (cell.width - w) / 2, y, w, h);
        img.close();
        ctx.fillStyle = "#fff";
        ctx.fillText(entry.name.replaceAll("-", " "), x + 12, y + cell.height - 11);
      }
      return canvas.toDataURL("image/png").split(",")[1] ?? "";
    },
    { entries: rows, scale, columns, cell },
  );
  writeFileSync(join(directory, filename), Buffer.from(sheet, "base64"));
}
