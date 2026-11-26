// Swatch provenance: a bundled surface sheet is listed for an export only when
// one of its swatches reaches a material of a visible exported mesh. Loading
// the kit is not enough; a finish without a swatch, a materials override and
// a hidden part claim none. The textured presets' own listing is the slow
// gate's (marsh-tripod, relay-wardrobe).

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
import { readFixture } from "../src/run.js";

const noRaster: Raster = {
  canvas: () => {
    throw new Error("No raster in node.");
  },
  image: () => Promise.reject(new Error("No raster in node.")),
};

/** A kit whose canvas swatch is drawn from the surfaces sheet; nothing else has a swatch. */
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
  const satin = buildCharacter(readFixture("relay-wardrobe"), { materials: surfaceMaterials(k) });
  const clay = buildCharacter(readFixture("marsh-tripod"), { materials: clayMaterials() });
  try {
    assert.deepEqual(swatchSheets(satin.group), []);
    assert.deepEqual(swatchSheets(clay.group), []);
  } finally {
    satin.dispose();
    clay.dispose();
  }
});
