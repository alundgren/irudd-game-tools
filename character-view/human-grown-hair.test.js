// The earlier sculpted hairstyles, grown as strands: what an ordinary draw wears in a game model.
import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { evaluateHuman } from "./human-surface.js";
import { generatedHuman } from "./human-form.js";
import { adultStyles, chooseAdultStyle, dressHuman, dressedHuman, validAdultStyle, hairWornFor } from "./human-wardrobe.js";
import { groomStyles, grownStyles, strandGroom, tuftPixels, tuftTiles } from "./human-groom.js";
import { coilStyles } from "./human-coils.js";
import { probeHair } from "./human-hair-probe.js";

const material = () => new T.MeshStandardMaterial();
const budget = 9600, human = { height: 1.72, frame: 0.2 };
const surface = evaluateHuman(human);
const wear = (style, { game = budget, plain = false, outfit = "Work clothes", surface: s = surface } = {}) =>
  dressedHuman(s, { outfit, humanStyle: { outfit: "Shirt and chinos", fringe: "Parted", hairColor: "#72553d", ...style }, appearance: { skin: "#b58a6c" }, human }, material, plain, game);
const strands = meshes => meshes.find(mesh => mesh.userData.strandGroom);
// Curls and coils are one mass of clumps with its own picture and no strands over it: see human-curls.test.js.
const massed = ["Curls", "Afro"], mass = meshes => meshes.find(mesh => mesh.userData.hairRoots && mesh.material.map?.name === "Hair clumps");
const triangles = mesh => mesh.geometry.index.count / 3;
const lowest = mesh => { let y = Infinity; const p = mesh.geometry.attributes.position.array; for (let i = 1; i < p.length; i += 3) y = Math.min(y, p[i]); return y; };
const worst = views => Math.max(...Object.values(views).flat());
const earlier = ["Buzz cut", "Crop", "Side part", "Swept back", "Curls", "Afro", "Bob", "Long", "Wavy", "Ponytail", "Bun", "Braid"];
const locked = ["Long", "Wavy"];
const shells = ["Buzz cut", "Crop", "Side part", "Swept back", "Curls", "Afro", "Bob", "Bob lengths", "Long hair", "Long lengths", "Wavy hair", "Wavy lengths", "Ponytail tail", "Bun knot", "Braid plait"];

test("the earlier styles keep their names and their place in a draw, and are grown as strands", () => {
  assert.deepEqual(groomStyles, ["Tapered crop", "Horseshoe crop", "Close crop"], "these fitted cuts use the separate haircut draw");
  for (const name of earlier) {
    assert.ok(grownStyles.includes(name), `${name} is grown`);
    assert.ok(adultStyles.hair.includes(name) && validAdultStyle({ hair: name }), `${name} still saves and opens`);
    assert.equal(chooseAdultStyle({ hair: name, hairColor: "#995f47" }, { outfit: "Parka" }).hair, name);
  }
  // Ordinary draws the independent review named: each keeps its hair dye and wears its usual cut
  // or a fitted version. Seed 14113 also exercises the clipped variant of a short beard.
  for (const [seed, hair, hairColor, facialHair] of [[14113, "Wavy", "#a8a199", "Clipped beard"], [14114, "Long", "#9b948c", "None"], [14119, "Crop", "#995f47", "None"], [8808, "Bun", "#995f47", "None"], [14111, "Buzz cut", "#44372f", "Moustache"]]) {
    const style = dressHuman(generatedHuman(seed), seed ^ 0x1e18ae83).humanStyle;
    assert.ok(hairWornFor(hair).includes(style.hair), `seed ${seed} wears ${style.hair}`);
    assert.deepEqual([style.hairColor, style.facialHair], [hairColor, facialHair], `seed ${seed}`);
  }
});

