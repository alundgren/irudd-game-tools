import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { generatedHuman } from "./human-form.js";
import { evaluateHuman } from "./human-surface.js";
import { curlPixels, curlTiles } from "./human-curls.js";
import { clumpChart, clumpEdge, clumpField, clumpPixels } from "./human-hair-clumps.js";
import { groomGeometry, strandGroom } from "./human-groom.js";
import { probeHair } from "./human-hair-probe.js";
import { adultStyles, dressHuman, validAdultStyle } from "./human-wardrobe.js";

const styles = ["Coiled crop", "Rounded coils", "Curls", "Afro", "Natural curls"];
const heads = { resting: {}, slight: { height: 1.6, frame: -0.9 }, heavy: { height: 1.9, frame: 0.9, weight: 0.9, age: 0.8 }, wide: { height: 1.5, frame: 0.6, headWidth: 1, forehead: 1, temples: 1 } };
const budget = Math.floor(0.4 * 24000);
const grown = (surface, hair) => groomGeometry(surface, { hair, hairColor: "#44372f", fringe: "As cut" }, { budget });
const material = () => new T.MeshStandardMaterial();
const box = (part) => new T.Box3().setFromBufferAttribute(new T.Float32BufferAttribute(part.position, 3));
const worst = (views) => Math.max(...Object.values(views).flat());

test("the painted curl locks retain shaded cores, lit strands and clear gutters", () => {
  const { width, data } = curlPixels();
  for (const [left, top, wide, tall] of curlTiles) {
    let hair = 0, clear = 0, light = 0, dark = 0;
    for (let y = 0; y < tall; y++) for (let x = 0; x < wide; x++) {
      const at = ((top + y) * width + left + x) * 4, edge = x < 2 || y < 2 || x >= wide - 2 || y >= tall - 2;
      if (edge) assert.equal(data[at + 3], 0, "a tile has a clear gutter");
      if (data[at + 3] > 200) { hair++; if (data[at] > 190) light++; if (data[at] < 150) dark++; } else if (data[at + 3] === 0) clear++;
    }
    assert.ok(hair > 0.14 * wide * tall && clear > 0.35 * wide * tall, "a clump is hair with an open outline");
    assert.ok(light > 0.1 * hair && dark > 0.1 * hair, "a clump has lit strands over hair in shadow");
  }
});

test("the clumps of a style tile the whole head, each ringed by the corners it shares with its neighbours", () => {
  const surface = evaluateHuman({});
  for (const hair of styles) {
    const field = clumpField(grown(surface, hair).curls), shared = new Map();
    assert.ok(field.count > 60, `${hair}: ${field.count} clumps`);
    for (const ring of field.rings) {
      assert.ok(ring.length >= 3, `${hair}: a clump has an outline`);
      for (const corner of ring) shared.set(corner, (shared.get(corner) ?? 0) + 1);
    }
    for (const [corner, count] of shared) assert.equal(count, 3, `${hair}: corner ${corner} is where three clumps meet`);
    assert.ok(field.members.every((ids) => new Set(ids).size === 3));
  }
});

test("every curly style is one mass of whole clumps a game model can carry, on any head", () => {
  for (const [label, human] of Object.entries(heads)) {
    const surface = evaluateHuman(human);
    for (const hair of styles) {
      const { roots, cards, curls } = grown(surface, hair), p = roots.position, n = roots.normal, triangles = roots.index.length / 3;
      assert.ok(curls, hair);
      assert.equal(cards.index.length, 0, `${hair}: no separate cards lie over the mass`);
      assert.ok(triangles > 2500 && triangles <= 0.6 * budget, `${label}, ${hair}: ${triangles} triangles`);
      for (const x of [...p, ...n, ...roots.color]) if (!Number.isFinite(x)) assert.fail(`${label}, ${hair}: not a number`);
      for (const x of roots.uv) if (!(x >= 0 && x <= 1)) assert.fail("the mass reads outside its picture");
      for (const x of roots.color) if (!(x >= 0 && x <= 1.2)) assert.fail("a colour of the mass is out of range");
      assert.equal(roots.weights.length, p.length / 3 * 4);
      // The mass faces out of the hair: next to none of its surface is folded over.
      let folded = 0, whole = 0;
      for (let t = 0; t < roots.index.length; t += 3) {
        const [a, b, c] = [0, 1, 2].map((k) => roots.index[t + k] * 3), u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], v = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
        const g = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], area = Math.hypot(...g);
        whole += area;
        if ([a, b, c].every((x) => g[0] * n[x] + g[1] * n[x + 1] + g[2] * n[x + 2] < 0)) folded += area;
      }
      assert.ok(folded < 0.005 * whole, `${label}, ${hair}: ${(100 * folded / whole).toFixed(2)}% of the mass is folded over`);
      // It covers the scalp to the hairline, stays out of the head and the neck, and leaves the face clear.
      const probe = probeHair(surface, strandGroom(surface, { hair, hairColor: "#44372f" }, material, false, "#96735d", budget));
      assert.ok(probe.scalp.bare <= 0.005, `${label}, ${hair}: ${(100 * probe.scalp.bare).toFixed(2)}% of the scalp is bare`);
      assert.equal(probe.inside.count + probe.inside.below, 0, `${label}, ${hair}: hair inside the head or the neck`);
      assert.equal(worst(probe.eyes), 0, `${label}, ${hair} hides an eye`);
      assert.ok(worst(probe.face) <= 0.04, `${label}, ${hair} hides ${Math.round(100 * worst(probe.face))}% of the face`);
    }
  }
});

