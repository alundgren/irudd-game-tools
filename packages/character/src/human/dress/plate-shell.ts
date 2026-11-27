import {
  Piece,
  Shell,
  add,
  at,
  clamp,
  cross,
  cut,
  dot,
  length,
  lerp3,
  loops,
  mix,
  smooth,
  sub,
  topology,
  unit,
  type Skin,
  type Vec,
} from "./kit.js";
export const field = (s: Shell, key: string, i: number) => s.f[key]?.[i] ?? 0;
export function clear(s: Shell, shells: ReadonlyArray<Shell>, margin: number): void {
  if (!shells.length) return;
  const cell = 0.024,
    grid = new Map<string, Array<readonly [number, number, number, number]>>(),
    key = (x: number, y: number, z: number) =>
      Math.floor(x / cell) + "," + Math.floor(y / cell) + "," + Math.floor(z / cell);
  for (const under of shells)
    for (let i = 0; i < under.count; i++) {
      const a = under.anchor(i),
        k = key(a[0], a[1], a[2]),
        d = dot(sub(under.at(i), a), under.normal(i));
      let list = grid.get(k);
      if (!list) grid.set(k, (list = []));
      list.push([a[0], a[1], a[2], d]);
    }
  for (let i = 0; i < s.count; i++) {
    const a = s.anchor(i),
      n = s.normal(i);
    let most = -Infinity;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          for (const [x, y, z, d] of grid.get(
            key(a[0] + dx * cell, a[1] + dy * cell, a[2] + dz * cell),
          ) ?? [])
            if ((x - a[0]) ** 2 + (y - a[1]) ** 2 + (z - a[2]) ** 2 < 0.022 ** 2)
              most = Math.max(most, d);
    const d = dot(sub(s.at(i), a), n);
    if (d < most + margin) s.set(i, add(s.at(i), n, most + margin - d));
  }
}

