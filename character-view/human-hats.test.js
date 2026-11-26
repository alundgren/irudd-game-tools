import assert from "node:assert/strict";
import test from "node:test";
import * as T from "three";
import { evaluateHuman } from "./human-surface.js";
import { drawHumanIdentity, generatedHuman } from "./human-form.js";
import { surfaceFrame } from "./human-fringe.js";
import { adultStyles, chooseAdultStyle, dressHuman, dressedHuman, validAdultStyle } from "./human-wardrobe.js";
import { completeLook, lookDirections } from "./human-looks.js";
import { drawHat, fittedHat, hatColour, hatHead, hatStyles } from "./human-hats.js";
import { everydayClothes, attireCredits } from "./human-attire.js";
import { validateForm } from "./recipe.js";

const material = () => new T.MeshStandardMaterial();
const hats = hatStyles.slice(1);
const room = (style, f) => (["None", "Buzz cut"].includes(style.hair) ? .0032 : .006) * f.k;
const people = [53300, 53302, 53306, 53308].map(seed => { const base = generatedHuman(seed); return { seed, form: { ...base, ...dressHuman(base, seed, "Any") } }; });

test("a hat is a listed, saved and validated style choice with its own colour", () => {
  assert.deepEqual(adultStyles.hat, hatStyles);
  assert.ok(hats.length >= 3);
  assert.ok(validAdultStyle({ hat: "Beret", hatColor: "#7a2d3a" }));
  assert.ok(!validAdultStyle({ hat: "Top hat" }) && !validAdultStyle({ hatColor: "red" }));
  assert.equal(hatColour({ hatColor: "#123456" }), "#123456");
  assert.equal(hatColour({ clothSecond: "#445566" }), "#445566");
  const form = { ...people[0].form, humanStyle: { ...people[0].form.humanStyle, hat: "Flat cap", hatColor: "#4c463f" } };
  validateForm(form);
  assert.equal(JSON.parse(JSON.stringify(form)).humanStyle.hat, "Flat cap");
});

test("every hat stands clear of the scalp and the ears on small and large heads, with outward faces", () => {
  for (const { seed, form } of people) for (const hat of hats) {
    const surface = evaluateHuman(form.human, form.humanFit), f = hatHead(surfaceFrame(surface));
    const meshes = fittedHat(surface, { ...form.humanStyle, hat }, [], material, true), gap = room(form.humanStyle, f);
    assert.ok(meshes.length && meshes.every(mesh => mesh.userData.styleRegion === "head" && mesh.userData.hat === hat), hat);
    let lowest = Infinity, crown = 0, outward = 0, triangles = 0;
    for (const mesh of meshes) {
      const p = mesh.geometry.attributes.position, n = mesh.geometry.attributes.normal;
      triangles += mesh.geometry.index.count / 3;
      assert.equal(mesh.geometry.attributes.uv.count, p.count, hat + " is charted");
      assert.ok(mesh.humanWeights.weights.length === p.count * 4 && mesh.material.userData.fibreLOD, hat + " is rigid on the head");
      for (let i = 0; i < p.count; i++) {
        const o = f.over([p.getX(i), p.getY(i), p.getZ(i)]);
        assert.ok(Number.isFinite(o.h) && o.h < (hat === "Flying cap and goggles" && o.eps < -.35 ? .18 : .09), `${hat} on ${seed}: a point lies ${o.h} m off the head`);
        lowest = Math.min(lowest, o.h);
        if (mesh.name === hat && o.eps > .75) {
          crown++;
          assert.ok(o.h > gap * .98, `${hat} on ${seed}: crown ${o.h} under ${gap}`);
          if (n.getX(i) * o.u[0] + n.getY(i) * o.u[1] + n.getZ(i) * o.u[2] > 0) outward++;
        }
      }
    }
    assert.ok(lowest > -.0045, `${hat} on ${seed} sinks ${lowest} m into the head`);
    if (hat === "Flying cap and goggles") {
      assert.ok(crown >= 30 && outward === crown, "the flying cap has one outward-facing crown");
    } else {
      assert.ok(crown > 80 && outward > crown * .97, hat + " faces outward");
    }
    const limit = hat === "Flying cap and goggles" ? 4800 : 1800;
    assert.ok(triangles > 700 && triangles < limit, hat + " has " + triangles + " triangles");
    assert.ok(Number.isFinite(f.earTop), hat);
  }
});

test("hair under a crown is pressed beneath it, hair below the band keeps its length, and the groom itself is not changed", () => {
  const eyewear = /wire|acetate|frames/i;
  const hairOf = meshes => meshes.filter(mesh => mesh.userData.styleRegion === "head" && !mesh.userData.hat && !eyewear.test(mesh.name ?? ""));
  for (const { seed, form } of people) {
    const surface = evaluateHuman(form.human, form.humanFit), f = hatHead(surfaceFrame(surface)), gap = room(form.humanStyle, f);
    const measure = mesh => {
      const p = mesh.geometry.attributes.position;
      let high = 0, low = Infinity;
      for (let i = 0; i < p.count; i++) {
        const o = f.over([p.getX(i), p.getY(i), p.getZ(i)]);
        if (o.eps > .9) high = Math.max(high, o.h);
        low = Math.min(low, p.getY(i));
      }
      return { high, low };
    };
    const wear = hat => hairOf(dressedHuman(surface, { ...form, humanStyle: { ...form.humanStyle, hat } }, material, true));
    const bare = wear("None").map(measure);
    for (const hat of hats) {
      const pressed = wear(hat);
      assert.equal(pressed.length, bare.length, hat + " keeps every piece of hair");
      pressed.forEach((mesh, i) => {
        const now = measure(mesh);
        assert.ok(now.high < gap * .75, `${hat} on ${seed}: ${mesh.name} stands ${now.high} m under a crown with ${gap} m of room`);
        assert.ok(Math.abs(now.low - bare[i].low) < .004, `${hat} on ${seed}: ${mesh.name} keeps its length`);
      });
    }
    wear("None").map(measure).forEach((now, i) => assert.ok(Math.abs(now.high - bare[i].high) < 1e-6));
  }
});

