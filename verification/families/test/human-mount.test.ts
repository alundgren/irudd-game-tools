import assert from "node:assert/strict";
import { test } from "node:test";
import { exportCharacter } from "@irudd/character";
import { evaluateHuman, humanMeasurements, HumanAdultParams } from "@irudd/character/human";
import { scapulaSocket } from "../../../packages/character/src/human/sockets.js";
import {
  decodeWith,
  documentDigest,
  documentJson,
  emptyState,
  memoryEnvironment,
  reduce,
  type CharacterDocument,
  type CommandEnvelopeInput,
  type DocumentState,
} from "@irudd/document";
import { compareGlb } from "../src/compare.js";
import { loadHumanBody } from "../src/human-assets.js";
import { installNodeExporter } from "../src/node-exporter.js";
import { familyRegistry, preparePacks } from "../src/prepare.js";
import { readFixture } from "../src/fixtures.js";

installNodeExporter();
await preparePacks();
const body = await loadHumanBody();
const env = memoryEnvironment(
  familyRegistry,
  readFixture("native-portrait-projection").assets.map((a) => [
    a.digest,
    { byteLength: a.byteLength, mediaType: a.mediaType },
  ]),
);

let request = 0;
function commit(
  state: DocumentState,
  doc: CharacterDocument,
  command: CommandEnvelopeInput["command"],
): DocumentState {
  request += 1;
  const next = reduce(
    state,
    {
      format: "irudd.command",
      version: 1,
      requestId: `req-mount-${request.toString().padStart(4, "0")}`,
      documentId: doc.id,
      actor: { kind: "human", id: "user" },
      expectedRevision: state.head,
      command,
    },
    env,
  );
  assert.equal(next.outcome.kind, "committed", JSON.stringify(next.outcome));
  return next.state;
}
const opened = (doc: CharacterDocument) =>
  commit(emptyState(doc.id), doc, { type: "document.create", document: documentJson(doc) });
const current = (state: DocumentState): CharacterDocument => {
  assert.ok(state.document);
  return state.document;
};
const clay = async (doc: CharacterDocument, revision: number) =>
  (await exportCharacter(doc, { preset: "clay", revision, build: "test", human: body })).bytes;
const params = (doc: CharacterDocument) => {
  const decoded = decodeWith(HumanAdultParams, doc.generation?.params, ["params"]);
  assert.ok(decoded.ok);
  return decoded.value;
};

test("a winged adult's wing edit and banked pose are undoable edits of its export", async () => {
  const doc = readFixture("winged-scout");
  const wing = doc.parts.find((p) => p.label === "left wing 1");
  assert.ok(wing?.features["figure.scapula-mount"]);
  const base = opened(doc);
  const before = await clay(doc, 1);
  const raised = commit(base, doc, {
    type: "edit",
    ops: [
      {
        op: "part.set",
        part: wing.id,
        set: { position: [wing.position[0], wing.position[1] + 0.02, wing.position[2]] },
      },
    ],
  });
  const raisedBytes = await clay(current(raised), 2);
  const lifted = compareGlb(before, raisedBytes);
  const joint = lifted.structure.find((d) => /^nodes\[\d+\]\.translation\[1\]$/.test(d.path));
  assert.ok(joint, JSON.stringify(lifted.structure));
  assert.ok(Math.abs(Number(joint.fresh) - Number(joint.reference) - 0.02) < 1e-12);
  assert.ok(lifted.accessors.some((a) => a.use === "POSITION" && a.differing > 0));
  const poses = doc.features["motion.poses"];
  const bank = poses && typeof poses === "object" && "poses" in poses ? poses["poses"] : null;
  assert.ok(Array.isArray(bank));
  const steeper = {
    poses: bank.map((pose: unknown) => {
      if (!(pose && typeof pose === "object" && "name" in pose && pose.name === "Bank"))
        return pose;
      const joints: unknown = "joints" in pose ? pose.joints : [];
      const rest: unknown[] = Array.isArray(joints) ? joints.slice(1) : [];
      return {
        ...pose,
        joints: [{ part: wing.id, station: 0, turn: [0, 0, 0.4115, 0.9114] }, ...rest],
      };
    }),
  };
  const edited = commit(raised, doc, {
    type: "edit",
    ops: [{ op: "feature.set", feature: "motion.poses", value: steeper }],
  });
  const banked = compareGlb(raisedBytes, await clay(current(edited), 2));
  assert.ok(banked.structure.length > 0);
  for (const d of banked.structure) {
    assert.match(d.path, /^accessors\[\d+\]\.(min|max)\[[23]\]$/);
    assert.ok(
      [0.4115, 0.9114].some((v) => Math.abs(Number(d.fresh) - v) < 1e-4),
      d.path,
    );
  }
  assert.ok(banked.accessors.every((a) => a.use !== "POSITION" || a.differing === 0));
  const back = commit(edited, doc, { type: "undo", target: edited.head });
  const undone = commit(back, doc, { type: "undo", target: raised.head });
  assert.equal(documentDigest(current(undone)), documentDigest(doc));
});

