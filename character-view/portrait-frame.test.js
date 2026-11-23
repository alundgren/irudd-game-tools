import test from "node:test";
import assert from "node:assert/strict";
import { headSpace, registerFace } from "./portrait-frame.js";
import { startingForm, validateForm } from "./recipe.js";
test("the same face landmarks have head-scale sculpt coordinates inside an isolated or full-body image", () => {
  const panel = { size: 1000, mid: 500, feet: 1000, span: 1000 };
  const unit = [
    [0.4, 0.36],
    [0.6, 0.36],
    [0.5, 0.49],
    [0.5, 0.6],
    [0.5, 0.76],
  ];
  function fixture(h, base, span) {
    const height = span * h,
      knots = [
        [0, 0, 0, 0.05, 0.06],
        [0, height, 0, 0.05, 0.06],
      ];
    const part = {
      id: "head",
      shape: "sweep",
      knots,
      position: [0, base * h, 0],
      rotation: [0, 0, 0],
      size: [1, 1, 1],
      color: "#ffffff",
      paint: {
        atlas: "trial",
        height: h,
        offset: [0, base * h, 0],
        rest: knots,
      },
    };
    const marks = unit.map(([x, y]) => [
      0.5 + (x - 0.5) * span,
      1 - base - (1 - y) * span,
    ]);
    const result = registerFace(part, marks, panel),
      form = startingForm(() => 0.5);
    form.parts = [result];
    validateForm(form);
    return result;
  }
  const portrait = fixture(0.3, 0, 1),
    full = fixture(1.8, 0.8, 1 / 6);
  const a = headSpace(portrait.paint),
    b = headSpace(full.paint);
  assert.ok(Math.abs(a.height - b.height) < 1e-9);
  for (const k of ["width", "eyes", "nose", "mouth", "chin"])
    assert.ok(Math.abs(a.portrait[k] - b.portrait[k]) < 1e-9);
  assert.ok(Math.abs(b.offset[1]) < 1e-9);
  assert.equal(full.paint.height, 1.8);
  assert.throws(() => registerFace(full, unit.slice(0, 3), panel));
});
