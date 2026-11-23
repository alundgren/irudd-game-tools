import test from "node:test";
import assert from "node:assert/strict";
import { reshapeSpine, bendKnots } from "./spine-edit.js";
import { applyOperations } from "./variations.js";
const rows = [
  [0, 0, 0, 0.1, 0.1],
  [0, 0.5, 0, 0.1, 0.1],
  [0, 1, 0, 0.1, 0.1],
];
const part = (id, parent, position) => ({
  id,
  parent,
  shape: "ellipsoid",
  position,
  size: [0.1, 0.1, 0.1],
  rotation: [0, 0, 0],
});
const source = {
  parts: [
    { ...part("trunk", undefined, [0, 0, 0]), shape: "sweep", knots: rows },
    part("horn", "trunk", [0.1, 0.5, 0]),
    part("tip", "horn", [0, 0.2, 0]),
    part("other", undefined, [2, 2, 2]),
  ],
};
test("attached sockets follow the carrier's curvature and girth in editable coordinates", () => {
  const knots = rows.map(([x, y, z, w, d]) => [x, y, z, w * 2, d]);
  const result = reshapeSpine(source, "trunk", knots);
  assert.ok(Math.abs(result.parts[1].position[0] - 0.2) < 1e-8);
  assert.equal(result.parts[2], source.parts[2]);
  assert.equal(result.parts[3], source.parts[3]);
  assert.deepEqual(source.parts[1].position, [0.1, 0.5, 0]);
  const angled = rows.map(([x, y, z, w, d]) => [y, 0, z, w, d]);
  const turned = applyOperations(source, [
    { op: "reshapeSpine", id: "trunk", knots: angled },
  ]);
  assert.ok(Math.abs(turned.parts[1].position[0] - 0.5) < 1e-6);
  assert.ok(Math.abs(turned.parts[1].position[1] + 0.1) < 1e-6);
  assert.ok(Math.abs(turned.parts[1].rotation[2] + 90) < 1e-4);
  const lengthened = reshapeSpine(
    source,
    "trunk",
    bendKnots(rows, { extend: 25 }),
  );
  assert.ok(Math.abs(lengthened.parts[1].position[1] - 0.625) < 1e-4);
  const inserted = reshapeSpine(source, "trunk", [
    rows[0],
    [0, 0.25, 0, 0.1, 0.1],
    rows[1],
    rows[2],
  ]);
  assert.ok(Math.abs(inserted.parts[1].position[1] - 0.5) < 1e-6);
});
