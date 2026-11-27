import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as T from "three";
import { correctedSurface, skinStroke } from "../src/human/brush.js";
import { humanCorrections } from "@irudd/document";
import { humanRegions, humanWeightsOf } from "../src/human/mesh.js";
import { referenceGlb } from "../src/reference-glb.js";
import { fittedAccessories } from "../src/human/dress/accessories.js";
import { humanMeasurements } from "../src/human/generator.js";
import { fitReference, referenceVertices, evaluateHuman, tailorLayer } from "../src/human/index.js";
import { dressBody, dressLandmarks, tailorParts } from "../src/human/dress/index.js";
import { decodeWith } from "@irudd/document";
import {
  changeMeasurement,
  chooseAdultStyle,
  chooseAdultWardrobe,
  defaultTailor,
  tailorAdult,
  drawAdult,
  HumanAdultParams,
  loadHumanPacks,
  lookDirections,
  measurementGroups,
  newHumanLook,
  portraitAxes,
  portraitFrames,
  randomDressedAdult,
  rerollRegion,
  restoreSkin,
  seededHumanAdult,
  showOutfit,
  skinTone,
  tintSkin,
} from "../src/human/index.js";

const body = await loadHumanPacks((file) =>
  readFileSync(new URL("../assets/human/" + file, import.meta.url)),
);
const person = seededHumanAdult(body, 491, "neutral", "Natural");

test("reference fit follows measured dimensions and retains wardrobe", () => {
  const target = evaluateHuman(body, { height: 1.5, weight: 1, muscle: 1, frame: 1 });
  const next = fitReference(body, person, target.positions);
  assert.ok(Math.abs((next.human["height"] ?? 0) - 1.5) < 0.02);
  assert.deepEqual(next.style, person.style);
  assert.ok((next.human["weight"] ?? 0) > (person.human["weight"] ?? 0));
  assert.deepEqual(
    referenceVertices("v 0 1 2\nf 1 2 3\nv -1 3 4"),
    Float32Array.of(0, 1, 2, -1, 3, 4),
  );
  assert.throws(() => fitReference(body, person, Float32Array.of(0, 0, 0)), /upright/);
});

test("an embedded GLB contributes vertices in upright world coordinates", async () => {
  const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const description = JSON.stringify({
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, translation: [2, 3, 4] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
    ],
    bufferViews: [{ buffer: 0, byteLength: vertices.byteLength }],
    buffers: [{ byteLength: vertices.byteLength }],
  });
  const json = Buffer.from(description.padEnd(Math.ceil(description.length / 4) * 4));
  const glb = new ArrayBuffer(28 + json.length + vertices.byteLength);
  const view = new DataView(glb);
  [0x46546c67, 2, glb.byteLength, json.length, 0x4e4f534a].forEach((value, i) =>
    view.setUint32(4 * i, value, true),
  );
  new Uint8Array(glb, 20, json.length).set(json);
  view.setUint32(20 + json.length, vertices.byteLength, true);
  view.setUint32(24 + json.length, 0x004e4942, true);
  new Float32Array(glb, 28 + json.length).set(vertices);
  assert.deepEqual(await referenceGlb(glb), Float32Array.of(2, 3, 4, 3, 3, 4, 2, 4, 4));
});

test("Studio Rain keeps expression targets, family hair and a skinned neckline", () => {
  const regions = humanRegions(body, {}, () => "#bb8866", {
    studio: { hair: "#452915", familyHair: true },
    material: (colour) => new T.MeshStandardMaterial({ color: colour }),
    plain: false,
    height: 1.72,
    paint: null,
    face: { skin: "#bb8866", age: 0, frame: 0, brow: "eyebrow001", parted: null },
  });
  const group = regions.region("head"),
    skin = group.getObjectByName("Studio Rain skin"),
    neck = group.getObjectByName("Studio Rain neck");
  const mesh = (node: T.Object3D | undefined): node is T.Mesh => node instanceof T.Mesh;
  assert.ok(mesh(skin) && mesh(neck));
  assert.deepEqual(Object.keys(skin.morphTargetDictionary ?? {}), ["Blink", "Smile", "BrowLift"]);
  assert.ok(group.getObjectByName("Studio Rain hair_ponytail"));
  const weights = humanWeightsOf.get(neck);
  assert.ok(weights && new Set(weights.boneIndices).size > 2);
  assert.equal(weights.weights.length, neck.geometry.getAttribute("position").count * 4);
});

