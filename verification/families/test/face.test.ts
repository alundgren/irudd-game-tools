import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import * as T from "three";
import { buildCharacter, buildView, clayMaterials, skinCharacter } from "@irudd/character";
import { readDocument, type CharacterDocument } from "@irudd/document";
import { fixturesDir } from "../src/paths.js";
import { familyRegistry } from "../src/prepare.js";

type Mutable = { [key: string]: unknown };
const isObject = (v: unknown): v is Mutable => typeof v === "object" && v !== null;
const isMesh = (o: T.Object3D | undefined): o is T.Mesh => o instanceof T.Mesh;

function biologist(edit?: (part: Mutable, features: Mutable) => void): CharacterDocument {
  const raw: unknown = JSON.parse(
    readFileSync(join(fixturesDir, "coastal-biologist.json"), "utf8"),
  );
  assert.ok(isObject(raw) && Array.isArray(raw["parts"]));
  for (const part of raw["parts"])
    if (edit && isObject(part) && isObject(part["features"])) edit(part, part["features"]);
  const read = readDocument(raw, { registry: familyRegistry });
  if (!read.ok) throw new Error(JSON.stringify(read.diagnostics));
  return read.value;
}

test("a traced face is its own skinned mesh with expressions and a blink", () => {
  const built = buildCharacter(biologist(), { materials: clayMaterials() });
  try {
    assert.equal(built.faces.size, 1);
    const rig = skinCharacter(built);
    try {
      const faces = rig.actor.children.filter((o) => o.userData["faceSurface"]);
      assert.equal(faces.length, 1);
      const face = faces[0];
      assert.ok(face instanceof T.SkinnedMesh && face.name === "Face_head_and_neck_1");
      assert.deepEqual(Object.keys(face.morphTargetDictionary ?? {}), [
        "Blink",
        "Smile",
        "BrowLift",
      ]);
      const idle = rig.clips.find((c) => c.name === "Idle");
      assert.ok(idle?.tracks.some((t) => t.name === face.name + ".morphTargetInfluences[Blink]"));
    } finally {
      rig.dispose();
    }
  } finally {
    built.dispose();
  }
});

test("a fitted garment is eased outside its body", () => {
  const shell = (doc: CharacterDocument) => {
    const built = buildCharacter(doc, { materials: clayMaterials() });
    try {
      const part = [...built.parts.values()].find((p) => p.part.label === "garment shell");
      const mesh = part?.object;
      assert.ok(isMesh(mesh));
      return Float32Array.from(mesh.geometry.getAttribute("position").array);
    } finally {
      built.dispose();
    }
  };
  const fitted = shell(biologist());
  const loose = shell(biologist((_, f) => delete f["outfit.fit"]));
  assert.equal(fitted.length, loose.length);
  assert.ok(fitted.some((v, i) => Math.abs(v - (loose[i] ?? 0)) > 1e-4));
});

test("landmarks, anatomy and fit on a part that cannot carry them are refused", () => {
  const refuse = (edit: (part: Mutable, features: Mutable) => void, pattern: RegExp) =>
    assert.throws(() => buildView(biologist(edit)), pattern);
  refuse((part, f) => {
    const paint = f["figure.paint"];
    if (part["label"] === "head and neck" && isObject(paint)) delete f["figure.anatomy"];
  }, /facial landmarks but is not a face/);
  refuse((_, f) => {
    if (!isObject(f["figure.sweep"])) f["figure.anatomy"] = { region: "face" };
  }, /anatomical region but is not a sweep/);
  refuse((part, f) => {
    if (part["parent"] === null) f["outfit.fit"] = {};
  }, /fitted garment without a parent/);
});

test("facial landmarks rise from chin to eyes", () => {
  assert.throws(() =>
    biologist((_, f) => {
      const paint = f["figure.paint"];
      if (isObject(paint) && isObject(paint["portrait"]))
        paint["portrait"] = { ...paint["portrait"], nose: 0.9, eyes: 0.5 };
    }),
  );
});
