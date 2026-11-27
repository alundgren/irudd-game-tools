import assert from "node:assert/strict";
import { test } from "node:test";
import * as T from "three";
import {
  buildCharacter,
  bundledAssetNamed,
  clayMaterials,
  surfaceMaterials,
  swatchSheet,
  swatchSheets,
  type Raster,
  type SurfaceKit,
} from "@irudd/character";
import { readFixture } from "../src/fixtures.js";

const noRaster: Raster = {
  canvas: () => {
    throw new Error("No raster in node.");
  },
  image: () => Promise.reject(new Error("No raster in node.")),
};

function kit(): { kit: SurfaceKit; sheet: string } {
  const surfaces = bundledAssetNamed("surfaces");
  assert.ok(surfaces);
  const canvas = new T.Texture();
  swatchSheet.set(canvas, surfaces.digest);
  return {
    sheet: surfaces.digest,
    kit: {
      raster: noRaster,
      textures: new Map([["canvas", canvas]]),
      roughness: new Map(),
      faces: { raster: noRaster, cells: [], tinted: new Map() },
      dispose: () => undefined,
    },
  };
}

test("a swatch on a visible material lists its sheet", () => {
  const { kit: k, sheet } = kit();
  const built = buildCharacter(readFixture("marsh-tripod"), { materials: surfaceMaterials(k) });
  try {
    assert.deepEqual(swatchSheets(built.group), [sheet]);
    for (const { object } of built.parts.values()) object.visible = false;
    assert.deepEqual(swatchSheets(built.group), [], "a hidden part's swatch is not exported");
  } finally {
    built.dispose();
  }
});

test("a loaded kit alone, a finish without a swatch or an override lists none", () => {
  const { kit: k } = kit();
  const bare = buildCharacter(readFixture("glassgrass-eel"), { materials: surfaceMaterials(k) });
  const clay = buildCharacter(readFixture("marsh-tripod"), { materials: clayMaterials() });
  try {
    assert.deepEqual(swatchSheets(bare.group), []);
    assert.deepEqual(swatchSheets(clay.group), []);
  } finally {
    bare.dispose();
    clay.dispose();
  }
});

test("a saved satin cut uses the cloth weave for colour and relief", () => {
  const { kit: k, sheet } = kit();
  const materials = surfaceMaterials(k);
  const built = buildCharacter(readFixture("relay-wardrobe"), { materials, finish: {} });
  try {
    const skirt = built.parts.get("p-skirt")?.object;
    assert.ok(skirt instanceof T.Mesh);
    const satin: unknown = skirt.material;
    assert.ok(satin instanceof T.MeshStandardMaterial);
    assert.equal(satin.map, k.textures.get("canvas"));
    assert.equal(satin.bumpMap, satin.map);
    assert.ok(satin.bumpScale > 0);
    const color = "#" + satin.color.getHexString();
    const smooth = materials(color, "satin");
    const canvas = materials(color, "canvas");
    assert.ok(smooth instanceof T.MeshStandardMaterial && canvas instanceof T.MeshStandardMaterial);
    assert.equal(smooth.map, null);
    assert.ok(satin.roughness > smooth.roughness && satin.roughness < canvas.roughness);
    assert.deepEqual(swatchSheets(built.group), [sheet]);
  } finally {
    built.dispose();
  }
});
