import assert from "node:assert/strict";
import test from "node:test";
import * as T from "three";
import { evaluateHuman } from "./human-surface.js";
import { analyse } from "./human-style-kit.js";
import { landmarks } from "./human-style-cloth.js";
import { tailorHuman, tailorLayer, tailorParts, tailorPieces, validTailor } from "./human-tailor.js";
import { mailCell } from "./human-mail.js";
import { armourInstructions, armourLooks, armourPieces, armourSet, armourTailor, validArmour } from "./human-armour.js";
import { adultStyleProblems, chooseAdultStyle, dressedHuman, validAdultStyle } from "./human-wardrobe.js";
import { bodies } from "../scripts/human-style-bodies.mjs";

const material = (color, kind) => Object.assign(new T.MeshStandardMaterial({ color }), { userData: { kind } });
const lean = evaluateHuman(bodies.lean), broad = evaluateHuman(bodies.m1);

test("armour pieces are tailor pieces with complete, valid starting values", () => {
  for (const piece of Object.keys(armourPieces)) {
    assert.equal(tailorPieces[piece], armourPieces[piece]);
    assert.ok(validTailor({ layers: [tailorLayer(piece)] }), piece);
  }
  assert.ok(!validTailor({ layers: [{ piece: "cuirass", build: "chainmail" }] }));
  assert.ok(!validTailor({ layers: [{ piece: "pauldrons", lames: 9 }] }));
});

test("armour authors see the accepted ranges and all incorrect overrides in one repair", () => {
  const pieces = { cuirass: { room: 5 }, armguards: { length: 0.5 } };
  const errors = adultStyleProblems({ armour: { look: "Light fantasy", pieces } }).join(" ");
  assert.match(errors, /cuirass\.room must be between 6 and 40/);
  assert.match(errors, /armguards\.length is unavailable/);
  assert.deepEqual(armourInstructions.numericLimits.cuirass.room, [6,40]);
  assert.ok(validAdultStyle(armourInstructions.example.set.humanStyle));
});

test("a seeded set is repeatable, valid in every look and changes with the seed", () => {
  for (const look of armourLooks) {
    const seen = new Set();
    for (let seed = 0; seed < 24; seed++) {
      const set = armourSet(seed, look);
      assert.ok(validTailor(set), look + " " + seed);
      assert.deepEqual(armourSet(seed, look), set);
      assert.ok(set.layers.some(layer => layer.piece === "cuirass") && set.layers.some(layer => layer.piece === "top"), "plates are worn over an undergarment");
      seen.add(JSON.stringify(set));
    }
    assert.ok(seen.size > 12, look + " gives " + seen.size + " different sets from 24 seeds");
  }
  assert.ok(validTailor(armourSet(987654, "Heavy sci-fi")), "a large seed stays within each piece's own range");
  const sides = new Set(Array.from({ length: 40 }, (_, seed) => armourSet(seed, "Light fantasy").layers.find(layer => layer.piece === "pauldrons").balance));
  assert.ok(sides.size >= 3, "seeds reach matched and lopsided shoulders: " + [...sides]);
});

test("a look saved by name and seed is checked, expanded and put away with a preset outfit", () => {
  const armour = { look: "Heavy fantasy", seed: 12, pieces: { pauldrons: { balance: "left only" }, tassets: null } };
  assert.ok(validArmour(armour) && validAdultStyle({ hair: "Crop", armour }));
  const layers = armourTailor(armour).layers;
  assert.equal(layers.find(layer => layer.piece === "pauldrons").balance, "left only");
  assert.ok(!layers.some(layer => layer.piece === "tassets"));
  const added = armourTailor({ look: "Light sci-fi", seed: 5, pieces: { tassets: { lames: 2 } } }).layers.map(layer => layer.piece);
  assert.ok(added.indexOf("tassets") > added.indexOf("cuirass") && added.indexOf("tassets") < added.indexOf("pauldrons"));
  for (const bad of [{ look: "Chainmail" }, { seed: -1 }, { seed: 1.5 }, { pieces: { cuirass: { build: "nope" } } }, { pieces: { cape: {} } }, { pieces: { cuirass: { piece: "top" } } }, { colour: "#fff" }])
    assert.ok(!validAdultStyle({ armour: bad }), JSON.stringify(bad));
  assert.deepEqual(chooseAdultStyle({ hair: "Crop", armour }, { outfit: "Explorer" }), { hair: "Crop", outfit: "Explorer" });
  assert.deepEqual(chooseAdultStyle({ hair: "Crop", armour }, { hair: "Bob" }), { hair: "Bob", armour });
  for (const [piece, choices] of Object.entries(armourInstructions.pieces)) for (const [key, options] of Object.entries(choices)) assert.deepEqual(armourPieces[piece].fields[key].options, options);
});

