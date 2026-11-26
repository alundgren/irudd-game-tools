import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  createRegistry,
  familyFeatures,
  readDocument,
  decodeOperations,
  applyOperations,
  figureSweep,
  figureLocations,
  figurePulls,
  figurePlateSite,
  figureCage,
  type CharacterDocument,
} from "@irudd/document";
import { pleat, splitHem } from "../src/surfaces/drapery.js";
import { sweepGeometry } from "../src/surfaces/sweep.js";
import { buildView } from "../src/view.js";
import { addDetail } from "../src/surface-edit.js";
import {
  arrangePlates,
  cageFace,
  drawAppendage,
  graftBranch,
  markLocation,
  moveControl,
  pullPart,
  resizeCharacter,
} from "../src/shape-tools.js";
const registry = createRegistry({ features: familyFeatures });
const result = readDocument(
  JSON.parse(
    readFileSync(
      new URL("../../../verification/families/fixtures/field-wardrobe.json", import.meta.url),
      "utf8",
    ),
  ),
  { registry },
);
if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
const source = result.value;
function apply(doc: CharacterDocument, raw: readonly object[]) {
  const ops = decodeOperations(raw);
  assert.ok(ops.ok, JSON.stringify(ops));
  const next = applyOperations(doc, ops.value, {
    registry,
    retired: new Set(),
    idFor: () => {
      throw new Error("unexpected generation");
    },
  });
  assert.ok(next.ok, JSON.stringify(next));
  const loaded = readDocument(next.value, { registry });
  assert.ok(loaded.ok, JSON.stringify(loaded));
  return loaded.value;
}
test("drawn curves, named locations and pulls survive document validation at part-local coordinates", () => {
  const root = source.parts[0];
  assert.ok(root);
  const path = drawAppendage(
    root,
    [
      [0, 0, 0],
      [0.08, 0.12, 0],
      [0, 0.25, 0.1],
    ],
    "Tail",
    0.04,
    "#956a48",
  );
  let doc = apply(source, [
    { op: "part.add", part: path },
    markLocation(root, "Ear", [0.1, 0, 0]),
    pullPart(root, [0.1, 0, 0], [0, 0.05, 0], [0.12, 0.12, 0.12]),
  ]);
  const host = doc.parts.find((p) => p.id === root.id);
  assert.ok(host);
  assert.deepEqual(figureLocations.read(host.features)?.marks[0]?.at, [0.1, 0, 0]);
  assert.equal(figurePulls.read(host.features)?.pulls.length, 1);
  doc = apply(doc, [moveControl(path, "Spine", 1, [0.08, 0.1, 0])]);
  const moved = doc.parts.find((p) => p.id === path.id);
  assert.ok(moved);
  assert.deepEqual(figureSweep.read(moved.features)?.knots[1]?.slice(0, 3), [0.08, 0.1, 0]);
  assert.throws(() =>
    drawAppendage(
      root,
      [
        [0, 0, 0],
        [0, 0, 0],
      ],
      "Horn",
      0.04,
      "#987654",
    ),
  );
});
test("a pleated sweep opens below the slit and keeps finite front and lining surfaces", () => {
  const carrier = addDetail(undefined, "sweep");
  const sweep = figureSweep.read(carrier.features);
  assert.ok(sweep);
  const drape = { folds: 8, depth: 0.12, twist: 0.2, slit: 0.2, slitHeight: 0.6 };
  const base = sweepGeometry(sweep.knots);
  const original = base.getAttribute("position").array.slice();
  const folded = pleat(base, sweep.knots, drape);
  assert.notDeepEqual(folded.getAttribute("position").array, original);
  const hem = splitHem(folded, sweep.knots, drape);
  assert.ok(hem.getAttribute("position").count > folded.getAttribute("position").count);
  assert.ok(hem.getAttribute("normal").array.every(Number.isFinite));
  assert.ok(hem.getAttribute("position").array.every(Number.isFinite));
  const bands = (sweep.knots.length - 1) * 5;
  const panelStride = 6;
  const adjacent = 2 * (bands + 1) * panelStride;
  const uv = hem.getAttribute("uv");
  assert.ok(uv.getX(adjacent) - uv.getX(panelStride - 1) > 0.19);
  assert.equal(uv.getX(adjacent + bands * 11), uv.getX((bands + 1) * panelStride - 1));
  hem.dispose();
});
test("adjusting a plate field reuses occupied sites and preserves unrelated parts", () => {
  const carrier = addDetail(undefined, "sweep");
  let doc = apply(source, [{ op: "part.add", part: carrier }]);
  doc = apply(doc, arrangePlates(doc, carrier.id, 4, 3, "Back", "#a78e68", true));
  assert.doesNotThrow(() => buildView(doc));
  const ids = doc.parts.filter((p) => p.parent === carrier.id).map((p) => p.id);
  assert.equal(ids.length, 12);
  doc = apply(doc, arrangePlates(doc, carrier.id, 2, 3, "Left", "#876534", true));
  const kept = doc.parts.filter((p) => p.parent === carrier.id);
  assert.equal(kept.length, 6);
  assert.ok(kept.every((p) => ids.includes(p.id) && figurePlateSite.read(p.features)));
  doc = apply(doc, arrangePlates(doc, carrier.id, 2, 1, "Front", "#665544", false));
  assert.equal(doc.parts.length, source.parts.length + 9);
});
test("graft remaps descendants, cage edits preserve valid faces, and resize keeps the attachment basis", () => {
  const root = source.parts[0];
  assert.ok(root);
  const cage = addDetail(root, "cage"),
    child = addDetail(cage, "scute");
  let donor = apply(source, [
    { op: "part.add", part: cage },
    { op: "part.add", part: child },
  ]);
  assert.ok(apply(donor, [cageFace(cage, 0, "Tunnel", 0.3, 1)]));
  donor = apply(donor, [cageFace(cage, 1, "Inset", 0.25)]);
  const selected = donor.parts.find((p) => p.id === cage.id);
  assert.ok(selected);
  assert.equal(figureCage.read(selected.features)?.faces.length, 10);
  const doc = apply(source, graftBranch(donor, selected, source, root, [0.1, 0.3, 0]));
  const graft = doc.parts.find(
    (p) => p.parent === root.id && p.position[1] === 0.3 && p.label === selected.label,
  );
  assert.ok(graft);
  assert.ok(doc.parts.some((p) => p.parent === graft.id));
  assert.notEqual(graft.id, cage.id);
  assert.equal(apply(doc, resizeCharacter(doc, 2, 2.1)).parts.length, doc.parts.length);
});
