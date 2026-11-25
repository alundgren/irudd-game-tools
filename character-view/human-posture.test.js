import assert from "node:assert/strict";
import test from "node:test";
import * as T from "three";
import { generatedHuman } from "./human-form.js";
import { humanRegions } from "./human-mesh.js";
import { dressHuman, dressedHuman } from "./human-wardrobe.js";
import { validateForm } from "./recipe.js";
import { skinCharacter } from "./skin.js";
import {
  drawPosture,
  massCentre,
  mirrorPosture,
  postureAxes,
  posturePreset,
  postureRanges,
  postureStyleNames,
  validPosture,
} from "./human-posture.js";

// The rendered and skinned character, as the editor preview and the export build it.
function character(form) {
  const material = new T.MeshStandardMaterial(),
    root = new T.Group();
  const build = humanRegions(form, () => material, true, (s) => dressedHuman(s, form, () => material, true)),
    parts = new Map();
  for (const p of form.parts) {
    const g = build(p);
    g.position.fromArray(p.position);
    g.userData.partId = p.id;
    parts.set(p.id, g);
  }
  for (const p of form.parts) (parts.get(p.parent) ?? root).add(parts.get(p.id));
  return skinCharacter(form, root);
}
const adult = (seed) => dressHuman(generatedHuman(seed), (seed ^ 0x1e18ae83) >>> 0);
const world = (bone) => bone.getWorldPosition(new T.Vector3());
const bone = (rig, name) => rig.skeleton.bones.find((b) => b.name.endsWith(name));
const degrees = (r) => (r * 180) / Math.PI;
function kneeFlex(side) {
  const a = world(side.hipBone).sub(world(side.kneeBone)).normalize(),
    b = world(side.footBone).sub(world(side.kneeBone)).normalize();
  return degrees(Math.PI - Math.acos(T.MathUtils.clamp(a.dot(b), -1, 1)));
}
function offVertical(side) {
  const d = world(side.elbowBone).sub(world(side.shoulderBone)).normalize();
  return degrees(Math.atan2(Math.hypot(d.x, d.z), -d.y));
}
function lowest(rig) {
  const mesh = rig.posture.mesh,
    p = mesh.geometry.attributes.position,
    v = new T.Vector3();
  let low = Infinity;
  for (let i = 0; i < p.count; i++) low = Math.min(low, mesh.getVertexPosition(i, v).y);
  return low;
}
function at(rig, clip, t) {
  const mixer = new T.AnimationMixer(rig.actor),
    action = mixer.clipAction(clip);
  action.play();
  action.time = clip.duration * t;
  mixer.update(0);
  rig.actor.updateMatrixWorld(true);
  return () => {
    action.stop();
    mixer.uncacheRoot(rig.actor);
  };
}

test("a posture is a small set of named controls inside their ranges", () => {
  assert.ok(validPosture({}));
  assert.ok(validPosture({ style: "Easy", weight: -1, arms: 1 }));
  for (const name of postureStyleNames) {
    const p = posturePreset(name);
    assert.ok(validPosture(p), name);
    assert.equal(p.style, name);
    assert.ok(p.weight >= 0, name + " is written with the weight on the left leg");
    assert.deepEqual(mirrorPosture(mirrorPosture(p)), p);
    assert.equal(mirrorPosture(p).weight, -p.weight || 0);
    assert.deepEqual(posturePreset(name, true), mirrorPosture(p));
  }
  for (const bad of [null, [], "Easy", { weight: 2 }, { arms: -0.1 }, { style: "Heroic" }, { limp: 0.2 }, { weight: NaN }, { hip: "0.5" }])
    assert.equal(validPosture(bad), false, JSON.stringify(bad));
  for (const key of postureAxes) {
    const [lo, hi, initial] = postureRanges[key];
    assert.ok(lo < hi && initial >= lo && initial <= hi, key);
  }
  assert.throws(() => posturePreset("Heroic"), /Unknown standing posture/);
});