test("every look builds sound, skinned, rigid plates on a lean and a broad adult", () => {
  for (const [name, surface] of [["lean", lean], ["broad", broad]]) for (const look of armourLooks) {
    const meshes = tailorHuman(surface, armourSet(3, look), material), names = meshes.map(mesh => mesh.name);
    for (const expected of [/^Cuirass$/, /^Pauldron$/, /^(Vambrace|Arm guard)$/]) assert.ok(names.some(n => expected.test(n)), `${look} on ${name} has ${expected}: ${names}`);
    for (const mesh of meshes) {
      const { position } = mesh.geometry.attributes, index = mesh.geometry.index.array, { weights, boneIndices } = mesh.humanWeights;
      assert.ok(position.count > 0 && index.length % 3 === 0, mesh.name);
      for (const value of position.array) assert.ok(Number.isFinite(value), `${look} ${name} ${mesh.name} has a finite surface`);
      for (const i of index) assert.ok(i < position.count);
      for (let i = 0; i < position.count; i++) {
        let sum = 0;
        for (let j = 0; j < 4; j++) { sum += weights[i * 4 + j]; assert.ok(boneIndices[i * 4 + j] < surface.names.length); }
        assert.ok(Math.abs(sum - 1) < 1e-3, `${mesh.name} weights sum to one`);
      }
    }
  }
});

test("plates keep their shape: each cuirass plate and shoulder plate moves as one piece", () => {
  const body = analyse(lean), parts = tailorParts(body, landmarks(body), armourSet(3, "Heavy fantasy"));
  for (const name of ["Cuirass", "Pauldron"]) {
    const { piece } = parts.find(part => part.name.startsWith(name)), seen = new Set();
    // Connected plates share one set of weights, so no plate can stretch or crease when the figure moves.
    const parent = Array.from({ length: piece.count }, (_, i) => i), find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
    for (let t = 0; t < piece.tri.length; t += 3) for (let e = 1; e < 3; e++) parent[find(piece.tri[t])] = find(piece.tri[t + e]);
    const skins = new Map();
    for (let i = 0; i < piece.count; i++) {
      const key = Array.from({ length: 4 }, (_, j) => piece.bones[i * 4 + j] + ":" + piece.weights[i * 4 + j].toFixed(4)).filter(pair => !pair.endsWith(":0.0000")).sort().join(" "), root = find(i);
      if (!skins.has(root)) skins.set(root, key);
      assert.equal(key, skins.get(root), name + " plate has one skin");
      seen.add(root);
    }
    assert.ok(seen.size >= 3, `${name} is made of ${seen.size} separate plates`);
  }
});

test("ordinary outfits are not changed by the armour pieces", () => {
  const form = { outfit: "Work clothes", humanStyle: { outfit: "Field jacket and denim", hair: "Crop" }, appearance: { skin: "#b58a6c" }, human: bodies.lean };
  const plain = dressedHuman(lean, form, material, true), names = plain.map(mesh => mesh.name);
  assert.ok(!names.some(name => /Cuirass|Pauldron|Vambrace|Greave|Tasset/.test(name)), String(names));
  const worn = dressedHuman(lean, { ...form, humanStyle: { hair: "Crop", armour: { look: "Light fantasy", seed: 2 } } }, material, true);
  assert.ok(worn.some(mesh => mesh.name === "Cuirass") && worn.hidden.size > 0, "the saved look dresses the figure and leaves out skin under the plates");
  const anatomy = dressedHuman(lean, { ...form, outfit: "Anatomy", humanStyle: { hair: "Crop", armour: { look: "Light fantasy", seed: 2 } } }, material, true);
  assert.ok(!anatomy.some(mesh => mesh.name === "Cuirass"), "the base shape still shows without armour");
});

test("the game file gets the same plates from far fewer faces, and leaves the clothes as they are", () => {
  const armour = /Cuirass|Gorget|Collar|Back unit|Tasset|Arm guard|Vambrace|Leg guard|Greave|Pauldron/;
  for (const look of armourLooks) {
    const count = game => {
      const by = { armour: 0, clothes: 0, plates: new Set() };
      for (const mesh of tailorHuman(broad, armourSet(3, look), material, null, { game })) {
        by[armour.test(mesh.name) ? "armour" : "clothes"] += mesh.geometry.index.count / 3;
        if (/^(Cuirass|Pauldron|Tassets|Arm guard|Vambrace|Leg guard|Greave)$/.test(mesh.name)) by.plates.add(mesh.name);
        for (const value of mesh.geometry.attributes.position.array) assert.ok(Number.isFinite(value));
      }
      return by;
    };
    const full = count(false), game = count(true);
    assert.deepEqual([...game.plates].sort(), [...full.plates].sort(), look + " keeps every plate");
    assert.equal(game.clothes, full.clothes, look + " clothes are built as before");
    assert.ok(game.armour < full.armour * 0.4, `${look}: ${game.armour} of ${full.armour} triangles`);
  }
});

