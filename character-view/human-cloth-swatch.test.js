import test from "node:test";
import assert from "node:assert/strict";
import { BoxGeometry, Mesh, MeshStandardMaterial, Texture } from "three";
import { clothDesigns, finishCloth } from "./human-cloth-swatch.js";
import { buildLibraryFabricMaps, hasLibraryFabricProfile } from "./human-cloth-library-surface.js";
import { humanForm } from "./human-form.js";
import { chooseAdultStyle, dressHuman, validAdultStyle } from "./human-wardrobe.js";
import { makeBrief, readProposal } from "./recipe.js";

const frame = { k: 1, waist: 1, shoulder: 1.5, chest: [0, 1.3, 0] };

test("procedural cloth swatches leave old styles and non-fabric meshes alone", () => {
  const historical = { outfit: "Shirt and chinos", hair: "Crop", clothColor: "#466068" };
  assert.ok(validAdultStyle(historical));
  const selected = chooseAdultStyle(historical, { clothDesign: "Windowpane", clothAccent: "#c4b8a0" });
  assert.ok(validAdultStyle(selected));
  assert.equal(selected.hair, historical.hair);
  assert.equal(selected.clothColor, historical.clothColor);
  assert.ok(!validAdultStyle({ clothDesign: "unknown" }));
  const form = humanForm({}, 8);
  const dressed = dressHuman(form, 8712);
  // A complete look chooses a design with the rest of the wardrobe, so every rolled look is woven cloth.
  assert.ok(clothDesigns.includes(dressed.humanStyle.clothDesign) && dressed.humanStyle.clothDesign !== "Plain cloth");
  assert.ok(validAdultStyle(dressed.humanStyle));
  assert.equal(dressed.human, form.human);
  assert.equal(dressed.appearance, form.appearance);
  const shared = new MeshStandardMaterial({ color: historical.clothColor, roughness: .88 });
  const mesh = name => Object.assign(new Mesh(new BoxGeometry(.5, .5, .2), shared), { name });
  for (const name of ["face", "Buttons", "Trainer", "Belt"]) {
    const part = mesh(name);
    finishCloth(part, historical.outfit, selected, frame);
    assert.equal(part.material, shared, name);
  }
  const shirt = mesh("Shirt");
  finishCloth(shirt, historical.outfit, historical, frame);
  assert.equal(shirt.material, shared);
  finishCloth(shirt, historical.outfit, selected, frame);
  assert.notEqual(shirt.material, shared);
  assert.equal(shirt.material.roughness, .7);
  assert.equal(shared.roughness, .88);
});

test("the web swatch creates an opaque colour map and stable UVs", () => {
  globalThis.document = {
    createElement() {
      return {
        getContext() {
          return {
            createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
            putImageData: image => { this.imageData = image; },
          };
        },
      };
    },
  };
  try {
    const make = (clothDesign, directed = false) => {
      const mesh = new Mesh(new BoxGeometry(.5, .5, .2), new MeshStandardMaterial({ color: "#765d72" }));
      mesh.name = "Shirt";
      finishCloth(mesh, "Shirt and chinos", { clothDesign, clothAccent: "#e1d1a9", ...(directed && { clothSecond: "#535963" }) }, frame);
      const { image } = mesh.material.map;
      const uv = mesh.geometry.attributes.uv;
      assert.equal(uv.count, mesh.geometry.attributes.position.count);
      assert.ok(uv.array.every(value => value > 0 && value < 1));
      assert.ok(image.imageData.data.every((value, i) => i % 4 !== 3 || value === 255));
      return { pixels: image.imageData.data, uv: uv.array, surface: mesh.material.bumpMap?.image.imageData.data };
    };
    const shirt = make("Windowpane"), weave = make("Quiet weave");
    assert.deepEqual(shirt.uv, weave.uv);
    assert.notDeepEqual(shirt.pixels, weave.pixels);
    assert.deepEqual(shirt.pixels, make("Windowpane").pixels);
    assert.equal(shirt.surface, undefined);
    const printed = make("Windowpane", true), unprinted = make("Quiet weave", true);
    assert.deepEqual(printed.surface, unprinted.surface, "printing on a shirt does not emboss the pigment");
    assert.ok(printed.surface.some((v, i) => i % 4 === 0 && v > 150));
    assert.ok(printed.surface.some((v, i) => i % 4 === 1 && v < 245));
  } finally {
    delete globalThis.document;
  }
});

test("the normal proposal reader can change just the cloth design", () => {
  const form = dressHuman(humanForm({}, 8), 8712);
  const brief = makeBrief(form, "test", null, {}, "Give this outfit a pale woven check");
  assert.ok(brief.humanAppearanceInstructions.clothDesign.includes("Windowpane"));
  const result = readProposal({
    format: "irudd.form-proposal.v1",
    requestId: brief.requestId,
    revision: "test",
    summary: "Pale woven check",
    operations: [{ op: "setForm", set: { humanStyle: { clothDesign: "Windowpane", clothAccent: "#c4b8a0" } } }],
  }, brief, "test").form;
  assert.deepEqual(result.humanStyle, { ...form.humanStyle, clothDesign: "Windowpane", clothAccent: "#c4b8a0" });
  assert.deepEqual(result.parts, form.parts);
});

