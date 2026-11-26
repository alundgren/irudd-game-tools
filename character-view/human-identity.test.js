import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateHuman,
  humanAxes,
  humanFitAxes,
  humanIdentityAxes,
  humanRange,
  malarBend,
  randomHuman,
  validHuman,
} from "./human-surface.js";
import { drawHumanIdentity, generatedHuman, nudgeHuman, rerollHuman } from "./human-form.js";
import { drawIdentity, faceOutlines, skinLightness } from "./human-identity.js";
import { readFileSync } from "node:fs";

const editorSource = readFileSync(new URL("./human-editor.js", import.meta.url), "utf8");

test("an adult saved without identity controls keeps its surface", () => {
  const saved = { height: 1.81, frame: 0.6, age: 0.4, weight: 0.3, jaw: 0.5, noseLength: -0.4, smileLeft: 0.3 };
  const zeros = Object.fromEntries(humanIdentityAxes.map((key) => [key, 0]));
  const before = evaluateHuman(saved), after = evaluateHuman({ ...saved, ...zeros });
  assert.deepEqual(after.positions, before.positions);
  assert.deepEqual(after.joints, before.joints);
  assert.ok(humanIdentityAxes.length >= 30);
  for (const key of humanIdentityAxes) {
    assert.ok(humanAxes.includes(key) && !humanFitAxes.includes(key), key);
    assert.deepEqual(humanRange(key), [-1, 1, 0]);
    assert.match(editorSource, new RegExp("\n    " + key + ': "'), key + " has a name in the editor");
  }
  assert.ok(["jaw", "faceA", "height", "shoulderLine"].every((key) => humanFitAxes.includes(key)));
});

test("each identity control reshapes the head and leaves the body its shape", () => {
  const base = evaluateHuman({}), pelvis = base.names.indexOf("pelvis") * 3 + 1;
  const head = new Set(["head", "neck_01"].map((name) => base.names.indexOf(name)));
  for (const key of humanIdentityAxes)
    for (const value of [-1, 1]) {
      const moved = evaluateHuman({ [key]: value }), scale = moved.joints[pelvis] / base.joints[pelvis];
      let most = 0, below = 0;
      for (let v = 0; v < base.bodyVertices; v++) {
        const d = Math.hypot(moved.positions[v * 3] - scale * base.positions[v * 3], moved.positions[v * 3 + 1] - scale * base.positions[v * 3 + 1],
          moved.positions[v * 3 + 2] - scale * base.positions[v * 3 + 2]);
        if (head.has(base.boneIndices[v * 4])) most = Math.max(most, d);
        else below = Math.max(below, d);
      }
      assert.ok(Math.abs(scale - 1) < 0.012, key + " " + value + " rescales the figure by " + scale);
      assert.ok(most > 0.001 && most < 0.021, key + " " + value + " moves the head by " + (1000 * most).toFixed(1) + " mm");
      assert.ok(below < 0.0007, key + " " + value + " reshapes the body by " + (1000 * below).toFixed(2) + " mm");
    }
});

test("new adults are valid, repeatable people with chosen outlines, moods and soft tissue", () => {
  const draws = Array.from({ length: 160 }, (_, i) => randomHuman(52000 + i));
  assert.ok(draws.every(validHuman));
  assert.deepEqual(randomHuman(52003), draws[3]);
  for (const key of ["faceTaper", "faceRound", "faceSquare"]) {
    assert.ok(draws.some((p) => p[key] > 0.35) && draws.some((p) => p[key] < -0.25), key);
  }
  assert.ok(draws.some((p) => p.faceDiamond > 0.3));
  const committed = draws.filter((p) => ["faceTaper", "faceRound", "faceSquare", "faceDiamond"].some((key) => Math.abs(p[key]) > 0.3));
  assert.ok(committed.length > 0.75 * draws.length, committed.length + " of " + draws.length);
  const byAge = [...draws].sort((a, b) => a.age - b.age), third = Math.floor(draws.length / 3);
  const mean = (list, key) => list.reduce((sum, p) => sum + p[key], 0) / list.length;
  assert.ok(mean(byAge.slice(-third), "nasolabialFold") - mean(byAge.slice(0, third), "nasolabialFold") > 0.4);
  assert.ok(mean(byAge.slice(-third), "lidBag") - mean(byAge.slice(0, third), "lidBag") > 0.25);
  assert.ok(draws.filter((p) => p.smileLeft > 0.5 && p.smileRight > 0.5).length >= 5);
  assert.ok(draws.filter((p) => Math.abs(p.smileLeft) < 0.15 && Math.abs(p.smileRight) < 0.15).length >= 40);
  assert.ok(draws.filter((p) => p.mouthCorners < -0.1).length >= 8);
  assert.ok(draws.filter((p) => Math.abs(p.smileLeft - p.smileRight) > 0.3).length >= 5);
  assert.ok(draws.every((p) => Math.abs(p.eyeSkew) <= 0.3));
  assert.ok(draws.filter((p) => ["jawSkew", "noseSkew", "mouthSkew", "browSkew"].some((key) => Math.abs(p[key]) > 0.3)).length > 20);
});

