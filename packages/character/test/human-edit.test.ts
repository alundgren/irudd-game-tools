import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { decodeWith } from "@irudd/document";
import {
  changeMeasurement,
  chooseAdultStyle,
  drawAdult,
  HumanAdultParams,
  loadHumanPacks,
  lookDirections,
  measurementGroups,
  newHumanLook,
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
