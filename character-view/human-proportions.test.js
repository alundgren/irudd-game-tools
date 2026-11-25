import assert from "node:assert/strict";
import test from "node:test";
import { humanForm } from "./human-form.js";
import { evaluateHuman, humanControls, humanRange, smoothHumanSurface, validHuman } from "./human-surface.js";
import { exteriorSkin } from "./human-fit-exterior.js";
import { eyeOpenings } from "./human-fit-eyes.js";
import {
  fitProportions,
  measureProportions,
  proportionControls,
  proportionEnds,
  proportionPlaces,
  proportionReading,
  proportions,
  proportionText,
  suggestControls,
} from "./human-proportions.js";

const ids = proportions.map((p) => p.id),
  mm = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 1000,
  worst = (rows) => Math.max(...rows.map((r) => Math.abs(r.afterMm - r.referenceMm))),
  value = (form, key) => form.human[key] ?? 0;

test("the places of the proportions lie on the outside of the head, alike on both sides", () => {
  for (const human of [{}, { height: 1.86, frame: 0.6, eyeSize: 0.5, lips: -0.4, jaw: 0.3, chinHeight: 0.5 }]) {
    const cage = evaluateHuman(human),
      smooth = smoothHumanSurface(cage),
      exterior = exteriorSkin(cage),
      eyes = eyeOpenings(cage),
      at = (name) =>
        [0, 1, 2].map(
          (d) => proportionPlaces[name].reduce((sum, v) => sum + smooth.positions[v * 3 + d], 0) / proportionPlaces[name].length,
        );
    for (const [name, list] of Object.entries(proportionPlaces))
      for (const v of list) {
        assert.equal(cage.names[cage.boneIndices[v * 4]], "head", name);
        assert.equal(exterior[v], 1, name);
        // Lid edges an artist can see and click, not the lining behind them.
        assert.equal(eyes.lining[v], 0, name);
      }
    for (const [left, right] of [
      ["eyeOuter", "eyeOuterRight"],
      ["eyeInner", "eyeInnerRight"],
      ["mouthLeft", "mouthRight"],
      ["nostrilLeft", "nostrilRight"],
    ]) {
      const a = at(left),
        b = at(right);
      assert.ok(a[0] > 0.005, left);
      assert.ok(mm(a, [-b[0], b[1], b[2]]) < 0.05, left);
    }
    for (const name of ["noseRoot", "noseBase", "lipTop", "mouthLine", "lipBottom", "chinBase"])
      assert.ok(Math.abs(at(name)[0]) < 1e-4, name);
    // Down the middle of the face in the order of the face itself.
    const down = ["noseRoot", "noseBase", "lipTop", "mouthLine", "lipBottom", "chinBase"].map((name) => at(name)[1]);
    for (let i = 1; i < down.length; i++) assert.ok(down[i] < down[i - 1]);
    assert.ok(at("eyeInner")[0] < at("lidUpper")[0] && at("lidUpper")[0] < at("eyeOuter")[0]);
    assert.ok(at("lidUpper")[1] > at("lidLower")[1]);
    // The same places as the readings use.
    const form = { human },
      ends = proportionEnds(form, "mouthWidth");
    assert.ok(mm(ends[0], at("mouthLeft")) < 1e-3 && mm(ends[1], at("mouthRight")) < 1e-3);
    const reading = measureProportions(form);
    assert.ok(Math.abs(reading.mouthWidth - mm(at("mouthLeft"), at("mouthRight"))) < 1e-3);
    assert.ok(Math.abs(reading.noseLength - (at("noseRoot")[1] - at("noseBase")[1]) * 1000) < 1e-3);
  }
  const neutral = measureProportions({ human: {} });
  // An adult face: nothing here is a scan's number, only what a face is.
  for (const [id, lo, hi] of [
    ["mouthWidth", 40, 56],
    ["noseWidth", 30, 42],
    ["eyeLength", 22, 31],
    ["eyeOpening", 6, 11],
    ["innerEyes", 28, 40],
    ["outerEyes", 78, 96],
    ["noseLength", 44, 60],
    ["mouthToChin", 36, 50],
  ])
    assert.ok(neutral[id] > lo && neutral[id] < hi, id + " " + neutral[id]);
});