test("a seeded start honours the chosen frame and colour range", () => {
  for (const [archetype, frame] of [
    ["neutral", 0],
    ["male", 0.9],
    ["female", -0.9],
  ] as const) {
    const natural = seededHumanAdult(body, 491, archetype, "Natural");
    assert.equal(natural.human["frame"], frame);
    const fantasy = seededHumanAdult(body, 491, archetype, "Fantasy");
    assert.notEqual(fantasy.skin, natural.skin);
    assert.ok((fantasy.human["earTip"] ?? 0) > 0.45);
    assert.equal(natural.skin, drawAdult(body, 491, archetype, "Natural").skin);
  }
});

test("a chosen archetype keeps the head foundation and look consistent with its frame", () => {
  for (const [archetype, sign] of [
    ["female", -1],
    ["male", 1],
  ] as const) {
    for (let seed = 1; seed <= 40; seed++) {
      const params = randomDressedAdult(body, seed * 7919, archetype, "Natural");
      for (const axis of portraitAxes)
        if ((params.human[axis] ?? 0) > 0) assert.ok(sign * portraitFrames[axis] > 0, axis);
      assert.ok(sign * ((params.human["height"] ?? 0) - 1.705) > -0.21);
      const look = params.style;
      if (archetype === "female")
        assert.ok(!["Horseshoe crop", "Receding short", "Buzz cut"].includes(look.hair ?? ""));
      else assert.ok(!["Day dress", "Sweater and skirt"].includes(look.outfit ?? ""));
    }
  }
});

test("rerolls replace only measurements in the chosen region", () => {
  for (const region of ["Body", "Face", "Limbs", "Portrait foundations"] as const) {
    const rolled = rerollRegion(body, person, region, 8950);
    assert.notDeepEqual(person.human, rolled.human);
    for (const [key, value] of Object.entries(person.human)) {
      if (!Object.hasOwn(measurementGroups[region], key))
        assert.equal(rolled.human[key], value, key);
    }
    assert.deepEqual({ ...rolled, human: person.human }, person);
    assert.ok(decodeWith(HumanAdultParams, rolled).ok);
  }
  const changed = changeMeasurement(person, "height", 1.99);
  assert.deepEqual(changed.human, { ...person.human, height: 1.99 });
  assert.throws(() => changeMeasurement(person, "height", 3));
});

test("changing looks gives a dressed, reproducible choice with the same measurements and appearance", () => {
  for (const direction of lookDirections) {
    const look = newHumanLook(person, 42, direction);
    assert.deepEqual(newHumanLook(person, 42, direction), look);
    const next = newHumanLook(look, 42, direction);
    assert.notEqual(next.style.outfit, look.style.outfit);
    assert.notEqual(next.style.hair, look.style.hair);
    assert.deepEqual(
      { ...look, style: person.style, outfit: person.outfit },
      { ...person, outfit: person.outfit },
    );
    assert.deepEqual(showOutfit(showOutfit(look, false), true), look);
    const undressed = chooseAdultStyle(look, { outfit: "None" });
    assert.equal(undressed.outfit, "Anatomy");
    assert.equal(showOutfit(undressed, true).style.outfit, "T-shirt and jeans");
    assert.ok(decodeWith(HumanAdultParams, next).ok);
  }
});

test("skin restoration survives repeated tints and switching cast members clears incompatible outfits", () => {
  assert.deepEqual(restoreSkin(tintSkin(tintSkin(person, "#321f16"), "#eebbaa")), person);
  const dressed = newHumanLook(person, 42, "Workwear");
  const cast = chooseAdultStyle(dressed, { cast: "Cropped jacket" });
  const tint = tintSkin(cast, "#ddbbaa");
  assert.equal(skinTone(tint), "#ddbbaa");
  assert.deepEqual(restoreSkin(tint), cast);
  const fitted = newHumanLook(tint, 17, "Workwear");
  assert.equal(fitted.style.cast, cast.style.cast);
  assert.notEqual(fitted.style.castTop, cast.style.castTop);
  assert.equal(skinTone(fitted), skinTone(tint));
  assert.ok(decodeWith(HumanAdultParams, fitted).ok);
  const adventure = newHumanLook(tint, 17, "Adventure");
  assert.equal(adventure.style.cast, undefined);
  assert.equal(skinTone(adventure), skinTone(tint));
  const top = chooseAdultStyle(cast, { castTop: "Pink shirt" });
  assert.ok(decodeWith(HumanAdultParams, top).ok);
  const next = chooseAdultStyle(top, { cast: "Blue shirt" });
  assert.equal(next.style.castTop, undefined);
  assert.equal(next.style.castBottom, undefined);
  assert.ok(decodeWith(HumanAdultParams, next).ok);
  const individual = chooseAdultStyle(next, {}, "cast");
  assert.ok(individual.style.outfit);
  assert.equal(individual.style.castSkin, undefined);
});

