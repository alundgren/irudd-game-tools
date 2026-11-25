import { preserveArmAxes } from "./arm-section-fit.js";
import { sectionWarp } from "./section-profile.js";
import { Matrix4, Vector3 } from "three";
import { bodyFrame } from "./graft.js";

import {buildAxes} from "./recipe.js";
export {buildAxes};
const bell = (y, c, r) => Math.exp(-(((y - c) / r) ** 2));

export function sculptBuild(root, form) {
  const build = form.build;
  let fit = form.sectionProfile ? sectionWarp(form.sectionProfile) : null;
  const hasBuild = build && buildAxes.some((k) => (build[k] ?? 1) !== 1);
  if (!fit && !hasBuild) return;
  root.updateMatrixWorld(true);
  const box = bodyFrame(form),
    meshes = [],
    pivots = [];
  root.traverse((o) => {
    if (o.isMesh) {
      meshes.push([o, o.matrixWorld.clone()]);
    }
    if (o.userData.partId) pivots.push([o, o.getWorldPosition(new Vector3())]);
  });
  if (fit && form.origin?.kind === "figure") {
    const rest = new Map(
      pivots.map(([obj, point]) => [obj.userData.partId, point]),
    );
    const chains = ["left", "right"]
      .map((side) =>
        ["upper arm", "forearm", "hand"].map((region) =>
          rest.get(side + " " + region),
        ),
      )
      .filter((chain) => chain.every(Boolean));
    fit = preserveArmAxes(fit, chains, form.sectionProfile.height);
  }
  const center = box.getCenter(new Vector3()),
    extent = box.getSize(new Vector3());
  const delta = (key) => (build[key] ?? 1) - 1;
  function warp(v) {
    if (fit) fit(v);
    if (!hasBuild) return v;
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
  const normal = new Vector3(),
    tangent = new Vector3(),
    bitangent = new Vector3();
  const before = new Vector3(),
    after = new Vector3();
  const up = new Vector3(0, 1, 0),
    right = new Vector3(1, 0, 0);

  for (const [mesh, original] of meshes) {
    mesh.geometry = mesh.geometry.clone();
    const pos = mesh.geometry.attributes.position;
    inverse.copy(mesh.matrixWorld).invert();
    const normals = mesh.geometry.attributes.normal;
    const smooth = Boolean(mesh.blendOwners);
    const deform = (v) => warp(v.applyMatrix4(original)).applyMatrix4(inverse);
    for (let i = 0; i < pos.count; i++) {
      before.fromBufferAttribute(pos, i);
      after.copy(before);
      deform(after);
      if (smooth) {
        // Joined triangles are split between independently editable regions.
        // Carry the shared normal through the warp rather than shading each
        // triangle independently and leaving a faceted line at the joint.
        normal.fromBufferAttribute(normals, i).normalize();
        tangent
          .crossVectors(Math.abs(normal.y) < 0.8 ? up : right, normal)
          .normalize();
        bitangent.crossVectors(normal, tangent);
        tangent.multiplyScalar(0.0001).add(before);
        bitangent.multiplyScalar(0.0001).add(before);
        deform(tangent).sub(after);
        deform(bitangent).sub(after);
        normal.crossVectors(tangent, bitangent).normalize();
        normals.setXYZ(i, normal.x, normal.y, normal.z);
      }
      pos.setXYZ(i, after.x, after.y, after.z);
    }
    pos.needsUpdate = true;
    if (smooth) normals.needsUpdate = true;
    else mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
  }
}