test("a game model wears every earlier style as roots and a cutout of strands, or as one mass of curls, with no sculpted shell", () => {
  for (const hair of earlier) {
    const meshes = wear({ hair }), cards = strands(meshes), roots = meshes.find(mesh => mesh.userData.hairRoots);
    if (massed.includes(hair)) {
      assert.ok(mass(meshes) === roots && !cards, `${hair} is one mass of clumps`);
      assert.ok(roots.material.alphaTest > 0 && roots.material.vertexColors && roots.material.userData.fibreLOD, `${hair} is kept whole by the game exporter`);
      assert.ok(triangles(roots) > 2500 && triangles(roots) <= budget * 0.6, `${hair}: ${triangles(roots)} triangles`);
      assert.deepEqual(meshes.filter(mesh => shells.includes(mesh.name) && !mesh.userData.hairRoots).map(mesh => mesh.name), [], `${hair} wears no shell`);
      for (const x of roots.geometry.attributes.position.array) if (!Number.isFinite(x)) assert.fail(`${hair}: a point of ${roots.name} is not a number`);
      assert.equal(roots.humanWeights.weights.length, roots.geometry.attributes.position.count * 4, hair);
      continue;
    }
    assert.ok(cards && roots, `${hair} has roots and strands`);
    assert.ok(cards.material.map && cards.material.alphaTest > 0 && cards.material.side === T.DoubleSide && cards.material.vertexColors, `${hair} strands are a cutout`);
    assert.equal(cards.material.userData.fibreLOD, true, `${hair} strands are kept whole by the game exporter`);
    // Long loose hair is locks from parting to tip, and may spend what the library groom it replaces spent.
    // Tied cuts spend their separate card budget on the tail or knot.
    const painted = ["Ponytail", "Bun", "Braid"].includes(hair);
    const most = locked.includes(hair) ? 4800 : ["Ponytail", "Bun", "Braid"].includes(hair) ? 3600 : budget * 0.3;
    if (painted) {
      assert.equal(roots.material.map.name, "Brushed scalp");
      const {data, width} = roots.material.map.image;
      assert.equal(data[3], 0, "the chart is clear beyond the hairline");
      assert.equal(data[((width / 2) * width + width / 2) * 4 + 3], 255, "the crown is solid");
      assert.ok(roots.material.alphaTest > 0 && roots.material.userData.hairCards);
    }
    assert.ok(triangles(cards) > (painted ? 500 : 1200) && triangles(cards) <= most, `${hair}: ${triangles(cards)} strand triangles`);
    // The shell a sculpted style would add is one of these names without the strand tag.
    assert.deepEqual(meshes.filter(mesh => shells.includes(mesh.name) && !mesh.userData.strandGroom && !mesh.userData.hairRoots).map(mesh => mesh.name), [], `${hair} wears no shell`);
    for (const mesh of [cards, roots]) {
      for (const x of mesh.geometry.attributes.position.array) if (!Number.isFinite(x)) assert.fail(`${hair}: a point of ${mesh.name} is not a number`);
      assert.equal(mesh.humanWeights.weights.length, mesh.geometry.attributes.position.count * 4, hair);
    }
    for (const x of cards.geometry.attributes.uv.array) if (!(x >= 0 && x <= 1)) assert.fail(`${hair}: a strand reads outside the picture`);
    for (const x of cards.geometry.attributes.color.array) if (!(x >= 0 && x <= 1)) assert.fail(`${hair}: a strand colour is out of range`);
  }
});

test("grown hair covers the scalp and leaves the eyes and the face clear", () => {
  for (const hair of ["Buzz cut", "Crop", "Swept back", "Curls", "Long", "Wavy", "Ponytail", "Bun", "Braid"]) {
    const meshes = wear({ hair }).filter(mesh => mesh.userData.strandGroom || mesh.userData.hairRoots), probe = probeHair(surface, meshes);
    assert.ok(probe.scalp.bare <= 0.01, `${hair}: ${(100 * probe.scalp.bare).toFixed(1)}% of the scalp is bare`);
    assert.equal(worst(probe.eyes), 0, `${hair} hides an eye`);
    assert.ok(worst(probe.face) <= 0.04, `${hair} hides ${Math.round(100 * worst(probe.face))}% of the face`);
  }
});

