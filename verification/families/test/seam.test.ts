import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import * as T from "three";
import {
  buildCharacter,
  buildView,
  clayMaterials,
  exportCharacter,
  skinCharacter,
  type BuiltCharacter,
} from "@irudd/character";
import {
  documentDigest,
  documentJson,
  emptyState,
  memoryEnvironment,
  readDocument,
  reduce,
  type CharacterDocument,
  type CommandEnvelopeInput,
  type Outcome,
} from "@irudd/document";
import { compareGlb } from "../src/compare.js";
import { installNodeExporter } from "../src/node-exporter.js";
import { fixturesDir } from "../src/paths.js";
import { familyRegistry, prepareForm, UnsupportedForm } from "../src/prepare.js";

installNodeExporter();

type Mutable = { [key: string]: unknown };
const isObject = (v: unknown): v is Mutable => typeof v === "object" && v !== null;
const isMesh = (o: T.Object3D | undefined): o is T.Mesh => o instanceof T.Mesh;
const isSkinned = (o: T.Object3D): o is T.SkinnedMesh => o instanceof T.SkinnedMesh;

const leg = ["left thigh", "left shin", "left foot", "left heel"].concat(
  [1, 2, 3, 4, 5].map((n) => `left toe ${n}`),
);
const seat = ["body", "left thigh", "right thigh"];

function figure(
  keep: ReadonlyArray<string>,
  edit?: (features: Mutable, label: string) => void,
  outfit = "Anatomy",
): CharacterDocument {
  const raw: unknown = JSON.parse(readFileSync(join(fixturesDir, "figure-42.json"), "utf8"));
  assert.ok(isObject(raw) && Array.isArray(raw["parts"]));
  const parts = raw["parts"].filter(
    (p): p is Mutable => isObject(p) && keep.includes(String(p["label"])),
  );
  const ids = new Set(parts.map((p) => p["id"]));
  for (const part of parts) {
    if (!ids.has(part["parent"])) part["parent"] = null;
    if (edit && isObject(part["features"])) edit(part["features"], String(part["label"]));
  }
  raw["parts"] = parts;
  const features = raw["features"];
  assert.ok(isObject(features));
  raw["features"] = {
    "character.appearance": features["character.appearance"],
    "outfit.wardrobe": { outfit },
  };
  const listed: unknown = raw["requires"];
  assert.ok(Array.isArray(listed));
  const requires = listed.filter(isObject);
  const declared = new Set(requires.map((r) => r["feature"]));
  for (const part of parts)
    for (const feature of Object.keys(isObject(part["features"]) ? part["features"] : {}))
      if (!declared.has(feature)) {
        declared.add(feature);
        requires.push({ feature, version: familyRegistry.features.get(feature)?.version ?? 1 });
      }
  raw["requires"] = requires.sort((x, y) =>
    String(x["feature"]).localeCompare(String(y["feature"])),
  );
  const read = readDocument(raw, { registry: familyRegistry });
  if (!read.ok) throw new Error(JSON.stringify(read.diagnostics.slice(0, 4)));
  return read.value;
}

function withBuilt<R>(doc: CharacterDocument, use: (built: BuiltCharacter) => R): R {
  const built = buildCharacter(doc, { materials: clayMaterials() });
  try {
    return use(built);
  } finally {
    built.dispose();
  }
}

const meshOf = (built: BuiltCharacter, label: string): T.Mesh => {
  const object = [...built.parts.values()].find((p) => p.part.label === label)?.object;
  assert.ok(isMesh(object), label);
  return object;
};

const idOf = (built: BuiltCharacter, label: string): string =>
  [...built.parts.values()].find((p) => p.part.label === label)?.part.id ?? "";

const depthOf = (mesh: T.Mesh): number => {
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  assert.ok(box);
  return box.max.z - box.min.z;
};

test("each seam group joins its own sweeps", () => {
  withBuilt(figure(leg), (built) => {
    const foot = built.blendOwners.get(meshOf(built, "left foot"));
    const shin = built.blendOwners.get(meshOf(built, "left shin"));
    assert.ok(foot && shin, "both groups are joined");
    assert.deepEqual(
      [...foot.ids].sort(),
      leg
        .slice(2)
        .map((l) => idOf(built, l))
        .sort(),
      "the foot joins its heel and toes",
    );
    assert.deepEqual([...shin.ids], [idOf(built, "left thigh"), idOf(built, "left shin")]);
  });
});

