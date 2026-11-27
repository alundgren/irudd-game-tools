import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dressedAdult,
  humanAdultGenerator,
  humanLooks,
  seededHumanAdult,
  unbraidedLook8950,
  type HumanAdultParams,
  type HumanLook,
} from "@irudd/character/human";
import { parseGlb } from "../src/glb.js";
import { loadHumanBody } from "../src/human-assets.js";
import { accessorDigest, adultStore, clayBytes, documentOf } from "../src/human-clay.js";
import { installNodeExporter } from "../src/node-exporter.js";

installNodeExporter();
const body = await loadHumanBody();
const store = adultStore(body);

const dayDress = humanLooks.find((l) => l.id === "look-8973");
assert.ok(dayDress, "the starter offers look-8973");
type Hair = NonNullable<HumanAdultParams["style"]["hair"]>;
const wearing = (look: HumanLook, hair: Hair): HumanAdultParams =>
  dressedAdult(seededHumanAdult(body, look.seed), { ...look, style: { ...look.style, hair } });

const grown: ReadonlyArray<readonly [HumanLook, Hair]> = [
  [dayDress, "Crop"],
  [dayDress, "Buzz cut"],
  [dayDress, "Ponytail"],
  [dayDress, "Bun"],
  [unbraidedLook8950, "Crop"],
];

test("each cut grows its own hair in clay", async () => {
  const digests = new Set<string>();
  for (const [look, hair] of grown) {
    const glb = parseGlb(
      await clayBytes(documentOf(store.generate(wearing(look, hair), hair)), body),
    );
    digests.add(accessorDigest(glb));
  }
  assert.equal(digests.size, grown.length);
});

test("the starter's look-8950 wears a braid", () => {
  const look = humanLooks.find((l) => l.id === "look-8950");
  assert.ok(look, "the starter offers look-8950");
  assert.equal(look.style.hair, "Braid");
});

test("the hair is a style field a steer changes", async () => {
  const params = wearing(dayDress, "Crop");
  let s = store.generate(params, "Crop");
  const before = accessorDigest(parseGlb(await clayBytes(documentOf(s), body)));
  const steered: HumanAdultParams = { ...params, style: { ...params.style, hair: "Side part" } };
  s = store.commit(s, { type: "edit", ops: [{ op: "generation.steer", params: steered }] });
  assert.deepEqual(documentOf(s).generation?.params, steered, "the steer took");
  const after = accessorDigest(parseGlb(await clayBytes(documentOf(s), body)));
  assert.notEqual(after, before, "the side part is grown in place of the crop");
});

test("a cut the port does not grow is refused at its field", () => {
  const params = wearing(dayDress, "Crop");
  const result = humanAdultGenerator(body).params({
    ...params,
    style: { ...params.style, hair: "Bob" },
  });
  assert.ok(!result.ok);
  assert.deepEqual(result.diagnostics[0]?.path, ["params", "style", "hair"]);
});
