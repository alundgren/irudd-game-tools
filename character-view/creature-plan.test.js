import test from "node:test";
import assert from "node:assert/strict";
import {
  AnimationMixer,
  Box3,
  Bone,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import {
  buildCreature,
  creatureOptions,
  creaturePlanInstructions,
  creaturePresets,
  randomCreaturePlan,
  readCreaturePlan,
  rebuildCreature,
  steerCreaturePlan,
} from "./creature-plan.js";
import { placeFootInSpace, spatialLeg } from "./creature-motion.js";
import { handGeometry } from "./hands.js";
import { makeBrief, readProposal, validateForm } from "./recipe.js";
import { applyOperations } from "./variations.js";
import { movementRoles, skinCharacter } from "./skin.js";
import { sweepGeometry } from "./surface.js";
import { wingGeometry } from "./wing-surface.js";

// The workshop model needs browser image loaders. This stand-in builds the
// same hierarchy and attachment frames from plain geometry.
export function plainModel(form) {
  const material = new MeshBasicMaterial(),
    group = new Group(),
    nodes = new Map(),
    mounts = new Map();
  for (const part of form.parts) {
    const geometry =
      part.shape === "sweep"
        ? sweepGeometry(part.knots, false, 10)
        : part.shape === "hand"
          ? handGeometry(part.grip)
          : part.shape === "wing"
            ? wingGeometry(part.wing, part.color)
            : new SphereGeometry(0.5, 10, 8);
    const node = new Mesh(geometry, material);
    if (geometry.handRig) node.handRig = geometry.handRig;
    node.name = node.userData.partId = part.id;
    node.position.fromArray(part.position);
    node.scale.fromArray(part.size);
    node.rotation.set(...part.rotation.map((v) => (v * Math.PI) / 180));
    nodes.set(part.id, node);
    if (part.frameSize) {
      const mount = new Group();
      mount.scale.set(...part.frameSize.map((v) => 1 / v));
      node.add(mount);
      mounts.set(part.id, mount);
    } else mounts.set(part.id, node);
  }
  for (const part of form.parts)
    (mounts.get(part.parent) ?? group).add(nodes.get(part.id));
  group.updateMatrixWorld(true);
  return { group, nodes };
}
const legIds = (form) =>
  form.parts.filter((p) => p.motionRole === "thigh").map((p) => p.id);

test("every preset and 300 drawn body plans build valid, replayable forms", () => {
  for (const [name, plan] of Object.entries(creaturePresets)) {
    const form = validateForm(buildCreature(plan));
    assert.deepEqual(buildCreature(form.origin.plan), form, name);
    assert.deepEqual(readCreaturePlan(form.origin.plan), form.origin.plan);
  }
  const signatures = new Set();
  for (let seed = 1; seed <= 300; seed++) {
    const plan = randomCreaturePlan(seed),
      form = validateForm(buildCreature(plan));
    assert.deepEqual(randomCreaturePlan(seed), plan);
    assert.ok(form.parts.length <= 128);
    const roles = [...movementRoles(form.parts).values()];
    const count = (role) => roles.filter((r) => r === role).length;
    signatures.add(
      [
        count("thigh"),
        count("upper arm"),
        count("wing") > 0,
        count("fin"),
      ].join(),
    );
  }
  // Leg, arm, wing and fin counts combine freely across the draws.
  assert.ok(signatures.size >= 24, String(signatures.size));
});

test("limb groups stand on the floor for every leg style and posture", () => {
  for (const style of ["mammal", "bird", "insect", "pillar"])
    for (const [rear, front] of [
      [0, 8],
      [84, 88],
      [0, 80],
    ])
      for (const end of ["paw", "hoof", "talons", "point", "pad", "paddle"]) {
        const form = buildCreature({
          spine: { rear, front, stance: 0.5 },
          limbs: [
            {
              kind: "leg",
              pairs: 3,
              from: 0.05,
              to: 0.6,
              style,
              end,
              splay: 30,
              fan: 120,
            },
          ],
        });
        validateForm(form);
        const { group } = plainModel(form);
        let lowest = Infinity;
        const feet = new Map();
        group.traverse((o) => {
          if (!o.isMesh) return;
          const p = o.geometry.attributes.position,
            v = new Vector3();
          for (let i = 0; i < p.count; i++) {
            v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
            lowest = Math.min(lowest, v.y);
            const leg = /^(left|right) leg \d+/.exec(
              o.userData.partId ?? "",
            )?.[0];
            if (leg) feet.set(leg, Math.min(feet.get(leg) ?? Infinity, v.y));
          }
        });
        assert.equal(feet.size, 6);
        assert.ok(lowest > -0.015, style + " " + end + " sinks " + lowest);
        for (const [leg, y] of feet)
          assert.ok(y < 0.03, leg + " of " + style + "/" + end + " floats " + y);
      }
});

test("a spatial two-link solve reaches a goal beside, behind and above the rest foot", () => {
  const hip = new Vector3(0.2, 0.4, 0.1),
    knee = new Vector3(0.5, 0.62, 0.16),
    ankle = new Vector3(0.74, 0.02, 0.2);
  assert.ok(spatialLeg(hip, knee, ankle));
  assert.ok(
    !spatialLeg(
      hip,
      new Vector3(0.24, 0.2, 0.2),
      new Vector3(0.24, 0.02, 0.1),
    ),
  );
  const root = new Bone(),
    a = new Bone(),
    b = new Bone(),
    c = new Bone(),
    foot = new Bone();
  root.add(a);
  a.add(b);
  b.add(c);
  c.add(foot);
  a.position.copy(hip);
  b.position.copy(knee).sub(hip);
  c.position.copy(ankle).sub(knee);
  foot.position.set(0, 0, 0.1);
  const leg = { hip, knee, ankle, a, b, c };
  for (const [dz, lift, drop] of [
    [0, 0, 0],
    [0.18, 0, 0],
    [-0.2, 0.06, -0.03],
    [0.05, 0.14, -0.12],
  ]) {
    placeFootInSpace(leg, dz, lift, drop, (bone, q) =>
      bone.quaternion.copy(q),
    );
    root.position.set(0, drop, 0);
    root.updateMatrixWorld(true);
    const at = c.getWorldPosition(new Vector3());
    assert.ok(
      at.distanceTo(ankle.clone().add(new Vector3(0, lift, dz))) < 1e-6,
      [dz, lift, drop, at.toArray()].join(),
    );
    // The knee stays on its own side and the foot keeps facing forward.
    assert.ok(b.getWorldPosition(new Vector3()).x > hip.x + 0.1);
    const toe = foot.getWorldPosition(new Vector3()).sub(at);
    assert.ok(toe.distanceTo(new Vector3(0, 0, 0.1)) < 1e-6);
  }
});

test("a low-bodied flyer clears the floor throughout a long downward wing stroke", () => {
  const base = creaturePresets["Winged glider"];
  const form = buildCreature({
    ...base, spine: {...base.spine, stance: 0.24},
    limbs: base.limbs.map(limb => limb.kind === "wing" ? {...limb, length: 2.5, rise: -24} : limb),
  });
  const {group} = plainModel(form);
  const rig = skinCharacter(form, group);
  try {
    const mixer = new AnimationMixer(rig.actor);
    const fly = rig.clips.find(clip => clip.name === "Fly");
    mixer.clipAction(fly).play();
    const box = new Box3();
    for (let frame = 0; frame <= 80; frame++) {
      mixer.setTime(frame / 80 * fly.duration);
      rig.actor.updateMatrixWorld(true);
      box.setFromObject(rig.actor, true);
      assert.ok(box.min.y > 0.03, "floor clearance at frame " + frame + ": " + box.min.y);
    }
  } finally {
    rig.dispose();
  }
});

test("each body plan walks: every foot lifts, lands and stays planted in stance", () => {
  for (const [name, plan] of Object.entries(creaturePresets)) {
    const form = buildCreature({
      ...plan,
      skin: { ...plan.skin, blend: false },
    });
    const legs = legIds(form);
    if (!legs.length) continue;
    const { group } = plainModel(form);
    const rig = skinCharacter(form, group);
    const walk = rig.clips.find((c) => c.name === "Walk");
    assert.ok(walk, name + " has no walk");
    const mixer = new AnimationMixer(rig.actor);
    mixer.clipAction(walk).play();
    const tracks = new Map();
    for (const id of legs) {
      const shin = rig.regions.get(id.replace("thigh", "shin"));
      tracks.set(id, {
        bone: shin.bones.at(-1),
        rest: shin.points.at(-1),
        samples: [],
      });
    }
    const steps = 48;
    for (let i = 0; i < steps; i++) {
      mixer.setTime((i / steps) * walk.duration);
      rig.actor.updateMatrixWorld(true);
      for (const t of tracks.values())
        t.samples.push(t.bone.getWorldPosition(new Vector3()));
    }
    const span = Math.min(
      ...legs.map((id) =>
        tracks.get(id).rest.distanceTo(rig.regions.get(id).points[0]),
      ),
    );
    for (const [id, t] of tracks) {
      const ys = t.samples.map((p) => p.y),
        zs = t.samples.map((p) => p.z),
        low = Math.min(...ys);
      assert.ok(
        Math.max(...ys) - low > 0.03 * span,
        name + " " + id + " never lifts",
      );
      assert.ok(
        Math.max(...zs) - Math.min(...zs) > 0.12 * span,
        name + " " + id + " does not stride",
      );
      // While a foot is down it stays level and does not wander sideways.
      const planted = t.samples.filter((p) => p.y - low < 0.012 * span);
      assert.ok(
        planted.length >= steps * 0.4,
        name + " " + id + " planted " + planted.length,
      );
      const xs = planted.map((p) => p.x);
      assert.ok(
        Math.max(...xs) - Math.min(...xs) < 0.02 * span + 0.004,
        name + " " + id + " slides sideways",
      );
    }
    rig.dispose();
  }
});

test("changing the body plan keeps hand sculpting, added regions and repainting", () => {
  const plan = readCreaturePlan(creaturePresets["Four-legged grazer"]);
  const built = buildCreature(plan);
  const edited = structuredClone(built);
  const part = (form, id) => form.parts.find((p) => p.id === id);
  part(edited, "tail").knots[1][3] *= 1.7;
  part(edited, "head").color = "#aa3344";
  edited.parts.push({
    id: "brow horn",
    shape: "cone",
    parent: "head",
    position: [0, 0.08, 0.02],
    size: [0.03, 0.12, 0.03],
    rotation: [0, 0, 0],
    frameSize: [1, 1, 1],
    color: "#f0e8d0",
  });
  edited.parts = edited.parts.filter((p) => p.id !== "left ear");
  edited.poses = [
    {
      name: "Bow",
      joints: [
        { part: "neck", station: 0, turn: [0.2588, 0, 0, 0.9659] },
        { part: "left leg 2 thigh", station: 0, turn: [0, 0, 0.1736, 0.9848] },
      ],
    },
  ];
  validateForm(edited);
  // A third pair of legs leaves the head, tail and first two pairs alone.
  const more = structuredClone(plan);
  more.limbs[0].pairs = 3;
  const next = validateForm(rebuildCreature(edited, more));
  assert.deepEqual(part(next, "tail"), part(edited, "tail"));
  assert.equal(part(next, "head").color, "#aa3344");
  assert.ok(part(next, "brow horn"));
  assert.ok(!part(next, "left ear"), "a removed region came back");
  assert.ok(part(next, "left leg 3 thigh"));
  assert.deepEqual(next.origin.plan, more);
  assert.equal(next.poses[0].joints.length, 2);
  // A longer neck moves the head: the repaint and the horn stay with it.
  const longer = structuredClone(more);
  longer.head.neck = 0.6;
  const tall = validateForm(rebuildCreature(next, longer));
  assert.equal(part(tall, "head").color, "#aa3344");
  assert.notDeepEqual(part(tall, "head").position, part(next, "head").position);
  assert.ok(part(tall, "brow horn"));
  // Removing the legs drops the pose joints that belonged to them.
  const legless = structuredClone(longer);
  legless.limbs = [];
  const snake = validateForm(rebuildCreature(tall, legless));
  assert.deepEqual(
    snake.poses[0].joints.map((j) => j.part),
    ["neck"],
  );
  // A form without a plan is simply built.
  assert.deepEqual(rebuildCreature({ parts: [] }, plan), built);
});

test("an assistant builds and steers a creature through operations", () => {
  const part = (form, id) => form.parts.find((p) => p.id === id);
  // A preset with changes on top of it.
  let form = applyOperations({ parts: [] }, [
    {
      op: "buildCreature",
      preset: "Four-legged grazer",
      plan: {
        head: { teeth: 3, jaw: 0.4 },
        addLimbs: [{ kind: "wing", pairs: 1, from: 0.7 }],
      },
    },
  ]);
  validateForm(form);
  assert.deepEqual(
    form.origin.plan.limbs.map((l) => l.kind),
    [...creaturePresets["Four-legged grazer"].limbs.map((l) => l.kind), "wing"],
  );
  assert.equal(form.origin.plan.head.teeth, 3);
  assert.ok(part(form, "upper left tooth 3"));
  // The artist repaints the tail, then the assistant changes the legs.
  part(form, "tail").color = "#aa3344";
  const legs = form.origin.plan.limbs.findIndex((l) => l.kind === "leg");
  const count = form.origin.plan.limbs.length;
  form = applyOperations(form, [
    {
      op: "steerCreature",
      set: {
        setLimbs: [{ index: legs, pairs: 3, style: "insect", splay: 45 }],
        skin: { markings: null, belly: 0.8 },
        details: ["frill"],
      },
    },
  ]);
  validateForm(form);
  assert.equal(form.origin.plan.limbs[legs].pairs, 3);
  assert.equal(form.origin.plan.limbs[legs].style, "insect");
  assert.equal(form.origin.plan.limbs.length, count);
  assert.equal(form.origin.plan.skin.markings, null);
  assert.deepEqual(form.origin.plan.details, ["frill"]);
  assert.equal(part(form, "tail").color, "#aa3344");
  // Changing the kind of a group starts from that kind and keeps its place.
  const turned = steerCreaturePlan(form.origin.plan, {
    setLimbs: [{ index: legs, kind: "tentacle" }],
    removeLimbs: [count - 1],
  });
  assert.equal(turned.limbs.length, count - 1);
  assert.equal(turned.limbs[legs].kind, "tentacle");
  assert.equal(turned.limbs[legs].pairs, 3);
  assert.equal(turned.limbs[legs].style, undefined);
  validateForm(buildCreature(turned));
  // Refusals name what went wrong.
  assert.throws(
    () => applyOperations({ parts: [] }, [{ op: "steerCreature", set: {} }]),
    /Start one with buildCreature/,
  );
  assert.throws(
    () => applyOperations({ parts: [] }, [{ op: "buildCreature", preset: "Dragon" }]),
    /Unknown creature preset/,
  );
  assert.throws(
    () => steerCreaturePlan(form.origin.plan, { setLimbs: [{ index: 9, pairs: 2 }] }),
    /no limb group 9/,
  );
  assert.throws(
    () =>
      steerCreaturePlan(
        {},
        { limbs: Array.from({ length: 9 }, () => ({ kind: "leg" })) },
      ),
    /at most 8/,
  );
});

test("the request tells an assistant how to steer a body plan", () => {
  const form = buildCreature(creaturePresets["Six-legged crawler"]);
  const brief = makeBrief(form, 3, "all", { width: 0, height: 0, depth: 0 }, "Give it wings.");
  assert.equal(brief.creaturePlanInstructions, creaturePlanInstructions);
  assert.deepEqual(brief.creaturePlanOptions.preset, Object.keys(creaturePresets));
  assert.deepEqual(brief.creaturePlanOptions.limbKind, creatureOptions.limbKind);
  // Every option list and plan field is named in the instructions.
  for (const key of ["spine", "head", "tail", "back", "skin", "details", "setLimbs", "removeLimbs", "addLimbs"])
    assert.ok(creaturePlanInstructions.includes(key), key);
  // A reply made of the two operations is accepted against that request.
  const next = readProposal(
    {
      format: "irudd.form-proposal.v1",
      requestId: brief.requestId,
      revision: 3,
      summary: "Wings for the crawler.",
      operations: [
        {
          op: "steerCreature",
          set: { addLimbs: [{ kind: "wing", pairs: 1, from: 0.75, length: 0.5 }] },
        },
      ],
    },
    brief,
    3,
  );
  const result = next.form ?? next;
  assert.equal(result.origin.plan.limbs.at(-1).kind, "wing");
  assert.ok(result.parts.some((p) => p.motionRole === "wing"));
});

test("every body plan preset is offered as an editable workshop study", async () => {
  const { creatureStudies } = await import("../examples/creature-studies.js");
  assert.equal(creatureStudies.length, Object.keys(creaturePresets).length);
  assert.equal(new Set(creatureStudies.map((s) => s.id)).size, creatureStudies.length);
  for (const study of creatureStudies) {
    const form = validateForm(study.make());
    assert.deepEqual(form.origin.plan, readCreaturePlan(creaturePresets[study.title]));
    assert.match(study.id, /^plan-[a-z0-9-]+$/);
  }
});
