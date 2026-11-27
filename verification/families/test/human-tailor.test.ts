import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";
import * as T from "three";
import { buildCharacter, clayMaterials, cutGarment } from "@irudd/character";
import { canonicalJson, isJson, figureMantle } from "@irudd/document";
import { dressBody, dressLandmarks, fittedHair, tailorParts } from "@irudd/character/human/dress";
import {
  evaluateHuman,
  humanMeasurements,
  humanSlot,
  dressedAdult,
  look491,
  readTailor,
  seededHumanAdult,
  type HumanAdultParams,
} from "@irudd/character/human";
import { parseGlb } from "../src/glb.js";
import { isMesh } from "../../../packages/character/src/mesh.js";
import { loadHumanBody } from "../src/human-assets.js";
import { adultStore, clayBytes, documentOf, meshValues } from "../src/human-clay.js";
import { g0LookPieces, surfaceDigest } from "../src/human-dressed.js";
import { installNodeExporter } from "../src/node-exporter.js";

installNodeExporter();
const body = await loadHumanBody();
const store = adultStore(body);
const seeded = seededHumanAdult(body, 491);
const dressed: HumanAdultParams = dressedAdult(seeded, look491);
const look491Tailor = { layers: look491.style.tailor?.layers ?? [] };

const g0Parts = "ddd839d886ff407226fbbd639cfea520ef93a23b1ec7de904cda37e3fa2d6c54";
const g0Hair = "46e799bbdd7f10b846e8a9cad07de36b58fe178e6dd8156568e92e00904d3c89";
const g0Look = {
  surface: "204908827f0b33dcb73476fad739be047e7038b999f2737e7e5eea350f426965",
  necklace: "64e1440f3fed9ba77ea4a16c4709430c0d6e1055ec91f616a1e5e5a6b4adc00f",
  hair: "21af2ee1dbc897da97c4c11dca1790d5c64a07346e3a7c7d88a8b70f1581f786",
  eyewear: "d4a87220e4af697222ee56f143f82f6d6ba31898ffa18de9de704191f974b917",
} as const;
const g0Counts = {
  surface: [63203, 97595],
  necklace: [592, 1048],
  hair: [17579, 10411],
  eyewear: [1183, 1968],
} as const;

const generate = (params: HumanAdultParams) => store.generate(params, "Adult 491 in work clothes");

test("the starter's look-491 is the look G0 froze", () => {
  assert.ok(isJson(look491.style));
  assert.equal(
    createHash("sha256").update(canonicalJson(look491.style)).digest("hex"),
    "786177318ccba729ad569d8030e50c7c29ac44e877489b820555bfa2706dc8ce",
  );
});

test("adult 491's tailored outfit is cut as G0 cuts it", () => {
  const started = performance.now();
  const tailor = readTailor(look491Tailor);
  assert.ok(tailor);
  const cage = evaluateHuman(body, humanMeasurements(seeded));
  const b = dressBody(cage);
  const made = tailorParts(b, dressLandmarks(b), tailor);
  const hash = createHash("sha256");
  for (const p of made.parts) {
    hash.update(JSON.stringify([p.name, p.region, p.tone, p.type]));
    hash.update(new Uint8Array(Float64Array.from(p.piece.pos).buffer));
    hash.update(new Uint8Array(Uint32Array.from(p.piece.tri).buffer));
    hash.update(new Uint8Array(Uint8Array.from(p.piece.bones).buffer));
    hash.update(new Uint8Array(Float64Array.from(p.piece.weights).buffer));
  }
  hash.update(new Uint8Array(Uint32Array.from([...made.hidden].sort((x, y) => x - y)).buffer));
  assert.deepEqual(
    made.parts.map((p) => p.name),
    [
      "Boot",
      "Boot sole",
      "Boot shaft",
      "Boot",
      "Boot sole",
      "Boot shaft",
      "Trousers",
      "Top",
      "Jacket",
      "Buttons",
    ],
  );
  assert.equal(made.hidden.size, 3627);
  assert.equal(hash.digest("hex"), g0Parts);
  console.log(`  look 491 outfit: cut in ${(performance.now() - started).toFixed(0)} ms`);
});

test("adult 491's long centre part is fitted as G0 fits it", () => {
  const started = performance.now();
  const cage = evaluateHuman(body, humanMeasurements(seeded));
  const material = (c: string) => new T.MeshStandardMaterial({ color: c });
  const hair = fittedHair(
    cage,
    look491.style,
    body.grooms,
    body.arrays.f32("base"),
    material,
    true,
    false,
  );
  assert.ok(hair);
  const hash = createHash("sha256");
  const g = hair.cards.geometry;
  for (const name of ["position", "normal", "uv"])
    hash.update(new Uint8Array(Float32Array.from(g.getAttribute(name).array).buffer));
  hash.update(new Uint8Array(Uint32Array.from(g.index?.array ?? []).buffer));
  const roots = hair.roots.mesh.geometry;
  hash.update(new Uint8Array(Float32Array.from(roots.getAttribute("position").array).buffer));
  hash.update(new Uint8Array(Uint32Array.from(roots.index?.array ?? []).buffer));
  hash.update(new Uint8Array(Uint8Array.from(hair.roots.boneIndices).buffer));
  hash.update(new Uint8Array(Float32Array.from(hair.roots.weights).buffer));
  assert.equal(hash.digest("hex"), g0Hair);
  assert.equal(g.getAttribute("position").count, 17579);
  assert.equal(roots.getAttribute("position").count, 2104);
  console.log(`  look 491 hair: fitted in ${(performance.now() - started).toFixed(0)} ms`);
});

