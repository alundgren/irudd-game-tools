import test from "node:test";
import assert from "node:assert/strict";
import { studies } from "../examples/studies.js";
import { startingForm, validateForm } from "./recipe.js";
import { compactForm, applyOperations } from "./variations.js";
import { copyBranch, removePart } from "./parts.js";
import { extractComponent, placeBranch, placeComponent } from "./graft.js";

function sample() {
  const base = studies.find((s) => s.id === "carapace").make();
  const carrier = base.parts[0];
  const form = {
    ...startingForm(() => 0.5),
    parts: [
      carrier,
      {
        id: "peg",
        shape: "box",
        size: [0.1, 0.1, 0.1],
        position: [0, 1, 0],
        rotation: [0, 0, 0],
        color: "#999999",
      },
    ],
  };
  const action = {
    op: "growPlateField",
    id: carrier.id,
    rows: 3,
    columns: 3,
    seed: 86,
    tipSeed: 17,
    face: "Left",
  };
  const grown = applyOperations(form, [action]);
  return {
    form,
    action,
    carrier,
    grown,
    plate: grown.parts.find((p) => p.plateSite),
  };
}

test("a proposed plate field replays and sends detailed geometry only for the selected site", () => {
  const { form, action, grown, plate } = sample();
  validateForm(grown);
  assert.deepEqual(
    applyOperations(JSON.parse(JSON.stringify(form)), [action]),
    grown,
  );
  const details = compactForm(grown, plate.id).parts.filter((p) => p.plateSite);
  assert.equal(details.filter((p) => p.cage).length, 1);
  assert.deepEqual(details.find((p) => p.id === plate.id).cage, plate.cage);
  assert.ok(
    details
      .filter((p) => p.id !== plate.id)
      .every((p) => p.cageSummary.vertices > 0),
  );
  const duplicate = { ...plate, id: "clashing site" };
  assert.throws(
    () => validateForm({ ...grown, parts: [...grown.parts, duplicate] }),
    /own site/,
  );
});

test("a copied, transferred or detached plate is independent while an entire field retains editable sites", () => {
  const { grown, plate, carrier } = sample();
  const copied = copyBranch(grown, plate.id, false);
  assert.ok(!copied.form.parts.find((p) => p.id === copied.id).plateSite);
  const moved = placeBranch(grown, plate.id, {
    parent: "peg",
    toWorld: [0, 1, 0],
  }).form;
  validateForm(moved);
  assert.ok(!moved.parts.find((p) => p.id === plate.id).plateSite);
  const component = extractComponent(grown, plate.id);
  assert.ok(!component.parts[0].plateSite);
  assert.ok(!extractComponent(grown, carrier.id, false).parts[0].plateGrowth);
  const mirrored = copyBranch(grown, carrier.id, true);
  validateForm(mirrored.form);
  const twin = mirrored.form.parts.find((p) => p.id === mirrored.id);
  assert.equal(twin.plateGrowth.face, "Right");
  assert.equal(twin.plateGrowth.mirrored, true);
  const updated = applyOperations(mirrored.form, [
    { op: "growPlateField", id: twin.id, tipSeed: 100 },
  ]);
  validateForm(updated);
  assert.deepEqual(
    updated.parts.find((p) => p.id === plate.id),
    plate,
  );
  const replaced = placeComponent(grown, extractComponent(grown, "peg"), {
    target: carrier.id,
    mode: "replace",
  }).form;
  validateForm(replaced);
  assert.equal(replaced.parts.filter((p) => p.plateSite).length, 0);
  const pruned = removePart(grown, plate.id);
  const retipped = applyOperations(pruned, [
    { op: "growPlateField", id: carrier.id, tipSeed: 91 },
  ]);
  assert.equal(retipped.parts.filter((p) => p.plateSite).length, 8);
});
