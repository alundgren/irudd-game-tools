import { Matrix4, Vector3 } from "three";
import { bodyFrame } from "./graft.js";

export const buildAxes = ["mass", "shoulders", "waist", "belly", "hips"];
const bell = (y, c, r) => Math.exp(-(((y - c) / r) ** 2));

export function sculptBuild(root, form) {
  const build = form.build;
  if (!build || buildAxes.every((k) => (build[k] ?? 1) === 1)) return;
  root.updateMatrixWorld(true);
  const box = bodyFrame(form),
    point = new Vector3(),
    meshes = [],
    pivots = [];
  root.traverse((o) => {
    if (o.isMesh) {
      meshes.push([o, o.matrixWorld.clone()]);
    }
    if (o.userData.partId) pivots.push([o, o.getWorldPosition(new Vector3())]);
  });
  const center = box.getCenter(new Vector3()),
    extent = box.getSize(new Vector3());
  const delta = (key) => (build[key] ?? 1) - 1;
  function warp(v) {
    const y = (v.y - box.min.y) / Math.max(0.001, extent.y),
      x = v.x - center.x,
      z = v.z - center.z;
    const body = bell(y, 0.55, 0.35),
      waist = bell(y, 0.6, 0.14),
      hip = bell(y, 0.47, 0.13),
      upper = bell(y, 0.76, 0.13);
    v.x =
      center.x +
      x *
        (1 +
          0.47 * delta("mass") * body +
          0.49 * delta("hips") * hip +
          0.59 * delta("shoulders") * upper +
          0.58 * delta("waist") * waist);
    v.z =
      center.z +
      z *
        (1 +
          0.5 * delta("mass") * body +
          0.35 * delta("hips") * hip +
          0.28 * delta("waist") * waist) +
      0.39 *
        extent.z *
        delta("belly") *
        waist *
        Math.max(0.1, Math.min(1, 0.5 + z / Math.max(0.001, extent.z)));
    return v;
  }
  for (const [obj, original] of pivots) {
    obj.position.copy(obj.parent.worldToLocal(warp(original)));
    obj.updateWorldMatrix(false, true);
  }
  const inverse = new Matrix4();
  for (const [mesh, original] of meshes) {
    mesh.geometry = mesh.geometry.clone();
    const pos = mesh.geometry.attributes.position;
    inverse.copy(mesh.matrixWorld).invert();
    for (let i = 0; i < pos.count; i++) {
      point.fromBufferAttribute(pos, i).applyMatrix4(original);
      warp(point).applyMatrix4(inverse);
      pos.setXYZ(i, point.x, point.y, point.z);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
  }
}
