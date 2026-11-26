import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function buildId(): string {
  try {
    const stamp: unknown = JSON.parse(
      readFileSync(
        path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "build.json"),
        "utf8",
      ),
    );
    if (typeof stamp === "object" && stamp !== null && "build" in stamp)
      return typeof stamp.build === "string" ? stamp.build : "unknown";
  } catch {}
  return "source";
}
