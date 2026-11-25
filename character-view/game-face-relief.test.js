import test from "node:test";
import assert from "node:assert/strict";
import { BufferGeometry, Float32BufferAttribute } from "three";
import { bakeFaceOcclusion, transferFaceNormals } from "./game-face-relief.js";

test("a collapsed fold transfers its normal through straight and mirrored UV islands", () => {
  const high = [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4],
    low = [0, 1, 2, 0, 2, 3];
  for (const mirror of [false, true]) {
    const g = new BufferGeometry();
    g.setAttribute(
      "position",
      new Float32BufferAttribute(
        [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0.5, 0.5, 0],
        3,
      ),
    );
    g.setAttribute(
      "normal",
      new Float32BufferAttribute(
        [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0.36, -0.2, 0.912],
        3,
      ),
    );
    const uv = [0, 0, 1, 0, 1, 1, 0, 1, 0.5, 0.5].map((v, i) =>
      mirror && i % 2 === 0 ? 1 - v : v,
    );
    g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
    const pixels = new Uint8ClampedArray(15 * 15 * 4);
    for (let i = 0; i < pixels.length; i += 4)
      pixels.set([128, 128, 255, 255], i);
    transferFaceNormals(pixels, 15, 15, g, high, low);
    const centre = (7 * 15 + 7) * 4;
    assert.ok(Math.abs(pixels[centre] - (mirror ? 82 : 174)) <= 1);
    assert.ok(Math.abs(pixels[centre + 1] - 102) <= 1);
    assert.ok(Math.abs(pixels[centre + 2] - 244) <= 1);
    // A normal from an overlapping sheet in front of the face is ignored.
    g.attributes.position.setZ(4, 0.025);
    pixels.set([128, 128, 255, 255], centre);
    transferFaceNormals(pixels, 15, 15, g, high, low);
    assert.deepEqual(
      Array.from(pixels.slice(centre, centre + 4)),
      [128, 128, 255, 255],
    );
  }
});

test("face occlusion shades sheltered skin while preserving the surface channels", () => {
  const geometry = new BufferGeometry();
  const points = [], normals = [], uvs = [], indices = [];
  for (let layer = 0; layer < 2; layer++) {
    const start = points.length / 3;
    for (const [x, y] of [[0,0],[1,0],[1,1],[0,1],[0.5,0.5]]) {
      points.push(x, y, layer * 0.035);
      normals.push(0, 0, 1);
      uvs.push((x + layer) / 2, y);
    }
    for (let side = 0; side < 4; side++) indices.push(start + side, start + (side+1)%4, start+4);
  }
  geometry.setAttribute("position", new Float32BufferAttribute(points, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  const pixels = new Uint8ClampedArray(32*16*4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set([200,124,33,255], i);
  bakeFaceOcclusion(pixels, 32, 16, geometry, indices);
  const red = x => pixels[(8*32+x)*4];
  assert.ok(red(8) < 145);
  assert.equal(red(24), 200);
  for (let i = 0; i < pixels.length; i += 4)
    assert.deepEqual(Array.from(pixels.slice(i+1,i+4)), [124,33,255]);
});
