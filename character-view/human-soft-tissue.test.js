import test from "node:test";
import assert from "node:assert/strict";
import { evaluateHuman, humanRestPositions, randomHuman, validHuman } from "./human-surface.js";

const axes = ["malarHeight", "jowlFullness", "submentalFullness"];

test("soft-tissue axes change local geometry without moving the eyes or rig", () => {
  const rest = humanRestPositions();
  for (const frame of [-.9, .9]) {
    const spec = { frame, age: .72, weight: .88, muscle: -.32 };
    const source = evaluateHuman(spec);
    const eyeVertices = new Set(source.eyeGroups.flat());
    const positive = axes.map(axis => evaluateHuman({ ...spec, [axis]: .8 }));
    assert.deepEqual(
      evaluateHuman({ ...spec, malarHeight: 0, jowlFullness: 0, submentalFullness: 0 }).positions,
      source.positions,
    );
    for (const [index, result] of positive.entries()) {
      assert.deepEqual(result.joints, source.joints);
      for (const eye of eyeVertices)
        assert.deepEqual(
          result.positions.subarray(eye * 3, eye * 3 + 3),
          source.positions.subarray(eye * 3, eye * 3 + 3),
        );
      let movement = 0;
      for (let v = 0; v < source.bodyVertices; v++) {
        const [x, y, z] = rest.subarray(v * 3, v * 3 + 3);
        const offset = v * 3 + [1, 0, 2][index];
        const delta = result.positions[offset] - source.positions[offset];
        if (y < .5) assert.equal(delta, 0);
        if (index === 0 && x > .03 && y > .68 && y < .73) movement = Math.max(movement, delta);
        if (index === 1 && x > .041 && y > .62 && y < .67) movement = Math.max(movement, delta);
        if (index === 2 && Math.abs(x) < .022 && y > .59 && y < .65 && z > .08) movement = Math.max(movement, delta);
      }
      assert.ok(movement > .002 && movement < .018, axes[index] + " on frame " + frame);
    }
  }
});

test("new adult draws correlate facial fullness with build while preserving variation", () => {
  const samples = Array.from({ length: 96 }, (_, seed) => randomHuman(seed + 8710));
  assert.ok(samples.every(validHuman));
  for (const axis of ["jowlFullness", "submentalFullness"]) {
    const low = samples.filter(p => p.weight < -.55).map(p => p[axis]);
    const high = samples.filter(p => p.weight > .55).map(p => p[axis]);
    const mean = values => values.reduce((a, b) => a + b) / values.length;
    assert.ok(mean(high) - mean(low) > .4, axis);
    assert.ok(Math.max(...high) - Math.min(...high) > .25, axis);
  }
});
