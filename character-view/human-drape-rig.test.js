import assert from "node:assert/strict";
import test from "node:test";
import * as T from "three";
import { generatedHuman } from "./human-form.js";
import { humanRegions } from "./human-mesh.js";
import { dressHuman, dressedHuman } from "./human-wardrobe.js";
import { skinCharacter } from "./skin.js";

function character(form) {
  const material = new T.MeshStandardMaterial(), root = new T.Group();
  const build = humanRegions(form, () => material, true, (s) => dressedHuman(s, form, () => material, true)), parts = new Map();
  for (const p of form.parts) {
    const g = build(p);
    g.position.fromArray(p.position);
    g.userData.partId = p.id;
    parts.set(p.id, g);
  }
  for (const p of form.parts) (parts.get(p.parent) ?? root).add(parts.get(p.id));
  return skinCharacter(form, root);
}
function wearing(seed, outfit) {
  const form = dressHuman(generatedHuman(seed), (seed ^ 0x1e18ae83) >>> 0);
  form.humanStyle = { ...form.humanStyle, outfit };
  return character(form);
}
const hung = (rig) => rig.skeleton.bones.filter((b) => b.userData.garmentSupport && /_(Skirt|Dress|Robe)_\d_\d$/.test(b.name));
const surface = (rig) => rig.actor.children.find((o) => o.isSkinnedMesh && o.name === "Character surface");

function clothAndLegs(rig) {
  rig.actor.updateMatrixWorld(true);
  rig.skeleton.update();
  const mesh = surface(rig), ids = mesh.geometry.attributes.skinIndex.array, w = mesh.geometry.attributes.skinWeight.array, v = new T.Vector3();
  const joints = new Set(hung(rig).map((b) => rig.skeleton.bones.indexOf(b))), sides = rig.posture.sides;
  const legs = new Set(sides.flatMap((s) => [s.hipBone, s.kneeBone]).map((b) => rig.skeleton.bones.indexOf(b)));
  const hips = rig.posture.pelvisBone.getWorldPosition(new T.Vector3()), cloth = [], skin = [];
  let ground = Infinity;
  for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
    let onJoints = 0, onLegs = 0;
    for (let j = i * 4; j < i * 4 + 4; j++) { if (joints.has(ids[j])) onJoints += w[j]; if (legs.has(ids[j])) onLegs += w[j]; }
    mesh.getVertexPosition(i, v);
    if (onJoints < .5) ground = Math.min(ground, v.y);
    if (onJoints < .5 && onLegs < .9) continue;
    (onJoints >= .5 ? cloth : skin).push([Math.atan2(v.x - hips.x, v.z - hips.z), v.y, Math.hypot(v.x - hips.x, v.z - hips.z)]);
  }
  return { cloth, skin, ground };
}
function through({ cloth, skin }, slack = .012) {
  const cell = (a, y) => Math.floor((a + Math.PI) / (Math.PI * 2) * 24) % 24 + 24 * Math.floor(y / .04), far = new Map();
  for (const [a, y, r] of cloth) far.set(cell(a, y), Math.max(far.get(cell(a, y)) ?? 0, r));
  let covered = 0, out = 0;
  for (const [a, y, r] of skin) { const most = far.get(cell(a, y)); if (most === undefined) continue; covered++; if (r > most + slack) out++; }
  return { covered, share: covered ? out / covered : 0 };
}
function sampled(rig, name, phases, f) {
  const clip = rig.clips.find((c) => c.name === name), mixer = new T.AnimationMixer(rig.actor);
  mixer.clipAction(clip).play();
  const out = phases.map((p) => { mixer.setTime(clip.duration * p); return f(p); });
  mixer.stopAllAction();
  return out;
}

