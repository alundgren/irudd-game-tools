import assert from "node:assert/strict";
import test from "node:test";
import { Mesh, MeshStandardMaterial, PlaneGeometry } from "three";
import { bakeContact } from "./game-contact.js";

test("a close opaque layer occludes cloth, authored ambient maps retain their UVs, and cutouts cast no solid shadow", () => {
  const layer = z => {
    const mesh = new Mesh(new PlaneGeometry(1,1,4,4), new MeshStandardMaterial());
    mesh.position.z = z;
    mesh.updateMatrixWorld();
    return { mesh, groups: [{ material: mesh.material, result: mesh.geometry.index.array }] };
  };
  const cloth = layer(0), cover = layer(.003);
  bakeContact([cloth, cover], 1024);
  const u = () => cloth.mesh.geometry.getAttribute("uv1").getX(12);
  assert.ok(u() < .65, "the fabric under the opaque panel is sheltered");
  cover.mesh.material.alphaTest = .5;
  bakeContact([cloth, cover], 1024);
  assert.ok(u() > .99, "the fibre panel does not cast a solid square of shading");
  cloth.mesh.material.aoMap = { image: {} };
  bakeContact([cloth, cover], 1024);
  assert.deepEqual(cloth.mesh.geometry.attributes.uv1.array, cloth.mesh.geometry.attributes.uv.array);
});
