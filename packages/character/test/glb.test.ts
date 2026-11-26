import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalImages, readGlb, writeGlb } from "../src/glb.js";
import { sweepGeometry } from "../src/surfaces/sweep.js";

test("a rewritten GLB keeps its binary chunks byte for byte", () => {
  const bin = new Uint8Array([8, 0, 0, 0, 0x42, 0x49, 0x4e, 0x00, 1, 2, 3, 4, 5, 6, 7, 8]);
  const first = writeGlb({ asset: { version: "2.0" } }, bin);
  const { json, rest } = readGlb(first);
  assert.deepEqual(json, { asset: { version: "2.0" } });
  assert.deepEqual(rest, bin);
  const second = writeGlb({ asset: { version: "2.0", extras: { irudd: { revision: 3 } } } }, rest);
  assert.equal(second.byteLength % 4, 0);
  assert.deepEqual(readGlb(second).json, {
    asset: { version: "2.0", extras: { irudd: { revision: 3 } } },
  });
  assert.deepEqual(readGlb(second).rest, bin);
});

function width(radius: number): number {
  const geometry = sweepGeometry([
    [0, 0, 0, radius, radius],
    [0, 1, 0, radius, radius],
  ]);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  geometry.dispose();
  assert.ok(box);
  return box.max.x - box.min.x;
}

test("a sweep's cross section scales with its knot radii", () => {
  const narrow = width(0.1);
  assert.ok(narrow > 0);
  assert.ok(Math.abs(width(0.2) / narrow - 2) < 1e-9);
});

function glbWith(views: number[][], imageViews: number[]): ReturnType<typeof readGlb> {
  const descriptions: { buffer: 0; byteOffset: number; byteLength: number }[] = [];
  const data: number[] = [];
  for (const bytes of views) {
    while (data.length % 4) data.push(0);
    descriptions.push({ buffer: 0, byteOffset: data.length, byteLength: bytes.length });
    data.push(...bytes);
  }
  while (data.length % 4) data.push(0);
  const rest = new Uint8Array(8 + data.length);
  const header = new DataView(rest.buffer);
  header.setUint32(0, data.length, true);
  header.setUint32(4, 0x004e4942, true);
  rest.set(data, 8);
  return readGlb(
    writeGlb(
      {
        asset: { version: "2.0" },
        buffers: [{ byteLength: data.length }],
        bufferViews: descriptions,
        images: imageViews.map((bufferView) => ({ mimeType: "image/png", bufferView })),
      },
      rest,
    ),
  );
}

test("embedded images take a fixed place whatever order they were encoded in", () => {
  const geometry = [9, 9, 9, 9];
  const [a, b, c] = [[0xa], [0xb, 0xb], [0xc, 0xc, 0xc]];
  const inOrder = glbWith([geometry, a, b, c], [1, 2, 3]);
  const shuffled = glbWith([geometry, c, a, b], [2, 3, 1]);
  const one = canonicalImages(inOrder);
  const two = canonicalImages(shuffled);
  assert.deepEqual(two.json, one.json);
  assert.deepEqual(two.rest, one.rest);
  assert.deepEqual(writeGlb(two.json, two.rest), writeGlb(one.json, one.rest));
  const bin = one.rest.subarray(8);
  const field = (value: unknown, ...keys: Array<string | number>): unknown =>
    keys.reduce<unknown>(
      (v, k) => (typeof v === "object" && v !== null ? Reflect.get(v, k) : undefined),
      value,
    );
  const bytesOf = (image: number): number[] => {
    const view = field(
      one.json,
      "bufferViews",
      Number(field(one.json, "images", image, "bufferView")),
    );
    const offset = Number(field(view, "byteOffset"));
    return [...bin.subarray(offset, offset + Number(field(view, "byteLength")))];
  };
  assert.deepEqual([bytesOf(0), bytesOf(1), bytesOf(2)], [a, b, c]);
  assert.deepEqual(canonicalImages(one), one, "already canonical");
});
