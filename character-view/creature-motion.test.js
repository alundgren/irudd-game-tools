import test from "node:test";
import assert from "node:assert/strict";
import { Bone, Box3, Vector3 } from "three";
import { creatureClips, standardMoves } from "./creature-motion.js";
import { movementRoles } from "./skin.js";

test("a plated wing follows its shared root and a limbless spine exports looped axial poses", () => {
  const roles = movementRoles([
    { id: "arm", shape: "sweep" },
    { id: "wing spar", shape: "sweep", parent: "arm" },
    { id: "wing plate", shape: "scute", parent: "arm" },
    { id: "nape", shape: "scute", motionRole: "axial spine" },
  ]);
  assert.equal(roles.get("arm"), "wing");
  assert.equal(roles.get("wing spar"), "rigid");
  assert.equal(roles.get("nape"), "rigid");
  const points = Array.from(
      { length: 8 },
      (_, i) => new Vector3(0, 0.18, i * 0.23),
    ),
    bones = points.map((_, i) => {
      const b = new Bone();
      b.name = "Axial" + i;
      return b;
    });
  const root = new Bone();
  root.name = "Root";
  const r = {
    role: "axial spine",
    points,
    bones,
    bounds: new Box3(new Vector3(-0.1, 0, 0), new Vector3(0.1, 0.36, 1.7)),
  };
  const clips = creatureClips(root, new Map([["body", r]]));
  assert.deepEqual(standardMoves([r.role]), ["Idle", "Reach"]);
  assert.deepEqual(
    clips.map((c) => c.name),
    ["Swim", "Slither", "Coil"],
  );
  for (const clip of clips) {
    assert.ok(clip.validate());
    assert.ok(
      clip.tracks.some(
        (t) => t.name === "Axial5.quaternion" && t.times.length > 4,
      ),
    );
    for (const t of clip.tracks) {
      const n = t.getValueSize();
      for (let i = 0; i < n; i++)
        assert.ok(
          Math.abs(t.values[i] - t.values[t.values.length - n + i]) < 1e-5,
        );
    }
  }
});
