import assert from "node:assert/strict";
import test from "node:test";
import { initial, reroll, values } from "./recipe.js";

test("each legal reroll changes only the selected feature, at both ends of the draw range", () => {
  for (const recipe of initial)
    for (const key of Object.keys(values)) {
      for (const draw of [0, 0.5, 1 - Number.EPSILON]) {
        const next = reroll(recipe, key, draw);
        assert.ok(values[key].includes(next[key]));
        assert.notEqual(next[key], recipe[key]);
        assert.deepEqual({ ...next, [key]: recipe[key] }, recipe);
      }
    }
});
