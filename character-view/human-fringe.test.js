import test from "node:test";
import assert from "node:assert/strict";
import { evaluateHuman } from "./human-surface.js";
import { styleHuman } from "./human-style.js";
import { libraryPieces } from "./human-library.js";
import { generatedHuman } from "./human-form.js";
import { adultStyles, dressHuman, validAdultStyle } from "./human-wardrobe.js";
import { combFringe, fringeStyles, hairline, surfaceFrame } from "./human-fringe.js";
import { probeHair } from "./human-hair-probe.js";

const material = () => ({ clone() { return {}; } });
const heads = {
  slim: { height: 1.66, frame: -0.9 },
  wide: { height: 1.5, frame: 0.6, weight: 0.9, headWidth: 1, forehead: 1, temples: 1, eyeSpacing: 1 },
  narrow: { height: 1.95, frame: -0.8, weight: -0.7, headWidth: -1, forehead: -1, temples: -1, eyeSpacing: -1, eyeSize: 1 },
};
const groom = (surface, style) => [...styleHuman(surface, style, material), ...libraryPieces(surface, style, material, true)];
const cards = meshes => meshes.filter(mesh => !mesh.userData.hairRoots);
const worst = views => Math.max(...Object.values(views).flat());

test("the head frame finds both eyes and places points over the skull", () => {
  for (const [name, human] of Object.entries(heads)) {
    const f = surfaceFrame(evaluateHuman(human)), [left, right] = f.eyes;
    assert.ok(left.phi > 0.1 && right.phi < -0.1, `${name}: the wearer's left eye is at positive azimuth`);
    assert.ok(Math.abs(left.eps - right.eps) < 0.02 && left.eps < hairline(left.phi) - 0.3, `${name}: the eyes sit well below the hairline`);
    for (const [phi, eps, h] of [[0, 0.3, 0.01], [0.6, -0.1, 0.02], [-2.4, 0.5, 0.004]]) {
      const at = f.over(f.place(phi, eps, h));
      assert.ok(Math.abs(at.phi - phi) < 1e-6 && Math.abs(at.eps - eps) < 1e-6 && Math.abs(at.h - h) < 1e-6, `${name}: a placed point reads back`);
    }
  }
});

test("a look saved without a fringe stays as it was cut", () => {
  const surface = evaluateHuman(heads.slim);
  for (const hair of ["Bob", "Rounded bob"]) {
    const plain = groom(surface, { hair }), cut = groom(surface, { hair, fringe: "As cut" });
    assert.equal(plain.length, cut.length);
    plain.forEach((mesh, i) => assert.deepEqual(mesh.geometry.attributes.position.array, cut[i].geometry.attributes.position.array, `${hair}: ${mesh.name}`));
  }
  const points = new Float32Array([0, surface.height * 0.93, 0.12]);
  assert.equal(combFringe(points, surfaceFrame(surface), "As cut"), 0);
  assert.equal(combFringe(points, surfaceFrame(surface), "no such fringe"), 0);
});

test("every way of wearing a fringe shows both eyes without baring scalp or entering the head", () => {
  for (const [name, human] of Object.entries(heads)) {
    const surface = evaluateHuman(human);
    for (const hair of ["Bob", "Rounded bob", "Crown braid"]) {
      const before = probeHair(surface, cards(groom(surface, { hair })));
      for (const fringe of fringeStyles.slice(1)) {
        const meshes = groom(surface, { hair, fringe }), after = probeHair(surface, cards(meshes)), label = `${name}, ${hair}, ${fringe}`;
        for (const mesh of meshes) for (const x of mesh.geometry.attributes.position.array) if (!Number.isFinite(x)) assert.fail(`${label}: ${mesh.name} has a position that is not a number`);
        assert.ok(worst(after.eyes) <= 0.02, `${label}: hides ${Math.round(100 * worst(after.eyes))}% of an eye`);
        assert.ok(worst(after.face) <= 0.02, `${label}: hides ${Math.round(100 * worst(after.face))}% of the face`);
        assert.ok(after.scalp.bare <= before.scalp.bare + 0.005, `${label}: bares ${(100 * after.scalp.bare).toFixed(1)}% of the scalp, ${(100 * before.scalp.bare).toFixed(1)}% as cut`);
        assert.ok(after.inside.count <= before.inside.count + 4, `${label}: ${after.inside.count} hair points are inside the head, ${before.inside.count} as cut`);
      }
    }
  }
});

test("the rounded bob as cut is the case the comb exists for", () => {
  const surface = evaluateHuman(heads.slim), cut = probeHair(surface, cards(groom(surface, { hair: "Rounded bob" })));
  assert.ok(worst(cut.eyes) > 0.9, "as cut it covers an eye");
});

test("library hair wears roots that cover the scalp", () => {
  const surface = evaluateHuman(heads.narrow), meshes = groom(surface, { hair: "Swept crop" });
  assert.ok(meshes.some(mesh => mesh.userData.hairRoots && mesh.humanWeights), "the roots are a skinned mesh");
  assert.ok(probeHair(surface, cards(meshes)).scalp.bare > 0.02, "the cards alone leave scalp bare on this head");
  assert.ok(probeHair(surface, meshes).scalp.bare < 0.002, "with the roots nothing is bare");
});

test("styles accept a fringe, and a new look draws one that clears the eyes", () => {
  assert.deepEqual(adultStyles.fringe, fringeStyles);
  assert.ok(validAdultStyle({ hair: "Bob" }), "a look saved before fringes existed is still valid");
  assert.ok(validAdultStyle({ hair: "Bob", fringe: "Swept left" }));
  assert.ok(!validAdultStyle({ hair: "Bob", fringe: "Sideways" }));
  for (const seed of [8710, 8713, 8714]) {
    const look = dressHuman(generatedHuman(seed), seed ^ 0x1e18ae83).humanStyle;
    assert.ok(fringeStyles.includes(look.fringe) && look.fringe !== "As cut", `seed ${seed} draws ${look.fringe}`);
  }
});
