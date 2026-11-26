import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import figures from "./human-cast-data.json" with { type: "json" };
import wardrobe from "./human-cast-wardrobe-data.json" with { type: "json" };
import { unzlibSync } from "three/addons/libs/fflate.module.js";
import { humanForm, tintHumanSkin } from "./human-form.js";
import { humanRegions } from "./human-mesh.js";
import { castOutfit, castOutfits, castSkin, drawCastSkin } from "./human-cast-wardrobe.js";
import { castLidTexels } from "./human-cast-lids.js";

const read = (owner, name) => ArrayBuffer.isView(owner[name]) ? owner[name] : unzlibSync(Uint8Array.from(atob(owner[name]), c => c.charCodeAt(0)));
const linear = v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
const labels = Object.keys(figures);
function mean(paint, pixels, mask, [x0, x1, y0, y1], pass) {
  const side = paint.side, sum = [0, 0, 0];
  let count = 0, all = 0;
  for (let y = Math.floor(y0 * side); y < y1 * side; y++) for (let x = Math.floor(x0 * side); x < x1 * side; x++) {
    all++;
    if (!pass(mask[y * side + x])) continue;
    count++;
    for (let k = 0; k < 3; k++) sum[k] += linear(pixels[(y * side + x) * 3 + k] / 255);
  }
  return { tone: sum.map(v => v / Math.max(count, 1)), count, share: count / all };
}
const head = [.5, 1, 0, .5], body = [0, .5, 0, 1], cheeks = [.78, .82, .155, .19];
const skin = m => m > 240, any = () => true;

test("every cast picture has a skin mask: the face is skin, and hair, eyes, mouth and empty picture are not", () => {
  for (const label of labels) {
    const paint = figures[label].paint, pixels = read(paint, "pixels"), mask = read(paint, "mask");
    assert.equal(mask.length, paint.side ** 2);
    assert.ok(mean(paint, pixels, mask, cheeks, skin).share > .97, label + ": cheeks, nose and forehead are skin");
    const face = mean(paint, pixels, mask, head, skin);
    assert.ok(face.share > .15 && face.share < .55, label + ": skin is part of the head chart, not all of it (" + face.share.toFixed(2) + ")");
    assert.ok(mean(paint, pixels, mask, [.5, 1, 0, .03], m => m > 20).share < .03, label + ": the hair along the top of the chart is not skin");
    assert.equal(mean(paint, pixels, mask, [.5, .57, .33, .5], m => m > 0).count, 0, label + ": the eye, teeth and mouth charts are not skin");
    assert.equal(mean(paint, pixels, mask, [.5, 1, .5, 1], m => m > 0).count, 0, label + ": nothing below the head chart");
    for (const area of [head, body]) {
      const found = mean(paint, pixels, mask, area, skin);
      if (!found.count) continue;
      assert.ok(found.tone[0] > found.tone[1] && found.tone[1] > found.tone[2], label + ": masked texels are skin coloured");
      for (let k = 0; k < 3; k++) assert.ok(Math.abs(found.tone[k] / paint.tone[k] - 1) < (area === head ? .45 : .7), label + ": masked skin is near the tone");
    }
  }
});

test("clothes are not skin: blue, grey, white, pink and khaki cloth stays out of the mask", () => {
  const cloth = [["Blue shirt", .1, .25], ["Blue shirt", .04, .1], ["Pink shirt", .11, .2], ["Pink shirt", .04, .75], ["Striped polo", .03, .1],
    ["Striped polo", .11, .5], ["Long tunic", .1, .3], ["Long tunic", .04, .2], ["Grey tee", .245, .3], ["Grey tee", .245, .5], ["Pink shirt", .245, .25], ["Blue shirt", .245, .3], ["Striped polo", .245, .3], ["Gardener", .1, .2], ["Gardener", .05, .88],
    ["Cropped jacket", .1, .4], ["Cropped jacket", .04, .75], ["Denim jacket", .245, .3], ["Denim jacket", .04, .8]];
  for (const [label, x, y] of cloth) {
    const paint = figures[label].paint, mask = read(paint, "mask"), pixels = read(paint, "pixels");
    const found = mean(paint, pixels, mask, [x - .01, x + .01, y - .01, y + .01], m => m > 0);
    assert.equal(found.count, 0, label + " cloth at " + x + ", " + y);
  }
  for (const [label, least] of [["Striped polo", .25], ["Grey tee", .15], ["Pink shirt", .1], ["Blue shirt", .08], ["Long tunic", .05]]) {
    const paint = figures[label].paint, found = mean(paint, read(paint, "pixels"), read(paint, "mask"), body, skin);
    assert.ok(found.share >= least, label + ": bare skin of the body (" + found.share.toFixed(3) + ")");
  }
  assert.equal(mean(figures.Gardener.paint, read(figures.Gardener.paint, "pixels"), read(figures.Gardener.paint, "mask"), body, m => m > 0).count, 0, "gloves and boots: no bare skin");
});

