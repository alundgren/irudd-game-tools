// preserve-sculpt: a manual body edit survives a 5% creature scale, or the
// command returns a field-specific conflict and leaves the head unchanged.
// CPU only; part of the fast suite. Each test reports its wall time.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createRegistry,
  decodeWith,
  frameCreature,
  GeneratorId,
  distance,
  displacementInWorld,
  isJsonObject,
  frameCreatureSlots,
  reduce,
  type CharacterDocument,
  type DocumentState,
  type Vec3,
} from "@irudd/document";
import {
  agent,
  committed,
  envelope,
  environment,
  generatedCreature,
  human,
  partBySlot,
  rejected,
  run,
} from "./support/fixtures.js";
import { defaultFrameCreatureParams } from "@irudd/document";

const env = environment();
const near = (a: Vec3, b: Vec3, tolerance = 1e-9) =>
  assert.ok(
    Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= tolerance,
    `${JSON.stringify(a)} ≉ ${JSON.stringify(b)}`,
  );
const times = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];

/**
 * The fixture: a generated creature with its stored base, one sculpted body
 * displacement made by the person through a surface pick, a pose linking the
 * body and neck, a renamed body, and an agent allowed to edit directly.
 */
function sculptedCreature(): { state: DocumentState; trunk: string; neck: string } {
  let s = generatedCreature(env);
  const trunk = partBySlot(s, "trunk");
  const neck = partBySlot(s, "neck");
  // Trunk centre is at (legs + girth) = 0.65 m; its top surface is 0.2 m above.
  s = run(
    s,
    env,
    envelope(human, 1, { type: "policy.set", agentDirectEdit: true }),
    envelope(human, 1, {
      type: "edit",
      ops: [
        {
          op: "sculpt.at",
          part: trunk.id,
          edit: "d-hump",
          world: [0, 0.85, 0.1],
          offset: [0, 0.03, 0],
          radius: 0.08,
        },
      ],
    }),
    envelope(human, 2, {
      type: "edit",
      ops: [
        {
          op: "pose.set",
          pose: {
            id: "pose-graze",
            label: "Graze",
            joints: [
              { part: trunk.id, rotation: [0.0871557427, 0, 0, 0.9961946981] },
              { part: neck.id, rotation: [0.3826834324, 0, 0, 0.9238795325] },
            ],
          },
        },
      ],
    }),
    envelope(human, 3, {
      type: "edit",
      ops: [{ op: "part.rename", part: trunk.id, label: "Barrel" }],
    }),
  );
  return { state: s, trunk: trunk.id, neck: neck.id };
}

/** The displacement exists, unchanged in its local frame, and moved with the body in the world. */
function preserved(
  before: CharacterDocument,
  after: CharacterDocument,
  trunk: string,
  factor: number,
): boolean {
  const a = before.parts.find((p) => p.id === trunk)?.sculpt.find((d) => d.id === "d-hump");
  const b = after.parts.find((p) => p.id === trunk)?.sculpt.find((d) => d.id === "d-hump");
  const wa = displacementInWorld(before, trunk, "d-hump");
  const wb = displacementInWorld(after, trunk, "d-hump");
  if (!a || !b || !wa || !wb) return false;
  const same = JSON.stringify(a) === JSON.stringify(b);
  const offset = distance(wb.offset, times(wa.offset, factor));
  const at = distance(wb.at, times(wa.at, factor));
  return same && offset <= 1e-9 && at <= 1e-9;
}

test("the pick resolves to the expected displacement in the body's normalised frame", (t) => {
  const started = performance.now();
  const { state, trunk } = sculptedCreature();
  const part = state.document?.parts.find((p) => p.id === trunk);
  const d = part?.sculpt[0];
  assert.ok(d);
  // Half-extents are (0.2, 0.2, 0.45): the top of the body at 0.1 m forward.
  near(d.at, [0, 1, 0.1 / 0.45]);
  near(d.offset, [0, 0.15, 0]);
  assert.ok(Math.abs(d.radius - 0.08 / 0.45) < 1e-12);
  const world = displacementInWorld(state.document ?? fail(), trunk, "d-hump");
  near(world?.offset ?? [9, 9, 9], [0, 0.03, 0]);
  t.diagnostic(`fixture ${(performance.now() - started).toFixed(1)} ms`);
});

