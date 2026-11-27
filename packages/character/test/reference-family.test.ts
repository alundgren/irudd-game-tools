import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Vector3 } from "three";
import { boneNames } from "../src/human/catalogue.js";
import { studioFit } from "../src/human/studio-fit.js";
import { studioMeshes } from "../src/human/studio.js";
import { refineFaceForm } from "../src/human/anatomy.js";
import { smoothHumanSurface } from "../src/human/smooth.js";
import { decodeWith, humanFineHead } from "@irudd/document";
import { loadHumanPacks, evaluateHuman } from "../src/human/index.js";
import {
  regionAt,
  alignReference,
  referenceTree,
  encodeHeadLayer,
  fitLandmarks,
  fitSurface,
  fittingSkin,
  readProportion,
  proportionReadings,
  fitMarkedProportions,
} from "../src/human/reference.js";
import { fitTarget } from "../src/human/fit-target.js";
import { applyHeadLayer } from "../src/human/fine-head.js";
import { registerFamily, wrapFamilyMember } from "../src/human/family-registration.js";
import { createMask, hideBeyond, maskedIndices, undoMask } from "../src/human/reference-mask.js";

const body = await loadHumanPacks((file) =>
  readFileSync(new URL("../assets/human/" + file, import.meta.url)),
);
test("fine head displacements round-trip in the local skin frame and follow a changed stature", () => {
  const s = evaluateHuman(body, { height: 1.7 });
  const v = s.boneIndices.findIndex((_, i) => i % 4 === 0 && regionAt(s, i / 4) === "head") / 4;
  assert.ok(v >= 0);
  const offsets = new Float32Array(s.positions.length);
  offsets.set([0.002, 0.001, -0.004], 3 * v);
  const { layer } = encodeHeadLayer(body, s, offsets);
  assert.ok(layer);
  assert.equal(decodeWith(humanFineHead.schema, layer).ok, true);
  assert.equal(
    decodeWith(humanFineHead.schema, { vertices: [v, v], offsets: [0, 0, 1, 0, 0, 1] }).ok,
    false,
  );
  assert.equal(
    decodeWith(humanFineHead.schema, { vertices: [v], offsets: [1100, 1100, 0] }).ok,
    false,
  );
  const moved = applyHeadLayer(body, s, layer);
  assert.ok(
    new Vector3()
      .fromArray(moved.positions, 3 * v)
      .sub(new Vector3().fromArray(s.positions, 3 * v))
      .distanceTo(new Vector3().fromArray(offsets, 3 * v)) < 0.00001,
  );
  for (let i = 0; i < 3 * v; i++) assert.equal(moved.positions[i], s.positions[i]);
  const tall = evaluateHuman(body, { height: 1.98 });
  const delta = new Vector3()
    .fromArray(applyHeadLayer(body, tall, layer).positions, 3 * v)
    .distanceTo(new Vector3().fromArray(tall.positions, 3 * v));
  assert.ok(Math.abs(delta - (1.98 / 1.7) * Math.hypot(0.002, 0.001, 0.004)) < 0.00001);
});
test("Studio Rain follows the browser's jaw surface and exports the artist's eye motion", () => {
  for (const [jaw, xyz] of [
    [-0.8, [0.02389539, -0.05651116, 0.08434172]],
    [0.8, [0.03422397, -0.05619276, 0.08434013]],
  ] as const) {
    const cage = evaluateHuman(body, { height: 1.77, jaw, headWidth: 0.25, nose: -0.5 });
    const skin = refineFaceForm(body, smoothHumanSurface(body, cage));
    const origin = new Vector3().fromArray(cage.joints, 3 * boneNames.indexOf("head")).toArray();
    const parts = studioMeshes(
      body,
      studioFit(body, skin),
      origin,
      "#e2b08e",
      "#5a3d2b",
      true,
      true,
      null,
    );
    const head = parts.find((p) => p.name === "Studio Rain skin"),
      eyes = parts.find((p) => p.name === "Studio Rain eyes");
    assert.ok(head && eyes);
    const actual = new Vector3().fromBufferAttribute(head.geometry.getAttribute("position"), 214);
    assert.ok(actual.distanceTo(new Vector3(...xyz)) < 0.00005, actual.toArray().join(","));
    assert.deepEqual(Object.keys(eyes.morphTargetDictionary ?? {}), [
      "LookLeft",
      "LookRight",
      "LookUp",
      "LookDown",
      "Blink",
    ]);
    assert.deepEqual(Object.keys(head.morphTargetDictionary ?? {}), ["Blink", "Smile", "BrowLift"]);
    for (const piece of parts) {
      piece.geometry.dispose();
      piece.material.dispose();
    }
  }
});
test("a registered triangle follows the corresponding vertices of a family member", () => {
  const positions = Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
    indices = Uint32Array.of(0, 1, 2);
  const mesh = { positions, indices };
  const registered = registerFamily(mesh, mesh);
  const member = { positions: Float32Array.of(0, 0, 0.2, 1, 0, 0.5, 0, 1, -0.5), indices };
  const wrapped = wrapFamilyMember(registered, member, 0);
  assert.deepEqual(wrapped, member.positions);
  assert.throws(() =>
    wrapFamilyMember(registered, { positions: positions.subarray(0, 6), indices }),
  );
  const nearest = referenceTree(mesh).nearest(new Vector3(0.25, 0.25, -0.1));
  assert.ok(
    nearest && Math.abs(nearest.signed + 0.1) < 1e-6 && Math.abs(nearest.weights.x - 0.5) < 1e-6,
  );
});
test("alignment converts a Z-up body in centimetres and registered head landmarks determine a similarity", () => {
  const sample = {
    positions: Float32Array.of(10, 0, 0, 10, 0, 175, 10, 20, 155),
    indices: Uint32Array.of(0, 1, 2),
  };
  const placed = alignReference(sample, {
    units: "cm",
    up: "z",
    turn: "0",
    nudge: [0.01, 0.02, 0.03],
  });
  assert.equal(placed.report.stature, 1.75);
  assert.ok(Math.abs((placed.positions[1] ?? 0) - 0.02) < 1e-6);
  const registration = fitLandmarks(
    [
      [0, 0, 0],
      [1, 0, 0],
      [0.5, -1, 0],
    ],
    [
      [1, 2, 3],
      [3, 2, 3],
      [2, 0, 3],
    ],
  );
  assert.ok(Math.abs(registration.scale - 2) < 1e-8 && registration.rmsMm < 1e-8);
});
test("hiding a head scan area leaves the original topology available for undo", () => {
  const mask = createMask(14),
    positions = new Float32Array(126),
    indices = Uint32Array.from({ length: 42 }, (_, i) => i);
  for (let v = 36; v < 42; v++) positions[3 * v + 1] = 2;
  assert.equal(hideBeyond(mask, positions, indices, [0, 1, 0], [0, 1, 0]), 2);
  assert.equal(maskedIndices(mask, indices).shown.length, 36);
  assert.throws(
    () => hideBeyond(mask, positions, indices, [0, -1, 0], [0, 1, 0]),
    /whole reference/,
  );
  assert.equal(undoMask(mask), 2);
  assert.deepEqual(maskedIndices(mask, indices).shown, indices);
});