test("each adult draws its own posture, the same every time, and people differ", () => {
  const styles = new Set(),
    sides = new Set();
  for (let seed = 60200; seed < 60260; seed++) {
    const form = generatedHuman(seed);
    assert.ok(validPosture(form.posture), "seed " + seed);
    assert.deepEqual(form.posture, drawPosture(seed, form.human));
    assert.deepEqual(generatedHuman(seed).posture, form.posture);
    assert.ok(form.posture.arms >= 0.78);
    styles.add(form.posture.style);
    sides.add(Math.sign(form.posture.weight));
    // The fitting surface no longer carries a walking stance.
    assert.equal(form.human.footLead ?? 0, 0);
    assert.equal(form.human.armLead ?? 0, 0);
  }
  assert.ok(styles.size >= 7, [...styles].join());
  assert.ok(sides.has(1) && sides.has(-1));
  assert.doesNotThrow(() => validateForm(generatedHuman(60200)));
  assert.throws(() => validateForm({ ...generatedHuman(60200), posture: { weight: 3 } }), /Invalid standing posture/);
});

test("a form without a posture rests and moves exactly as it did", () => {
  const drawn = adult(60211),
    plain = { ...drawn };
  delete plain.posture;
  const before = character(plain);
  assert.equal(before.posture, null);
  for (const b of before.skeleton.bones) if (b.name !== "Root") assert.ok(b.quaternion.angleTo(new T.Quaternion()) < 1e-9, b.name + " rests turned");
  const again = character(plain);
  assert.deepEqual(again.clips.map((c) => [c.name, c.duration, c.tracks.length]), before.clips.map((c) => [c.name, c.duration, c.tracks.length]));
  // The same body with a posture keeps every bone, every clip name and the fitted surface.
  const posed = character(drawn);
  assert.deepEqual(posed.skeleton.bones.map((b) => b.name), before.skeleton.bones.map((b) => b.name));
  assert.deepEqual(posed.clips.map((c) => c.name), before.clips.map((c) => c.name));
  const a = before.actor.children.find((o) => o.isSkinnedMesh && o.name === posed.posture.mesh.name),
    b = posed.posture.mesh;
  assert.deepEqual(b.geometry.attributes.position.array, a.geometry.attributes.position.array);
  assert.deepEqual(b.skeleton.boneInverses.map((m) => m.elements), a.skeleton.boneInverses.map((m) => m.elements));
});

