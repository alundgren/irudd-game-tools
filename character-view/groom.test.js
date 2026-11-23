import test from "node:test";
import assert from "node:assert/strict";
import { Box3, SphereGeometry } from "three";
import { groomDefaults, groomGeometry, validGroom } from "./groom.js";
test("grooming preserves a stable draw and materially changes the falling silhouette", () => {
  const source = new SphereGeometry(1, 32, 24);
  source.computeBoundingBox();
  const style = { ...groomDefaults, color: "#553c31", seed: 27 };
  assert.ok(validGroom(style));
  assert.ok(!validGroom({ ...style, length: -1 }));
  const first = groomGeometry(source.boundingBox, style, source),
    again = groomGeometry(source.boundingBox, style, source);
  const long = groomGeometry(
    source.boundingBox,
    { ...style, length: 1.5 },
    source,
  );
  const bounds = (items) =>
    items.reduce((box, g) => box.union(g.boundingBox), new Box3());
  assert.deepEqual(
    first[1].attributes.position.array,
    again[1].attributes.position.array,
  );
  assert.ok(bounds(long).min.y < bounds(first).min.y - 1);
  for (const g of [...first, ...again, ...long]) {
    assert.ok(g.attributes.position.array.every(Number.isFinite));
    g.dispose();
  }
  source.dispose();
});
