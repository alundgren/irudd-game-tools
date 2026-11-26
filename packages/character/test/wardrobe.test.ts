import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  createRegistry,
  familyFeatures,
  figureMantle,
  outfitFit,
  outfitLooks,
  outfitLayers,
  readDocument,
  type CharacterDocument,
} from "@irudd/document";
import { buildCharacter, clayMaterials } from "../src/build.js";
import { cutGarment, traceSkirt } from "../src/garments.js";
import {
  chooseWardrobe,
  fittedGarments,
  saveLook,
  savedLooks,
  styleGarment,
  wearLook,
} from "../src/wardrobe.js";
import { buildView, visibleIn } from "../src/view.js";

const registry = createRegistry({ features: familyFeatures });
const fixture: unknown = JSON.parse(
  readFileSync(
    new URL("../../../verification/families/fixtures/field-wardrobe.json", import.meta.url),
    "utf8",
  ),
);
const read = readDocument(fixture, { registry });
if (!read.ok) throw new Error(JSON.stringify(read.diagnostics));
const original = read.value;

test("cuts attach to the chosen host and size the skirt to the floor", () => {
  const built = buildCharacter(original, { materials: clayMaterials() });
  try {
    const host = original.parts.find((p) => p.label === "body");
    assert.ok(host);
    for (const kind of ["Cape", "Poncho", "Tabard", "Skirt"] as const) {
      const part = cutGarment(built, host.id, kind, "#894d52");
      assert.equal(part.parent, host.id);
      assert.ok(outfitFit.read(part.features));
      const cut = figureMantle.read(part.features)?.cut;
      assert.ok(cut && cut.kind === kind && cut.drop > 0.07 && cut.width > 0.035);
      assert.ok(readDocument({ ...original, parts: [...original.parts, part] }, { registry }).ok);
    }
    assert.throws(() => cutGarment(built, "absent", "Skirt", "#ffffff"));
  } finally {
    built.dispose();
  }
});

test("a waist trace normalizes measurements and refuses an inverted or folded pattern", () => {
  assert.deepEqual(
    traceSkirt([
      [60, 20],
      [70, 20],
      [75, 50],
      [80, 80],
    ]),
    [
      [0, 1],
      [0.5, 1.5],
      [1, 2],
    ],
  );
  assert.throws(() =>
    traceSkirt([
      [60, 20],
      [61, 20],
      [65, 80],
      [80, 70],
    ]),
  );
  assert.throws(() =>
    traceSkirt([
      [60, 20],
      [70, 20],
      [75, 80],
      [80, 70],
    ]),
  );
});

test("saved outfits snapshot automatic visibility and overrides, and hide garments added later", () => {
  const [first, second] = fittedGarments(original);
  assert.ok(first && second);
  const style = { show: true, dye: "#728432", order: 3 };
  const base = chooseWardrobe(original, "Work clothes");
  const doc: CharacterDocument = {
    ...base,
    features: { ...base.features, [outfitLayers.id]: styleGarment(base, first.id, style) },
  };
  const name = "Trial";
  const saved = {
    ...doc,
    features: { ...doc.features, [outfitLooks.id]: saveLook(doc, " " + name + " ") },
  };
  const look = savedLooks(saved).find((l) => l.name === name);
  assert.ok(look);
  assert.deepEqual(look.layers[first.id], style);
  const view = buildView(doc),
    p = view.byId.get(second.id);
  assert.ok(p);
  assert.equal(look.layers[second.id]?.show, visibleIn(view, p));
  assert.throws(() => saveLook(saved, name));
  assert.throws(() => saveLook(doc, ""));
  const changed = chooseWardrobe(saved, "Base layer");
  const updated = {
    ...changed,
    features: { ...changed.features, [outfitLooks.id]: saveLook(changed, name, true) },
  };
  assert.equal(savedLooks(updated).filter((l) => l.name === name).length, 1);
  assert.equal(savedLooks(updated).find((l) => l.name === name)?.base, "Base layer");
  const next = wearLook(updated, { ...look, layers: { [first.id]: style } });
  assert.deepEqual(outfitLayers.read(next.features)?.layers[second.id], { show: false });
  assert.deepEqual(outfitLayers.read(next.features)?.layers[first.id], style);
  assert.throws(() => styleGarment(original, "missing", style));
});
