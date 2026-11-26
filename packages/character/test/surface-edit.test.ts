import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  createRegistry,
  decodeWith,
  Operations,
  familyFeatures,
  figureHand,
  figureMarkings,
  figureSweep,
  outfitWear,
  readDocument,
  requireDeclaredFeatures,
} from "@irudd/document";
import {
  addDetail,
  blendable,
  bodyCoatPart,
  copyDetailBranch,
  detailShapes,
  finishPart,
  fitAccessory,
  paintParts,
  removeDetailBranch,
} from "../src/surface-edit.js";
import { buildCharacter, clayMaterials } from "../src/build.js";
import { viewPart } from "../src/view.js";
import { fitSweptHand } from "../src/surfaces/fit-hand.js";

const registry = createRegistry({ features: familyFeatures });
const read = readDocument(
  JSON.parse(
    readFileSync(
      new URL("../../../verification/families/fixtures/field-wardrobe.json", import.meta.url),
      "utf8",
    ),
  ),
  { registry },
);
if (!read.ok) throw new Error(JSON.stringify(read.diagnostics));
const doc = read.value;
test("new detail shapes build, including a registered face with an accessory pivot", () => {
  const head = addDetail(undefined, "head"),
    stud = addDetail(head, "ellipsoid");
  const parts = [
    head,
    stud,
    ...detailShapes.filter((s) => s !== "head").map((s) => addDetail(head, s)),
  ];
  const next = requireDeclaredFeatures({ ...doc, features: {}, parts }, registry);
  const parsed = readDocument(next, { registry });
  assert.ok(parsed.ok, parsed.ok ? "" : JSON.stringify(parsed.diagnostics));
  const built = buildCharacter(next, { materials: clayMaterials() });
  try {
    assert.equal(built.parts.size, parts.length);
    assert.ok(fitAccessory(built, head.id, stud.id).every(Number.isFinite));
    assert.throws(() => fitAccessory(built, stud.id, head.id));
  } finally {
    built.dispose();
  }
});
test("mirrored branches preserve the attachment tree, reverse knots and switch handedness", () => {
  const root = addDetail(undefined, "sweep"),
    child = addDetail(root, "hand");
  const mirrored = copyDetailBranch({ ...doc, parts: [child, root] }, root, true),
    [other, hand] = mirrored;
  assert.ok(other && hand);
  assert.equal(hand.parent, other.id);
  assert.notEqual(other.id, root.id);
  assert.equal(figureSweep.read(other.features)?.knots.at(-1)?.[0], -0.04);
  assert.equal(figureHand.read(hand.features)?.side, -1);
  assert.equal(figureHand.read(child.features)?.side, 1);
});
test("material edits retain outfit visibility and marking draws share a repeatable seed", () => {
  const bare = addDetail(undefined, "ellipsoid");
  const part = {
    ...bare,
    features: {
      ...bare.features,
      [outfitWear.id]: outfitWear.json({ bare: true, visibleIn: ["Work clothes"] }),
    },
  };
  assert.deepEqual(finishPart(part, "#abcd12", "fur", "tail", "rigid")[2], {
    op: "feature.set",
    feature: "outfit.wear",
    part: part.id,
    value: { bare: true, visibleIn: ["Work clothes"], role: "tail" },
  });
  assert.ok(blendable(viewPart(part)));
  assert.ok(!bodyCoatPart(viewPart({ ...part, label: "Eye" })));
  const mark = {
    kind: "Bands",
    color: "#123456",
    angle: 42,
    spacing: 0.2,
    coverage: 0.5,
    seed: 17,
  } as const;
  assert.deepEqual(paintParts([part], mark)[0]?.value, figureMarkings.json(mark));
});
test("fitting a swept hand preserves its children and creates a fitted grip at the wrist", () => {
  const parent = addDetail(undefined, "ellipsoid"),
    sweep = addDetail(parent, "sweep");
  const hand = {
      ...sweep,
      features: { ...sweep.features, [outfitWear.id]: outfitWear.json({ role: "hand" }) },
    },
    child = addDetail(hand, "box");
  const built = buildCharacter(
    { ...doc, features: {}, parts: [parent, hand, child] },
    { materials: clayMaterials() },
  );
  try {
    const ops = fitSweptHand(built, hand);
    const checked = decodeWith(Operations, ops);
    assert.ok(checked.ok, checked.ok ? "" : JSON.stringify(checked.diagnostics));
    assert.ok(ops.some((o) => "feature" in o && o.feature === figureHand.id));
    assert.ok(ops.some((o) => o.op === "part.set" && o.part === child.id));
  } finally {
    built.dispose();
  }
});

test("removing a styled branch cleans its layer and saved outfit references in the same edit", () => {
  const body = addDetail(undefined, "ellipsoid"),
    cape = addDetail(body, "sweep");
  const layers = { [body.id]: { show: true }, [cape.id]: { dye: "#abcdef" } };
  const next = {
    ...doc,
    parts: [body, cape],
    features: {
      "outfit.layers": { layers },
      "outfit.looks": { looks: [{ name: "Travel", base: "Work clothes", layers }] },
    },
  };
  assert.deepEqual(removeDetailBranch(next, cape), [
    {
      op: "feature.set",
      feature: "outfit.layers",
      value: { layers: { [body.id]: { show: true } } },
    },
    {
      op: "feature.set",
      feature: "outfit.looks",
      value: {
        looks: [{ name: "Travel", base: "Work clothes", layers: { [body.id]: { show: true } } }],
      },
    },
    { op: "part.remove", part: cape.id, cascade: true },
  ]);
  assert.throws(() => removeDetailBranch(next, body));
});
