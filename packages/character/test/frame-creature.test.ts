import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createRegistry,
  decodeWith,
  defaultFrameCreatureParams,
  DocumentId,
  emptyState,
  frameCreature,
  memoryEnvironment,
  reduce,
} from "@irudd/document";
import { Vector3 } from "three";
import { isMesh } from "../src/mesh.js";
import { buildCharacter, clayMaterials } from "../src/build.js";

test("the default starter builds each capsule within its declared part dimensions", () => {
  const id = decodeWith(DocumentId, "doc-marsh-walker");
  assert.ok(id.ok);
  const { state, outcome } = reduce(
    emptyState(id.value),
    {
      format: "irudd.command",
      version: 1,
      requestId: "req-new-creature",
      expectedRevision: 0,
      documentId: id.value,
      actor: { kind: "human", id: "artist" },
      command: {
        type: "document.generate",
        label: "Marsh walker",
        generator: frameCreature.id,
        version: frameCreature.version,
        params: defaultFrameCreatureParams,
      },
    },
    memoryEnvironment(createRegistry({ generators: [frameCreature] })),
  );
  assert.equal(outcome.kind, "committed");
  assert.ok(state.document);
  const scene = buildCharacter(state.document, { materials: clayMaterials() });
  try {
    const capsules = [...scene.parts.values()].filter(({ part }) => part.shape === "capsule");
    assert.equal(capsules.length, 6);
    for (const { part, object } of capsules) {
      assert.ok(isMesh(object));
      object.geometry.computeBoundingBox();
      const size = object.geometry.boundingBox?.getSize(new Vector3()).multiply(object.scale);
      assert.ok(size && size.distanceTo(new Vector3(...part.size)) < 1e-6, part.label);
    }
  } finally {
    scene.dispose();
  }
});
