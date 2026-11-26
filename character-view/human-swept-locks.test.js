import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { evaluateHuman } from "./human-surface.js";
import { groomGeometry, strandGroom } from "./human-groom.js";
import { surfaceFrame } from "./human-fringe.js";
import { lockSheetPixels, lockTiles, scalpShare, sweptVolume } from "./human-swept-locks.js";

const material = () => new T.MeshStandardMaterial();
const heads = { average: { height: 1.72 }, broad: { height: 1.86, frame: 0.6, headWidth: 0.4 }, slim: { height: 1.58, frame: -0.4, headWidth: -0.4 } };
const style = { hair: "Low ponytail", hairColor: "#bcb2a3", fringe: "Off the face" };
const reach = (part, f, test) => { let far = 0; const p = part.position; for (let i = 0; i < p.length; i += 3) { const d = [p[i] - f.centre[0], p[i + 1] - f.centre[1], p[i + 2] - f.centre[2]]; if (test(d)) far = Math.max(far, Math.hypot(...d)); } return far; };

test("the strand picture is a cutout with relief and sheen, drawn for a full model and for a game model", () => {
  for (const game of [false, true]) {
    const { size, color, normal, roughness } = lockSheetPixels(game), tiles = lockTiles(game);
    assert.equal(color.length, size * size * 4);
    assert.ok(tiles.lock.length >= 3 && tiles.long === tiles.lock && tiles.wisp.length >= 1);
    for (const [left, top, wide, tall] of [...tiles.lock, ...tiles.wisp, tiles.solid]) assert.ok(left >= 0 && top >= 0 && left + wide <= size && top + tall <= size, "a tile lies inside the picture");
    for (const [left, top, wide, tall] of tiles.lock) {
      let covered = 0, clear = 0, tilted = 0, sheen = new Set();
      const y = top + Math.floor(tall * .5);
      for (let x = left; x < left + wide; x++) {
        const at = (y * size + x) * 4;
        if (color[at + 3] > 200) covered++; else if (color[at + 3] < 40) clear++;
        if (Math.abs(normal[at] - 128) > 12) tilted++;
        sheen.add(roughness[at + 1]);
      }
      assert.ok(covered > wide * .6, `a lock is mostly hair half way along: ${covered} of ${wide}`);
      assert.ok(clear >= 4, "its gutter is clear");
      assert.ok(tilted > wide * .2, "its strands are in relief");
      assert.ok(sheen.size > 8, "its strands shine along their crowns");
      let rooted = 0;
      for (let x = left; x < left + wide; x++) if (color[((top + tall - 8) * size + x) * 4 + 3] > 127) rooted++;
      assert.ok(rooted < covered, "a lock starts as separate strands");
    }
  }
});

test("rooted locks cover the drawn-back scalp on small and large heads, stand over its painted layer and stay off the face", () => {
  for (const [name, human] of Object.entries(heads)) for (const budget of [0, 9600]) {
    const surface = evaluateHuman(human), f = surfaceFrame(surface), groom = groomGeometry(surface, style, { budget }), label = `${name}, ${budget ? "game" : "full"}`;
    assert.ok(groom.rooted, `${label} is rooted`);
    for (const x of groom.cards.position) if (!Number.isFinite(x)) assert.fail(`${label}: a lock point is not a number`);
    for (const x of groom.cards.uv) if (!(x >= 0 && x <= 1)) assert.fail(`${label}: a lock reads outside the picture`);
    assert.equal(groom.cards.weights.length, groom.cards.position.length / 3 * 4, `${label}: every point is skinned`);
    const triangles = groom.cards.index.length / 3;
    assert.ok(budget ? triangles > 1200 && triangles <= 2400 : triangles > 5000 && triangles <= 9000, `${label}: ${triangles} lock triangles`);
    assert.ok(budget ? groom.roots.index.length / 3 < 1200 : true, `${label}: the painted layer of a game model is not subdivided`);
    for (const [where, test] of [["top", d => d[1] > .06 * f.k && Math.abs(d[0]) < .03 * f.k], ["front", d => d[2] > .045 * f.k && d[1] > .055 * f.k], ["side", d => Math.abs(d[0]) > .05 * f.k && d[1] > .03 * f.k]])
      assert.ok(reach(groom.cards, f, test) > reach(groom.roots, f, test) + .0015, `${label}: locks stand over the painted layer at the ${where}`);
    const eye = Math.max(...f.eyes.map(e => e.centre[1]));
    let low = Infinity;
    for (let i = 0; i < groom.cards.position.length; i += 3) if (groom.cards.position[i + 2] > f.centre[2] + .07 * f.k && Math.abs(groom.cards.position[i]) < .04 * f.k) low = Math.min(low, groom.cards.position[i + 1]);
    assert.ok(low > eye + .025 * f.k, `${label}: the lowest front lock is ${Math.round(1000 * (low - eye))} mm over the eyes`);
  }
});

test("the depth of the hair falls to the tie and to the sides, and the painted layer keeps under the locks", () => {
  const volume = sweptVolume({ volume: 10 }, 1, [0, -.2, -1]), unit = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
  const top = volume(unit([0, 1, .2])), side = volume(unit([1, .05, 0])), tie = volume(unit([0, -.2, -1]));
  assert.ok(top > .008 && top < .013, `${top}`);
  assert.ok(side < top * .6 && tie < top * .3);
  assert.ok(scalpShare(true) < scalpShare(false) && scalpShare(false) < .8);
});

test("the parting, the helmet and the colour change the locks, and other tied styles keep their painted scalp", () => {
  const surface = evaluateHuman(heads.average), back = groomGeometry(surface, style), parted = groomGeometry(surface, { ...style, fringe: "Parted" }), left = groomGeometry(surface, { ...style, fringe: "Swept left" });
  assert.equal(back.cards.index.length, parted.cards.index.length);
  assert.notDeepEqual(back.cards.position.slice(-3000), parted.cards.position.slice(-3000));
  assert.notDeepEqual(parted.cards.position.slice(-3000), left.cards.position.slice(-3000));
  const tucked = groomGeometry(surface, style, { tucked: true });
  assert.ok(!tucked.rooted && tucked.cards.index.length === 0);
  assert.ok(!groomGeometry(surface, { hair: "Ponytail" }).rooted);
  const [roots, locks] = strandGroom(surface, style, material, false, "#aa8069");
  assert.equal(locks.material.map.name, "Hair locks");
  assert.ok(locks.material.normalMap && locks.material.roughnessMap && locks.material.alphaTest > 0 && locks.material.side === T.DoubleSide && locks.material.userData.fibreLOD);
  assert.ok(roots.userData.hairRoots && roots.material.map.name === "Brushed scalp" && roots.material.userData.hairCards);
  const dark = groomGeometry(surface, { ...style, hairColor: "#302725" });
  assert.deepEqual(dark.cards.position, back.cards.position);
  assert.ok(dark.cards.color[0] < back.cards.color[0]);
});
