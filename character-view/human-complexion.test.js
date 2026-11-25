import {skinPigment} from "./human-photo-detail.js";
import { makeupPalette, mixMakeup } from "./human-makeup.js";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import * as T from "three";
import data from "./human-complexion-data.json" with { type: "json" };
import pigmentData from "./human-facial-pigment-data.json" with { type: "json" };
import finishData from "./human-portrait-finish-data.json" with { type: "json" };
import { beardRoot, complexionNames, complexionProfile, faceMaterial, finishDonors, finishEncoding, finishRead, finishTint, headroomForSkin, pigmentTint, skinMaterial } from "./human-complexion.js";
import { generatedHuman, tintHumanSkin } from "./human-form.js";
import { humanRegions } from "./human-mesh.js";

test("complexionProfile produces skin-tone-relative, age-relative and choice-controlled reflectance within the 0.8 mark contract", () => {
  const light = complexionProfile({ skin: "#dbb79f", age: 0.1, choice: "Fine" });
  const medium = complexionProfile({ skin: "#ac7e62", age: 0.1, choice: "Fine" });
  const deep = complexionProfile({ skin: "#604031", age: 0.1, choice: "Fine" });

  // Luminance & fairness ordering across light, medium and deep skin.
  assert.ok(light.fair > medium.fair && medium.fair > deep.fair);
  assert.ok(light.fair > 0.9 && deep.fair < 0.05);

  // Every reflectance value is well below matte 0.78 while remaining physically bounded <= 0.80.
  for (const p of [light, medium, deep]) {
    assert.ok(p.bodyRoughness >= 0.58 && p.bodyRoughness <= 0.76, "body " + p.bodyRoughness);
    assert.ok(p.faceRoughness >= 0.52 && p.faceRoughness < p.bodyRoughness, "face " + p.faceRoughness);
    assert.ok(p.faceRoughness - p.shineDrop >= 0.40 && p.faceRoughness - p.shineDrop <= 0.58, "T-zone " + (p.faceRoughness - p.shineDrop));
    assert.ok(p.lipRoughness >= 0.35 && p.lipRoughness < p.faceRoughness, "lip " + p.lipRoughness);
  }
  // Deep skin keeps a higher base & T-zone roughness than fair skin so dark albedo doesn't turn sweaty/plastic.
  assert.ok(deep.faceRoughness > light.faceRoughness + 0.05);
  assert.ok(deep.faceRoughness - deep.shineDrop > light.faceRoughness - light.shineDrop + 0.08);
  // Deep skin uses restrained blush & deeper natural lip tint rather than pale pink.
  assert.ok(deep.blushG < light.blushG && deep.lipTint[0] < light.lipTint[0]);

  // Age increases dryness and lowers T-zone sheen drop.
  const young = complexionProfile({ skin: "#ac7e62", age: 0.0, choice: "Fine" });
  const older = complexionProfile({ skin: "#ac7e62", age: 0.9, choice: "Fine" });
  assert.ok(older.faceRoughness > young.faceRoughness);
  assert.ok(older.bodyRoughness > young.bodyRoughness);
  assert.ok(older.shineDrop < young.shineDrop);

  // Complexion choice controls pore/wrinkle relief and dryness smoothly.
  const smooth = complexionProfile({ skin: "#ac7e62", age: 0.2, choice: "Smooth" });
  const fine = complexionProfile({ skin: "#ac7e62", age: 0.2, choice: "Fine" });
  const weathered = complexionProfile({ skin: "#ac7e62", age: 0.2, choice: "Weathered" });
  const lined = complexionProfile({ skin: "#ac7e62", age: 0.2, choice: "Lined" });
  assert.equal(smooth.wrinkleRelief, 0);
  assert.ok(smooth.poreRelief < fine.poreRelief);
  assert.ok(fine.wrinkleRelief < weathered.wrinkleRelief && weathered.wrinkleRelief < lined.wrinkleRelief);
  assert.ok(smooth.faceRoughness < fine.faceRoughness && fine.faceRoughness < lined.faceRoughness);
});

