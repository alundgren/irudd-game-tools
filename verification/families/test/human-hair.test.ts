import assert from "node:assert/strict";
import { test } from "node:test";
import { Vector3 } from "three";
import { buildCharacter, clayMaterials } from "@irudd/character";
import {
  dressedAdult,
  humanLooks,
  seededHumanAdult,
  unbraidedLook8950,
  type HumanAdultParams,
  type HumanLook,
} from "@irudd/character/human";
import { parseGlb } from "../src/glb.js";
import { isMesh } from "../../../packages/character/src/mesh.js";
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

test("Bob fits the browser's swept-left roots and strands to the reference head", () => {
  const params = { ...wearing(dayDress, "Bob"), human: { height: 1.72 } };
  const built = buildCharacter(documentOf(store.generate(params, "Bob")), {
    human: body,
    materials: clayMaterials(),
  });
  try {
    for (const [name, vertices, triangles, sizeMm] of [
      ["Bob roots", 1567, 2816, [151, 162, 189]],
      ["Bob", 9158, 8518, [228, 239, 232]],
    ] as const) {
      const mesh = built.group.getObjectByName(name);
      assert.ok(mesh && isMesh(mesh), name);
      const { geometry } = mesh;
      assert.equal(geometry.getAttribute("position").count, vertices);
      assert.equal(geometry.index?.count, triangles * 3);
      geometry.computeBoundingBox();
      assert.ok(geometry.boundingBox);
      const size = geometry.boundingBox.getSize(new Vector3()).multiplyScalar(1000).toArray();
      for (const axis of [0, 1, 2] as const)
        assert.ok(
          Math.abs(size[axis] - sizeMm[axis]) < 1,
          `${name} axis ${axis}: ${size[axis]} mm`,
        );
    }
  } finally {
    built.dispose();
  }
});
