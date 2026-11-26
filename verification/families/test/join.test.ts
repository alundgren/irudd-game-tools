import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import * as T from "three";
import { buildCharacter, buildView, clayMaterials } from "@irudd/character";
import { readDocument, type CharacterDocument } from "@irudd/document";
import { fixturesDir } from "../src/paths.js";
import { familyRegistry } from "../src/prepare.js";

type Mutable = { [key: string]: unknown };
const isObject = (v: unknown): v is Mutable => typeof v === "object" && v !== null;
const isMesh = (o: T.Object3D | undefined): o is T.Mesh => o instanceof T.Mesh;

function quayside(edit?: (features: Mutable, label: string) => void): CharacterDocument {
  const raw: unknown = JSON.parse(readFileSync(join(fixturesDir, "quayside-fitted.json"), "utf8"));
  assert.ok(isObject(raw) && Array.isArray(raw["parts"]));
  for (const part of raw["parts"]) {
    if (!isObject(part) || !isObject(part["features"])) continue;
    const label = part["label"];
    if (edit && "figure.join" in part["features"] && typeof label === "string")
      edit(part["features"], label);
  }
  const read = readDocument(raw, { registry: familyRegistry });
  if (!read.ok) throw new Error(JSON.stringify(read.diagnostics));
  return read.value;
}

function positionsOf(doc: CharacterDocument, label: string): Float32Array {
  const built = buildCharacter(doc, { materials: clayMaterials() });
  try {
    const part = [...built.parts.values()].find((p) => p.part.label === label);
    const mesh = part?.object;
    assert.ok(isMesh(mesh), label);
    return Float32Array.from(mesh.geometry.getAttribute("position").array);
  } finally {
    built.dispose();
  }
}

test("joins move cage roots and path strips onto their carriers and share ownership", () => {
  const joined = quayside();
  const loose = quayside((features) => delete features["figure.join"]);
  for (const label of ["broad left balancing fin", "dorsal swept leading ridge"]) {
    const a = positionsOf(joined, label);
    const b = positionsOf(loose, label);
    assert.equal(a.length, b.length);
    assert.ok(
      a.some((v, i) => Math.abs(v - (b[i] ?? 0)) > 1e-4),
      `${label} is seated`,
    );
  }
  const built = buildCharacter(joined, { materials: clayMaterials() });
  try {
    const fin = [...built.parts.values()].find((p) => p.part.label === "broad left balancing fin");
    const mesh = fin?.object;
    assert.ok(fin && isMesh(mesh));
    const owners = built.blendOwners.get(mesh);
    assert.ok(owners, "the fin carries joined ownership");
    assert.ok(owners.ids.includes(fin.part.parent ?? ""), "the carrier owns the root");
  } finally {
    built.dispose();
  }
});

test("a join naming a patch its part does not have is refused", () => {
  const refuse = (edit: (features: Mutable) => void, what: string) =>
    assert.throws(
      () => buildView(quayside((features) => edit(features))),
      /invalid surface attachment/,
      what,
    );
  refuse((f) => {
    if (isObject(f["figure.cage"])) f["figure.join"] = { depth: 0.01, faces: [255] };
  }, "a cage face out of range");
  refuse((f) => {
    if (isObject(f["figure.sweep"])) f["figure.join"] = { depth: 0.006, end: "base" };
  }, "a scute base on a sweep");
  refuse((f) => {
    if (isObject(f["figure.cage"])) f["figure.join"] = { depth: 0.01, end: "first" };
  }, "a sweep end on a cage");
});

test("a join payload names either faces or an end, at a bounded depth", () => {
  for (const payload of [
    { depth: 0.01 },
    { depth: 0.01, end: "first", faces: [1] },
    { depth: 0.01, faces: [1, 1] },
    { depth: 0.2, end: "last" },
  ])
    assert.throws(() => quayside((f) => (f["figure.join"] = payload)), JSON.stringify(payload));
});
