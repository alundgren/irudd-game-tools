import test from "node:test";
import assert from "node:assert/strict";
import { sweepGeometry } from "./surface.js";
import { fitDepth, frontDepth, validPins } from "./depth-pins.js";

test("paired views set local cheek depth and preserve the rear and remote surfaces", () => {
  const rows = Array.from({ length: 11 }, (_, i) => [0, i / 40, 0, 0.1, 0.085]);
  const g = sweepGeometry(rows, true, 120),
    p = g.attributes.position;
  const far = frontDepth(g, -0.06, 0.055),
    initial = frontDepth(g, 0.025, 0.125);
  const back = [];
  for (let n = 0; n < p.count; n++)
    if (p.getZ(n) < 0) back.push([n, p.getZ(n)]);
  fitDepth(
    g,
    [
      [0.025, 0.125, initial + 0.012, 0.065],
      [-0.025, 0.125, frontDepth(g, -0.025, 0.125), 0.064],
    ],
    0.25,
  );
  assert.ok(Math.abs(frontDepth(g, 0.025, 0.125) - (initial + 0.012)) < 0.0005);
  assert.equal(frontDepth(g, -0.06, 0.055), far);
  for (const [n, z] of back) assert.equal(p.getZ(n), z);
  assert.equal(frontDepth(g, 0.5, 0.125), null);
  assert.ok(!validPins([[0, 0, 0, 0]]));
  g.dispose();
});
