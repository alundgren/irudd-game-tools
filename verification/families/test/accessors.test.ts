import assert from "node:assert/strict";
import { test } from "node:test";
import { accessorValues } from "../src/glb.js";

test("parity refuses non-finite mesh values before comparing numeric tolerances", () => {
  const bytes = new Uint8Array(12);
  const glb = {
    bin: new DataView(bytes.buffer),
    binBytes: bytes,
    json: {
      accessors: [{ bufferView: 0, componentType: 5126, type: "VEC3", count: 1 }],
      bufferViews: [{ byteLength: 12 }],
    },
  };
  for (const invalid of [NaN, Infinity, -Infinity]) {
    glb.bin.setFloat32(4, invalid, true);
    assert.throws(() => accessorValues(glb, 0), /Accessor 0, element 0, component 1 is non-finite/);
  }
  glb.bin.setFloat32(4, 1.5, true);
  assert.deepEqual([...accessorValues(glb, 0)], [0, 1.5, 0]);
});