test("a standing adult carries its weight on one leg, in balance, with the arms let down", () => {
  for (const [seed, style, mirrored] of [[60211, "Hip-shot", false], [60212, "Easy", true], [60214, "Upright", false]]) {
    const form = { ...adult(seed), posture: posturePreset(style, mirrored) };
    const fitted = character({ ...form, posture: { arms: 0 } }).posture,
      rig = character(form),
      R = rig.posture,
      label = seed + " " + style;
    rig.actor.updateMatrixWorld(true);
    const lead = mirrored ? -1 : 1,
      support = lead > 0 ? R.left : R.right,
      free = lead > 0 ? R.right : R.left;
    // The standing knee is all but straight and the free knee is slack.
    assert.ok(kneeFlex(support) < 12, label + " standing knee " + kneeFlex(support));
    if (style !== "Upright") assert.ok(kneeFlex(free) > kneeFlex(support) + 4, label + " free knee " + kneeFlex(free));
    // The mass sits between the feet, nearer the standing one, and over the soles.
    const centre = massCentre(R),
      feet = [support, free].map((s) => world(s.footBone)),
      toes = [support, free].map((s) => world(s.toeBone));
    const lo = Math.min(feet[0].x, feet[1].x) - 0.03,
      hi = Math.max(feet[0].x, feet[1].x) + 0.03;
    assert.ok(centre.x > lo && centre.x < hi, label + " mass centre " + centre.x + " outside " + lo + ".." + hi);
    if (style !== "Upright") assert.ok(Math.abs(centre.x - feet[0].x) < Math.abs(centre.x - feet[1].x), label + " leans on the free leg");
    assert.ok(centre.z > Math.min(feet[0].z, feet[1].z) - 0.03 && centre.z < Math.max(toes[0].z, toes[1].z) + 0.03, label + " mass centre fore and aft");
    // The pelvis drops on the free side and the shoulders answer the other way.
    const hips = world(R.left.hipBone).y - world(R.right.hipBone).y,
      shoulders = world(R.left.shoulderBone).y - world(R.right.shoulderBone).y;
    if (style === "Hip-shot") {
      assert.ok(lead * hips > 0.008, label + " hips " + hips);
      assert.ok(lead * shoulders < hips * lead, label + " shoulders " + shoulders);
    }
    // The feet are on the floor the fitting pose stood on, and nearer each other.
    const floor = R.mesh.geometry.boundingBox.min.y;
    assert.ok(Math.abs(lowest(rig) - floor) < 0.004, label + " lowest point " + lowest(rig) + " against " + floor);
    assert.ok(Math.abs(feet[0].x - feet[1].x) < 2 * R.half + 1e-6, label + " feet");
    // Arms never stand further from the body than they were fitted, and usually hang nearer.
    R.sides.forEach((s, i) => assert.ok(offVertical(s) <= degrees(fitted.sides[i].fitted) + 1.5, label + " arm " + offVertical(s)));
    for (const b of rig.skeleton.bones) assert.ok(Math.abs(b.quaternion.length() - 1) < 1e-6 && b.position.toArray().every(Number.isFinite), b.name);
  }
});

test("the walk of a posed adult strikes with the heel, straightens the standing leg and swings the arms against the legs", () => {
  const form = { ...adult(60212), posture: posturePreset("Easy") },
    rig = character(form),
    R = rig.posture,
    walk = rig.clips.find((c) => c.name === "Walk"),
    floor = R.mesh.geometry.boundingBox.min.y;
  assert.ok(walk.duration > 0.7 && walk.duration < 2.1);
  const seen = [];
  for (let k = 0; k < 16; k++) {
    const done = at(rig, walk, k / 16);
    seen.push({
      knees: R.sides.map(kneeFlex),
      ankles: R.sides.map((s) => world(s.footBone)),
      toes: R.sides.map((s) => world(s.toeBone)),
      wrists: R.sides.map((s) => world(s.wristBone)),
      pelvis: world(R.pelvisBone),
      low: lowest(rig),
    });
    done();
  }
  // Left heel lands at the start of the loop: the leg is nearly straight and the toes are up.
  const strike = seen[0];
  assert.ok(strike.knees[0] < 12, "knee at heel strike " + strike.knees[0]);
  assert.ok(strike.toes[0].y - strike.ankles[0].y > R.left.ball.y - R.left.ankle.y + 0.015, "toes up at heel strike");
  assert.ok(strike.ankles[0].z > strike.pelvis.z + 0.12 && strike.ankles[1].z < strike.pelvis.z, "a real step");
  // The foot behind has its heel up, pushing off the ball.
  assert.ok(strike.ankles[1].y > R.right.ankle.y + 0.02, "heel off behind");
  // The swinging knee folds to clear the ground, and no knee ever bends backward or locks hard.
  assert.ok(Math.max(...seen.map((f) => f.knees[1])) > 35);
  for (const f of seen) for (const k of f.knees) assert.ok(k > 1 && k < 75, "knee " + k);
  // The arm opposite the forward leg is forward, and each hand passes both ahead of and behind the hips.
  assert.ok(strike.wrists[1].z > strike.wrists[0].z + 0.1, "right hand leads the left foot");
  for (const side of [0, 1]) {
    const reach = seen.map((f) => f.wrists[side].z - f.pelvis.z);
    assert.ok(Math.max(...reach) > 0.08 && Math.min(...reach) < -0.02, "hand travel " + Math.min(...reach) + ".." + Math.max(...reach));
  }
  // The second half of the loop mirrors the first, and the lowest point stays on the floor.
  for (let k = 0; k < 8; k++) {
    assert.ok(Math.abs(seen[k].knees[0] - seen[k + 8].knees[1]) < 0.5);
    assert.ok(Math.abs(seen[k].pelvis.y - seen[k + 8].pelvis.y) < 0.002);
  }
  for (const f of seen) assert.ok(Math.abs(f.low - floor) < 0.004, "lowest point in the walk " + f.low);
  const bob = seen.map((f) => f.pelvis.y);
  assert.ok(Math.max(...bob) - Math.min(...bob) > 0.01 && Math.max(...bob) - Math.min(...bob) < 0.08);
  // The loop closes.
  const first = at(rig, walk, 0),
    start = rig.skeleton.bones.map((b) => b.quaternion.clone());
  first();
  const last = at(rig, walk, 0.99999);
  rig.skeleton.bones.forEach((b, i) => assert.ok(b.quaternion.angleTo(start[i]) < 0.03, b.name));
  last();
});

