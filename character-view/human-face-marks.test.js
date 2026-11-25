import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import data from "./human-complexion-data.json" with { type: "json" };
import { browRoots, chartDensity as D, chartHeight as H, chartPoint, chartWidth as W, faceChart } from "./human-face-chart.js";
import {
  browParting,
  changeFaceMarkKind,
  drawIdentityMarks,
  faceMark,
  faceMarkKind,
  faceMarkKinds,
  faceMarkLimit,
  faceMarkToneHex,
  markFace,
  paintFaceMarks,
  validFaceMarks,
} from "./human-face-marks.js";
import { generatedHuman, humanForm } from "./human-form.js";
import { humanRegions } from "./human-mesh.js";
import { dressHuman } from "./human-wardrobe.js";
import { validateForm } from "./recipe.js";
import { applyOperations } from "./variations.js";

const FW = W * D,
  FH = H * D,
  fair = [0.67, 0.41, 0.3],
  deep = [0.13, 0.055, 0.036];
const decode = (byte) => {
  const v = byte / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
function paint(marks, skin = fair, extra = {}) {
  const map = new Uint8ClampedArray(FW * FH * 4).fill(255),
    rough = new Uint8ClampedArray(map.length).fill(240),
    bump = new Uint8ClampedArray(map.length).fill(255);
  return { map, rough, bump, ...paintFaceMarks({ map, rough, bump }, marks, { skin, brow: "eyebrow001", ...extra }) };
}
// Pixels of the paint that differ from untouched paint whose bare value is `bare`.
function touched(map, bare = [255, 255, 255]) {
  const out = [];
  for (let p = 0, i = 0; p < map.length; p += 4, i++) if (map[p] !== bare[0] || map[p + 1] !== bare[1] || map[p + 2] !== bare[2]) out.push(i);
  return out;
}
// A chart value at a pixel of the paint, read between stored pixels as the painter reads it.
function reader(field) {
  return (i) => {
    const fx = Math.min(W - 1.001, Math.max(0, ((i % FW) + 0.5) / D - 0.5)),
      fy = Math.min(H - 1.001, Math.max(0, (Math.floor(i / FW) + 0.5) / D - 0.5)),
      x = Math.floor(fx),
      y = Math.floor(fy),
      a = fx - x,
      b = fy - y,
      at = y * W + x;
    return (field[at] * (1 - a) + field[at + 1] * a) * (1 - b) + (field[at + W] * (1 - a) + field[at + W + 1] * a) * b;
  };
}
const every = faceMarkKinds.flatMap((kind) => faceMarkKind(kind).places.map((place) => [kind, place]));

test("the chart measures the face in millimetres with the wearer's left on +x", () => {
  const c = faceChart(),
    { eyes, noseTip, mouth, brows } = c.points;
  assert.ok(c.unit > 55 && c.unit < 72, "eye distance " + c.unit);
  assert.ok(eyes[0].centre[0] > 25 && eyes[1].centre[0] < -25);
  assert.ok(Math.abs(eyes[0].outer[0]) > Math.abs(eyes[0].inner[0]) && Math.abs(eyes[1].outer[0]) > Math.abs(eyes[1].inner[0]));
  assert.ok(noseTip[1] < -20 && mouth.centre[1] < noseTip[1] - 15 && mouth.top > mouth.bottom && mouth.corner > 15);
  assert.ok(brows[0].length >= 5 && brows[0].every(([x, y]) => x > 0 && y > 4) && brows[1].every(([x]) => x < 0));
  // Lips and both eye openings are charted, and no paint may reach the border or the mouth lining.
  const count = (f, test) => f.reduce((n, v) => n + (test(v) ? 1 : 0), 0);
  assert.ok(count(c.lip, (v) => v > 0.5) > 2000 && count(c.eye, (v) => v < 0) > 100 && count(c.wet, (v) => v > 0.5) > 300);
  const [patchX, patchY, half] = data.mouth.patch;
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const edge = Math.min(i, j, W - 1 - i, H - 1 - j) < 4,
        lining = Math.abs(i + 0.5 - patchX) < half + 8 && Math.abs(j + 0.5 - patchY) < half + 8;
      if (edge || lining) assert.equal(c.skin[j * W + i], 0);
    }
});