test("steering a winged adult's measurements reseats its wings on the blades", async () => {
  const doc = readFixture("winged-scout");
  const old = params(doc);
  const taller = { ...old, human: { ...old.human, height: 1.78, shoulders: 0.2 } };
  const steered = commit(opened(doc), doc, {
    type: "edit",
    ops: [{ op: "generation.steer", params: taller }],
  });
  const next = current(steered);
  const before = evaluateHuman(body, humanMeasurements(old)),
    after = evaluateHuman(body, humanMeasurements(params(next)));
  for (const label of ["left wing 1", "right wing 1"]) {
    const was = doc.parts.find((p) => p.label === label);
    const now = next.parts.find((p) => p.label === label);
    assert.ok(was && now);
    const side = was.position[0] > 0 ? 1 : -1;
    const a = scapulaSocket(before, side),
      b = scapulaSocket(after, side);
    now.position.forEach((v, i) =>
      assert.equal(v, (was.position[i] ?? 0) + ((b[i] ?? 0) - (a[i] ?? 0)), `${label} ${i}`),
    );
    assert.ok(Math.abs(now.position[1] - was.position[1]) > 1e-3, `${label} moved with the blade`);
    const feathers = next.parts.find((p) => p.label === label + " feathers");
    assert.deepEqual(
      feathers?.position,
      doc.parts.find((p) => p.label === label + " feathers")?.position,
    );
  }
  await clay(next, 2);
  const undone = commit(steered, doc, { type: "undo", target: steered.head });
  assert.equal(documentDigest(current(undone)), documentDigest(doc));
});

test("a native portrait layer is a typed plate on the adult's head and comes off in one edit", () => {
  const doc = readFixture("native-portrait-projection");
  const head = doc.parts.find((p) => p.label === "head");
  const feature = head?.features["figure.native-portrait"];
  const layer =
    feature && typeof feature === "object" && "layer" in feature ? feature["layer"] : null;
  assert.ok(head && typeof layer === "string");
  const plate = doc.assets.find((a) => a.digest === layer);
  assert.equal(plate?.role, "portrait-plate");
  const base = opened(doc);
  const removed = commit(base, doc, {
    type: "edit",
    ops: [
      { op: "feature.set", feature: "figure.native-portrait", part: head.id, value: null },
      { op: "asset.remove", digest: layer },
    ],
  });
  const bare = current(removed);
  assert.equal(bare.assets.length, 0);
  assert.equal(
    bare.parts.find((p) => p.id === head.id)?.features["figure.native-portrait"],
    undefined,
  );
  const undone = commit(removed, doc, { type: "undo", target: removed.head });
  assert.equal(documentDigest(current(undone)), documentDigest(doc));
});
