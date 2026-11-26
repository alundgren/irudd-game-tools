// Portrait depth and hair caps: figure.portrait-depth refines a traced front
// by depth pins and a fitted field, and figure.hair-cap separates the hair
// painted on a face into a removable shell, or keeps only that hair on a hair
// layer seated on its head. A previous reader diagnoses both as capabilities,
// malformed fields and parts that cannot take them are refused, and the depth
// moves the face it refines. The four-preset parity of composed-portrait,
// portrait-gaze and fitted-portrait is the slow gate's.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import * as T from "three";
import { buildCharacter, clayMaterials } from "@irudd/character";
import {
  createRegistry,
  familyFeatures,
  readDocument,
  type CharacterDocument,
} from "@irudd/document";
import { fixturesDir } from "../src/paths.js";
import { familyRegistry } from "../src/prepare.js";

type Mutable = { [key: string]: unknown };
const isObject = (v: unknown): v is Mutable => typeof v === "object" && v !== null;
const isMesh = (o: T.Object3D | undefined): o is T.Mesh => o instanceof T.Mesh;
const face = "p-head-and-neck";
const hair = "p-head-and-neck-hair";

/** A fixture's raw JSON, with `edit` applied to the features of part `id`. */
function raw(
  name: string,
  id?: string,
  edit?: (features: Mutable) => void,
  added: string[] = [],
): unknown {
  const value: unknown = JSON.parse(readFileSync(join(fixturesDir, name + ".json"), "utf8"));
  assert.ok(isObject(value) && Array.isArray(value["parts"]) && Array.isArray(value["requires"]));
  for (const part of value["parts"])
    if (isObject(part) && part["id"] === id && isObject(part["features"])) edit?.(part["features"]);
  for (const feature of added) value["requires"].push({ feature, version: 1 });
  return value;
}
function read(value: unknown): CharacterDocument {
  const result = readDocument(value, { registry: familyRegistry });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}
function field(features: Mutable, key: string): Mutable {
  const inner = features[key];
  assert.ok(isObject(inner));
  return inner;
}
function clay(doc: CharacterDocument) {
  return buildCharacter(doc, { materials: clayMaterials() });
}
function positions(doc: CharacterDocument, id: string): Float32Array {
  const built = clay(doc);
  try {
    const object = built.parts.get(id)?.object;
    assert.ok(isMesh(object));
    const position = object.geometry.getAttribute("position");
    return Float32Array.from({ length: position.count * 3 }, (_, i) =>
      position.getComponent(Math.floor(i / 3), i % 3),
    );
  } finally {
    built.dispose();
  }
}

test("a previous reader diagnoses portrait depth and hair caps as capabilities", () => {
  const previous = createRegistry({
    features: familyFeatures.filter(
      (f) => f.id !== "figure.portrait-depth" && f.id !== "figure.hair-cap",
    ),
  });
  for (const name of ["composed-portrait", "fitted-portrait"]) {
    const result = readDocument(raw(name), { registry: previous });
    assert.ok(!result.ok);
    assert.deepEqual(
      [...new Set(result.diagnostics.map((d) => d.code))],
      ["unknown-feature"],
      JSON.stringify(result.diagnostics),
    );
  }
});

test("malformed fields are refused when the document reads", () => {
  const refused = (name: string, id: string, edit: (f: Mutable) => void) => {
    const result = readDocument(raw(name, id, edit), { registry: familyRegistry });
    assert.ok(!result.ok, "the document should not read");
  };
  refused("composed-portrait", face, (f) => {
    const cap = field(f, "figure.hair-cap");
    cap["mask"] = String(cap["mask"]).slice(4);
  });
  refused("composed-portrait", face, (f) => (field(f, "figure.hair-cap")["scalp"] = "d1885e"));
  refused("composed-portrait", face, (f) => (f["figure.portrait-depth"] = {}));
  refused("composed-portrait", face, (f) => {
    const pins = field(f, "figure.portrait-depth")["pins"];
    assert.ok(Array.isArray(pins));
    const first: unknown = pins[0];
    field(f, "figure.portrait-depth")["pins"] = Array.from({ length: 25 }, () => first);
  });
  refused("fitted-portrait", face, (f) => {
    const depth = field(field(f, "figure.portrait-depth"), "field");
    depth["values"] = String(depth["values"]).replace(/^./, "=");
  });
});

