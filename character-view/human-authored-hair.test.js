import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { generatedHuman } from "./human-form.js";
import { surfaceBody } from "./human-fringe.js";
import { evaluateHuman } from "./human-surface.js";
import { hairRoots } from "./human-style-hair.js";
import { additionalHair, libraryHair, libraryPieces, tintedStrands } from "./human-library.js";
import { authoredAssets, authoredCredits, authoredFacialHair, authoredHair, settleAuthored } from "./human-authored-hair.js";
import { adultStyles, dressHuman, hairWornFor, validAdultStyle } from "./human-wardrobe.js";

const material = () => new T.MeshStandardMaterial();
const heads = {
  resting: {},
  slight: { height: 1.66, frame: -0.9 },
  heavy: { height: 1.9, frame: 0.9, weight: 0.9, age: 0.8 },
  wide: { height: 1.5, frame: 0.6, weight: 0.9, headWidth: 1, forehead: 1, temples: 1 },
  narrow: { height: 1.95, frame: -0.8, weight: -0.7, headWidth: -1, forehead: -1, temples: -1 },
};
const wear = (surface, hair, game = true) => libraryPieces(surface, { hair, fringe: "Swept right", hairColor: "#72553d" }, material, false, game);
const cardsOf = (meshes) => meshes.find((mesh) => mesh.userData.libraryHair);
const rootsOf = (meshes) => meshes.find((mesh) => mesh.userData.hairRoots);
function area(geometry) {
  const p = geometry.attributes.position, index = geometry.index.array, tri = new T.Triangle();
  let sum = 0;
  for (let t = 0; t < index.length; t += 3) sum += tri.setFromAttributeAndIndices(p, index[t], index[t + 1], index[t + 2]).getArea();
  return sum;
}

test("every hair name a look can hold resolves to a packed groom, and each authored groom names its author and CC0", () => {
  for (const [name, groom] of Object.entries(libraryHair)) {
    assert.ok(adultStyles.hair.includes(name) && validAdultStyle({ hair: name }), name + " saves and opens");
    assert.ok(cardsOf(wear(evaluateHuman({}), name, false)), `${name} (${groom}) builds`);
  }
  for (const name of ["Blunt bob", "Low ponytail", "Long centre part", "Side-swept pixie", "Swept crop", "Rounded bob", "Crown braid", "Natural curls"])
    assert.ok(libraryHair[name], name);
  for (const [name, groom] of Object.entries(authoredHair)) {
    assert.equal(libraryHair[name], groom);
    assert.ok(Object.hasOwn(additionalHair, name), name + " is left out of the draw list");
  }
  for (const [name, record] of Object.entries(authoredAssets)) {
    const { author, licence, source, pack, fileLicenceLine } = record.credit;
    assert.ok(author && source.startsWith("http") && pack !== undefined, name + " credit");
    assert.equal(licence, "CC0 1.0", name);
    assert.match(fileLicenceLine, /CC0/i, name + " records the CC0 release of its own file");
    assert.equal(Boolean(record.rootIds), !record.facial, name + " records the scalp it covers");
  }
  for (const style of [...Object.keys(authoredHair), ...Object.keys(authoredFacialHair)]) assert.ok(authoredCredits[style]?.author, style + " is credited");
});

test("authored hair builds on unusual heads with finite points, map coordinates and the exporter's hair tag", () => {
  for (const [label, human] of Object.entries(heads)) {
    const surface = evaluateHuman(human);
    for (const name of [...Object.keys(authoredHair), "Low ponytail", "Long centre part", "Side-swept pixie"])
      for (const game of [false, true]) {
        const meshes = wear(surface, name, game), cards = cardsOf(meshes), roots = rootsOf(meshes), g = cards.geometry;
        assert.ok(cards && roots, `${label}, ${name}`);
        assert.equal(cards.material.userData.hairCards, true);
        assert.ok(cards.material.alphaTest > 0 && cards.material.alphaTest < 0.34, name + " keeps its thin painted layers solid");
        assert.equal(g.attributes.uv.count, g.attributes.position.count);
        for (const mesh of [cards, roots]) for (const x of mesh.geometry.attributes.position.array) if (!Number.isFinite(x)) assert.fail(`${label}, ${name}: a point of ${mesh.name} is not a number`);
        for (const x of g.attributes.uv.array) if (!(x >= 0 && x <= 1)) assert.fail(`${label}, ${name}: a card reads outside its picture`);
        for (const x of g.attributes.normal.array) if (!Number.isFinite(x)) assert.fail(`${label}, ${name}: a normal is not a number`);
      }
  }
});

test("the roots under an authored groom end at its own hairline", () => {
  for (const human of [heads.resting, heads.heavy]) {
    const surface = evaluateHuman(human), whole = area(hairRoots(surfaceBody(surface)).mesh(material(), "head", "Hair roots").geometry);
    const of = (name) => area(rootsOf(wear(surface, name)).geometry);
    for (const name of ["Tied bun", "Layered short", "Low ponytail"]) assert.ok(of(name) < 1.15 * whole && of(name) > 0.6 * whole && Math.abs(of(name) - whole) > 0.01 * whole, `${name}: ${(of(name) / whole).toFixed(2)} of the cap`);
    assert.ok(of("Receding short") < 0.92 * of("Layered short"), `receding ${(of("Receding short") / of("Layered short")).toFixed(2)} of layered`);
    for (const name of ["Tied bun", "Receding short"]) {
      const meshes = wear(surface, name), cards = new T.Box3().setFromBufferAttribute(cardsOf(meshes).geometry.attributes.position), roots = new T.Box3().setFromBufferAttribute(rootsOf(meshes).geometry.attributes.position);
      assert.ok(roots.max.z < cards.max.z + 0.012, `${name} roots stay behind its hairline`);
    }
  }
});

