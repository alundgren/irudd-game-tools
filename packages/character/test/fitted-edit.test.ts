import assert from "node:assert/strict";
import { test } from "node:test";
import { Schema } from "effect";
import {
  DocumentId,
  PartId,
  applyOperations,
  createRegistry,
  decodeOperations,
  digestBrand,
  familyFeatures,
  figurePaint,
  type Part,
} from "@irudd/document";
import { paintNudge } from "../src/paint/nudge.js";
import { compareCoverage } from "../src/review/coverage.js";
import { traceRoot } from "../src/paint/trace-build.js";
import { fittedPaintOperations } from "../src/paint/fitted-edit.js";
import { paintedBranch } from "../src/paint/repaint.js";

const size = 64;
const panel = {
  size,
  pixels: new Uint8ClampedArray(size * size * 4).fill(210),
  mask: new Uint8Array(size * size).fill(1),
  mid: 32,
  feet: 63,
  span: 62,
};
const panels = [panel, panel, panel, panel] as const;
const outline = [
  [0.27, 0.1],
  [0.73, 0.1],
  [0.6, 0.9],
  [0.36, 0.9],
] as const;
const asset = {
  digest: digestBrand(`sha256:${"1".repeat(64)}`),
  role: "paint-atlas",
  byteLength: 32,
  mediaType: "image/webp",
} as const;
const reply = { ...asset, digest: digestBrand(`sha256:${"2".repeat(64)}`) };
const doc = traceRoot(Schema.decodeUnknownSync(DocumentId)("doc-test"), "Body", asset, panels, [
  outline,
  outline,
]);
const decodeId = Schema.decodeUnknownSync(PartId);
const registry = createRegistry({ features: familyFeatures });
const part = doc.parts[0];
assert.ok(part);

test("the repainted branch stops at locks and crosses unpainted attachments", () => {
  const branch = (id: string, parent: string, paint = part.paint): Part => ({
    ...part,
    id: decodeId(id),
    parent: decodeId(parent),
    ...(paint ? { paint } : {}),
  });
  const { paint: _paint, ...unpainted } = branch("p-attachment", part.id);
  const rig = {
    ...doc,
    parts: [
      part,
      branch("p-lock", part.id),
      branch("p-hand", "p-lock"),
      unpainted,
      branch("p-sleeve", "p-attachment"),
      branch("p-cuff", "p-sleeve", { atlas: reply.digest }),
    ],
  };
  assert.deepEqual(paintedBranch(rig, part.id, new Set(["p-lock"])), [
    part.id,
    decodeId("p-sleeve"),
  ]);
  assert.deepEqual(paintedBranch(rig, part.id, new Set([part.id])), []);
});

for (const mode of ["whole", "replace", "wear"] as const) {
  for (const coverage of mode === "wear" ? (["open", "closed"] as const) : (["open"] as const)) {
    test(mode + " fits " + coverage + " artwork as one valid edit", () => {
      const map = [{ id: "waistcoat", method: "loft", front: outline, side: outline }];
      const fit = fittedPaintOperations(
        doc,
        mode,
        part,
        reply,
        panels,
        0.6,
        map,
        coverage,
        mode === "wear" ? [part.id] : [],
      );
      const decoded = decodeOperations(fit.operations);
      assert.ok(decoded.ok, JSON.stringify(decoded));
      const applied = applyOperations(doc, decoded.value, {
        registry,
        retired: new Set(),
        idFor: decodeId,
      });
      assert.ok(applied.ok, JSON.stringify(applied));
      const out = applied.value;
      assert.ok(out.parts.some((p) => p.paint?.atlas === reply.digest));
      assert.ok(out.assets.some((a) => a.digest === reply.digest));
      if (mode === "wear") {
        assert.deepEqual(
          out.parts.find((p) => p.id === part.id),
          part,
        );
        assert.equal(out.parts.length, coverage === "closed" ? 3 : 2);
        const shell = out.parts.find((p) => p.label === "garment shell");
        if (coverage === "closed") {
          assert.ok(shell);
          assert.equal(shell.parent, part.id);
          assert.equal(figurePaint.read(shell.features)?.region, undefined);
        }
      } else if (mode === "replace") assert.equal(out.parts[0]?.id, part.id);
    });
  }
}

test("painted nudges preserve the source and combine target dimensions and centimetre offsets", () => {
  const moved = paintNudge(doc, part.id, { width: 10, forward: 5, lift: -2, yaw: 10 });
  assert.equal(moved.operations.length, 1);
  const next = moved.document.parts.find((p) => p.id === part.id);
  assert.ok(next);
  assert.equal(next.size[0], part.size[0] * 1.1);
  assert.equal(next.position[2], part.position[2] + 0.05);
  assert.notDeepEqual(next.rotation, part.rotation);
  assert.equal(paintNudge(doc, part.id, {}).document, doc);
});

test("coverage compares aligned masks and skips unmatched motion or resolution", () => {
  const labels = [
    { name: "jacket", bare: false, outer: true },
    { name: "arm", bare: true, outer: false },
  ];
  const shot = (piece: number) => new Uint8Array(4).fill(piece);
  const before = { resolution: 2, labels, masks: [shot(1), shot(1), shot(1), shot(1)] };
  const after = { resolution: 2, labels, masks: [shot(2), shot(2), shot(2), shot(2)] };
  assert.equal(compareCoverage(before, after, true).length, 4);
  assert.deepEqual(
    compareCoverage(before, after, false),
    ["rest front", "rest three-quarter"].map((view) => ({
      view,
      garment: "jacket",
      body: "arm",
      pixels: 4,
    })),
  );
  assert.equal(compareCoverage(before, { ...after, resolution: 3 }, true).length, 0);
  assert.equal(
    compareCoverage(before, { ...after, masks: [new Uint8Array(1), shot(2)] }, true).length,
    1,
  );
});
