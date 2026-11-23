import assert from "node:assert/strict";
import test from "node:test";
import {
  BoxGeometry,
  MeshStandardMaterial,
  Mesh,
  Group,
  AnimationMixer,
  Vector3,
} from "three";
import { generateForm } from "./generator.js";
import { validateForm, startingForm } from "./recipe.js";
import {
  applyOperations,
  drawVariation,
  checkPreserved,
} from "./variations.js";
import { bindParts } from "./rig.js";
import { extractComponent, placeComponent } from "./graft.js";
import { skinCharacter } from "./skin.js";
import { studies } from "../examples/studies.js";

const box = (id, position, size, parent) => ({
  id,
  shape: "box",
  position,
  size,
  color: "#998877",
  rotation: [0, 0, 0],
  ...(parent ? { parent } : {}),
});
test("generated recipes replay across 192 seeds and produce distinct limb plans", () => {
  const counts = new Set();
  for (let seed = 0; seed < 192; seed++) {
    for (const kind of ["human", "creature"]) {
      const form = generateForm(kind, seed);
      assert.deepEqual(validateForm(form), generateForm(kind, seed));
      if (kind === "creature")
        counts.add(form.parts.filter((p) => p.outfitRole === "thigh").length);
    }
  }
  assert.ok(counts.size >= 3);
  assert.deepEqual(
    drawVariation("radical", 193),
    drawVariation("radical", 193),
  );
  assert.ok(
    new Set(
      Array.from({ length: 32 }, (_, i) =>
        drawVariation("radical", i).cues.join("/"),
      ),
    ).size > 10,
  );
});
test("metric attachments and subsequent grafts preserve a child's world pivot", () => {
  const form = startingForm(() => 0.5);
  form.parts = [
    box("trunk", [0, 0.88, 0.02], [0.3, 0.7, 0.25]),
    box("hand", [0.52, 0.8, 0.12], [0.06, 0.1, 0.03]),
    box("ring", [0.56, 0.82, 0.12], [0.02, 0.015, 0.04]),
  ];
  const bound = bindParts(
    form,
    { hand: "trunk", ring: "hand" },
    { metric: true },
  );
  validateForm(bound);
  const before = extractComponent(bound, "ring", false),
    ringPos = bound.parts[2].position;
  assert.ok(Math.abs(ringPos[0] - 0.04) < 1e-12);
  const replacement = placeComponent(
    bound,
    extractComponent(bound, "trunk", false),
    { target: "hand" },
  ).form;
  const after = extractComponent(replacement, "ring", false);
  assert.deepEqual(
    before.bounds.map((a) => a.map((v) => v.toFixed(5))),
    after.bounds.map((a) => a.map((v) => v.toFixed(5))),
  );
  const receivingHand = replacement.parts.find((p) => p.id === "hand");
  const relative = replacement.parts.find((p) => p.id === "ring").position;
  const global = bound.parts[0].position.map(
    (v, i) =>
      v +
      receivingHand.position[i] +
      (relative[i] * receivingHand.size[i]) / receivingHand.frameSize[i],
  );
  for (let i = 0; i < 3; i++)
    assert.ok(Math.abs(global[i] - form.parts[2].position[i]) < 1e-9);
});
test("operation transactions assign metric frames and reject edits to protected shape", () => {
  const form = startingForm(() => 0.5);
  const crest = box("crest", [0, 0.1, 0], [0.05, 0.08, 0.04], form.parts[0].id);
  const next = applyOperations(
    form,
    [{ op: "addPart", part: crest }],
    {},
    true,
  );
  assert.deepEqual(next.parts.at(-1).frameSize, crest.size);
  assert.equal(
    form.parts.some((p) => p.id === "crest"),
    false,
  );
  assert.throws(
    () =>
      applyOperations(next, [
        { op: "setPart", id: "crest", set: { unexpected: 5 } },
      ]),
    /Unsupported/,
  );
  const moved = applyOperations(next, [
    { op: "setPart", id: "crest", set: { position: [0.2, 0.1, 0] } },
  ]);
  checkPreserved(next, moved, ["crest"]);
  assert.throws(
    () =>
      checkPreserved(
        next,
        applyOperations(next, [
          { op: "setPart", id: "crest", set: { size: [1, 1, 1] } },
        ]),
        ["crest"],
      ),
    /protected/,
  );
});
test("authored creature fingers, eyes, plates and feet follow a single attached hierarchy", () => {
  for (const id of ["carapace", "merchant"]) {
    const form = studies.find((s) => s.id === id).make();
    validateForm(form);
    assert.equal(form.parts.filter((p) => !p.parent).length, 1);
    assert.ok(form.parts.filter((p) => p.outfitRole === "thigh").length === 2);
  }
});
test("rigged hems gather through a crouch and sampled soles remain grounded", () => {
  const form = startingForm(() => 0.5);
  form.parts = [
    { ...box("torso", [0, 1.12, 0], [0.4, 0.58, 0.27]), motionRole: "torso" },
    {
      ...box("leg", [0.11, 0.44, 0], [0.14, 0.88, 0.12], "torso"),
      motionRole: "thigh",
    },
    {
      ...box("gown", [0, 0.53, 0.02], [0.5, 1.04, 0.4], "torso"),
      motionRole: "skirt",
    },
  ];
  const group = new Group(),
    mat = new MeshStandardMaterial();
  for (const p of form.parts) {
    const m = new Mesh(new BoxGeometry(...p.size, 2, 10, 2), mat);
    m.position.fromArray(p.position);
    m.userData.partId = p.id;
    group.add(m);
  }
  const rig = skinCharacter(form, group),
    mesh = rig.actor.children.find((m) => m.isSkinnedMesh);
  const mixer = new AnimationMixer(rig.actor),
    clip = rig.clips.find((c) => c.name === "Crouch");
  mixer.clipAction(clip).play();
  const vec = new Vector3();
  let highest = -Infinity,
    lowest = Infinity;
  for (const t of [0, 0.125, 0.25, 0.5, 0.75]) {
    mixer.setTime(t * clip.duration);
    rig.actor.updateMatrixWorld(true);
    mesh.skeleton.update();
    let floor = Infinity;
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++)
      floor = Math.min(floor, mesh.getVertexPosition(i, vec).y);
    highest = Math.max(highest, floor);
    lowest = Math.min(lowest, floor);
  }
  assert.ok(highest - lowest < 0.002);
  assert.ok(
    clip.tracks.some(
      (t) => t.name.includes("gown") && t.name.endsWith(".position"),
    ),
  );
  rig.dispose();
});
