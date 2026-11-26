import test from "node:test";
import assert from "node:assert/strict";
import figures from "./human-cast-data.json" with { type: "json" };
import { unzlibSync } from "three/addons/libs/fflate.module.js";
import { castLidTexels, paintCastLids, lidShade, lidEdge } from "./human-cast-lids.js";
import { castSkin } from "./human-cast-wardrobe.js";
import { humanForm, tintHumanSkin } from "./human-form.js";
import { humanRegions } from "./human-mesh.js";
import * as T from "three";

const read = (owner, name, Type) => {
  const bytes = unzlibSync(Uint8Array.from(atob(owner[name]), c => c.charCodeAt(0)));
  return new Type(bytes.buffer, bytes.byteOffset, bytes.byteLength / Type.BYTES_PER_ELEMENT);
};
const linear = v => (v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
const light = (pixels, at, step) => .2126 * linear(pixels[at * step] / 255) + .7152 * linear(pixels[at * step + 1] / 255) + .0722 * linear(pixels[at * step + 2] / 255);
const labels = Object.keys(figures);
function lidsOf(label) {
  const figure = figures[label], art = figure.surface;
  return castLidTexels({ uv: read(art, "uv", Float32Array), index: read(art, "index", Uint16Array), faceTriangles: figure.faceTriangles,
    source: read(art, "source", Uint16Array), blink: read(figure.poses, "Blink", Float32Array), side: figure.paint.side });
}
function picture(label) {
  const paint = figures[label].paint, rgb = read(paint, "pixels", Uint8Array), rgba = new Uint8ClampedArray(paint.side ** 2 * 4);
  for (let i = 0; i < paint.side ** 2; i++) { rgba.set(rgb.subarray(i * 3, i * 3 + 3), i * 4); rgba[i * 4 + 3] = 255; }
  return { paint, rgb, rgba, mask: read(paint, "mask", Uint8Array) };
}

test("each cast member has two small lid strips in the head chart, graded from crease to edge", () => {
  for (const label of labels) {
    const side = figures[label].paint.side, eyes = lidsOf(label);
    assert.equal(eyes.length, 2);
    for (const { texels, along } of eyes) {
      assert.ok(texels.length > 100 && texels.length < 600, label + ": a lid is a few hundred texels (" + texels.length + ")");
      for (const key of texels) assert.ok(key % side >= side / 2 && key < side * side / 2, label + ": lids lie in the head chart");
      assert.ok(Math.min(...along) < .05 && Math.max(...along) > .9, label + ": the strip runs from still skin to the lid's edge");
    }
    assert.ok(Math.abs(eyes[0].texels.length - eyes[1].texels.length) < .35 * eyes[0].texels.length, label + ": the two lids are alike");
  }
});

test("a closed lid is the skin beside the eye a little in shade, not the photographed dark", () => {
  for (const label of labels) {
    const { paint, rgb, rgba, mask } = picture(label), side = paint.side, eyes = lidsOf(label), marked = mask.slice();
    paintCastLids(rgba, marked, side, eyes, paint.tone);
    for (const { texels, along } of eyes) {
      const xs = Array.from(texels, key => key % side), ys = Array.from(texels, key => Math.floor(key / side)), near = [];
      for (let y = Math.min(...ys) - 10; y <= Math.max(...ys) + 10; y++) for (let x = Math.min(...xs) - 10; x <= Math.max(...xs) + 10; x++)
        if (mask[y * side + x] >= 200 && !texels.includes(y * side + x)) near.push(light(rgb, y * side + x, 3));
      const skin = near.sort((a, b) => a - b)[near.length >> 1];
      const upper = Array.from(texels).filter((_, i) => along[i] < lidEdge[0]);
      const before = upper.reduce((sum, key) => sum + light(rgb, key, 3), 0) / upper.length / skin;
      const after = upper.reduce((sum, key) => sum + light(rgba, key, 4), 0) / upper.length / skin;
      assert.ok(before < .6, label + ": the photographed lid is dark (" + before.toFixed(2) + ")");
      assert.ok(Math.abs(after - lidShade) < .08, label + ": the repainted lid is shaded skin (" + after.toFixed(2) + ")");
      for (const key of upper) {
        assert.ok(rgba[key * 4] > rgba[key * 4 + 1] && rgba[key * 4 + 1] > rgba[key * 4 + 2], label + ": lid texels are skin coloured");
        assert.equal(marked[key], 255, label + ": the lid follows the skin colour");
      }
      texels.forEach((key, i) => {
        if (along[i] >= lidEdge[1]) for (let k = 0; k < 3; k++) assert.equal(rgba[key * 4 + k], rgb[key * 3 + k], label + ": lash line kept");
      });
    }
    const lid = new Set(eyes.flatMap(eye => Array.from(eye.texels)));
    for (let i = 0; i < side * side; i++) {
      if (lid.has(i)) continue;
      if (marked[i] !== mask[i] || rgba[i * 4] !== rgb[i * 3] || rgba[i * 4 + 1] !== rgb[i * 3 + 1] || rgba[i * 4 + 2] !== rgb[i * 3 + 2])
        assert.fail(label + ": texel " + i + " outside the lids changed");
    }
  }
});

test("a stray point of the blink pose outside the eyes is not painted", () => {
  const side = figures["Grey tee"].paint.side;
  for (const { texels } of lidsOf("Grey tee")) for (const key of texels) assert.ok(key % side < .82 * side, "lid texels stay at the eyes");
});

test("the drawn cast picture carries the lids with the chosen skin colour and leaves the rest as it was", () => {
  const label = "Denim jacket", material = () => new T.MeshStandardMaterial();
  const draw = colour => {
    let form = humanForm();
    form = tintHumanSkin({ ...form, outfit: "Work clothes", humanStyle: { ...form.humanStyle, cast: label } }, colour);
    return humanRegions(form, material, false)(form.parts.find(p => p.humanBone === "head")).children[0].material.map.image.data;
  };
  const ownPixels = draw(castSkin(label)), darkPixels = draw("#4a2e1f");
  const { rgb, paint } = picture(label), side = paint.side, eyes = lidsOf(label), lid = new Set(eyes.flatMap(eye => Array.from(eye.texels)));
  const iris = i => i % 1024 > 630 && i % 1024 < 670 && i > 455 * 1024 && i < 495 * 1024;
  let changed = 0;
  for (let i = 0; i < side * side; i++)
    if (!lid.has(i) && !iris(i) && (ownPixels[i * 4] !== rgb[i * 3] || ownPixels[i * 4 + 1] !== rgb[i * 3 + 1] || ownPixels[i * 4 + 2] !== rgb[i * 3 + 2])) changed++;
  assert.equal(changed, 0, "at the photographed skin colour only the lids differ from the picture");
  for (const { texels, along } of eyes) texels.forEach((key, i) => {
    if (along[i] < lidEdge[0]) assert.ok(light(darkPixels, key, 4) < .45 * light(ownPixels, key, 4), "a dark skin darkens the lid with the face");
  });
});
