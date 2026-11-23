import { parseDecks, drawDecks } from "./choice-decks.js";
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
test("operator choices remain independent, replay across Unicode and visit every allowed value", () => {
  const definitions = parseDecks(
    "Fötter = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10\nFinish = linen | 🪶 feathers",
  );
  const counts = new Map();
  for (let seed = 0; seed < 2000; seed++) {
    const [a, b] = drawDecks(definitions, seed);
    assert.equal(
      drawDecks(definitions.slice().reverse(), seed)[1].value,
      a.value,
    );
    counts.set(a.value, (counts.get(a.value) ?? 0) + 1);
  }
  assert.equal(counts.size, 10);
  assert.ok([...counts.values()].every((n) => n > 145 && n < 255));
  let prior = redrawDirection(null, "radical", 25);
  prior.decks = drawDecks(definitions, prior.seed);
  prior.decks[0].pin = prior.seed;
  const next = redrawDirection(prior, "radical", 0xffffffff);
  assert.equal(next.decks[0].value, prior.decks[0].value);
  assert.deepEqual(replayDirection(directionCode(next)), next);
  for (const bad of ["empty", "X = a | a", "X = a | b\nX = c | d"])
    assert.throws(() => parseDecks(bad));
  assert.throws(() => replayDirection("radical/3~junk"));
});