test("every kind paints in every place and keeps off the lips, the eyes and the border", () => {
  const c = faceChart(),
    lip = reader(c.lip),
    wet = reader(c.wet),
    eye = reader(c.eye),
    skin = reader(c.skin);
  for (const [kind, place] of every) {
    const { map, changed } = paint([faceMark(kind, 77, { place, tone: "#203040" })]),
      pixels = touched(map);
    assert.ok(pixels.length > 20, kind + " at " + place + " paints " + pixels.length + " pixels");
    assert.ok(changed.has("map"));
    for (const i of pixels) {
      assert.ok(skin(i) > 0.004, kind + " at " + place + " leaves the charted skin");
      assert.ok(lip(i) < 0.22, kind + " at " + place + " touches the lips");
      if (kind === "Eyeliner") assert.ok(eye(i) > -0.8, kind + " at " + place + " goes into the eye opening");
      else assert.ok(wet(i) < 0.5, kind + " at " + place + " touches the rim of a lid");
    }
  }
});

test("a mark is the same for the same seed and steady when its strength changes", () => {
  for (const kind of ["Freckles", "Scar", "Paint streaks"]) {
    const a = paint([faceMark(kind, 31)]).map,
      b = paint([faceMark(kind, 31)]).map,
      other = paint([faceMark(kind, 32)]).map;
    assert.deepEqual(a, b, kind);
    assert.notDeepEqual(a, other, kind);
  }
  // Stronger freckles add spots between the ones already there.
  const light = new Set(touched(paint([faceMark("Freckles", 31, { strength: 0.35 })]).map)),
    heavy = new Set(touched(paint([faceMark("Freckles", 31, { strength: 0.8 })]).map));
  assert.ok(heavy.size > light.size * 1.6);
  let kept = 0;
  for (const i of light) if (heavy.has(i)) kept++;
  assert.ok(kept >= light.size * 0.995, kept + " of " + light.size);
});

test("left and right are the wearer's own, and a middle mark keeps to the chosen half", () => {
  const x = reader(faceChart().x);
  for (const [kind, place] of [["Beauty mark", "Cheek"], ["Scar", "Brow"], ["Eyeliner", "Winged"], ["Paint band", "Eyes"], ["Paint dots", "Nose bridge"], ["Freckles", "Cheeks"]]) {
    const left = touched(paint([faceMark(kind, 5, { place, side: "Left", tone: "#203040" })]).map),
      right = touched(paint([faceMark(kind, 5, { place, side: "Right", tone: "#203040" })]).map);
    assert.ok(left.length > 20 && right.length > 20, kind);
    const share = (list, sign) => list.filter((i) => sign * x(i) > -1).length / list.length;
    assert.ok(share(left, 1) > 0.97, kind + " left " + share(left, 1));
    assert.ok(share(right, -1) > 0.97, kind + " right " + share(right, -1));
  }
});

