import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as T from "three";
import { createRegistry, familyFeatures, motionPoses, readDocument } from "@irudd/document";
import { armChains, bendElbow, recutSleeves } from "../src/rig/arm-edit.js";
import { MotionPreview } from "../src/rig/preview.js";
import { poseClipName } from "../src/rig/poses.js";
import { buildCharacter, clayMaterials } from "../src/build.js";
import { skinCharacter } from "../src/rig/skin.js";

const source: unknown = JSON.parse(
  readFileSync(
    new URL("../../../verification/families/fixtures/four-hand-courier.json", import.meta.url),
    "utf8",
  ),
);
const read = readDocument(source, { registry: createRegistry({ features: familyFeatures }) });
if (!read.ok) throw new Error(JSON.stringify(read.diagnostics));
const doc = read.value;

test("scrubbing and playing use the export rig and an edited pose resolves to the same bone after rebuilding", () => {
  const character = buildCharacter(doc, { materials: clayMaterials() });
  const preview = new MotionPreview(skinCharacter(character));
  try {
    preview.select("Walk");
    preview.seek(0.2);
    const first = preview.capture("Walk sample", []);
    preview.advance(0.25);
    assert.deepEqual(preview.capture("Walk sample", []), first);
    preview.playing = true;
    preview.advance(0.25);
    assert.notDeepEqual(preview.capture("Walk sample", []), first);
    preview.select("Rest");
    const arm = armChains(character)[0];
    assert.ok(arm);
    const entry = [...preview.rig.bindings].find(
      ([, b]) => b.address.part === arm.lower.part.id && b.address.station === 0,
    );
    assert.ok(entry);
    preview.adjust(entry[0], "Rotate", "x", 45);
    preview.adjust(entry[0], "Move", "z", 0.03);
    const pose = preview.capture("Carry", []);
    assert.equal(pose.joints.length, 1);
    assert.equal(pose.joints[0]?.part, arm.lower.part.id);
    const next = buildCharacter(
      {
        ...doc,
        features: { ...doc.features, [motionPoses.id]: motionPoses.json({ poses: [pose] }) },
      },
      { materials: clayMaterials() },
    );
    const reloaded = new MotionPreview(skinCharacter(next));
    try {
      reloaded.select(poseClipName(pose.name));
      const joint = reloaded.rig.bindings.get(entry[0]);
      assert.ok(joint);
      assert.ok(joint.bone.position.distanceTo(entry[1].bone.position) < 1e-6);
      assert.ok(joint.bone.quaternion.clone().normalize().angleTo(entry[1].bone.quaternion) < 1e-5);
    } finally {
      reloaded.dispose();
      next.dispose();
    }
  } finally {
    preview.dispose();
    character.dispose();
  }
});

test("bending affects the forearm and sleeve cutting fits both swept segments", () => {
  const character = buildCharacter(doc, { materials: clayMaterials() });
  try {
    const arm = armChains(character)[0];
    assert.ok(arm);
    const bend = bendElbow(arm, 15);
    assert.equal(bend.part, arm.lower.part.id);
    assert.notDeepEqual(bend.set.rotation, arm.lower.part.rotation);
    const cut = recutSleeves(doc, arm, "#224466");
    for (const part of [arm.upper, arm.lower])
      assert.ok(
        cut.some(
          (o) =>
            "part" in o &&
            o.part === part.part.id &&
            "feature" in o &&
            o.feature === "figure.sweep",
        ),
      );
  } finally {
    character.dispose();
  }
});

test("gaze can be scrubbed and a manual gaze and expression stay set during idle playback", () => {
  const actor = new T.Group();
  const face = new T.Mesh(new T.BufferGeometry(), new T.MeshBasicMaterial());
  face.name = "Face";
  face.morphTargetDictionary = { LookLeft: 0, LookRight: 1, LookUp: 2, LookDown: 3, Smile: 4 };
  face.morphTargetInfluences = [0, 0, 0, 0, 0];
  actor.add(face);
  const skeleton = new T.Skeleton([]);
  const preview = new MotionPreview({
    actor,
    skeleton,
    clips: [new T.AnimationClip("Idle", 2, [])],
    bindings: new Map(),
    regions: new Map(),
    dispose() {
      skeleton.dispose();
      face.geometry.dispose();
      face.material.dispose();
    },
  });
  try {
    preview.select("Gaze");
    preview.seek(0.2);
    assert.ok((face.morphTargetInfluences[0] ?? 0) > 0.99);
    preview.seek(0.6);
    assert.ok((face.morphTargetInfluences[2] ?? 0) > 0.99);
    preview.select("Idle");
    preview.setFace("Smile", 0.8, -0.7, 0.4);
    preview.playing = true;
    preview.advance(0.15);
    assert.deepEqual(face.morphTargetInfluences, [0, 0.7, 0.4, 0, 0.8]);
  } finally {
    preview.dispose();
  }
});
