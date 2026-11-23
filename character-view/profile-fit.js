import { MathUtils, Vector3 } from "three";

// The first point is the brow. The last is the front of the lower chin.
// Depth is measured forward from the brow in units of brow-to-chin height.
export function profileTrace(points, facing = "right") {
  if (points.length < 4 || points.length > 96)
    throw new Error("Mark 4–96 points from the brow down to the chin.");
  const [x, y] = points[0],
    height = points.at(-1)[1] - y;
  if (!(height > 0)) throw new Error("Start at the brow and finish below it at the chin.");
  const curve = points.map(([px, py]) => [
    (py - y) / height,
    px === x ? 0 : ((px - x) / height) * (facing === "left" ? -1 : 1),
  ]);
  const fit = { curve, amount: 1 };
  if (!validProfile(fit))
    throw new Error(
      "Follow the edge downwards, with a new height at every point.",
    );
  return fit;
}
export function validProfile(fit) {
  const c = fit?.curve;
  return (
    Array.isArray(c) &&
    c.length >= 4 &&
    c.length <= 96 &&
    Number.isFinite(fit.amount) &&
    fit.amount >= 0 &&
    fit.amount <= 1 &&
    c.every(
      (p, i) =>
        Array.isArray(p) &&
        p.length === 2 &&
        p.every(Number.isFinite) &&
        Math.abs(p[1]) <= 1 &&
        (!i || p[0] > c[i - 1][0]),
    ) &&
    c[0][0] === 0 &&
    c[0][1] === 0 &&
    c.at(-1)[0] === 1
  );
}
function sample(curve, t) {
  if (t <= 0) return curve[0][1];
  const i = curve.findIndex((p) => p[0] >= t);
  if (i < 0) return curve.at(-1)[1];
  const a = curve[i - 1],
    b = curve[i];
  return MathUtils.lerp(a[1], b[1], (t - a[0]) / (b[0] - a[0]));
}
// Sample intersections of triangle edges with horizontal planes. Projected
// depth includes the nose tip or lips even on an irregular imported portrait.
export function sectionDepth(geometry, bottom, top, rows = 193) {
  const pos = geometry.attributes.position,
    idx = geometry.index;
  const near = new Float64Array(rows).fill(-Infinity),
    rear = new Float64Array(rows).fill(Infinity);
  const dy = (top - bottom) / (rows - 1);
  for (let i = 0, n = idx?.count ?? pos.count; i < n; i += 3) {
    for (let k = 0; k < 3; k++) {
      let a = idx ? idx.getX(i + k) : i + k,
        b = idx ? idx.getX(i + ((k + 1) % 3)) : i + ((k + 1) % 3);
      if (pos.getY(a) > pos.getY(b)) [a, b] = [b, a];
      const ya = pos.getY(a),
        yb = pos.getY(b),
        za = pos.getZ(a),
        zb = pos.getZ(b);
      if (yb === ya) continue;
      const first = Math.max(0, Math.ceil((ya - bottom) / dy - 1e-8)),
        last = Math.min(rows - 1, Math.floor((yb - bottom) / dy + 1e-8));
      for (let row = first; row <= last; row++) {
        const z = za + (zb - za) * ((bottom + row * dy - ya) / (yb - ya));
        near[row] = Math.max(near[row], z);
        rear[row] = Math.min(rear[row], z);
      }
    }
  }
  return { near, rear };
}
export function fitHeadProfile(mesh, fit) {
  if (!fit.amount) return;
  const g = mesh.geometry;
  g.computeBoundingBox();
  const box = g.boundingBox,
    height = box.max.y - box.min.y;
  const binding = mesh.facePaint,
    marks = binding?.portrait;
  const brow = marks
    ? (marks.eyes + 0.067) * binding.height - binding.offset[1]
    : box.min.y + 0.66 * height;
  const chin = marks
    ? (marks.chin + 0.045) * binding.height - binding.offset[1]
    : box.min.y + 0.055 * height;
  const span = brow - chin;
  if (span <= 0) return;
  const scale = mesh.getWorldScale(new Vector3());
  const rows = 193,
    pad = 0.13 * span;
  const bottom = Math.max(box.min.y + height * 0.002, chin - pad),
    top = Math.min(box.max.y - height * 0.002, brow + pad);
  if (brow >= top || chin <= bottom) return;
  const { near, rear } = sectionDepth(g, bottom, top, rows);
  const rowAt = (y) =>
    MathUtils.clamp(((y - bottom) / (top - bottom)) * (rows - 1), 0, rows - 1);
  function depth(values, y) {
    const r = rowAt(y),
      lo = Math.floor(r),
      hi = Math.ceil(r);
    return MathUtils.lerp(values[lo], values[hi], r - lo);
  }
  const base = depth(near, brow);
  if (!Number.isFinite(base)) return;
  const p = g.attributes.position;
  const midX = (box.min.x + box.max.x) * 0.5,
    halfWidth = (box.max.x - box.min.x) * 0.5;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y <= bottom || y >= top) continue;
    const front = depth(near, y),
      back = depth(rear, y);
    if (!Number.isFinite(front - back) || front <= back) continue;
    const t = (brow - y) / span,
      z = p.getZ(i);
    const edgeY = MathUtils.clamp(y, chin, brow);
    const target = base + (sample(fit.curve, t) * span * scale.y) / scale.z;
    const fade =
      y < chin
        ? MathUtils.smoothstep(y, bottom, chin)
        : y > brow
          ? 1 - MathUtils.smoothstep(y, brow, top)
          : 1;
    const pivot = back + 0.43 * (front - back);
    const fraction = MathUtils.clamp((z - pivot) / (front - pivot), 0, 1);
    const shift = MathUtils.clamp(
      target - depth(near, edgeY),
      -0.62 * (front - pivot),
      0.85 * (front - back),
    );
    // A changed lip or nose edge should taper across the central face.
    // Brow and jaw occupy more of the head width than the bridge and lips.
    const nasal = Math.exp(-(((t - 0.36) / 0.24) ** 2)),
      lip = Math.exp(-(((t - 0.65) / 0.12) ** 2));
    const width = 0.65 - 0.41 * nasal - 0.2 * lip;
    const x = Math.abs(p.getX(i) - midX) / Math.max(halfWidth, 1e-6);
    const lateral = Math.exp(-((x / width) ** 2));
    p.setZ(i, z + shift * fraction * fraction * lateral * fade * fit.amount);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
}
