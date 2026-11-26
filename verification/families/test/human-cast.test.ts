// Fast regression for the adults G0 wears as a clothed Rocketbox cast member.
// A seeded adult whose draw chose a member keeps its own regions in Anatomy;
// in work clothes the member is worn whole: its face with the authored poses,
// its body and clothes (or a fitted borrowed outfit) and its hair cards, shaped
// by the adult's measurements. The starter's cast looks export G0's clay
// meshes, rig, clips and credits (the Long tunic's hem with the drape joints it
// hangs from and their motion in every clip), and the member's skin colour and
// outfit are parameters a steer changes while a held region edit stays.

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

/**
 * `accessorDigest` of G0's adult-look-SEED clay export
 * (.reference-cache/human-oracle) and the Rocketbox avatars it credits.
 */
const g0Looks: ReadonlyArray<{
  readonly id: string;
  readonly digest: string;
  readonly avatars: ReadonlyArray<string>;
}> = [
  {
    id: "look-1",
    digest: "065136e65818c35b5d71a18fd0dfd62ee5379ba09c569a134cb7fa1ebde1516a",
    avatars: ["Adults/Male_Adult_15", "Adults/Male_Adult_01"],
  },
  {
    id: "look-42",
    digest: "25a31fdd7dc82ddefb6c2d0eea70a814ed0af2a6161e6bc44e70d1a492dd4b95",
    avatars: ["Adults/Male_Adult_08"],
  },
  {
    id: "look-8713",
    digest: "e4c3621433383fe8c65a316225e9f701eb33ec17231cb324706e8cfe37927a0a",
    avatars: ["Adults/Male_Adult_08"],
  },
  {
    id: "look-9001",
    digest: "9acf80fef3cc99dd222eb39a7fe1abee83961cddf8c751dc12b4ce178c2b4da1",
    avatars: ["Adults/Male_Adult_01"],
  },
  {
    id: "look-49027675",
    digest: "dfcf2d5d72254168f78dc19ded881a44548077e13040cac0d217a033cb923bca",
    avatars: ["Adults/Female_Adult_04", "Adults/Female_Adult_08"],
  },
  {
    id: "look-3782767734",
    digest: "c39b5ec54848ec65dfee9b4c40f2806dc31f4c137ef5f5e0a3d618472abf2d27",
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

test("each cast look's clay export is G0's: the worn member's meshes, rig, clips and credits", async () => {
  for (const { id, digest, avatars } of g0Looks) {
    const started = performance.now();
    const glb = parseGlb(await clayBytes(documentOf(store.generate(lookParams(id), id)), body));
    const ms = performance.now() - started;
    assert.equal(accessorDigest(glb), digest, `${id} accessors`);
    assert.deepEqual(avatarsOf(glb), avatars, `${id} credits`);
    console.log(`  ${id}: generated and exported in ${ms.toFixed(0)} ms`);
  }
});

test("in Anatomy the drawn cast member is not worn and its tailored layers are not dressed", async () => {
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
  // With no member and no outfit named, G0 puts on its field jacket and denim, which is not built yet.
  const bare = seededHumanAdult(body, 491);
  await assert.rejects(
    clayBytes(documentOf(store.generate({ ...bare, outfit: "Work clothes" }, "bare")), body),
    /field jacket and denim is not built yet/,
  );
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
  // A borrowed denim jacket and jeans are one of the Gardener's fitted outfits.
  s = store.commit(s, { type: "edit", ops: [{ op: "generation.steer", params: steered }] });
  const held = documentOf(s).parts.find((p) => p.id === head.id);
  const base = documentOf(s).generation?.base.slots.find((b) => b.slot === humanSlot("head"));
  assert.ok(held && base);
  assert.ok(Math.abs(held.position[1] - base.position[1] - 0.01) < 1e-9, "the held edit stays");
  const after = parseGlb(await clayBytes(documentOf(s), body));
  assert.notEqual(accessorDigest(after), before, "the outfit changed the export");
  // The member, the borrowed jacket and jeans, and the donor its face shape and pigment blend toward.
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
