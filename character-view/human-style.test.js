import test from "node:test";
import assert from "node:assert/strict";
import { Piece } from "./human-style-kit.js";
import { evaluateHuman } from "./human-surface.js";
import { defaultHumanStyle, humanStyles, styleHuman } from "./human-style.js";

const slim = evaluateHuman({ height: 1.66, frame: -0.9 });
const heavy = evaluateHuman({ height: 1.7, frame: 0.3, weight: 1, muscle: -0.6, belly: -0.8, hips: 0.8 });

function checkMeshes(surface, meshes, label) {
  for (const mesh of meshes) {
    const position = mesh.geometry.attributes.position, count = position.count, name = `${label}: ${mesh.name}`;
    assert.ok(count > 0 && mesh.geometry.index.count > 0, `${name} has geometry`);
    assert.equal(mesh.humanWeights.weights.length, count * 4, `${name} has four weights per vertex`);
    assert.equal(mesh.humanWeights.boneIndices.length, count * 4, `${name} has four bones per vertex`);
    assert.ok(surface.names.includes(mesh.userData.styleRegion), `${name} follows a real joint`);
    let finite = true, summed = true, bones = true, indexed = true;
    for (const x of position.array) finite &&= Number.isFinite(x);
    for (let v = 0; v < count; v++) {
      let total = 0;
      for (let n = 0; n < 4; n++) { total += mesh.humanWeights.weights[v * 4 + n]; bones &&= mesh.humanWeights.boneIndices[v * 4 + n] < surface.names.length; }
      summed &&= Math.abs(total - 1) < 1e-3;
    }
    for (const index of mesh.geometry.index.array) indexed &&= index < count;
    assert.ok(finite, `${name} has finite positions`);
    assert.ok(bones, `${name} names real bones`);
    assert.ok(summed, `${name} has weights that sum to one`);
    assert.ok(indexed, `${name} indexes its own vertices`);
  }
}

test("the default style adds nothing and unknown names are ignored", () => {
  assert.equal(humanStyles.hair[0], "None");
  assert.equal(humanStyles.outfit[0], "None");
  assert.equal(styleHuman(slim, defaultHumanStyle).length, 0);
  assert.equal(styleHuman(slim, { hair: "no such hair", outfit: "no such outfit" }).length, 0);
  assert.ok(styleHuman(slim, { hair: "bob" }).length > 0, "names match without regard to case");
});

test("every hairstyle builds skinned meshes on the head", () => {
  // Every style on one figure, and a few on a very different one.
  for (const [surface, names] of [[slim, humanStyles.hair.slice(1)], [heavy, ["Crop", "Afro", "Long"]]]) for (const hair of names) {
    const meshes = styleHuman(surface, { hair });
    assert.ok(meshes.length > 0, hair);
    checkMeshes(surface, meshes, hair);
    for (const mesh of meshes) assert.equal(mesh.userData.styleRegion, "head", `${hair}: ${mesh.name} follows the head`);
  }
});

test("every outfit builds skinned meshes and stands on the ground", () => {
  for (const [surface, names] of [[slim, humanStyles.outfit.slice(1)], [heavy, ["T-shirt and jeans", "Day dress", "Explorer", "Pressure suit"]]]) for (const outfit of names) {
    const meshes = styleHuman(surface, { outfit });
    assert.ok(meshes.length > 0, outfit);
    checkMeshes(surface, meshes, outfit);
    assert.ok(meshes.ground <= 0 && meshes.ground > -0.04, `${outfit} soles sit just below the bare feet`);
    let low = Infinity;
    for (const mesh of meshes) { const p = mesh.geometry.attributes.position.array; for (let i = 1; i < p.length; i += 3) low = Math.min(low, p[i]); }
    assert.ok(low > meshes.ground - 0.002, `${outfit} reports its lowest point`);
  }
});

test("materials receive the tone and the kind of surface, and helmets tuck loose hair away", () => {
  const kinds = new Set();
  const meshes = styleHuman(slim, { hair: "Ponytail", outfit: "Pressure suit", hairColor: "#111111", clothColor: "#336699" }, (color, kind) => { kinds.add(kind); return { color, kind }; });
  assert.deepEqual([...kinds].sort(), ["cloth", "hair", "leather", "metal"]);
  assert.ok(meshes.some(mesh => mesh.name === "Helmet"));
  assert.ok(!meshes.some(mesh => mesh.name === "Ponytail tail"), "the tail is hidden under the helmet");
  assert.equal(meshes.find(mesh => mesh.name === "Ponytail").material.color, "#111111");
  assert.ok(styleHuman(slim, { hair: "Ponytail" }).some(mesh => mesh.name === "Ponytail tail"));
});

