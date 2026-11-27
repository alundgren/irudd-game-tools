import { fanDisplay } from "../src/rig/fan-display.js";
import { cutGarment } from "../src/garments.js";
import { isMesh } from "../src/mesh.js";
import { graftComponent } from "../src/graft.js";
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
  figureWing,
  figureMantle,
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
test("showing the fan raises the right hand and restores the editable rest pose", async () => {
  const body = await loadHumanPacks((file) =>
    readFileSync(new URL("../assets/human/" + file, import.meta.url)),
  );
  const params = seededHumanAdult(body, 8973, "neutral", "Natural");
  const { doc } = generatedDocument(humanAdultGenerator(body), {
    ...params,
    outfit: "Work clothes",
    style: { ...params.style, handProp: "Painted folding fan", outfit: "Day dress" },
  });
  const built = buildCharacter(doc, { human: body, materials: clayMaterials() });
  try {
    const wrist = [...built.parts.values()].find(
      ({ part }) => built.human?.bones.get(part.id) === "hand_r",
    );
    assert.ok(wrist);
    const before = wrist.object.getWorldPosition(new T.Vector3());
    const fan = fanDisplay(built);
    assert.ok(fan);
    try {
      const raised = wrist.object.getWorldPosition(new T.Vector3());
      assert.ok(raised.y > before.y + 0.12, JSON.stringify({ before, raised }));
      assert.ok(raised.z > before.z + 0.08);
      fan.show(false);
      assert.ok(wrist.object.getWorldPosition(new T.Vector3()).distanceTo(before) < 1e-6);
      fan.show(true);
      assert.ok(wrist.object.getWorldPosition(new T.Vector3()).distanceTo(raised) < 1e-6);
    } finally {
      fan.dispose();
    }
  } finally {
    built.dispose();
  }
});

