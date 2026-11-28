import type { Knot, Vec3 } from "@irudd/document";

const gap = (a: Vec3, b: Vec3) =>
  ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2) ** 0.25;

const beyond = (a: Vec3, b: Vec3): Vec3 => [2 * a[0] - b[0], 2 * a[1] - b[1], 2 * a[2] - b[2]];

function centre(points: readonly Vec3[], at: number): Vec3 {
  const last = points.length - 1;
  const index = Math.min(last - 1, Math.floor(at));
  const weight = at - index;
  const p1 = points[index] ?? [0, 0, 0];
  const p2 = points[index + 1] ?? p1;
  const p0 = points[index - 1] ?? beyond(p1, p2);
  const p3 = points[index + 2] ?? beyond(p2, p1);
  let dt1 = gap(p1, p2);
  if (dt1 < 1e-4) dt1 = 1;
  let dt0 = gap(p0, p1);
  if (dt0 < 1e-4) dt0 = dt1;
  let dt2 = gap(p2, p3);
  if (dt2 < 1e-4) dt2 = dt1;
  const axis = (i: 0 | 1 | 2) => {
    const x0 = p0[i],
      x1 = p1[i],
      x2 = p2[i],
      x3 = p3[i];
    const t1 = ((x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1) * dt1;
    const t2 = ((x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2) * dt1;
    const c2 = -3 * x1 + 3 * x2 - 2 * t1 - t2,
      c3 = 2 * x1 - 2 * x2 + t1 + t2;
    return x1 + t1 * weight + c2 * weight ** 2 + c3 * weight ** 3;
  };
  return [axis(0), axis(1), axis(2)];
}

function radius(knots: readonly Knot[], left: number, t: number, k: 3 | 4): number {
  const at = (i: number) => knots[i]?.[k] ?? 0;
  const a = at(left),
    b = at(left + 1),
    delta = b - a;
  const slope = (u: number, v: number) => (u * v <= 0 ? 0 : (2 * u * v) / (u + v));
  const da = left ? slope(a - at(left - 1), delta) : delta;
  const db = left + 2 < knots.length ? slope(delta, at(left + 2) - b) : delta;
  const t2 = t * t,
    t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * a + (t3 - 2 * t2 + t) * da + (-2 * t3 + 3 * t2) * b + (t3 - t2) * db
  );
}

export function resampleKnots(knots: readonly Knot[], count: number): Knot[] {
  if (knots.length < 2 || count <= knots.length) return knots.map((k): Knot => [...k]);
  const points = knots.map(([x, y, z]): Vec3 => [x, y, z]);
  return Array.from({ length: count }, (_, j): Knot => {
    const at = (j / (count - 1)) * (knots.length - 1);
    const left = Math.min(knots.length - 2, Math.floor(at));
    const mix = at - left;
    const [x, y, z] = centre(points, at);
    return [x, y, z, radius(knots, left, mix, 3), radius(knots, left, mix, 4)];
  });
}