test("body skin shares one cloned skin-tone-relative material matching the face border without mutating base", () => {
  const base = new T.MeshStandardMaterial({ color: "#604031", roughness: 0.88 });
  const form = tintHumanSkin(generatedHuman(8738), "#604031");
  const body = skinMaterial(base, form);
  assert.notEqual(body, base);
  assert.equal(base.roughness, 0.88);
  const expected = complexionProfile({
    skin: form.appearance.skin,
    age: Math.round((form.human.age ?? 0) * 20) / 20,
    choice: form.complexion,
  }).bodyRoughness;
  assert.equal(body.roughness, expected);

  // In humanRegions, all non-head regions share one body skin material while head gets its own,
  // and plain/clay mode leaves base untouched.
  const build = humanRegions(form, () => base, false);
  const head = build(form.parts.find((p) => p.humanBone === "head")).children.find((m) => m.userData.faceSurface);
  const neck = build(form.parts.find((p) => p.humanBone === "neck_01")).children[0];
  const chest = build(form.parts.find((p) => p.humanBone === "spine_03")).children[0];
  assert.equal(neck.material, chest.material);
  assert.notEqual(neck.material, base);
  assert.notEqual(head.material, neck.material);
  assert.equal(neck.material.roughness, expected);
  assert.equal(base.roughness, 0.88);

  // Without DOM (Node), faceMaterial still aligns roughness to bodyRoughness so there is no seam.
  assert.equal(faceMaterial(base, form).roughness, expected);

  const plainBuild = humanRegions(form, () => base, true);
  assert.equal(plainBuild(form.parts.find((p) => p.humanBone === "neck_01")).children[0].material, base);
  base.dispose();
  body.dispose();
});

test("packed complexion data keeps schema, 4 detail maps and 3 fields intact", () => {
  assert.deepEqual(Object.keys(data).sort(), ["brows", "encoding", "fields", "growth", "lids", "maps", "mouth", "rect"]);
  assert.equal(data.maps.length, 4);
  assert.equal(data.fields.length, 3);
  assert.ok(complexionNames.includes("Smooth") && complexionNames.includes("Fine") && complexionNames.includes("Lined"));
  for (const url of [...data.maps, ...data.fields]) {
    assert.ok(url.startsWith("data:image/webp;base64,"));
  }
});

test("makeup colours the lips independently and leaves the unpainted border exact", () => {
  const palette = makeupPalette("Plum stage");
  const colour = [1,1,1];
  mixMakeup(colour,palette,1,0,0,0,0);
  assert.deepEqual(colour,[1,1,1]);
  mixMakeup(colour,palette,1,0,0,0,1);
  assert.ok(colour.every((v,i)=>Math.abs(v-palette.lip[i])<1e-10));
  assert.equal(makeupPalette("None"),null);
});

