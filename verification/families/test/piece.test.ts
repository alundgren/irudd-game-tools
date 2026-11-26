import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import * as T from "three";
import {
  buildCharacter,
  buildView,
  bundledAssetNamed,
  clayMaterials,
  exportCharacter,
  exportKitSheets,
  exportPaintSheets,
  skinCharacter,
} from "@irudd/character";
import { readDocument, type CharacterDocument } from "@irudd/document";
import { installNodeExporter } from "../src/node-exporter.js";
import { fixturesDir } from "../src/paths.js";
import { familyRegistry, prepareForm, UnsupportedForm } from "../src/prepare.js";

installNodeExporter();

type Mutable = { [key: string]: unknown };
const isObject = (v: unknown): v is Mutable => typeof v === "object" && v !== null;
const isMesh = (o: T.Object3D | undefined): o is T.Mesh => o instanceof T.Mesh;
const isSkinned = (o: T.Object3D | undefined): o is T.SkinnedMesh => o instanceof T.SkinnedMesh;

function aviator(
  edit?: (features: Mutable) => void,
  added: ReadonlyArray<string> = ["figure.sculpt"],
): CharacterDocument {
  const raw: unknown = JSON.parse(readFileSync(join(fixturesDir, "tucked-aviator.json"), "utf8"));
  assert.ok(isObject(raw) && Array.isArray(raw["parts"]));
  for (const part of raw["parts"])
    if (isObject(part) && part["label"] === "head" && isObject(part["features"]))
      edit?.(part["features"]);
  const requires = raw["requires"];
  if (edit && Array.isArray(requires))
    for (const feature of added)
      if (!requires.some((r) => isObject(r) && r["feature"] === feature))
        requires.push({ feature, version: 1 });
  const read = readDocument(raw, { registry: familyRegistry });
  if (!read.ok) throw new Error(JSON.stringify(read.diagnostics));
  return read.value;
}

function headOf(doc: CharacterDocument) {
  const built = buildCharacter(doc, { materials: clayMaterials() });
  const head = [...built.parts.values()].find((p) => p.part.piece?.piece === "head");
  assert.ok(head);
  return { built, head: head.object };
}

const faceOf = (head: T.Object3D): T.Mesh => {
  const face = head.children.find((c) => c.userData["faceSurface"]);
  assert.ok(isMesh(face));
  return face;
};

test("a built-in head carries its neck, ears, face and hair", () => {
  const { built, head } = headOf(aviator());
  try {
    assert.ok(!isMesh(head), "a piece is a group of the library's meshes");
    const flags = (key: string) => head.children.filter((c) => c.userData[key]).length;
    assert.equal(flags("neckSurface"), 1);
    assert.equal(flags("earSurface"), 2);
    assert.equal(flags("faceSurface"), 1);
    assert.equal(flags("baseHair"), 12, "a coiled crop is a cap, ten coils and a crown");
    assert.ok(built.faces.has(faceOf(head)), "the face exports as its own surface");
    const rig = skinCharacter(built);
    try {
      const face = rig.actor.children.find(
        (o) => isSkinned(o) && o.userData["faceSurface"] === true,
      );
      assert.ok(isSkinned(face));
      assert.notEqual(face.morphTargetDictionary?.["Blink"], undefined);
    } finally {
      rig.dispose();
    }
  } finally {
    built.dispose();
  }
});

test("a head's sculpt and adult profile reshape its face and set its ears back", () => {
  const plain = headOf(aviator());
  const shaped = headOf(
    aviator((features) => {
      const piece = features["figure.piece"];
      assert.ok(isObject(piece));
      piece["cranialProfile"] = "adult";
      features["figure.sculpt"] = { sculpt: { chin: 1.4, smile: 1.3 } };
    }),
  );
  try {
    const ear = (h: T.Object3D) => h.children.find((c) => c.userData["earSurface"])?.position.z;
    const a = ear(plain.head);
    const b = ear(shaped.head);
    assert.ok(a !== undefined && b !== undefined);
    assert.ok(Math.abs(a - b - 0.013) < 1e-9, "an adult skull sets the ears 13 mm back");
    const before = faceOf(plain.head).geometry.getAttribute("position");
    const after = faceOf(shaped.head).geometry.getAttribute("position");
    assert.equal(before.count, after.count);
    let moved = 0;
    for (let i = 0; i < before.count; i++)
      if (Math.abs(before.getY(i) - after.getY(i)) > 1e-4) moved++;
    assert.ok(moved > 100, "the sculpt moves the chin and mouth corners");
  } finally {
    plain.built.dispose();
    shaped.built.dispose();
  }
});

