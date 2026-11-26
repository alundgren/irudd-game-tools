import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { test } from "node:test";
import * as T from "three";
import { buildCharacter, clayMaterials, type BuiltCharacter } from "@irudd/character";
import {
  affinePoint,
  applyOperations,
  decodeOperations,
  decomposeAffine,
  displacementInWorld,
  distance,
  partFrame,
  partPlacement,
  partPlacements,
  quatFromAxisAngle,
  readDocument,
  reattachInPlace,
  sub,
  worldDeltaInParent,
  type Affine,
  type CharacterDocument,
  type Vec3,
} from "@irudd/document";
import { fixturesDir } from "../src/paths.js";
import { familyRegistry } from "../src/prepare.js";
import { readFixture } from "../src/run.js";
import { humanAdultId, type HumanBody } from "@irudd/character/human";
import { loadHumanBody } from "../src/human-assets.js";

function build(doc: CharacterDocument, human?: HumanBody): BuiltCharacter {
  const built = buildCharacter(doc, { materials: clayMaterials(), ...(human ? { human } : {}) });
  built.group.updateMatrixWorld(true);
  return built;
}

function asAffine(m: T.Matrix4): Affine {
  const e = m.elements;
  return {
    linear: [e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10]],
    translation: [e[12], e[13], e[14]],
  };
}

function maxDifference(a: Affine, b: Affine): number {
  let worst = 0;
  a.linear.forEach((x, i) => (worst = Math.max(worst, Math.abs(x - (b.linear[i] ?? NaN)))));
  return Math.max(worst, distance(a.translation, b.translation));
}

function sceneAgreement(doc: CharacterDocument, human?: HumanBody): number {
  const built = build(doc, human);
  const placements = partPlacements(doc, familyRegistry);
  const warped = (a: Affine): Affine => {
    if (!built.warp) return a;
    const v = built.warp(new T.Vector3(...a.translation));
    return { linear: a.linear, translation: [v.x, v.y, v.z] };
  };
  const carried = (id: string | null): boolean => {
    const part = id === null ? undefined : built.parts.get(id)?.part;
    return Boolean(part && (part.faceAnchor || carried(part.parent)));
  };
  let worst = 0;
  for (const [id, { object, mount }] of built.parts) {
    if (carried(id)) continue;
    const placement = placements.get(id);
    assert.ok(placement, id);
    worst = Math.max(worst, maxDifference(asAffine(object.matrixWorld), warped(placement.node)));
    worst = Math.max(worst, maxDifference(asAffine(mount.matrixWorld), warped(placement.children)));
  }
  built.dispose();
  return worst;
}

const isMesh = (object: T.Object3D): object is T.Mesh => object instanceof T.Mesh;

function worldVertices(built: BuiltCharacter, id: string): Vec3[] {
  const object = built.parts.get(id)?.object;
  assert.ok(object && isMesh(object));
  const position = object.geometry.getAttribute("position");
  const out: Vec3[] = [];
  const v = new T.Vector3();
  for (let i = 0; i < position.count; i += 7) {
    v.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
    out.push([v.x, v.y, v.z]);
  }
  return out;
}

function edit(doc: CharacterDocument, raw: unknown): CharacterDocument {
  const ops = decodeOperations(raw);
  if (!ops.ok) throw new Error(JSON.stringify(ops.diagnostics));
  const applied = applyOperations(doc, ops.value, {
    registry: familyRegistry,
    retired: new Set(),
    idFor: (slot) => {
      throw new Error("No generated slots: " + slot);
    },
  });
  if (!applied.ok) throw new Error(JSON.stringify(applied.diagnostics));
  const read = readDocument(applied.value, { registry: familyRegistry });
  if (!read.ok) throw new Error(JSON.stringify(read.diagnostics));
  return read.value;
}

const degrees = (axis: Vec3, d: number) => quatFromAxisAngle(axis, (d * Math.PI) / 180);