test("what is bound to the skull and the arms follows the posture", () => {
  const seed = [60210, 60213, 60216, 60219, 60222, 60225].find((s) => {
    const style = adult(s).humanStyle;
    return style.hair && style.hair !== "None";
  });
  const form = { ...adult(seed), posture: { ...posturePreset("Slouched"), headTurn: 0.8, headTilt: 0.6 } },
    plain = { ...form };
  delete plain.posture;
  const before = character(plain),
    rig = character(form);
  rig.actor.updateMatrixWorld(true);
  before.actor.updateMatrixWorld(true);
  const head = bone(rig, "_head") ?? rig.posture.headBone;
  assert.equal(head, rig.posture.headBone);
  // Every vertex the head carries alone keeps its place on the skull: hair, eyes and all.
  const carried = head.matrixWorld.clone().multiply(rig.posture.mesh.skeleton.boneInverses[rig.skeleton.bones.indexOf(head)]);
  let checked = 0;
  for (const mesh of rig.actor.children.filter((o) => o.isSkinnedMesh)) {
    const fitted = before.actor.children.find((o) => o.name === mesh.name),
      p = mesh.geometry.attributes.position,
      ids = mesh.geometry.attributes.skinIndex,
      w = mesh.geometry.attributes.skinWeight,
      index = mesh.skeleton.bones.indexOf(head),
      v = new T.Vector3(),
      u = new T.Vector3();
    assert.ok(fitted, mesh.name);
    for (let i = 0; i < p.count; i += 11) {
      if (!(ids.getX(i) === index && w.getX(i) > 0.999)) continue;
      mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
      u.fromBufferAttribute(fitted.geometry.attributes.position, i).applyMatrix4(carried);
      assert.ok(v.distanceTo(u) < 1e-4, mesh.name + " vertex " + i + " off the skull by " + v.distanceTo(u));
      checked++;
    }
  }
  assert.ok(checked > 200, "head vertices checked: " + checked);
  assert.ok(head.getWorldQuaternion(new T.Quaternion()).angleTo(new T.Quaternion()) > 0.1);
});

