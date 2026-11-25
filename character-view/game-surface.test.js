import assert from "node:assert/strict";
import test from "node:test";
import * as T from "three";
import { heightNormals, measureTileScale, packNormals, packSurfaceChannels } from "./game-surface.js";

test("game material uses the same roughness and metalness channels and factors as the source", () => {
  const out = new Uint8ClampedArray(8);
  const packed = Uint8Array.of(255, 64, 0, 255, 10, 160, 200, 255);
  packSurfaceChannels(out, packed, packed, 0.8, 0.5);
  assert.deepEqual([...out], [255,51,0,255, 255,128,100,255]);
  packSurfaceChannels(out, null, null, 0.6, 0);
  assert.deepEqual([...out], [255,153,0,255, 255,153,0,255]);
});

test("game export bakes ambient occlusion strength into red independently of the other channels", () => {
  const packed = Uint8Array.of(55, 100, 200, 255, 255, 90, 80, 255);
  const out = new Uint8ClampedArray(8);
  packSurfaceChannels(out, packed, packed, 1, 0.5, packed, 0.8);
  assert.deepEqual([...out], [95, 100, 100, 255, 255, 90, 40, 255]);
  packSurfaceChannels(out, null, null, 1, 0, packed, 0);
  assert.deepEqual([...out], [255, 255, 0, 255, 255, 255, 0, 255]);
});

test("a resized normal tile keeps its authored tangent direction and material strength", () => {
  const out = new Uint8ClampedArray(4);
  packNormals(out, Uint8Array.of(204, 179, 230, 180), { x: 0.5, y: -1 });
  const [x, y, z] = Array.from(out, channel => channel / 127.5 - 1);
  assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < .01);
  assert.ok(Math.abs(x / z - .5 * 76.5 / 102.5) < .01);
  assert.ok(Math.abs(y / z + 51.5 / 102.5) < .01);
  assert.equal(out[3], 255);
});

test("bump slopes use the tile's metre scale, including unequal axes and reversed UV winding", () => {
  const geometry = new T.PlaneGeometry(1,1);
  const mesh = new T.Mesh(geometry);
  mesh.scale.set(2,0.5,1);
  mesh.updateMatrixWorld();
  const batch = { start:0, count:geometry.index.count };
  for (const flip of [false,true]) {
    const uv = geometry.attributes.uv;
    if (flip) for (let i=0;i<uv.count;i++) uv.setX(i,1-uv.getX(i));
    const scale = {u:0,v:0,area:0};
    measureTileScale(mesh,batch,scale);
    assert.equal(scale.u/scale.area,2);
    assert.equal(scale.v/scale.area,0.5);
    const height = new Uint8Array(4 * 9);
    for (let y=0;y<3;y++) for(let x=0;x<3;x++) height[4*(3*y+x)] = 20 + 20*x + 20*y;
    const out = new Uint8ClampedArray(height.length);
    heightNormals(out,height,3,3,1,scale,false);
    const [nx, ny, nz, alpha] = out.slice(16,20);
    assert.ok(nx < 127 && ny > 128 && nz > 228);
    assert.ok(Math.abs((ny-127.5)/(127.5-nx)-4) < 0.3);
    assert.equal(alpha,255);
    heightNormals(out,height,3,3,0,scale,false);
    assert.deepEqual([...out.slice(16,20)],[128,128,255,255]);
  }
  geometry.dispose();
  mesh.material.dispose();
});