test("a reading is taken the same whichever end is marked first", () => {
  const form = { human: { eyeTilt: -0.6 } };
  for (const id of ids) {
    const [a, b] = proportionEnds(form, id);
    assert.equal(proportionReading(id, a, b), proportionReading(id, b, a), id);
    assert.ok(Math.abs(proportionReading(id, a, b) - measureProportions(form)[id]) < 1e-9, id);
  }
  assert.ok(measureProportions(form).eyeSlant > measureProportions({ human: {} }).eyeSlant + 1);
});

test("a reading is what the face shows from straight ahead: how deep a mark lies does not count", () => {
  const form = { human: {} };
  for (const id of ids) {
    const [a, b] = proportionEnds(form, id),
      deeper = [b[0], b[1], b[2] - 0.012];
    assert.equal(proportionReading(id, a, deeper), proportionReading(id, a, b), id);
  }
  // The outer corner of an eye lies well behind the inner one; the reading is the eye seen from the front.
  const [inner, outer] = proportionEnds(form, "eyeLength");
  assert.ok(inner[2] - outer[2] > 0.003);
  assert.ok(measureProportions(form).eyeLength < mm(inner, outer) - 0.2);
});

test("controls made for a feature are suggested for it, and those that reshape the whole head only offered", () => {
  const whole = ["headWidth", "faceHeight", "forehead", "craniumDepth", "faceA", "faceB"];
  for (const human of [{}, { eyeSize: 0.4, lips: -0.5, chinHeight: 0.4, faceHeight: 0.3, headWidth: -0.4, nose: 0.5 }]) {
    const form = { human },
      offered = new Set();
    for (const id of ids) {
      const chosen = suggestControls(form, [id]);
      for (const key of chosen) {
        assert.ok(!whole.includes(key), id + " " + key);
        assert.ok(chosen.able.includes(key));
      }
      chosen.able.forEach((key) => offered.add(key));
    }
    const suggested = (id) => [...suggestControls(form, [id])];
    assert.deepEqual(suggested("mouthWidth"), ["lips"]);
    assert.deepEqual(suggested("eyeLength"), ["eyeSize"]);
    assert.deepEqual(suggested("noseWidth").sort(), ["nose", "nostrilWidth"]);
    assert.deepEqual(suggested("outerEyes").sort(), ["eyeSize", "eyeSpacing"]);
    assert.deepEqual(suggested("mouthToChin").sort(), ["chinHeight", "mouthLevel"]);
    assert.deepEqual(suggested("eyeSlant"), ["eyeTilt"]);
    // An artist may still tick a control of the whole head for a width or a height.
    assert.ok(suggestControls(form, ["outerEyes"]).able.includes("headWidth"));
    assert.ok(offered.has("faceHeight"));
  }
});

test("a proportion fit brings a plain head to the readings of a generated one", () => {
  const made = {
      lips: 0.6,
      nostrilWidth: -0.5,
      eyeSize: 0.5,
      eyeSpacing: -0.4,
      eyeTilt: 0.5,
      chinHeight: 0.3,
      upperLipHeight: 0.4,
      noseLength: 0.5,
    },
    targets = measureProportions({ human: made }),
    form = humanForm({ height: 1.72 }),
    result = fitProportions(form, targets);
  const before = result.proportions.map((r) => Math.abs(r.beforeMm - r.referenceMm));
  assert.ok(Math.max(...before) > 3);
  assert.ok(worst(result.proportions) < 0.4, "worst " + worst(result.proportions));
  assert.ok(result.proportions.reduce((sum, r) => sum + Math.abs(r.afterMm - r.referenceMm), 0) / ids.length < 0.15);
  assert.equal(result.changed, true);
  assert.ok(validHuman(result.form.human));
  // What is reported is what the recipe measures, also after saving and opening it again.
  const again = measureProportions(humanForm(JSON.parse(JSON.stringify(result.form.human))));
  for (const r of result.proportions) assert.ok(Math.abs(again[r.id] - r.afterMm) < 1e-6, r.id);
  for (const c of result.controls) {
    assert.equal(result.form.human[c.key], c.to);
    assert.equal(c.from, 0);
  }
});