test("tone is free of the skin: bright paint shows on dark skin and bare skin stays exact", () => {
  // Natural marks only darken, so the head keeps its colour and untouched paint stays white.
  const freckled = paint([faceMark("Freckles", 3)], deep);
  assert.deepEqual(freckled.base, deep);
  // Chalk white across the eyes of a dark face.
  const mark = faceMark("Paint band", 0, { tone: "#ece6d8", strength: 1 }),
    { map, base, rough } = paint([mark], deep),
    c = faceChart();
  assert.ok(base.every((v, k) => v > deep[k] * 3), "the base colour is raised");
  // A pixel of bare forehead: paint times base is the skin colour again, to rounding.
  const bare = ((H - 30) * D * FW + 60 * D) * 4,
    cheek = [map[bare], map[bare + 1], map[bare + 2]];
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(decode(cheek[k]) * base[k] - deep[k]) < 1e-6 * deep[k] + 1e-9, "channel " + k);
  // Under the band, between the eyes, the paint reaches its tone.
  let at = -1,
    best = Infinity;
  for (let i = 0; i < W * H; i++) {
    const d = Math.hypot(c.x[i], c.y[i] - 0.03 * c.unit);
    if (c.skin[i] > 0.9 && d < best) (best = d), (at = i);
  }
  const p = ((Math.floor(at / W) * D + 1) * FW + (at % W) * D + 1) * 4,
    shown = [0, 1, 2].map((k) => decode(map[p + k]) * base[k]),
    wanted = [0.84, 0.79, 0.69];
  // Brushed paint is a little thinner in places, and never brighter than its tone.
  for (let k = 0; k < 3; k++) assert.ok(shown[k] > 0.8 * wanted[k] && shown[k] < wanted[k] + 0.02, "channel " + k + " shows " + shown[k]);
  assert.ok(rough[p + 1] < 240, "paint is a little smoother or rougher than skin");
  // The same paint is the same colour on fair skin.
  const light = paint([mark], fair),
    seen = [0, 1, 2].map((k) => decode(light.map[p + k]) * light.base[k]);
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(seen[k] - shown[k]) < 0.05, "channel " + k + " shows " + seen[k] + " on fair skin");
  // A natural tone follows the skin and a chosen one does not.
  assert.notEqual(faceMarkToneHex(faceMark("Freckles", 1), "#d5ac94"), faceMarkToneHex(faceMark("Freckles", 1), "#654235"));
  assert.equal(faceMarkToneHex(faceMark("Freckles", 1, { tone: "#3366ff" }), "#654235"), "#3366ff");
});

test("a scar changes the relief and gloss of the skin, and facial hair keeps pigment under it faint", () => {
  const scar = paint([faceMark("Scar", 9, { place: "Cheek" })]);
  assert.ok(scar.changed.has("bump") && scar.changed.has("rough"));
  assert.ok(touched(scar.bump).length > 50);
  // Pigment where a beard is painted, on the chin, is mostly hidden by it.
  const c = faceChart(),
    y = reader(c.y),
    mark = [faceMark("Freckles", 4, { place: "Whole face", strength: 0.9 })],
    depth = (map) => touched(map).reduce((sum, i) => sum + (y(i) < c.points.mouth.bottom - 8 ? 255 - map[i * 4 + 1] : 0), 0),
    bare = depth(paint(mark).map),
    bearded = depth(paint(mark, fair, { facialHair: "Full beard" }).map);
  assert.ok(bare > 1000 && bearded < bare * 0.5, bearded + " of " + bare);
});

test("marks are validated, change kind in place and stay within the limit", () => {
  for (const [kind, place] of every) assert.ok(validFaceMarks([faceMark(kind, 1, { place })]), kind + " " + place);
  const good = faceMark("Scar", 4, { across: 0.2, up: -0.4, turn: 30, tone: "#aa8877" });
  assert.ok(validFaceMarks([good]));
  for (const bad of [
    { ...good, kind: "Tattoo" },
    { ...good, place: "Winged" },
    { ...good, side: "Middle" },
    { ...good, strength: 1.2 },
    { ...good, size: -0.1 },
    { ...good, seed: 1.5 },
    { ...good, tone: "red" },
    { ...good, turn: 120 },
    { ...good, across: 2 },
    { ...good, colour: "#000000" },
    null,
    "Freckles",
  ])
    assert.equal(validFaceMarks([bad]), false, JSON.stringify(bad));
  assert.equal(validFaceMarks(Array.from({ length: faceMarkLimit + 1 }, () => good)), false);
  assert.equal(validFaceMarks({}), false);
  assert.throws(() => faceMark("Tattoo"), /Unknown face mark/);
  // Changing kind keeps strength, size, tone and seed, and drops what the new kind lacks.
  const liner = changeFaceMarkKind(good, "Eyeliner");
  assert.ok(validFaceMarks([liner]));
  assert.deepEqual([liner.strength, liner.seed, liner.tone, liner.place, liner.turn, liner.across], [good.strength, 4, "#aa8877", "Lash line", undefined, undefined]);
  assert.equal(changeFaceMarkKind(faceMark("Paint band", 1, { place: "Chin" }), "Paint dots").place, "Chin");
});

