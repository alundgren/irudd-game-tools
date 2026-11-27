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