test("one reading moves its own control and little else", () => {
  const form = humanForm({ height: 1.78, jaw: 0.4, cheeks: -0.3, eyeSize: 0.25 }),
    now = measureProportions(form),
    result = fitProportions(form, { mouthWidth: now.mouthWidth + 6 });
  assert.deepEqual(result.controls.map((c) => c.key), ["lips"]);
  assert.ok(worst(result.proportions) < 0.1);
  for (const key of Object.keys(result.form.human))
    if (key !== "lips") assert.equal(result.form.human[key], form.human[key], key);
  for (const other of result.others) assert.ok(Math.abs(other.afterMm - other.beforeMm) < 0.6, other.id);
  assert.equal(result.others.length, ids.length - 1);
  assert.ok(result.skinMovedMm > 0.2 && result.skinMovedMm < 2);
  // Nothing to do when the reading is already met.
  const idle = fitProportions(form, { mouthWidth: now.mouthWidth });
  assert.equal(idle.changed, false);
  assert.equal(idle.form, form);
});

test("a control that acts differently above and below its rest is followed both ways", () => {
  const form = humanForm({ height: 1.72 }),
    now = measureProportions(form).mouthToChin,
    settings = [];
  for (const change of [-3, 3]) {
    const result = fitProportions(form, { mouthToChin: now + change }, { controls: ["chinHeight"] });
    assert.ok(worst(result.proportions) < 0.1, String(change));
    settings.push(result.form.human.chinHeight);
  }
  assert.ok(settings[0] < 0 && settings[1] > 0);
  // The chin shortens more slowly than it lengthens, so the same change asks for more.
  assert.ok(-settings[0] > 1.5 * settings[1]);
});

test("a reading out of reach stops at the limit of its control and says so", () => {
  const form = humanForm({ height: 1.72 }),
    result = fitProportions(form, { eyeSlant: measureProportions(form).eyeSlant + 9 });
  const tilt = result.controls.find((c) => c.key === "eyeTilt");
  assert.equal(tilt.atLimit, true);
  assert.equal(Math.abs(tilt.to), 1);
  const [row] = result.proportions;
  assert.ok(row.afterMm > row.beforeMm + 1.5 && row.afterMm < row.referenceMm - 3);
  for (const [key, x] of Object.entries(result.form.human)) {
    const [lo, hi] = humanRange(key);
    assert.ok(x >= lo && x <= hi, key);
  }
  assert.match(proportionText(result, { eyeTilt: "Outer eye angle" }), /Outer eye angle 0\.00 → -?1\.00 at its limit/);
});

