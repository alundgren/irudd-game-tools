import test from "node:test";
import assert from "node:assert/strict";
import {
  AnimationMixer,
  BoxGeometry,
  Group,
  Mesh,
  Quaternion,
  Vector3,
} from "three";
import { bendElbow, recutArmSleeves } from "./graft.js";
import { skinCharacter } from "./skin.js";

test("a raised forearm hinges at its elbow, carries the wrist and keeps both rigid segment lengths", () => {
  const parts = [
    { id: "shoulder", motionRole: "upper arm", position: [0, 1, 0] },
    {
      id: "hinge",
      parent: "shoulder",
      motionRole: "forearm",
      position: [0, -0.3, 0],
    },
    {
      id: "palm",
      parent: "hinge",
      motionRole: "hand",
      position: [0, 0.08, 0.23],
    },
    { id: "cup", parent: "palm", motionRole: "rigid", position: [0, -0.04, 0] },
  ].map((p) => ({ ...p, shape: "box", size: [1, 1, 1], rotation: [0, 0, 0] }));
  const form = { parts };
  const swept = {
    parts: parts.map((p, i) =>
      i < 2
        ? {
            ...p,
            shape: "sweep",
            knots: [
              [0, -0.2, 0, 0.06, 0.06],
              [0, 0, 0, 0.05, 0.05],
            ],
          }
        : p,
    ),
  };
  const recut = recutArmSleeves(swept, "palm", "#365849");
  assert.deepEqual(
    recut.parts.map((p) => p.position),
    swept.parts.map((p) => p.position),
  );
  assert.deepEqual(recut.parts.slice(2), swept.parts.slice(2));
  assert.ok(recut.parts[1].knots[1][3] < recut.parts[1].knots.at(-3)[3]);
  const nudged = bendElbow(form, "palm", 15);
  assert.deepEqual(
    nudged.parts.filter((p) => p.id !== "hinge"),
    parts.filter((p) => p.id !== "hinge"),
  );
  assert.ok(Math.abs(nudged.parts[1].rotation[0] + 15) < 1e-5);
  assert.ok(
    bendElbow(nudged, "shoulder", -15).parts[1].rotation.every(
      (v) => Math.abs(v) < 1e-5,
    ),
  );
  const model = new Group(),
    objects = new Map();
  for (const p of parts) {
    const obj = new Mesh(new BoxGeometry(0.035, 0.08, 0.04));
    obj.userData.partId = p.id;
    obj.position.fromArray(p.position);
    (objects.get(p.parent) ?? model).add(obj);
    objects.set(p.id, obj);
  }
  const rig = skinCharacter(form, model),
    upper = rig.regions.get("shoulder"),
    fore = rig.regions.get("hinge"),
    palm = rig.regions.get("palm");
  const expected = objects.get("hinge").getWorldPosition(new Vector3());
  assert.ok(fore.points[0].distanceTo(expected) < 1e-7);
  const reach = rig.clips.find((c) => c.name === "Reach");
  assert.ok(
    reach.tracks.some((t) => t.name === fore.bones[0].name + ".quaternion"),
  );
  assert.ok(
    !reach.tracks.some((t) => t.name === upper.bones[1].name + ".quaternion"),
  );
  const mixer = new AnimationMixer(rig.actor);
  mixer.clipAction(reach).play();
  const position = (s) => s.bones[0].getWorldPosition(new Vector3());
  const lengths = () => [
    position(upper).distanceTo(position(fore)),
    position(fore).distanceTo(position(palm)),
  ];
  const rest = lengths();
  for (let frame = 0; frame <= 16; frame++) {
    mixer.setTime((reach.duration * frame) / 16);
    lengths().forEach((n, i) => assert.ok(Math.abs(n - rest[i]) < 1e-6));
  }
  rig.dispose();
});