function sheared(): CharacterDocument {
  const part = (
    id: string,
    parent: string | null,
    shape: string,
    position: Vec3,
    rotation: readonly number[],
    size: Vec3,
    assembly?: object,
  ) => ({
    id,
    label: id,
    parent,
    shape,
    position,
    rotation,
    size,
    color: "#808080",
    sculpt: [],
    features: assembly ? { "figure.assembly": assembly } : {},
  });
  const raw = {
    format: "irudd.character",
    version: 1,
    id: "doc-sheared",
    label: "sheared",
    requires: [
      { feature: "core.parts", version: 1 },
      { feature: "figure.assembly", version: 1 },
    ],
    catalog: [],
    assets: [],
    parts: [
      part("p-a", null, "ellipsoid", [0.1, 1, 0], degrees([0, 0, 1], 30), [0.6, 0.3, 0.9], {
        order: 0,
      }),
      part("p-b", "p-a", "box", [0.2, 0.3, -0.1], degrees([1, 0, 0], 40), [0.5, 0.4, 0.3], {
        order: 1,
        frameSize: [0.25, 0.8, 0.3],
      }),
      part("p-c", "p-b", "cone", [0.1, 0.4, 0.2], degrees([0, 1, 0], 25), [0.3, 0.6, 0.2]),
      part("p-d", "p-c", "cylinder", [0.05, 0.2, -0.1], degrees([1, 1, 0], 15), [0.2, 0.3, 0.4], {
        order: 2,
      }),
      part("p-e", null, "box", [-0.6, 0.5, 0], [0, 0, 0, 1], [0.4, 0.2, 0.3]),
      part("p-f", "p-e", "box", [0, 0.2, 0], [0, 0, 0, 1], [0.1, 0.1, 0.1]),
    ],
    poses: [],
    features: {},
    extensions: {},
  };
  const read = readDocument(raw, { registry: familyRegistry });
  if (!read.ok) throw new Error(JSON.stringify(read.diagnostics));
  return read.value;
}

test("every fixture places every part where the built scene does", async () => {
  const names = readdirSync(fixturesDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length));
  assert.ok(names.length >= 7);
  for (const name of names) {
    const doc = readFixture(name);
    const human = doc.generation?.generator === humanAdultId ? await loadHumanBody() : undefined;
    assert.ok(sceneAgreement(doc, human) < 1e-12, name);
  }
});

test("the left eye sits in the head's scaled frame, 0.214 m from the rigid core frame", () => {
  const doc = readFixture("marsh-draw-3");
  const built = build(doc);
  const eye = built.parts.get("p-left-eye");
  assert.ok(eye);
  const centre = new T.Vector3().setFromMatrixPosition(eye.object.matrixWorld);
  const placed = partPlacement(doc, "p-left-eye", familyRegistry);
  assert.ok(placed);
  assert.ok(distance(placed.node.translation, [centre.x, centre.y, centre.z]) < 1e-12);
  const rigid = partFrame(doc, "p-left-eye");
  assert.ok(rigid);
  const gap = distance(rigid.position, placed.node.translation);
  assert.ok(Math.abs(gap - 0.21435523872149) < 1e-12, `gap ${gap}`);
  built.dispose();
});

test("sheared nesting under a rotated non-uniform scale matches the built scene", () => {
  const doc = sheared();
  assert.ok(sceneAgreement(doc) < 1e-12);
  const c = partPlacement(doc, "p-c", familyRegistry);
  assert.ok(c);
  assert.equal(decomposeAffine(c.node), undefined, "p-c is sheared");
});

