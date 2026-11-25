import test from "node:test";
import assert from "node:assert/strict";
import { capturedAxes, capturedSkinNames, capturedSkin, capturedIris, creditedCaptures } from "./human-captured-portraits.js";
import { evaluateHuman, humanFitAxes, humanRange, validHuman } from "./human-surface.js";
import { generatedHuman } from "./human-form.js";

test("captured foundations are optional, editable face measurements", () => {
  const neutral = {frame:-.4, height:1.7}, base = evaluateHuman(neutral);
  const zeros = Object.fromEntries(capturedAxes.map(key => [key, 0]));
  assert.deepEqual(evaluateHuman({...neutral,...zeros}).positions,base.positions);
  for (const axis of capturedAxes) {
    assert.deepEqual(humanRange(axis), [0,1,0]);
    assert.ok(!humanFitAxes.includes(axis));
    assert.ok(validHuman({[axis]:1}) && !validHuman({[axis]:1.01}));
    const face = evaluateHuman({...neutral, [axis]:1});
    assert.deepEqual(face.joints,base.joints);
    let largest=0, belowNeck=0;
    for(let i=0;i<base.bodyVertices;i++){
      const at=3*i, before=base.positions, after=face.positions;
      const change=Math.hypot(after[at]-before[at],after[at+1]-before[at+1],after[at+2]-before[at+2]);
      largest=Math.max(largest,change);
      if(before[at+1]<base.height-.33) belowNeck=Math.max(belowNeck,change);
    }
    assert.ok(largest>.001 && largest<.025,axis+" "+largest);
    assert.ok(belowNeck<.00002,axis+" body drift "+belowNeck);
    for(const group of base.eyeGroups) for(const v of group) for(let d=0;d<3;d++){
      const disp = i => face.positions[3*i+d]-base.positions[3*i+d];
      assert.ok(Math.abs(disp(v)-disp(group[0]))<.000015,axis+" eyeball lost rigidity");
    }
  }
});

test("the shape and skin carry the scan source independently", () => {
  assert.deepEqual(creditedCaptures({human:{}}),[]);
  for(const [index,key] of capturedAxes.entries()){
    const name=capturedSkinNames[index],src=capturedSkin(name).source;
    assert.deepEqual(creditedCaptures({human:{[key]:.2}}),[src]);
    assert.deepEqual(creditedCaptures({complexion:name}),[src]);
    assert.deepEqual(creditedCaptures({human:{[key]:1},complexion:name}),[src]);
    const iris=capturedIris(name);
    assert.equal(iris.size**2,iris.values.length);
  }
});

test("ordinary draws pair captured skin with one editable foundation", () => {
  const used=new Set();
  for(let seed=7940100;seed<7940132;seed++){
    const form=generatedHuman(seed);
    const worn=capturedAxes.filter(key=>form.human[key]>0);
    if(!worn.length) {assert.ok(!capturedSkin(form.complexion));continue;}
    assert.equal(worn.length,1);
    assert.equal(capturedSkin(form.complexion).source,creditedCaptures({human:form.human})[0]);
    assert.equal(form.humanStyle.browStyle,"As drawn");
    used.add(worn[0]);
  }
  assert.ok(used.size>=3);
});