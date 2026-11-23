import { MathUtils } from "three";
export function validPins(pins) {
  return (
    Array.isArray(pins) &&
    pins.length <= 24 &&
    pins.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 4 &&
        p.every(Number.isFinite) &&
        p.slice(0, 3).every((n) => Math.abs(n) <= 12) &&
        p[3] >= 0.001 &&
        p[3] <= 2,
    )
  );
}
// Intersect the front surface at an exact XY position in the region's frame.
export function frontDepth(geometry, x, y) {
  const a = geometry.attributes.position,
    indices = geometry.index?.array,
    n = indices?.length ?? a.count;
  let best = -Infinity;
  for (let j = 0; j < n; j += 3) {
    const i0 = indices ? indices[j] : j,
      i1 = indices ? indices[j + 1] : j + 1,
      i2 = indices ? indices[j + 2] : j + 2;
    const ax = a.getX(i0),
      ay = a.getY(i0),
      bx = a.getX(i1),
      by = a.getY(i1),
      cx = a.getX(i2),
      cy = a.getY(i2);
    if (
      x < Math.min(ax, bx, cx) ||
      x > Math.max(ax, bx, cx) ||
      y < Math.min(ay, by, cy) ||
      y > Math.max(ay, by, cy)
    )
      continue;
    const ux = bx - ax,
      uy = by - ay,
      vx = cx - ax,
      vy = cy - ay,
      det = ux * vy - uy * vx;
    if (Math.abs(det) < 1e-13) continue;
    const dx = x - ax,
      dy = y - ay,
      u = (dx * vy - dy * vx) / det,
      v = (ux * dy - uy * dx) / det;
    if (u >= -1e-5 && v >= -1e-5 && u + v <= 1.00001)
      best = Math.max(
        best,
        a.getZ(i0) * (1 - u - v) + a.getZ(i1) * u + a.getZ(i2) * v,
      );
  }
  return Number.isFinite(best) ? best : null;
}
const weight = (dx, dy, r) => {
  const t = Math.hypot(dx, dy) / r;
  return t >= 1 ? 0 : (1 - t) ** 4 * (4 * t + 1);
};
function solve(matrix) {
  const n = matrix.length;
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let j = i + 1; j < n; j++)
      if (Math.abs(matrix[j][i]) > Math.abs(matrix[pivot][i])) pivot = j;
    [matrix[i], matrix[pivot]] = [matrix[pivot], matrix[i]];
    const row = matrix[i],
      k = row[i];
    if (Math.abs(k) < 1e-8) continue;
    for (let j = i; j <= n; j++) row[j] /= k;
    for (let j = 0; j < n; j++)
      if (j !== i) {
        const f = matrix[j][i];
        for (let col = i; col <= n; col++) matrix[j][col] -= f * row[col];
      }
  }
  return matrix.map((r) => r[n]);
}
export function fitDepth(geometry, pins, height) {
  if (!pins?.length) return geometry;
  const accepted = [];
  for (const [x, y, z, radius] of pins) {
    const depth = frontDepth(geometry, x, y);
    if (depth !== null)
      accepted.push({
        x,
        y,
        z: MathUtils.clamp(z - depth, -height * 0.17, height * 0.17),
        radius,
      });
  }
  if (!accepted.length) return geometry;
  const coefficients = solve(
    accepted.map((a, i) => [
      ...accepted.map(
        (b, j) =>
          weight(a.x - b.x, a.y - b.y, b.radius) + (i === j ? 0.015 : 0),
      ),
      a.z,
    ]),
  );
  const pos = geometry.attributes.position,
    uv = geometry.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const front = MathUtils.smoothstep(
      -Math.sin(uv.getX(i) * 2 * Math.PI),
      0,
      0.45,
    );
    if (!front) continue;
    const x = pos.getX(i),
      y = pos.getY(i);
    let change = 0;
    accepted.forEach((p, j) => {
      change += coefficients[j] * weight(x - p.x, y - p.y, p.radius);
    });
    pos.setZ(
      i,
      pos.getZ(i) +
        front * MathUtils.clamp(change, -height * 0.17, height * 0.17),
    );
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
