import test from "node:test";
import assert from "node:assert/strict";
import figures from "./human-cast-data.json" with { type: "json" };
import catalog from "./human-cast-catalog.json" with { type: "json" };
import { unzlibSync } from "three/addons/libs/fflate.module.js";
import { evaluateHuman, smoothHumanSurface } from "./human-surface.js";
import { refineFaceForm } from "./human-face-anatomy.js";
import {
  castBottoms, castOutfit, castOutfitFields, castOutfitProblems, castOutfits, castOutfitSubjects, castPieces, castTops,
  drawCastOutfit, wornCastOutfit,
} from "./human-cast-wardrobe.js";

const read = (owner, name, Type) => {
  if (ArrayBuffer.isView(owner[name])) return owner[name];
  const bytes = unzlibSync(Uint8Array.from(atob(owner[name]), c => c.charCodeAt(0)));
  return new Type(bytes.buffer, bytes.byteOffset, bytes.byteLength / Type.BYTES_PER_ELEMENT);
};
const labels = Object.keys(catalog.people);
const others = label => castOutfits(label).slice(1);
const largest = values => values.reduce((most, value) => Math.max(most, value), 0);

test("a style that names no fitted outfit leaves the figure as it is", () => {
  for (const label of labels) {
    const figure = figures[label];
    assert.equal(castOutfit(figure, label, undefined), figure);
    assert.equal(castOutfit(figure, label, {}), figure);
    assert.equal(castOutfit(figure, label, { cast: label, castShape: .4, castPigment: .2 }), figure);
    assert.equal(castOutfit(figure, label, { castTop: "No such top" }), figure);
    assert.equal(castOutfit(figure, label, castOutfits(label)[0]), figure, "own pieces named in full");
    assert.deepEqual(castOutfitSubjects(label, {}), []);
  }
  assert.deepEqual(castOutfits("Long tunic"), [], "the long tunic keeps its own clothes and drape");
  assert.equal(wornCastOutfit("Long tunic", {}), null);
  assert.equal(castOutfit(figures["Long tunic"], "Long tunic", { castTop: "Denim jacket", castBottom: "Jeans and shoes" }), figures["Long tunic"]);
});

test("the supported set covers both sexes, and the selectors agree with it", () => {
  const wearers = labels.filter(label => others(label).length);
  assert.ok(wearers.some(label => catalog.people[label].rig === "male") && wearers.some(label => catalog.people[label].rig === "female"));
  assert.deepEqual(castOutfitFields, ["castTop", "castBottom"]);
  for (const label of labels) {
    const all = castOutfits(label);
    assert.equal(new Set(all.map(o => o.castTop + "/" + o.castBottom)).size, all.length);
    if (all.length) assert.deepEqual(wornCastOutfit(label, {}), { ...all[0], own: true });
    for (const outfit of all) {
      assert.ok(castTops(label).includes(outfit.castTop) && castBottoms(label, outfit.castTop).includes(outfit.castBottom));
      assert.ok(outfit.castTop in castPieces.top && outfit.castBottom in castPieces.bottom);
      assert.deepEqual(castOutfitProblems(label, outfit), []);
    }
    for (const top of castTops(label)) for (const bottom of castBottoms(label, top)) assert.ok(all.some(o => o.castTop === top && o.castBottom === bottom));
  }
  assert.deepEqual(castOutfitProblems("Gardener", {}), []);
  assert.equal(castOutfitProblems("Gardener", { castTop: "Cape" }).length, 1);
  assert.equal(castOutfitProblems("Gardener", { castTop: 3 }).length, 1);
  assert.equal(castOutfitProblems("Gardener", { castTop: "Pink shirt", castBottom: "Fitted jeans and shoes" }).length, 1, "a real piece not fitted to this member");
  assert.deepEqual(castOutfitSubjects("Gardener", { castTop: "Denim jacket" }), ["Adults/Male_Adult_12"]);
  assert.deepEqual(castOutfitSubjects("Gardener", { castTop: "Denim jacket", castBottom: "Shorts and shoes" }), ["Adults/Male_Adult_12", "Adults/Male_Adult_01"]);
  assert.deepEqual(wornCastOutfit("Gardener", { castBottom: "Shorts and shoes" }), { castTop: "Work shirt", castBottom: "Shorts and shoes", own: false });
});

