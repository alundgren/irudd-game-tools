import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readDocument, type CharacterDocument } from "@irudd/document";
import { fixturesDir } from "./paths.js";
import { familyRegistry } from "./prepare.js";

export function readFixture(name: string): CharacterDocument {
  const raw: unknown = JSON.parse(readFileSync(join(fixturesDir, name + ".json"), "utf8"));
  const read = readDocument(raw, { registry: familyRegistry });
  if (!read.ok) throw new Error(`${name}: ${JSON.stringify(read.diagnostics)}`);
  return read.value;
}
