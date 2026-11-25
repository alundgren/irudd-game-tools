import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { evaluateHuman, expressionDisplacements, smoothHumanSurface } from "./human-surface.js";
import { generatedHuman, changeHuman } from "./human-form.js";
import { humanRegions } from "./human-mesh.js";
import { libraryPieces } from "./human-library.js";
import {dressedHuman} from "./human-wardrobe.js";
import { validateForm, makeBrief, readProposal } from "./recipe.js";
import { checkPreserved } from "./variations.js";
import { skinCharacter } from "./skin.js";
import { extractComponent, placeComponent } from "./graft.js";

test("adult shapes replay in metres, with independently movable chest volume and grounded soles", () => {
  const base = evaluateHuman({ height: 1.64 });
  const chest = evaluateHuman({ height: 1.64, bust: 0.85 });
  let delta = 0,
    max = 0,
    min = 20;
  for (let i = 0; i < base.bodyVertices; i++) {
    const j = i * 3,
      y = base.positions[j + 1];
    max = Math.max(max, y);
    min = Math.min(min, y);
    if (y > 1 && y < 1.45)
      delta = Math.max(
        delta,
        Math.abs(base.positions[j + 2] - chest.positions[j + 2]),
      );
    assert.ok(Number.isFinite(chest.positions[j]));
  }
  assert.ok(delta > 0.009);
  assert.ok(Math.abs(max - 1.64) < 1e-5 && Math.abs(min) < 1e-6);
  assert.deepEqual(generatedHuman(12, "female"), generatedHuman(12, "female"));
  assert.ok(generatedHuman(12, "female").human.frame < 0);
  assert.equal(generatedHuman(12, "neutral").human.frame, 0);
  assert.throws(() => evaluateHuman({ height: Infinity }));
});
test("changing only bust fits the same jacket and preserves its waist and the soles", () => {
  const material = new T.MeshStandardMaterial();
  function sections(bust) {
    const body = evaluateHuman({
      height: 1.7,
      frame: -0.75,
      stance: 0.75,
      bust,
    });
    const pieces = libraryPieces(
      body,
      { outfit: "Field jacket and denim" },
      () => material,
      true,
    );
    function front(attributes, height) {
      let z = -Infinity;
      for (const a of attributes)
        for (let i = 0; i < a.count; i++)
          if (
            Math.abs(a.getY(i) - height) < 0.035 &&
            Math.abs(a.getX(i)) < 0.19
          )
            z = Math.max(z, a.getZ(i));
      assert.ok(Number.isFinite(z));
      return z;
    }
    const jacket = pieces.map((p) => p.geometry.attributes.position);
    const skin = [
      new T.BufferAttribute(
        body.positions.subarray(0, body.bodyVertices * 3),
        3,
      ),
    ];
    const values = [
      front(skin, 1.23),
      front(jacket, 1.23),
      front(jacket, 0.94),
      front(jacket, 0.2),
    ];
    for (const p of pieces) {
      p.geometry.dispose();
      p.material.dispose();
    }
    return values;
  }
  const smaller = sections(-0.8),
    fuller = sections(0.8);
  for (let i = 0; i < 2; i++)
    assert.ok(fuller[i] - smaller[i] > 0.02 && fuller[i] - smaller[i] < 0.065);
  for (let i = 2; i < 4; i++)
    assert.ok(Math.abs(fuller[i] - smaller[i]) < 0.0005);
  material.dispose();
});

