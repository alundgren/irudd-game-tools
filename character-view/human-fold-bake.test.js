import test from "node:test";
import assert from "node:assert/strict";
import { BufferGeometry, Float32BufferAttribute, Mesh } from "three";
import { foldPanels } from "./human-fold-bake.js";

test("opposing fold panels preserve bind weights and separate front and back shading", () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position",new Float32BufferAttribute([0,0,0, 1,0,0, 0,1,0],3));
  geometry.setAttribute("uv",new Float32BufferAttribute([0,0, 1,0, 0,1],2));
  geometry.setIndex([0,1,2, 2,1,0]);
  const mesh = new Mesh(geometry);
  mesh.humanWeights = {
    weights: Float32Array.from([1,0,0,0, .5,.5,0,0, .75,.25,0,0]),
    boneIndices: Uint8Array.from([1,0,0,0, 1,2,0,0, 2,3,0,0])
  };
  const panel = foldPanels(mesh);
  assert.equal(panel.geom.attributes.position.count, 6);
  const uv=panel.geom.attributes.uv;
  panel.source.forEach((old,i) => {
    assert.equal(uv.getX(i),(geometry.attributes.uv.getX(old)+panel.panels[i])/2);
    assert.equal(uv.getY(i),geometry.attributes.uv.getY(old));
    for (const key of ["weights","boneIndices"]) {
      assert.deepEqual(panel.skin[key].slice(i*4,i*4+4),mesh.humanWeights[key].slice(old*4,old*4+4));
    }
  });
});
