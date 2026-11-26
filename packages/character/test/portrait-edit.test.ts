import assert from "node:assert/strict";
import { test } from "node:test";
import { Schema } from "effect";
import { DocumentId, digestBrand, figurePaint } from "@irudd/document";
import { traceRoot } from "../src/paint/trace-build.js";
import { appendLandmarks, landmarkPass, profileFromMarks } from "../src/paint/portrait-edit.js";

test("alignment fixes the two anchors and scales the remaining portrait correction", () => {
  const pass = landmarkPass(
    [
      [-0.2, 0.1, 0],
      [0.2, 0.1, 0],
      [0, 0, 0],
    ],
    [
      [0.3, 0.4],
      [0.7, 0.4],
      [0.5, 0.6],
    ],
    1,
  );
  assert.ok(Math.abs((pass.pins[2]?.shift[1] ?? 1) + 0.1) < 1e-8);
  assert.deepEqual(pass.pins[0]?.shift, [0, 0]);
  assert.throws(
    () =>
      appendLandmarks(
        Array.from({ length: 6 }, () => pass),
        pass,
      ),
    /six/,
  );
  assert.throws(() => landmarkPass([], [], 1), /matching/);
});

test("profile corrections use picture aspect, facing and descending heights", () => {
  const right = profileFromMarks(
    [
      [0.4, 0.2],
      [0.6, 0.4],
      [0.5, 0.6],
      [0.4, 0.8],
    ],
    "right",
    1.5,
  );
  const left = profileFromMarks(
    [
      [0.6, 0.2],
      [0.4, 0.4],
      [0.5, 0.6],
      [0.6, 0.8],
    ],
    "left",
    1.5,
  );
  assert.deepEqual(left, right);
  assert.throws(
    () =>
      profileFromMarks(
        [
          [0, 0],
          [0.3, 0.5],
          [0.1, 0.2],
          [0.2, 0.8],
        ],
        "right",
        1,
      ),
    /downwards/,
  );
});

test("the first hand-traced region owns its sheet and can anchor further tracing", () => {
  const size = 48;
  const panel = {
    size,
    pixels: new Uint8ClampedArray(size * size * 4).fill(255),
    mask: new Uint8Array(size * size).fill(1),
    mid: 24,
    feet: 47,
    span: 46,
  };
  const outline = [
    [0.27, 0.2],
    [0.73, 0.2],
    [0.63, 0.8],
    [0.36, 0.8],
  ] as const;
  const asset = {
    digest: digestBrand(`sha256:${"1".repeat(64)}`),
    role: "paint-atlas",
    byteLength: 32,
    mediaType: "image/png",
  } as const;
  const doc = traceRoot(
    Schema.decodeUnknownSync(DocumentId)("doc-traced"),
    "Body",
    asset,
    [panel, panel, panel, panel],
    [outline, outline],
  );
  const root = doc.parts[0];
  assert.ok(root);
  assert.equal(doc.parts.length, 1);
  assert.equal(root.parent, null);
  assert.equal(root.paint?.atlas, asset.digest);
  assert.deepEqual(doc.assets, [asset]);
  const binding = figurePaint.read(root.features);
  assert.equal(binding?.region, "Body");
  assert.equal(binding?.height, 1.72);
  assert.ok((binding?.rest.length ?? 0) > 2);
});
