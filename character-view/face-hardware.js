import { Matrix4, Vector3 } from "three";

function depthSampler(geometry) {
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox,
    p = geometry.attributes.position,
    index = geometry.index;
  const count = 32,
    cells = Array.from({ length: count * count }, () => []);
  const col = (x) =>
    Math.max(
      0,
      Math.min(
        count - 1,
        Math.floor(((x - min.x) * count) / (max.x - min.x || 1)),
      ),
    );
  const row = (y) =>
    Math.max(
      0,
      Math.min(
        count - 1,
        Math.floor(((y - min.y) * count) / (max.y - min.y || 1)),
      ),
    );
  for (let i = 0, n = index?.count ?? p.count; i < n; i += 3) {
    const a = index ? index.getX(i) : i,
      b = index ? index.getX(i + 1) : i + 1,
      c = index ? index.getX(i + 2) : i + 2;
    const x = p.getX(a),
      y = p.getY(a),
      z = p.getZ(a);
    const ux = p.getX(b) - x,
      uy = p.getY(b) - y,
      vx = p.getX(c) - x,
      vy = p.getY(c) - y,
      det = ux * vy - uy * vx;
    if (Math.abs(det) < 1e-14) continue;
    const tri = {
      x,
      y,
      z,
      ux,
      uy,
      vx,
      vy,
      det,
      uz: p.getZ(b) - z,
      vz: p.getZ(c) - z,
    };
    const right = col(Math.max(x, x + ux, x + vx)),
      top = row(Math.max(y, y + uy, y + vy));
    for (let j = row(Math.min(y, y + uy, y + vy)); j <= top; j++)
      for (let k = col(Math.min(x, x + ux, x + vx)); k <= right; k++)
        cells[j * count + k].push(tri);
  }
  return (x, y) => {
    let result = -Infinity;
    for (const t of cells[row(y) * count + col(x)]) {
      const dx = x - t.x,
        dy = y - t.y,
        u = (dx * t.vy - dy * t.vx) / t.det,
        v = (dy * t.ux - dx * t.uy) / t.det;
      if (u >= -1e-7 && v >= -1e-7 && u + v <= 1.0000001)
        result = Math.max(result, t.z + u * t.uz + v * t.vz);
    }
    return result;
  };
}
export function clearFaceHardware(face, pieces) {
  const groups = new Map();
  for (const { part, object } of pieces) {
    if (!part.rigidFaceAnchor) continue;
    const key = part.rigidFaceAnchor.join(",");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ object, clearance: part.faceClearance });
  }
  let sample;
  face.updateWorldMatrix(true, false);
  const inverse = face.matrixWorld.clone().invert(),
    unit = face.getWorldScale(new Vector3()).z;
  for (const group of groups.values()) {
    if (!group.some((p) => p.clearance !== undefined)) continue;
    sample ??= depthSampler(face.geometry);
    const meshes = [],
      point = new Vector3();
    let lift = -Infinity,
      frontLimit = Infinity;
    for (const { object, clearance } of group) {
      const branch = { rear: Infinity, front: clearance !== undefined };
      function visit(m) {
        if (!m.visible) return;
        if (m.isMesh) {
          m.updateWorldMatrix(true, false);
          const toFace = new Matrix4().multiplyMatrices(inverse, m.matrixWorld);
          const pos = m.geometry.attributes.position;
          let minZ = Infinity;
          for (let i = 0; i < pos.count; i++) {
            point.fromBufferAttribute(pos, i).applyMatrix4(toFace);
            minZ = Math.min(minZ, point.z);
            if (clearance !== undefined)
              lift = Math.max(
                lift,
                sample(point.x, point.y) + clearance / unit - point.z,
              );
          }
          if (clearance !== undefined) frontLimit = Math.min(frontLimit, minZ);
          branch.rear = Math.min(branch.rear, minZ);
          meshes.push({ m, toFace, branch });
        }
        for (const child of m.children) visit(child);
      }
      visit(object);
    }
    if (!Number.isFinite(lift) || Math.abs(lift) < 1e-7) continue;
    for (const { m, toFace, branch } of meshes) {
      const { rear: minZ, front } = branch;
      m.geometry = m.geometry.clone();
      const g = m.geometry,
        pos = g.attributes.position,
        fromFace = toFace.clone().invert();
      for (let i = 0; i < pos.count; i++) {
        point.fromBufferAttribute(pos, i).applyMatrix4(toFace);
        const fraction =
          front || minZ >= frontLimit
            ? 1
            : Math.max(0, Math.min(1, (point.z - minZ) / (frontLimit - minZ)));
        point.z += lift * fraction;
        point.applyMatrix4(fromFace);
        pos.setXYZ(i, point.x, point.y, point.z);
      }
      pos.needsUpdate = true;
      g.computeVertexNormals();
      g.computeBoundingBox();
      g.computeBoundingSphere();
    }
  }
}
