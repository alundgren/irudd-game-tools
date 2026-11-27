import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dressedAdult,
  humanAdultGenerator,
  humanLooks,
  humanSlot,
  seededHumanAdult,
  unbraidedLook8950,
  type HumanAdultParams,
} from "@irudd/character/human";
import { parseGlb, records } from "../src/glb.js";
import { loadHumanBody } from "../src/human-assets.js";
import { accessorDigest, adultStore, clayBytes, documentOf } from "../src/human-clay.js";
import { installNodeExporter } from "../src/node-exporter.js";

installNodeExporter();
const body = await loadHumanBody();
const store = adultStore(body);

const lookParams = (id: string): HumanAdultParams => {
  const look = humanLooks.find((l) => l.id === id);
  assert.ok(look, `the starter offers ${id}`);
  return dressedAdult(seededHumanAdult(body, look.seed), look);
};

const nodeNames = (glb: ReturnType<typeof parseGlb>): string[] =>
  records(glb.json["nodes"]).map((n) => String(n["name"]));

test("the Day dress look's clay export carries its skirt drape joints", async () => {
  const started = performance.now();
  const glb = parseGlb(
    await clayBytes(documentOf(store.generate(lookParams("look-8973"), "Day dress")), body),
  );
  const ms = performance.now() - started;
  const skirt = nodeNames(glb).filter((n) => /_Skirt_\d_\d$/.test(n));
  assert.equal(skirt.length, 16, "two rings of eight drape joints");
  console.log(`  look-8973: generated and exported in ${ms.toFixed(0)} ms`);
});

type Outfit = NonNullable<HumanAdultParams["style"]["outfit"]>;
const outfits: ReadonlyArray<Outfit> = [
  "T-shirt and jeans",
  "Hoodie and joggers",
  "Shirt and chinos",
  "Sweater and skirt",
  "Running kit",
  "Coveralls",
  "Workshop apron",
  "Overcoat",
  "Traveller",
  "Explorer",
  "Parka",
  "Leather armour",
];

test("each preset outfit exports its own clay on both bodies", async () => {
  const dayDress = humanLooks.find((l) => l.id === "look-8973");
  assert.ok(dayDress);
  for (const look of [dayDress, unbraidedLook8950]) {
    const digests = new Set<string>();
    for (const outfit of outfits) {
      const style = { ...look.style, outfit };
      const params = dressedAdult(seededHumanAdult(body, look.seed), { ...look, style });
      const glb = parseGlb(await clayBytes(documentOf(store.generate(params, outfit)), body));
      digests.add(accessorDigest(glb));
    }
    assert.equal(digests.size, outfits.length, `every outfit differs on seed ${look.seed}`);
  }
});

test("the dress's colours steer the adult while a held region edit stays", async () => {
  const params = lookParams("look-8973");
  let s = store.generate(params, "Day dress");
  const head = documentOf(s).parts.find((p) => p.slot === humanSlot("head"));
  assert.ok(head);
  s = store.commit(s, {
    type: "edit",
    ops: [{ op: "part.transform", part: head.id, translate: [0, 0.01, 0] }],
  });
  const before = parseGlb(await clayBytes(documentOf(s), body));
  const steered: HumanAdultParams = {
    ...params,
    style: { ...params.style, clothColor: "#7a2f3b", clothSecond: "#1d2a1f" },
  };
  s = store.commit(s, { type: "edit", ops: [{ op: "generation.steer", params: steered }] });
  const held = documentOf(s).parts.find((p) => p.id === head.id);
  const base = documentOf(s).generation?.base.slots.find((b) => b.slot === humanSlot("head"));
  assert.ok(held && base);
  assert.ok(Math.abs(held.position[1] - base.position[1] - 0.01) < 1e-9, "the held edit stays");
  const after = parseGlb(await clayBytes(documentOf(s), body));
  assert.equal(accessorDigest(after), accessorDigest(before), "the same cut");
  assert.deepEqual(documentOf(s).generation?.params, steered, "the steer took");
});

test("a preset outfit the port has not built is refused at its field", () => {
  const params = lookParams("look-8973");
  const result = humanAdultGenerator(body).params({
    ...params,
    style: { ...params.style, outfit: "Unregistered outfit" },
  });
  assert.ok(!result.ok);
  assert.deepEqual(result.diagnostics[0]?.path, ["params", "style", "outfit"]);
});