test("the dressed adult's clay export is G0's, piece by piece", async () => {
  const started = performance.now();
  const fresh = parseGlb(await clayBytes(documentOf(generate(dressed)), body));
  for (const piece of ["surface", "necklace", "hair", "eyewear"] as const) {
    const { runs, primitives } = g0LookPieces[piece];
    const [vertices, triangles] = g0Counts[piece];
    assert.deepEqual(
      surfaceDigest(fresh, runs, primitives),
      { digest: g0Look[piece], vertices, triangles },
      piece,
    );
  }
  console.log(
    `  look 491 dressed: generated and exported in ${(performance.now() - started).toFixed(0)} ms`,
  );
});

test("a fringe edit combs the long hair and a second steer fits the browser's Sleek bob", async () => {
  let s = generate(dressed);
  const hairOf = async () => {
    const glb = parseGlb(await clayBytes(documentOf(s), body));
    const { runs, primitives } = g0LookPieces.hair;
    return surfaceDigest(glb, runs, primitives);
  };
  const swept = await hairOf();
  const parted: HumanAdultParams = {
    ...dressed,
    style: { ...dressed.style, fringe: "Parted" },
  };
  s = store.commit(s, {
    type: "edit",
    ops: [{ op: "generation.steer", params: parted }],
  });
  const combed = await hairOf();
  assert.equal(combed.triangles, swept.triangles);
  assert.notEqual(combed.digest, swept.digest);
  const bob = { ...parted, style: { ...parted.style, hair: "Sleek bob" } } as const;
  s = store.commit(s, { type: "edit", ops: [{ op: "generation.steer", params: bob }] });
  const built = buildCharacter(documentOf(s), { human: body, materials: clayMaterials() });
  try {
    assert.equal(built.group.getObjectByName("Long centre part"), undefined);
    const cards = built.group.getObjectByName("Sleek bob");
    assert.ok(cards && isMesh(cards));
    assert.equal(cards.userData["libraryHair"], "bob_blunt");
    const { geometry } = cards;
    assert.equal(geometry.getAttribute("position").count, 12939);
    assert.ok(geometry.index);
    assert.equal(
      createHash("sha256")
        .update(new Uint8Array(Uint32Array.from(geometry.index.array).buffer))
        .digest("hex"),
      "e0c374575aaba60f77b48d91a69b53b3106bc67a0d4c450171f302cbbb56af05",
      "the fitted cards use the browser's authored triangles",
    );
  } finally {
    built.dispose();
  }
});

test("an outfit edit steers the export while a held region edit stays", async () => {
  let s = generate(dressed);
  const forearm = documentOf(s).parts.find((p) => p.slot === humanSlot("lowerarm_l"));
  assert.ok(forearm);
  s = store.commit(s, {
    type: "edit",
    ops: [{ op: "part.transform", part: forearm.id, translate: [0.02, 0, 0] }],
  });
  const triangles = async () =>
    (meshValues(parseGlb(await clayBytes(documentOf(s), body))).get("Character surface/0/indices")
      ?.length ?? 0) / 3;
  const before = await triangles();
  const layers = look491Tailor.layers.map((l) =>
    l["piece"] === "top" && l["front"] === "buttons" ? { ...l, buttons: 4 } : l,
  );
  const steered: HumanAdultParams = { ...dressed, style: { ...dressed.style, tailor: { layers } } };
  s = store.commit(s, { type: "edit", ops: [{ op: "generation.steer", params: steered }] });
  const held = documentOf(s).parts.find((p) => p.id === forearm.id);
  const base = documentOf(s).generation?.base.slots.find((b) => b.slot === humanSlot("lowerarm_l"));
  assert.ok(held && base);
  assert.ok(Math.abs(held.position[0] - base.position[0] - 0.02) < 1e-9);
  assert.equal((await triangles()) - before, 100);
  const wrong = look491Tailor.layers.map((l) => (l["piece"] === "boots" ? { ...l, heel: 90 } : l));
  assert.throws(
    () =>
      store.commit(s, {
        type: "edit",
        ops: [
          {
            op: "generation.steer",
            params: { ...dressed, style: { ...dressed.style, tailor: { layers: wrong } } },
          },
        ],
      }),
    /boots\.heel must be between 0 and 70/,
  );
});

test("a skirt sits at the same waist and reaches the same hem over boots and trousers as on the bare adult", () => {
  const pattern = (params: HumanAdultParams) => {
    const doc = documentOf(generate(params)),
      pelvis = doc.parts.find((p) => p.slot === humanSlot("pelvis"));
    assert.ok(pelvis);
    const built = buildCharacter(doc, { human: body, materials: clayMaterials() });
    try {
      const part = cutGarment(built, pelvis.id, "Skirt", "#544566");
      return { position: part.position, cut: figureMantle.read(part.features)?.cut };
    } finally {
      built.dispose();
    }
  };
  assert.deepEqual(pattern(dressed), pattern({ ...dressed, outfit: "Anatomy" }));
});