test("the tone is each source's own photographed face colour, and a form of that colour shows the photograph", () => {
  const tones = labels.map(label => figures[label].paint.tone);
  assert.ok(new Set(tones.map(String)).size >= 7, "calibrated per source, not one value for all");
  for (const label of labels) {
    const paint = figures[label].paint, found = mean(paint, read(paint, "pixels"), read(paint, "mask"), cheeks, skin).tone;
    for (let k = 0; k < 3; k++) assert.ok(found[k] / paint.tone[k] > .9 && found[k] / paint.tone[k] < 1.6, label + " tone against its cheek: " + found[k].toFixed(3) + ", " + paint.tone[k]);
    const colour = castSkin(label);
    assert.match(colour, /^#[0-9a-f]{6}$/);
    assert.deepEqual([1, 3, 5].map(i => +linear(parseInt(colour.slice(i, i + 2), 16) / 255).toFixed(6)), paint.tone, "the tone is exactly a colour a form can hold");
  }
  const light = t => .2126 * t[0] + .7152 * t[1] + .0722 * t[2];
  assert.ok(light(figures["Long tunic"].paint.tone) < .75 * light(figures["Pink shirt"].paint.tone), "the darker source reads darker");
  assert.equal(castSkin("Nobody"), null);
});

const material = color => new T.MeshStandardMaterial({ color });
function drawn(label, colour, style = {}) {
  let form = humanForm();
  form = { ...form, outfit: "Work clothes", humanStyle: { ...form.humanStyle, cast: label, ...style } };
  if (colour) form = tintHumanSkin(form, colour);
  const image = humanRegions(form, material, false)(form.parts.find(p => p.humanBone === "head")).children[0].material.map.image;
  const rgb = new Uint8Array(image.width * image.height * 3);
  for (let i = 0; i < image.width * image.height; i++) for (let k = 0; k < 3; k++) rgb[i * 3 + k] = image.data[i * 4 + k];
  return rgb;
}
const iris = i => i % 1024 > 630 && i % 1024 < 670 && i > 455 * 1024 && i < 495 * 1024;

function lidTexels(label) {
  const figure = figures[label], art = figure.surface, typed = (owner, name, Type) => { const bytes = read(owner, name); return new Type(bytes.buffer, bytes.byteOffset, bytes.byteLength / Type.BYTES_PER_ELEMENT); };
  const eyes = castLidTexels({ uv: typed(art, "uv", Float32Array), index: typed(art, "index", Uint16Array), faceTriangles: figure.faceTriangles,
    source: typed(art, "source", Uint16Array), blink: typed(figure.poses, "Blink", Float32Array), side: figure.paint.side });
  return new Set(eyes.flatMap(eye => Array.from(eye.texels)));
}
test("the skin colour control recolours skin through extremes and leaves hair, eyes, mouth and clothes as photographed", () => {
  for (const label of ["Striped polo", "Long tunic", "Pink shirt"]) {
    const paint = figures[label].paint, mask = read(paint, "mask"), source = read(paint, "pixels"), lids = lidTexels(label);
    const original = drawn(label, castSkin(label));
    for (let i = 0; i < mask.length; i++) if (!iris(i) && !lids.has(i)) for (let k = 0; k < 3; k++)
      if (Math.abs(original[i * 3 + k] - source[i * 3 + k]) > 1) assert.fail(label + ": at its own skin colour the photograph is kept; texel " + i);
    for (const colour of ["#3b2417", "#6b4630", "#d9a989", "#f3d9c8"]) {
      const picture = drawn(label, colour), wanted = [1, 3, 5].map(i => linear(parseInt(colour.slice(i, i + 2), 16) / 255));
      for (const area of [cheeks, body]) {
        const found = mean(paint, picture, mask, area, skin);
        if (found.count < 2000) continue;
        const before = mean(paint, source, mask, area, skin).tone;
        for (let k = 0; k < 3; k++) {
          const aim = wanted[k] * before[k] / paint.tone[k], least = Math.min(aim, 6 * before[k], 1) * (aim > .6 ? .7 : .88);
          assert.ok(found.tone[k] < Math.min(1, aim) * 1.12 && found.tone[k] > least, label + " " + colour + " channel " + k + ": " + found.tone[k].toFixed(3) + " for " + aim.toFixed(3));
        }
        assert.ok(found.tone[0] > found.tone[1] && found.tone[1] > found.tone[2], label + " " + colour + ": still a skin colour");
      }
      for (let i = 0; i < mask.length; i++) if (!mask[i] && !iris(i) && !lids.has(i))
        for (let k = 0; k < 3; k++) if (picture[i * 3 + k] !== source[i * 3 + k]) assert.fail(label + " " + colour + ": a texel outside the skin changed at " + i);
    }
  }
});

test("a zero mask would not pass: with it the control changes nothing", () => {
  const paint = figures["Striped polo"].paint, source = read(paint, "pixels"), mask = read(paint, "mask");
  const real = drawn("Striped polo", "#3b2417");
  figures["Striped polo"].paint = { ...paint, mask: new Uint8Array(paint.side ** 2) };
  try {
    const flat = drawn("Striped polo", "#3b2417"), before = mean(paint, source, mask, cheeks, any).tone[0];
    assert.ok(mean(paint, flat, mask, cheeks, any).tone[0] > .9 * before, "zero mask: skin stays as photographed");
    assert.ok(mean(paint, real, mask, cheeks, any).tone[0] < .5 * before, "real mask: skin darkens");
  } finally { figures["Striped polo"].paint = paint; }
});

test("borrowed clothes show the receiver's skin, and the skin colour control reaches it", () => {
  for (const label of Object.keys(wardrobe.receivers)) for (const outfit of castOutfits(label).slice(1)) {
    const figure = castOutfit(figures[label], label, outfit), paint = figure.paint, target = wardrobe.skin[label].body ?? paint.tone;
    for (const area of [body, [.5, 1, .5, 1]]) {
      const found = mean(paint, paint.pixels, paint.mask, area, skin);
      if (found.count < 1500) continue;
      for (let k = 0; k < 3; k++) assert.ok(Math.abs(found.tone[k] / target[k] - 1) < .1, label + " in " + outfit.castTop + ", " + outfit.castBottom + ": bare skin in the receiver's colour");
    }
    assert.deepEqual(paint.tone, figures[label].paint.tone);
  }
  const worn = castOutfit(figures.Gardener, "Gardener", { castTop: "Striped polo", castBottom: "Shorts and shoes" }).paint;
  const arms = mean(worn, worn.pixels, worn.mask, body, skin), donor = figures["Striped polo"].paint;
  const theirs = mean(donor, read(donor, "pixels"), read(donor, "mask"), body, skin);
  assert.ok(arms.count > 50000 && Math.abs(arms.count / theirs.count - 1) < .05, arms.count + " texels of arm and leg, " + theirs.count + " on the polo wearer");
  const off = found => Math.max(...found.tone.map((v, k) => Math.abs(v / figures.Gardener.paint.tone[k] - 1)));
  assert.ok(off(arms) < .1 && off(theirs) > .1, "arms " + off(arms).toFixed(3) + " from his face colour; the polo wearer's own " + off(theirs).toFixed(3));
  const denim = castOutfit(figures.Gardener, "Gardener", { castTop: "Denim jacket", castBottom: "Jeans and shoes" }).paint;
  assert.ok(mean(denim, denim.pixels, denim.mask, body, skin).count > 8000);
  const dark = drawn("Gardener", "#4a2e1f", { castTop: "Striped polo", castBottom: "Shorts and shoes" });
  const face = mean(worn, dark, worn.mask, cheeks, skin).tone, limbs = mean(worn, dark, worn.mask, body, skin).tone;
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(limbs[k] / face[k] - 1) < .25, "face and arms change together");
});