test("a bare foot ends at the ball where a toe of its group shows", () => {
  const footDepth = (toeGroup: boolean) =>
    withBuilt(
      figure(["left foot", "left toe 1"], (f, label) => {
        if (label !== "left toe 1") return;
        f["figure.join"] = { depth: 0.002, end: "first" };
        if (!toeGroup) delete f["figure.seam"];
      }),
      (built) => {
        assert.equal(built.blendOwners.get(meshOf(built, "left foot")), undefined);
        return depthOf(meshOf(built, "left foot"));
      },
    );
  const ball = footDepth(true);
  const whole = footDepth(false);
  assert.ok(ball < whole - 0.01, `the foot is shorter (${ball} < ${whole})`);
});

test("a pressure suit leaves the figure skin unjoined", () => {
  withBuilt(figure(leg, undefined, "Pressure suit"), (built) => {
    for (const label of ["left thigh", "left shin"])
      assert.equal(built.blendOwners.get(meshOf(built, label)), undefined, label);
  });
});

test("the seat binds the torso and both joined thighs with shared weights", () => {
  withBuilt(figure(seat), (built) => {
    const rig = skinCharacter(built);
    try {
      const body = idOf(built, "body");
      const thighs = [idOf(built, "left thigh"), idOf(built, "right thigh")];
      const regionOf = (bone: number): unknown => rig.skeleton.bones[bone]?.userData["region"];
      let seated = 0;
      rig.actor.traverse((node) => {
        if (!isSkinned(node)) return;
        const geometry = node.geometry;
        const ids = geometry.getAttribute("skinIndex");
        const weights = geometry.getAttribute("skinWeight");
        for (let i = 0; i < ids.count; i++) {
          const used = [0, 1, 2].filter((k) => weights.getComponent(i, k) > 0.05);
          const regions = new Set(used.map((k) => regionOf(ids.getComponent(i, k))));
          if (regions.has(body) && thighs.every((t) => regions.has(t))) seated++;
        }
      });
      assert.ok(seated > 20, `vertices at the crotch follow all three bones (${seated})`);
    } finally {
      rig.dispose();
    }
  });
});

test("seam groups, pulls and foot sections G0 refused are refused", () => {
  const refuse = (edit: (f: Mutable, label: string) => void, pattern: RegExp, what: string) =>
    assert.throws(() => buildView(figure(leg, edit)), pattern, what);
  const unread = (edit: (f: Mutable, label: string) => void, what: string) =>
    assert.throws(() => figure(leg, edit), what);
  unread((f) => {
    if (f["figure.seam"]) f["figure.seam"] = { group: "sleeve" };
  }, "an unknown group");
  const pull = { at: [0, 0, 0], reach: [0.05, 0.05, 0.05], offset: [0, 0, 0.01] };
  unread((f) => (f["figure.pulls"] = { pulls: Array.from({ length: 65 }, () => pull) }), "65");
  unread((f) => (f["figure.pulls"] = { pulls: [{ ...pull, reach: [0, 0.05, 0.05] }] }), "reach");
  unread((f) => (f["figure.pulls"] = { pulls: [{ ...pull, mirrorX: 25 }] }), "mirror plane");
  unread((f) => (f["figure.pulls"] = { pulls: [{ ...pull, offset: [5, 0, 0] }] }), "offset");
  unread((f) => (f["figure.foot"] = { section: "heel" }), "an unknown foot section");
  refuse(
    (f, label) => {
      if (label === "left thigh") {
        delete f["figure.sweep"];
        delete f["figure.seam"];
        f["figure.foot"] = { section: "upper" };
      }
    },
    /foot section/,
    "a foot section without a sweep",
  );
  refuse(
    (f, label) => {
      const sweep = f["figure.sweep"];
      if (label === "left foot" && isObject(sweep) && Array.isArray(sweep["knots"]))
        sweep["knots"] = sweep["knots"].slice(0, 3);
    },
    /bare foot/,
    "a bare foot of three knots",
  );
  refuse(
    (f, label) => {
      if (label === "left heel") delete f["figure.sweep"];
    },
    /seam group but is not a sweep/,
    "a seam group without a sweep",
  );
  const raw = documentJson(figure(leg));
  const kept: unknown = isObject(raw) ? raw["parts"] : undefined;
  assert.ok(isObject(raw) && Array.isArray(kept));
  const parts = kept.filter(isObject);
  const toe = parts.find((p) => p["label"] === "left toe 1");
  assert.ok(toe);
  for (let n = 0; n < 42; n++) parts.push({ ...toe, id: `p-extra-toe-${n}` });
  const crowded = readDocument({ ...raw, parts }, { registry: familyRegistry });
  assert.ok(crowded.ok);
  assert.throws(() => buildView(crowded.value), /at most 48/);
  const legacy = (extra: Mutable) => ({
    parts: [
      {
        id: "lump",
        shape: "ellipsoid",
        position: [0, 1, 0],
        size: [0.1, 0.1, 0.1],
        rotation: [0, 0, 0],
        color: "#887766",
        ...extra,
      },
    ],
  });
  assert.ok(prepareForm("plain-lump", legacy({})).document);
  for (const extra of [{ seamGroup: "figure" }, { footSection: "sole" }])
    assert.throws(() => prepareForm("odd-lump", legacy(extra)), UnsupportedForm);
});

