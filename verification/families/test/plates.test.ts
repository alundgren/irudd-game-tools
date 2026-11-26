// Grown plates and held arms: figure.plate-field on a carrier sweep,
// figure.plate-site on each plate cage, figure.horn-swatch for its tile of
// the horn sheet, and motion.hold on an arm that keeps its rest pose. A
// previous reader diagnoses them as capabilities, sites must be distinct
// within their carrier's field, a finished plate samples its swatch's tile,
// an animated plated axis keeps its rings and sockets through game
// simplification, and a held arm gets no generated shoulder motion. The
// four-preset parity of four-hand-courier and the moraine forms is the slow
// gate's.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import * as T from "three";
import { buildCharacter, skinCharacter, type MaterialSource } from "@irudd/character";
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
const carrier = "p-courier-chest-shell";
const plate = "p-courier-chest-shell-plate-1-2";
const arm = "p-left-upper-arm-copy";

/** four-hand-courier, with `edit` applied to the features of part `id`. */
function courier(id?: string, edit?: (features: Mutable) => void): unknown {
  const value: unknown = JSON.parse(
    readFileSync(join(fixturesDir, "four-hand-courier.json"), "utf8"),
  );
  assert.ok(isObject(value) && Array.isArray(value["parts"]));
  for (const part of value["parts"])
    if (isObject(part) && part["id"] === id && isObject(part["features"])) edit?.(part["features"]);
  return value;
}
/** The document without its portrait plates, which a finished build in Node cannot paint. */
function unplated(value: unknown): unknown {
  assert.ok(isObject(value) && Array.isArray(value["parts"]) && Array.isArray(value["assets"]));
  for (const part of value["parts"]) {
    const fit =
      isObject(part) && isObject(part["features"])
        ? part["features"]["figure.profile-fit"]
        : undefined;
    if (isObject(fit)) delete fit["side"];
    const front =
      isObject(part) && isObject(part["features"])
        ? part["features"]["figure.front-fit"]
        : undefined;
    if (isObject(front) && Array.isArray(front["passes"]))
      for (const pass of front["passes"]) if (isObject(pass)) delete pass["plate"];
  }
  value["assets"] = value["assets"].filter((a) => !isObject(a) || a["role"] !== "portrait-plate");
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
/** One material per colour and finish, as the textured presets supply them. */
function finishedMaterials(): MaterialSource {
  const made = new Map<string, T.Material>();
  return (color, finish) => {
    const key = color + finish;
    let m = made.get(key);
    if (!m) made.set(key, (m = new T.MeshStandardMaterial({ color })));
    return m;
  };
}

test("a previous reader diagnoses plates and held arms as capabilities", () => {
  const added = new Set([
    "figure.plate-field",
    "figure.plate-site",
    "figure.horn-swatch",
    "motion.hold",
  ]);
  const previous = createRegistry({ features: familyFeatures.filter((f) => !added.has(f.id)) });
  const result = readDocument(courier(), { registry: previous });
  assert.ok(!result.ok);
  assert.ok(result.diagnostics.every((d) => d.code === "unknown-feature"));
  const named = result.diagnostics.map((d) => JSON.stringify(d.detail));
  assert.deepEqual(
    named.sort((a, b) => a.localeCompare(b)),
    [...added]
      .map((feature) => JSON.stringify({ feature, version: 1 }))
      .sort((a, b) => a.localeCompare(b)),
  );
});

test("each plate needs its own site within its carrier's field", () => {
  const refused = (value: unknown) =>
    assert.throws(
      () => buildCharacter(read(value), { materials: finishedMaterials() }),
      /needs its own site on its carrier's plate field/,
    );
  refused(courier(plate, (f) => (field(f, "figure.plate-site")["column"] = 0)));
  refused(courier(plate, (f) => (field(f, "figure.plate-site")["row"] = 4)));
  refused(courier(carrier, (f) => delete f["figure.plate-field"]));
  assert.throws(
    () =>
      buildCharacter(read(courier(plate, (f) => (f["figure.plate-field"] = courierField()))), {
        materials: finishedMaterials(),
      }),
    /has a plate field but is not a sweep/,
  );
  const malformed = readDocument(
    courier(carrier, (f) => (field(f, "figure.plate-field")["columns"] = 2)),
    { registry: familyRegistry },
  );
  assert.ok(!malformed.ok);
});

function courierField(): unknown {
  const value = courier();
  assert.ok(isObject(value) && Array.isArray(value["parts"]));
  const part: unknown = value["parts"].find((p) => isObject(p) && p["id"] === carrier);
  assert.ok(isObject(part) && isObject(part["features"]));
  return part["features"]["figure.plate-field"];
}

test("a finished plate samples its swatch's tile, toned by vertex", () => {
  for (const swatch of [0, 1, 2, 3]) {
    const doc = read(unplated(courier(plate, (f) => (f["figure.horn-swatch"] = { swatch }))));
    const built = buildCharacter(doc, { materials: finishedMaterials(), finish: {} });
    try {
      const mesh = built.parts.get(plate)?.object;
      assert.ok(isMesh(mesh));
      const uv = mesh.geometry.getAttribute("uv");
      const [x, y] = [swatch % 2, Math.floor(swatch / 2)];
      for (let i = 0; i < uv.count; i++) {
        assert.ok(uv.getX(i) >= x / 2 && uv.getX(i) <= (x + 1) / 2, `swatch ${swatch} u`);
        assert.ok(uv.getY(i) >= y / 2 && uv.getY(i) <= (y + 1) / 2, `swatch ${swatch} v`);
      }
      assert.ok(mesh.geometry.getAttribute("color"));
      const material: T.Material | T.Material[] = mesh.material;
      assert.ok(material instanceof T.MeshStandardMaterial && material.vertexColors);
      assert.equal(material.roughness, 0.72);
    } finally {
      built.dispose();
    }
  }
});

test("an animated plated axis keeps its rings and plate sockets in a game build", () => {
  const anchors = (role: string) => {
    const doc = read(unplated(courier(carrier, (f) => (f["motion.role"] = { role }))));
    const built = buildCharacter(doc, { materials: finishedMaterials(), finish: {}, game: true });
    try {
      const count = (id: string) => {
        const mesh = built.parts.get(id)?.object;
        assert.ok(isMesh(mesh));
        const pins = mesh.geometry.getAttribute("lodAnchor");
        let n = 0;
        for (let i = 0; pins && i < pins.count; i++) n += pins.getX(i);
        return n;
      };
      return { carrier: count(carrier), plate: count(plate) };
    } finally {
      built.dispose();
    }
  };
  const rigid = anchors("rigid");
  const tail = anchors("tail");
  assert.equal(rigid.plate, 0, "a rigid carrier's plates are simplified freely");
  assert.ok(tail.plate > 0, "a tail's plates keep their sockets");
  assert.ok(tail.carrier > rigid.carrier, "a tail keeps its rings");
});

test("a held arm gets no generated shoulder motion", () => {
  const shoulderTracks = (value: unknown) => {
    const built = buildCharacter(read(value), { materials: finishedMaterials() });
    const rig = skinCharacter(built);
    try {
      const bone = rig.regions.get(arm)?.bones[0];
      assert.ok(bone);
      const walk = rig.clips.find((c) => c.name === "Walk");
      assert.ok(walk);
      return walk.tracks.filter((t) => t.name === `${bone.name}.quaternion`).length;
    } finally {
      rig.dispose();
      built.dispose();
    }
  };
  assert.equal(shoulderTracks(courier()), 0);
  assert.equal(shoulderTracks(courier(arm, (f) => delete f["motion.hold"])), 1);
});
