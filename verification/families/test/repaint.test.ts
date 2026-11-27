import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bundledAssetNamed,
  bundledEntry,
  exportCharacter,
  repaintOperations,
  RepaintError,
} from "@irudd/character";
import { figureOccluders, type CharacterDocument } from "@irudd/document";
import { applyChecked } from "../src/apply.js";
import { compareGlb } from "../src/compare.js";
import { installNodeExporter } from "../src/node-exporter.js";
import { readFixture } from "../src/fixtures.js";

const sortedAssets = (doc: CharacterDocument) =>
  [...doc.assets].sort((a, b) => a.digest.localeCompare(b.digest));

const courier = bundledAssetNamed("courier");
assert.ok(courier);
const sheet = bundledEntry(courier);
const base = readFixture("feline-worker");
const partNamed = (doc: CharacterDocument, label: string) => {
  const part = doc.parts.find((p) => p.label === label);
  assert.ok(part, label);
  return part;
};

test("repainting the body from the courier sheet repaints it and keeps the old sheet as an occluder", () => {
  const body = partNamed(base, "body");
  const ported = applyChecked(base, repaintOperations(base, [body.id], sheet));
  assert.equal(partNamed(ported, "body").paint?.atlas, sheet.digest);
  assert.ok(sortedAssets(ported).some((a) => a.digest === sheet.digest));
  const occluders = figureOccluders.read(ported.features)?.sources ?? [];
  assert.ok(
    occluders.some((s) => s.atlas === partNamed(base, "body").paint?.atlas && s.region === "body"),
  );
  assert.ok(occluders.some((s) => s.atlas === sheet.digest && s.region === "left forearm"));
});

test("repaint keeps manual edits and geometry", async () => {
  installNodeExporter();
  const forearm = partNamed(base, "left forearm");
  const edited = applyChecked(base, [
    {
      op: "part.transform",
      part: forearm.id,
      translate: [0.01, 0.02, 0],
      rotate: [0, 0, Math.sin(0.1), Math.cos(0.1)],
    },
  ]);
  const repainted = applyChecked(
    edited,
    repaintOperations(edited, [partNamed(edited, "body").id], sheet),
  );
  assert.deepEqual(
    repainted.parts.map(({ paint: _paint, ...rest }) => rest),
    edited.parts.map(({ paint: _paint, ...rest }) => rest),
  );
  const options = { preset: "clay", revision: 1, build: "test" } as const;
  const before = await exportCharacter(edited, options);
  const after = await exportCharacter(repainted, options);
  const positions = compareGlb(before.bytes, after.bytes).accessors.filter(
    (a) => a.use === "POSITION",
  );
  assert.ok(positions.length > 0);
  assert.ok(positions.every((a) => a.differing === 0));
});

test("repaint refuses regions from different sheets", () => {
  const body = partNamed(base, "body");
  const head = partNamed(base, "head and neck");
  assert.notEqual(body.paint?.atlas, head.paint?.atlas);
  assert.throws(() => repaintOperations(base, [body.id, head.id], sheet), RepaintError);
});
