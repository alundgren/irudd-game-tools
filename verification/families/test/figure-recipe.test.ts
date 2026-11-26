import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { characterOrigin, outfitWear, readDocument } from "@irudd/document";
import { fixturesDir } from "../src/paths.js";
import { familyRegistry } from "../src/prepare.js";

type Mutable = { [key: string]: unknown };
const isObject = (v: unknown): v is Mutable => typeof v === "object" && v !== null;

function runner(edit?: (doc: Mutable) => void) {
  const raw: unknown = JSON.parse(readFileSync(join(fixturesDir, "figure-runner.json"), "utf8"));
  assert.ok(isObject(raw));
  edit?.(raw);
  return readDocument(raw, { registry: familyRegistry });
}

const recipe = (doc: Mutable): Mutable => {
  const features = doc["features"];
  const origin = isObject(features) ? features["character.origin"] : undefined;
  assert.ok(isObject(origin) && isObject(origin["figure"]));
  return origin["figure"];
};

const firstBare = (doc: Mutable): Mutable => {
  const parts = doc["parts"];
  assert.ok(Array.isArray(parts));
  for (const part of parts) {
    const wear = isObject(part) && isObject(part["features"]) && part["features"]["outfit.wear"];
    if (isObject(wear) && wear["bare"] === true) return wear;
  }
  throw new Error("No bare part.");
};

test("a figure keeps its recipe and marks its bare skin", () => {
  const read = runner();
  if (!read.ok) throw new Error(JSON.stringify(read.diagnostics));
  assert.equal(characterOrigin.read(read.value.features)?.figure?.top?.kind, "tee");
  const bare = read.value.parts.filter((p) => outfitWear.read(p.features)?.bare);
  assert.equal(bare.length, 11);
});

test("a recipe or bare mark outside its bounds is refused", () => {
  for (const change of [
    (d: Mutable) => (recipe(d)["height"] = 3),
    (d: Mutable) => (recipe(d)["hair"] = "Mullet"),
    (d: Mutable) => (recipe(d)["sectionProfile"] = {}),
    (d: Mutable) => (firstBare(d)["bare"] = false),
  ])
    assert.equal(runner(change).ok, false);
});