test("every fitted outfit is a figure in the form the cast renderer reads", () => {
  for (const label of labels) for (const outfit of others(label)) {
    const figure = castOutfit(figures[label], label, outfit), name = label + " in " + outfit.castTop + ", " + outfit.castBottom;
    assert.equal(castOutfit(figures[label], label, { ...outfit }), figure, "made once");
    const count = figure.positions.length / 3, art = figure.surface, field = figure.field, handles = field.starts.length - 1;
    assert.ok(figure.positions instanceof Float32Array && Number.isInteger(count), name);
    assert.equal(art.uv.length, art.source.length * 2);
    assert.ok(largest(art.source) < count && largest(art.index) < art.source.length && largest(art.smooth) < count);
    assert.ok(art.uv.every(v => v >= 0 && v <= 1));
    assert.ok(figure.faceTriangles * 3 < art.index.length && art.index.length % 3 === 0);
    assert.equal(figure.weights.length, count * 4);
    assert.equal(figure.joints.length, count * 4);
    assert.ok(largest(figure.joints) < catalog.bones.length);
    for (let i = 0; i < count; i++) assert.ok(Math.abs(figure.weights[i * 4] + figure.weights[i * 4 + 1] + figure.weights[i * 4 + 2] + figure.weights[i * 4 + 3] - 1) < 1e-5);
    assert.equal(field.rest.length, handles * 3);
    assert.equal(field.near.length, count * field.reach);
    assert.equal(field.pull.length, count * field.reach);
    assert.ok(largest(field.near) < handles && field.starts[handles] === field.weights.length && field.vertices.length === field.weights.length);
    for (const pose of Object.values(figure.poses)) assert.equal(pose.length, count * 3);
    assert.deepEqual(Object.keys(figure.poses), Object.keys(figures[label].poses));
    assert.equal(figure.paint.pixels.length, figure.paint.side ** 2 * 3);
    assert.equal(figure.paint.mask.length, figure.paint.side ** 2);
    assert.equal(figure.cardPaint, figures[label].cardPaint, "the receiver's own hair picture");
    assert.ok(largest(read(figure.cards, "ties", Uint16Array)) < count);
    if (figures[label].blend) {
      assert.equal(figure.blend.shape.length, count * 3);
      assert.ok(figure.blend.shape.some(v => v !== 0), "the authored face shape is carried");
      assert.deepEqual(Object.keys(figure.blend.poses), Object.keys(figure.poses));
    } else assert.equal(figure.blend, undefined);
  }
});