test("a form carries face marks through validation, an assistant edit and a new look", () => {
  const form = { ...humanForm({}, 8), faceMarks: [faceMark("Freckles", 12), faceMark("Eyeliner", 3, { place: "Winged" })] };
  validateForm(form);
  assert.throws(() => validateForm({ ...form, faceMarks: [{ kind: "Freckles" }] }), /Invalid face marks/);
  const paintMark = faceMark("Paint streaks", 99, { side: "Right", tone: "#35b8d0" }),
    set = applyOperations(form, [{ op: "setForm", set: { faceMarks: [form.faceMarks[0], paintMark] } }], {}, true, [], 5);
  assert.deepEqual(set.faceMarks, [form.faceMarks[0], paintMark]);
  validateForm(set);
  assert.equal(applyOperations(set, [{ op: "setForm", set: { faceMarks: null } }], {}, true, [], 5).faceMarks, undefined);
  // A new outfit keeps what belongs to the person and replaces what is worn.
  for (let seed = 8700; seed < 8760; seed++) {
    const look = dressHuman(form, seed),
      marks = look.faceMarks ?? [];
    validateForm(look);
    assert.deepEqual(marks.filter((mark) => !faceMarkKind(mark.kind).worn), [form.faceMarks[0]]);
    assert.ok(!marks.includes(form.faceMarks[1]));
    assert.deepEqual(dressHuman(form, seed), look);
    // The rest of the look does not depend on the marks.
    const { faceMarks, ...plain } = form;
    assert.deepEqual(dressHuman(plain, seed).humanStyle, look.humanStyle);
  }
});

test("drawn people are repeatable, often unmarked, and marked across skin tones and frames", () => {
  let marked = 0;
  const kinds = new Set(),
    skins = new Set();
  for (let seed = 0; seed < 160; seed++) {
    const form = generatedHuman(seed, ["male", "female", "neutral", "any"][seed % 4]);
    if (seed < 12) {
      assert.deepEqual(generatedHuman(seed, ["male", "female", "neutral", "any"][seed % 4]), form);
      validateForm(form);
    }
    if (!form.faceMarks) continue;
    assert.ok(validFaceMarks(form.faceMarks) && form.faceMarks.length);
    marked++;
    for (const mark of form.faceMarks) {
      kinds.add(mark.kind);
      assert.ok(!faceMarkKind(mark.kind).worn);
      if (mark.kind === "Freckles") skins.add(form.appearance.skin < "#90" ? "deep" : "fair");
    }
  }
  assert.ok(marked > 35 && marked < 105, marked + " of 160 are marked");
  assert.deepEqual([...kinds].sort(), ["Beauty mark", "Freckles", "Scar", "Sun spots"]);
  assert.deepEqual([...skins].sort(), ["deep", "fair"]);
  assert.deepEqual(drawIdentityMarks(77, { skin: "#d5ac94", age: 0.5 }), drawIdentityMarks(77, { skin: "#d5ac94", age: 0.5 }));
});