test("everyday cloth creases, tights stay smooth, and creases can be turned off", async () => {
  const { analyse } = await import("./human-style-kit.js"), { garment, landmarks } = await import("./human-style-cloth.js");
  const body = analyse(heavy), m = landmarks(body), jeans = { waist: m.waistband, taper: .07, ease: .008 };
  const folded = garment(body, m, jeans).s, smooth = garment(body, m, { ...jeans, folds: 0 }).s;
  assert.ok(folded.count > smooth.count * 1.5, "creased cloth is cut finer where it folds");
  // The two legs are creased by separate draws, so the folds on one are not the mirror image of the other's.
  const relief = (s, sign) => { let sum = 0; for (let i = 0; i < s.count; i++) if (s.anc[i * 3] * sign > .03 && s.f.leg[i] > .8) sum += Math.hypot(s.pos[i * 3] - s.anc[i * 3], s.pos[i * 3 + 1] - s.anc[i * 3 + 1], s.pos[i * 3 + 2] - s.anc[i * 3 + 2]); return sum; };
  assert.ok(Math.abs(relief(folded, 1) - relief(folded, -1)) > 1e-4, "left and right legs fold differently");
  for (let i = 0; i < folded.count; i++) {
    const d = (folded.pos[i * 3] - folded.anc[i * 3]) * folded.nrm[i * 3] + (folded.pos[i * 3 + 1] - folded.anc[i * 3 + 1]) * folded.nrm[i * 3 + 1] + (folded.pos[i * 3 + 2] - folded.anc[i * 3 + 2]) * folded.nrm[i * 3 + 2];
    if (folded.f.leg[i] > .5 && folded.f.leg[i] < 1.9) assert.ok(d > .001 * m.k, "a fold never presses the cloth into the leg");
  }
  const tights = { waist: m.waistband, leg: 1.97, ease: .0025, gap: .0015, taper: 9, passes: 2 };
  assert.equal(garment(body, m, tights).s.count, garment(body, m, { ...tights, folds: 0 }).s.count, "skin-tight cloth takes no folds");
});

test("an outfit hides the skin under it but not the skin at its openings", () => {
  const bones = heavy.names, hand = bones.indexOf("hand_l"), pelvis = bones.indexOf("pelvis");
  const main = id => { const v = heavy.ids.indexOf(id); let best = 0; for (let n = 1; n < 4; n++) if (heavy.weights[v * 4 + n] > heavy.weights[v * 4 + best]) best = n; return heavy.boneIndices[v * 4 + best]; };
  const tee = styleHuman(heavy, { outfit: "T-shirt and jeans" }).hidden, parka = styleHuman(heavy, { outfit: "Parka" }).hidden;
  assert.ok([...tee].some(id => main(id) === pelvis), "the hips under jeans are left out");
  assert.ok(![...tee].some(id => main(id) === hand), "bare hands stay");
  assert.ok([...parka].some(id => main(id) === hand), "hands inside gloves are left out");
  assert.equal(styleHuman(heavy, { hair: "Bob" }).hidden.size, 0, "hair hides no skin");
});

test("a coat's skirt, its pockets and a belt move with the trunk and legs, never with a hand hanging beside them", () => {
  const arm = /^(upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)/;
  for (const [outfit, names] of [["Parka", ["Parka skirt", "Drawcord"]], ["Traveller", ["Tunic skirt", "Belt and pouch"]]])
    for (const mesh of styleHuman(heavy, { outfit }).filter(mesh => names.includes(mesh.name))) {
      let most = 0;
      mesh.humanWeights.weights.forEach((w, n) => { if (arm.test(heavy.names[mesh.humanWeights.boneIndices[n]])) most = Math.max(most, w); });
      assert.ok(most < .06, `${outfit}: ${mesh.name} follows no arm`);
    }
});

test("the top of a full coat skirt ends under the coat, so nobody looks down into a gap", async () => {
  const { raycast } = await import("./human-style-kit.js");
  for (const [surface, label] of [[slim, "slim"], [heavy, "heavy"]]) {
    const meshes = styleHuman(surface, { outfit: "Parka" }), coat = meshes.find(mesh => mesh.name === "Parka").geometry, skirt = meshes.find(mesh => mesh.name === "Parka skirt").geometry.attributes.position;
    let top = -Infinity, cx = 0, cz = 0, under = 0;
    for (let i = 0; i < skirt.count; i++) top = Math.max(top, skirt.getY(i));
    const ring = Array.from({ length: skirt.count }, (_, i) => i).filter(i => skirt.getY(i) > top - 1e-4);
    for (const i of ring) { cx += skirt.getX(i) / ring.length; cz += skirt.getZ(i) / ring.length; }
    for (const i of ring) {
      const out = [skirt.getX(i) - cx, 0, skirt.getZ(i) - cz], far = Math.hypot(...out);
      if (raycast(coat.attributes.position.array, coat.index.array, [skirt.getX(i), top, skirt.getZ(i)], out.map(x => x / far)) < .012) under++;
    }
    assert.ok(ring.length >= 48 && under === ring.length, `${label}: ${under} of ${ring.length} points of the skirt's top lie just under the coat`);
  }
});

test("a twisted fold keeps the outside and inside facing away from one another", () => {
  const outside = [[[0, 0, 0], [1, 0, 0]], [[0, 1, 0], [1, 1, .50]]];
  const inside = outside.map(row => row.map(([x, y, z]) => [x, y, z - .01]));
  const cloth = new Piece().slab(outside, inside, [[0], [1]]);
  const normalZ = i => {
    const [a, b, c] = cloth.tri.slice(i, i + 3).map(v => cloth.pos.slice(3*v, 3*v + 3));
    return (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]);
  };
  assert.ok(normalZ(0) > 0 && normalZ(3) > 0);
  assert.ok(normalZ(6) < 0 && normalZ(9) < 0);
});
