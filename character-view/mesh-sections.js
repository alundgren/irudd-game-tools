import { Vector3 } from "three";

export function triangles(root) {
  const faces = [];
  root.updateMatrixWorld(true);
  root.traverseVisible((mesh) => {
    if (!mesh.isMesh) return;
    const geom = mesh.geometry;
    const pts = Array.from({ length: geom.attributes.position.count }, (_, i) =>
      mesh.getVertexPosition(i, new Vector3()).applyMatrix4(mesh.matrixWorld),
    );
    const ix = geom.index?.array;
    for (let i = 0; i < (ix?.length ?? pts.length); i += 3) {
      const face = [0, 1, 2]
        .map((j) => pts[ix ? ix[i + j] : i + j])
        .sort((a, b) => a.y - b.y);
      if (face[0].y < face[2].y) faces.push(face);
    }
  });
  return faces;
}
export function section(faces, y, count, phase) {
  const hits = Array(count).fill(Infinity);
  for (const [a, b, c] of faces) {
    if (y < a.y || y >= c.y) continue;
    const p = y < b.y ? a : b,
      q = y < b.y ? b : c;
    const t = (y - a.y) / (c.y - a.y),
      s = (y - p.y) / (q.y - p.y);
    const x = a.x + t * (c.x - a.x),
      z = a.z + t * (c.z - a.z);
    const dx = p.x + s * (q.x - p.x) - x,
      dz = p.z + s * (q.z - p.z) - z;
    for (let i = 0; i < count; i++) {
      const angle = (2 * Math.PI * (i + phase)) / count,
        ax = Math.sin(angle),
        az = Math.cos(angle);
      const det = dx * az - dz * ax;
      if (Math.abs(det) < 1e-10) continue;
      const u = (z * ax - x * az) / det;
      if (u < 0 || u > 1) continue;
      const r = (x + u * dx) * ax + (z + u * dz) * az;
      if (r > 0.001) hits[i] = Math.min(hits[i], r);
    }
  }
  if (!hits.every(Number.isFinite))
    throw Error("Open reference section at " + y);
  return hits;
}
