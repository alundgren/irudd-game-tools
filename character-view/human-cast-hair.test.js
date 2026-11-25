import test from "node:test";
import assert from "node:assert/strict";
import figures from "./human-cast-data.json" with { type: "json" };
import { unzlibSync } from "three/addons/libs/fflate.module.js";
import { castCardCopies, castCardIndex, castCardPixels } from "./human-cast-hair.js";

const read = (owner, name, Type) => {
  const bytes = unzlibSync(Uint8Array.from(atob(owner[name]), c => c.charCodeAt(0)));
  return new Type(bytes.buffer, bytes.byteOffset, bytes.byteLength / Type.BYTES_PER_ELEMENT);
};
const carded = Object.entries(figures).filter(([, figure]) => figure.cards);
const place = (points, index, t) => [0, 1, 2].map(k => [0, 1, 2].map(d => Math.round(points[index[t + k] * 3 + d] * 1e5)).join(",")).sort().join(";");

test("the source carries every hair card twice in one place; each is drawn once", () => {
  assert.ok(carded.length >= 7);
  for (const [label, figure] of carded) {
    const points = read(figure.cards, "points", Float32Array), index = read(figure.cards, "index", Uint16Array);
    const copies = castCardCopies(points, index), once = castCardIndex(points, index);
    assert.ok(copies >= index.length / 3 * .45, label + ": " + copies + " of " + index.length / 3 + " card triangles lie on another");
    assert.equal(castCardIndex(points, index), once, "worked out once");
    assert.equal(castCardCopies(points, once), 0, label + ": no two triangles left in one place");
    // Every place the cards covered is still covered, by one of the triangles that were there.
    const before = new Set(), after = new Set(), triangles = new Set();
    for (let t = 0; t < index.length; t += 3) { before.add(place(points, index, t)); triangles.add(index.slice(t, t + 3).join(",")); }
    for (let t = 0; t < once.length; t += 3) { after.add(place(points, once, t)); assert.ok(triangles.has(once.slice(t, t + 3).join(","))); }
    assert.deepEqual(after, before, label + ": the same places");
    assert.equal(once.length / 3, before.size);
    // The copy kept faces away from the middle of the hair.
    const middle = [0, 1, 2].map(d => points.reduce((sum, v, i) => i % 3 === d ? sum + v : sum, 0) / (points.length / 3));
    const filled = new Map();
    for (let t = 0; t < index.length; t += 3) filled.set(place(points, index, t), (filled.get(place(points, index, t)) ?? 0) + 1);
    let outward = 0, chosen = 0;
    for (let t = 0; t < once.length; t += 3) {
      if (filled.get(place(points, once, t)) < 2) continue;
      chosen++;
      const [a, b, c] = [0, 1, 2].map(k => [0, 1, 2].map(d => points[once[t + k] * 3 + d]));
      const u = a.map((v, d) => b[d] - v), v = a.map((w, d) => c[d] - w);
      const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      if (normal.reduce((sum, n, d) => sum + n * ((a[d] + b[d] + c[d]) / 3 - middle[d]), 0) >= 0) outward++;
    }
    assert.equal(outward, chosen, label + ": where there was a choice, the copy kept faces outward");
  }
});

test("a card picture ready for cutting closes thick hair and takes nothing away", () => {
  for (const [label, figure] of carded) {
    const side = figure.cardPaint.side, pixels = read(figure.cardPaint, "pixels", Uint8Array), made = castCardPixels(pixels, side);
    assert.equal(castCardPixels(pixels, side), made, "worked out once");
    assert.equal(made.length, pixels.length);
    let lowered = 0, recoloured = 0, holes = 0, holesLeft = 0, thick = 0, opened = 0, far = 0;
    // Thick hair: the mean alpha of the five by five round a texel is over six tenths.
    const mean = i => {
      const x = i % side, y = (i - x) / side;
      if (x < 2 || y < 2 || x >= side - 2 || y >= side - 2) return 0;
      let sum = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) sum += pixels[((y + dy) * side + x + dx) * 4 + 3];
      return sum / 25 / 255;
    };
    for (let i = 0; i < side * side; i++) {
      const was = pixels[i * 4 + 3], is = made[i * 4 + 3];
      if (is < was) lowered++;
      if (was === 255 && [0, 1, 2].some(k => made[i * 4 + k] !== pixels[i * 4 + k])) recoloured++;
      const around = mean(i);
      if (around > .6) { thick++; if (was < 128) holes++; if (is < 128) holesLeft++; }
      if (around < .1 && is >= 128 && was < 128) opened++;
      if (is >= 128 && was < 128) for (let k = 0; k < 3; k++) if (Math.abs(made[i * 4 + k] - pixels[i * 4 + k]) > 90 && was > 40) far++;
    }
    assert.equal(lowered, 0, label + ": no texel is opened");
    assert.equal(recoloured, 0, label + ": solid hair keeps its colour");
    assert.ok(opened < 40, label + ": next to nothing is closed where the hair is thin (lashes, tips): " + opened + " texels");
    assert.ok(far < 20, label + ": a closed gap has the colour of the hair it had (" + far + " channel values far off)");
    assert.ok(thick > 2000, label);
    assert.ok(holesLeft <= holes * .25 && holesLeft / thick < .005, label + ": holes in thick hair " + holes + " -> " + holesLeft + " of " + thick);
  }
  // The fair, fine-stranded hair is where it matters most.
  const figure = figures["Denim jacket"], pixels = read(figure.cardPaint, "pixels", Uint8Array), made = castCardPixels(pixels, figure.cardPaint.side);
  let before = 0, after = 0;
  for (let i = 3; i < pixels.length; i += 4) { if (pixels[i] >= 128) before++; if (made[i] >= 128) after++; }
  assert.ok(after > before && after < before * 1.25, "covered texels " + before + " -> " + after);
});
