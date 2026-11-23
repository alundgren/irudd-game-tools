import { Matrix4, Vector3 } from "three";

// Pulls live in the part's own frame. A separate reach on each local axis
// keeps the influence spherical in world space on a non-uniformly scaled part.
export function pullPoint(v, stroke) {
  const [x, y, z] = stroke.at,
    [rx, ry, rz] = stroke.reach;
  const weight = (cx) => {
    const q =
      ((v.x - cx) / rx) ** 2 + ((v.y - y) / ry) ** 2 + ((v.z - z) / rz) ** 2;
    return q >= 1 ? 0 : (1 - q) ** 2;
  };
  const primary = weight(x);
  const twin =
    stroke.mirrorX === undefined ? 0 : weight(2 * stroke.mirrorX - x);
  // Do not double the offset where symmetric influence regions overlap.
  const a = Math.max(primary, twin),
    side = primary + twin ? (primary - twin) / (primary + twin) : 0;
  v.x += a * side * stroke.offset[0];
  v.y += a * stroke.offset[1];
  v.z += a * stroke.offset[2];
  return v;
}
function ownedMeshes(o, visit, first = true) {
  if (!first && o.userData.partId) return;
  if (o.isMesh) visit(o);
  for (const child of o.children) ownedMeshes(child, visit, false);
}
export function pullSurface(root) {
  root.updateWorldMatrix(true, true);
  const inverse = new Matrix4().copy(root.matrixWorld).invert(),
    records = [];
  ownedMeshes(root, (mesh) => {
    const local = inverse.clone().multiply(mesh.matrixWorld);
    // Anatomy instances may share source geometry. A sculpt is private to its region.
    const original = mesh.geometry;
    const g = original.clone();
    mesh.geometry = g;
    records.push({
      mesh,
      original,
      geometry: g,
      local,
      inverse: local.clone().invert(),
      rest: g.attributes.position.array.slice(),
    });
  });
  const v = new Vector3();
  return {
    apply(strokes) {
      for (const r of records) {
        const pos = r.geometry.attributes.position;
        pos.array.set(r.rest);
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(r.local);
          for (const stroke of strokes) pullPoint(v, stroke);
          v.applyMatrix4(r.inverse);
          pos.setXYZ(i, v.x, v.y, v.z);
        }
        pos.needsUpdate = true;
        r.geometry.computeVertexNormals();
        r.geometry.computeBoundingBox();
        r.geometry.computeBoundingSphere();
      }
    },
    restore() {
      for (const r of records) {
        r.mesh.geometry = r.original;
        r.geometry.dispose();
      }
    },
  };
}
