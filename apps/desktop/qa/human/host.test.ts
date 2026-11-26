// The ordinary adult through a real workshop host, as the desktop app hosts it:
// the person starts the adult from its starter, moves a forearm by hand, a
// paired agent proposes thicker muscle as a parameter steer, the person
// accepts, and a fresh export of the new revision still carries the hand edit.
// The starter's seed-491 parameters are the seeded draw that
// verification/families/test/human-clay.test.ts holds equal to G0's export,
// and its look-491 preset the dressed look that
// verification/families/test/human-tailor.test.ts holds equal to G0's.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { exportCharacter } from "@irudd/character";
import { dressedAdult, humanSlot, look491, seededHumanAdult } from "@irudd/character/human";
import { connect } from "@irudd/workshop/client";
import { startHost } from "@irudd/workshop/host";
import type { CommandRequest } from "@irudd/workshop";
import type { MethodResults } from "@irudd/workshop/wire";
import { humanHosting } from "../../src/main/human.js";

// Three's GLTFExporter reads its buffers through the browser's FileReader; the
// desktop exports in its review worker. Under Node this test provides the one
// read the clay preset needs.
class NodeFileReader {
  result: ArrayBuffer | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }
}
if (!("FileReader" in globalThis))
  Object.defineProperty(globalThis, "FileReader", { value: NodeFileReader, configurable: true });

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const assets = path.join(repository, "packages", "character", "assets");
const person = { kind: "human", id: "tester", name: "Tester" } as const;
const documentId = "doc-adult-host";

let counter = 0;
const request = (expectedRevision: number, command: CommandRequest["command"]): CommandRequest => ({
  format: "irudd.command",
  version: 1,
  requestId: `req-adult-${process.pid}-${(counter += 1).toString().padStart(4, "0")}`,
  documentId,
  expectedRevision,
  command,
});
const committed = (result: MethodResults["apply"]): number => {
  assert.equal(result.kind, "committed", JSON.stringify(result));
  return result.kind === "committed" ? result.receipt.revision : -1;
};

test("an adult started on the desktop host keeps a hand edit through an agent's steer into a fresh export", async () => {
  const loadStarted = performance.now();
  const hosting = await humanHosting(assets);
  const loadMs = performance.now() - loadStarted;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "irudd-adult-"));
  const project = path.join(root, "project"),
    stateDir = path.join(root, "state");
  const host = await startHost({
    path: project,
    stateDir,
    create: { label: "Adult host test" },
    human: person,
    durability: "normal",
    registry: hosting.registry,
    starters: hosting.starters,
  });
  try {
    const human = await connect({ credential: { role: "human", project }, stateDir });
    const offered = await human.call("starters", {});
    const adult = offered.starters.find((s) => s.id === "human-adult");
    assert.ok(adult, "the host offers the adult");
    assert.deepEqual(
      adult.presets.map((p) => p.id),
      [
        "seed-491",
        "seed-8950",
        "seed-8990",
        "seed-716973847",
        "look-491",
        "look-8973",
        "look-8950",
        "look-1",
        "look-42",
        "look-8713",
        "look-9001",
        "look-49027675",
        "look-3782767734",
      ],
    );
    assert.ok(
      offered.starters.some((s) => s.id === "frame-creature"),
      "the workshop's own stay",
    );

    const startStarted = performance.now();
    const started = await human.call("start", {
      documentId,
      requestId: `req-adult-start-${process.pid}`,
      starter: "human-adult",
      preset: "seed-491",
    });
    const startMs = performance.now() - startStarted;
    assert.equal(committed(started.result), 1);
    assert.deepEqual(started.params, seededHumanAdult(hosting.body, 491));

    // The person moves the left forearm by hand.
    const first = await human.call("current", { documentId });
    const forearm = first.document?.parts.find((p) => p.slot === humanSlot("lowerarm_l"));
    assert.ok(forearm, "the forearm is an editable part");
    committed(
      await human.call("apply", {
        request: request(1, {
          type: "edit",
          ops: [{ op: "part.transform", part: forearm.id, translate: [0.02, 0, 0] }],
        }),
      }),
    );

    // A paired agent proposes a parameter steer; the person accepts it.
    const paired = await human.call("pair.agent", { agent: "claude", name: "Claude" });
    const agent = await connect({
      credential: { role: "agent", file: paired.credentialFile },
      stateDir,
    });
    const params = seededHumanAdult(hosting.body, 491);
    const steered = { ...params, human: { ...params.human, muscle: 0.1 } };
    committed(
      await agent.call("apply", {
        request: request(2, {
          type: "proposal.create",
          proposal: "prop-muscle",
          summary: "More muscle",
          content: { kind: "ops", ops: [{ op: "generation.steer", params: steered }] },
        }),
      }),
    );
    assert.equal(
      committed(
        await human.call("apply", {
          request: request(2, { type: "proposal.accept", proposal: "prop-muscle", version: 1 }),
        }),
      ),
      3,
    );

    const current = await human.call("current", { documentId });
    const doc = current.document;
    assert.ok(doc);
    assert.deepEqual(doc.generation?.params, steered, "the steer took");
    const base = doc.generation?.base.slots.find((b) => b.slot === humanSlot("lowerarm_l"));
    const held = doc.parts.find((p) => p.id === forearm.id);
    assert.ok(base && held);
    assert.ok(Math.abs(held.position[0] - base.position[0] - 0.02) < 1e-9, "the hand edit holds");

    const exportStarted = performance.now();
    const fresh = await exportCharacter(doc, {
      preset: "clay",
      revision: current.revision,
      build: "qa",
      human: hosting.body,
    });
    const exportMs = performance.now() - exportStarted;
    assert.equal(fresh.provenance.revision, 3);
    assert.ok(fresh.credits[0]?.includes("MakeHuman"));
    assert.ok(fresh.bytes.byteLength > 1_000_000);
    console.log(
      `  packs ${loadMs.toFixed(0)} ms, start ${startMs.toFixed(0)} ms, export ${exportMs.toFixed(0)} ms`,
    );
    agent.close();
    human.close();
  } finally {
    await host.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/** Triangles of each primitive of the exported "Character surface", read from the GLB's JSON chunk. */
function surfaceTriangles(bytes: Uint8Array): {
  readonly triangles: ReadonlyArray<number>;
  readonly hairCards: ReadonlyArray<boolean>;
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(12, true);
  const json = record(JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))));
  const nodes = list(json["nodes"]).map(record),
    meshes = list(json["meshes"]).map(record),
    accessors = list(json["accessors"]).map(record),
    materials = list(json["materials"]).map(record);
  const node = nodes.find((n) => n["name"] === "Character surface");
  const primitives = list(meshes[Number(node?.["mesh"])]?.["primitives"]).map(record);
  return {
    triangles: primitives.map((p) => Number(accessors[Number(p["indices"])]?.["count"]) / 3),
    hairCards: primitives.map(
      (p) => record(materials[Number(p["material"])]?.["extras"])["hairCards"] === true,
    ),
  };
}
const record = (v: unknown): Readonly<Record<string, unknown>> =>
  typeof v === "object" && v !== null && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v))
    : {};