test("a hat chosen by hand stays through other choices; a new look brings its own", () => {
  const style = { ...people[1].form.humanStyle, hat: "Beret", hatColor: "#7a2d3a" };
  for (const choice of [{ outfit: "Shift dress" }, { eyewear: "Round wire" }, { hair: "Bob" }, { clothColor: "#335577" }]) {
    const next = chooseAdultStyle(style, choice);
    assert.equal(next.hat, "Beret");
    assert.equal(next.hatColor, "#7a2d3a");
  }
  const pick = ({ hat, hatColor }) => [hat, hatColor];
  assert.deepEqual(pick(dressHuman({ ...people[1].form, humanStyle: style }, 90210, "Any").humanStyle), pick(dressHuman(people[1].form, 90210, "Any").humanStyle));
});

test("new looks wear hats sometimes, with wardrobes that suit them, and never over armour, a pressure suit or piled hair", () => {
  const worn = {}, by = {}, count = 1200;
  let total = 0;
  for (let seed = 81000; seed < 81000 + count; seed++) {
    const base = drawHumanIdentity(seed, undefined, { fitRestingLips: false });
    const look = completeLook(base, seed, "Any"), style = dressHuman(base, seed, "Any").humanStyle;
    assert.ok(hatStyles.includes(style.hat), "every new look names its hat");
    if (style.hat === "None") { assert.ok(!("hatColor" in style)); continue; }
    total++;
    worn[style.hat] = (worn[style.hat] ?? 0) + 1;
    (by[style.hat] ??= new Set()).add(look.wardrobe);
    assert.match(style.hatColor, /^#[0-9a-f]{6}$/);
    assert.ok(!style.armour && !["Pressure suit", "Evening gown", "Parka", "Rope-belted robe", "Mail tunic and boots", "Leather armour", "Traveller"].includes(look.wardrobe), look.wardrobe);
    assert.ok(!/bun|crown braid|natural curls|coil/i.test(style.hair), style.hair);
    assert.ok(validAdultStyle(style));
  }
  assert.ok(total > count * .06 && total < count * .17, "hats in " + total + " of " + count);
  for (const hat of hats) assert.ok(worn[hat] > (hat === "Flying cap and goggles" ? 0 : count * .015), hat + " " + worn[hat]);
  assert.ok(by["Flat cap"].has("Chore jacket") && by["Beret"].has("Day dress") && !by["Beret"].has("Coveralls") && !by["Flat cap"].has("Day dress"));
  const base = generatedHuman(81007), look = completeLook(base, 81007, "Any");
  assert.deepEqual(drawHat(81007, "Any", look, "Bob"), drawHat(81007, "Any", look, "Bob"));
});

test("the everyday ensembles are credited CC0 garments, drawn in everyday directions only and built on any adult", () => {
  for (const [outfit, garments] of Object.entries(everydayClothes)) {
    assert.ok(adultStyles.outfit.includes(outfit) && validAdultStyle({ outfit }));
    assert.ok(attireCredits[outfit].length >= 1 && attireCredits[outfit].every(credit => credit.licence === "CC0 1.0" && credit.author && /makehumancommunity/.test(credit.source)), outfit);
    assert.ok(garments.length >= 2);
  }
  const share = direction => { let n = 0; for (let seed = 1; seed <= 1500; seed++) if (Object.hasOwn(everydayClothes, completeLook(null, seed, direction).wardrobe)) n++; return n / 1500; };
  assert.ok(share("Any") > .06 && share("Any") < .14);
  for (const direction of ["Workwear", "Adventure", "Outdoors"]) assert.equal(share(direction), 0, direction);
  assert.ok(lookDirections.includes("Everyday"));
  const seen = new Set(), all = Object.keys(everydayClothes).length;
  for (let seed = 82000; seed < 82300 && seen.size < all; seed++) {
    const base = generatedHuman(seed), look = completeLook(base, seed, "Everyday");
    if (!Object.hasOwn(everydayClothes, look.wardrobe) || seen.has(look.wardrobe)) continue;
    seen.add(look.wardrobe);
    const form = { ...base, ...dressHuman(base, seed, "Everyday") };
    validateForm(form);
    for (const field of ["clothColor", "clothSecond", "clothLight", "leatherColor"]) assert.match(form.humanStyle[field], /^#[0-9a-f]{6}$/);
    const worn = dressedHuman(evaluateHuman(form.human, form.humanFit), form, material, true);
    assert.ok(worn.hidden.size > 1500 && worn.length > 6, look.wardrobe);
  }
  assert.equal(seen.size, all);
});
