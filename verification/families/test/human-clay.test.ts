import assert from "node:assert/strict";
import { test } from "node:test";
import { humanSlot, seededHumanAdult } from "@irudd/character/human";
import { parseGlb } from "../src/glb.js";
import { loadHumanBody } from "../src/human-assets.js";
import { adultStore, clayBytes, documentOf, meshValues } from "../src/human-clay.js";
import { installNodeExporter } from "../src/node-exporter.js";

installNodeExporter();
const body = await loadHumanBody();
const store = adultStore(body);

test("a held forearm edit shows in a fresh export after a steer", async () => {
  let s = store.generated(491);
  const forearm = documentOf(s).parts.find((p) => p.slot === humanSlot("lowerarm_l"));
  assert.ok(forearm);
  const clay = async () => meshValues(parseGlb(await clayBytes(documentOf(s), body)));
  const before = (await clay()).get("Character surface/0/POSITION");
  s = store.commit(s, {
    type: "edit",
    ops: [{ op: "part.transform", part: forearm.id, translate: [0.02, 0, 0] }],
  });
  const params = seededHumanAdult(body, 491);
  s = store.commit(s, {
    type: "edit",
    ops: [
      { op: "generation.steer", params: { ...params, human: { ...params.human, muscle: 0.1 } } },
    ],
  });
  const base = documentOf(s).generation?.base.slots.find((b) => b.slot === humanSlot("lowerarm_l"));
  const held = documentOf(s).parts.find((p) => p.id === forearm.id);
  assert.ok(base && held);
  assert.ok(Math.abs(held.position[0] - base.position[0] - 0.02) < 1e-9);
  const after = (await clay()).get("Character surface/0/POSITION");
  assert.ok(before && after && before.length === after.length);
  let moved = 0;
  for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) moved++;
  assert.ok(moved > 0);
});
