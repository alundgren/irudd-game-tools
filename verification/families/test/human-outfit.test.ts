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

const g0DayDress = "b5da0330415614ecaede9754b65d79c91c7f7b63f83cff1cbf4d9c9e92fc94b2";
const g0ChoreJacket = "77cf24d59fe57e267bb3857638ac60959250186b78dc3080e5cf2eab8cfa61bc";

const lookParams = (id: string): HumanAdultParams => {
  const look = humanLooks.find((l) => l.id === id);
  assert.ok(look, `the starter offers ${id}`);
  return dressedAdult(seededHumanAdult(body, look.seed), look);
};

const nodeNames = (glb: ReturnType<typeof parseGlb>): string[] =>
  records(glb.json["nodes"]).map((n) => String(n["name"]));

test("the Day dress look's clay export is G0's, skirt drape joints and all", async () => {
  const started = performance.now();
  const glb = parseGlb(
    await clayBytes(documentOf(store.generate(lookParams("look-8973"), "Day dress")), body),
  );
  const ms = performance.now() - started;
  assert.equal(accessorDigest(glb), g0DayDress);
  const skirt = nodeNames(glb).filter((n) => /_Skirt_\d_\d$/.test(n));
  assert.equal(skirt.length, 16, "two rings of eight drape joints");
  console.log(`  look-8973: generated and exported in ${ms.toFixed(0)} ms`);
});

test("seed 8950's chore jacket exports G0's clay meshes, rig and clips", async () => {
  const look = unbraidedLook8950;
  const glb = parseGlb(
    await clayBytes(
      documentOf(store.generate(dressedAdult(seededHumanAdult(body, look.seed), look), look.label)),
      body,
    ),
  );
  assert.equal(accessorDigest(glb), g0ChoreJacket);
});

type Outfit = NonNullable<HumanAdultParams["style"]["outfit"]>;
const g0Outfits: ReadonlyArray<readonly [Outfit, string, string]> = [
  [
    "T-shirt and jeans",
    "e5c21435c0c43087f300139b0128fd0ce87691177b2413998822f55296ea7aff",
    "712bcb3202c27d7eed7396117ad2741bb54bfc0bf0ab8ffde9040cf81e60f3d0",
  ],
  [
    "Hoodie and joggers",
    "e1e644e2f946a8a0d3369c5f05cc6b82308ccdb92017e9fbf0e61338838f673d",
    "ed5cd5f148c504faa6e362ccfe4e4ece0320ce1041bed465fe9f54c57c27b4f6",
  ],
  [
    "Shirt and chinos",
    "170e101cca02ba4630c41aa4ebdbd597ccd22546ada114387fba5f399522d200",
    "f1aac1b5c95aa551793873d12b1fb27319a6bbfddfff6c2fa285bbf3b59fd280",
  ],
  [
    "Sweater and skirt",
    "c87dd17f1c66217382f653e5700dfdb957cea0f20e6d041e3921b9f6cdf4a67f",
    "3d285fc838bbc545c0aab9b53db0b2366248ae5958b15ea3c3bf4080540bfe7d",
  ],
  [
    "Running kit",
    "a7dca9faedf9b37cc7c5c7f0b214325365720348bff740735166d3a175599086",
    "ed525dba2a697a8a484eeb92c03a57cb64326e278fed7963e889edeab0ddf446",
  ],
  [
    "Coveralls",
    "8017578e46020a520f9044e5e0b763434bb44fcfbaf1421b24c4349e383506b1",
    "40c5262dcea4ef2a20581027e3febc68e103c6f776ee6f5e6b42de8c67a110b4",
  ],
  [
    "Workshop apron",
    "67fc8de4071f04daa728414d6378409f97a41a08112cabe6367851e271da9f0f",
    "779c767cf04f68387cfd313a9fb6107ea6971071e766034aba8eb5daff4f2057",
  ],
  [
    "Overcoat",
    "3470148e8fe12feb1a74f935527cbf3079b027c0cacb8f93e136c17572b3a4e6",
    "570329721873315fb7d0a7b0607a95f237a4a4173d07ef1a4db9e7459cff8bdb",
  ],
  [
    "Traveller",
    "783aba7a7f260fb1a9e4737a734e572c985ebd57751184d520e86f5baf23b9e7",
    "1ecbb20bbae0a33a985ce67a37e3c65730abdbee69ea33d2569aa0005cce1659",
  ],
  [
    "Explorer",
    "25a5f3ec88e8a834d960345920009f6d816036c7c689d3c74b187d1a216a8875",
    "2a9c13f3fa8a27a553d508b558cf0f2146313efe39b61e1ec90a86c7f56dd5d6",
  ],
  [
    "Parka",
    "1e10b1a61f86b8bc970b3123bead69e54aa7bbb30ea83c19bcc858ed8d14bb19",
    "02ec147c6791ba9214c4533cc3f0f4d029714450cad5dbd6203b485c80ea5a0f",
  ],
  [
    "Leather armour",
    "b307da7253b16a7878eaa5b4430d7bd60a418d56ac3be2586070edbf6b3678c9",
    "43a360d39377121004eaac5ff8317c91d01bc4d3edf920148fbe5c8d1724d746",
  ],
];

for (const [outfit, slim, broad] of g0Outfits)
  test(`the ${outfit} exports G0's clay on both bodies`, async () => {
    const dayDress = humanLooks.find((l) => l.id === "look-8973");
    assert.ok(dayDress);
    for (const [look, digest] of [
      [dayDress, slim],
      [unbraidedLook8950, broad],
    ] as const) {
      const style = { ...look.style, outfit };
      const params = dressedAdult(seededHumanAdult(body, look.seed), { ...look, style });
      const glb = parseGlb(await clayBytes(documentOf(store.generate(params, outfit)), body));
      assert.equal(accessorDigest(glb), digest, `${outfit} on seed ${look.seed}`);
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
