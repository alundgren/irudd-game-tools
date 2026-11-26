// Guide fibres: a sweep with figure.fibres is replaced by seeded strands that
// follow its rings, rooted on the parent's surface, after the face fits seat
// it. The same seed grows the same strands and a part that is not an
// unpainted sweep is refused. Pelt locks are creature-plan.test.ts's. The
// four-preset parity of portrait-dockworker and the conductors is the slow
// gate's.

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
const guide = "p-left-back-fringe";
const isMesh = (o: T.Object3D | undefined): o is T.Mesh => o instanceof T.Mesh;

/** portrait-dockworker, with `edit` applied to the features of part `id`. */
function dockworker(id?: string, edit?: (features: Mutable) => void, added: string[] = []) {
  const raw: unknown = JSON.parse(
    readFileSync(join(fixturesDir, "portrait-dockworker.json"), "utf8"),
  );
  assert.ok(isObject(raw) && Array.isArray(raw["parts"]) && Array.isArray(raw["requires"]));
  for (const part of raw["parts"])
    if (isObject(part) && part["id"] === id && isObject(part["features"])) edit?.(part["features"]);
  for (const feature of added) raw["requires"].push({ feature, version: 1 });
  return raw;
}
function read(raw: unknown): CharacterDocument {
  const result = readDocument(raw, { registry: familyRegistry });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}
function strands(doc: CharacterDocument, game = false): Float32Array {
  const built = buildCharacter(doc, { materials: clayMaterials(), game });
  try {
    const object = built.parts.get(guide)?.object;
    assert.ok(isMesh(object));
    const position = object.geometry.getAttribute("position");
    assert.ok(object.geometry.getAttribute("color"), "strands carry their shades by vertex");
    return Float32Array.from({ length: position.count * 3 }, (_, i) =>
      position.getComponent(Math.floor(i / 3), i % 3),
    );
  } finally {
    built.dispose();
  }
}

test("a guide grows the same seeded strands, fewer in a game build", () => {
  const doc = read(dockworker());
  const first = strands(doc);
  // Twenty strands of six-sided rings along every station.
  assert.equal((first.length / 3) % (20 * 6), 0);
  assert.deepEqual(strands(doc), first);
  const reseeded = read(
    dockworker(guide, (f) => {
      const fibres = f["figure.fibres"];
      assert.ok(isObject(fibres));
      fibres["seed"] = 7;
    }),
  );
  assert.notDeepEqual(strands(reseeded), first);
  assert.ok(strands(doc, true).length < first.length, "a game budget keeps fewer strands");
});

test("fibres are refused on a part that is not an unpainted sweep", () => {
  const raw = dockworker(
    "p-head",
    (f) => (f["figure.fibres"] = { count: 8, wave: 0, fall: 0, grey: 0, rooted: true, seed: 1 }),
  );
  const doc = read(raw);
  assert.throws(
    () => buildCharacter(doc, { materials: clayMaterials() }),
    /has fibres but is not an unpainted sweep/,
  );
});
