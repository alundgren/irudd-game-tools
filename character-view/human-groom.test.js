import test from "node:test";
import assert from "node:assert/strict";
import { evaluateHuman } from "./human-surface.js";
import { generatedHuman } from "./human-form.js";
import { adultStyles, chooseAdultStyle, dressHuman, validAdultStyle, hairWornFor } from "./human-wardrobe.js";
import { fringeStyles } from "./human-fringe.js";
import { groomGeometry, groomStyles, strandGroom, tuftPixels } from "./human-groom.js";
import { probeHair } from "./human-hair-probe.js";

const material = () => ({ clone() { return {}; } });
const heads = {
  slim: { height: 1.66, frame: -0.9 },
  broad: { height: 1.8, frame: 0.9 },
  wide: { height: 1.5, frame: 0.6, weight: 0.9, headWidth: 1, forehead: 1, temples: 1, eyeSpacing: 1 },
  narrow: { height: 1.95, frame: -0.8, weight: -0.7, headWidth: -1, forehead: -1, temples: -1, eyeSpacing: -1, eyeSize: 1 },
};
const worst = views => Math.max(...Object.values(views).flat());
const triangles = meshes => meshes.reduce((sum, mesh) => sum + mesh.geometry.index.count / 3, 0);

test("strand grooms are hairstyles an artist can choose, beside every earlier one", () => {
  assert.deepEqual(groomStyles, ["Tapered crop", "Horseshoe crop", "Close crop"]);
  for (const name of groomStyles) assert.ok(adultStyles.hair.includes(name) && validAdultStyle({ hair: name, fringe: "Swept left" }), name);
  for (const earlier of ["Swept crop", "Crop", "Rounded bob", "Coiled crop"]) assert.ok(validAdultStyle({ hair: earlier }), `${earlier} still opens`);
  assert.deepEqual(strandGroom(evaluateHuman(heads.slim), { hair: "Swept crop" }, material, true), []);
});

test("in colour the strands are a plain cutout that casts no shadow, over roots that do", () => {
  const [roots, strands] = strandGroom(evaluateHuman(heads.slim), { hair: "Tapered crop" }, material, false, "#96735d");
  assert.ok(strands.material.map && strands.material.alphaTest > 0 && !strands.material.alphaToCoverage && !strands.material.transparent);
  assert.deepEqual([roots.castShadow, strands.castShadow], [true, false]);
});

test("new fitted cuts stay in their drawn haircut family and every saved cut remains selectable", () => {
  // Each seed wears one of the fitted grooms listed for the cut it drew. The cut itself and the grooms a draw
  // wore before stay styles to choose by hand.
  const cuts = [
    [8710, "Bob", "Blunt bob"], [8711, "Crown braid"], [8713, "Rounded bob", "Blunt bob"],
    [8714, "Ponytail", "Low ponytail"], [8715, "Long", "Long centre part"],
  ];
  for (const [seed, drawn, ...earlier] of cuts) {
    const form = generatedHuman(seed);
    const styled = dressHuman(form, seed ^ 0x1e18ae83).humanStyle;
    assert.ok(hairWornFor(drawn).includes(styled.hair), `seed ${seed} wears ${styled.hair}`);
    assert.ok(validAdultStyle(styled), `seed ${seed} is a style that saves and opens`);
    for (const hair of [drawn, ...earlier, ...hairWornFor(drawn)]) assert.equal(chooseAdultStyle({ hair }, { outfit: "Parka" }).hair, hair);
  }
  assert.deepEqual(hairWornFor("Bun"), ["Tied bun"]);
  assert.ok(hairWornFor("Crop").includes("Crop") && hairWornFor("Crop").includes("Receding short"));
});

test("a new look that draws the swept crop wears a fitted short cut or the tapered crop, and nothing else about it changes", () => {
  // These seeds drew the swept crop. Their colours, fringe, facial hair and eyewear are the ones they always drew.
  for (const [seed, hairColor, fringe, facialHair, eyewear] of [[8607, "#cfbfa8", "Parted", "None", "None"], [8672, "#995f47", "Swept right", "None", "None"], [8674, "#504041", "Parted", "None", "Round wire"]]) {
    const style = dressHuman(generatedHuman(seed), seed ^ 0x1e18ae83).humanStyle;
    assert.ok(hairWornFor("Swept crop").includes(style.hair), `seed ${seed} wears ${style.hair}`);
    assert.deepEqual([style.hairColor, style.fringe, style.facialHair, style.eyewear], [hairColor, fringe, facialHair, eyewear], `seed ${seed}`);
    assert.ok(validAdultStyle(style), `seed ${seed} is a style that saves and opens`);
  }
  let tapered = 0;
  for (let seed = 8600; seed < 8700; seed++) {
    const hair = dressHuman(generatedHuman(seed), seed ^ 0x1e18ae83).humanStyle.hair;
    assert.notEqual(hair, "Swept crop", `seed ${seed}`);
    assert.notEqual(hair, "Close crop", `seed ${seed}`);
    if (hair === "Tapered crop") tapered++;
  }
  assert.ok(tapered >= 1, `${tapered} of 100 looks wear the tapered crop`);
  // A look that names the swept crop keeps it: by hand, from a saved file, and through later style changes.
  assert.ok(adultStyles.hair.includes("Swept crop") && validAdultStyle({ hair: "Swept crop", fringe: "Swept left" }));
  assert.equal(chooseAdultStyle({ hair: "Swept crop", hairColor: "#302725" }, { outfit: "Parka" }).hair, "Swept crop");
});

