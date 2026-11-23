import { addEyelids } from "./eyelids.js";
import { Float32BufferAttribute, MathUtils, Matrix3, Vector3 } from "three";
export const expressions = ["Blink", "Smile", "BrowLift"];
const bell = (v, r) => Math.exp(-((v / r) ** 2));

function buildTargets(mesh) {
  if (mesh.geometry.morphAttributes.position?.length) {
    if (!mesh.morphTargetDictionary) mesh.updateMorphTargets();
    return;
  }
  const lids = addEyelids(mesh),
    geometry = mesh.geometry;
  geometry.computeBoundingBox();
  const pos = geometry.attributes.position,
    normal = geometry.attributes.normal,
    box = geometry.boundingBox;
  const size = box.getSize(new Vector3()),
    centre = box.getCenter(new Vector3()),
    paint = mesh.facePaint,
    face = paint?.portrait;
  const h = face ? paint.height : size.y,
    eyeY = face?.eyes ?? 0.566,
    mouthY = face?.mouth ?? 0.25;
  const changes = expressions.map(() => new Float32Array(pos.count * 3));
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i),
      py = pos.getY(i),
      pz = pos.getZ(i);
    const x = face
      ? ((px + paint.offset[0]) / h - face.center) / face.width
      : (px - centre.x) / (size.x * 0.5 || 1);
    const y = face ? (py + paint.offset[1]) / h : (py - box.min.y) / (h || 1);
    const front = MathUtils.smoothstep(
      (pz - centre.z) / (size.z * 0.5 || 1),
      0.02,
      0.66,
    );
    if (!front) continue;
    const ex = (Math.abs(x) - 0.425) / 0.26,
      ey = y - eyeY - 0.008 * ex,
      side = Math.sign(x);
    const aperture =
      (1 - MathUtils.smoothstep(Math.abs(ex), 0.72, 1.18)) * front;
    const lid =
      aperture * (1 - MathUtils.smoothstep(Math.abs(ey), 0.033, 0.082));
    changes[0][3 * i + 1] = h * (-0.006 - ey * (lids ? 0.14 : 0.88)) * lid;
    changes[0][3 * i + 2] = h * 0.004 * lid;
    const mouth = front * bell(y - mouthY, 0.07),
      corners = bell(Math.abs(x) - 0.33, 0.19) * mouth;
    changes[1][3 * i] = h * 0.017 * side * corners;
    changes[1][3 * i + 1] =
      h *
      (0.021 * corners +
        0.009 *
          front *
          bell(Math.abs(x) - 0.53, 0.22) *
          bell(y - (mouthY + 0.11), 0.13));
    changes[1][3 * i + 2] = -h * 0.01 * corners;
    const brow =
      front * bell(Math.abs(x) - 0.425, 0.32) * bell(y - (eyeY + 0.066), 0.05);
    changes[2][3 * i + 1] = h * 0.046 * brow;
    changes[2][3 * i + 2] = h * 0.007 * brow;
  }
  if (lids) changes[0].set(lids.delta, lids.start * 3);
  const normalTargets = [];
  const positionTargets = changes.map((array, j) => {
    const attr = new Float32BufferAttribute(array, 3);
    attr.name = expressions[j];
    const sample = geometry.clone(),
      changed = sample.attributes.position;
    for (let i = 0; i < changed.count; i++)
      changed.setXYZ(
        i,
        pos.getX(i) + array[3 * i],
        pos.getY(i) + array[3 * i + 1],
        pos.getZ(i) + array[3 * i + 2],
      );
    sample.computeVertexNormals();
    const target = sample.attributes.normal;
    const delta = new Float32Array(normal.count * 3);
    for (let i = 0; i < normal.count; i++) {
      delta[3 * i] = target.getX(i) - normal.getX(i);
      delta[3 * i + 1] = target.getY(i) - normal.getY(i);
      delta[3 * i + 2] = target.getZ(i) - normal.getZ(i);
    }
    const norm = new Float32BufferAttribute(delta, 3);
    norm.name = expressions[j];
    normalTargets.push(norm);
    sample.dispose();
    return attr;
  });
  geometry.morphTargetsRelative = true;
  geometry.morphAttributes.position = positionTargets;
  geometry.morphAttributes.normal = normalTargets;
  mesh.updateMorphTargets();
}
export function prepareExpressions(root) {
  root.traverse((o) => {
    if (o.isMesh && o.userData.faceSurface) buildTargets(o);
  });
}
export function poseExpression(root, name, strength = 1) {
  if (!root) return;
  if (name && name !== "Rest") prepareExpressions(root);
  root.traverse((o) => {
    if (!o.morphTargetDictionary) return;
    for (const k of expressions) {
      const index = o.morphTargetDictionary[k];
      if (index !== undefined)
        o.morphTargetInfluences[index] = k === name ? strength : 0;
    }
  });
}
// The skin is exported in world coordinates. Transform pose displacements as
// vectors, and rebuild each normal delta against the transformed rest normal.
export function worldMorphs(geometry, source) {
  if (!geometry.morphAttributes.position?.length) return;
  const linear = new Matrix3().setFromMatrix4(source.matrixWorld);
  const normalMatrix = new Matrix3().getNormalMatrix(source.matrixWorld);
  const v = new Vector3(),
    rest = new Vector3(),
    localRest = source.geometry.attributes.normal;
  for (const p of geometry.morphAttributes.position)
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix3(linear);
      p.setXYZ(i, v.x, v.y, v.z);
    }
  for (const p of geometry.morphAttributes.normal ?? [])
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i)
        .add(rest.fromBufferAttribute(localRest, i))
        .applyNormalMatrix(normalMatrix);
      v.sub(rest.fromBufferAttribute(geometry.attributes.normal, i));
      p.setXYZ(i, v.x, v.y, v.z);
    }
}