test("lengths hang from the head, move with the neck and back, and are tucked under a helmet", () => {
  const head = evaluateHuman(human), names = head.names, neckY = head.joints[names.indexOf("neck_01") * 3 + 1], headBone = names.indexOf("head");
  const crop = lowest(strands(wear({ hair: "Crop" })));
  for (const hair of ["Bob", "Long", "Wavy", "Ponytail", "Braid"]) {
    const cards = strands(wear({ hair })), low = lowest(cards);
    assert.ok(low < crop - 0.03, `${hair} hangs ${Math.round(1000 * (crop - low))} mm below a crop`);
    if (hair !== "Bob") assert.ok(low < neckY, `${hair} reaches below the neck joint`);
    // Hair that has left the head is not carried by the head alone.
    const { boneIndices, weights } = cards.humanWeights;
    let carried = 0;
    for (let i = 0; i < weights.length; i++) if (weights[i] > 0.2 && boneIndices[i] !== headBone) carried++;
    assert.ok(carried > 40, `${hair}: ${carried} strand weights follow the neck or back`);
    const helmet = wear({ hair }, { outfit: "Pressure suit" });
    const tucked = strands(helmet);
    if (hair === "Ponytail" || hair === "Braid") {
      assert.equal(tucked, undefined);
      assert.ok(lowest(helmet.find(mesh => mesh.userData.hairRoots)) > low + 0.02);
    } else {
      assert.ok(lowest(tucked) > low + 0.02 && triangles(tucked) < triangles(cards), `${hair} is tucked under a helmet`);
    }
  }
  assert.ok(wear({ hair: "Ponytail" }).some(mesh => mesh.name === "Hair tie"), "a ponytail keeps its tie");
  assert.ok(!wear({ hair: "Ponytail" }, { outfit: "Pressure suit" }).some(mesh => mesh.name === "Hair tie"), "and loses it under a helmet");
});

test("curls and coils stand off the head as a volume of clumps", () => {
  const centre = [0, 0, 0], head = surface.names.indexOf("head");
  for (let k = 0; k < 3; k++) centre[k] = surface.joints[head * 3 + k];
  const reach = mesh => { let far = 0; const p = mesh.geometry.attributes.position.array; for (let i = 0; i < p.length; i += 3) far = Math.max(far, Math.hypot(p[i] - centre[0], p[i + 1] - centre[1], p[i + 2] - centre[2])); return far; };
  const crop = reach(strands(wear({ hair: "Crop" })));
  assert.ok(reach(mass(wear({ hair: "Afro" }))) > crop + 0.02, "an afro is a ball round the head");
  assert.ok(reach(mass(wear({ hair: "Curls" }))) > crop + 0.004, "curls are deeper than a crop");
  // Coils are tubes of their own at full detail, and a mass of clumps where a game model cannot carry tubes.
  for (const hair of coilStyles) {
    const game = wear({ hair }), full = wear({ hair }, { game: 0 });
    assert.ok(mass(game) && !game.some(mesh => mesh.name === hair && !mesh.userData.strandGroom && !mesh.userData.hairRoots), `${hair} is grown in a game model`);
    assert.ok(!strands(full) && full.some(mesh => mesh.name === hair), `${hair} keeps its tubes at full detail`);
    assert.deepEqual(strandGroom(surface, { hair }, material, false, "#b58a6c"), [], `${hair} is not a strand groom at full detail`);
  }
});