test("headroomForSkin preserves exact bare-skin border and enables positive highlights across skin tones", () => {
  const decode = (b) => { const v = b / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  for (const hex of ["#dfbca7", "#b28162", "#5a3b2c", "#6e9b77", "#7582ad", "#ffffff", "#000000"]) {
    const c = new T.Color(hex);
    const { neutral, base } = headroomForSkin(c);
    const skin = [c.r, c.g, c.b];
    for (let k = 0; k < 3; k++) {
      assert.ok(Number.isInteger(neutral[k]) && neutral[k] >= 1 && neutral[k] <= 255);
      assert.ok(Math.abs(decode(neutral[k]) * base[k] - skin[k]) < 1e-12, `${hex} ch ${k}`);
    }
    if (hex !== "#ffffff" && hex !== "#000000") {
      assert.ok(base.every((v, k) => v > skin[k] * 1.25), `${hex} has positive headroom`);
    }
  }
});

test("pigmentTint preserves neutral border, allows positive highlights, and respects fantasy skin hue", () => {
  assert.equal(pigmentData.encoding, "local-pigment-v2");
  assert.equal(pigmentData.maps.length, 6);
  const light = complexionProfile({ skin: "#dfbca7", age: 0.15, choice: "Fine" });
  const deep = complexionProfile({ skin: "#5a3b2c", age: 0.15, choice: "Fine" });
  const fantasy = complexionProfile({ skin: "#6e9b77", age: 0.15, choice: "Fine" });
  assert.deepEqual(pigmentTint(128, 128, 128, light, 1), [1, 1, 1]);
  assert.deepEqual(pigmentTint(128, 128, 128, deep, 1), [1, 1, 1]);
  assert.deepEqual(pigmentTint(128, 128, 128, fantasy, 1), [1, 1, 1]);
  // Positive luminance texel lifts all three channels above 1.0 (no white clipping).
  for (const p of [light, deep, fantasy]) {
    const hi = pigmentTint(200, 128, 128, p, 1);
    assert.ok(hi.every((v) => v > 1.15 && v < 1.45), "positive highlight " + hi);
  }
  // Fantasy skin keeps full luminance modeling while restraining warm human-red chroma shift.
  const warmHuman = pigmentTint(128, 210, 180, light, 1);
  const warmFantasy = pigmentTint(128, 210, 180, fantasy, 1);
  assert.ok(warmHuman[0] / warmHuman[1] > warmFantasy[0] / warmFantasy[1] + 0.08);
});

test("bare lips, sockets and the donor colour are painted strongly enough to read in a game portrait", async () => {
  const { complexionProfile, pigmentTint, portraitRead } = await import("./human-complexion.js");
  for (const skin of ["#f0c8ae", "#ac7e62", "#613f2f"]) {
    const p = complexionProfile({ skin, age: 0.3 });
    // A bare lip is this skin a little deeper and redder, and it is not glossier than a lid.
    assert.ok(p.lipTint[0] > p.lipTint[1] + 0.06 && p.lipTint[1] > 0.72 && p.lipTint[0] < 1, skin + " lip " + p.lipTint);
    assert.ok(p.lipRoughness >= 0.5 && p.lipRoughness < p.faceRoughness, skin + " lip roughness " + p.lipRoughness);
    assert.ok(p.socketTint.every(v => v < 0.92 && v > 0.75), skin + " socket " + p.socketTint);
    // The donor colour at its portrait strength moves a texel by more than a tenth, and still leaves the border alone.
    const dark = pigmentTint(100, 128, 128, p, portraitRead.pigment), bare = pigmentTint(128, 128, 128, p, portraitRead.pigment);
    assert.ok(dark[0] < 0.9 && dark[0] > 0.5, skin + " shade " + dark[0]);
    assert.deepEqual(bare, [1, 1, 1]);
  }
  // A skin that is not a natural hue keeps its hue in the lip: no channel is pulled far from the others.
  const painted = complexionProfile({ skin: "#b98fd6" });
  assert.ok(Math.max(...painted.lipTint) - Math.min(...painted.lipTint) < 0.09, "fantasy lip " + painted.lipTint);
  assert.ok(portraitRead.browMass > 0 && portraitRead.lip <= 0.6);
});

test("the packed portrait finish has a donor for every age, depth and frame, and credits every source", () => {
  assert.equal(finishData.encoding.name, finishEncoding);
  assert.equal(finishData.encoding.neutral, 128);
  assert.equal(finishData.maps.length, finishData.donors.length);
  for (const key of ["micro", "meso", "gloss", "lips"]) assert.ok(finishData[key].startsWith("data:image/webp;base64,"), key);
  for (const age of [0, 1, 2]) for (const deep of [false, true]) for (const male of [false, true])
    assert.ok(finishData.donors.some(d => d.age === age && d.deep === deep && d.male === male), `donor for ${age} ${deep} ${male}`);
  assert.ok(finishData.credits.length >= 2 && finishData.credits.every(c => /CC0/.test(c.license) && /^https?:/.test(c.source)));
  // Relief is read as a height at twice the old bump scale, with the older terms halved to keep their depth.
  assert.equal(finishRead.bumpScale * finishRead.legacyRelief, 0.00125);
});

test("finishDonors matches age, depth and frame and cross-fades at every boundary", () => {
  const donors = finishData.donors, of = look => finishDonors(look);
  const total = (look, value) => of(look).reduce((sum, [i, share]) => sum + share * value(donors[i]), 0);
  for (const seed of [0, 31, 32, 4711, 0xffffffff]) for (const age of [0, 0.2, 0.3, 0.5, 0.66, 0.9]) {
    for (const [skin, deep] of [["#f0c8ae", false], ["#ac7e62", false], ["#5a3b2c", true], ["#3a2318", true]]) {
      for (const [look, male] of [[{ frame: -0.2 }, false], [{ frame: 0.4 }, true], [{ frame: -0.2, facial: "Full beard" }, true], [{ frame: -0.2, facial: "None" }, false]]) {
        const chosen = of({ skin, age, seed, ...look });
        assert.deepEqual(chosen, of({ skin, age, seed, ...look }), "repeatable");
        assert.ok(chosen.length >= 1 && chosen.length <= 2 && Math.abs(chosen.reduce((sum, [, share]) => sum + share, 0) - 1) < 1e-12);
        // Away from the boundaries of depth and frame a face never reads a donor of the other kind.
        for (const [i, share] of chosen) assert.ok(share > 0 && donors[i].deep === deep && donors[i].male === male, `${skin} ${age} ${seed} chose ${donors[i].name}`);
      }
    }
  }
  const band = age => total({ skin: "#ac7e62", age }, d => d.age);
  assert.equal(band(0), 0); assert.equal(band(0.25), 0); assert.equal(band(0.5), 1); assert.equal(band(0.8), 2); assert.equal(band(1), 2);
  assert.equal(of({ skin: "#ac7e62", age: 0.9 }).length, 1, "an old face reads one donor");
  // Every slider moves the paint continuously: no step swaps a whole face.
  for (let age = 0; age < 1; age += 0.01) assert.ok(Math.abs(band(age + 0.01) - band(age)) < 0.06, "age step at " + age);
  const frame = v => total({ skin: "#ac7e62", age: 0.1, frame: v }, d => +d.male);
  for (let v = -1; v < 1; v += 0.01) assert.ok(Math.abs(frame(v + 0.01) - frame(v)) < 0.09, "frame step at " + v);
  assert.equal(frame(-1), 0); assert.equal(frame(0), 0); assert.equal(frame(0.3), 1);
  const depth = grey => total({ skin: new T.Color(grey * 1.6, grey, grey * 0.7), age: 0.1 }, d => +d.deep);
  for (let v = 0.02; v < 0.4; v += 0.002) assert.ok(Math.abs(depth(v + 0.002) - depth(v)) < 0.1, "depth step at " + v);
  assert.equal(depth(0.03), 1); assert.equal(depth(0.3), 0);
  // The seed chooses among equal donors, so two young pale women need not share one face of paint.
  assert.ok(new Set(Array.from({ length: 8 }, (_, i) => of({ skin: "#f0c8ae", age: 0.1, seed: i * 32 })[0][0])).size >= 3);
});

test("finishTint leaves bare skin exact, keeps donor shade on any skin and restrains donor hue on request", () => {
  assert.deepEqual(finishTint(128, 128, 128), [1, 1, 1]);
  assert.deepEqual(finishTint(60, 200, 90, 1, 0), [1, 1, 1]);
  const shade = finishTint(100, 100, 100), light = finishTint(170, 170, 170);
  assert.ok(shade.every(v => v < 0.75 && v > 0.6) && light.every(v => v > 1.25 && v < 1.4), shade + " " + light);
  // A redder donor texel: full on a natural skin, mostly shade on a painted hue, grey with no chroma.
  const full = finishTint(150, 110, 105, 1), fantasy = finishTint(150, 110, 105, finishRead.fantasyChroma), grey = finishTint(150, 110, 105, 0);
  assert.ok(full[0] / full[1] > fantasy[0] / fantasy[1] + 0.1 && fantasy[0] / fantasy[1] > 1.05);
  assert.ok(Math.abs(grey[0] - grey[1]) < 1e-12 && Math.abs(grey[1] - grey[2]) < 1e-12);
  const mean = v => Math.log(v[0] * v[1] * v[2]);
  assert.ok(Math.abs(mean(full) - mean(grey)) < 1e-12, "chroma leaves the donor's light and shade alone");
  // Half weight is half the shift in log light: two donors cross-fade without a dip.
  assert.ok(Math.abs(finishTint(100, 100, 100, 1, 0.5)[0] ** 2 - shade[0]) < 1e-12);
});

test("headroomForSkin keeps the bare border exact at the wider gain a pale beard needs on deep skin", () => {
  const decode = (b) => { const v = b / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  for (const hex of ["#5a3b2c", "#3a2318", "#6e9b77"]) for (const gain of [1.5, 3, 6]) {
    const c = new T.Color(hex), skin = [c.r, c.g, c.b], { neutral, base } = headroomForSkin(c, gain);
    for (let k = 0; k < 3; k++) {
      assert.ok(Number.isInteger(neutral[k]) && neutral[k] >= 1 && neutral[k] <= 255);
      assert.ok(Math.abs(decode(neutral[k]) * base[k] - skin[k]) < 1e-12, `${hex} ${gain} ch ${k}`);
      assert.ok(base[k] >= skin[k] * gain * 0.9 || base[k] >= 0.99, `${hex} ${gain} headroom ${base[k] / skin[k]}`);
    }
  }
});

test("the skin under a beard takes the colour of its roots on light and deep skin, and a bare face takes none", () => {
  const decode = (b) => { const v = b / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const light = new T.Color("#dbb79f"), deep = new T.Color("#5a4037"), dark = new T.Color("#2a1c16"), white = new T.Color("#d9d6cf");
  // Stubble is too sparse to hide the skin: it keeps its multiplying tint and takes no root colour.
  for (const skin of [light, deep]) for (const hair of [dark, white]) for (const facial of [undefined, "None", "Stubble"]) assert.equal(beardRoot(skin, hair, facial), null);
  const luminance = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], rgb = (c) => [c.r, c.g, c.b];
  // What the paint can hold of a root colour: nothing above the head base.
  const laid = (skin, hair, facial) => {
    const root = beardRoot(skin, hair, facial), { neutral, base } = headroomForSkin(skin, root.gain);
    rgb(skin).forEach((v, k) => assert.ok(Math.abs(decode(neutral[k]) * base[k] - v) < 1e-12, "bare skin stays exact beside a beard"));
    if (root.gain < 6) rgb(root.tone).forEach((v, k) => assert.ok(v / base[k] <= 1.0001, `${facial} clips ${v / base[k]}`));
    return rgb(root.tone).map((v, k) => Math.min(v, base[k]));
  };
  for (const facial of ["Moustache", "Short beard", "Full beard"]) {
    // Dark hair covers light skin; pale hair lifts deep skin, which a tint that only multiplies the skin cannot do.
    assert.ok(luminance(laid(light, dark, facial)) < 0.45 * luminance(rgb(light)), facial + " dark on light");
    assert.ok(luminance(laid(deep, white, facial)) > 3 * luminance(rgb(deep)), facial + " white on deep");
    assert.ok(luminance(laid(light, white, facial)) > 0.3 * luminance(rgb(light)), facial + " white on light stays pale");
    assert.ok(luminance(laid(deep, dark, facial)) < luminance(rgb(deep)), facial + " dark on deep");
  }
});

test("the beard's root colour keeps its own name inside the face painter", () => {
  // A texel's under-eye density once hid the root colour of the same name, so beards stayed unpainted wherever that
  // density was zero, which is the whole beard. Each of the two is declared once.
  const source = readFileSync(new URL("./human-complexion.js", import.meta.url), "utf8");
  const start = source.indexOf("function paint(look){"), body = source.slice(start, source.indexOf("export function skinMaterial", start));
  assert.ok(start > 0 && body.length > 2000);
  const declarations = (name) => (body.match(new RegExp("(?:const |let |,)" + name + "=", "g")) ?? []).length;
  assert.equal(declarations("root"), 1);
  assert.equal(declarations("rootLinear"), 1);
  assert.equal(declarations("under"), 1);
  assert.match(body, /rootLinear&&cover>0\?mix\(lit,rootLinear\[k\][^,]*,cover\):lit/);
  assert.equal((body.match(/root\?0:cover/g) ?? []).length, 3);
});

test("seeded bare skin pigment remains continuous across the face chart", () => {
  const sample = skinPigment(9842), same = skinPigment(9842), other = skinPigment(9843);
  const first = [], second = [], nearby = [];
  let distinct = false;
  for (const u of [0, .07, .27, .63, 1]) for (const v of [0, .18, .51, 1]) {
    sample(u, v, first);
    same(u, v, second);
    assert.deepEqual(first, second);
    other(u, v, second);
    distinct ||= first.some((n, i) => Math.abs(n-second[i]) > .01);
    sample(u+1e-7, v-1e-7, nearby);
    assert.ok(first.every((n, i) => Math.abs(n) < .25 && Math.abs(n-nearby[i]) < .0001));
  }
  assert.ok(distinct);
});
