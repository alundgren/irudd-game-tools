import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { chartDensity, chartHeight, chartPixel, chartWidth, faceChart } from "./human-face-chart.js";
import { headroomForSkin } from "./human-complexion.js";
import {
  browPigment,
  drawnMakeupStyles,
  makeupPalette,
  makeupStyles,
  mixMakeup,
  paintStageMakeup,
  stageMakeupFace,
  stageMakeupStyles,
} from "./human-makeup.js";
import { generatedHuman } from "./human-form.js";
import { dressHuman } from "./human-wardrobe.js";
import { validateForm } from "./recipe.js";

const FW = chartWidth * chartDensity,
  FH = chartHeight * chartDensity;

const decode = (b) => {
  const v = b / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luma = (rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];

function blankFace(skinHex) {
  const skinColor = new T.Color(skinHex);
  const { neutral, base } = headroomForSkin(skinColor);
  const map = new Uint8ClampedArray(FW * FH * 4);
  const rough = new Uint8ClampedArray(FW * FH * 4);
  for (let i = 0; i < FW * FH * 4; i += 4) {
    map[i] = neutral[0];
    map[i + 1] = neutral[1];
    map[i + 2] = neutral[2];
    map[i + 3] = 255;
    rough[i] = 255;
    rough[i + 1] = 180;
    rough[i + 2] = 0;
    rough[i + 3] = 255;
  }
  return { map, rough, skin: [skinColor.r, skinColor.g, skinColor.b], base, neutral };
}

function sampleLinear(map, base, mx, my) {
  const at = chartPixel(mx, my);
  assert.ok(at >= 0, `landmark (${mx},${my}) on chart`);
  const ci = at % chartWidth,
    cj = Math.floor(at / chartWidth);
  const q = (cj * chartDensity * FW + ci * chartDensity) * 4;
  return [decode(map[q]) * base[0], decode(map[q + 1]) * base[1], decode(map[q + 2]) * base[2]];
}

function sampleRough(rough, mx, my) {
  const at = chartPixel(mx, my);
  const ci = at % chartWidth,
    cj = Math.floor(at / chartWidth);
  const q = (cj * chartDensity * FW + ci * chartDensity) * 4;
  return (rough[q + 1] / 255) * 0.8;
}

test("bare and everyday makeup styles stay untouched and random draw schedule never changes", () => {
  assert.deepEqual(drawnMakeupStyles, ["Rose stain", "Burnished copper", "Berry satin", "Plum stage", "Smoked charcoal"]);
  assert.ok(stageMakeupStyles.includes("Plum stage") && stageMakeupStyles.includes("Smoked charcoal"));
  assert.ok(stageMakeupStyles.includes("Gilded nocturne") && stageMakeupStyles.includes("Crimson aria"));
  for (const name of makeupStyles) {
    const form = generatedHuman(61410);
    validateForm({ ...form, humanStyle: { ...form.humanStyle, makeup: name } });
  }
  for (let seed = 61410; seed < 61460; seed++) {
    const dressed = dressHuman(generatedHuman(seed), seed, "Festive");
    const chosen = dressed.humanStyle.makeup;
    assert.ok(chosen === "None" || drawnMakeupStyles.includes(chosen), "unexpected drawn makeup: " + chosen);
  }
  const mat = { map: { image: null }, color: new T.Color("#b08566") };
  for (const name of ["None", "Rose stain", "Burnished copper", "Berry satin"]) {
    assert.equal(stageMakeupFace(mat, { humanStyle: { makeup: name } }), mat);
    const buf = blankFace("#b08566");
    const before = buf.map.slice();
    const res = paintStageMakeup({ map: buf.map, rough: buf.rough }, name, { skin: buf.skin, base: buf.base });
    assert.equal(res.changed.size, 0);
    assert.deepEqual(buf.map, before);
  }
  const rose = makeupPalette("Rose stain"),
    c = [1, 1, 1];
  mixMakeup(c, rose, 0, 1, 0, 0, 1);
  assert.ok(Math.abs(c[1] - (1 - 0.98 * rose.strength * (1 - rose.shadow[1]))) < 1e-10, "everyday shadow stain unchanged");
});

test("stage makeup paints crisp graphic eye wing, luminous lid shimmer, clean under-eye and sculpted lip across fair, deep and fantasy skin", () => {
  const c = faceChart();
  const eye = c.points.eyes[0];
  const mouth = c.points.mouth;
  const skins = [
    ["fair", "#d9b39c"],
    ["deep", "#5b3b2d"],
    ["lilac-fantasy", "#ad87b2"],
    ["seaglass-fantasy", "#6d8c80"],
  ];

  for (const style of stageMakeupStyles) {
    for (const [label, hex] of skins) {
      const buf = blankFace(hex);
      const { base, changed } = paintStageMakeup(
        { map: buf.map, rough: buf.rough },
        style,
        { skin: buf.skin, base: buf.base, brow: "eyebrow001" },
      );
      assert.ok(changed.has("map") && changed.has("rough"));

      const border = [decode(buf.map[0]) * base[0], decode(buf.map[1]) * base[1], decode(buf.map[2]) * base[2]];
      for (let k = 0; k < 3; k++) {
        assert.ok(Math.abs(border[k] - buf.skin[k]) < 0.008, `${style}/${label} border ch ${k}: ${border[k]} vs ${buf.skin[k]}`);
      }

      const lidRgb = sampleLinear(buf.map, base, 30.5, 5.6);
      const wingRgb = sampleLinear(buf.map, base, eye.outer[0] + 5.0, eye.outer[1] + 4.4);
      const underEyeRgb = sampleLinear(buf.map, base, 31.0, -7.2);
      const lidRough = sampleRough(buf.rough, 30.5, 5.6);
      const wingRough = sampleRough(buf.rough, eye.outer[0] + 5.0, eye.outer[1] + 4.4);

      assert.ok(luma(lidRgb) > luma(wingRgb) * 1.8, `${style}/${label} lid (${luma(lidRgb).toFixed(3)}) brighter than wing (${luma(wingRgb).toFixed(3)})`);
      assert.ok(lidRough < wingRough - 0.12, `${style}/${label} lid shimmer (${lidRough.toFixed(2)}) smoother than velvet wing (${wingRough.toFixed(2)})`);
      const underDiff = Math.hypot(underEyeRgb[0] - buf.skin[0], underEyeRgb[1] - buf.skin[1], underEyeRgb[2] - buf.skin[2]);
      assert.ok(underDiff < 0.06, `${style}/${label} clean under-eye diff=${underDiff.toFixed(3)}`);

      const lipCenter = sampleLinear(buf.map, base, 0, mouth.centre[1] - 2.0);
      const lipCorner = sampleLinear(buf.map, base, mouth.corner - 3.5, mouth.centre[1]);
      assert.ok(luma(lipCenter) > luma(lipCorner) * 1.25, `${style}/${label} sculpted lip center > corner`);

      for (let i = 1; i < buf.rough.length; i += 4) {
        const rv = (buf.rough[i] / 255) * 0.8;
        assert.ok(rv >= 0.235 && rv <= 0.805, `roughness out of bounds: ${rv}`);
      }
    }
    const stageBrow = browPigment(new T.Color("#d3cbd0"), new T.Color("#ad87b2"), 0.59, style);
    const bareBrow = browPigment(new T.Color("#d3cbd0"), new T.Color("#ad87b2"), 0.59, "None");
    assert.ok(luma([stageBrow.r, stageBrow.g, stageBrow.b]) < luma([bareBrow.r, bareBrow.g, bareBrow.b]));
  }
});
