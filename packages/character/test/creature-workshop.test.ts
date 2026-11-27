import assert from "node:assert/strict";
import * as T from "three";
import { buildCharacter, clayMaterials } from "../src/build.js";
import { addDetail } from "../src/surface-edit.js";
import { placeBranch } from "../src/place-branch.js";
import { readFileSync } from "node:fs";
import { humanAdultGenerator, loadHumanPacks, seededHumanAdult } from "../src/human/index.js";
import { test } from "node:test";
import {
  CharacterDocument,
  regenerate,
  applyOperations,
  decodeOperations,
  humanRegionCopy,
  createRegistry,
  CreaturePlan,
  creatureFamilies,
  decodeWith,
  derivePartId,
  familyFeatures,
  generateParts,
} from "@irudd/document";
import {
  mountWings,
  creatureGenerator,
  formGenerator,
  formParams,
  otherForms,
  randomCreature,
  shuffleCreature,
  moveHandle,
  creatureHandles,
  drawCoat,
} from "../src/creature/index.js";

function generatedDocument(generator: typeof creatureGenerator, params: unknown) {
  const registry = createRegistry({ generators: [generator], features: familyFeatures });
  const request = { generator: generator.id, version: 1, params };
  const idFor = (slot: string) => derivePartId("doc-workshop", "req-shapes", slot);
  const built = generateParts(registry, request, idFor);
  assert.ok(built.ok);
  const doc = decodeWith(CharacterDocument, {
    format: "irudd.character",
    version: 1,
    id: "doc-workshop",
    label: "Workshop",
    requires: [],
    catalog: [],
    assets: [],
    poses: [],
    features: {},
    extensions: {},
    ...built.value,
  });
  assert.ok(doc.ok);
  return { doc: doc.value, registry, idFor, request };
}

test("steering generated surfaces preserves hand edits and detects competing surface changes", () => {
  const plan = randomCreature(0, "grazer");
  const { doc, registry, idFor, request } = generatedDocument(creatureGenerator, plan);
  const change = {
    ...request,
    params: { ...plan, spine: { ...plan.spine, length: 1.2 } },
    discardEdits: false,
  };
  const painted = {
    ...doc,
    parts: doc.parts.map((p) =>
      p.slot === "body"
        ? { ...p, features: { ...p.features, "creature.coat-zone": { zone: "end" } } }
        : p,
    ),
  };
  const next = regenerate(painted, registry, change, idFor);
  assert.ok(next.ok);
  const torso = next.value.parts.find((p) => p.slot === "body");
  assert.deepEqual(torso?.features["creature.coat-zone"], { zone: "end" });
  assert.notDeepEqual(
    torso?.features["figure.sweep"],
    doc.parts.find((p) => p.slot === "body")?.features["figure.sweep"],
  );
  const sculpt = {
    knots: [
      [0, 0, 0, 0.12, 0.12],
      [0, 0, 0.2, 0.18, 0.11],
    ],
  };
  const sculpted = {
    ...doc,
    parts: doc.parts.map((p) =>
      p.slot === "body" ? { ...p, features: { ...p.features, "figure.sweep": sculpt } } : p,
    ),
  };
  assert.equal(regenerate(sculpted, registry, change, idFor).ok, false);
});