test("a world pick on a sheared part resolves and maps back to the same world point", () => {
  const doc = sheared();
  const d = partPlacement(doc, "p-d", familyRegistry);
  assert.ok(d);
  const world = affinePoint(d.node, [0.2, 0.5, -0.1]);
  const offset: Vec3 = [0.004, -0.01, 0.006];
  const sculpted = edit(doc, [
    { op: "sculpt.at", part: "p-d", edit: "d-1", world, offset, radius: 0.02 },
  ]);
  const stored = sculpted.parts.find((p) => p.id === "p-d")?.sculpt[0];
  assert.ok(stored);
  assert.ok(distance(stored.at, [0.4, 1, -0.2]) < 1e-12);
  const back = displacementInWorld(sculpted, "p-d", "d-1", familyRegistry);
  assert.ok(back);
  assert.ok(distance(back.at, world) < 1e-12);
  assert.ok(distance(back.offset, offset) < 1e-12);
  const built = build(doc);
  const mesh = built.parts.get("p-d")?.object;
  assert.ok(mesh);
  const v = new T.Vector3(...stored.at).multiplyScalar(0.5).applyMatrix4(mesh.matrixWorld);
  assert.ok(distance([v.x, v.y, v.z], world) < 1e-12);
  built.dispose();
});

test("a world drag on a sheared part moves its built origin by exactly that delta", () => {
  const doc = sheared();
  const delta: Vec3 = [0.01, -0.02, 0.03];
  const translate = worldDeltaInParent(doc, "p-d", delta, familyRegistry);
  assert.ok(translate);
  const moved = edit(doc, [{ op: "part.transform", part: "p-d", translate }]);
  const origin = (d: CharacterDocument): Vec3 => {
    const built = build(d);
    const p = new T.Vector3().setFromMatrixPosition(
      built.parts.get("p-d")?.object.matrixWorld ?? new T.Matrix4(),
    );
    built.dispose();
    return [p.x, p.y, p.z];
  };
  assert.ok(distance(sub(origin(moved), origin(doc)), delta) < 1e-12);
});

const builtBefore = new WeakMap<CharacterDocument, BuiltCharacter>();

function reattachStays(doc: CharacterDocument, id: string, parent: string | null): number {
  const result = reattachInPlace(doc, id, parent, familyRegistry);
  assert.ok(result.ok, `${id} → ${parent}: ${result.ok ? "" : result.reason}`);
  const next = edit(doc, [{ op: "part.set", part: id, set: result.value }]);
  const subtree = [id];
  for (let i = 0; i < subtree.length; i++)
    for (const p of doc.parts) if (p.parent === subtree[i]) subtree.push(p.id);
  const before = builtBefore.get(doc) ?? build(doc);
  builtBefore.set(doc, before);
  const after = build(next);
  let worst = 0;
  for (const part of subtree) {
    const a = worldVertices(before, part);
    const b = worldVertices(after, part);
    a.forEach((v, i) => (worst = Math.max(worst, distance(v, b[i] ?? [NaN, NaN, NaN]))));
  }
  after.dispose();
  assert.ok(next.parts.find((p) => p.id === id)?.parent === parent);
  return worst;
}

test("re-attaching marsh-draw-3 parts keeps them and their children in place", () => {
  const doc = readFixture("marsh-draw-3");
  assert.ok(reattachStays(doc, "p-left-sample-cradle", "p-body") < 1e-9);
  assert.ok(reattachStays(doc, "p-left-sample-cradle", null) < 1e-9);
  assert.ok(reattachStays(doc, "p-left-eye", "p-body") < 1e-9);
  assert.ok(reattachStays(doc, "p-left-front-paddle", "p-head") < 1e-9);
  assert.deepEqual(reattachInPlace(doc, "p-left-front-paddle", "p-body", familyRegistry), {
    ok: false,
    reason: "shear",
  });
});

test("re-attaching refuses a shear the part cannot store and a move of its children", () => {
  const doc = sheared();
  assert.deepEqual(reattachInPlace(doc, "p-d", null, familyRegistry), {
    ok: false,
    reason: "shear",
  });
  const rotatedFree = edit(doc, [{ op: "part.set", part: "p-a", set: { rotation: [0, 0, 0, 1] } }]);
  assert.deepEqual(reattachInPlace(rotatedFree, "p-e", "p-a", familyRegistry), {
    ok: false,
    reason: "children",
  });
  assert.ok(reattachStays(rotatedFree, "p-f", "p-a") < 1e-9);
});