test("a 5% scale by the agent keeps the person's displacement, rename and pose", (t) => {
  const started = performance.now();
  const { state, trunk, neck } = sculptedCreature();
  const before = state.document ?? fail();
  const step = reduce(
    state,
    envelope(agent, 4, { type: "edit", ops: [{ op: "generation.scale", factor: 1.05 }] }),
    env,
  );
  const { receipt } = committed(step.outcome);
  assert.equal(receipt.revision, 5);
  const after = step.state.document ?? fail();
  assert.equal(step.state.history[4]?.actor.id, "assistant");
  const params = after.generation?.params;
  assert.ok(
    isJsonObject(params) &&
      typeof params["scale"] === "number" &&
      Math.abs(params["scale"] - 1.05) < 1e-12,
  );

  // The displacement is identical in the body's frame and scaled with it in the world.
  assert.ok(preserved(before, after, trunk, 1.05));
  const body = after.parts.find((p) => p.id === trunk);
  assert.equal(body?.label, "Barrel");
  near(body?.size ?? [0, 0, 0], times([0.4, 0.4, 0.9], 1.05));
  // The pose still names the same immutable parts.
  assert.deepEqual(
    after.poses[0]?.joints.map((j) => j.part),
    [trunk, neck].sort(),
  );
  t.diagnostic(`scale ${(performance.now() - started).toFixed(1)} ms`);
});

test("a hand-moved part keeps its offset, carried into the scaled frame", () => {
  let { state } = sculptedCreature();
  const head = partBySlot(state, "head");
  state = run(
    state,
    env,
    envelope(human, 4, {
      type: "edit",
      ops: [{ op: "part.transform", part: head.id, translate: [0, 0.03, 0] }],
    }),
  );
  const after = run(
    state,
    env,
    envelope(agent, 5, { type: "edit", ops: [{ op: "generation.scale", factor: 1.05 }] }),
  );
  const slot = after.document?.generation?.base.slots.find((s) => s.slot === "head");
  const moved = partBySlot(after, "head");
  assert.ok(slot);
  near(
    [
      moved.position[0] - slot.position[0],
      moved.position[1] - slot.position[1],
      moved.position[2] - slot.position[2],
    ],
    [0, 0.0315, 0],
  );
});

test("changing the body's shape kind conflicts on the sculpted edit and leaves the head unchanged", () => {
  const { state, trunk } = sculptedCreature();
  const params = {
    ...defaultFrameCreatureParams,
    scale: 1.05,
    trunk: { ...defaultFrameCreatureParams.trunk, shape: "box" },
  };
  const step = reduce(
    state,
    envelope(agent, 4, { type: "edit", ops: [{ op: "generation.steer", params }] }),
    env,
  );
  const diagnostics = rejected(step.outcome).diagnostics;
  assert.equal(diagnostics.length, 1);
  const d = diagnostics[0];
  assert.equal(d?.code, "conflict");
  assert.deepEqual(d?.path, ["parts", trunk, "sculpt", "d-hump"]);
  assert.deepEqual(d?.detail, {
    reason: "frame-changed",
    slot: "trunk",
    editedIn: { revision: 2, actor: { kind: "human", id: "user" } },
  });
  assert.equal(step.state, state);
  assert.equal(step.state.head, 4);
});

