import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as T from "three";
import {
  CharacterDocument,
  createRegistry,
  decodeWith,
  derivePartId,
  familyFeatures,
  generateParts,
  readDocument,
} from "@irudd/document";
import { creatureGenerator, randomCreature } from "../src/creature/index.js";
import { buildCharacter, clayMaterials } from "../src/build.js";
import { skinCharacter } from "../src/rig/skin.js";
import { MotionPreview } from "../src/rig/preview.js";
import { tipReach, type Limb } from "../src/rig/limb-pose.js";
import { wristReach } from "../src/rig/wrist-reach.js";

function fixture(name: string) {
  const source: unknown = JSON.parse(
    readFileSync(
      new URL("../../../verification/families/fixtures/" + name + ".json", import.meta.url),
      "utf8",
    ),
  );
  const read = readDocument(source, { registry: createRegistry({ features: familyFeatures }) });
  if (!read.ok) throw new Error(JSON.stringify(read.diagnostics));
  return read.value;
}

function plan(family: Parameters<typeof randomCreature>[1]) {
  const registry = createRegistry({ generators: [creatureGenerator], features: familyFeatures });
  const built = generateParts(
    registry,
    { generator: creatureGenerator.id, version: 1, params: randomCreature(33, family) },
    (slot: string) => derivePartId("doc-plan", "req-plan", slot),
  );
  assert.ok(built.ok);
  const doc = decodeWith(CharacterDocument, {
    format: "irudd.character",
    version: 1,
    id: "doc-plan",
    label: "Plan",
    requires: [],
    catalog: [],
    assets: [],
    poses: [],
    features: {},
    extensions: {},
    ...built.value,
  });
  assert.ok(doc.ok);
  return doc.value;
}

function open(name: string | ReturnType<typeof plan>) {
  const character = buildCharacter(typeof name === "string" ? fixture(name) : name, {
    materials: clayMaterials(),
  });
  const preview = new MotionPreview(skinCharacter(character));
  preview.select("Rest");
  return {
    preview,
    dispose: () => {
      preview.dispose();
      character.dispose();
    },
  };
}

const world = (bone: T.Object3D) => bone.getWorldPosition(new T.Vector3());
function end(limb: Limb | undefined, joint = 2) {
  const bone = limb?.chain?.[joint];
  assert.ok(bone);
  return bone;
}

test("the wrist reaches a target, keeps the hand's orientation and reports an unreachable one", () => {
  const { preview, dispose } = open("four-hand-courier");
  try {
    const rig = preview.rig;
    const hand = [...rig.regions.values()].find((r) => r.role === "hand");
    assert.ok(hand);
    const reach = wristReach(rig.regions, rig.bindings, hand.part.id);
    assert.ok(reach);
    const facing = reach.wrist.getWorldQuaternion(new T.Quaternion());
    const goal = reach.initial.clone().add(new T.Vector3(0.04, 0.12, 0.08));
    assert.ok(reach.solve(goal) < 0.001);
    assert.ok(world(reach.wrist).distanceTo(goal) < 0.001);
    assert.ok(reach.wrist.getWorldQuaternion(new T.Quaternion()).angleTo(facing) < 1e-4);
    const far = reach.initial.clone().add(new T.Vector3(0, 0, 5));
    assert.ok(reach.solve(far) > 1);
    const forearm = rig.regions.get(hand.part.parent ?? "");
    const elbowBone = forearm && rig.bindings.get(JSON.stringify([forearm.part.id, 0, ""]))?.bone;
    assert.ok(elbowBone);
    const elbow = (direction: Parameters<typeof reach.solve>[2], roll = 0) => {
      reach.solve(goal, roll, direction);
      rig.actor.updateMatrixWorld(true);
      return world(elbowBone);
    };
    const original = elbow("original");
    assert.ok(elbow("down").distanceTo(original) > 0.005);
    assert.ok(elbow("original", 90).distanceTo(original) > 0.005);
    assert.ok(world(reach.wrist).distanceTo(goal) < 0.001);
  } finally {
    dispose();
  }
});

