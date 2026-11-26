import assert from "node:assert/strict";
import { test } from "node:test";
import { exportCharacter, inspectGlb } from "@irudd/character";
import { installNodeExporter } from "../src/node-exporter.js";
import { readFixture } from "../src/run.js";

test("a clay export's summary accounts for every triangle by region and material", async () => {
  installNodeExporter();
  const doc = readFixture("marsh-tripod");
  const { bytes } = await exportCharacter(doc, { preset: "clay", revision: 2, build: "test" });
  const summary = inspectGlb(bytes);
  assert.ok(summary.triangles > 0);
  const byRegion = Object.values(summary.regions).reduce((n, t) => n + t, 0);
  const byMaterial = summary.materials.reduce((n, m) => n + m.triangles, 0);
  assert.equal(byRegion, summary.triangles);
  assert.equal(byMaterial, summary.triangles);
  assert.deepEqual(
    Object.keys(summary.regions).sort(),
    [...new Set(doc.parts.map((p) => p.label))].filter((l) => l in summary.regions).sort(),
  );
  assert.ok(summary.joints.every((j) => j.part === null || doc.parts.some((p) => p.id === j.part)));
  assert.ok(typeof summary.provenance === "object" && summary.provenance !== null);
  assert.equal(Reflect.get(summary.provenance, "preset"), "clay");
  assert.equal(Reflect.get(summary.provenance, "revision"), 2);
  assert.ok(summary.bounds && (summary.bounds.max[1] ?? 0) > (summary.bounds.min[1] ?? 0));
});
