import assert from "node:assert/strict";
import test from "node:test";
import { enclosedSkin, exposedSkinPixels } from "./coverage-review.js";

test("skin islands distinguish a hole contained by cloth from exposed arms and openings", () => {
  const mask = new Uint8Array(100).fill(3), labels = [{},{},{name:"Glove"}];
  for (const i of [44,45,54,55,10,11,20,21]) mask[i]=2;
  assert.deepEqual(enclosedSkin(mask,10,labels), [{pixels:4,borderingPieces:["Glove"]}]);
  mask[66]=2; mask[77]=0;
  assert.deepEqual(enclosedSkin(mask,10,labels), []);
});

test("detail checks count new skin inside clothes and exclude cuffs and the silhouette", () => {
  const full = new Uint8Array(49);
  for (let y = 1; y < 6; y++) for (let x = 1; x < 6; x++) full[y*7+x] = 3;
  const game = full.slice();
  game[3*7+3] = 2;
  game[3*7+1] = 2;
  game[4*7+4] = 1;
  assert.deepEqual(exposedSkinPixels(full, game, 7), { interiorClothingPixels: 9, exposedSkinPixels: 1 });
  const fullLabels = ["Other","Skin","Coat","Shirt"].map(name=>({name}));
  const gameLabels = ["Other","Skin","Shirt","Coat"].map(name=>({name}));
  const reordered = Uint8Array.from(full, x => x === 3 ? 4 : x);
  reordered[3*7+3] = 3;
  assert.deepEqual(exposedSkinPixels(full, reordered, 7, fullLabels, gameLabels).layers,
    [{ fullPiece: "Coat", gamePiece: "Shirt", pixels: 1 }]);
  assert.equal(exposedSkinPixels(full, full, 7).exposedSkinPixels, 0);
  assert.throws(() => exposedSkinPixels(full, game, 8));
});