const list = (v: unknown): ReadonlyArray<unknown> => (Array.isArray(v) ? v : []);

test("a dressed look started on the desktop host keeps a hand edit through an agent's hair and outfit steer", async () => {
  const hosting = await humanHosting(assets);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "irudd-look-"));
  const project = path.join(root, "project"),
    stateDir = path.join(root, "state");
  const host = await startHost({
    path: project,
    stateDir,
    create: { label: "Adult look host test" },
    human: person,
    durability: "normal",
    registry: hosting.registry,
    starters: hosting.starters,
  });
  try {
    const human = await connect({ credential: { role: "human", project }, stateDir });
    const started = await human.call("start", {
      documentId,
      requestId: `req-look-start-${process.pid}`,
      starter: "human-adult",
      preset: "look-491",
    });
    assert.equal(committed(started.result), 1);
    const look = dressedAdult(seededHumanAdult(hosting.body, 491), look491);
    assert.deepEqual(started.params, look);
    const exported = async (revision: number) => {
      const current = await human.call("current", { documentId });
      assert.equal(current.revision, revision);
      assert.ok(current.document);
      const fresh = await exportCharacter(current.document, {
        preset: "clay",
        revision,
        build: "qa",
        human: hosting.body,
      });
      return { doc: current.document, ...surfaceTriangles(fresh.bytes) };
    };
    // Skin, cloth and roots; the pendant's setting and bead; the hair cards; the frames: G0's primitives.
    const first = await exported(1);
    assert.deepEqual(first.triangles, [97595, 968, 80, 10411, 1968]);
    assert.deepEqual(first.hairCards, [false, false, false, true, false]);

    const forearm = first.doc.parts.find((p) => p.slot === humanSlot("lowerarm_l"));
    assert.ok(forearm);
    committed(
      await human.call("apply", {
        request: request(1, {
          type: "edit",
          ops: [{ op: "part.transform", part: forearm.id, translate: [0.02, 0, 0] }],
        }),
      }),
    );
    // The agent proposes a parted fringe, darker hair and four buttons; the person accepts.
    const paired = await human.call("pair.agent", { agent: "claude", name: "Claude" });
    const agent = await connect({
      credential: { role: "agent", file: paired.credentialFile },
      stateDir,
    });
    const layers = (look.style.tailor?.layers ?? []).map((l) =>
      l["front"] === "buttons" ? { ...l, buttons: 4 } : l,
    );
    const steered = {
      ...look,
      style: { ...look.style, fringe: "Parted", hairColor: "#2f2622", tailor: { layers } },
    };
    committed(
      await agent.call("apply", {
        request: request(2, {
          type: "proposal.create",
          proposal: "prop-hair",
          summary: "Part the fringe, darker hair, four buttons",
          content: { kind: "ops", ops: [{ op: "generation.steer", params: steered }] },
        }),
      }),
    );
    committed(
      await human.call("apply", {
        request: request(2, { type: "proposal.accept", proposal: "prop-hair", version: 1 }),
      }),
    );
    const after = await exported(3);
    assert.deepEqual(after.doc.generation?.params, steered, "the steer took");
    const base = after.doc.generation?.base.slots.find((b) => b.slot === humanSlot("lowerarm_l"));
    const held = after.doc.parts.find((p) => p.id === forearm.id);
    assert.ok(base && held);
    assert.ok(Math.abs(held.position[0] - base.position[0] - 0.02) < 1e-9, "the hand edit holds");
    // Two more buttons of 50 triangles each; the same cards, combed the other way.
    assert.deepEqual(after.triangles, [97695, 968, 80, 10411, 1968]);
    agent.close();
    human.close();
  } finally {
    await host.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