test("a groom covers the scalp, clears the ears and the face, and follows unusual heads", () => {
  for (const [name, human] of Object.entries(heads)) {
    const surface = evaluateHuman(human);
    for (const hair of ["Tapered crop", "Close crop"]) for (const fringe of name === "slim" ? fringeStyles : ["As cut", "Swept right"]) {
      const meshes = strandGroom(surface, { hair, fringe }, material, true), label = `${name}, ${hair}, ${fringe}`;
      assert.equal(meshes.length, 2, label);
      assert.deepEqual(meshes.map(mesh => mesh.castShadow), [true, false], `${label}: the roots cast the shadow of the hair`);
      for (const mesh of meshes) {
        for (const x of mesh.geometry.attributes.position.array) if (!Number.isFinite(x)) assert.fail(`${label}: ${mesh.name} has a position that is not a number`);
        assert.equal(mesh.humanWeights.weights.length, mesh.geometry.attributes.position.count * 4, `${label}: ${mesh.name} is skinned`);
      }
      const all = probeHair(surface, meshes), cards = probeHair(surface, meshes.filter(mesh => mesh.userData.strandGroom));
      assert.ok(worst(all.eyes) === 0 && worst(all.face) <= 0.01, `${label}: hides ${Math.round(100 * worst(all.eyes))}% of an eye, ${Math.round(100 * worst(all.face))}% of the face`);
      assert.ok(all.scalp.bare <= 0.002, `${label}: ${(100 * all.scalp.bare).toFixed(1)}% of the scalp is bare`);
      // The whole figure is the test surface, so a card through an ear or the neck counts.
      assert.equal(cards.inside.count + cards.inside.below, 0, `${label}: ${cards.inside.count} card points are inside the head, ${cards.inside.below} in the neck`);
      assert.ok(triangles(meshes) <= 14000, `${label}: ${triangles(meshes)} triangles`);
      // No strand leaves the scalp for another surface: every card edge is as short as a strand segment.
      const strands = meshes.find(mesh => mesh.userData.strandGroom).geometry, at = strands.attributes.position, index = strands.index.array;
      let longest = 0;
      for (let i = 0; i < index.length; i += 3) for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) longest = Math.max(longest, Math.hypot(at.getX(index[i + a]) - at.getX(index[i + b]), at.getY(index[i + a]) - at.getY(index[i + b]), at.getZ(index[i + a]) - at.getZ(index[i + b])));
      assert.ok(longest < 0.04, `${label}: a card edge is ${(1000 * longest).toFixed(0)} mm long`);
    }
  }
});

test("the root layer is a real layer that stays on the head", () => {
  // No root of the root layer may sit on an ear, on any head. Every vertex of that layer lies on the skin it was lifted from.
  for (const [name, human] of Object.entries(heads)) {
    const surface = evaluateHuman(human), { roots } = groomGeometry(surface, { hair: "Tapered crop" });
    const probe = probeHair(surface, strandGroom(surface, { hair: "Tapered crop" }, material, true).filter(mesh => mesh.userData.hairRoots));
    assert.equal(probe.inside.below, 0, `${name}: the roots stay off the neck`);
    assert.ok(roots.position.length / 3 > 800, `${name}: the roots are a real layer`);
  }
});

test("combing changes where the hair lies without changing where it grows", () => {
  const surface = evaluateHuman(heads.slim), cut = groomGeometry(surface, { hair: "Tapered crop" }), swept = groomGeometry(surface, { hair: "Tapered crop", fringe: "Swept left" });
  assert.deepEqual(cut.roots.index, swept.roots.index);
  assert.notDeepEqual(cut.cards.position.slice(0, 600), swept.cards.position.slice(0, 600));
  assert.deepEqual(groomGeometry(surface, { hair: "Tapered crop" }).cards.position, cut.cards.position, "the same look builds the same hair");
  assert.equal(groomGeometry(surface, { hair: "Tapered crop", fringe: "no such fringe" }).look, "As cut");
});

test("a game model gets fewer, wider cards that its export keeps whole", () => {
  const surface = evaluateHuman(heads.broad), full = strandGroom(surface, { hair: "Tapered crop" }, material, true), game = strandGroom(surface, { hair: "Tapered crop" }, material, true, undefined, 9600);
  const cards = meshes => meshes.find(mesh => mesh.userData.strandGroom);
  assert.ok(cards(game).geometry.index.count / 3 <= 9600 * 0.3, `${cards(game).geometry.index.count / 3} card triangles in a game model`);
  assert.ok(cards(game).geometry.index.count < cards(full).geometry.index.count / 2);
  assert.equal(cards(game).material.userData.fibreLOD, true);
  assert.ok(probeHair(surface, game).scalp.bare <= 0.002, "the roots still cover the scalp");
});

test("the strand artwork is drawn once, with clear gutters round every tuft", () => {
  const art = tuftPixels();
  assert.equal(art, tuftPixels());
  assert.equal(art.data.length, art.width * art.height * 4);
  let solid = 0;
  for (let i = 3; i < art.data.length; i += 4) if (art.data[i] > 128) solid++;
  const share = solid / (art.width * art.height);
  assert.ok(share > 0.3 && share < 0.75, `${Math.round(100 * share)}% of the artwork is strand`);
  for (let x = 0; x < art.width; x++) for (const y of [0, 127, 128, 191, 192, 255]) assert.equal(art.data[(y * art.width + x) * 4 + 3], 0, `row ${y} is a gutter`);
});
