import assert from "node:assert/strict";
import test from "node:test";
import { decodeDecks, parseDecks } from "../../src/renderer/choice-decks.js";
import { protectedChanges } from "../../src/renderer/protected-shape.js";
import { directionCode, redrawDirection, replayDirection } from "../../src/renderer/direction.js";

test("custom decks enforce browser bounds on writing and decoding", () => {
  const options = Array.from({ length: 16 }, (_, i) => String(i)).join("|");
  const line = "a".repeat(48) + "=" + options;
  assert.equal(parseDecks(line)[0]?.options.length, 16);
  assert.equal(parseDecks("x=" + "a".repeat(96) + "|b").length, 1);
  const eight = Array.from({ length: 8 }, (_, i) => i + "=a|b").join("\n");
  assert.equal(parseDecks(eight).length, 8);
  for (const bad of [
    "x=a",
    "x=a|",
    "x=a|a",
    "x=a|b\nx=c|d",
    eight + "\ny=a|b",
    line + "|16",
    "a" + line,
    "x=" + "a".repeat(97) + "|b",
    "x=a|b".padEnd(3201),
  ]) {
    assert.throws(() => parseDecks(bad));
  }
  for (const row of [
    ["x", ["a", "a"], null],
    ["x", ["a", "b"], -1],
    ["x", ["a|b", "c"], null],
  ])
    assert.throws(() => decodeDecks(btoa(JSON.stringify([row]))));
});
test("direction codes replay cues, personal draws and pins with browser-compatible seeds", () => {
  const defs = parseDecks("mood = calm | wary | fierce\nväv = lin | 🪶");
  const first = redrawDirection(undefined, "radical", 1, defs);
  assert.equal(first.decks[0]?.value, "wary");
  first.pins[0] = 1;
  const fabric = first.decks[1];
  assert.ok(fabric);
  fabric.pin = 1;
  const next = redrawDirection(first, "radical", 2);
  assert.deepEqual(next.cues, ["Transform a limb into another functional structure", "Radial fan"]);
  assert.equal(next.magnitude, 39);
  assert.equal(next.cues[0], first.cues[0]);
  assert.equal(next.decks[0]?.value, "fierce");
  assert.equal(next.decks[1]?.value, fabric.value);
  assert.deepEqual(replayDirection(directionCode(next)), next);
  assert.deepEqual(redrawDirection(next, "subtle", 0).pins, [null, null]);
  for (const bad of [
    "radical/zzzzzzz",
    "radical/1/0",
    "other/2",
    "subtle/2~junk",
    "subtle/undefined",
    "subtle/2~~",
  ])
    assert.throws(() => replayDirection(bad));
});

test("a shape lock follows changes to the part and allows placement edits", () => {
  const changes = ["position", "parent", "rotation"].map((field) => ({
    path: ["parts", "p-head", field],
  }));
  assert.deepEqual(
    protectedChanges(
      undefined,
      undefined,
      [...changes, { path: ["parts", "p-arm", "size"] }],
      ["p-head"],
    ),
    [],
  );
  for (const path of [
    ["parts", "p-head"],
    ["parts", "p-head", "size"],
    ["parts", "p-head", "sculpt", "nose"],
  ]) {
    assert.deepEqual(protectedChanges(undefined, undefined, [{ path }], ["p-head"]), ["p-head"]);
  }
});