test("a drawn cast member's skin depends on the seed alone, mostly stays as photographed, and never leaves the face behind", () => {
  let kept = 0;
  const light = c => [1, 3, 5].map(i => linear(parseInt(c.slice(i, i + 2), 16) / 255)).reduce((s, v, k) => s + v * [.2126, .7152, .0722][k], 0);
  for (let seed = 1400100; seed < 1400164; seed++) for (const wanted of ["#2a1a12", "#f6e3d6", "#a18067", "#ff8800"]) {
    const colour = drawCastSkin("Pink shirt", wanted, seed);
    assert.equal(drawCastSkin("Pink shirt", wanted, seed), colour);
    assert.match(colour, /^#[0-9a-f]{6}$/);
    if (colour === castSkin("Pink shirt")) { kept++; continue; }
    const ratio = light(colour) / light(castSkin("Pink shirt"));
    assert.ok(ratio > .38 && ratio < 1.5, wanted + " held near the photograph (" + ratio.toFixed(2) + ")");
    const [r, g, b] = [1, 3, 5].map(i => parseInt(colour.slice(i, i + 2), 16));
    assert.ok(r > g && g > b, colour + " is a skin colour");
  }
  assert.ok(kept > 64 * 4 * .45 && kept < 64 * 4 * .75);
  assert.equal(drawCastSkin("Pink shirt", "nonsense", 3), castSkin("Pink shirt"));
  assert.equal(drawCastSkin("Nobody", "#a18067", 3), null);
});
