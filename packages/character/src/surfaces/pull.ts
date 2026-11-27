import * as T from "three";
import type { SurfacePull } from "@irudd/document";
import { isMesh } from "../mesh.js";

export function pullPoint(v: T.Vector3, pull: SurfacePull): T.Vector3 {
  const [x, y, z] = pull.at;
  const [rx, ry, rz] = pull.reach;
  const weight = (cx: number): number => {
    const q = ((v.x - cx) / rx) ** 2 + ((v.y - y) / ry) ** 2 + ((v.z - z) / rz) ** 2;
    return q >= 1 ? 0 : (1 - q) ** 2;
  };
  const primary = weight(x);
  const twin = pull.mirrorX === undefined ? 0 : weight(2 * pull.mirrorX - x);
  const a = Math.max(primary, twin);
  const side = primary + twin ? (primary - twin) / (primary + twin) : 0;
  v.x += a * side * pull.offset[0];
  v.y += a * pull.offset[1];
  v.z += a * pull.offset[2];
  return v;
}

function ownedMeshes(object: T.Object3D, visit: (mesh: T.Mesh) => void, first = true): void {
  if (!first && object.userData["partId"] !== undefined) return;
  if (isMesh(object)) visit(object);
  for (const child of object.children) ownedMeshes(child, visit, false);
}

export function mirrorCentre(root: T.Object3D) {
  root.updateWorldMatrix(true, true);
  const inverse = root.matrixWorld.clone().invert();
  const bounds = new T.Box3(),
    v = new T.Vector3();
  ownedMeshes(root, (mesh) => {
    const local = inverse.clone().multiply(mesh.matrixWorld);
    const positions = mesh.geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++)
      bounds.expandByPoint(v.fromBufferAttribute(positions, i).applyMatrix4(local));
  });
  return bounds.getCenter(v).x;
}

function pullGeometry(
  root: T.Object3D,
  replaced?: (original: T.BufferGeometry, copy: T.BufferGeometry) => void,
) {
  root.updateWorldMatrix(true, true);
  const inverse = root.matrixWorld.clone().invert();
  const records: {
    mesh: T.Mesh;
    original: T.BufferGeometry;
    geometry: T.BufferGeometry;
    local: T.Matrix4;
    back: T.Matrix4;
  }[] = [];
  ownedMeshes(root, (mesh) => {
    const original = mesh.geometry,
      geometry = original.clone(),
      local = inverse.clone().multiply(mesh.matrixWorld);
    mesh.geometry = geometry;
    records.push({ mesh, original, geometry, local, back: local.clone().invert() });
  });
  const v = new T.Vector3();
  return {
    apply(pulls: readonly SurfacePull[]) {
      for (const { original, geometry, local, back } of records) {
        const rest = original.getAttribute("position"),
          pos = geometry.getAttribute("position");
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(rest, i).applyMatrix4(local);
          for (const field of pulls) pullPoint(v, field);
          v.applyMatrix4(back);
          pos.setXYZ(i, v.x, v.y, v.z);
        }
        pos.needsUpdate = true;
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
      }
    },
    keep() {
      for (const { original, geometry } of records) replaced?.(original, geometry);
    },
    restore() {
      for (const { mesh, original, geometry } of records) {
        mesh.geometry = original;
        geometry.dispose();
      }
    },
  };
}
export function previewPull(root: T.Object3D) {
  const preview = pullGeometry(root);
  return {
    restore: () => preview.restore(),
    apply: (field: SurfacePull) => preview.apply([field]),
  };
}
export function pullSurface(
  root: T.Object3D,
  pulls: readonly SurfacePull[],
  replaced?: (original: T.BufferGeometry, copy: T.BufferGeometry) => void,
) {
  if (!pulls.length) return;
  const work = pullGeometry(root, replaced);
  work.apply(pulls);
  work.keep();
}
