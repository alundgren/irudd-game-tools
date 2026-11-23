import test from "node:test";
import assert from "node:assert/strict";
import { Box3, Vector3 } from "three";
import { groomGeometry, groomDefaults, validGroom } from "./groom.js";
test("the same scalp supports repeatable coiled, parted and plaited geometry", () => {
  const box = new Box3(
    new Vector3(-0.09, 0, -0.08),
    new Vector3(0.09, 0.25, 0.1),
  );
  const counts = new Set();
  for (const pattern of ["Coils", "Side part", "Braids", "Locs"]) {
    const g = {
      ...groomDefaults,
      pattern,
      part: 0.33,
      color: "#464034",
      seed: 33,
    };
    assert.ok(validGroom(g));
    const meshes = groomGeometry(box, g),
      a = meshes[1].attributes.position;
    assert.ok(Array.from(a.array).every(Number.isFinite));
    counts.add(a.count);
    if (pattern === "Braids") {
      const replay = groomGeometry(box, g);
      assert.deepEqual(a.array, replay[1].attributes.position.array);
      replay.forEach((x) => x.dispose());
    }
    meshes.forEach((x) => x.dispose());
  }
  assert.equal(counts.size, 4);
});