const human = { kind: "human", id: "user" } as const;
let request = 0;
function envelope(
  doc: CharacterDocument,
  expectedRevision: number,
  command: CommandEnvelopeInput["command"],
): CommandEnvelopeInput {
  request += 1;
  return {
    format: "irudd.command",
    version: 1,
    requestId: `req-${request.toString().padStart(8, "0")}`,
    documentId: doc.id,
    actor: human,
    expectedRevision,
    command,
  };
}
const kind = (outcome: Outcome) =>
  outcome.kind === "rejected" ? `rejected ${JSON.stringify(outcome.diagnostics)}` : outcome.kind;

test("dropping a shin's pulls is one undoable edit that changes the export", async () => {
  const doc = figure(["left shin"]);
  const env = memoryEnvironment(familyRegistry, []);
  const created = reduce(
    emptyState(doc.id),
    envelope(doc, 0, { type: "document.create", document: documentJson(doc) }),
    env,
  );
  assert.equal(created.outcome.kind, "committed", kind(created.outcome));
  const shin = doc.parts.find((p) => p.label === "left shin");
  assert.ok(shin?.features["figure.pulls"]);
  const op = { op: "feature.set" as const, feature: "figure.pulls", part: shin.id, value: null };
  const edited = reduce(created.state, envelope(doc, 1, { type: "edit", ops: [op] }), env);
  assert.equal(edited.outcome.kind, "committed", kind(edited.outcome));
  const plain = edited.state.document;
  assert.ok(plain);
  assert.equal(plain.parts.find((p) => p.id === shin.id)?.features["figure.pulls"], undefined);
  const build = "test-build";
  const before = await exportCharacter(doc, { preset: "clay", revision: 1, build });
  const after = await exportCharacter(plain, { preset: "clay", revision: 2, build });
  const moved = compareGlb(before.bytes, after.bytes).accessors.find((a) => a.use === "POSITION");
  assert.ok((moved?.differing ?? 0) > 0, "the shin's surface is no longer pulled");
  const undone = reduce(edited.state, envelope(doc, 2, { type: "undo", target: 2 }), env);
  assert.equal(undone.outcome.kind, "committed", kind(undone.outcome));
  const restored = undone.state.document;
  assert.ok(restored);
  assert.equal(documentDigest(restored), documentDigest(doc));
});

test("a joined thigh moved far from its figure leaves the rest of the rig whole", () => {
  const doc = figure(["body", "left thigh", "left shin", "right upper arm", "right forearm"]);
  const thigh = doc.parts.find((p) => p.label === "left thigh");
  assert.ok(thigh);
  const env = memoryEnvironment(familyRegistry, []);
  const created = reduce(
    emptyState(doc.id),
    envelope(doc, 0, { type: "document.create", document: documentJson(doc) }),
    env,
  );
  assert.equal(created.outcome.kind, "committed", kind(created.outcome));
  const [x, y, z] = thigh.position;
  const position: readonly [number, number, number] = [x + 35.08, y, z];
  const op = { op: "part.set" as const, part: thigh.id, set: { position } };
  const edited = reduce(created.state, envelope(doc, 1, { type: "edit", ops: [op] }), env);
  assert.equal(edited.outcome.kind, "committed", kind(edited.outcome));
  const moved = edited.state.document;
  assert.ok(moved);
  withBuilt(moved, (built) => {
    for (const { part, object } of built.parts.values()) {
      assert.ok(isMesh(object) && built.blendOwners.has(object), `${part.label} is joined`);
      const count = object.geometry.getAttribute("position").count;
      assert.ok(count > 900, `${part.label} keeps its surface (${count} vertices)`);
    }
    const rig = skinCharacter(built);
    try {
      const bones = new Map<string, number>();
      for (const bone of rig.skeleton.bones) {
        const region: unknown = bone.userData["region"];
        if (typeof region === "string") bones.set(region, (bones.get(region) ?? 0) + 1);
      }
      for (const { part } of built.parts.values())
        assert.equal(bones.get(part.id), part.label === "body" ? 1 : 3, `${part.label} joints`);
    } finally {
      rig.dispose();
    }
  });
});