test("a creature leg tip follows its target and the pair or whole group can move together", () => {
  const { preview, dispose } = open("six-legged-crawler");
  try {
    const session = preview.posing(true);
    const legs = session.limbs.limbs.filter((l) => l.kind === "leg" && l.chain);
    assert.ok(legs.length >= 6, String(legs.length));
    const leg = legs[0];
    assert.ok(leg?.chain && leg.twin);
    const tip = tipReach(leg);
    assert.ok(tip);
    const key = [...preview.rig.bindings].find(([, b]) => b.bone === leg.chain?.[0])?.[0];
    assert.ok(key);
    const choice = session.choose(key, "tip", "pair", true);
    assert.ok(choice?.guided && choice.canTip && choice.canPlant);
    assert.deepEqual(choice.scopes, ["one", "pair", "kind"]);
    assert.equal(session.scopeLabel("kind"), "All " + legs.length + " legs");
    const others = legs.filter((l) => l !== leg && l !== leg.twin);
    const planted = others.map((l) => world(end(l)));
    const twinTip = world(end(leg.twin));
    session.target.position.add(new T.Vector3(0, 0.05, 0.03));
    session.reguide();
    assert.match(session.note, /2 limb tips moved together|At full reach/);
    assert.ok(world(leg.chain[2]).distanceTo(session.target.position) < 0.002);
    assert.ok(world(end(leg.twin)).distanceTo(twinTip) > 0.02);
    others.forEach((l, i) =>
      assert.ok(world(end(l)).distanceTo(planted[i] ?? new T.Vector3()) < 0.002),
    );
    assert.ok(session.undoable);
    assert.ok(session.undo());
    assert.ok(world(leg.chain[2]).distanceTo(tip.initial) < 1e-5);
    session.choose(key, "rotate", "kind", false);
    session.nudge("x", 20);
    const turned = legs.filter(
      (l) => 1 - Math.abs(end(l, 0).quaternion.dot(new T.Quaternion())) > 0,
    );
    assert.ok(turned.length >= legs.length);
  } finally {
    dispose();
  }
});

test("guiding a wrist in the session records one undo step per edit and a pose captures the result", () => {
  const { preview, dispose } = open("four-hand-courier");
  try {
    const session = preview.posing(false);
    const hand = [...preview.rig.regions.values()].find((r) => r.role === "hand");
    assert.ok(hand);
    const key = JSON.stringify([hand.part.id, 0, ""]);
    const choice = session.choose(key, "reach");
    assert.ok(choice?.canReach && choice.guided);
    assert.equal(choice.canTip, true);
    session.nudge("y", 0.1);
    session.elbow = "clear";
    session.roll = 30;
    session.reguide();
    assert.match(session.note, /Wrist reached the target|At full reach/);
    const pose = preview.capture("Reach", []);
    assert.ok(pose.joints.length >= 2);
    assert.ok(session.undo());
    assert.ok(session.undo());
    assert.equal(session.undo(), false);
    assert.equal(preview.capture("Rest", []).joints.length, 0);
  } finally {
    dispose();
  }
});

test("a creature plan's legs and arms form guided chains and keep the other feet planted", () => {
  for (const family of ["grazer", "brute", "wader"] as const) {
    const { preview, dispose } = open(plan(family));
    try {
      const session = preview.posing(true);
      assert.equal(session.plant, true, family);
      const legs = session.limbs.limbs.filter((l) => l.kind === "leg");
      assert.ok(legs.length >= 2 && legs.every((l) => l.chain && l.twin), family);
      const leg = legs[0];
      assert.ok(leg?.chain);
      const key = [...preview.rig.bindings].find(([, b]) => b.bone === leg.chain?.[0])?.[0];
      assert.ok(key);
      const choice = session.choose(key, "tip");
      assert.ok(choice?.guided && choice.plant, family);
      const others = legs.filter((l) => l !== leg).map((l) => world(end(l)));
      session.target.position.add(new T.Vector3(0, 0.04, 0.02));
      session.reguide();
      assert.match(session.note, /The limb tip reached the target|At full reach/);
      legs
        .filter((l) => l !== leg)
        .forEach((l, i) =>
          assert.ok(world(end(l)).distanceTo(others[i] ?? new T.Vector3()) < 0.002, family),
        );
      assert.ok(
        preview.clips.some((c) => c.name === "Walk"),
        family,
      );
    } finally {
      dispose();
    }
  }
  const brute = session(plan("brute"));
  assert.ok(brute.some((l) => l.kind === "arm" && l.chain));
});

function session(doc: ReturnType<typeof plan>) {
  const { preview, dispose } = open(doc);
  try {
    return preview.posing(true).limbs.limbs.map((l) => ({ kind: l.kind, chain: !!l.chain }));
  } finally {
    dispose();
  }
}