test("neighbouring arms keep separate swing paths with fixed sockets and an upright carried object", () => {
  const parts = [],
    model = new Group(),
    nodes = new Map();
  function part(id, parent, role, position) {
    parts.push({
      id,
      parent,
      motionRole: role,
      position,
      shape: "box",
      size: [1, 1, 1],
      rotation: [0, 0, 0],
    });
    const mesh = new Mesh(new BoxGeometry(0.08, 0.1, 0.07));
    mesh.userData.partId = id;
    mesh.position.fromArray(position);
    (nodes.get(parent) ?? model).add(mesh);
    nodes.set(id, mesh);
  }
  part("body", undefined, "torso", [0, 0, 0]);
  for (const side of [-1, 1])
    for (const [i, y] of [1.44, 1.08].entries()) {
      const id = side + "/" + i;
      part("arm" + id, "body", "upper arm", [
        side * (0.18 + i * 0.045),
        y,
        i * 0.17,
      ]);
      part("fore" + id, "arm" + id, "forearm", [side * 0.15, -0.28, 0.06]);
      part("hand" + id, "fore" + id, "hand", [side * 0.14, -0.24, 0.04]);
    }
  part("pitcher", "hand1/1", "accessory", [0, -0.045, 0]);
  const rig = skinCharacter({ parts }, model);
  const bone = (id) => rig.regions.get(id).bones[0];
  const position = (id) => bone(id).getWorldPosition(new Vector3());
  const upright = bone("pitcher").getWorldQuaternion(new Quaternion());
  const sockets = ["arm1/0", "arm1/1"].map(position);
  const mixer = new AnimationMixer(rig.actor);
  const walk = rig.clips.find((c) => c.name === "Walk");
  mixer.clipAction(walk).play();
  let initialSpan,
    start,
    travel = 0;
  for (let i = 0; i < 32; i++) {
    mixer.setTime((walk.duration * i) / 32);
    const hand = position("hand1/0"),
      span = hand.distanceTo(position("hand1/1"));
    if (!i) {
      initialSpan = span;
      start = hand;
    }
    travel = Math.max(travel, Math.abs(hand.z - start.z));
    assert.ok(Math.abs(span - initialSpan) < 1e-5);
    for (const [j, socket] of ["arm1/0", "arm1/1"].entries()) {
      const at = position(socket);
      assert.ok(
        Math.abs(at.x - sockets[j].x) + Math.abs(at.z - sockets[j].z) < 1e-6,
      );
    }
    assert.ok(
      upright.angleTo(bone("pitcher").getWorldQuaternion(new Quaternion())) <
        1e-5,
    );
  }
  assert.ok(travel > 0.1);
  rig.dispose();

  const held = new Set(["arm-1/1", "arm1/1"]);
  const carry = skinCharacter(
    {
      parts: parts.map((p) =>
        held.has(p.id) ? { ...p, holdArmPose: true } : p,
      ),
      poses: [
        {
          name: "Lift",
          joints: [
            { part: "arm1/1", station: 0, turn: [0.5, 0, 0, Math.sqrt(0.75)] },
          ],
        },
      ],
    },
    model,
  );
  const attached = (id) => carry.regions.get(id).bones[0];
  const carrier = attached("pitcher"),
    other = attached("hand-1/1");
  const relative = () =>
    carrier.worldToLocal(other.getWorldPosition(new Vector3()));
  const seat = relative(),
    replay = new AnimationMixer(carry.actor);
  for (const clip of carry.clips) {
    if (clip.name.startsWith("Pose")) continue;
    replay.stopAllAction();
    replay.clipAction(clip).play();
    for (let i = 0; i < 16; i++) {
      replay.setTime((clip.duration * i) / 16);
      assert.ok(relative().distanceTo(seat) < 1e-6, clip.name);
    }
  }
  replay.stopAllAction();
  replay.clipAction(carry.clips.find((c) => c.name.endsWith("Lift"))).play();
  replay.setTime(0.5);
  assert.ok(relative().distanceTo(seat) > 0.05);
  carry.dispose();
});
