import test from "node:test";
import assert from "node:assert/strict";
import { evaluateHuman } from "./human-surface.js";
import { generatedHuman } from "./human-form.js";
import { adultStyles, chooseAdultStyle, dressHuman, validAdultStyle, hairWornFor } from "./human-wardrobe.js";
import { sculptedHair, sculptedStyles } from "./human-sculpt-hair.js";
import { facePlaneStyles } from "./human-face-planes.js";
import { probeHair } from "./human-hair-probe.js";

const material = () => ({ clone() { return {}; } });
const heads = {
  slim: { height: 1.66, frame: -0.9 },
  broad: { height: 1.8, frame: 0.9 },
  wide: { height: 1.5, frame: 0.6, weight: 0.9, headWidth: 1, forehead: 1, temples: 1, eyeSpacing: 1 },
  narrow: { height: 1.95, frame: -0.8, weight: -0.7, headWidth: -1, forehead: -1, temples: -1, eyeSpacing: -1, eyeSize: 1 },
};
const worst = (views) => Math.max(...Object.values(views).flat());
const tris = (meshes) => meshes.reduce((sum, mesh) => sum + mesh.geometry.index.count / 3, 0);

test("sculpted hairstyles are opt-in in adultStyles and never change random seed draws", () => {
  assert.deepEqual(sculptedStyles, ["Sculpted crop", "Sculpted bob", "Sculpted tie-back"]);
  for (const name of sculptedStyles) {
    assert.ok(adultStyles.hair.includes(name) && validAdultStyle({ hair: name, fringe: "Parted" }), name);
  }
  for (const mode of facePlaneStyles) {
    assert.ok(adultStyles.facePlanes.includes(mode) && validAdultStyle({ hair: "Sculpted crop", facePlanes: mode }), mode);
  }
  for (const [seed, drawn, fitted] of [
    [8710, "Bob", "Blunt bob"],
    [8711, "Crown braid"],
    [8713, "Rounded bob", "Blunt bob"],
    [8714, "Ponytail", "Low ponytail"],
    [8715, "Long", "Long centre part"],
    [8807, "Rounded bob", "Blunt bob"],
    [8808, "Bun"],
    [8810, "Natural curls"],
    [8811, "Ponytail", "Low ponytail"],
  ]) {
    const wear = () => dressHuman(generatedHuman(seed), seed ^ 0x1e18ae83).humanStyle.hair, hair = wear();
    assert.ok(hairWornFor(drawn).includes(hair), `seed ${seed} wears ${hair}, not a groom of ${drawn}`);
    assert.ok(!sculptedStyles.includes(hair), `seed ${seed} did not draw a sculpted style`);
    assert.equal(wear(), hair, `seed ${seed} draws the same hair again`);
    for (const saved of [drawn, fitted].filter(Boolean)) assert.equal(chooseAdultStyle({ hair: saved }, { outfit: "Parka" }).hair, saved);
  }
  for (let seed = 8600; seed < 8660; seed++) {
    const hair = dressHuman(generatedHuman(seed), seed ^ 0x1e18ae83).humanStyle.hair;
    assert.ok(!sculptedStyles.includes(hair), `seed ${seed} did not randomly draw ${hair}`);
  }
  assert.equal(chooseAdultStyle({ hair: "Sculpted crop", hairColor: "#995f47" }, { outfit: "Parka" }).hair, "Sculpted crop");
  assert.deepEqual(sculptedHair(evaluateHuman(heads.slim), { hair: "Bun" }, material, true), []);
});

test("sculpted hair materials are fully opaque with vertex colors and fibreLOD retention", () => {
  const surface = evaluateHuman(heads.slim);
  for (const hair of sculptedStyles) {
    const meshes = sculptedHair(surface, { hair, fringe: "Parted", hairColor: "#995f47" }, material, false, "#c9a48c", 9600);
    assert.equal(meshes.length, 2, hair);
    const [roots, locks] = meshes;
    assert.equal(roots.userData.hairRoots, true);
    assert.equal(locks.userData.sculptedHair, true);
    assert.equal(locks.material.userData.fibreLOD, true);
    assert.ok(!locks.material.alphaTest && !locks.material.transparent, `${hair} is opaque`);
    assert.ok(locks.material.vertexColors && roots.material.vertexColors, `${hair} uses vertex colors`);
    assert.ok(locks.geometry.attributes.color && roots.geometry.attributes.color, `${hair} writes color attribute`);
  }
});

test("all sculpted hairstyles cover the scalp, clear eyes and neck, and stay within game budget across edited heads", () => {
  for (const [name, human] of Object.entries(heads)) {
    const surface = evaluateHuman(human);
    for (const hair of sculptedStyles) {
      for (const fringe of name === "slim" ? ["Parted", "Swept left", "Off the face"] : ["Parted"]) {
        const meshes = sculptedHair(surface, { hair, fringe, hairColor: "#543f35" }, material, true, "#a97d65", 9600);
        const label = `${name}, ${hair}, ${fringe}`;
        assert.equal(meshes.length, 2, label);
        for (const mesh of meshes) {
          for (const x of mesh.geometry.attributes.position.array) {
            if (!Number.isFinite(x)) assert.fail(`${label}: non-finite position in ${mesh.name}`);
          }
          assert.equal(mesh.humanWeights.weights.length, mesh.geometry.attributes.position.count * 4, label);
        }
        const all = probeHair(surface, meshes);
        const lockMesh = meshes.find((m) => m.userData.sculptedHair);
        const lockProbe = probeHair(surface, [lockMesh]);
        assert.equal(worst(all.eyes), 0, `${label}: hides eyes`);
        assert.ok(worst(all.face) <= 0.02, `${label}: hides ${Math.round(100 * worst(all.face))}% of face`);
        assert.ok(all.scalp.bare <= 0.002, `${label}: ${(100 * all.scalp.bare).toFixed(2)}% scalp bare`);
        assert.equal(lockProbe.inside.below, 0, `${label}: ${lockProbe.inside.below} lock verts in neck`);
        assert.ok(lockProbe.inside.count <= 2 && lockProbe.inside.deepest <= 0.0025, `${label}: inside=${lockProbe.inside.count}, deep=${(1000 * lockProbe.inside.deepest).toFixed(1)}mm`);
        assert.ok(tris([lockMesh]) <= 4500, `${label}: ${tris([lockMesh])} lock tris exceeds game target`);
      }
    }
  }
});
