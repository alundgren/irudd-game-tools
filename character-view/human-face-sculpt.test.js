import test from "node:test";
import assert from "node:assert/strict";
import {evaluateHuman, smoothHumanSurface, humanFitAxes, validHuman} from "./human-surface.js";
import {generatedHuman} from "./human-form.js";
import {foldedTriangles} from "./family-transfer.js";
import data from "./human-face-sculpt-data.json" with {type:"json"};

test("each facial sculpt edits local skin and preserves the rig and unedited face exactly", () => {
  const base=evaluateHuman({height:1.72});
  for (const [axis, offsets] of Object.entries(data.controls)) {
    assert.ok(!humanFitAxes.includes(axis));
    const enabled=evaluateHuman({height:1.72,[axis]:1});
    const affected=new Set();
    for (let i=0; i<offsets.length; i+=4) affected.add(offsets[i]);
    assert.deepEqual(enabled.joints,base.joints);
    let largest=0;
    for (let i=0; i<base.bodyVertices; i++) {
      const d=i*3;
      const difference=Math.hypot(...[0,1,2].map(k=>enabled.positions[d+k]-base.positions[d+k]));
      if (!affected.has(i)) assert.equal(difference,0,axis+" moved an unregistered vertex");
      largest=Math.max(largest,difference);
    }
    assert.ok(largest>.0008 && largest<.012,axis+" maximum "+largest);
    assert.ok(!validHuman({[axis]:1.01}) && !validHuman({[axis]:-.01}));
  }
});

test("new editable adults draw valid local relief while old forms open at zero", () => {
  for (const seed of [3701,3702,3703,3704]) {
    const h=generatedHuman(seed).human;
    for(const name of Object.keys(data.controls)) assert.ok(h[name]>=0 && h[name]<=1);
    assert.ok(validHuman(h));
  }
  const zeros=Object.fromEntries(Object.keys(data.controls).map(name=>[name,0]));
  assert.deepEqual(evaluateHuman(zeros).positions,evaluateHuman({}).positions);
});

test("cartilage and expression creases keep the lips and ears facing outward", () => {
  const axes = Object.keys(data.controls);
  const limits = value => Object.fromEntries(axes.map(name => [name, value]));
  for (const human of [limits(1), ...[29104,29118,29121].map(seed => generatedHuman(seed).human)]) {
    const bare = evaluateHuman({...human, ...limits(0)});
    const made = evaluateHuman(human);
    for (const [before, after] of [[bare, made], [smoothHumanSurface(bare), smoothHumanSurface(made)]]) {
      const result = foldedTriangles(before.positions, after.positions, before.indices, before.bodyTriangles);
      assert.deepEqual(result.folded, []);
    }
  }
});
