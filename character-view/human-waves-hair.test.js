import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { evaluateHuman } from "./human-surface.js";
import { surfaceFrame } from "./human-fringe.js";
import { libraryPieces } from "./human-library.js";
import { fittedHat, hatHead } from "./human-hats.js";
import { raycaster } from "./human-style-kit.js";

const material = () => new T.MeshStandardMaterial();
const heads = {
  resting: {},
  slight: { height: 1.66, frame: -0.9 },
  heavy: { height: 1.9, frame: 0.9, weight: 0.9, age: 0.8 },
  wide: { height: 1.5, frame: 0.6, weight: 0.9, headWidth: 1, forehead: 1, temples: 1 },
  narrow: { height: 1.95, frame: -0.8, weight: -0.7, headWidth: -1, forehead: -1, temples: -1 },
};

test("Loose waves unwinds fractured card normals and seals scalp/side gaps across diverse heads", () => {
  for (const [label, human] of Object.entries(heads)) {
    const surface = evaluateHuman(human);
    const f = surfaceFrame(surface);
    const hHead = hatHead(f);
    const pieces = libraryPieces(surface, { hair: "Loose waves", fringe: "Parted", hairColor: "#72553d" }, material, false, true);
    const hair = pieces.find((m) => m.userData.libraryHair === "cloud_waves");
    assert.ok(hair, label + " builds Loose waves");
    const g = hair.geometry;
    const pos = g.attributes.position, norm = g.attributes.normal, uv = g.attributes.uv, color = g.attributes.color;
    assert.ok(color && hair.material.vertexColors, label + " carries depth AO vertex colors");
    assert.ok(g.index.count / 3 < 3400, `${label} stays compact for 24k export (${g.index.count / 3} tris)`);

    let inwardVerts = 0, maxCrownH = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const pt = [pos.getX(i), pos.getY(i), pos.getZ(i)];
      const dx = pt[0] - f.centre[0], dy = pt[1] > f.centre[1] ? pt[1] - f.centre[1] : (pt[1] - f.centre[1]) * 0.2, dz = pt[2] - f.centre[2];
      const dl = Math.hypot(dx, dy, dz) || 1;
      const dot = (norm.getX(i) * dx + norm.getY(i) * dy + norm.getZ(i) * dz) / dl;
      if (dot < 0) inwardVerts++;
      assert.ok(uv.getX(i) >= 0 && uv.getX(i) <= 1 && uv.getY(i) >= 0 && uv.getY(i) <= 1, label + " UV in [0,1]");
      const o = hHead.over(pt);
      if (o.eps > 22 * Math.PI / 180) maxCrownH = Math.max(maxCrownH, o.h);
    }
    assert.equal(inwardVerts, 0, `${label}: no inward-facing vertex normals`);
    assert.ok(maxCrownH < 0.028 * f.k, `${label}: crown fitted without stair-step loft (${(maxCrownH * 1000).toFixed(1)}mm)`);

    const cast = raycaster(pos.array, g.index.array);
    let rays = 0, hits = 0;
    for (const side of [-1, 1]) {
      for (let phiDeg = 70; phiDeg <= 175; phiDeg += 15) {
        for (let epsDeg = -15; epsDeg <= 70; epsDeg += 15) {
          const phi = side * phiDeg * Math.PI / 180, eps = epsDeg * Math.PI / 180;
          rays++;
          const d = cast(f.centre, [Math.cos(eps) * Math.sin(phi), Math.sin(eps), Math.cos(eps) * Math.cos(phi)]);
          if (Number.isFinite(d) && d < 0.22 * f.k) hits++;
        }
      }
    }
    assert.ok(hits / rays >= 0.98, `${label}: coverage ${hits}/${rays} must be >= 98%`);
  }
});

test("Loose waves works across fringe settings, clay mode, and hats", () => {
  const surface = evaluateHuman(heads.resting);
  for (const fringe of ["As cut", "Parted", "Swept left", "Swept right", "Off the face"]) {
    const pieces = libraryPieces(surface, { hair: "Loose waves", fringe, hairColor: "#c8a56d" }, material, false, false);
    const hair = pieces.find((m) => m.userData.libraryHair === "cloud_waves");
    assert.ok(hair && hair.geometry.index.count > 0, fringe);
  }
  const clay = libraryPieces(surface, { hair: "Loose waves", fringe: "Parted" }, material, true, false)
    .find((m) => m.userData.libraryHair === "cloud_waves");
  assert.ok(clay && !clay.geometry.attributes.color, "clay mode builds clean geometry without vertex colors");

  for (const hat of ["Beret", "Bucket hat", "Flat cap"]) {
    const pieces = libraryPieces(surface, { hair: "Loose waves", fringe: "Parted", hairColor: "#44372f" }, material, false, true);
    const headHair = pieces.filter((m) => m.userData.styleRegion === "head");
    const hatMeshes = fittedHat(surface, { hair: "Loose waves", hat, hatColor: "#5a4a3c" }, headHair, material, false);
    assert.ok(hatMeshes.length > 0, hat + " fits over Loose waves");
  }
});
