import assert from "node:assert/strict";
import test from "node:test";
import {evaluateHuman, expressionDisplacements, smoothHumanSurface, randomHuman, restLipProfile} from "./human-surface.js";

test("a one-sided resting smile keeps the lip seam and both full Smile shapes", () => {
  const human = {height:1.83, frame:.82, age:.65, lipFullness:.7};
  const rest = evaluateHuman(human);
  const lifted = evaluateHuman({...human, smileLeft:.85});
  const dy = i => lifted.positions[i*3+1] - rest.positions[i*3+1];
  assert.ok(dy(7185) > .004);
  for (const i of [425,474,523]) assert.equal(dy(i),0);
  assert.deepEqual(rest.joints, lifted.joints);
  for (const smooth of [false,true]) {
    const first = smooth ? smoothHumanSurface(rest) : rest;
    const second = smooth ? smoothHumanSurface(lifted) : lifted;
    const base = expressionDisplacements("Smile",smooth);
    const remaining = expressionDisplacements("Smile",smooth,lifted);
    let error = 0;
    for (let i=0;i<first.positions.length;i++) {
      const delta = second.positions[i]-first.positions[i]+(remaining[i]-base[i])*human.height/1.72;
      error = Math.max(error,Math.abs(delta));
    }
    assert.ok(error < .000002, "full Smile diverged by " + error + " m");
  }
});

test("lip balance changes the relative prominence of the lips without moving their corners", () => {
  const shape = evaluateHuman({});
  const upper = evaluateHuman({lipBalance:.9});
  const a = restLipProfile(shape), b = restLipProfile(upper);
  assert.ok(b.upper > a.upper + .5 && b.lower < a.lower - .5);
  assert.deepEqual(upper.joints,shape.joints);
  assert.deepEqual(upper.positions.slice(425*3,425*3+2),shape.positions.slice(425*3,425*3+2));
});

test("new adult draws preserve a range of mouth profiles and resting expressions", () => {
  const draws = Array.from({length:32},(_,i)=>randomHuman(8710+i));
  const forward = draws.map(p => {
    const {upper,lower} = restLipProfile(evaluateHuman(p));
    return Math.max(upper,lower);
  });
  assert.ok(Math.max(...forward) < 4 && Math.min(...forward) < -3);
  assert.ok(draws.some(p=>p.smileLeft>.5) && draws.some(p=>p.smileLeft<0));
  assert.ok(draws.some(p=>Math.abs(p.smileLeft-p.smileRight) > .2));
});

test("a broad smile opens the jaw, draws the corners out and lifts the lower lids", () => {
  const reserved = expressionDisplacements("Smile", false, {smileOpenness: -1});
  const broad = expressionDisplacements("Smile", false, {smileOpenness: 1});
  const outwardCorner = 7185 * 3;
  const lowerLip = 557 * 3 + 1;
  const cheek = 11909 * 3 + 1;
  const lowerLid = 6827 * 3 + 1;
  assert.ok(broad[outwardCorner] > reserved[outwardCorner] + .004);
  assert.ok(broad[lowerLip] < reserved[lowerLip] - .006);
  assert.ok(broad[cheek] > reserved[cheek] + .0006);
  assert.ok(broad[lowerLid] > reserved[lowerLid] + .001);
});