test("a look or sculpt on a part that cannot wear one is refused", () => {
  const legacy = (part: Mutable) => ({
    appearance: { palette: "Tide", skin: "#c9997c", hair: "Crop", hairColor: "#3a2e28" },
    parts: [
      { id: "head", shape: "head", position: [0, 1.42, 0], size: [1, 1, 1], rotation: [0, 0, 0] },
      {
        id: "lump",
        shape: "ellipsoid",
        parent: "head",
        position: [0, 0.2, 0],
        size: [0.1, 0.1, 0.1],
        rotation: [0, 0, 0],
        color: "#887766",
        ...part,
      },
    ],
  });
  assert.ok(prepareForm("plain-head", legacy({})).document);
  for (const extra of [
    { look: { palette: "Tide", skin: "#c9997c", hair: "Crop", hairColor: "#3a2e28" } },
    { sculpt: { jaw: 1.2 } },
    { cranialProfile: "adult" },
  ])
    assert.throws(() => prepareForm("odd-lump", legacy(extra)), UnsupportedForm);
});

test("a head's front fit and profile move its face, and an unported overlay is refused", () => {
  const plain = headOf(aviator());
  const fitted = headOf(
    aviator(
      (features) => {
        features["figure.front-fit"] = {
          passes: [
            {
              pins: [
                { at: [-0.3, 0.1, 0.4], shift: [0, 0] },
                { at: [0.3, 0.1, 0.4], shift: [0, 0] },
                { at: [0, -0.3, 0.45], shift: [0, -0.04] },
              ],
              radius: 0.3,
              amount: 1,
            },
          ],
        };
        features["figure.profile-fit"] = {
          curve: [
            [0, 0],
            [0.4, 0.12],
            [0.7, 0.05],
            [1, 0.02],
          ],
          amount: 1,
        };
      },
      ["figure.front-fit", "figure.profile-fit"],
    ),
  );
  try {
    const before = faceOf(plain.head).geometry.getAttribute("position");
    const after = faceOf(fitted.head).geometry.getAttribute("position");
    let lowered = 0;
    let deepened = 0;
    for (let i = 0; i < before.count; i++) {
      if (after.getY(i) < before.getY(i) - 1e-4) lowered++;
      if (Math.abs(after.getZ(i) - before.getZ(i)) > 1e-4) deepened++;
    }
    assert.ok(lowered > 100, "the front pass lowers the chin");
    assert.ok(deepened > 100, "the profile changes the face's depth");
    assert.notEqual(
      faceOf(plain.head).geometry,
      faceOf(fitted.head).geometry,
      "a fitted head no longer shares the library's face",
    );
  } finally {
    plain.built.dispose();
    fitted.built.dispose();
  }
  const legacy = {
    appearance: { palette: "Tide", skin: "#c9997c", hair: "Crop", hairColor: "#3a2e28" },
    parts: [
      {
        id: "head",
        shape: "head",
        position: [0, 1.42, 0],
        size: [1, 1, 1],
        rotation: [0, 0, 0],
        frontFits: [{ pins: [], radius: 0.3, amount: 1, overlay: "face-" + "0".repeat(64) }],
      },
    ],
  };
  assert.throws(() => prepareForm("overlaid-head", legacy), UnsupportedForm);
});

test("fitted eyes add lids, sclera and a gazing iris, and the face stops blinking itself", () => {
  const doc = aviator(
    (features) => {
      features["figure.eyes"] = {
        color: "#574331",
        opening: 1,
        width: 1,
        spacing: 1,
        lift: 0,
        iris: 1,
      };
    },
    ["figure.eyes"],
  );
  const { built, head } = headOf(doc);
  try {
    const face = faceOf(head);
    assert.deepEqual(
      face.children.map((c): unknown => c.userData["eyePiece"]),
      ["Lids", "Sclera", "Iris"],
    );
    assert.equal(face.userData["fittedEyes"], true);
    const rig = skinCharacter(built);
    try {
      const iris = rig.actor.children.find((o) => o.userData["eyePiece"] === "Iris");
      assert.ok(isSkinned(iris));
      assert.notEqual(iris.morphTargetDictionary?.["LookLeft"], undefined);
      const skinnedFace = rig.actor.children.find(
        (o) => isSkinned(o) && o.userData["faceSurface"] === true,
      );
      assert.ok(isSkinned(skinnedFace));
      const blink = skinnedFace.morphTargetDictionary?.["Blink"];
      assert.ok(blink !== undefined);
      const delta = skinnedFace.geometry.morphAttributes["position"]?.[blink];
      assert.ok(delta && delta.array.every((v) => v === 0), "the lids blink, not the face");
    } finally {
      rig.dispose();
    }
  } finally {
    built.dispose();
  }
});

test("a textured export credits the faces sheet a visible built-in head draws", async () => {
  const faces = bundledAssetNamed("faces");
  assert.ok(faces);
  const doc = aviator();
  assert.deepEqual(exportKitSheets(doc), [faces.digest]);
  assert.ok(!exportPaintSheets(doc).includes(faces.digest), "it carries no turnaround panels");
  const hidden = aviator((f) => (f["outfit.wear"] = { visibleIn: ["Anatomy"] }), ["outfit.wear"]);
  assert.notEqual(buildView(hidden).outfit, "Anatomy");
  assert.deepEqual(exportKitSheets(hidden), []);
  const clay = await exportCharacter(doc, { preset: "clay", revision: 1, build: "test" });
  assert.equal(clay.provenance.artwork, undefined, "a uniform clay export claims no sheet");
});