test("cloth families build distinct construction relief and roughness profiles", () => {
  globalThis.document = {
    createElement() {
      return {
        getContext() {
          return {
            createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
            putImageData: image => { this.imageData = image; },
          };
        },
      };
    },
  };
  try {
    const sample = (partName, outfit) => {
      const mesh = new Mesh(new BoxGeometry(.5, .5, .2), new MeshStandardMaterial({ color: "#4e5d6c" }));
      mesh.name = partName;
      finishCloth(mesh, outfit, { clothDesign: "Quiet weave", clothSecond: "#38414b" }, frame);
      const surf = mesh.material.bumpMap.image.imageData.data;
      let sumR = 0, minH = 255, maxH = 0, count = surf.length / 4;
      for (let i = 0; i < surf.length; i += 4) {
        if (surf[i] < minH) minH = surf[i];
        if (surf[i] > maxH) maxH = surf[i];
        sumR += (surf[i + 1] / 255) * mesh.material.roughness;
      }
      return { meanRough: sumR / count, heightSpan: maxH - minH, bumpScale: mesh.material.bumpScale };
    };
    const wool = sample("Sweater", "Sweater and skirt");
    const poplin = sample("Shirt", "Shirt and chinos");
    const denim = sample("Jeans", "T-shirt and jeans");
    const canvas = sample("Chore jacket", "Chore jacket");
    const waxed = sample("Apron", "Workshop apron");
    const ripstop = sample("Parka", "Parka");
    const satin = sample("Sash", "Day dress");
    assert.ok(wool.meanRough > poplin.meanRough + 0.20, `wool (${wool.meanRough.toFixed(2)}) rougher than poplin (${poplin.meanRough.toFixed(2)})`);
    assert.ok(denim.meanRough > poplin.meanRough + 0.08, `denim (${denim.meanRough.toFixed(2)}) rougher than poplin (${poplin.meanRough.toFixed(2)})`);
    assert.ok(poplin.meanRough > satin.meanRough + 0.25, `poplin (${poplin.meanRough.toFixed(2)}) rougher than satin (${satin.meanRough.toFixed(2)})`);
    assert.ok(waxed.meanRough < canvas.meanRough - 0.25, `waxed cotton (${waxed.meanRough.toFixed(2)}) glossier than canvas (${canvas.meanRough.toFixed(2)})`);
    assert.ok(ripstop.meanRough < denim.meanRough - 0.20, `ripstop (${ripstop.meanRough.toFixed(2)}) glossier than denim (${denim.meanRough.toFixed(2)})`);
    assert.ok(wool.bumpScale > poplin.bumpScale && canvas.bumpScale > poplin.bumpScale);
    assert.ok(wool.heightSpan > 120 && denim.heightSpan > 120 && canvas.heightSpan > 120 && ripstop.heightSpan > 120);
  } finally {
    delete globalThis.document;
  }
});

test("library fabric surface maps differentiate panels, guard gutters, and skip minimal test stubs", () => {
  assert.ok(hasLibraryFabricProfile("male_elegantsuit01") && !hasLibraryFabricProfile("nonexistent_asset"));
  // Minimal mock canvas without createImageData (as used by human-looks.test.js) must return null cleanly.
  globalThis.document = {
    createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(16) }), putImageData() {} }) }),
  };
  try {
    const tiny = new Texture({ width: 2, height: 2 });
    assert.equal(buildLibraryFabricMaps("male_elegantsuit01", tiny, null, null, null, null), null);
  } finally {
    delete globalThis.document;
  }

  // Full 2D canvas mock with 32x32 image: top third tie (rule 0), middle third shirt (rule 1),
  // bottom strip suit wool (rule 2), right column transparent UV gutter.
  const size = 32;
  const srcPixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      if (x >= 28) { srcPixels[o + 3] = 0; continue; } // transparent UV gutter
      if (y < 10) { srcPixels[o] = 6; srcPixels[o + 1] = 6; srcPixels[o + 2] = 18; srcPixels[o + 3] = 255; } // dark tie
      else if (y < 20) { srcPixels[o] = 220; srcPixels[o + 1] = 220; srcPixels[o + 2] = 220; srcPixels[o + 3] = 255; } // light shirt
      else { srcPixels[o] = 54; srcPixels[o + 1] = 54; srcPixels[o + 2] = 54; srcPixels[o + 3] = 255; } // suit wool
    }
  }
  globalThis.document = {
    createElement() {
      const canvas = {
        width: size,
        height: size,
        getContext() {
          return {
            drawImage() {},
            getImageData: () => ({ data: srcPixels }),
            createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
            putImageData(img) { canvas.imageData = img; },
          };
        },
      };
      return canvas;
    },
  };
  try {
    const tex = new Texture({ width: size, height: size });
    const dyeRules = [
      { pick: (_h, s, l) => l < 0.10 && s > 0.2 }, // tie
      { pick: (_h, _s, l) => l > 0.6 },            // shirt
      { pick: () => true },                         // suit wool
    ];
    const result = buildLibraryFabricMaps("male_elegantsuit01", tex, null, null, null, dyeRules);
    assert.ok(result && result.surface && result.normal);
    const orm = result.surface.image.imageData.data;
    const norm = result.normal.image.imageData.data;
    const meanRough = (y0, y1) => {
      let s = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = 2; x < 26; x++) { s += orm[(y * size + x) * 4 + 1] / 255; n++; }
      return s / n;
    };
    const tieR = meanRough(1, 9), shirtR = meanRough(11, 19), suitR = meanRough(21, 30);
    assert.ok(tieR < shirtR - 0.15, `silk tie (${tieR.toFixed(2)}) glossier than shirt (${shirtR.toFixed(2)})`);
    assert.ok(shirtR < suitR - 0.15, `cotton shirt (${shirtR.toFixed(2)}) glossier than wool suit (${suitR.toFixed(2)})`);
    // Transparent UV gutter must stay neutral tangent normal (128, 128, 255), never bleeding invalid vectors.
    const gOff = (15 * size + 30) * 4;
    assert.deepEqual([norm[gOff], norm[gOff + 1], norm[gOff + 2]], [128, 128, 255]);
  } finally {
    delete globalThis.document;
  }
});
