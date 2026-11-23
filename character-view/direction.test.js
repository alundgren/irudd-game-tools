import assert from "node:assert/strict";
import test from "node:test";
import {
  applyOperations,
  directionCode,
  redrawDirection,
  replayDirection,
} from "./variations.js";

test("a direction can retain one cue while sampling the other, then replay the exact draw", () => {
  const first = redrawDirection(null, "radical", 18321);
  let prior = { ...first, pins: [first.seed, null] };
  const seen = new Set();
  for (let seed = 0; seed < 100; seed++) {
    const next = redrawDirection(prior, "radical", seed);
    assert.equal(next.cues[0], first.cues[0]);
    assert.deepEqual(replayDirection(directionCode(next)), next);
    seen.add(next.cues[1]);
    prior = next;
  }
  assert.ok(seen.size >= 5);
  assert.deepEqual(redrawDirection(prior, "subtle", 1).pins, [null, null]);
  for (const code of [
    "",
    "radical//",
    "radical/z?",
    "radical/zzzzzzz",
    "radical/2/1",
    "missing/1",
  ]) {
    assert.throws(() => replayDirection(code));
  }
});
test("new parts with omitted local transforms receive independent metric defaults", () => {
  const preview = { parts: [] };
  const result = applyOperations(
    preview,
    [
      {
        op: "addPart",
        part: { id: "core", shape: "ellipsoid", color: "#789c8d" },
      },
    ],
    {},
    true,
  );
  const p = result.parts[0];
  assert.deepEqual(p.rotation, [0, 0, 0]);
  assert.deepEqual(p.position, [0, 0, 0]);
  assert.deepEqual(p.frameSize, [1, 1, 1]);
  assert.notEqual(p.frameSize, p.size);
  assert.deepEqual(preview.parts, []);
});