test("body edits preserve an added attachment and survive the normal agent proposal reader", () => {
  const form = generatedHuman(41, "male");
  form.parts.push({
    id: "sample badge",
    parent: "chest",
    position: [0.02, 0.12, 0.11],
    size: [0.03, 0.04, 0.006],
    rotation: [0, 0, 0],
    shape: "box",
    color: "#996644",
  });
  const brief = makeBrief(
    form,
    "r",
    null,
    {},
    "Narrower nose and a fuller bust",
  );
  const result = readProposal(
    {
      format: "irudd.form-proposal.v1",
      requestId: brief.requestId,
      revision: "r",
      summary: "Adjusted proportions",
      operations: [{ op: "shapeHuman", parameters: { bust: 0.6, nose: -0.6 } }],
    },
    brief,
    "r",
  );
  assert.deepEqual(result.form.parts.at(-1), form.parts.at(-1));
  assert.equal(validateForm(result.form).human.nose, -0.6);
  assert.throws(
    () => checkPreserved(form, changeHuman(form, { bust: 0.76 }), ["chest"]),
    /protected geometry/,
  );
});
test("assistant-directed rerolls use the request seed and apply nudges to the saved identity", () => {
  const start = generatedHuman(8710);
  start.humanStyle = { outfit: "Traveller", hair: "Bob" };
  function vary(seed, operations) {
    const request = makeBrief(start, "r", null, {}, "Steer this face", { seed });
    return readProposal({
      format: "irudd.form-proposal.v1", requestId: request.requestId,
      revision: "r", summary: "Steered the existing face", operations,
    }, request, "r").form;
  }
  const roll = { op: "rerollHuman", axes: ["nose", "noseBridge"], amount: 0.5 };
  const nudge = { op: "nudgeHuman", deltas: { shoulders: 0.08 } };
  const after = vary(154, [roll, nudge]);
  assert.deepEqual(vary(154, [nudge, roll]).human, after.human);
  assert.notEqual(vary(155, [roll]).human.nose, after.human.nose);
  assert.equal(after.human.shoulders, Math.min(1, start.human.shoulders + 0.08));
  assert.deepEqual(after.humanStyle, start.humanStyle);
  assert.deepEqual(Object.keys(start.human).filter(k => after.human[k] !== start.human[k]).sort(),
    ["nose", "noseBridge", "shoulders"]);
  assert.throws(() => vary(154, [{ ...roll, axes: ["missing"] }]), /measurements/);
  const created = vary(896, [{ op: "buildHuman", archetype: "neutral", parameters: { height: 1.63 } }]);
  assert.equal(created.human.frame, 0);
  assert.equal(created.human.height, 1.63);
  assert.equal(created.human.nose, generatedHuman(896, "neutral").human.nose);
});

test("a copied head keeps its donor identity when the recipient changes", () => {
  const donor = generatedHuman(16, "female"),
    recipient = generatedHuman(17, "neutral");
  const component = extractComponent(donor, "head");
  const { id, form } = placeComponent(recipient, component, {
    target: "head",
    mode: "replace",
    fit: false,
  });
  const head = form.parts.find((p) => p.id === id),
    key = head.humanSource;
  assert.deepEqual(validateForm(form).humanSources[key].human, donor.human);
  const changed = changeHuman(form, { jaw: -0.9, bust: 0.8 });
  assert.deepEqual(
    changed.parts.find((p) => p.id === id),
    head,
  );
  assert.doesNotThrow(() => checkPreserved(form, changed, [id]));
  const tampered = structuredClone(changed);
  tampered.humanSources[key].human.noseBridge = 0.94;
  assert.throws(
    () => checkPreserved(form, tampered, [id]),
    /protected geometry/,
  );
});
test("body rendering combines welded subdivision, authored skin weights and animating finger joints", () => {
  const form = generatedHuman(19, "neutral"),
    mat = new T.MeshStandardMaterial(),
    root = new T.Group();
  form.outfit="Work clothes";
  form.humanStyle={hair:"Bun",outfit:"T-shirt and jeans"};
  const build = humanRegions(form, () => mat, true, s=>dressedHuman(s,form,()=>mat,true)),
    parts = new Map();
  for (const p of form.parts) {
    const g = build(p);
    g.position.fromArray(p.position);
    g.userData.partId = p.id;
    parts.set(p.id, g);
  }
  for (const p of form.parts)
    (parts.get(p.parent) ?? root).add(parts.get(p.id));
  const rig = skinCharacter(form, root),
    bound = rig.actor.children.find((o) => o.name === "Character surface");
  assert.ok(
    rig.actor.children.some(
      (o) => o.morphTargetDictionary?.Smile !== undefined,
    ),
  );
  assert.ok(
    rig.actor.children.some(
      (o) => o.morphTargetDictionary?.LookUp !== undefined,
    ),
  );
  const names = rig.clips.map((c) => c.name);
  for (const c of ["Walk", "Reach", "Crouch"]) assert.ok(names.includes(c));
  assert.ok(
    rig.skeleton.bones.some((b) => b.userData.region === "left thumb 3"),
  );
  const w = bound.geometry.attributes.skinWeight;
  for (let i = 0; i < w.count; i += 13)
    assert.ok(
      Math.abs(w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i) - 1) < 2e-4,
    );
  const smoothed = smoothHumanSurface(evaluateHuman(form.human));
  assert.ok(smoothed.indices.length > 300000);
  assert.ok(smoothed.positions.every(Number.isFinite));
  const mixer = new T.AnimationMixer(rig.actor);
  mixer.clipAction(rig.clips.find((c) => c.name === "Reach")).play();
  mixer.setTime(0.6);
  rig.actor.updateMatrixWorld(true);
  rig.skeleton.update();
  let movement = 0;
  const pt = new T.Vector3(),
    rest = new T.Vector3(),
    pos = bound.geometry.attributes.position;
  for (let i = 0; i < pos.count; i += 19) {
    rest.fromBufferAttribute(pos, i);
    pt.copy(rest);
    bound.applyBoneTransform(i, pt);
    movement = Math.max(movement, pt.distanceTo(rest));
  }
  assert.ok(movement > 0.07);
  assert.ok(movement < 1.6);
  rig.dispose();
});

