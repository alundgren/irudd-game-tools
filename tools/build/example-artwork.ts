import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readExampleArtwork(repository: string): ReadonlyMap<string, Buffer> {
  const directory = join(repository, "examples");
  const images = new Map<string, Buffer>();
  const prefix = "data:image/webp;base64,";
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".form.json"))) {
    const source: unknown = JSON.parse(readFileSync(join(directory, file), "utf8"));
    if (!record(source)) continue;
    const form = source["form"] ?? source;
    if (!record(form) || !record(form["artwork"])) continue;
    for (const [key, url] of Object.entries(form["artwork"])) {
      if (typeof url !== "string" || !url.startsWith(prefix)) continue;
      const bytes = Buffer.from(url.slice(prefix.length), "base64");
      const hex = createHash("sha256").update(bytes).digest("hex");
      if (!key.endsWith("-" + hex)) throw new Error(file + ": artwork digest mismatch for " + key);
      images.set("sha256:" + hex, bytes);
    }
  }
  return images;
}