test("the body of a seed is the same body whatever face it draws", () => {
  for (const seed of [8710, 8715, 52004]) {
    const p = randomHuman(seed);
    const again = randomHuman(seed, "any", { relaxed: false });
    for (const key of ["height", "frame", "age", "weight", "muscle", "shoulders", "hips", "waist", "legs"]) assert.equal(p[key], again[key], key);
    assert.equal(p.faceA, again.faceA);
    assert.equal(p.faceSquare, again.faceSquare);
  }
});

test("a full face is shared out and the eye opening stays within what the lids carry", () => {
  const draws = Array.from({ length: 400 }, (_, i) => randomHuman(9000 + i));
  for (const p of draws) {
    assert.ok(p.eyeOpening >= -0.36 && p.eyeOpening <= 0.3);
    const load = ["faceFlesh", "jowlFullness", "cheekFullness", "submentalFullness"].reduce((sum, key) => sum + Math.max(0, p[key]), 0)
      + 0.7 * Math.max(0, -p.faceTaper);
    assert.ok(load < 1.52, "lower-face fullness " + load.toFixed(2));
    if (p.faceSquare > 0.3) assert.ok(p.faceRound >= -0.15);
    const jawWidth = 0.8 * Math.max(0, p.faceSquare) + 0.8 * Math.max(0, -p.faceTaper) + Math.max(0, p.jaw) + Math.max(0, p.jawAngle);
    assert.ok(jawWidth < 1.75, "jaw width " + jawWidth.toFixed(2));
  }
});

test("skin lightness follows the skull's ancestry loosely and spans dark to light", () => {
  assert.ok(skinLightness([1, 0, 0], 0.5) < skinLightness([0, 1, 0], 0.5));
  assert.ok(skinLightness([0, 1, 0], 0.5) < skinLightness([0, 0, 1], 0.5));
  assert.ok(skinLightness([1, 0, 0], 0.99) > skinLightness([0, 0, 1], 0.01));
  const value = (hex) => [1, 3, 5].reduce((sum, at) => sum + parseInt(hex.slice(at, at + 2), 16), 0) / 765;
  const tones = Array.from({ length: 120 }, (_, i) => value(generatedHuman(52000 + i).appearance.skin));
  assert.ok(Math.min(...tones) < 0.3 && Math.max(...tones) > 0.72);
  assert.ok(tones.filter((t) => t < 0.42).length > 15 && tones.filter((t) => t > 0.6).length > 15);
});

test("an identity control can be nudged and rerolled like any other measurement", () => {
  const start = generatedHuman(52001);
  const nudged = nudgeHuman(start, { jawAngle: 0.2, nasolabialFold: -0.3 });
  assert.ok(Math.abs(nudged.human.jawAngle - Math.min(1, start.human.jawAngle + 0.2)) < 1e-9);
  const rerolled = rerollHuman(start, ["faceSquare", "noseCurve"], 77);
  assert.equal(rerolled.human.faceSquare, randomHuman(77, "any", { relaxed: false }).faceSquare);
  assert.equal(rerolled.human.jaw, start.human.jaw);
});

test("the identity draw reports the outline and types it chose", () => {
  const u = (key) => ({ outline: 0.99, mood: 0.5, ancestry: 0.1 })[key] ?? 0.5;
  const spec = { age: 0.2, frame: 0, weight: 0, belly: 0, muscle: 0 };
  const chosen = drawIdentity(spec, u, { relaxed: true });
  assert.equal(chosen.outline, faceOutlines.at(-1)[1]);
  assert.ok(chosen.nose && chosen.eyes && chosen.mouth && chosen.brow && chosen.mood);
  assert.ok(Math.abs(chosen.share.reduce((a, b) => a + b) - 1) < 1e-9);
  assert.ok(spec.faceDiamond > 0.2);
});

test("mixed colouring occasionally draws a fantasy identity and preserves every other body measurement", () => {
  let fantasy = 0;
  for (let seed = 39050; seed < 39170; seed++) {
    const draw = colourRange => drawHumanIdentity(seed, "any", {colourRange, fitRestingLips:false});
    const mixed = draw("Mixed"), natural = draw("Natural"), other = draw("Fantasy");
    assert.deepEqual({...other.human, earTip:natural.human.earTip},natural.human);
    assert.notEqual(other.appearance.skin,natural.appearance.skin);
    if (mixed.eyeColor) { assert.deepEqual(mixed,other); fantasy++; }
    else assert.deepEqual(mixed,natural);
  }
  assert.ok(fantasy >= 3 && fantasy <= 20);
});

test("draws soften a collapsed cheek while leaving ordinary cheek profiles and hand-set controls available", () => {
  const raw = randomHuman(239410, "any", { fitRestingLips: false });
  const balanced = randomHuman(239410);
  assert.ok(malarBend(evaluateHuman(raw)) > 25);
  assert.ok(malarBend(evaluateHuman(balanced)) < 15);
  assert.equal(balanced.age, raw.age);
  assert.equal(balanced.jaw, raw.jaw);
  assert.ok(balanced.cheeks < raw.cheeks);
  const ordinary = randomHuman(642200, "any", { fitRestingLips: false });
  const kept = randomHuman(642200);
  for (const axis of ["cheeks", "cheekHollow", "faceFlesh", "jowlFullness"])
    assert.equal(kept[axis], ordinary[axis]);
});
