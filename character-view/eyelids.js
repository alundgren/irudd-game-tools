import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// Query the front surface and its painted UV at facial landmarks. Spatial
// buckets make sampling two moving eyelids independent of face tessellation.
function projector(g) {
  const pos = g.attributes.position,
    uv = g.attributes.uv,
    idx = g.index;
  const min = g.boundingBox.min,
    span = g.boundingBox.getSize(new Vector3());
  const n = 36,
    buckets = Array.from({ length: n * n }, () => []);
  const cell = (v, low, width) =>
    Math.max(0, Math.min(n - 1, Math.floor(((v - low) / width) * n)));
  for (let k = 0; k < (idx?.count ?? pos.count); k += 3) {
    const a = idx ? idx.getX(k) : k,
      b = idx ? idx.getX(k + 1) : k + 1,
      c = idx ? idx.getX(k + 2) : k + 2;
    const ax = pos.getX(a),
      ay = pos.getY(a),
      bx = pos.getX(b),
      by = pos.getY(b),
      cx = pos.getX(c),
      cy = pos.getY(c);
    const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (det < 1e-10) continue;
    const tri = {
      a,
      b,
      c,
      ax,
      ay,
      dx: bx - ax,
      dy: by - ay,
      ex: cx - ax,
      ey: cy - ay,
      det,
    };
    const x0 = cell(Math.min(ax, bx, cx), min.x, span.x),
      x1 = cell(Math.max(ax, bx, cx), min.x, span.x);
    const y0 = cell(Math.min(ay, by, cy), min.y, span.y),
      y1 = cell(Math.max(ay, by, cy), min.y, span.y);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) buckets[x + n * y].push(tri);
  }
  return (x, y) => {
    let best;
    const list = buckets[cell(x, min.x, span.x) + n * cell(y, min.y, span.y)];
    for (const { a, b, c, ax, ay, dx, dy, ex, ey, det } of list) {
      const s = ((x - ax) * ey - (y - ay) * ex) / det,
        t = (dx * (y - ay) - dy * (x - ax)) / det;
      if (s < -0.00001 || t < -0.00001 || s + t > 1.00001) continue;
      const u = 1 - s - t,
        z = u * pos.getZ(a) + s * pos.getZ(b) + t * pos.getZ(c);
      if (!best || z > best.z)
        best = {
          z,
          u: u * uv.getX(a) + s * uv.getX(b) + t * uv.getX(c),
          v: u * uv.getY(a) + s * uv.getY(b) + t * uv.getY(c),
        };
    }
    return best;
  };
}
export function addEyelids(mesh) {
  const g = mesh.geometry;
  g.computeBoundingBox();
  const b = g.boundingBox,
    dim = b.getSize(new Vector3()),
    c = b.getCenter(new Vector3()),
    paint = mesh.facePaint,
    face = paint?.portrait;
  const h = face ? paint.height : dim.y,
    half = face ? face.width * h : dim.x * 0.5;
  const cx = face ? face.center * h - paint.offset[0] : c.x;
  const y = face ? face.eyes * h - paint.offset[1] : b.min.y + 0.566 * h,
    probe = projector(g);
  const p = [],
    uv = [],
    delta = [],
    indices = [],
    columns = 26,
    rows = 7;
  const span = 0.249 * half,
    along = 0.425 * half;
  for (const sign of [-1, 1]) {
    const start = p.length / 3;
    for (let j = 0; j <= rows; j++)
      for (let i = 0; i <= columns; i++) {
        const t = j / rows,
          u = (i / columns) * 2 - 1,
          arc = Math.sqrt(Math.max(0.001, 1 - u * u)),
          x = cx + sign * along + span * u;
        const eyeLine = y + h * (0.005 * sign * u);
        const upper = eyeLine + h * 0.03 * arc,
          lower = eyeLine - h * 0.032 * arc;
        const restY = upper + h * (0.006 - 0.004 * t) * arc,
          closedY = upper + (lower - upper) * t;
        const a = probe(x, restY),
          b = probe(x, closedY),
          skin = probe(x, eyeLine - h * (0.055 + 0.019 * t) * arc - 0.012 * h);
        if (!a || !b || !skin) return null;
        const restZ = a.z - h * 0.004,
          closedZ = b.z + h * (0.01 + 0.012 * Math.sin(Math.PI * t) * arc);
        p.push(x, restY, restZ);
        delta.push(0, closedY - restY, closedZ - restZ);
        uv.push(skin.u, skin.v);
        if (j < rows && i < columns) {
          const k = start + j * (columns + 1) + i,
            next = k + columns + 1;
          indices.push(k, next, k + 1, k + 1, next, next + 1);
        }
      }
  }
  const lids = new BufferGeometry();
  lids.setAttribute("position", new Float32BufferAttribute(p, 3));
  lids.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  lids.setIndex(indices);
  lids.computeVertexNormals();
  const merged = mergeGeometries([g, lids]);
  lids.dispose();
  if (!merged) return null;
  mesh.geometry = merged;
  g.dispose();
  merged.computeBoundingBox();
  return { start: g.attributes.position.count, delta };
}