test("a long draped skirt hangs from joints of its own, and other figures keep their skeleton", () => {
  const plain = wearing(31, "T-shirt and jeans"), skirted = wearing(31, "Bodice and gored skirt");
  assert.equal(hung(plain).length, 0, "trousers add no joints");
  assert.equal(hung(skirted).length, 16, "two rings of eight");
  assert.equal(skirted.skeleton.bones.length, plain.skeleton.bones.length + 16);
  const posed = new Set([...skirted.bindings.values()].map((b) => b.bone));
  for (const joint of hung(skirted)) assert.ok(!posed.has(joint), "cloth joints are not posed by hand");
  for (const name of ["Idle", "Walk", "Reach", "Crouch"]) {
    const clip = skirted.clips.find((c) => c.name === name), tracks = new Set(clip.tracks.map((t) => t.name));
    for (const joint of hung(skirted)) assert.ok(tracks.has(joint.name + ".position") && tracks.has(joint.name + ".quaternion"), `${name} moves ${joint.name}`);
  }
});

test("hung cloth leaves the stance and the stride as they are for cloth that follows the legs", () => {
  const rig = wearing(31, "Evening gown");
  assert.ok(Math.abs(rig.posture.narrowest - Math.max(.045, rig.posture.half)) < 1e-9);
});

test("walking and crouching legs stay inside a hanging skirt, and its hem stays off the ground", () => {
  for (const outfit of ["Bodice and gored skirt", "Evening gown", "Day dress"]) {
    const rig = wearing(31, outfit);
    for (const [clip, phases, limit] of [["Walk", [0, .125, .25, .375, .5, .625, .75, .875], .005], ["Crouch", [.25, .5], .04]]) {
      const worst = Math.max(...sampled(rig, clip, phases, () => {
        const parts = clothAndLegs(rig), found = through(parts);
        assert.ok(found.covered > 200, `${outfit} ${clip}: the skirt covers leg`);
        const low = Math.min(...parts.cloth.map((p) => p[1]));
        assert.ok(low > parts.ground + .004, `${outfit} ${clip}: the hem is ${((low - parts.ground) * 100).toFixed(1)} cm above the soles`);
        return found.share;
      }));
      assert.ok(worst < limit, `${outfit} ${clip}: ${(worst * 100).toFixed(1)}% of covered leg skin shows through`);
    }
  }
});

test("the hem comes after the hips instead of moving with them as one piece", () => {
  const rig = wearing(31, "Evening gown"), hem = hung(rig).filter((b) => /_2_\d$/.test(b.name));
  const offsets = sampled(rig, "Walk", [0, .125, .25, .375, .5, .625, .75, .875], () => {
    rig.actor.updateMatrixWorld(true);
    const hips = rig.posture.pelvisBone.getWorldPosition(new T.Vector3()), centre = new T.Vector3();
    for (const joint of hem) centre.add(joint.getWorldPosition(new T.Vector3()));
    return centre.multiplyScalar(1 / hem.length).sub(hips);
  });
  const spread = (axis) => Math.max(...offsets.map((o) => o[axis])) - Math.min(...offsets.map((o) => o[axis]));
  assert.ok(spread("x") + spread("z") > .004, "the hem ring shifts under the hips through a stride");
});

test("the shift dress and full skirt hang clear of the legs at rest and in a walk", () => {
  for (const [outfit, kind] of [["Shift dress", "Dress"], ["Rib knit and full skirt", "Skirt"]]) {
    const rig = wearing(31, outfit);
    assert.equal(hung(rig).length, 16, `${outfit} hangs from joints`);
    assert.ok(hung(rig).every((b) => b.name.includes("_" + kind + "_")));
    const rest = through(clothAndLegs(rig));
    assert.ok(rest.covered > 200 && rest.share < .005, `${outfit} at rest: ${(rest.share * 100).toFixed(1)}% of covered leg skin shows through`);
    const worst = Math.max(...sampled(rig, "Walk", [0, .25, .5, .75], () => through(clothAndLegs(rig)).share));
    assert.ok(worst < .01, `${outfit} walking: ${(worst * 100).toFixed(1)}% of covered leg skin shows through`);
  }
});
