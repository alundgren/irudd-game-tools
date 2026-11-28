import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import * as T from "three";
import { buildCharacter, clayMaterials, skinCharacter } from "@irudd/character";
import {
  createRegistry,
  familyFeatures,
  readDocument,
  type CharacterDocument,
} from "@irudd/document";
import { creatureLimbChains, creatureOrgan } from "@irudd/character/creature";
import { fixturesDir } from "../src/paths.js";
import { familyRegistry } from "../src/prepare.js";

type Mutable = { [key: string]: unknown };
const isObject = (v: unknown): v is Mutable => typeof v === "object" && v !== null;
const isMesh = (o: T.Object3D | undefined): o is T.Mesh => o instanceof T.Mesh;

function form(name: string, label?: string, edit?: (features: Mutable) => void): Mutable {
  const value: unknown = JSON.parse(readFileSync(join(fixturesDir, name + ".json"), "utf8"));
  assert.ok(isObject(value) && Array.isArray(value["parts"]));
  for (const part of value["parts"])
    if (isObject(part) && part["label"] === label && isObject(part["features"]))
      edit?.(part["features"]);
  return value;
}
function read(value: unknown): CharacterDocument {
  const result = readDocument(value, { registry: familyRegistry });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}
function idOf(doc: CharacterDocument, label: string): string {
  const part = doc.parts.find((p) => p.label === label);
  assert.ok(part, label);
  return part.id;
}

test("a previous reader diagnoses creature plans and their part features as capabilities", () => {
  const added = new Set([
    "creature.plan",
    "figure.undercoat",
    "creature.coat-zone",
    "creature.eye-surface",
    "figure.wing",
    "creature.organ",
    "creature.limb-chain",
  ]);
  const previous = createRegistry({ features: familyFeatures.filter((f) => !added.has(f.id)) });
  const result = readDocument(form("plan-8990"), { registry: previous });
  assert.ok(!result.ok);
  assert.ok(result.diagnostics.every((d) => d.code === "unknown-feature"));
  const named = new Set(result.diagnostics.map((d) => JSON.stringify(d.detail)));
  assert.deepEqual(
    [...named].sort((a, b) => a.localeCompare(b)),
    [...added]
      .map((feature) => JSON.stringify({ feature, version: 1 }))
      .sort((a, b) => a.localeCompare(b)),
  );
});

test("preparing a plan form resolves its organ names once", () => {
  assert.deepEqual(creatureOrgan("head 2"), {
    hide: "core",
    rank: "head",
    head: true,
    coatSwatch: true,
  });
  assert.deepEqual(creatureOrgan("body"), { hide: "core", rank: "spine", coatSwatch: true });
  assert.deepEqual(creatureOrgan("left leg 2 foot"), { extremity: true, leg: true });
  assert.deepEqual(creatureOrgan("right leg 1 thigh"), { rank: "haunch", leg: true });
  assert.deepEqual(creatureOrgan("lower beak"), { bill: "lower" });
  assert.deepEqual(creatureOrgan("beak"), { bill: "upper" });
  assert.deepEqual(creatureOrgan("dress cape"), { hide: "kit" });
  assert.deepEqual(creatureOrgan("left eye 3"), { eye: true });
  assert.equal(creatureOrgan("antenna"), undefined);
  const ids = new Map(
    [
      "left leg 2 thigh",
      "left leg 2 shin",
      "left leg 2 toes",
      "right arm 1 upper",
      "right arm 1 forearm",
    ].map((id) => [id, "p-" + id.replaceAll(" ", "-")]),
  );
  const roles = new Map([
    ["left leg 2 thigh", "thigh"],
    ["left leg 2 shin", "shin"],
    ["right arm 1 upper", "upper arm"],
    ["right arm 1 forearm", "forearm"],
  ]);
  const chains = creatureLimbChains(
    [...ids.keys()],
    [
      { kind: "leg", side: "both", pairs: 2 },
      { kind: "arm", side: "right", pairs: 1 },
    ],
    ids,
    roles,
  );
  assert.deepEqual(chains.get("left leg 2 thigh"), {
    chain: ["p-left-leg-2-thigh", "p-left-leg-2-shin"],
    limb: 0,
    side: "left",
    arm: false,
    tinted: ["p-left-leg-2-thigh", "p-left-leg-2-shin", "p-left-leg-2-toes"],
  });
  assert.equal(chains.get("right arm 1 upper")?.["limb"], 1);
  assert.equal(chains.size, 2);
});

test("a build refuses malformed organs and surfaces", () => {
  const materials = clayMaterials();
  const refused = (value: unknown, pattern: RegExp) =>
    assert.throws(() => buildCharacter(read(value), { materials }), pattern);
  refused(
    form("plan-8990", "neck", (f) => (f["creature.organ"] = { rank: "spine" })),
    /one spine organ/,
  );
  refused(
    form("plan-8990", "neck", (f) => (f["creature.eye-surface"] = { surface: "iris" })),
    /has an eye surface but is not a cage/,
  );
  const wing = form("plan-8990");
  const parts = wing["parts"];
  assert.ok(Array.isArray(parts));
  const features = parts.flatMap((p) =>
    isObject(p) && isObject(p["features"]) ? [p["features"]] : [],
  );
  const eyeCage = features.find((f) => f["creature.eye-surface"])?.["figure.cage"];
  const wingFeatures = features.find((f) => f["figure.wing"]);
  assert.ok(wingFeatures && eyeCage);
  wingFeatures["figure.cage"] = eyeCage;
  refused(wing, /has a wing surface and another surface/);
  const dangling = form("plan-8990", "left leg 1 thigh", (f) => {
    const chain = f["creature.limb-chain"];
    const ids: unknown = isObject(chain) ? chain["chain"] : undefined;
    assert.ok(isObject(chain) && Array.isArray(ids));
    ids[0] = "p-missing";
  });
  assert.ok(!readDocument(dangling, { registry: familyRegistry }).ok);
});