test("the strand picture has pointed locks and a tile of unbroken hair", () => {
  const { data, width } = tuftPixels(), alpha = (x, y) => data[(y * width + x) * 4 + 3];
  const [left, top, wide, tall] = tuftTiles.solid;
  for (let y = top + 1; y < top + tall - 1; y++) for (let x = left + 1; x < left + wide - 1; x++) if (alpha(x, y) !== 255) assert.fail(`the solid tile has a gap at ${x}, ${y}`);
  assert.equal(tuftTiles.short.length, 7, "the solid tile takes the place of one short tuft");
  for (const [l, t, w, h] of [...tuftTiles.long, ...tuftTiles.short]) {
    // Near its root a tuft is nearly solid; near its tip it is a few points with clear picture between them.
    const cover = y => { let n = 0; for (let x = l; x < l + w; x++) if (alpha(x, y) > 128) n++; return n / w; };
    assert.ok(cover(t + Math.round(h * 0.85)) > 0.6, "a tuft is full near its root");
    assert.ok(cover(t + Math.round(h * 0.12)) < 0.45, "a tuft thins to points at its tip");
  }
});

test("long loose hair is locks from a parting to the tips, in place of the library groom of the same name", () => {
  const head = surface.names.indexOf("head"), neckY = surface.joints[surface.names.indexOf("neck_01") * 3 + 1], headY = surface.joints[head * 3 + 1];
  for (const hair of locked) {
    assert.ok(grownStyles.includes(hair) && adultStyles.hair.includes(hair) && validAdultStyle({ hair }), `${hair} is grown and still saves and opens`);
    const meshes = wear({ hair }), cards = strands(meshes), roots = meshes.find(mesh => mesh.userData.hairRoots);
    assert.ok(cards && roots, `${hair} has roots and locks`);
    // Nothing else is hair: the library groom of the same name is not worn under the locks.
    assert.deepEqual(meshes.filter(mesh => mesh.name === hair && !mesh.userData.strandGroom).map(mesh => mesh.name), [], `${hair} is worn once`);
    assert.ok(triangles(cards) <= 4800, `${hair}: ${triangles(cards)} lock triangles`);
    const probe = probeHair(surface, [cards, roots]);
    assert.ok(probe.scalp.bare <= 0.01, `${hair}: ${(100 * probe.scalp.bare).toFixed(1)}% of the scalp is bare`);
    assert.equal(worst(probe.eyes), 0, `${hair} hides an eye`);
    assert.ok(worst(probe.face) <= 0.06, `${hair} hides ${Math.round(100 * worst(probe.face))}% of the face`);
    assert.ok(lowest(cards) < neckY, `${hair} reaches below the neck joint`);
    // The parting: locks start on both sides of the top of the head, and none crosses the face below the brow.
    const p = cards.geometry.attributes.position.array;
    let left = 0, right = 0;
    for (let i = 0; i < p.length; i += 3) if (p[i + 1] > headY + 0.13) p[i] > 0 ? left++ : right++;
    assert.ok(left > 20 && right > 20, `${hair} grows from both sides of its parting (${left}, ${right})`);
    const tucked = strands(wear({ hair }, { outfit: "Pressure suit" }));
    assert.ok(lowest(tucked) > lowest(cards) + 0.02 && triangles(tucked) < triangles(cards), `${hair} is tucked under a helmet`);
    for (const x of p) if (!Number.isFinite(x)) assert.fail(`${hair}: a lock point is not a number`);
    for (const x of cards.geometry.attributes.uv.array) if (!(x >= 0 && x <= 1)) assert.fail(`${hair}: a lock reads outside the picture`);
  }
  // A swept fringe moves the parting to one side.
  const middle = cardsOf => { const p = cardsOf.geometry.attributes.position.array; let top = -Infinity, x = 0; for (let i = 0; i < p.length; i += 3) if (p[i + 1] > top) { top = p[i + 1]; x = p[i]; } return x; };
  assert.notEqual(Math.sign(middle(strands(wear({ hair: "Wavy", fringe: "Swept left" })))), Math.sign(middle(strands(wear({ hair: "Wavy", fringe: "Swept right" })))));
  // The long cuts an ordinary draw wears stay the combed grooms of the library, which read as softer hair.
  for (const hair of ["Long centre part", "Loose waves"]) {
    assert.ok(!grownStyles.includes(hair), `${hair} is not grown`);
    assert.ok(!strands(wear({ hair })), `${hair} is worn from the library`);
  }
});

