import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { humanForm, changeHuman, generatedHuman, tintHumanSkin } from "./human-form.js";
import { humanRegions } from "./human-mesh.js";
import { adultStyleProblems, chooseAdultStyle } from "./human-wardrobe.js";
import { castStyles, castSources, drawCastIdentity, wornCast } from "./human-cast-looks.js";

const material = color => new T.MeshStandardMaterial({color});
function source(form, cast) {
  return {...form, outfit:"Work clothes", humanStyle:{...form.humanStyle, cast}};
}
function meshes(form) {
  return humanRegions(form, material, false)(form.parts.find(p => p.humanBone === "head")).children;
}

test("cast artwork is stored on a complete dressed adult and releases its individual parts in anatomy view", () => {
  const f = humanForm();
  for (const label of castStyles) assert.deepEqual(adultStyleProblems({cast:label}), []);
  assert.equal(wornCast(f), null);
  const dressed = source(f, "Gardener");
  assert.equal(wornCast(JSON.parse(JSON.stringify(dressed))), "Gardener");
  assert.equal(wornCast({...dressed,outfit:"Anatomy"}), null);
  assert.equal(wornCast({...dressed,parts:dressed.parts.slice(1)}), null);
});

test("the authored face, clothing and gaze follow editable proportions with normalized weights", () => {
  const f = source(humanForm(), "Gardener");
  const [face, body] = meshes(f);
  const [edited] = meshes(changeHuman(f, {height:1.9,belly:.65}));
  assert.equal(face.material,body.material);
  assert.ok(face.geometry.attributes.position.array.some((x,i) => Math.abs(x-edited.geometry.attributes.position.array[i])>.02));
  for(const name of ["Smile","BrowLift","Blink","LookLeft","LookRight","LookDown","LookUp"])
    assert.ok(name in face.morphTargetDictionary,name);
  for(const x of edited.geometry.attributes.position.array) assert.ok(Number.isFinite(x));
  for(let i=0;i<body.humanWeights.weights.length;i+=4) {
    const w=body.humanWeights.weights;
    assert.ok(Math.abs(w[i]+w[i+1]+w[i+2]+w[i+3]-1)<1e-5);
  }
  const skirt = meshes(source(humanForm(), "Long tunic")).find(m=>m.humanWeights.clothJoints);
  assert.equal(skirt.humanWeights.clothJoints.joints.length,16);
});

test("the Denim jacket hair exports one side of each authored card and keeps the eyelash morphs", () => {
  const parts = meshes(source(humanForm(), "Denim jacket"));
  const hair = parts.find(part => part.name === "Cast hair and lashes");
  assert.equal(hair.geometry.index.count / 3, 372);
  assert.ok("Blink" in hair.morphTargetDictionary);
});

test("older adults keep native ageing where the cast has no age-matched source", () => {
  for (let seed = 0; seed < 120; seed++)
    assert.equal(drawCastIdentity({frame:-.7,age:.87}, seed), null);
});

test("cast garments retain their source and the eye control changes only the photographed iris", () => {
  const f = source(humanForm(), "Gardener");
  f.humanStyle = chooseAdultStyle(f.humanStyle, {castTop:"Denim jacket", castBottom:"Shorts and shoes", castPigment:.7, castShape:.6});
  assert.deepEqual(adultStyleProblems(f.humanStyle), []);
  assert.equal(new Set(castSources(f)).size, 3);
  const colourMap = name => meshes({...f,eyeColor:name})[0].material.map.image;
  const blue = colourMap("blue"), brown = colourMap("brown");
  let changed = 0;
  for (let i = 0; i < blue.data.length; i += 4) {
    if (blue.data[i+2] === brown.data[i+2]) continue;
    const x = (i / 4 % blue.width) / blue.width, y = Math.floor(i / 4 / blue.width) / blue.height;
    assert.ok(x > .62 && x < .65 && y > .45 && y < .48);
    assert.ok(blue.data[i+2] >= brown.data[i+2]);
    changed++;
  }
  assert.ok(changed > 40);
  const switched = chooseAdultStyle(f.humanStyle, {cast:"Grey tee"});
  assert.equal(switched.castTop, undefined);
  assert.deepEqual(adultStyleProblems(switched), []);
});

test("cast face, clothing and hair mark their per-figure colour maps for disposal", () => {
  const parts = meshes(source(humanForm(), "Gardener"));
  const materials = new Set(parts.map(part => part.material));
  assert.equal(materials.size, 2);
  for (const material of materials) {
    assert.ok(material.map.isTexture);
    assert.equal(material.userData.ownedColorMap, true);
  }
});

test("a fitted top carries its own surface maps and keeps the wearer's head maps", () => {
  const gardener = source(humanForm(), "Gardener");
  const native = meshes(gardener)[0].material;
  const polo = meshes(source(humanForm(), "Striped polo"))[0].material;
  const borrowed = meshes({...gardener, humanStyle: {
    ...gardener.humanStyle, castTop: "Striped polo", castBottom: "Work trousers and boots"
  }})[0].material;
  for (const slot of ["normalMap", "roughnessMap"]) {
    const atlas = borrowed[slot].image;
    assert.equal(borrowed[slot].colorSpace, T.NoColorSpace);
    const half = atlas.width / 2;
    function row(image, y, x) {
      const offset = 4 * (y * atlas.width + x);
      return image.data.subarray(offset, offset + 4 * half);
    }
    for (let y = 0; y < atlas.height; y += 7) {
      assert.deepEqual(row(atlas, y, 0), row(polo[slot].image, y, 0));
      if (y < half) assert.deepEqual(row(atlas, y, half), row(native[slot].image, y, half));
    }
    assert.ok(row(atlas, half + 15, half).some(x => x < 100 || (x > 135 && x < 240)));
  }
  assert.equal(borrowed.roughness, 1);
  assert.equal(borrowed.metalness, 0);
});


test("cast outfits reserve hair space only when the worn artwork leaves the quarter empty", () => {
  const gardener = source(humanForm(), "Gardener");
  const stock = meshes(gardener);
  assert.equal(stock[0].material.userData.castBodySheet, true);
  assert.equal(stock.find(part => part.name === "Cast hair and lashes").material.userData.castHairSheet, true);
  const mixed = meshes({...gardener, humanStyle: {
    ...gardener.humanStyle, castTop: "Denim jacket", castBottom: "Shorts and shoes"
  }});
  assert.equal(mixed[0].material.userData.castBodySheet, false);
});

test("selecting artwork and tinting a drawn person preserve usable skin swatches", () => {
  const initial = chooseAdultStyle({}, {cast: "Gardener"});
  assert.equal(initial.castSkin, "#c59176");
  assert.deepEqual(adultStyleProblems(initial), []);
  assert.equal(chooseAdultStyle(initial, {cast: "None"}).castSkin, undefined);
  const options = Array.from({length: 16}, (_, i) => generatedHuman(1531400 + i));
  const drawn = options.find(form => form.humanStyle.castSkin);
  assert.ok(drawn);
  assert.match(drawn.humanStyle.castSkin, /^#[0-9a-f]{6}$/i);
  assert.equal(tintHumanSkin(drawn, "#93563c").humanStyle.castSkin, "#93563c");
});
