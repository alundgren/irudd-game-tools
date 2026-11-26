export function validRadialFit(fit) {
  return (
    fit &&
    Number.isFinite(fit.bottom) &&
    Math.abs(fit.bottom) <= 3 &&
    Number.isFinite(fit.step) &&
    fit.step >= 0.003 &&
    fit.step <= 0.2 &&
    Array.isArray(fit.rows) &&
    fit.rows.length >= 3 &&
    fit.rows.length <= 48 &&
    Array.isArray(fit.rows[0]) &&
    fit.rows[0].length >= 8 &&
    fit.rows[0].length <= 64 &&
    fit.rows.every(
      (row, i) =>
        Array.isArray(row) &&
        row.length === fit.rows[0].length &&
        row.every(
          (n) =>
            Number.isFinite(n) &&
            Math.abs(n) <= 0.12 &&
            ((i !== 0 && i !== fit.rows.length - 1) || n === 0),
        ),
    )
  );
}

export function applyRadialFit(geometry, fit) {
  const pos = geometry.attributes.position,
    { rows, step, bottom } = fit;
  const count = rows[0].length;
  for (let i = 0; i < pos.count; i++) {
    const h = (pos.getY(i) - bottom) / step,
      level = Math.floor(h);
    if (level < 0 || level >= rows.length - 1) continue;
    const x = pos.getX(i),
      z = pos.getZ(i),
      radius = Math.hypot(x, z);
    if (radius < 0.001) continue;
    const u = ((Math.atan2(x, z) / (2 * Math.PI) + 1) % 1) * count;
    const a = Math.floor(u),
      b = (a + 1) % count,
      f = u - a;
    const low = rows[level][a] * (1 - f) + rows[level][b] * f;
    const high = rows[level + 1][a] * (1 - f) + rows[level + 1][b] * f;
    const delta = low + (high - low) * (h - level);
    const scale = Math.max(0.001, radius + delta) / radius;
    pos.setXYZ(i, x * scale, pos.getY(i), z * scale);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}
