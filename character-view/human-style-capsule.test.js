import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { drawHumanIdentity } from "./human-form.js";
import { evaluateHuman } from "./human-surface.js";
import { styleHuman } from "./human-style.js";
import { capsule } from "./human-style-capsule.js";
import { completeLook, lookDirections } from "./human-looks.js";
import { adultStyles, dressHuman, validAdultStyle } from "./human-wardrobe.js";

const material = () => new T.MeshStandardMaterial(), names = Object.keys(capsule);
const bodies = { resting: {}, slight: { height: 1.6, frame: -0.9, weight: -0.8 }, heavy: { height: 1.9, frame: 0.9, weight: 0.9 } };

test("every capsule outfit can be chosen by hand and builds whole on slight and heavy bodies", () => {
  for (const [label, human] of Object.entries(bodies)) {
    const surface = evaluateHuman(human);
    for (const name of names) {
      assert.ok(adultStyles.outfit.includes(name) && validAdultStyle({ outfit: name }), name + " saves and opens");
      const meshes = styleHuman(surface, { outfit: name }, material, true);
      assert.ok(meshes.length >= 8, `${label}, ${name}: ${meshes.length} parts`);
      assert.ok(meshes.hidden.size > 300, `${label}, ${name} hides the skin under it`);
      for (const mesh of meshes) {
        const { boneIndices, weights } = mesh.humanWeights;
        assert.equal(boneIndices.length, mesh.geometry.attributes.position.count * 4, mesh.name + " is skinned");
        for (const x of mesh.geometry.attributes.position.array) if (!Number.isFinite(x)) assert.fail(`${label}, ${name}: a point of ${mesh.name} is not a number`);
        for (const x of weights) if (!Number.isFinite(x)) assert.fail(`${label}, ${name}: a weight of ${mesh.name} is not a number`);
      }
    }
  }
});

test("the two cuts of a family differ in their pieces, and the mantle's tails stand apart behind", () => {
  const surface = evaluateHuman({}), piece = (outfit, name) => styleHuman(surface, { outfit }, material, true).find(mesh => mesh.name === name);
  assert.ok(piece("Split mantle", "Split mantle") && piece("Hooded shoulder cloak", "Shoulder cloak") && !piece("Hooded shoulder cloak", "Split mantle"));
  assert.ok(piece("Bodice and gored skirt", "Shoulder wing") && !piece("Draped bodice gown", "Shoulder wing"));
  const box = name => new T.Box3().setFromBufferAttribute(piece(...name).geometry.attributes.position);
  const mantle = box(["Split mantle", "Split mantle"]), cloak = box(["Hooded shoulder cloak", "Shoulder cloak"]);
  assert.ok(mantle.min.y < cloak.min.y - 0.2, "the split mantle falls well below the shoulder cloak");
  assert.ok(box(["Draped bodice gown", "Draped skirt"]).min.y < box(["Bodice and gored skirt", "Gored skirt"]).min.y - 0.1, "the draped gown is the longer skirt");
  // No cloth of the mantle crosses the middle of the back near its hem.
  const p = piece("Split mantle", "Split mantle").geometry.attributes.position;
  let near = 0;
  for (let i = 0; i < p.count; i++) if (p.getY(i) < mantle.min.y + 0.08 && p.getZ(i) < 0 && Math.abs(p.getX(i)) < 0.012) near++;
  assert.equal(near, 0);
});

test("ordinary undirected draws wear the capsule in a real share, in every cut, and other looks keep their wardrobe", () => {
  const worn = new Map();
  for (let seed = 30000; seed < 31200; seed++) {
    const base = drawHumanIdentity(seed, undefined, { fitRestingLips: false });
    const style = dressHuman(base, (seed ^ 0x1e18ae83) >>> 0).humanStyle;
    assert.ok(validAdultStyle(style), `seed ${seed} saves and opens`);
    if (names.includes(style.outfit)) {
      worn.set(style.outfit, (worn.get(style.outfit) ?? 0) + 1);
      // The large pieces of a capsule look are told apart in tone.
      assert.notEqual(style.clothColor, style.accentColor, `seed ${seed}`);
    }
  }
  const total = [...worn.values()].reduce((sum, n) => sum + n, 0);
  assert.ok(total > 0.09 * 1200 && total < 0.2 * 1200, `${total} of 1200 draws wear the capsule`);
  for (const name of names) assert.ok((worn.get(name) ?? 0) >= 6, `${name}: ${worn.get(name) ?? 0}`);
  // A direction keeps the cuts that suit it.
  const drawn = direction => new Set(Array.from({ length: 900 }, (_, seed) => completeLook({}, seed, direction).wardrobe));
  assert.ok(lookDirections.includes("Adventure") && drawn("Adventure").has("Split mantle") && !drawn("Adventure").has("Bomber and wide trousers"));
  assert.ok(drawn("Festive").has("Draped bodice gown") && !drawn("Festive").has("Split mantle"));
  assert.ok(!drawn("Workwear").has("Bomber and wide trousers") && drawn("Everyday").has("Bomber and wide trousers"));
});