test("parts that cannot take a cap or a depth field are refused", () => {
  const refused = (value: unknown, pattern: RegExp) =>
    assert.throws(() => clay(read(value)), pattern);
  // A source hair cap needs a hair layer.
  refused(
    raw("fitted-portrait", hair, (f) => delete f["figure.head-layer"]),
    /keeps only a source hair cap but is not a swept hair layer/,
  );
  // A face's own cap cannot keep only the hair.
  refused(
    raw("composed-portrait", face, (f) => (field(f, "figure.hair-cap")["sourceOnly"] = true)),
    /keeps only a source hair cap/,
  );
  // A cap needs a traced face.
  refused(
    raw("composed-portrait", face, (f) => delete field(f, "figure.paint")["portrait"]),
    /has a hair cap but is not a traced face/,
  );
  // A fitted field needs a face traced over most of its binding.
  refused(
    raw("fitted-portrait", face, (f) => {
      const paint = field(f, "figure.paint");
      paint["height"] = Number(paint["height"]) * 4;
    }),
    /has a fitted depth but is not a full traced face/,
  );
  // A capped face grows no guide fibres.
  refused(
    raw(
      "composed-portrait",
      face,
      (f) => (f["figure.fibres"] = { count: 8, wave: 0, fall: 0, grey: 0, rooted: true, seed: 1 }),
      ["figure.fibres"],
    ),
    /has fibres but is not an unpainted sweep/,
  );
});

test("a capped face recedes under a removable hair shell", () => {
  const doc = read(raw("composed-portrait"));
  const built = clay(doc);
  try {
    const object = built.parts.get(face)?.object;
    assert.ok(isMesh(object));
    const shell = object.children.find((c) => c.name === "Source hairstyle");
    assert.ok(isMesh(shell) && shell.userData["baseHair"] === true);
    assert.equal(shell.material, object.material, "clay keeps one material");
  } finally {
    built.dispose();
  }
  const bare = read(raw("composed-portrait", face, (f) => delete f["figure.hair-cap"]));
  assert.notDeepEqual(positions(doc, face), positions(bare, face), "the head recedes");
});

test("a source hair layer keeps only its hair, seated on its head", () => {
  const doc = read(raw("fitted-portrait"));
  const built = clay(doc);
  try {
    const object = built.parts.get(hair)?.object;
    assert.ok(isMesh(object));
    assert.ok(object.geometry.getIndex(), "the cut hair is indexed");
    assert.ok(!object.children.some((c) => c.name === "Source hairstyle"));
  } finally {
    built.dispose();
  }
  // The face beneath is the same traced sweep left whole; the cut hair is a
  // lined shell of its own, not that sweep.
  assert.notEqual(positions(doc, hair).length, positions(doc, face).length);
});

test("depth pins and a fitted field move the face they refine", () => {
  for (const [name, key] of [
    ["composed-portrait", "pins"],
    ["fitted-portrait", "field"],
  ] as const) {
    const doc = read(raw(name));
    const flat = read(
      raw(name, face, (f) => {
        const depth = field(f, "figure.portrait-depth");
        delete depth[key];
        if (Object.keys(depth).length === 0) delete f["figure.portrait-depth"];
      }),
    );
    const before = positions(flat, face);
    const after = positions(doc, face);
    assert.equal(before.length, after.length);
    assert.notDeepEqual(before, after, `${name} ${key} moves the face`);
    // Depth only moves the front along Z.
    for (let i = 0; i < before.length; i += 3) {
      assert.equal(before[i], after[i]);
      assert.equal(before[i + 1], after[i + 1]);
    }
  }
});
