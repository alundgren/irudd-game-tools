// The build this client belongs to. The installed app bundles the client into
// dist/clients beside dist/build.json, the stamp the desktop window also
// reads, so the app, CLI and MCP server report the same build. A source
// checkout has no stamp.

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
  } catch {
    // A source checkout.
  }
  return "source";
}