test("tied hair combines a fitted, painted scalp with a separate tail, knot or crown", () => {
  const centre = [0, 0, 0], head = surface.names.indexOf("head"), neckY = surface.joints[surface.names.indexOf("neck_01") * 3 + 1];
  for (let d = 0; d < 3; d++) centre[d] = surface.joints[head * 3 + d];
  for (const hair of ["Low ponytail", "Crown braid", "Ponytail", "Braid", "Bun"]) {
    assert.ok(grownStyles.includes(hair) && adultStyles.hair.includes(hair) && validAdultStyle({ hair }), `${hair} is grown and still saves and opens`);
    const meshes = wear({ hair }), cards = strands(meshes), roots = meshes.find(mesh => mesh.userData.hairRoots);
    assert.ok(cards && roots, `${hair} has roots and locks`);
    assert.deepEqual(meshes.filter(mesh => mesh.name === hair && !mesh.userData.strandGroom).map(mesh => mesh.name), [], `${hair} is worn once`);
    assert.ok(triangles(cards) <= 3600, `${hair}: ${triangles(cards)} lock triangles`);
    const probe = probeHair(surface, [cards, roots]);
    assert.ok(probe.scalp.bare <= 0.01, `${hair}: ${(100 * probe.scalp.bare).toFixed(1)}% of the scalp is bare`);
    assert.equal(worst(probe.eyes), 0, `${hair} hides an eye`);
    assert.ok(worst(probe.face) <= 0.04, `${hair} hides ${Math.round(100 * worst(probe.face))}% of the face`);
    const p = cards.geometry.attributes.position.array;
    for (const x of p) if (!Number.isFinite(x)) assert.fail(`${hair}: a lock point is not a number`);
    for (const x of cards.geometry.attributes.uv.array) if (!(x >= 0 && x <= 1)) assert.fail(`${hair}: a lock reads outside the picture`);
    // Beside the ears no lock steps out from the head to the rim of an ear.
    let widest = 0;
    for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i + 2] - centre[2]) < 0.03 && p[i + 1] > centre[1] - 0.02) widest = Math.max(widest, Math.abs(p[i]));
    assert.ok(widest < 0.105, `${hair} stands ${Math.round(1000 * widest)} mm out at the side of the head`);
  }
  // A low ponytail has a tail down the back, and none under a helmet. A crown braid stays on the head.
  const tail = strands(wear({ hair: "Low ponytail" })), braid = strands(wear({ hair: "Crown braid" }));
  assert.ok(lowest(tail) < neckY - 0.05, "the tail hangs below the neck");
  assert.ok(lowest(strands(wear({ hair: "Low ponytail" }, { outfit: "Pressure suit" }))) > lowest(tail) + 0.05, "and is tucked away under a helmet");
  assert.ok(lowest(braid) > neckY, "a crown braid stays on the head");
  // The plait stands on the drawn-back hair over the forehead and over the ears.
  const b = braid.geometry.attributes.position.array, swept = wear({ hair: "Low ponytail" }).find(mesh => mesh.userData.hairRoots).geometry.attributes.position.array;
  const reach = (array, test) => { let far = 0; for (let i = 0; i < array.length; i += 3) if (test(array[i], array[i + 1] - centre[1], array[i + 2] - centre[2])) far = Math.max(far, Math.hypot(array[i] - centre[0], array[i + 1] - centre[1], array[i + 2] - centre[2])); return far; };
  for (const [where, test] of [["front", (x, y, z) => z > 0.03 && y > 0.05], ["side", (x, y, z) => x > 0.04 && y > 0.04]])
    assert.ok(reach(b, test) > reach(swept, test) + 0.004, `the plait stands on the hair at the ${where}`);
});
