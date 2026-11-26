// Local surface pulls. Ported from character-view/surface-pull.js at 2761eb1.
//
// Pulls live in the part's own frame. A separate reach on each local axis
// keeps the influence spherical in world space on a non-uniformly scaled part.

import * as T from "three";
import type { SurfacePull } from "@irudd/document";
import { isMesh } from "../mesh.js";

/** Move `v`, in the part's frame, by every pull whose reach it lies within. */
export function pullPoint(v: T.Vector3, pull: SurfacePull): T.Vector3 {
  const [x, y, z] = pull.at;
  const [rx, ry, rz] = pull.reach;
  const weight = (cx: number): number => {
    const q = ((v.x - cx) / rx) ** 2 + ((v.y - y) / ry) ** 2 + ((v.z - z) / rz) ** 2;
    return q >= 1 ? 0 : (1 - q) ** 2;
  };
  const primary = weight(x);
  const twin = pull.mirrorX === undefined ? 0 : weight(2 * pull.mirrorX - x);
  // Do not double the offset where symmetric influence regions overlap.
  const a = Math.max(primary, twin);
  const side = primary + twin ? (primary - twin) / (primary + twin) : 0;
  v.x += a * side * pull.offset[0];
  v.y += a * pull.offset[1];
  v.z += a * pull.offset[2];
  return v;
}

/** The meshes a part owns: its own and its children's, up to the next part. */
function ownedMeshes(object: T.Object3D, visit: (mesh: T.Mesh) => void, first = true): void {
  if (!first && object.userData["partId"] !== undefined) return;
  if (isMesh(object)) visit(object);
  for (const child of object.children) ownedMeshes(child, visit, false);
}

/**
 * Pull the surface of every mesh `root` owns. Each mesh takes a private copy
 * of its geometry, since built-in pieces share theirs, and its normals are
 * recomputed from the pulled positions. `replaced` hears of each copy, so
 * notes kept about the original geometry can follow it.
 */
export function pullSurface(
  root: T.Object3D,
  pulls: ReadonlyArray<SurfacePull>,
  replaced?: (original: T.BufferGeometry, copy: T.BufferGeometry) => void,
): void {
  if (!pulls.length) return;
  root.updateWorldMatrix(true, true);
  const inverse = root.matrixWorld.clone().invert();
  const v = new T.Vector3();
  ownedMeshes(root, (mesh) => {
    const local = inverse.clone().multiply(mesh.matrixWorld);
    const back = local.clone().invert();
    const original = mesh.geometry;
    const geometry = original.clone();
    mesh.geometry = geometry;
    replaced?.(original, geometry);
    const pos = geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(local);
      for (const pull of pulls) pullPoint(v, pull);
      v.applyMatrix4(back);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  });
}