test("placing native adult regions under an independently drawn part rebuilds the correct mesh and hierarchy", async () => {
  const body = await loadHumanPacks((file) =>
    readFileSync(new URL("../assets/human/" + file, import.meta.url)),
  );
  const { doc, registry, idFor } = generatedDocument(humanAdultGenerator(body), {
    ...seededHumanAdult(body, 491, "neutral", "Natural"),
    outfit: "Anatomy",
  });
  const hand = doc.parts.find((p) => p.label.toLowerCase() === "left hand"),
    head = doc.parts.find((p) => p.label.toLowerCase() === "head");
  assert.ok(hand && head);
  const mount = addDetail(head, "sweep");
  const initial = { ...doc, parts: [...doc.parts, mount] };
  const settings = { human: body, materials: clayMaterials() };
  const before = buildCharacter(initial, settings);
  try {
    before.group.updateMatrixWorld(true);
    const a = before.parts.get(hand.id),
      b = before.parts.get(mount.id);
    assert.ok(a && b);
    for (const copy of [true, false]) {
      const proposed = placeBranch(
        initial,
        hand,
        mount,
        a.object.matrixWorld,
        b.mount.matrixWorld,
        {
          anchor: a.object.getWorldPosition(new T.Vector3()).toArray(),
          point: [0, 1.5, 0.2],
          normal: [0, 0, 1],
          axis: [0, 1, 0],
          twist: 32,
          depth: 0.01,
          scale: 1.25,
          copy,
        },
      );
      const operations = decodeOperations(proposed.ops);
      assert.ok(operations.ok);
      const result = applyOperations(initial, operations.value, {
        registry,
        retired: new Set(),
        idFor,
      });
      assert.ok(result.ok, JSON.stringify(result));
      const built = buildCharacter(result.value, settings);
      try {
        const placed = built.parts.get(proposed.id);
        assert.ok(placed);
        assert.equal(placed.object.parent, built.parts.get(mount.id)?.mount);
        assert.equal(
          placed.object.children.filter((c) => c instanceof T.Mesh).length,
          a.object.children.filter((c) => c instanceof T.Mesh).length,
        );
        assert.ok(
          placed.object.getWorldPosition(new T.Vector3()).distanceTo(new T.Vector3(0, 1.5, 0.19)) <
            1e-4,
        );
        if (copy)
          assert.equal(
            humanRegionCopy.read(
              result.value.parts.find((p) => p.id === proposed.id)?.features ?? {},
            )?.slot,
            hand.slot,
          );
      } finally {
        built.dispose();
      }
    }
  } finally {
    before.dispose();
  }
});
test("adult wings occupy opposite scapula sockets and refitting reuses their parts", async () => {
  const body = await loadHumanPacks((file) =>
    readFileSync(new URL("../assets/human/" + file, import.meta.url)),
  );
  const { doc } = generatedDocument(
    humanAdultGenerator(body),
    seededHumanAdult(body, 491, "neutral", "Natural"),
  );
  const additions = mountWings(doc, body, "bat", 0.9, "#665544", 1);
  const mounted = decodeWith(CharacterDocument, {
    ...doc,
    parts: [...doc.parts, ...additions.map((op) => ("part" in op ? op.part : null))],
  });
  assert.ok(mounted.ok);
  const wings = mounted.value.parts.slice(-2);
  assert.equal(wings.length, 2);
  assert.deepEqual(
    wings.map((w) => w.features["figure.scapula-mount"]),
    [{ side: 1 }, { side: -1 }],
  );
  assert.ok((wings[0]?.position[0] ?? 0) * (wings[1]?.position[0] ?? 0) < 0);
  const refit = mountWings(mounted.value, body, "feather", 1.1, "#557788", 3);
  assert.ok(refit.every((op) => "part" in op && wings.some((w) => w.id === op.part)));
});

test("each family yields repeatable drawable anatomy, with different families dealt on consecutive seeds", () => {
  const registry = createRegistry({ generators: [creatureGenerator], features: familyFeatures });
  const families = new Set<string>();
  for (let seed = 0; seed < creatureFamilies.length; seed++) {
    const plan = randomCreature(seed);
    assert.deepEqual(plan, randomCreature(seed));
    families.add(plan.family ?? "");
    const built = generateParts(
      registry,
      { generator: creatureGenerator.id, version: 1, params: plan },
      (slot) => derivePartId("doc", "req", slot),
    );
    assert.ok(built.ok, built.ok ? "" : JSON.stringify(built.diagnostics));
    assert.ok(built.value.parts.some((p) => p.slot === "body" && p.features["figure.sweep"]));
    for (const p of built.value.parts)
      for (const [key, value] of Object.entries(p.features))
        assert.ok(registry.features.get(key)?.validate(value).ok, key);
  }
  assert.equal(families.size, creatureFamilies.length);
});
test("shuffles preserve other regions, honor deck selections and soften measurements", () => {
  const plan = randomCreature(1, "grazer");
  const decks = [
    { label: "family", value: "swimmer" },
    { label: "coat", value: "wet skin" },
    { label: "skin", value: "#123456" },
  ];
  const changed = shuffleCreature(plan, "Whole creature", 3, { strength: "radical", decks });
  assert.equal(changed.family, "swimmer");
  assert.equal(changed.skin.coat?.family, "wet skin");
  assert.equal(changed.skin.base, "#123456");
  const head = shuffleCreature(plan, "Head", 3, { strength: "subtle", decks });
  assert.deepEqual(head.limbs, plan.limbs);
  assert.deepEqual(head.skin, plan.skin);
  assert.ok(
    Math.abs(head.head.neck - plan.head.neck) < Math.abs(changed.head.neck - plan.head.neck),
  );
  assert.equal(
    drawCoat(
      { ...plan, back: { kind: "shag mantle", count: 4, height: 0.1, spread: 0.7, seed: 3 } },
      9,
    ).family,
    "pelt",
  );
});
test("girth and limb handles respect anatomical limits and retain pair spacing", () => {
  const p = randomCreature(2, "grazer");
  for (const h of creatureHandles(p)) {
    const changed = moveHandle(p, h, 20);
    assert.ok(decodeWith(CreaturePlan, changed).ok);
    if (h.kind === "girth") assert.equal(changed.spine.bulge[h.index], 2.2);
    else {
      const old = p.limbs[h.index],
        next = changed.limbs[h.index];
      assert.ok(old && next);
      assert.ok(Math.abs(next.to - next.from - (old.to - old.from)) < 1e-6);
    }
  }
});
test("figure, humanoid and hybrid starting forms contain fitted library pieces", () => {
  for (const kind of otherForms) {
    const params = formParams(kind, 23, "female", "Fantasy", "glider");
    const slots = formGenerator.generate(params);
    assert.ok(slots.some((p) => p.features?.["figure.piece"]));
    assert.equal(
      slots.some((p) => p.features?.["figure.wing"] !== undefined),
      kind === "Hybrid",
    );
  }
});