test("the receiver keeps their head art, and the garments bring their own", () => {
  const stock = figures.Gardener.paint, side = stock.side, half = side / 2, mine = read(stock, "pixels", Uint8Array);
  const polo = read(figures["Striped polo"].paint, "pixels", Uint8Array);
  const poloSkin = read(figures["Striped polo"].paint, "mask", Uint8Array);
  const whole = castOutfit(figures.Gardener, "Gardener", { castTop: "Striped polo", castBottom: "Shorts and shoes" }).paint.pixels;
  const mixed = castOutfit(figures.Gardener, "Gardener", { castTop: "Work shirt", castBottom: "Shorts and shoes" }).paint.pixels;
  for (const y of [0, 77, 300, 511]) for (const x of [half, half + 190, side - 1]) for (let k = 0; k < 3; k++) {
    assert.equal(whole[(y * side + x) * 3 + k], mine[(y * side + x) * 3 + k]);
    assert.equal(mixed[(y * side + x) * 3 + k], mine[(y * side + x) * 3 + k]);
  }
  for (const y of [0, 400, 1023]) for (const x of [0, 255, half - 1]) for (let k = 0; k < 3; k++) {
    if (!poloSkin[y * side + x]) assert.equal(whole[(y * side + x) * 3 + k], polo[(y * side + x) * 3 + k], "the borrowed top's art");
    assert.equal(mixed[(y * side + x) * 3 + k], mine[(y * side + x) * 3 + k], "the receiver's own top");
  }
  // The bottom's art sits half as tall in the quarter below the head. (Cloth: its bare skin takes the receiver's colour.)
  for (const y of [3, 60, 100]) for (const x of [10, 60]) for (let k = 0; k < 3; k++) {
    assert.equal(poloSkin[2 * y * side + x] + poloSkin[(2 * y + 1) * side + x], 0);
    const a = polo[(2 * y * side + x) * 3 + k], b = polo[((2 * y + 1) * side + x) * 3 + k];
    assert.equal(mixed[((half + y) * side + half + x) * 3 + k], (a + b + 1) >> 1);
  }
  assert.notEqual(mine, whole);
  assert.deepEqual(read(stock, "pixels", Uint8Array), mine, "the stock picture is not written to");
});

test("at the member's home build a fitted outfit stands undeformed, and a body edit moves it as one piece", () => {
  for (const label of labels) {
    if (!others(label).length) continue;
    const home = catalog.people[label].home;
    const moved = (figure, human) => {
      const surface = refineFaceForm(smoothHumanSurface(evaluateHuman(human))), field = figure.field, delta = Float32Array.from(field.rest, v => -v);
      for (let h = 0; h < field.starts.length - 1; h++) for (let p = field.starts[h]; p < field.starts[h + 1]; p++)
        for (let d = 0; d < 3; d++) delta[h * 3 + d] += field.weights[p] * surface.positions[field.vertices[p] * 3 + d];
      return Float32Array.from(figure.positions, (v, i) => {
        const point = (i - i % 3) / 3;
        for (let j = 0; j < field.reach; j++) v += field.pull[point * field.reach + j] * delta[field.near[point * field.reach + j] * 3 + i % 3];
        return v;
      });
    };
    for (const outfit of others(label)) {
      const figure = castOutfit(figures[label], label, outfit), rest = moved(figure, home);
      assert.ok(largest(rest.map((v, i) => Math.abs(v - figure.positions[i]))) < 5e-4, label + " " + outfit.castTop + ": undeformed at home");
      const stout = moved(figure, { ...home, weight: (home.weight ?? 0) + .4, belly: (home.belly ?? 0) + .4 });
      const shift = largest(stout.map((v, i) => Math.abs(v - figure.positions[i])));
      assert.ok(shift > .004 && shift < .12, label + " " + outfit.castTop + ": the body edit moves the clothes (" + shift.toFixed(4) + " m)");
    }
  }
});

test("an outfit draw depends on the seed alone and reaches every fitted outfit", () => {
  const seen = new Set();
  let kept = 0;
  for (let seed = 1400100; seed < 1400164; seed++) {
    const drawn = drawCastOutfit("Gardener", seed);
    assert.deepEqual(drawCastOutfit("Gardener", seed), drawn);
    assert.deepEqual(castOutfitProblems("Gardener", drawn), []);
    if (drawn.castTop) seen.add(drawn.castTop + "/" + drawn.castBottom); else kept++;
    assert.deepEqual(drawCastOutfit("Long tunic", seed), {});
    assert.deepEqual(castOutfitProblems("Pink shirt", drawCastOutfit("Pink shirt", seed)), []);
  }
  assert.equal(seen.size, others("Gardener").length);
  assert.ok(kept > 12 && kept < 40, "some stay in their own clothes");
  assert.deepEqual(drawCastOutfit("Gardener", 7, 1), {});
});