test("marked ends on an aligned reference say which end of a midline height moves", () => {
  const form = humanForm({ height: 1.72 }),
    reference = { human: { mouthLevel: -0.7 } },
    high = (recipe, id) => proportionEnds(recipe, id).map((point) => point[1] * 1000),
    off = (recipe, id) => high(recipe, id).map((y, k) => Math.abs(y - high(reference, id)[k]));
  // The reference's mouth sits lower. Its chin is where the plain head has it.
  assert.ok(off(form, "mouthToChin")[0] > 4 && off(form, "mouthToChin")[1] < 0.2);
  for (const id of ["mouthToChin", "noseToMouth"]) {
    const targets = { [id]: measureProportions(reference)[id] },
      ends = { [id]: proportionEnds(reference, id).reverse() },
      apart = fitProportions(form, targets),
      placed = fitProportions(form, targets, { ends });
    // A distance alone is met, by whichever end is cheapest to move.
    assert.ok(worst(apart.proportions) < 0.3, id);
    assert.ok(Math.max(...off(apart.form, id)) > 3, id + " " + off(apart.form, id));
    // With the ends marked, each end comes to its mark and the reading follows.
    assert.ok(Math.max(...off(placed.form, id)) < 0.3, id + " " + off(placed.form, id));
    assert.ok(worst(placed.proportions) < 0.3, id);
    assert.equal(placed.ends.length, 2);
    for (const end of placed.ends) {
      assert.ok(Math.abs(end.afterMm - end.referenceMm) < 0.3, end.place);
      assert.ok(Math.abs(end.afterMm - end.referenceMm) <= Math.abs(end.beforeMm - end.referenceMm) + 1e-9, end.place);
    }
  }
  // The chin stays: the mouth is what was out of place.
  const chin = fitProportions(form, { mouthToChin: measureProportions(reference).mouthToChin }, { ends: { mouthToChin: proportionEnds(reference, "mouthToChin") } });
  assert.equal(value(chin.form, "chinHeight"), 0);
  assert.ok(Math.abs(value(chin.form, "mouthLevel") + 0.7) < 0.05);
  // Marked ends change nothing for a width, and nothing without them.
  const width = { mouthWidth: measureProportions(form).mouthWidth + 5 };
  assert.deepEqual(
    fitProportions(form, width, { ends: { mouthWidth: proportionEnds(reference, "mouthWidth") } }).form.human,
    fitProportions(form, width).form.human,
  );
  assert.deepEqual(fitProportions(form, width).ends, []);
});

test("only the chosen controls move, and readings that pull apart are met as nearly as they can be", () => {
  const form = humanForm({ height: 1.72 }),
    now = measureProportions(form),
    targets = { eyeLength: now.eyeLength + 3, eyeOpening: now.eyeOpening - 0.5 },
    result = fitProportions(form, targets, { controls: ["eyeSize"] });
  assert.deepEqual(result.controls.map((c) => c.key), ["eyeSize"]);
  // One control makes the eye longer and taller together: it settles between the two.
  const [length, opening] = result.proportions;
  assert.ok(length.afterMm > length.beforeMm + 1 && length.afterMm < length.referenceMm);
  assert.ok(opening.afterMm > opening.beforeMm);
  // Both readings together are missed by less than before.
  const miss = (pick) => Math.hypot(...result.proportions.map((r) => r[pick] - r.referenceMm));
  assert.ok(miss("afterMm") < miss("beforeMm"));
});

