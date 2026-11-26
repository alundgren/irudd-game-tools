import { MathUtils, Vector3 } from "three";

export function profileTrace(points, facing = "right") {
  if (points.length < 4 || points.length > 96)
    throw new Error("Mark 4–96 points from the brow down to the chin.");
  const [x, y] = points[0],
    height = points.at(-1)[1] - y;
  if (!(height > 0))
    throw new Error("Start at the brow and finish below it at the chin.");
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
    (fit?.stage === undefined || fit.stage === "finish") &&
    (fit?.relief === undefined ||
      (fit.stage === "finish" &&
        Number.isFinite(fit.relief) &&
        fit.relief >= 0 &&
        fit.relief <= 1)) &&
    (!fit?.paint || (fit.stage === "finish" && validSidePaint(fit.paint))) &&
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
function validSidePaint(p) {
  const point = (v) =>
    Array.isArray(v) &&
    v.length === 2 &&
    v.every((n) => Number.isFinite(n) && n >= 0 && n <= 1);
  return (
    /^side-[a-f0-9]{64}$/.test(p.atlas) &&
    ["right", "left"].includes(p.facing) &&
    point(p.brow) &&
    point(p.ear) &&
    Number.isFinite(p.chinY) &&
    p.chinY > p.brow[1] + 0.025 &&
    p.chinY <= 1 &&
    (p.facing === "right" ? 1 : -1) * (p.brow[0] - p.ear[0]) > 0.02
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
export function sectionDepth(
  geometry,
  bottom,
  top,
  rows = 193,
  withWidth = false,
) {
  const pos = geometry.attributes.position,
    idx = geometry.index;
  const near = new Float64Array(rows).fill(-Infinity),
    rear = new Float64Array(rows).fill(Infinity);
  const left = withWidth ? new Float64Array(rows).fill(Infinity) : null;
  const right = withWidth ? new Float64Array(rows).fill(-Infinity) : null;
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
        const f = (bottom + row * dy - ya) / (yb - ya);
        const z = za + (zb - za) * f;
        if (withWidth) {
          const x = pos.getX(a) + (pos.getX(b) - pos.getX(a)) * f;
          left[row] = Math.min(left[row], x);
          right[row] = Math.max(right[row], x);
        }
        near[row] = Math.max(near[row], z);
        rear[row] = Math.min(rear[row], z);
      }
    }
  }
  return { near, rear, left, right };
}
export function fitHeadProfile(mesh, fit) {
  if (!fit.amount && !fit.paint) return;
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
  const { near, rear, left, right } = sectionDepth(
    g,
    bottom,
    top,
    rows,
    Boolean(fit.relief),
  );
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
  const finish = fit.stage === "finish";
  const dimension = (span * scale.y) / scale.z;
  const nasalBase = [sample(fit.curve, 0.07), sample(fit.curve, 0.55)];
  const mouthBase = [sample(fit.curve, 0.56), sample(fit.curve, 0.8)];
  const gaussian = (v) => Math.exp(-v * v);
  function rebuild(x, y, z, target, t, front) {
    const l = depth(left, y),
      r = depth(right, y);
    if (!Number.isFinite(l + r) || r <= l) return z;
    const radial = MathUtils.clamp(
      (x - (l + r) * 0.5) / ((r - l) * 0.5),
      -1,
      1,
    );
    const ax = Math.abs(radial),
      baseZ = box.min.z + 0.48 * (base - box.min.z);
    const frontWeight = MathUtils.smoothstep(
      z,
      baseZ - 0.01 * dimension,
      baseZ + 0.3 * (front - baseZ),
    );
    if (frontWeight === 0) return z;
    const nasal =
      MathUtils.smoothstep(t, -0.03, 0.13) *
      (1 - MathUtils.smoothstep(t, 0.48, 0.61));
    const oral =
      MathUtils.smoothstep(t, 0.51, 0.62) *
      (1 - MathUtils.smoothstep(t, 0.76, 0.84));
    const nr =
      base +
      dimension *
        MathUtils.lerp(...nasalBase, MathUtils.clamp((t - 0.07) / 0.48, 0, 1));
    const mr =
      base +
      dimension *
        MathUtils.lerp(...mouthBase, MathUtils.clamp((t - 0.56) / 0.24, 0, 1));
    const nose = nasal * Math.max(0, target - nr),
      lips = oral * (target - mr);
    const core = target - nose - lips;
    const width = 0.21 + 0.08 * gaussian((t - 0.43) / 0.1);
    const surface =
      baseZ +
      (core - baseZ) * Math.pow(Math.max(0, 1 - radial * radial), 0.43) +
      nose * gaussian(ax / width) +
      lips * gaussian(ax / 0.43);
    const socket = gaussian((ax - 0.4) / 0.18) * gaussian((t - 0.15) / 0.11);
    const cheek = gaussian((ax - 0.55) / 0.23) * gaussian((t - 0.39) / 0.17);
    return MathUtils.lerp(
      z,
      Math.min(target, surface + dimension * (0.037 * cheek - 0.047 * socket)),
      frontWeight,
    );
  }
  function move(px, y, z) {
    if (y <= bottom || y >= top) return [px, y, z];
    const front = depth(near, y),
      back = depth(rear, y);
    if (!Number.isFinite(front - back) || front <= back) return [px, y, z];
    const t = (brow - y) / span;
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
    const nasal = Math.exp(-(((t - 0.36) / 0.24) ** 2)),
      lip = Math.exp(-(((t - 0.65) / 0.12) ** 2));
    const width = 0.65 - 0.41 * nasal - 0.2 * lip;
    const x = Math.abs(px - midX) / Math.max(halfWidth, 1e-6);
    const lateral = Math.exp(-((x / width) ** 2));
    const weight = finish ? fraction : fraction * fraction * lateral;
    let adjusted = z + shift * weight;
    if (fit.relief)
      adjusted = MathUtils.lerp(
        adjusted,
        rebuild(px, y, z, target, t, front),
        fit.relief,
      );
    return [px, y, MathUtils.lerp(z, adjusted, fade * fit.amount)];
  }
  for (let i = 0; i < p.count; i++)
    p.setZ(i, move(p.getX(i), p.getY(i), p.getZ(i))[2]);
  p.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return { move, brow, chin, front: base, scale };
}
