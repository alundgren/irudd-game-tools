import test from "node:test";
import assert from "node:assert/strict";
import { AnimationMixer, BoxGeometry, Group, Mesh, Vector3 } from "three";
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