test("a scar through the brow parts its hairs, and other marks leave the brow as it was", () => {
  const { faceMarks, ...bare } = generatedHuman(8715),
    material = new T.MeshStandardMaterial(),
    hairs = (form) => {
      const part = form.parts.find((p) => p.humanBone === "head"),
        fibres = humanRegions(form, () => material, true)(part).children.find((mesh) => mesh.name === "brows-and-lashes");
      return fibres.geometry.index.count / 3;
    },
    whole = hairs(bare);
  assert.equal(browParting(bare, "eyebrow001"), null);
  for (const marks of [[faceMark("Freckles", 1)], [faceMark("Scar", 4, { place: "Cheek" })], [faceMark("Paint band", 2)]]) {
    assert.equal(browParting({ ...bare, faceMarks: marks }, "eyebrow001"), null);
    assert.equal(hairs({ ...bare, faceMarks: marks }), whole);
  }
  for (const name of ["eyebrow001", "eyebrow003"]) {
    const left = browParting({ ...bare, faceMarks: [faceMark("Scar", 4)] }, name),
      both = browParting({ ...bare, faceMarks: [faceMark("Scar", 4, { side: "Both" })] }, name),
      count = (flags) => flags.reduce((sum, v) => sum + v, 0);
    // One flag for each stored stroke, and a narrow gap on each scarred side.
    assert.equal(left.length, browRoots(name).length / 2);
    assert.ok(count(left) >= 2 && count(left) < left.length / 12, name + " parts " + count(left));
    // The two brows are not exact mirrors of each other.
    assert.ok(count(both) > 1.5 * count(left) && count(both) < 2.5 * count(left), name + " parts " + count(both) + " on both sides");
    // The parted hairs are on the wearer's left, where the scar is.
    const roots = browRoots(name);
    for (let k = 0; k < left.length; k++) if (left[k]) assert.ok(chartPoint(roots[k * 2], roots[k * 2 + 1])[0] > 20);
  }
  const scarred = hairs({ ...bare, faceMarks: [faceMark("Scar", 4)] });
  assert.ok(scarred < whole && scarred > whole * 0.97, scarred + " of " + whole);
});

test("a head builds with marks in colour and clay, and a material without face paint is left alone", () => {
  const form = { ...generatedHuman(8713), faceMarks: every.slice(0, faceMarkLimit).map(([kind, place], i) => faceMark(kind, i, { place })) },
    material = new T.MeshStandardMaterial({ color: "#b08566" });
  for (const plain of [false, true]) {
    const part = form.parts.find((p) => p.humanBone === "head"),
      group = humanRegions(form, () => material, plain)(part);
    assert.ok(group.children.some((mesh) => mesh.userData.faceSurface));
  }
  // Without a document there is no face paint to mark: the material comes back as it was.
  const before = material.color.getHex();
  assert.equal(markFace(material, form), material);
  assert.equal(markFace(material, { ...form, faceMarks: undefined }), material);
  assert.equal(material.color.getHex(), before);
  assert.equal(material.map, null);
});

test("paintFaceMarks preserves exact bare skin and natural mark tones when starting from a headroom-raised head base", () => {
  const neutralByte = 225;
  const startBase = deep.map((v) => v / decode(neutralByte));
  const map = new Uint8ClampedArray(FW * FH * 4);
  for (let i = 0; i < map.length; i += 4) {
    map[i] = map[i + 1] = map[i + 2] = neutralByte;
    map[i + 3] = 255;
  }
  const rough = new Uint8ClampedArray(map.length).fill(240);
  const bump = new Uint8ClampedArray(map.length).fill(255);
  // Natural freckles fit inside startBase without raising it further and keep bare skin exact.
  const freckled = paintFaceMarks({ map: map.slice(), rough: rough.slice(), bump: bump.slice() }, [faceMark("Freckles", 3)], { skin: deep, base: startBase, brow: "eyebrow001" });
  assert.deepEqual(freckled.base, startBase);
  // Bright chalk paint on dark skin raises base further and still preserves exact bare skin at border.
  const chalk = paintFaceMarks({ map, rough, bump }, [faceMark("Paint band", 0, { tone: "#ece6d8", strength: 1 })], { skin: deep, base: startBase, brow: "eyebrow001" });
  assert.ok(chalk.base.every((v, k) => v > startBase[k] * 2));
  const bare = ((H - 30) * D * FW + 60 * D) * 4;
  for (let k = 0; k < 3; k++) {
    assert.ok(Math.abs(decode(map[bare + k]) * chalk.base[k] - deep[k]) < 2e-3, "border channel " + k);
  }
});
