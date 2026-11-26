import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import * as T from "three";
import { buildCharacter, clayMaterials } from "@irudd/character";
import { readDocument, type CharacterDocument } from "@irudd/document";
import { fixturesDir } from "../src/paths.js";
import { familyRegistry } from "../src/prepare.js";

type Mutable = { [key: string]: unknown };
const isObject = (v: unknown): v is Mutable => typeof v === "object" && v !== null;
const isMesh = (o: T.Object3D): o is T.Mesh => o instanceof T.Mesh;

function biologist(edit?: (groom: Mutable) => void): CharacterDocument {
  const raw: unknown = JSON.parse(
    readFileSync(join(fixturesDir, "braided-biologist.json"), "utf8"),
  );
  assert.ok(isObject(raw) && Array.isArray(raw["parts"]));
  for (const part of raw["parts"]) {
    const groom = isObject(part) && isObject(part["features"]) && part["features"]["figure.groom"];
    if (edit && isObject(groom)) edit(groom);
  }
  const read = readDocument(raw, { registry: familyRegistry });
  if (!read.ok) throw new Error(JSON.stringify(read.diagnostics));
  return read.value;
}

function hair(doc: CharacterDocument): number[] {
  const built = buildCharacter(doc, { materials: clayMaterials() });
  try {
    const counts: number[] = [];
    built.group.traverse((o) => {
      if (isMesh(o) && o.name.startsWith("Hair "))
        counts.push(o.geometry.getAttribute("position").count);
    });
    return counts;
  } finally {
    built.dispose();
  }
}

test("a groom grows a cap and three strand layers from its seed", () => {
  const counts = hair(biologist());
  assert.equal(counts.length, 4);
  assert.equal(counts[0], 65 * 21);
  assert.equal(
    counts.slice(1).reduce((a, b) => a + b, 0),
    23 * 3 * 127 * 6,
  );
  const locks = hair(biologist((g) => delete g["pattern"]));
  assert.equal(locks.slice(1).reduce((a, b) => a + b, 0) / 8, 48 * (28 + Math.ceil(0.18 * 20) + 1));
});

test("a groom outside its bounds is refused", () => {
  for (const change of [
    (g: Mutable) => (g["pattern"] = "Mohawk"),
    (g: Mutable) => (g["seed"] = 1.5),
    (g: Mutable) => (g["length"] = 3),
    (g: Mutable) => (g["color"] = "#51423C"),
  ])
    assert.throws(() => hair(biologist(change)));
});
