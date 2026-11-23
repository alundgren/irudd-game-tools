import test from "node:test";
import assert from "node:assert/strict";
import { sweepGeometry } from "./surface.js";
import {
  depthFromPixels,
  applyPortraitDepth,
  validDepth,
} from "./portrait-depth.js";
test("the generated depth field deforms only the front and remains smooth where the silhouette widens", () => {
  const size = 128,
    rgba = new Uint8Array(size * size * 4);
  for (let y = 8; y < 120; y++)
    for (let x = 10; x < 118; x++) {
      const u = (x - 64) / 45,
        v = (y - 64) / 56,
        head = u * u + v * v < 1;
      const ears = y >= 58 && y < 75 && Math.abs(u) < 1.13;
      if (!head && !ears) continue;
      const z =
        80 +
        80 * Math.sqrt(Math.max(0, 1 - u * u * 0.9 - v * v * 0.7)) +
        48 * Math.exp(-((u - 0.16) ** 2 / 0.018 + (v * v) / 0.05));
      const k = 4 * (y * size + x);
      rgba.set([z, z, z, 255], k);
    }
  const depthField = depthFromPixels(rgba, size, size);
  assert.ok(validDepth(depthField));
  const rest = Array.from({ length: 41 }, (_, i) => [
    0,
    i / 160,
    0,
    0.081,
    0.073,
  ]);
  const g = sweepGeometry(rest, true, 96),
    pos = g.attributes.position,
    old = pos.array.slice();
  applyPortraitDepth(g, { height: 0.25, offset: [0, 0, 0], rest, depthField });
  let changed = 0,
    maxAdjacent = 0;
  for (let i = 0; i < pos.count; i++) {
    if (old[i * 3 + 2] < 0) assert.equal(old[i * 3 + 2], pos.getZ(i));
    if (Math.abs(old[i * 3 + 2] - pos.getZ(i)) > 0.001) changed++;
    if (i >= 97 && Math.abs(pos.getX(i)) < 0.025)
      maxAdjacent = Math.max(
        maxAdjacent,
        Math.abs(pos.getZ(i) - pos.getZ(i - 97)),
      );
  }
  assert.ok(changed > 500);
  assert.ok(maxAdjacent < 0.005);
  g.dispose();
});
