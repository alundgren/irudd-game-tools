import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { GlbError, summarizeGlb } from "../src/glb.js";

function glb(json: unknown): Uint8Array {
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const padded = Math.ceil(encoded.length / 4) * 4;
  const out = new Uint8Array(20 + padded).fill(0x20);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, padded, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(encoded, 20);
  return out;
}

test("a workshop export's provenance is read from asset.extras.irudd", () => {
  const summary = summarizeGlb(
    glb({
      asset: {
        version: "2.0",
        generator: "THREE.GLTFExporter",
        extras: {
          irudd: {
            format: "irudd.export",
            version: 1,
            document: "doc-a",
            digest: "sha256:" + "0".repeat(64),
            revision: 4,
            build: "abc",
            preset: "clay",
          },
        },
      },
      scenes: [{ name: "Scene" }],
      nodes: [{}, {}],
      animations: [{ name: "Walk" }, {}],
    }),
  );
  assert.equal(summary.provenance?.revision, 4);
  assert.deepEqual(summary.animations, ["Walk", "Clip 2"]);
  assert.equal(summary.nodes, 2);
});

test("a GLB without a recipe has no provenance but still summarises", () => {
  const summary = summarizeGlb(glb({ asset: { version: "2.0" }, meshes: [{}] }));
  assert.equal(summary.provenance, undefined);
  assert.equal(summary.meshes, 1);
});

test("files that are not GLB are refused with a readable error", () => {
  assert.throws(
    () => summarizeGlb(new TextEncoder().encode("not a model at all, sorry")),
    GlbError,
  );
});

test("every tracked example GLB summarises", () => {
  const names = ["fen-crown", "festival-conductor", "glassgrass-eel"];
  for (const name of names) {
    const bytes = new Uint8Array(
      readFileSync(new URL(`../../../examples/${name}.glb`, import.meta.url)),
    );
    const summary = summarizeGlb(bytes);
    assert.ok(summary.meshes > 0, name);
  }
});
