import test from "node:test";
import assert from "node:assert/strict";
import {
  Color,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  Vector3,
} from "three";
import {
  applyCreatureCoat,
  coatFamilies,
  creatureCoatField,
  drawCreatureCoat,
  readCreatureCoat,
} from "./creature-coat.js";
import {
  buildCreature,
  randomCreaturePlan,
  readCreaturePlan,
  steerCreaturePlan,
} from "./creature-plan.js";

test("the new coat uses the species colours and its own deterministic variation", () => {
  const p = randomCreaturePlan(9110);
  p.skin = drawCreatureCoat(p, 9110);
  const prior = structuredClone(p.skin);
  for (const family of coatFamilies) {
    const next = steerCreaturePlan(p, {
      skin: { coat: { family, density: 1.7, contrast: 0.7 } },
    });
    assert.equal(next.skin.coat.family, family);
    assert.equal(next.skin.coat.seed, prior.coat.seed);
    assert.equal(next.skin.base, prior.base);
    assert.deepEqual(next.limbs, p.limbs);
  }
  for (const key of ["base", "accent", "pale", "eye", "markings"])
    assert.deepEqual(drawCreatureCoat(p, 9111)[key], p.skin[key]);
  assert.deepEqual(p.skin, prior);
  assert.deepEqual(
    readCreatureCoat({
      family: "scutes",
      density: 7,
      contrast: -0.2,
      seed: -3,
    }),
    { family: "scutes", density: 1.8, contrast: 0, seed: 0 },
  );
  assert.equal(readCreatureCoat({ family: "metal" }), null);
});
test("saved plain plans keep their old render contract, existing parts can opt out", () => {
  const current = randomCreaturePlan(9103);
  current.skin = drawCreatureCoat(current, 9103);
  const plain = steerCreaturePlan(current, { skin: { coat: null } });
  assert.equal(readCreaturePlan(plain).skin.coat, undefined);
  assert.ok(!buildCreature(plain).parts.some((p) => p.coatZone));
  const f = buildCreature(current);
  assert.ok(f.parts.find((p) => p.id === "body").coatZone);
  assert.ok(!f.parts.find((p) => p.id === "left eye")?.coatZone);
  const root = new Object3D();
  const b = f.parts.find((p) => p.id === "body");
  root.position.fromArray(b.position);
  const field = creatureCoatField(f, new Map([["body", root]]));
  const mesh = new Mesh(
    new SphereGeometry(0.15, 12, 8),
    new MeshStandardMaterial({ color: b.color }),
  );
  mesh.position.copy(root.position);
  assert.equal(
    applyCreatureCoat(mesh, { ...b, surface: "metal" }, field, null),
    false,
  );
  assert.equal(
    applyCreatureCoat(mesh, { ...b, paint: {} }, field, null),
    false,
  );
  assert.ok(applyCreatureCoat(mesh, b, field, null));
  assert.ok(mesh.geometry.attributes.color.array.every(Number.isFinite));
  assert.ok(
    Math.max(...mesh.geometry.attributes.color.array) -
      Math.min(...mesh.geometry.attributes.color.array) >
      0.02,
  );
  const at = new Vector3(0.13, 0.52, 0.28),
    normal = new Vector3(0.8, 0, 0.6),
    base = new Color(b.color);
  assert.deepEqual(
    field.sample(new Color(), base, at, normal),
    field.sample(new Color(), base, at, normal),
  );
});

test("ordinary draws carry editable dorsal grading and plain saved coats retain their setting", () => {
  const graded = Array.from({length: 60}, (_, i) => randomCreaturePlan(451000+i))
    .filter(plan => plan.skin.coat?.graded);
  assert.ok(graded.length >= 25 && graded.length < 60);
  assert.ok(new Set(graded.map(plan => plan.skin.coat.family)).size >= 3);
  const plan = graded[0];
  const saved = structuredClone(plan);
  delete saved.skin.coat.graded;
  assert.equal(readCreaturePlan(saved).skin.coat.graded, undefined);
  assert.equal(readCreaturePlan(plan).skin.coat.graded, true);
});
