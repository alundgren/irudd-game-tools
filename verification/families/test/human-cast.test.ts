import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dressedAdult,
  humanLooks,
  humanSlot,
  seededHumanAdult,
  type HumanAdultParams,
} from "@irudd/character/human";
import { isRecord, parseGlb, records } from "../src/glb.js";
import { loadHumanBody } from "../src/human-assets.js";
import {
  accessorDigest,
  adultStore,
  clayBytes,
  documentOf,
  meshValues,
} from "../src/human-clay.js";
import { installNodeExporter } from "../src/node-exporter.js";

installNodeExporter();
const body = await loadHumanBody();
const store = adultStore(body);

const castLooks: ReadonlyArray<{
  readonly id: string;
  readonly avatars: ReadonlyArray<string>;
}> = [
  {
    id: "look-1",
    avatars: ["Adults/Male_Adult_15", "Adults/Male_Adult_01"],
  },
  {
    id: "look-42",
    avatars: ["Adults/Male_Adult_08"],
  },
  {
    id: "look-8713",
    avatars: ["Adults/Male_Adult_08"],
  },
  {
    id: "look-9001",
    avatars: ["Adults/Male_Adult_01"],
  },
  {
    id: "look-49027675",
    avatars: ["Adults/Female_Adult_04", "Adults/Female_Adult_08"],
  },
  {
    id: "look-3782767734",
    avatars: ["Professions/Gardener_Male_01", "Adults/Male_Adult_01"],
  },
];

const lookParams = (id: string): HumanAdultParams => {
  const look = humanLooks.find((l) => l.id === id);
  assert.ok(look, `the starter offers ${id}`);
  return dressedAdult(seededHumanAdult(body, look.seed), look);
};

const avatarsOf = (glb: ReturnType<typeof parseGlb>): unknown => {
  const asset = isRecord(glb.json["asset"]) ? glb.json["asset"] : {};
  const extras = isRecord(asset["extras"]) ? asset["extras"] : {};
  const rocketbox = isRecord(extras["rocketbox"]) ? extras["rocketbox"] : {};
  return rocketbox["avatars"];
};

const meshNames = (glb: ReturnType<typeof parseGlb>): string[] =>
  records(glb.json["nodes"]).flatMap((n) => (n["mesh"] === undefined ? [] : [String(n["name"])]));

test("each cast look's clay export credits the worn members' source avatars", async () => {
  for (const { id, avatars } of castLooks) {
    const started = performance.now();
    const glb = parseGlb(await clayBytes(documentOf(store.generate(lookParams(id), id)), body));
    const ms = performance.now() - started;
    assert.deepEqual(avatarsOf(glb), avatars, `${id} credits`);
    console.log(`  ${id}: generated and exported in ${ms.toFixed(0)} ms`);
  }
});

test("Anatomy shows the drawn adult and Work clothes fits the cast or default field outfit", async () => {
  const seeded = seededHumanAdult(body, 42);
  assert.equal(seeded.style.cast, "Blue shirt");
  assert.equal(seeded.outfit, undefined);
  const anatomy = parseGlb(await clayBytes(documentOf(store.generated(42)), body));
  assert.ok(!meshNames(anatomy).some((n) => n.startsWith("Cast")), "the adult's own regions");
  const worn = parseGlb(
    await clayBytes(documentOf(store.generate(lookParams("look-42"), "look")), body),
  );
  const values = meshValues(worn);
  assert.ok(
    [...values.keys()].some((k) => k.includes("/target")),
    "the worn face carries its poses",
  );
  assert.notEqual(accessorDigest(worn), accessorDigest(anatomy));
  const bare = seededHumanAdult(body, 491);
  const digest = async (params: HumanAdultParams) =>
    accessorDigest(
      parseGlb(await clayBytes(documentOf(store.generate(params, "Adult 491")), body)),
    );
  const work = { ...bare, outfit: "Work clothes" } as const;
  const defaultOutfit = await digest(work);
  assert.equal(
    defaultOutfit,
    await digest({ ...work, style: { ...bare.style, outfit: "Field jacket and denim" } }),
  );
  assert.notEqual(defaultOutfit, await digest(bare));
});

test("the member's skin and outfit steer the export while a held region edit stays", async () => {
  const params = lookParams("look-3782767734");
  let s = store.generate(params, "Gardener");
  const head = documentOf(s).parts.find((p) => p.slot === humanSlot("head"));
  assert.ok(head);
  s = store.commit(s, {
    type: "edit",
    ops: [{ op: "part.transform", part: head.id, translate: [0, 0.01, 0] }],
  });
  const before = accessorDigest(parseGlb(await clayBytes(documentOf(s), body)));
  const steered: HumanAdultParams = {
    ...params,
    style: {
      ...params.style,
      castSkin: "#8a5a40",
      castTop: "Denim jacket",
      castBottom: "Jeans and shoes",
    },
  };
  s = store.commit(s, { type: "edit", ops: [{ op: "generation.steer", params: steered }] });
  const held = documentOf(s).parts.find((p) => p.id === head.id);
  const base = documentOf(s).generation?.base.slots.find((b) => b.slot === humanSlot("head"));
  assert.ok(held && base);
  assert.ok(Math.abs(held.position[1] - base.position[1] - 0.01) < 1e-9, "the held edit stays");
  const after = parseGlb(await clayBytes(documentOf(s), body));
  assert.notEqual(accessorDigest(after), before, "the outfit changed the export");
  assert.deepEqual(avatarsOf(after), [
    "Professions/Gardener_Male_01",
    "Adults/Male_Adult_12",
    "Adults/Male_Adult_01",
  ]);
});

test("a cast outfit the member has not been fitted for is refused at its field", () => {
  const params = lookParams("look-42");
  assert.throws(
    () =>
      store.generate(
        { ...params, style: { ...params.style, castTop: "Work shirt" } },
        "Blue shirt in a work shirt",
      ),
    /Blue shirt has no fitted Work shirt/,
  );
  const bare = seededHumanAdult(body, 491);
  assert.throws(
    () => store.generate({ ...bare, style: { ...bare.style, castTop: "Work shirt" } }, "No member"),
    /needs a cast member/,
  );
});