test("leading foot changes the stride while both soles stay planted", () => {
  const base = evaluateHuman({});
  const left = evaluateHuman({footLead: 1});
  const right = evaluateHuman({footLead: -1});
  for (const p of [left,right]) {
    for (let i=1; i<base.positions.length; i+=3) assert.equal(p.positions[i],base.positions[i]);
  }
  for (const [name,direction] of [["foot_l",1],["foot_r",-1]]) {
    const i=3*base.names.indexOf(name)+2;
    assert.ok(direction*(left.joints[i]-base.joints[i])>.07);
    assert.ok(direction*(right.joints[i]-base.joints[i])<-.07);
  }
});

test("smile opening and bias change the animation independently of the resting skin", () => {
  const base = evaluateHuman({});
  for (const axis of ["smileOpenness", "smileBias"]) {
    const low = evaluateHuman({[axis]: -1}), high = evaluateHuman({[axis]: 1});
    assert.deepEqual(low.positions, base.positions);
    assert.deepEqual(high.positions, base.positions);
    for (const smooth of [false, true]) {
      const a = expressionDisplacements("Smile", smooth, low);
      const b = expressionDisplacements("Smile", smooth, high);
      let largest = 0;
      for (let i = 0; i < a.length; i++) largest = Math.max(largest, Math.abs(a[i]-b[i]));
      assert.ok(largest > .004, axis + " moves the animated face at least four millimetres");
      assert.equal(expressionDisplacements("Blink", smooth, low), expressionDisplacements("Blink", smooth, high));
    }
  }
});

test("left and right arm gestures raise the requested hand while keeping the other hand and both soles in place", () => {
  const base = evaluateHuman({ stance: .9 });
  const joint = (surface, name) => {
    const first = 3*surface.names.indexOf(name);
    assert.ok(first >= 0);
    return surface.joints.slice(first, first+3);
  };
  for (const [side, axis, other] of [["l", "leftArmLift", "r"], ["r", "rightArmLift", "l"]]) {
    const posed = evaluateHuman({ stance: .9, [axis]: .8 });
    const before = joint(base, "hand_"+side), after = joint(posed, "hand_"+side);
    assert.ok(after[1]-before[1] > .20 && after[2]-before[2] > .08);
    for (const fixed of ["upperarm_"+side, "hand_"+other, "foot_r", "foot_l"])
      assert.deepEqual(joint(posed,fixed),joint(base,fixed));
  }
});