test("kept eye openings and skin hidden on the reference leave their controls alone", () => {
  const form = humanForm({ height: 1.72, eyeSize: 0.2 }),
    now = measureProportions(form),
    targets = { eyeLength: now.eyeLength + 3, innerEyes: now.innerEyes - 2, mouthWidth: now.mouthWidth + 5 };
  const free = fitProportions(form, targets);
  assert.ok(free.controls.some((c) => c.key === "eyeSize") && free.controls.some((c) => c.key === "lips"));
  const kept = fitProportions(form, targets, { keepEyeOpenings: true });
  for (const key of ["eyeSize", "eyeSpacing", "eyeTilt", "eyeFold", "underEye"]) assert.equal(value(kept.form, key), value(form, key));
  assert.ok(Math.abs(kept.proportions[2].afterMm - kept.proportions[2].referenceMm) < 0.1);
  assert.ok(Math.abs(kept.proportions[0].afterMm - kept.proportions[0].beforeMm) < 0.2);
  const offered = proportionControls(form, { keepEyeOpenings: true }),
    eye = offered.find((c) => c.key === "eyeSize");
  assert.equal(eye.free, false);
  assert.equal(eye.why, "eye openings kept");
  assert.equal(offered.find((c) => c.key === "lips").free, true);
  assert.ok(!suggestControls(form, ["eyeLength", "mouthWidth"], { keepEyeOpenings: true }).includes("eyeSize"));
  // Asked for by name, a kept control is still left alone and named.
  const asked = fitProportions(form, targets, { keepEyeOpenings: true, controls: ["eyeSize", "lips"] });
  assert.deepEqual(asked.kept, [{ key: "eyeSize", why: "eye openings kept" }]);
  assert.deepEqual(asked.controls.map((c) => c.key), ["lips"]);
  // The lower face hidden on the reference: the mouth's control is not used.
  const mouthLine = proportionEnds(form, "noseToMouth")[1][1],
    hold = (point) => point.y < mouthLine + 0.012 && point.z > 0.05,
    hidden = fitProportions(form, targets, { hold });
  assert.equal(value(hidden.form, "lips"), value(form, "lips"));
  assert.equal(proportionControls(form, { hold }).find((c) => c.key === "lips").why, "hidden on the reference");
  assert.ok(hidden.controls.some((c) => c.key === "eyeSize"));
});

test("a sculpt and the artist's own settings ride along with a proportion fit", () => {
  const start = humanForm({ height: 1.8, jaw: 0.4, lips: 0.2, cheeks: -0.3 }),
    { ids: anchors } = humanControls(),
    skin = evaluateHuman(start.human),
    corner = proportionEnds(start, "mouthWidth")[0],
    // The anchor nearest the left corner of the mouth, pulled 3 mm outward by hand.
    nearest = Array.from(anchors.keys()).reduce((a, b) =>
      mm(skin.positions.subarray(anchors[a] * 3, anchors[a] * 3 + 3), corner) <
      mm(skin.positions.subarray(anchors[b] * 3, anchors[b] * 3 + 3), corner)
        ? a
        : b,
    ),
    form = { ...start, humanFit: { version: 1, strength: 1, controls: [[nearest, 30, 0, 0]] } },
    plain = measureProportions(start),
    sculpted = measureProportions(form);
  assert.ok(sculpted.mouthWidth > plain.mouthWidth + 0.5);
  const result = fitProportions(form, { mouthWidth: sculpted.mouthWidth + 4 });
  assert.ok(worst(result.proportions) < 0.1);
  assert.equal(result.proportions[0].beforeMm, sculpted.mouthWidth);
  assert.equal(result.form.humanFit.controls.length, 1);
  assert.equal(result.form.humanFit.controls[0][0], nearest);
  for (const key of ["height", "jaw", "cheeks"]) assert.equal(result.form.human[key], form.human[key]);
  assert.ok(result.form.human.lips > 0.4);
  assert.deepEqual(result.controls.map((c) => [c.key, c.from]), [["lips", 0.2]]);
});

test("the step is told in the artist's words", () => {
  const form = humanForm({ height: 1.72 }),
    now = measureProportions(form),
    result = fitProportions(form, { mouthWidth: now.mouthWidth + 4 }),
    text = proportionText(result, { lips: "Mouth width" });
  assert.match(text, /^Proportions · Mouth width \d+\.\d → \d+\.\d mm \(reference \d+\.\d\) · controls: Mouth width 0\.00 → 0\.\d\d$/);
  assert.match(proportionText(fitProportions(form, { mouthWidth: now.mouthWidth })), /controls: none changed$/);
  // A proportion nobody marked that moved along is named too.
  const longer = fitProportions(form, { noseLength: now.noseLength + 2 });
  assert.match(proportionText(longer), /also changed: .*Nose to mouth line −\d\.\d mm/);
  assert.throws(() => fitProportions(form, {}), /Mark at least one/);
  assert.throws(() => fitProportions(form, { browArch: 3 }), /Unknown proportion/);
});
