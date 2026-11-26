import { Vector3 } from "three";

export function headFitSupport(surface, controls, anchors) {
  const head = surface.names.indexOf("head");
  const radius = (0.036 * surface.height) / 1.72;
  const radiusSq = radius * radius;
  const ids = anchors.filter(
    (i) => surface.boneIndices[controls.ids[i] * 4] === head,
  );
  return ids.map((i) => {
    const p = controls.ids[i] * 3,
      near = [];
    let total = 0;
    for (const j of ids) {
      const q = controls.ids[j] * 3;
      let d2 = 0;
      for (let k = 0; k < 3; k++)
        d2 += (surface.positions[p + k] - surface.positions[q + k]) ** 2;
      if (d2 >= radiusSq) continue;
      const weight = (1 - d2 / radiusSq) ** 3;
      near.push([j, weight]);
      total += weight;
    }
    return { i, near, total };
  });
}

export const fitOffsetLimit = 0.0649;

export function smoothHeadFit(vectors, initial, support, observed) {
  if (!support.length) return;
  const candidate = vectors.slice();
  const offset = new Vector3();
  for (const { i, near, total } of support) {
    if (observed && !observed.has(i)) continue;
    for (let axis = 0; axis < 3; axis++) {
      let movement = 0;
      for (const [j, weight] of near) {
        const k = j * 3 + axis;
        movement += weight * (candidate[k] - initial[k]);
      }
      const k = i * 3 + axis;
      vectors[k] = initial[k] + movement / total;
    }
    offset.fromArray(vectors, i * 3).clampLength(0, fitOffsetLimit).toArray(vectors, i * 3);
  }
}

export function headFitDistortion(before, after, onFold) {
  const head = before.names.indexOf("head");
  let triangles = 0,
    pastPerpendicular = 0;
  const a = new Vector3(),
    b = new Vector3(),
    c = new Vector3();
  const oldNormal = new Vector3(),
    newNormal = new Vector3();
  function normal(positions, i, j, k, out) {
    a.fromArray(positions, i * 3);
    b.fromArray(positions, j * 3).sub(a);
    c.fromArray(positions, k * 3).sub(a);
    return out.crossVectors(b, c);
  }
  for (let face = 0; face < before.bodyTriangles * 3; face += 3) {
    const i = before.indices[face],
      j = before.indices[face + 1],
      k = before.indices[face + 2];
    if (
      before.boneIndices[i * 4] !== head ||
      before.boneIndices[j * 4] !== head ||
      before.boneIndices[k * 4] !== head
    )
      continue;
    normal(before.positions, i, j, k, oldNormal);
    if (oldNormal.lengthSq() < (2 * 0.25e-6) ** 2) continue;
    normal(after.positions, i, j, k, newNormal);
    triangles++;
    if (oldNormal.dot(newNormal) <= 0) {
      pastPerpendicular++;
      onFold?.(i,j,k,face / 3);
    }
  }
  return { triangles, pastPerpendicular };
}