test("open greaves keep two calf fastenings per leg in game detail", () => {
  const bands = (cover, cut) => tailorHuman(lean, { layers: [
    tailorLayer("boots"), tailorLayer("legguards", { cover, cut }),
  ] }, material, null, { game: true }).filter(mesh => mesh.name === "Greave straps");
  for (const cut of ["rounded", "angular"]) {
    const fastenings = bands("shin", cut);
    assert.equal(fastenings.length, 2);
    for (const mesh of fastenings) {
      const y = mesh.geometry.attributes.position;
      const heights = Array.from({ length: y.count }, (_, i) => y.getY(i)).sort((a, b) => a - b);
      assert.equal(heights.filter((v, i) => i && v - heights[i - 1] > 0.04).length, 1, "upper and lower band");
      assert.equal(mesh.userData.styleType, "leather");
    }
  }
  assert.equal(bands("whole leg", "rounded").length, 0, "a closed greave already wraps the calf");
});

test("a cuirass keeps its inlay chart, normals and skin on both sides of the game mesh", () => {
  const recipe = { layers: [tailorLayer("cuirass", { device: "Reed heron" })] };
  for (const game of [false, true]) {
    const plate = tailorHuman(lean, recipe, material, null, { game }).find(mesh => mesh.name === "Cuirass");
    const { position, normal, uv } = plate.geometry.attributes;
    assert.equal(uv.count, position.count);
    assert.equal(normal.count, position.count);
    assert.equal(plate.humanWeights.boneIndices.length, position.count*4);
    const idx = plate.geometry.index.array;
    for (let i=0; i<idx.length; i+=3) {
      const u = [idx[i],idx[i+1],idx[i+2]].map(v => uv.getX(v));
      assert.ok(u.every(x => x < .5) || u.every(x => x > .5), "a face crosses the rear seam");
    }
  }
});

test("a mail standard hangs from a band at the base of the neck in cells of real rings", () => {
  const layers = [tailorLayer("cuirass", { collar: "mail standard" })];
  for (const skin of [lean, broad]) {
    const pieces = tailorHuman(skin, { layers }, material, null, { game: true });
    const mesh = pieces.find(piece => piece.name === "Mail standard"), band = pieces.find(piece => piece.name === "Mail standard band");
    assert.ok(pieces.some(piece => piece.name === "Mail standard buckle"));
    const { position, uv, lodAnchor } = mesh.geometry.attributes, index = mesh.geometry.index.array;
    assert.equal(uv.count, position.count);
    assert.ok(uv.array.every(value => value >= 0 && value <= 1));
    assert.ok(lodAnchor.array.every(value => value === 1), "a game model keeps every cell line");
    const m = landmarks(analyse(skin)), at = i => [position.getX(i), position.getY(i), position.getZ(i)];
    // Every face shows the whole cell picture, or the upper half of it along the brass hem, and the cell is near its real size, so the rings are.
    const wide = [], tall = [];
    for (let i = 0; i < index.length; i += 3) for (let e = 0; e < 3; e++) {
      const a = index[i + e], b = index[i + (e + 1) % 3], long = Math.hypot(...at(a).map((x, d) => x - at(b)[d])) / m.k;
      const du = Math.abs(uv.getX(a) - uv.getX(b)), dv = Math.abs(uv.getY(a) - uv.getY(b));
      if (dv < .01) { assert.ok(du > .45 && du < .5); wide.push(long); }
      else if (du < .01) { assert.ok(dv > .45); if (dv > .95) tall.push(long); }
    }
    const middle = list => list.sort((a, b) => a - b)[list.length >> 1];
    assert.ok(Math.abs(middle(wide) - mailCell[0]) < .2*mailCell[0], "rings keep their size round the mantle");
    assert.ok(Math.abs(middle(tall) - mailCell[1]) < .3*mailCell[1], "courses keep their size down the mantle");
    const radii = [], heights = [];
    for (let i = 0; i < band.geometry.attributes.position.count; i++) {
      radii.push(Math.hypot(band.geometry.attributes.position.getX(i), band.geometry.attributes.position.getZ(i) - m.neck[2]));
      heights.push(band.geometry.attributes.position.getY(i));
    }
    assert.ok(Math.max(...radii) < .15*m.k, "the band fits the base of the neck");
    assert.ok(Math.max(...heights) > m.neck[1] && Math.max(...heights) < m.neck[1] + .05*m.k, "the band sits at the neck joint, clear of the jaw");
    mesh.geometry.computeBoundingBox();
    const height = mesh.geometry.boundingBox.max.y - mesh.geometry.boundingBox.min.y;
    assert.ok(height > .06*m.k && height < .22*m.k, "the mantle covers the collarbones and the top of the breast");
  }
});