test("the fitted adult kilt falls from the pelvis to the knee", async () => {
  const body = await loadHumanPacks((file) =>
    readFileSync(new URL("../assets/human/" + file, import.meta.url)),
  );
  const { doc } = generatedDocument(
    humanAdultGenerator(body),
    seededHumanAdult(body, 8973, "neutral", "Natural"),
  );
  const built = buildCharacter(doc, { human: body, materials: clayMaterials() });
  try {
    const regions = [...built.parts.values()];
    const pelvis = regions.find(({ part }) => built.human?.bones.get(part.id) === "pelvis");
    const knee = regions.find(({ part }) => built.human?.bones.get(part.id) === "calf_l");
    assert.ok(pelvis && knee);
    const skirt = cutGarment(built, pelvis.part.id, "Skirt", "#435258");
    const cut = figureMantle.read(skirt.features)?.cut;
    assert.ok(cut?.kind === "Skirt" && cut.drop > 0.2 && cut.pleats === 16);
    const waist = pelvis.mount.localToWorld(new T.Vector3(...skirt.position));
    assert.ok(
      Math.abs(waist.y - cut.drop - knee.mount.getWorldPosition(new T.Vector3()).y) < 0.015,
    );
  } finally {
    built.dispose();
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
  const added = mounted.value.parts.slice(doc.parts.length);
  const wings = added.filter((p) => p.features["figure.scapula-mount"]);
  assert.equal(added.length, 4);
  for (const arm of wings) {
    assert.ok(arm.features["figure.sweep"]);
    const membrane = added.find((p) => p.parent === arm.id);
    assert.ok(membrane);
    const wing = figureWing.read(membrane.features);
    assert.ok(wing && wing.back[1] < -0.35 && Math.abs(wing.back[2]) < 0.04);
  }
  assert.equal(wings.length, 2);
  assert.deepEqual(
    wings.map((w) => w.features["figure.scapula-mount"]),
    [{ side: 1 }, { side: -1 }],
  );
  assert.ok((wings[0]?.position[0] ?? 0) * (wings[1]?.position[0] ?? 0) < 0);
  const refit = mountWings(mounted.value, body, "feather", 1.1, "#557788", 3);
  assert.deepEqual(
    refit.map(
      (op) =>
        "part" in op && op.part && typeof op.part === "object" && "id" in op.part && op.part.id,
    ),
    added.map((p) => p.id),
  );
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

test("a saved adult head rebuilds with donor skin geometry on a non-adult and survives a second graft", async () => {
  const body = await loadHumanPacks((file) =>
    readFileSync(new URL("../assets/human/" + file, import.meta.url)),
  );
  const source = generatedDocument(humanAdultGenerator(body), {
    ...seededHumanAdult(body, 491, "neutral", "Natural"),
    outfit: "Anatomy",
  });
  const doc = source.doc,
    head = doc.parts.find((p) => p.slot === "head");
  assert.ok(head);
  const settings = { human: body, materials: clayMaterials() },
    donor = buildCharacter(doc, settings);
  const host = addDetail(undefined, "sweep"),
    recipient = { ...doc, generation: undefined, parts: [host] };
  const { generation: _generation, ...base } = recipient;
  const dest = buildCharacter(base, settings);
  const vertices = (entry: typeof donor, id: string) => {
    const mesh = entry.parts.get(id)?.object.children.find(isMesh);
    assert.ok(mesh);
    return Array.from(mesh.geometry.getAttribute("position").array);
  };
  const expected = vertices(donor, head.id);
  let current = doc,
    currentHead = head,
    built = donor;
  try {
    const entry = donor.parts.get(head.id);
    assert.ok(entry);
    entry.object.visible = false;
    assert.throws(
      () => graftComponent(doc, head, donor, base, host, dest, "Replace whole branch", true, body),
      /no visible geometry/,
    );
    assert.ok(
      graftComponent(doc, head, donor, base, host, dest, "Replace whole branch", true, body, false)
        .ops.length,
    );
    entry.object.visible = true;
    const full = { ...base, parts: Array.from({ length: 128 }, () => host) };
    assert.throws(
      () =>
        graftComponent(doc, head, donor, full, host, dest, "Attach above selection", false, body),
      /128/,
    );
    for (let i = 0; i < 2; i++) {
      const added = graftComponent(
        current,
        currentHead,
        built,
        base,
        host,
        dest,
        "Attach above selection",
        false,
        body,
      );
      const ops = decodeOperations(added.ops);
      assert.ok(ops.ok, JSON.stringify(ops));
      const result = applyOperations(base, ops.value, {
        registry: source.registry,
        idFor: source.idFor,
        retired: new Set(),
      });
      assert.ok(result.ok, JSON.stringify(result));
      current = result.value;
      const selected = current.parts.find((p) => p.id === added.id);
      assert.ok(selected);
      assert.deepEqual(
        humanRegionCopy.read(selected.features)?.source?.params,
        doc.generation?.params,
      );
      if (built !== donor) built.dispose();
      built = buildCharacter(current, settings);
      assert.deepEqual(vertices(built, added.id), expected);
      currentHead = selected;
    }
  } finally {
    if (built !== donor) built.dispose();
    donor.dispose();
    dest.dispose();
  }
});

test("replacing a part with a clothed adult limb keeps its identity, child placement and donor joint weights", async () => {
  const body = await loadHumanPacks((file) =>
    readFileSync(new URL("../assets/human/" + file, import.meta.url)),
  );
  const params = seededHumanAdult(body, 491, "neutral", "Natural");
  const { tailor: _tailor, cast: _cast, ...style } = params.style;
  const source = generatedDocument(humanAdultGenerator(body), {
    ...params,
    outfit: "Work clothes",
    style: { ...style, outfit: "None" },
  });
  const root = source.doc.parts.find((p) => p.slot === "calf.l");
  assert.ok(root);
  const host = addDetail(undefined, "sweep"),
    child = addDetail(host, "cage");
  const { generation: _generation, ...base } = source.doc;
  const dst = { ...base, parts: [host, child] };
  const options = { human: body, materials: clayMaterials() },
    donor = buildCharacter(source.doc, options),
    before = buildCharacter(dst, options);
  const childPos = before.parts.get(child.id)?.object.getWorldPosition(new T.Vector3());
  assert.ok(childPos);
  try {
    const edit = graftComponent(
      source.doc,
      root,
      donor,
      dst,
      host,
      before,
      "Replace part, keep children",
      true,
      body,
    );
    assert.equal(edit.id, host.id);
    const ops = decodeOperations(edit.ops);
    assert.ok(ops.ok, JSON.stringify(ops));
    const done = applyOperations(dst, ops.value, {
      registry: source.registry,
      idFor: source.idFor,
      retired: new Set(),
    });
    assert.ok(done.ok, JSON.stringify(done));
    const after = buildCharacter(done.value, options);
    try {
      const calf = after.parts.get(host.id);
      assert.equal(after.regionRig?.bones.get(host.id), "calf_l");
      const meshes = calf?.object.children.filter(isMesh).filter((m) => !m.userData["partId"]);
      assert.ok(meshes && meshes.length >= 2);
      assert.ok(meshes.every((m) => after.regionRig?.weights(m)));
      const moved = after.parts.get(child.id)?.object.getWorldPosition(new T.Vector3());
      assert.ok(moved && moved.distanceTo(childPos) < 1e-6);
    } finally {
      after.dispose();
    }
  } finally {
    donor.dispose();
    before.dispose();
  }
});