test("partial scans ignore the open rim and keep a measured interior correspondence", () => {
  const square = {
    positions: Float32Array.of(0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0),
    indices: Uint32Array.of(0, 1, 2, 0, 2, 3),
  };
  const t = fitTarget(square, true),
    normal = new Vector3(0, 0, 1);
  assert.ok(t.observedDirection?.equals(normal));
  assert.ok(t.query(new Vector3(0.5, 0.5, 0.02), normal, 0.1));
  assert.equal(t.query(new Vector3(-0.01, 0.5, 0.02), normal, 0.1), null);
  assert.throws(() => referenceTree({ ...square, indices: Uint32Array.of(0, 0, 0) }), /usable/);
});
test("regional fitting a coincident mesh adds no displacement to an unedited adult", () => {
  const adult = { human: { height: 1.72 } },
    s = fittingSkin(body, adult);
  const mesh = {
    positions: s.positions,
    indices: Uint32Array.from(s.indices.subarray(0, s.bodyTriangles * 3)),
  };
  const fit = fitSurface(body, adult, mesh, "arms", {
    measurements: false,
    headOnly: false,
    keepEyes: false,
    contours: false,
  });
  assert.ok(fit.fitted > 20);
  assert.ok(fit.metrics);
  assert.ok(fit.metrics.after.meanMm < 0.001);
  assert.equal(fit.adult.corrections?.controls.length, 0);
  assert.deepEqual(fit.adult.human, adult.human);
});
test("proportion solver preserves unticked measurements and moves the marked width closer", () => {
  const start = { human: { height: 1.72, nose: 0.2 } };
  const readings = proportionReadings(body, start),
    width = readings.get("noseWidth");
  assert.ok(width);
  const target = width + 3;
  const result = fitMarkedProportions(body, start, new Map([["noseWidth", target]]), [
    "nostrilWidth",
  ]);
  assert.ok(result.changed);
  assert.equal(result.form.human.nose, 0.2);
  assert.ok(Math.abs((proportionReadings(body, result.form).get("noseWidth") ?? 0) - target) < 3);
  assert.equal(
    readProportion("eyeSlant", new Vector3(0.02, 0.1, 0), new Vector3(0.04, 0.105, 0.08)).toFixed(
      1,
    ),
    "5.0",
  );
});
