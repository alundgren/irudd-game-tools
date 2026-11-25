import assert from "node:assert/strict";
import test from "node:test";
import {
  BoxGeometry,
  MeshStandardMaterial,
  Mesh,
  Group,
  AnimationMixer,
  Vector3,
  Euler,
  MathUtils,
} from "three";
import { generateForm } from "./generator.js";
import { validateForm, startingForm } from "./recipe.js";
import {
  applyOperations,
  drawVariation,
  checkPreserved,
} from "./variations.js";
import { bindParts } from "./rig.js";
import {
  fitHand,
  cutGarment,
  extractComponent,
  placeComponent,
} from "./graft.js";
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
test("a transferred skirt keeps the cut and adjusts the measurements to its new wearer", () => {
  function wearer(width, depth, height) {
    const form = startingForm(() => 0.5);
    form.parts = [box("body", [0, height / 2, 0], [width, height, depth])];
    return form;
  }
  const donor = cutGarment(wearer(0.4, 0.22, 1.8), "body", "Skirt").form;
  donor.layerStyles = { skirt: { dye: "#5c303c" } };
  const original = donor.parts.at(-1);
  original.cut.width *= 1.15;
  original.cut.drop *= 0.8;
  original.cut.tiers = 5;
  const next = wearer(0.6, 0.33, 1.35);
  const source = extractComponent(donor, "skirt");
  const result = placeComponent(next, source, {
    target: "body",
    mode: "pattern",
  }).form;
  validateForm(result);
  const recut = result.parts.at(-1);
  assert.deepEqual(result.parts[0], next.parts[0]);
  assert.deepEqual(recut.cut.outline, original.cut.outline);
  assert.equal(recut.cut.tiers, 5);
  assert.equal(result.layerStyles.skirt.dye, "#5c303c");
  for (const [axis, ratio] of [
    ["width", 1.5],
    ["depth", 1.5],
    ["drop", 0.75],
  ])
    assert.ok(Math.abs(recut.cut[axis] / original.cut[axis] - ratio) < 1e-9);
  recut.cut.outline[0][1] = 7;
  assert.equal(original.cut.outline[0][1], 1);
});
test("reusing a turnaround changes only selected bindings and carries their occlusion masks", () => {
  const paint = (region, atlas) => ({ region, atlas });
  const form = {
    parts: [
      { id: "vest", paint: paint("chest", "teal") },
      { id: "sleeve", paint: paint("arm", "brown"), position: [0.2, 1, 0] },
      { id: "hand", paint: paint("hand", "brown") },
    ],
  };
  const change = { op: "reuseTurnaround", id: "vest", regions: ["sleeve"] };
  const result = applyOperations(form, [change]);
  assert.deepEqual(result.parts[1], {
    ...form.parts[1],
    paint: paint("arm", "teal"),
  });
  assert.deepEqual(result.parts[2], form.parts[2]);
  assert.ok(
    result.occluders.some((p) => p.region === "hand" && p.atlas === "teal"),
  );
  assert.deepEqual(form.parts[1].paint, paint("arm", "brown"));
  assert.throws(
    () => applyOperations(form, [{ ...change, regions: ["vest", "sleeve"] }]),
    /same source/,
  );
  assert.throws(
    () => applyOperations(form, [{ ...change, id: "missing" }]),
    /turnaround/,
  );
});
test("an armour proposal creates independent fitted plates for the current outfit and replays exactly", () => {
  const form = startingForm(() => 0.5);
  form.outfit = "Pressure suit";
  form.parts = [
    {
      id: "shell",
      shape: "sweep",
      color: "#445555",
      size: [1, 1, 1],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      knots: [
        [0, 0, 0, 0.2, 0.13],
        [0, 0.4, 0, 0.3, 0.16],
        [0, 0.75, 0, 0.18, 0.12],
      ],
    },
  ];
  const ops = [
    {
      op: "equipPlates",
      id: "shell",
      name: "chest plate",
      face: "Front",
      count: 4,
      columns: 3,
      width: 0.13,
      length: 0.19,
      depth: 0.035,
    },
  ];
  const next = applyOperations(form, ops);
  validateForm(next);
  assert.deepEqual(next, applyOperations(form, ops));
  assert.equal(next.parts.length, 13);
  assert.deepEqual(next.parts[0], form.parts[0]);
  for (const p of next.parts.slice(1)) {
    assert.equal(p.parent, "shell");
    assert.equal(p.surfaceJoin.end, "base");
    assert.deepEqual(p.visibleIn, ["Pressure suit"]);
    assert.equal(p.motionRole, "rigid");
  }
  assert.throws(
    () => applyOperations(form, [{ ...ops[0], start: 1.5 }]),
    /dimensions/,
  );
  assert.throws(
    () => applyOperations(form, [{ ...ops[0], columns: 30 }]),
    /limit/,
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

test("a fitted hand follows its cuff with its palm inward and thumb forward on either side", () => {
  for (const side of [-1, 1]) {
    const forearm = {
      id: "sleeve",
      shape: "sweep",
      outfitRole: "forearm",
      rotation: [12, side * 30, side * 18],
      position: [side * 0.26, 1.1, 0],
      size: [1, 1, 1],
      color: "#dddddd",
      knots: [
        [0, 0, 0, 0.04, 0.04],
        [0, -0.24, 0, 0.025, 0.027],
      ],
    };
    const trace = {
      ...forearm,
      id: "hand",
      parent: forearm.id,
      outfitRole: "hand",
      position: [0.009, -0.23, 0.004],
      rotation: [0, 0, 0],
      knots: [
        [0, -0.14, 0.03, 0.02, 0.03],
        [0, 0, 0, 0.02, 0.02],
      ],
    };
    const fitted = fitHand(
      { parts: [forearm, trace], appearance: { skin: "#aa8877" } },
      "hand",
    );
    const hand = fitted.parts[1];
    const euler = (p) => new Euler(...p.rotation.map(MathUtils.degToRad));
    const world = (axis) =>
      axis.applyEuler(euler(hand)).applyEuler(euler(forearm));
    const down = new Vector3(0, -1, 0);
    assert.ok(world(down.clone()).dot(down.applyEuler(euler(forearm))) > 0.999);
    assert.ok(world(new Vector3(0, 0, 1)).x * side < -0.75);
    assert.ok(world(new Vector3(-hand.grip.side, 0, 0)).z > 0.7);
    assert.ok(
      new Vector3(...hand.position).distanceTo(new Vector3(0, -0.24, 0)) <
        0.005,
    );
  }
});
