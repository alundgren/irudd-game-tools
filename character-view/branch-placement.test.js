import assert from "node:assert/strict";
import test from "node:test";
import { Euler, Group, MathUtils, Vector3 } from "three";
import { placeBranch } from "./graft.js";
import { applyOperations } from "./variations.js";

function world(parts, id, pin) {
  const nodes = new Map(
    parts.map((p) => {
      const node = new Group();
      node.position.fromArray(p.position);
      node.scale.fromArray(p.size);
      node.rotation.copy(new Euler(...p.rotation.map(MathUtils.degToRad)));
      const mount = new Group();
      if (p.frameSize) mount.scale.set(...p.frameSize.map((n) => 1 / n));
      node.add(mount);
      return [p.id, { node, mount }];
    }),
  );
  for (const p of parts)
    if (p.parent) nodes.get(p.parent).mount.add(nodes.get(p.id).node);
  return nodes
    .get(id)
    .node.localToWorld(new Vector3(...pin))
    .toArray();
}
const part = (id, parent, position, size, rotation) => ({
  id,
  parent,
  position,
  size,
  rotation,
  color: "#987654",
  shape: "box",
});
const form = {
  parts: [
    part("trunk", undefined, [0.03, 0.9, 0.1], [1.2, 0.8, 0.9], [12, 28, 9]),
    {
      ...part(
        "forearm",
        "trunk",
        [0.12, 0.08, 0.14],
        [0.12, 0.4, 0.16],
        [25, 12, 30],
      ),
      frameSize: [0.12, 0.4, 0.16],
    },
    part(
      "palm",
      "forearm",
      [0.03, -0.18, 0.02],
      [0.12, 0.18, 0.05],
      [5, 8, 30],
    ),
    part("shell", undefined, [-0.1, 0.4, -0.3], [0.9, 1.6, 0.7], [-4, -33, 12]),
  ],
  poses: [
    {
      name: "Hello",
      joints: [{ part: "palm", station: 0, turn: [0, 0, 0, 1] }],
    },
  ],
  outfitSets: [
    {
      name: "work",
      base: "Work clothes",
      layers: { palm: { dye: "#654321" } },
    },
  ],
};
test("placing a branch matches an off-centre pin on a rotated and nonuniform carrier", () => {
  const original = structuredClone(form),
    localPin = [-0.19, 0.38, 0.02],
    anchor = world(form.parts, "forearm", localPin),
    point = [0.11, 0.21, 0.25];
  const action = {
    op: "placeBranch",
    id: "forearm",
    parent: "shell",
    anchor,
    point,
    turn: [4, 21, 66],
    scale: 0.8,
    copy: true,
  };
  const result = applyOperations(form, [action]);
  assert.deepEqual(form, original);
  assert.deepEqual(result.parts.slice(0, 4), form.parts);
  assert.ok(
    new Vector3(...world(result.parts, "forearm copy", localPin)).distanceTo(
      new Vector3(...point),
    ) < 1e-8,
  );
  const palm = result.parts.find((p) => p.id === "palm copy");
  assert.equal(palm.parent, "forearm copy");
  assert.deepEqual(palm.position, form.parts[2].position);
  assert.equal(result.poses[0].joints[1].part, "palm copy");
  assert.deepEqual(
    result.outfitSets[0].layers["palm copy"],
    form.outfitSets[0].layers.palm,
  );
  const moved = placeBranch(result, "forearm copy", {
    parent: "trunk",
    anchor: point,
    point: anchor,
  });
  assert.equal(moved.form.parts.length, result.parts.length);
  assert.ok(
    new Vector3(...world(moved.form.parts, moved.id, localPin)).distanceTo(
      new Vector3(...anchor),
    ) < 1e-8,
  );
  assert.throws(
    () => placeBranch(form, "forearm", { parent: "palm", anchor, point }),
    /outside/,
  );
  assert.throws(() =>
    placeBranch(form, "forearm", {
      parent: "shell",
      anchor,
      point,
      scale: NaN,
    }),
  );
});

test("a named surface mark seats a moved branch pivot without copying or swapping the two points", () => {
  const mark = {
    name: "low socket",
    region: "shell",
    world: [0.12, 0.54, -0.065],
    normal: [0, 0, 1],
  };
  const op = {
    op: "placeAtMark",
    id: "forearm",
    mark: "low socket",
    depth: 0.01,
  };
  const result = applyOperations(form, [op], {}, true, [mark]);
  assert.equal(result.parts.length, form.parts.length);
  assert.equal(result.parts.find((p) => p.id === "forearm").parent, "shell");
  const pos = world(result.parts, "forearm", [0, 0, 0]);
  assert.ok(
    new Vector3(...pos).distanceTo(new Vector3(0.12, 0.54, -0.075)) < 1e-8,
  );
  assert.throws(
    () => applyOperations(form, [{ ...op, mark: "no mark" }], {}, true, [mark]),
    /Unknown marked socket/,
  );
});
