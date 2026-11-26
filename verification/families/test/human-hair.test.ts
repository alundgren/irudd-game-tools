// Fast regression for the cuts G0 grows as strands on the adult's scalp
// (strandGroom in character-view/human-groom.js at 2761eb1). A crop on the Day
// dress and chore jacket adults, a buzz cut, a ponytail, a bun and the braid of G0's frozen
// look-8950 export G0's clay meshes, rig and clips: the roots inside each
// adult's own hairline and the cards of strands combed over them, each layer
// with its own material, and the plaits and their tie. The hair is an editable
// style field that a steer changes, and a cut the port does not grow is
// refused at its field.

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

/**
 * `accessorDigest` of G0's clay exports of its frozen look-8973 and look-8950 with only the hair changed
 * (.reference-cache/g0/derived/hair).
 */
const g0Hair: ReadonlyArray<readonly [HumanLook, Hair, string]> = [
  [dayDress, "Crop", "eb1c9a2d8634983e768198b9b19c711e6cc9ef79c0868eca34f3576ecfb0c4d1"],
  [dayDress, "Buzz cut", "0a7f8f1fe4c19ce5c9cfef61ba893db0d29e63366cece33916b1d37ad07c056a"],
  [dayDress, "Ponytail", "516676ea81465ac51d3e32aa0f160c15c190adfe50de4df6781554834a9f67f3"],
  [dayDress, "Bun", "30159b6d14fa34f45907b192cba3bcfd5ad52657cec34476ac5f7847e2e8e400"],
  [unbraidedLook8950, "Crop", "6b3eb2bac522d690e32d68f6a673773ac205271e0cef3b120c99be4f4b6983b6"],
];

for (const [look, hair, digest] of g0Hair)
  test(`seed ${look.seed} grows G0's ${hair} in clay`, async () => {
    const glb = parseGlb(
      await clayBytes(documentOf(store.generate(wearing(look, hair), hair)), body),
    );
    assert.equal(accessorDigest(glb), digest);
  });

test("the starter's look-8950 is G0's frozen braided look in clay", async () => {
  const look = humanLooks.find((l) => l.id === "look-8950");
  assert.ok(look, "the starter offers look-8950");
  assert.equal(look.style.hair, "Braid");
  const params = dressedAdult(seededHumanAdult(body, look.seed), look);
  const glb = parseGlb(await clayBytes(documentOf(store.generate(params, "Braid")), body));
  // accessorDigest of G0's adult-look-8950 clay export (.reference-cache/human-oracle).
  assert.equal(
    accessorDigest(glb),
    "49ae32b7d99c33baec04ed765e65c35058507879499ecc10b9a09bda510cf742",
  );
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