test("tailoring restores the working clothes and keeps the pieces through uniform changes", () => {
  const layers = defaultTailor("#884455").layers;
  const tailored = tailorAdult(chooseAdultWardrobe(person, "Anatomy"), layers);
  assert.deepEqual(tailored.style.tailor?.layers, layers);
  for (const outfit of ["Anatomy", "Base layer", "Pressure suit"] as const) {
    const uniform = chooseAdultWardrobe(tailored, outfit);
    assert.ok(decodeWith(HumanAdultParams, uniform).ok);
    assert.deepEqual(chooseAdultWardrobe(uniform, "Work clothes"), tailored);
  }
  const removed = tailorAdult(tailored, []);
  assert.ok(!removed.style.tailor && removed.style.outfit);
  assert.throws(() => tailorAdult(person, [{ piece: "unknown" }]));
});

test("native face families, fitted accessories and individual armour use the selected body's proportions", () => {
  const styled = chooseAdultStyle(showOutfit(person, true), {
    faceFamily: "Soft",
    faceFamilyHair: "Chosen",
    facePlanes: "Sculpted",
    earrings: "Hoops",
    hat: "Beret",
    hatColor: "#876533",
    waistBag: "Dispatch folio",
    handProp: "Painted folding fan",
    facialHair: "Moustache",
  });
  assert.ok(decodeWith(HumanAdultParams, styled).ok);
  assert.notDeepEqual(humanMeasurements(styled), humanMeasurements(person));
  const surface = evaluateHuman(body, humanMeasurements(styled));
  const items = fittedAccessories(
    surface,
    styled.style,
    (tone) => new T.MeshStandardMaterial({ color: tone }),
  );
  for (const name of ["Beret", "Hoops", "Dispatch folio", "Painted folding fan", "Moustache"])
    assert.ok(
      items.some((i) => i.mesh.name === name),
      name,
    );
  const fit = dressBody(surface);
  for (const piece of [
    "cuirass",
    "pauldrons",
    "armguards",
    "legguards",
    "tassets",
    "travellingMantle",
  ]) {
    const made = tailorParts(fit, dressLandmarks(fit), { layers: [tailorLayer(piece)] });
    assert.ok(made.parts.length >= 2);
    assert.ok(made.parts.every((p) => p.piece.count > 0 && p.piece.pos.every(Number.isFinite)));
  }
});

test("connected corrections follow touching regions, preserve separated surfaces, mirror, soften and clear", () => {
  const bare = evaluateHuman(body, { stance: 1 }),
    position = (i: number) => new T.Vector3().fromArray(bare.positions, 3 * i);
  const nearest = (at: T.Vector3) => {
    let id = 0,
      d = Infinity;
    for (let v = 0; v < bare.bodyVertices; v++) {
      const n = position(v).distanceToSquared(at);
      if (n < d) {
        d = n;
        id = v;
      }
    }
    return id;
  };
  const seed = nearest(new T.Vector3(0.06, 1.54, 0.09)),
    at = position(seed);
  const single = skinStroke(body, bare, undefined, [seed], at.toArray(), 0.07, false);
  const mirror = skinStroke(body, bare, undefined, [seed], at.toArray(), 0.07, true);
  const fit = mirror.apply([0.05, 0, 0.02]),
    one = single.apply([0.05, 0, 0.02]);
  assert.ok(fit.controls.length > one.controls.length);
  assert.deepEqual(
    humanCorrections.read({ [humanCorrections.id]: humanCorrections.json(fit) }),
    fit,
  );
  const changed = correctedSurface(body, bare, fit);
  const moved = (i: number) =>
    new T.Vector3().fromArray(changed.positions, i * 3).distanceTo(position(i));
  assert.ok(moved(seed) > 0.006);
  assert.ok(moved(nearest(new T.Vector3(-at.x, at.y, at.z))) > 0.005);
  assert.equal(moved(nearest(new T.Vector3(0, 0.6, 0))), 0);
  const soften = skinStroke(
    body,
    changed,
    fit,
    [seed],
    new T.Vector3().fromArray(changed.positions, seed * 3).toArray(),
    0.16,
    true,
  ).apply(1);
  const energy = (rows: typeof fit.controls) =>
    rows.reduce((a, [, x, y, z]) => a + x * x + y * y + z * z, 0);
  assert.ok(energy(soften.controls) < energy(fit.controls));
  assert.deepEqual(single.apply(1), { controls: [] });
  assert.equal(correctedSurface(body, bare, undefined), bare);
});