test("hair that stands off the head keeps its combed shape on a heavy neck and shoulders", () => {
  for (const name of ["Sleek bob", "Angled bob", "Curled-under bob", "Fringed bob"]) {
    const rest = cardsOf(wear(evaluateHuman(heads.resting), name)).geometry, heavy = cardsOf(wear(evaluateHuman(heads.heavy), name)).geometry;
    assert.equal(rest.index.count, heavy.index.count);
    const a = rest.attributes.position, b = heavy.attributes.position, box = new T.Box3().setFromBufferAttribute(a), hem = box.min.y + 0.45 * (box.max.y - box.min.y);
    const u = new T.Vector3(), v = new T.Vector3();
    let edges = 0, bent = 0;
    for (let t = 0; t < rest.index.count; t += 3)
      for (let k = 0; k < 3; k++) {
        const i = rest.index.array[t + k], j = rest.index.array[t + (k + 1) % 3];
        if (a.getY(i) > hem || a.getY(j) > hem) continue;
        const before = u.fromBufferAttribute(a, i).distanceTo(v.fromBufferAttribute(a, j)), after = u.fromBufferAttribute(b, i).distanceTo(v.fromBufferAttribute(b, j));
        if (before < 1e-4) continue;
        edges++;
        if (after / before < 0.8 || after / before > 1.45) bent++;
      }
    assert.ok(edges > 200 && bent / edges < 0.04, `${name}: ${bent} of ${edges} hem edges changed length`);
  }
  const anchorRest = new Float32Array([0, 1.7, 0, 0.1, 1.7, 0, -0.1, 1.6, 0.05, 0, 1.6, -0.1, 0.05, 1.65, 0.1, -0.05, 1.75, 0, 0.02, 1.62, 0.02, 0, 1.7, 0.1, 0.03, 1.66, 0, 0, 1.7, 0]);
  const anchor = anchorRest.map((x, i) => (i % 3 === 0 ? x * 1.1 : i % 3 === 1 ? x + 0.02 : x));
  const offsets = new Float32Array(30), onSkull = new Uint8Array(10).fill(1);
  offsets.set([0, 0.05, 0], 0);
  offsets.set([0, 0.001, 0], 3);
  const p = anchor.map((x, i) => x + offsets[i] * 3);
  const before = p.slice();
  settleAuthored(p, anchor, anchorRest, offsets, onSkull);
  assert.ok(Math.abs(p[1] - (1.7 + 0.05 + 0.02)) < 1e-4, "a far vertex stands as far off as it was combed");
  assert.deepEqual(Array.from(p.subarray(3, 6)), Array.from(before.subarray(3, 6)), "a vertex on the skin stays where it was fitted");
});

test("ordinary draws wear authored grooms for the cuts that have one, the same every time", () => {
  const worn = new Map();
  for (let seed = 20000; seed < 20300; seed++) {
    const form = generatedHuman(seed), style = dressHuman(form, (seed ^ 0x1e18ae83) >>> 0).humanStyle;
    assert.ok(validAdultStyle(style), `seed ${seed} saves and opens`);
    assert.equal(dressHuman(form, (seed ^ 0x1e18ae83) >>> 0).humanStyle.hair, style.hair, `seed ${seed} draws the same hair again`);
    worn.set(style.hair, (worn.get(style.hair) ?? 0) + 1);
  }
  const authored = [...worn].filter(([name]) => assets(name)).reduce((sum, [, n]) => sum + n, 0);
  assert.ok(authored >= 0.3 * 300, `${authored} of 300 draws wear a groom packed with its credit`);
  for (const name of ["Layered short", "Tied bun", "Low ponytail", "Long centre part"]) assert.ok((worn.get(name) ?? 0) >= 5, `${name}: ${worn.get(name) ?? 0}`);
  assert.ok(["Sleek bob", "Fringed bob", "Angled bob", "Curled-under bob"].filter((name) => worn.get(name)).length >= 3);
  assert.ok((worn.get("Receding short") ?? 0) >= 1, "some older draws are receding");
  for (const name of ["Bun", "Ponytail", "Long"]) assert.equal(worn.get(name), undefined, name);
  for (const drawn of ["Bob", "Bun", "Ponytail", "Long", "Wavy", "Crop", "Side part", "Swept back", "Swept crop"]) for (const name of hairWornFor(drawn)) assert.ok(adultStyles.hair.includes(name), name);
  function assets(name) { return Boolean(authoredAssets[libraryHair[name]]); }
});

test("without a canvas a groom has no tinted picture and its cards are not cut out by one", () => {
  assert.equal(tintedStrands("short_layered", "#72553d"), null);
  const cards = cardsOf(wear(evaluateHuman({}), "Layered short"));
  assert.equal(cards.material.map, null);
});
