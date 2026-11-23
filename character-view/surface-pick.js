import { Matrix3, Raycaster, Vector2 } from "three";
function hitRegion(hit, root) {
  let id;
  for (let o = hit.object; o; o = o.parent) {
    if (!o.visible) return null;
    id ??= o.userData.partId;
    if (o === root) break;
  }
  const owners = hit.object.blendOwners;
  if (!owners) return id;
  const scores = new Map();
  for (const j of [hit.face.a, hit.face.b, hit.face.c]) {
    const a = owners.ids[owners.first[j]],
      b = owners.ids[owners.second[j]],
      w = owners.weight[j];
    scores.set(a, (scores.get(a) ?? 0) + w);
    scores.set(b, (scores.get(b) ?? 0) + 1 - w);
  }
  return [...scores].sort((a, b) => b[1] - a[1])[0][0];
}

export function pickSurface(event, canvas, camera, root) {
  const box = canvas.getBoundingClientRect(),
    pointer = new Vector2(
      (2 * (event.clientX - box.left)) / box.width - 1,
      1 - (2 * (event.clientY - box.top)) / box.height,
    );
  const ray = new Raycaster();
  ray.setFromCamera(pointer, camera);
  for (const hit of ray.intersectObject(root, true)) {
    if (!hit.face) continue;
    const id = hitRegion(hit, root);
    if (id)
      return {
        id,
        point: hit.point,
        normal: hit.face.normal
          .clone()
          .applyMatrix3(new Matrix3().getNormalMatrix(hit.object.matrixWorld))
          .normalize(),
      };
  }
  return null;
}
