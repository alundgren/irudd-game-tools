export function meet(
  pos: ArrayLike<number>,
  a: number,
  b: number,
  c: number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
): number {
  const g = (i: number) => pos[i] ?? 0;
  const e1x = g(b) - g(a);
  const e1y = g(b + 1) - g(a + 1);
  const e1z = g(b + 2) - g(a + 2);
  const e2x = g(c) - g(a);
  const e2y = g(c + 1) - g(a + 1);
  const e2z = g(c + 2) - g(a + 2);
  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return Infinity;
  const tx = ox - g(a);
  const ty = oy - g(a + 1);
  const tz = oz - g(a + 2);
  const u = (tx * px + ty * py + tz * pz) / det;
  if (u < 0 || u > 1) return Infinity;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) / det;
  if (v < 0 || u + v > 1) return Infinity;
  const d = (e2x * qx + e2y * qy + e2z * qz) / det;
  return d > 1e-6 ? d : Infinity;
}

export type Ray = (
  origin: readonly number[],
  direction: readonly number[],
  maxDistance?: number,
) => number;

export function raycaster(pos: ArrayLike<number>, tri: ArrayLike<number>, cell = 0.03): Ray {
  const count = tri.length / 3;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  if (!count) return () => Infinity;
  const P = (i: number) => pos[i] ?? 0;
  const V = (t: number) => tri[t] ?? 0;
  const L = (d: number) => lo[d] ?? 0;
  const H = (d: number) => hi[d] ?? 0;
  for (let t = 0; t < tri.length; t++)
    for (let d = 0; d < 3; d++) {
      const x = P(V(t) * 3 + d);
      if (x < L(d)) lo[d] = x;
      if (x > H(d)) hi[d] = x;
    }
  const size = [0, 1, 2].map((d) => Math.max(1, Math.min(48, Math.ceil((H(d) - L(d)) / cell))));
  const S = (d: number) => size[d] ?? 1;
  const step = [0, 1, 2].map((d) => (H(d) - L(d)) / S(d) || 1e-9);
  const St = (d: number) => step[d] ?? 1e-9;
  const cells = Array.from<number[] | undefined>({ length: S(0) * S(1) * S(2) });
  const at = (x: number, d: number) =>
    Math.max(0, Math.min(S(d) - 1, Math.floor((x - L(d)) / St(d))));
  for (let t = 0; t < tri.length; t += 3) {
    const from = [0, 0, 0];
    const to = [0, 0, 0];
    for (let d = 0; d < 3; d++) {
      const a = P(V(t) * 3 + d);
      const b = P(V(t + 1) * 3 + d);
      const c = P(V(t + 2) * 3 + d);
      from[d] = at(Math.min(a, b, c), d);
      to[d] = at(Math.max(a, b, c), d);
    }
    for (let x = from[0] ?? 0; x <= (to[0] ?? 0); x++)
      for (let y = from[1] ?? 0; y <= (to[1] ?? 0); y++)
        for (let z = from[2] ?? 0; z <= (to[2] ?? 0); z++) {
          const key = x + S(0) * (y + S(1) * z);
          (cells[key] ??= []).push(t);
        }
  }
  const seen = new Uint32Array(count);
  let stamp = 0;
  return (origin, direction, maxDistance = Infinity) => {
    let enter = 0;
    let leave = maxDistance;
    const O = (d: number) => origin[d] ?? 0;
    const D = (d: number) => direction[d] ?? 0;
    for (let d = 0; d < 3; d++) {
      if (Math.abs(D(d)) < 1e-12) {
        if (O(d) < L(d) - 1e-9 || O(d) > H(d) + 1e-9) return Infinity;
        continue;
      }
      const a = (L(d) - O(d)) / D(d);
      const b = (H(d) - O(d)) / D(d);
      enter = Math.max(enter, Math.min(a, b));
      leave = Math.min(leave, Math.max(a, b));
    }
    if (enter > leave) return Infinity;
    stamp++;
    const c = [0, 0, 0];
    const way = [0, 0, 0];
    const edge = [Infinity, Infinity, Infinity];
    const stride = [Infinity, Infinity, Infinity];
    const [ox, oy, oz] = [O(0), O(1), O(2)];
    const [dx, dy, dz] = [D(0), D(1), D(2)];
    for (let d = 0; d < 3; d++) {
      c[d] = at(O(d) + D(d) * enter, d);
      if (Math.abs(D(d)) < 1e-12) continue;
      way[d] = D(d) > 0 ? 1 : -1;
      stride[d] = St(d) / Math.abs(D(d));
      edge[d] = (L(d) + ((c[d] ?? 0) + ((way[d] ?? 0) > 0 ? 1 : 0)) * St(d) - O(d)) / D(d);
    }
    let best = Infinity;
    const E = (d: number) => edge[d] ?? Infinity;
    for (;;) {
      const list = cells[(c[0] ?? 0) + S(0) * ((c[1] ?? 0) + S(1) * (c[2] ?? 0))];
      if (list)
        for (const t of list) {
          if (seen[t / 3] === stamp) continue;
          seen[t / 3] = stamp;
          const d = meet(pos, V(t) * 3, V(t + 1) * 3, V(t + 2) * 3, ox, oy, oz, dx, dy, dz);
          if (d < best) best = d;
        }
      const axis = E(0) < E(1) ? (E(0) < E(2) ? 0 : 2) : E(1) < E(2) ? 1 : 2;
      if (best <= E(axis) || E(axis) >= leave) return best <= maxDistance ? best : Infinity;
      c[axis] = (c[axis] ?? 0) + (way[axis] ?? 0);
      const ca = c[axis] ?? 0;
      if (way[axis] === 0 || ca < 0 || ca >= S(axis)) return best <= maxDistance ? best : Infinity;
      edge[axis] = E(axis) + (stride[axis] ?? Infinity);
    }
  };
}
