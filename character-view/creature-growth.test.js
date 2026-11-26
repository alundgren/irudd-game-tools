import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCreature,
  freeCreaturePlan,
  randomCreaturePlan,
  rebuildCreature,
  steerCreaturePlan,
} from "./creature-plan.js";
import { applyOperations } from "./variations.js";
import { validateForm } from "./recipe.js";
import { Mesh, MeshStandardMaterial } from "three";
import { cageGeometry } from "./control-cage.js";
import { featherChart, finishContourFeather } from "./creature-plumage.js";
import { growPlateField } from "./plate-growth.js";

const organ = (p) => p.plateSite || /gill fan|drum sac|ruff lock/.test(p.id);

test("consecutive body draws combine selectable coats with distinct body plans", () => {
  const plans = Array.from({ length: 60 }, (_, n) =>
    randomCreaturePlan(8700 + n),
  );
  assert.equal(new Set(plans.map((p) => JSON.stringify(p.spine))).size, 60);
  const families = new Set(plans.map((p) => p.back.kind));
  for (const f of ["shingles", "gill fans", "drum sacs", "shag mantle"])
    assert.ok(families.has(f));
  for (const p of plans) {
    const f = validateForm(buildCreature(p));
    assert.deepEqual(buildCreature(f.origin.plan), f);
    const regions = f.parts.filter(organ);
    if (p.back.kind === "shingles") {
      assert.ok(regions.length >= 12);
      assert.equal(
        f.parts.find((r) => r.id === "body").plateGrowth.overlap,
        0.62,
      );
      assert.ok(
        regions.every((r) => r.surface === "horn" && r.parent === "body"),
      );
    }
    if (p.back.kind === "shag mantle") {
      const undercoat = f.parts.find((part) => part.surface === "fur");
      assert.ok(undercoat);
      assert.ok(
        regions.every((r) => r.fibres?.rooted && r.parent === undercoat.id),
      );
    }
    if (p.back.kind === "gill fans")
      assert.equal(regions.length, p.back.count * 2);
    if (p.back.kind === "drum sacs")
      assert.equal(regions.length, p.back.count * 4);
  }
});

test("the body-plan operation rerolls local growth and preserves every independent region", () => {
  for (const seed of [8710, 8713, 8716, 8720]) {
    const src = buildCreature(freeCreaturePlan(seed));
    const result = validateForm(
      applyOperations(src, [
        { op: "steerCreature", set: { back: { seed: 34013 } } },
      ]),
    );
    assert.notDeepEqual(result.parts.filter(organ), src.parts.filter(organ));
    const unaffected = (p) => !organ(p) && p.id !== "body";
    assert.deepEqual(
      result.parts.filter(unaffected),
      src.parts.filter(unaffected),
    );
  }
});

test("steering a grown shingle plan retains a sculpt, tip override and attached region", () => {
  const base = buildCreature(freeCreaturePlan(8720));
  const plate = base.parts.find((p) => p.plateSite).id;
  const edited = growPlateField(base, plate, { tipSeed: 19 }).form;
  const shell = edited.parts.find((p) => p.id === plate);
  shell.position[0] += 0.032;
  shell.color = "#8c542e";
  edited.parts.push({
    id: "ornament",
    parent: plate,
    shape: "ellipsoid",
    size: [0.02, 0.02, 0.02],
    color: "#557799",
    position: [0, 0, 0],
    rotation: [0, 0, 0],
  });
  const plan = steerCreaturePlan(base.origin.plan, {
    back: { seed: 577, height: 0.23 },
  });
  const plain = buildCreature(plan);
  const result = validateForm(rebuildCreature(edited, plan));
  const sunk = result.parts.find((p) => p.id === plate);
  assert.equal(sunk.plateSite.tipSeed, 19);
  assert.ok(
    Math.abs(
      sunk.position[0] -
        plain.parts.find((p) => p.id === plate).position[0] -
        0.032,
    ) < 1e-7,
  );
  assert.equal(sunk.color, "#8c542e");
  assert.equal(result.parts.find((p) => p.id === "ornament").parent, plate);
});

test("contour plumage keeps editable vanes and their shaft colours after a plan round trip", () => {
  const plan = steerCreaturePlan(freeCreaturePlan(8720), {
    back: { kind: "contour plumage", count: 4, seed: 19 },
  });
  const form = validateForm(buildCreature(plan));
  const saved = JSON.parse(JSON.stringify(form));
  const feathers = saved.parts.filter(p => p.contourFeather);
  assert.ok(feathers.length >= 12 && saved.parts.length <= 128);
  assert.deepEqual(buildCreature(saved.origin.plan).parts.filter(p => p.contourFeather), feathers);
  const vane = feathers[0];
  vane.cage.vertices[5][1] += 0.07;
  const rebuilt = validateForm(rebuildCreature(saved, saved.origin.plan));
  const edited = rebuilt.parts.find(p => p.id === vane.id);
  assert.deepEqual(edited.cage.vertices, vane.cage.vertices);
  const mesh = new Mesh(cageGeometry(edited.cage, featherChart(edited)));
  const material = new MeshStandardMaterial({vertexColors: true});
  finishContourFeather(mesh, edited, material);
  assert.equal(mesh.material, material);
  const { color, position, uv } = mesh.geometry.attributes;
  assert.equal(color.count, position.count);
  assert.ok(uv.array.every(v => v >= 0 && v <= 1));
  assert.ok(Math.max(...color.array) - Math.min(...color.array) > 0.1);
  mesh.geometry.dispose();
  material.dispose();
});