function edgeDistance(s: Shell, limit: number, only?: ((i: number) => boolean) | null) {
  const near = topology(s).neighbours,
    far = new Float32Array(s.count).fill(9),
    queue: number[] = [];
  for (const loop of loops(s))
    for (const i of loop)
      if (!only || only(i)) {
        far[i] = 0;
        queue.push(i);
      }
  for (let head = 0; head < queue.length; head++) {
    const i = at(queue, head),
      start = at(far, i);
    if (start > limit) continue;
    for (const j of near[i] ?? []) {
      const d = start + length(sub(s.at(i), s.at(j)));
      if (d < at(far, j) - 1e-6) {
        far[j] = d;
        queue.push(j);
      }
    }
  }
  return far;
}
export function solid(piece: Piece, s: Shell, { thickness = 0.003, lining = 0.03 } = {}) {
  const base = piece.count,
    n = s.count,
    far = Number.isFinite(lining) ? edgeDistance(s, lining * 1.3) : null;
  for (let i = 0; i < n; i++) piece.vertex(s.at(i), s.skin(i));
  for (let i = 0; i < n; i++) piece.vertex(add(s.at(i), s.normal(i), -thickness), s.skin(i));
  for (let t = 0; t < s.tri.length; t += 3) {
    const a = at(s.tri, t),
      b = at(s.tri, t + 1),
      c = at(s.tri, t + 2);
    piece.tri.push(base + a, base + b, base + c);
    if (!far || (at(far, a) < lining && at(far, b) < lining && at(far, c) < lining))
      piece.tri.push(base + n + a, base + n + c, base + n + b);
  }
  for (const loop of loops(s))
    for (let j = 0; j < loop.length; j++) {
      const a = at(loop, j),
        b = at(loop, (j + 1) % loop.length);
      piece.tri.push(base + a, base + n + a, base + n + b, base + a, base + n + b, base + b);
    }
  return piece;
}
interface Border {
  width: number;
  rise: number;
  thickness: number;
  only: ((i: number) => boolean) | null;
  measure: ((i: number) => number) | null;
}
export function edging(piece: Piece, s: Shell, { width, rise, thickness, only, measure }: Border) {
  let far = measure
    ? Array.from({ length: s.count }, (_, i) => measure(i))
    : Array.from(edgeDistance(s, width * 2.2, only));
  if (!measure) {
    const { neighbours } = topology(s);
    for (let pass = 0; pass < 3; pass++)
      far = far.map((d, i) => {
        const near = neighbours[i] ?? [];
        return d === 0 || d > width * 2 || !near.length
          ? d
          : mix(d, near.reduce((v, j) => v + at(far, j), 0) / near.length, 0.6);
      });
  }
  s.f["far"] = far;
  const strip = cut(s, (i) => width - at(far, i));
  delete s.f["far"];
  if (!strip.tri.length) return;
  for (let i = 0; i < strip.count; i++) {
    const d = field(strip, "far", i);
    strip.set(
      i,
      add(
        strip.at(i),
        strip.normal(i),
        rise * (0.3 + 0.7 * smooth(width, width * 0.6, d)) - (d > width * 0.98 ? rise * 0.6 : 0),
      ),
    );
  }
  solid(piece, strip, { thickness: thickness + rise * 0.8, lining: Infinity });
}
export function setSkin(s: Shell, skin: Skin) {
  for (let i = 0; i < s.count; i++)
    for (let j = 0; j < 4; j++) {
      s.bones[i * 4 + j] = at(skin[0], j);
      s.weights[i * 4 + j] = at(skin[1], j);
    }
  return s;
}
export function rolledRims(
  piece: Piece,
  s: Shell,
  rim: (i: number) => boolean,
  {
    width,
    rise,
    pace,
    skin,
    out = 0.0012,
  }: { width: number; rise: number; pace: number; skin: Skin; out?: number },
) {
  const half = new Set<number>(),
    n = s.count,
    next = new Map<number, number>(),
    into = new Set<number>();
  for (let t = 0; t < s.tri.length; t += 3)
    for (let e = 0; e < 3; e++) half.add(at(s.tri, t + e) * n + at(s.tri, t + ((e + 1) % 3)));
  for (const key of half) {
    const a = Math.floor(key / n),
      b = key % n;
    if (!half.has(b * n + a) && rim(a) && rim(b)) {
      next.set(a, b);
      into.add(b);
    }
  }
  const seen = new Set<number>(),
    chains = [];
  const walk = (start: number) => {
    const chain = [start];
    seen.add(start);
    for (let v = next.get(start); v !== undefined && !seen.has(v); v = next.get(v)) {
      chain.push(v);
      seen.add(v);
    }
    return chain;
  };
  for (const a of next.keys()) if (!into.has(a)) chains.push({ ids: walk(a), closed: false });
  for (const a of next.keys()) if (!seen.has(a)) chains.push({ ids: walk(a), closed: true });
  for (const { ids, closed } of chains) {
    const point = (a: readonly Vec[], i: number): Vec => a[i] ?? [0, 0, 0];
    let line = ids.map((i) => s.at(i)),
      normal = ids.map((i) => s.normal(i));
    let long = 0;
    for (let i = 1; i < line.length; i++) long += length(sub(point(line, i), point(line, i - 1)));
    if (closed) long += length(sub(point(line, 0), point(line, line.length - 1)));
    if (long < pace * 3) continue;
    const count = Math.max(4, Math.round(long / pace)),
      far = [0];
    const ring = closed ? [...line, point(line, 0)] : line,
      ringN = closed ? [...normal, point(normal, 0)] : normal;
    for (let i = 1; i < ring.length; i++)
      far.push(at(far, i - 1) + length(sub(point(ring, i), point(ring, i - 1))));
    const sample = (list: readonly Vec[], d: number) => {
      let i = 1;
      while (i < ring.length - 1 && at(far, i) < d) i++;
      return lerp3(
        point(list, i - 1),
        point(list, i),
        clamp((d - at(far, i - 1)) / (at(far, i) - at(far, i - 1) || 1)),
      );
    };
    const steps = closed ? count : count + 1;
    line = Array.from({ length: steps }, (_, i) => sample(ring, ((far.at(-1) ?? 0) * i) / count));
    normal = Array.from({ length: steps }, (_, i) =>
      unit(sample(ringN, ((far.at(-1) ?? 0) * i) / count)),
    );
    const along = (list: readonly Vec[], i: number) =>
      point(list, closed ? (i + steps) % steps : Math.max(0, Math.min(steps - 1, i)));
    for (let pass = 0; pass < 3; pass++)
      line = line.map((p, i) =>
        !closed && (i === 0 || i === steps - 1)
          ? p
          : lerp3(p, lerp3(along(line, i - 1), along(line, i + 1), 0.5), 0.5),
      );
    const rings = line.map((p, i) => {
      const t = unit(sub(along(line, i + 1), along(line, i - 1))),
        up = unit(add(point(normal, i), t, -dot(point(normal, i), t))),
        across = cross(t, up),
        c = add(p, up, out);
      return (
        [
          [0, 1],
          [1, 0.15],
          [0.6, -0.7],
          [-0.6, -0.7],
          [-1, 0.15],
        ] as const
      ).map(([x, y]) => add(add(c, across, x * width), up, y * rise));
    });
    if (closed) rings.push(rings[0] ?? []);
    piece.loft(rings, skin, { closed: true, capStart: !closed, capEnd: !closed });
  }
}
