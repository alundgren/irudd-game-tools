import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import * as T from "three";
import { buildCharacter, clayMaterials, skinCharacter } from "@irudd/character";
import { readDocument, type CharacterDocument } from "@irudd/document";
import { fixturesDir } from "../src/paths.js";
import { familyRegistry } from "../src/prepare.js";

type Mutable = { [key: string]: unknown };
const isObject = (v: unknown): v is Mutable => typeof v === "object" && v !== null;
const isMesh = (o: T.Object3D | undefined): o is T.Mesh => o instanceof T.Mesh;
const isSkinned = (o: T.Object3D | undefined): o is T.SkinnedMesh => o instanceof T.SkinnedMesh;

function cape(edit?: (cut: Mutable) => void, name = "four-arm-cape"): CharacterDocument {
  const raw: unknown = JSON.parse(readFileSync(join(fixturesDir, `${name}.json`), "utf8"));
  assert.ok(isObject(raw) && Array.isArray(raw["parts"]));
  for (const part of raw["parts"]) {
    const mantle =
      isObject(part) && isObject(part["features"]) && part["features"]["figure.mantle"];
    if (edit && isObject(mantle) && isObject(mantle["cut"])) edit(mantle["cut"]);
  }
  const read = readDocument(raw, { registry: familyRegistry });
  if (!read.ok) throw new Error(JSON.stringify(read.diagnostics));
  return read.value;
}

test("a cape is a sewn two-sided panel whose sides follow the arms", () => {
  const built = buildCharacter(cape(), { materials: clayMaterials() });
  try {
    const part = [...built.parts.values()].find((p) => p.part.mantle);
    const mesh = part?.object;
    assert.ok(isMesh(mesh));
    const geometry = mesh.geometry;
    assert.equal(geometry.getAttribute("position").count, 2 * 97 * 35);
    assert.equal(geometry.getAttribute("color"), undefined, "clay drops the trim colours");
    const rig = skinCharacter(built);
    try {
      const surface = rig.actor.children.find(isSkinned);
      assert.ok(isSkinned(surface));
      const w = surface.geometry.getAttribute("skinWeight");
      let armed = 0;
      for (let i = 0; i < w.count; i++) if (w.getZ(i) > 0.5) armed++;
      assert.ok(armed > 100, "arm joints drive the cape's sides");
    } finally {
      rig.dispose();
    }
  } finally {
    built.dispose();
  }
});

test("a cut outside its bounds or missing its kind's fields is refused", () => {
  for (const change of [
    (c: Mutable) => (c["opening"] = 1),
    (c: Mutable) => (c["flare"] = 3),
    (c: Mutable) => (c["folds"] = 1.5),
    (c: Mutable) => (c["kind"] = "Skirt"),
  ])
    assert.throws(() => cape(change));
});

const skirt = (edit?: (cut: Mutable) => void) => cape(edit, "relay-wardrobe");

test("a skirt hangs from a grid of cloth joints that the walk moves", () => {
  const built = buildCharacter(skirt(), { materials: clayMaterials() });
  try {
    const rig = skinCharacter(built);
    try {
      const cloth = rig.skeleton.bones.filter((b) => b.userData["garmentSupport"] === true);
      assert.equal(cloth.length, 13 * 12, "13 rows of 12 stations");
      const walk = rig.clips.find((c) => c.name === "Walk");
      assert.ok(walk);
      assert.ok(
        walk.tracks.some((t) => /_Cloth_\d+_\d+\.position$/.test(t.name)),
        "the walk carries cloth joint motion",
      );
    } finally {
      rig.dispose();
    }
  } finally {
    built.dispose();
  }
});

test("a skirt outline or fold setting outside its bounds is refused", () => {
  for (const change of [
    (c: Mutable) =>
      (c["outline"] = [
        [0, 1],
        [1, 1.2],
      ]),
    (c: Mutable) =>
      (c["outline"] = [
        [0, 1],
        [0.5, 1.1],
        [0.4, 1.2],
        [1, 1.3],
      ]),
    (c: Mutable) =>
      (c["outline"] = [
        [0, 1.1],
        [0.5, 1.1],
        [1, 1.3],
      ]),
    (c: Mutable) =>
      (c["outline"] = [
        [0, 1],
        [0.5, 0.2],
        [1, 1.3],
      ]),
    (c: Mutable) => (c["gather"] = 0.4),
    (c: Mutable) => (c["tiers"] = 7),
    (c: Mutable) => (c["waistClearance"] = 0.1),
  ])
    assert.throws(() => skirt(change));
});