test("the styles differ in outline from a close crop to a ball and to ringlets that fall to the nape", () => {
  const surface = evaluateHuman({}), size = {}, low = {};
  for (const hair of styles) { const b = box(grown(surface, hair).roots); size[hair] = b.max.x - b.min.x; low[hair] = b.min.y; }
  assert.ok(size["Coiled crop"] < size["Rounded coils"] - 0.008 && size["Rounded coils"] < size["Afro"] - 0.02, JSON.stringify(size));
  assert.ok(size["Curls"] < size["Afro"] - 0.02);
  for (const hair of ["Coiled crop", "Rounded coils", "Curls", "Afro"]) assert.ok(low["Natural curls"] < low[hair] - 0.01, `Natural curls hang lower than ${hair}`);
});

test("the picture of the clumps has lit lobes over dark creases, and an edge that thins into fine hairs", () => {
  const surface = evaluateHuman({});
  for (const hair of ["Afro", "Natural curls"]) {
    const curl = grown(surface, hair).curls, { width, tone, relief } = clumpPixels(curl), row = (y) => { let solid = 0; for (let x = 0; x < width; x++) if (tone[(y * width + x) * 4 + 3] > 128) solid++; return solid / width; };
    // The middle of the chart is hair with no gaps, lit and shaded, with relief to match.
    let light = 0, dark = 0, high = 0, low = 0, count = 0;
    for (let y = Math.round(0.3 * width); y < 0.8 * width; y++) for (let x = Math.round(0.25 * width); x < 0.75 * width; x++) {
      const at = (y * width + x) * 4;
      assert.equal(tone[at + 3], 255, "the mass is solid");
      count++; if (tone[at] > 225) light++; if (tone[at] < 150) dark++; if (relief[at] > 150) high++; if (relief[at] < 70) low++;
    }
    assert.ok(light > 0.15 * count && dark > 0.07 * count, `${hair}: lit ${light}, dark ${dark} of ${count}`);
    assert.ok(high > 0.08 * count && low > 0.08 * count, `${hair}: raised ${high}, sunken ${low} of ${count}`);
    // The strip along the top is the hairline: whole hair at its foot, parted hairs half way, clear at the tips.
    const [, foot] = clumpEdge(0.5, 1), [, tip] = clumpEdge(0.5, 0), mid = (foot + tip) / 2;
    assert.ok(row(Math.floor(foot * width)) > 0.97 && row(Math.floor(tip * width)) < 0.1, `${hair}: the edge runs from hair to none`);
    assert.ok(row(Math.floor(mid * width)) > 0.2 && row(Math.floor(mid * width)) < 0.9, `${hair}: the edge is parted hairs half way`);
    // The chart of the mass keeps clear of the strip.
    for (const q of [[0, 1, 0], [0, 0, 1], [1, 0, 0], [0, -0.5, -0.866], [0.6, -0.64, 0.48]]) {
      const [u, v] = clumpChart(q);
      assert.ok(u >= 0 && u <= 1 && v > foot + 0.01 && v <= 1, `${q} lies in the chart`);
    }
  }
});

test("in clay the raised volume is the hair, and in colour it wears the picture of its own clumps", () => {
  const surface = evaluateHuman({});
  for (const hair of styles) {
    const clay = strandGroom(surface, { hair }, material, true, "#96735d", budget), colour = strandGroom(surface, { hair, hairColor: "#44372f" }, material, false, "#96735d", budget);
    assert.equal(clay.length, 1);
    assert.ok(clay[0].userData.hairRoots && !clay[0].material.map);
    assert.equal(colour.length, 1, `${hair} is one mesh`);
    const mass = colour[0].material;
    assert.ok(colour[0].userData.hairRoots && mass.map?.name === "Hair clumps" && mass.bumpMap?.name === "Hair clump relief" && mass.vertexColors);
    // The hairline is cut out of the picture, and the exporter keeps every clump as built.
    assert.ok(mass.alphaTest > 0 && mass.side === T.DoubleSide && mass.userData.fibreLOD && mass.userData.hairCards);
  }
});

test("saved names and seeded draws of curly hair are kept", () => {
  for (const hair of styles) assert.ok(adultStyles.hair.includes(hair) && validAdultStyle({ hair }), hair);
  for (const [seed, hair, hairColor] of [[61501, "Afro", "#504041"], [61502, "Natural curls", "#44372f"], [61507, "Rounded coils", "#68564b"], [61511, "Curls", "#44372f"], [61516, "Coiled crop", "#a8a199"]]) {
    const style = dressHuman(generatedHuman(seed), (seed ^ 0x1e18ae83) >>> 0).humanStyle;
    assert.deepEqual([style.hair, style.hairColor], [hair, hairColor], `seed ${seed}`);
  }
});
