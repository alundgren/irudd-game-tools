import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import * as T from "three";
import {
  buildCharacter,
  buildView,
  clayMaterials,
  expeditionAtlas,
  exportPaintSheets,
  regionFit,
  savedLooks,
  visibleIn,
  wearLook,
} from "@irudd/character";
import { documentDigest, readDocument, type CharacterDocument } from "@irudd/document";
import { fixturesDir } from "../src/paths.js";
import { familyRegistry } from "../src/prepare.js";

type Mutable = { [key: string]: unknown };
const isObject = (v: unknown): v is Mutable => typeof v === "object" && v !== null;
const isMesh = (o: T.Object3D | undefined): o is T.Mesh => o instanceof T.Mesh;

function raw(name = "field-wardrobe"): Mutable {
  const value: unknown = JSON.parse(readFileSync(join(fixturesDir, `${name}.json`), "utf8"));
  assert.ok(isObject(value));
  return value;
}

function read(value: Mutable): CharacterDocument {
  const result = readDocument(value, { registry: familyRegistry });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

const features = (doc: Mutable): Mutable => {
  const f = doc["features"];
  assert.ok(isObject(f));
  return f;
};

function partId(doc: CharacterDocument, label: string): string {
  const part = doc.parts.find((p) => p.label === label);
  assert.ok(part, label);
  return part.id;
}

test("the pressure suit sheet follows the exported outfits", () => {
  const source = raw("pressure-poncho");
  const suited = read(source);
  assert.ok(exportPaintSheets(suited).includes(expeditionAtlas));
  assert.ok(!exportPaintSheets(suited, true).includes(expeditionAtlas));

  const f = features(source);
  f["outfit.wardrobe"] = { outfit: "Work clothes" };
  f["outfit.looks"] = { looks: [{ name: "Survey", base: "Pressure suit", layers: {} }] };
  const everyday = read(source);
  assert.ok(!exportPaintSheets(everyday).includes(expeditionAtlas));
  assert.ok(exportPaintSheets(everyday, true).includes(expeditionAtlas));
});

test("wearing a saved outfit restyles only its garments", () => {
  const doc = read(raw());
  const look = savedLooks(doc).find((l) => l.name === "Field tabard");
  assert.ok(look);
  const worn = wearLook(doc, look);
  assert.deepEqual(worn.parts, doc.parts, "no part, geometry or edit changes");
  const view = buildView(worn);
  const shown = (label: string) => {
    const part = view.byId.get(partId(doc, label));
    assert.ok(part);
    return visibleIn(view, part);
  };
  assert.equal(shown("tabard"), true);
  assert.equal(shown("garment shell"), false);
  assert.equal(shown("cape"), false, "a garment the outfit does not name is hidden");
  assert.notEqual(documentDigest(worn), documentDigest(doc));
});

test("a dye tints a garment's textured materials only", () => {
  const value = raw();
  const cape = partId(read(value), "cape");
  features(value)["outfit.layers"] = { layers: { [cape]: { dye: "#ff0000", show: true } } };
  const doc = read(value);
  const red = (finish: boolean) => {
    const built = buildCharacter(doc, {
      materials: clayMaterials(),
      ...(finish ? { finish: {} } : {}),
    });
    try {
      const mesh = built.parts.get(cape)?.object;
      assert.ok(isMesh(mesh));
      const material: T.Material | T.Material[] = mesh.material;
      assert.ok(material instanceof T.MeshStandardMaterial);
      return material.color.g === 0 && material.color.b === 0;
    } finally {
      built.dispose();
    }
  };
  assert.equal(red(true), true);
  assert.equal(red(false), false);
});

test("outfits outside their bounds are refused", () => {
  const doc = read(raw());
  const shell = partId(doc, "garment shell");
  for (const change of [
    (f: Mutable) => (f["outfit.layers"] = { layers: { [shell]: { order: 16 } } }),
    (f: Mutable) => (f["outfit.layers"] = { layers: { "p-missing": { show: true } } }),
    (f: Mutable) => (f["outfit.layers"] = { layers: { [shell]: { dye: "red" } } }),
    (f: Mutable) => {
      const looks = f["outfit.looks"];
      const list: unknown = isObject(looks) ? looks["looks"] : undefined;
      assert.ok(isObject(looks) && Array.isArray(list));
      const first: unknown = list[0];
      looks["looks"] = [first, first];
    },
    (f: Mutable) =>
      (f["outfit.looks"] = { looks: [{ name: " ", base: "Work clothes", layers: {} }] }),
  ]) {
    const value = raw();
    change(features(value));
    assert.equal(readDocument(value, { registry: familyRegistry }).ok, false);
  }
});

test("a pressure suit eases each region, recolours it and adds its kit", () => {
  const doc = read(raw("pressure-poncho"));
  const view = buildView(doc);
  const fitOf = (label: string) => {
    const part = view.byId.get(partId(doc, label));
    assert.ok(part);
    return regionFit(view, part);
  };
  assert.equal(fitOf("body")?.amount, 1.16);
  assert.equal(fitOf("right forearm")?.amount, 1.23);
  assert.equal(fitOf("head and neck")?.preserve, true);
  assert.equal(fitOf("poncho"), undefined, "a part with no clothing role is left as it is");
  const built = buildCharacter(doc, { materials: clayMaterials() });
  try {
    const kit = (label: string) =>
      built.parts
        .get(partId(doc, label))
        ?.object.children.filter((c) => isMesh(c) && c.userData["partId"] === undefined).length;
    assert.equal(kit("body"), 7, "chest pack, plate, side cells, straps and collar");
    assert.equal(kit("head and neck"), 4, "neck seal, ear cells and back plate");
    assert.equal(kit("right thigh"), 0);
  } finally {
    built.dispose();
  }
});

test("a base layer bares forearms and shins and keeps hands", () => {
  const value = raw("field-wardrobe");
  features(value)["outfit.wardrobe"] = { outfit: "Base layer" };
  const doc = read(value);
  const view = buildView(doc);
  const fitOf = (label: string) => {
    const part = view.byId.get(partId(doc, label));
    assert.ok(part);
    return regionFit(view, part);
  };
  const skin = view.appearance?.skin;
  assert.deepEqual(
    [fitOf("right forearm")?.bare, fitOf("right forearm")?.color],
    [true, skin],
    "a bare forearm is the skin colour",
  );
  assert.equal(fitOf("right hand")?.preserve, true);
  assert.equal(fitOf("body")?.amount, 0.9, "a clothed torso is cut down to the layer");
  assert.equal(fitOf("body")?.suit, false);
});