test("positive control: a clean creature scales to exactly the generator's output", () => {
  const clean = generatedCreature(env);
  const after = run(
    clean,
    env,
    envelope(human, 1, { type: "edit", ops: [{ op: "generation.scale", factor: 1.05 }] }),
  );
  const expected = frameCreatureSlots({ ...defaultFrameCreatureParams, scale: 1.05 });
  const doc = after.document ?? fail();
  assert.equal(doc.parts.length, expected.length);
  for (const slot of expected) {
    const part = doc.parts.find((p) => p.slot === slot.slot);
    assert.ok(part, slot.slot);
    assert.deepEqual(
      [part.position, part.rotation, part.size, part.shape, part.label],
      [slot.position, slot.rotation, slot.size, slot.shape, slot.label],
    );
  }
});

test("negative control: a destructive rebuild loses the displacement and the check detects it", () => {
  const { state, trunk } = sculptedCreature();
  const before = state.document ?? fail();
  const params = { ...defaultFrameCreatureParams, scale: 1.05 };
  const after =
    run(
      state,
      env,
      envelope(agent, 4, {
        type: "edit",
        ops: [
          {
            op: "generation.rebuild",
            generator: "irudd.frame-creature",
            version: 1,
            params,
            discardEdits: true,
          },
        ],
      }),
    ).document ?? fail();
  assert.equal(preserved(before, after, trunk, 1.05), false);
  // Removing the slot that carries a manual edit is a conflict, not a silent loss.
  const fewer = {
    ...defaultFrameCreatureParams,
    legs: { ...defaultFrameCreatureParams.legs, pairs: 1 },
  };
  const leg = partBySlot(state, "leg.1.l");
  const edited = run(
    state,
    env,
    envelope(human, 4, {
      type: "edit",
      ops: [{ op: "part.set", part: leg.id, set: { color: "#222222" } }],
    }),
  );
  const step = reduce(
    edited,
    envelope(agent, 5, { type: "edit", ops: [{ op: "generation.steer", params: fewer }] }),
    env,
  );
  const d = rejected(step.outcome).diagnostics;
  assert.deepEqual(
    d.map((x) => [x.code, x.path.join("/")]),
    [["conflict", `parts/${leg.id}`]],
  );
  assert.equal(step.state, edited);
});

test("switching generator protects edited and deleted slots unless discard is explicit", () => {
  const otherId = decodeWith(GeneratorId, "irudd.another-creature");
  assert.ok(otherId.ok);
  const other = { ...frameCreature, id: otherId.value };
  const environment = { ...env, registry: createRegistry({ generators: [frameCreature, other] }) };
  const { state, trunk } = sculptedCreature();
  const tail = partBySlot(state, "tail");
  const edited = run(
    state,
    environment,
    envelope(human, state.head, {
      type: "edit",
      ops: [{ op: "part.remove", part: tail.id, cascade: true }],
    }),
  );
  function changeGenerator(start: DocumentState, discardEdits: boolean) {
    return reduce(
      start,
      envelope(human, start.head, {
        type: "edit",
        ops: [
          {
            op: "generation.rebuild",
            generator: other.id,
            version: 1,
            params: defaultFrameCreatureParams,
            discardEdits,
          },
        ],
      }),
      environment,
    );
  }

  const refused = changeGenerator(edited, false);
  const paths = rejected(refused.outcome).diagnostics.map((d) => d.path.join("/"));
  assert.ok(paths.includes(`parts/${trunk}/label`));
  assert.ok(paths.includes(`parts/${trunk}/sculpt`));
  assert.ok(paths.includes("generation/base/slots/tail"));
  assert.equal(refused.state, edited);

  const reset = changeGenerator(edited, true);
  committed(reset.outcome);
  assert.equal(partBySlot(reset.state, "trunk").sculpt.length, 0);
  assert.equal(partBySlot(reset.state, "trunk").label, "Body");
  assert.ok(partBySlot(reset.state, "tail"));
  committed(changeGenerator(generatedCreature(environment), false).outcome);
});

function fail(): never {
  throw new Error("missing document");
}
