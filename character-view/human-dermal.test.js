import test from "node:test";
import assert from "node:assert/strict";
import { expressionLines } from "./human-dermal.js";
import { faceChart } from "./human-face-chart.js";

test("forehead and outer-eye creases stay on skin, have raised and recessed sides, and vary by person", () => {
  const face = faceChart();
  const first = expressionLines(32), second = expressionLines(64);
  assert.equal(first.length, face.x.length);
  assert.equal(expressionLines(32), first);
  let dark = 0, ridge = 0, changed = 0;
  for (let i=0; i<first.length; i++) {
    if (face.y[i] < -19 || face.y[i] > 65 || face.skin[i] < .001) assert.equal(first[i], 0);
    if (first[i] < -12) dark++;
    if (first[i] > 4) ridge++;
    if (first[i] !== second[i]) changed++;
  }
  assert.ok(dark > 100 && ridge > 100 && changed > 500);
});