test("a creature's wing bends with the joints of the arm that carries it", () => {
  const doc = read(form("plan-8990"));
  const built = buildCharacter(doc, { materials: clayMaterials() });
  const rig = skinCharacter(built);
  try {
    const wings = doc.parts.filter((p) => p.features["figure.wing"] !== undefined);
    assert.equal(wings.length, 4);
    for (const wing of wings) {
      const parent = wing.parent;
      assert.ok(parent);
      const arm = rig.regions.get(parent);
      assert.ok(arm && arm.bones.length > 1, "a wing's arm has its own joints");
      const mesh = built.parts.get(wing.id)?.object;
      assert.ok(isMesh(mesh));
      assert.equal(mesh.geometry.getAttribute("color"), undefined);
    }
  } finally {
    rig.dispose();
    built.dispose();
  }
});

test("creature livery in an editable document cannot silently disappear on export", () => {
  const value = form("plan-8950");
  const features = value["features"];
  assert.ok(isObject(features));
  const plan = features["creature.plan"];
  assert.ok(isObject(plan));
  plan["dress"] = {
    kind: "herald",
    device: "sunburst",
    color: "#8a2b2b",
    trim: "#d8b25a",
    layers: 3,
    size: 1,
    seed: 7,
  };
  const doc = read(value);
  assert.throws(() => buildCharacter(doc, { materials: clayMaterials() }), /creature livery/);
});

test("finishing a creature plan's hide refuses a host without a raster", () => {
  for (const name of ["six-legged-crawler", "creature-pelt"])
    assert.throws(
      () => buildCharacter(read(form(name)), { materials: clayMaterials(), finish: {} }),
      /creature plan's hide needs a raster/,
    );
  const doc = read(form("creature-pelt"));
  const body = doc.parts.find((p) => p.id === idOf(doc, "body"));
  assert.deepEqual(body?.features["creature.organ"], {
    hide: "core",
    rank: "spine",
    coatSwatch: true,
  });
});

function ruff(game: boolean): {
  strands: number;
  tufts: number;
  locks: number;
} {
  const doc = read(form("creature-dispatch"));
  const built = buildCharacter(doc, { materials: clayMaterials(), game });
  try {
    let zeros = 0;
    let triangles = 0;
    let locks = 0;
    for (const part of doc.parts) {
      if (!part.label.startsWith("ruff lock ")) continue;
      const mesh = built.parts.get(part.id)?.object;
      assert.ok(isMesh(mesh) && mesh.geometry.index);
      const uv = mesh.geometry.getAttribute("uv");
      for (let i = 0; i < uv.count; i++) if (uv.getX(i) === 0 && uv.getY(i) === 0) zeros++;
      triangles += mesh.geometry.index.count / 3;
      locks++;
    }
    if (!game) return { strands: zeros, tufts: 0, locks };
    const tufts = (44 * zeros - triangles) / (44 * 7 - 9);
    assert.ok(Number.isInteger(tufts));
    return { strands: zeros - 7 * tufts, tufts, locks };
  } finally {
    built.dispose();
  }
}

test("a game build spends a pelt's strands on fewer, wider clumps and undercoat tufts", () => {
  const full = ruff(false);
  const game = ruff(true);
  assert.equal(full.locks, 25);
  const counts = read(form("creature-dispatch")).parts.flatMap((p) => {
    const fibres = p.features["figure.fibres"];
    return isObject(fibres) && typeof fibres["count"] === "number" ? [fibres["count"]] : [];
  });
  assert.equal(
    full.strands,
    counts.reduce((a, b) => a + b, 0),
  );
  assert.ok(game.strands >= 25 && game.strands < full.strands / 4, String(game.strands));
  assert.ok(game.tufts > 0);
  assert.deepEqual(ruff(true), game);
});

test("a courier's offer clip eases into its pose and back, and needs a held part and a pose", () => {
  const doc = read(form("creature-dispatch"));
  const built = buildCharacter(doc, { materials: clayMaterials() });
  const rig = skinCharacter(built);
  try {
    const names = rig.clips.map((c) => c.name);
    const offer = rig.clips.find((c) => c.name === "Offer dispatch");
    assert.ok(offer);
    assert.equal(offer.duration, 2.31);
    assert.equal(offer.tracks.length, 3);
    assert.ok(names.indexOf("Offer dispatch") < names.indexOf("Pose · Present dispatch"));
  } finally {
    rig.dispose();
    built.dispose();
  }
  const edited = (edit: (offer: Mutable) => void): CharacterDocument => {
    const value = form("creature-dispatch");
    const features = value["features"];
    assert.ok(isObject(features) && isObject(features["motion.offer"]));
    edit(features["motion.offer"]);
    return read(value);
  };
  const materials = clayMaterials();
  assert.throws(
    () =>
      buildCharacter(
        edited((o) => (o["pose"] = "Wave")),
        { materials },
      ),
    /reaches pose Wave, which has no joints/,
  );
  const body = idOf(doc, "body");
  assert.throws(
    () =>
      buildCharacter(
        edited((o) => (o["held"] = body)),
        { materials },
      ),
    /which no hand holds/,
  );
  const previous = createRegistry({
    features: familyFeatures.filter((f) => f.id !== "motion.offer"),
  });
  const result = readDocument(form("creature-dispatch"), {
    registry: previous,
  });
  assert.ok(!result.ok);
  assert.deepEqual(
    result.diagnostics.map((d) => [d.code, JSON.stringify(d.detail)]),
    [["unknown-feature", JSON.stringify({ feature: "motion.offer", version: 1 })]],
  );
});