test("saved joint poses and old clip names survive a posture", () => {
  const plain = adult(60215);
  delete plain.posture;
  const bind = character(plain);
  const binding = [...bind.bindings.values()].find((b) => /right_upper_arm/.test(b.bone.name));
  assert.ok(binding, "the right upper arm is a pose joint");
  const turn = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), -1.1).toArray();
  const saved = validateForm({ ...plain, poses: [{ name: "Wave", joints: [{ ...binding.address, turn }] }] });
  const fromBind = character(saved),
    fromPosture = character({ ...saved, posture: posturePreset("Hip-shot") });
  const names = fromBind.clips.map((c) => c.name);
  assert.deepEqual(fromPosture.clips.map((c) => c.name), names);
  for (const name of ["Idle", "Walk", "Reach", "Crouch"]) assert.ok(names.includes(name));
  const clipName = names.find((n) => n.includes("Wave"));
  assert.ok(clipName);
  // The saved pose plays from the fitting pose on both, joint for joint.
  const read = (rig) => {
    const done = at(rig, rig.clips.find((c) => c.name === clipName), 0);
    const turns = rig.skeleton.bones.filter((b) => b.name !== "Root").map((b) => b.quaternion.clone());
    done();
    return turns;
  };
  const a = read(fromBind),
    b = read(fromPosture);
  a.forEach((q, i) => assert.ok(q.angleTo(b[i]) < 1e-3, fromBind.skeleton.bones[i + 1]?.name + " differs by " + q.angleTo(b[i])));
});

test("a posture is solved the same every time", () => {
  const form = adult(60218),
    copy = { ...form, posture: { ...form.posture } };
  const a = character(form),
    b = character(copy);
  for (let i = 0; i < a.skeleton.bones.length; i++) {
    assert.ok(a.skeleton.bones[i].position.distanceTo(b.skeleton.bones[i].position) < 1e-9);
    assert.ok(a.skeleton.bones[i].quaternion.angleTo(b.skeleton.bones[i].quaternion) < 1e-6);
  }
});

test("a hand can rest on the fitted hip and let go in Reach and Walk", () => {
  const form = adult(14111);
  const posture = { ...form.posture, handAtWaist: 0 };
  const relaxed = character({ ...form, posture });
  const posed = character({ ...form, posture: { ...posture, handAtWaist: 1 } });
  const left = posed.posture.left, right = posed.posture.right;
  const heightFromHip = (side) => world(side.wristBone).y - world(side.hipBone).y;
  assert.ok(heightFromHip(left) > heightFromHip(relaxed.posture.left) + 0.10);
  assert.ok(Math.abs(heightFromHip(right) - heightFromHip(relaxed.posture.right)) < 0.02);
  assert.equal(mirrorPosture({ handAtWaist: 1 }).handAtWaist, -1);
  const palm = [...posed.posture.regions.values()].find(r => r.part.humanBone === "middle_01_l").bones[0];
  const target = posed.posture.arms[0].waist.clone().sub(posed.posture.pelvis)
    .applyQuaternion(posed.posture.pelvisBone.getWorldQuaternion(new T.Quaternion()))
    .add(world(posed.posture.pelvisBone));
  assert.ok(world(palm).distanceTo(target) < 0.003, "palm meets the dressed waist");
  for (const name of ["Walk", "Reach"]) {
    const stop = at(posed, posed.clips.find(c => c.name === name), 0.5);
    assert.ok(world(palm).distanceTo(target) > 0.05, name + " releases the hand");
    stop();
  }
});


test("the folding fan keeps a right-hand pinch through generated clips and clears it in Anatomy", () => {
  const base = adult(441);
  const form = { ...base, outfit: "Work clothes", humanStyle: { ...base.humanStyle, outfit: "Evening gown", handProp: "Painted folding fan" } };
  validateForm(form);
  const rig = character(form);
  try {
    const grip = rig.posture.right.fanGrip;
    assert.equal(grip.length, 4);
    assert.equal(rig.posture.left.fanGrip, null);
    for (const clip of rig.clips) {
      const stop = at(rig, clip, 0.5);
      try {
        for (const [joint, target] of grip) assert.ok(joint.quaternion.angleTo(target) < 0.001, clip.name + " " + joint.name);
      } finally {
        stop();
      }
    }
  } finally {
    rig.dispose();
  }
  const bare = character({ ...form, outfit: "Anatomy" });
  try {
    assert.equal(bare.posture.right.fanGrip, null);
  } finally {
    bare.dispose();
  }
});
