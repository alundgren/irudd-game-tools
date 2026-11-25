import assert from "node:assert/strict";
import test from "node:test";
import { Group, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { handGeometry } from "./hands.js";
import { skinCharacter } from "./skin.js";

test("an individual finger moves in a skinned hand while the neighbouring digits stay put", () => {
  const geometry = handGeometry({
    fingers: 4,
    side: 1,
    spread: 0.35,
    curl: 0.12,
  });
  const part = {
    id: "left hand",
    shape: "hand",
    outfitRole: "hand",
    size: [0.085, 0.18, 0.039],
    position: [0, 0.2, 0],
    rotation: [0, 0, 0],
  };
  const group = new Group(),
    material = new MeshStandardMaterial(),
    source = new Mesh(geometry, material);
  source.userData.partId = part.id;
  source.handRig = geometry.handRig;
  source.scale.fromArray(part.size);
  source.position.fromArray(part.position);
  group.add(source);
  const { actor, clips } = skinCharacter({ parts: [part] }, group);
  const mesh = actor.children.find((o) => o.isSkinnedMesh),
    skeleton = mesh.skeleton;
  const digits = skeleton.bones.filter((b) => b.userData.digit);
  assert.equal(digits.length, 15);
  assert.ok(
    clips
      .find((c) => c.name === "Reach")
      .tracks.some((t) => t.name.includes("Index_1")),
  );
  actor.updateMatrixWorld(true);
  const pos = mesh.geometry.attributes.position,
    indices = mesh.geometry.attributes.skinIndex,
    weights = mesh.geometry.attributes.skinWeight;
  for (let j = 0; j < weights.array.length; j++)
    if (weights.array[j] === 0) assert.equal(indices.array[j], 0);
  const vertex = new Vector3(),
    rest = Array.from({ length: pos.count }, (_, i) =>
      mesh.getVertexPosition(i, new Vector3()),
    );
  const index = digits.find(
    (b) => b.userData.digit === "Index" && b.userData.segment === 1,
  );
  index.rotateX(-0.65);
  actor.updateMatrixWorld(true);
  let moved = 0,
    palm = 0,
    other = 0;
  for (let i = 0; i < pos.count; i++) {
    const d = mesh.getVertexPosition(i, vertex).distanceTo(rest[i]);
    const names = new Set(
      Array.from({ length: 4 }, (_, k) =>
        weights.array[i * 4 + k] > 0.001
          ? skeleton.bones[indices.array[i * 4 + k]].userData.digit
          : null,
      ).filter(Boolean),
    );
    if (names.has("Index")) moved = Math.max(moved, d);
    else if (names.size) other = Math.max(other, d);
    else palm = Math.max(palm, d);
  }
  assert.ok(moved > 0.025);
  assert.ok(other < 1e-6);
  assert.ok(palm < 1e-6);
  geometry.dispose();
  mesh.geometry.dispose();
  skeleton.dispose();
  material.dispose();
});

test("padded paws and hooked talons retain each digit and close around a carried handle", () => {
  const grip = { fingers: 3, spread: 0.26, curl: 0.18 };
  const positions = geometry => geometry.getAttribute("position").array;
  const hand = handGeometry(grip), closed = handGeometry({ ...grip, cylindrical: true });
  for (const pad of ["paw", "talon"]) {
    const open = handGeometry({ ...grip, pad });
    assert.notDeepEqual(positions(open), positions(hand));
    assert.deepEqual(open.handRig.map(d => d.name), hand.handRig.map(d => d.name));
    assert.ok(open.handRig.every(d => d.vertices.length && d.anchors.length === 3));
    const grasp = handGeometry({ ...grip, pad, cylindrical: true });
    assert.deepEqual(positions(grasp), positions(closed));
  }
});

test("game creature digits keep their joint chains and a closed surface at lower density", () => {
  for (const [pad, fingers] of [["paw", 4], ["talon", 3], ["hand", 2]]) {
    const grip = { pad, fingers, spread: 0.3, curl: 0.22 };
    const full = handGeometry(grip);
    const game = handGeometry(grip, { game: true });
    assert.ok(game.index.count < full.index.count / 3);
    assert.deepEqual(game.handRig.map(d => d.anchors), full.handRig.map(d => d.anchors));
    assert.ok(game.handRig.every(d => d.vertices.length && Math.max(...d.parameters) > 2.9));
    const edges = new Map();
    const indices = game.index.array;
    for (let i = 0; i < indices.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const a = indices[i + k], b = indices[i + (k + 1) % 3];
        const edge = Math.min(a, b) * game.attributes.position.count + Math.max(a, b);
        edges.set(edge, (edges.get(edge) ?? 0) + 1);
      }
    }
    assert.ok([...edges.values()].every(uses => uses === 2), pad + " surface is closed");
    full.dispose();
    game.dispose();
  }
});
