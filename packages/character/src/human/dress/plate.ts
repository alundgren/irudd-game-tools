import {
  Envelope,
  Piece,
  at,
  add,
  clamp,
  cross,
  dot,
  length,
  lerp3,
  mix,
  smooth,
  sub,
  unit,
  type Vec,
  type Skin,
} from "./kit.js";
const TAU = Math.PI * 2;
export const scale = (v: Vec, s: number): Vec => [v[0] * s, v[1] * s, v[2] * s];
const vector = (v: readonly Vec[], i: number): Vec => v[i] ?? [0, 0, 0];
export interface Plate {
  u0: number;
  u1: number;
  a0: number;
  a1: number;
  skin: Skin;
  gap?: number;
  flare?: number;
  bulge?: number;
  thick?: number;
  roll?: number;
  rollWidth?: number;
  groove?: number;
  edge?: ((w: number) => number) | null;
  lead?: ((w: number) => number) | null;
  relief?: ((v: number, w: number, e: number) => number) | null;
  section?: ((a: number) => number) | null;
  marks?: readonly number[];
  arc?: ((v: number) => number) | null;
  window?: readonly [number, number, number, number];
  raise?: number;
  crest?: number;
  rows?: number;
  cols?: number;
  bell?: boolean;
  followLimb?: boolean;
}
export class Tube {
  readonly length: number;
  readonly cols: number;
  readonly rows: number;
  readonly c: Vec[];
  readonly t: Vec[];
  readonly n: Vec[];
  readonly f: Vec[];
  readonly env: Envelope;
  constructor(path: readonly Vec[], crown: Vec, front: Vec, stations = 24, cols = 48) {
    const far = [0];
    for (let i = 1; i < path.length; i++)
      far.push((far[i - 1] ?? 0) + length(sub(vector(path, i), vector(path, i - 1))));
    this.length = far.at(-1) ?? 0;
    this.rows = stations;
    this.cols = cols;
    const at = (d: number) => {
      let i = 1;
      while (i < path.length - 1 && (far[i] ?? 0) < d) i++;
      return lerp3(
        vector(path, i - 1),
        vector(path, i),
        clamp((d - (far[i - 1] ?? 0)) / ((far[i] ?? 0) - (far[i - 1] ?? 0) || 1)),
      );
    };
    this.c = Array.from({ length: stations }, (_, k) => at((this.length * k) / (stations - 1)));
    this.t = this.c.map((_, k) =>
      unit(sub(vector(this.c, Math.min(stations - 1, k + 1)), vector(this.c, Math.max(0, k - 1)))),
    );
    this.n = this.t.map((t) => unit(add(crown, t, -dot(crown, t))));
    this.f = this.t.map((t, k) => {
      const f = cross(vector(this.n, k), t);
      return dot(f, front) < 0 ? scale(f, -1) : f;
    });
    this.env = new Envelope([0, 0, 0], [0, 1, 0], 0, 1, stations, cols);
  }
  frame(u: number) {
    const x = clamp(u) * (this.rows - 1),
      i = Math.min(this.rows - 2, Math.floor(x)),
      s = x - i,
      over = (u - clamp(u)) * this.length;
    const t = unit(lerp3(vector(this.t, i), vector(this.t, i + 1), s));
    return {
      c: add(lerp3(vector(this.c, i), vector(this.c, i + 1), s), t, over),
      t,
      n: unit(lerp3(vector(this.n, i), vector(this.n, i + 1), s)),
      f: unit(lerp3(vector(this.f, i), vector(this.f, i + 1), s)),
    };
  }
  measure(
    points: readonly Vec[],
    {
      reach = 0.2,
      arc = Math.PI,
      span = 2,
      soften = 3,
      hang = null,
    }: {
      reach?: number;
      arc?: number;
      span?: number;
      soften?: number;
      hang?: readonly [number, number] | null;
    } = {},
  ) {
    const { rows, cols, env } = this,
      half = (this.length / (rows - 1)) * 0.75,
      r = env.r,
      middle = vector(this.c, rows >> 1),
      limit = (this.length / 2 + reach + 0.05) ** 2;
    const near = points.filter(
      (p) => (p[0] - middle[0]) ** 2 + (p[1] - middle[1]) ** 2 + (p[2] - middle[2]) ** 2 < limit,
    );
    r.fill(-1);
    for (let k = 0; k < rows; k++) {
      const c = vector(this.c, k),
        t = vector(this.t, k),
        n = vector(this.n, k),
        f = vector(this.f, k);
      for (const p of near) {
        const d = sub(p, c);
        if (Math.abs(dot(d, t)) > half) continue;
        const x = dot(d, n),
          y = dot(d, f),
          far = Math.hypot(x, y),
          angle = Math.atan2(y, x);
        if (far > reach || Math.abs(angle) > arc + 0.2) continue;
        const fc = ((angle / TAU + 1) % 1) * cols,
          j = Math.floor(fc) % cols;
        for (const q of [j, (j + 1) % cols]) r[k * cols + q] = Math.max(at(r, k * cols + q), far);
      }
    }
    const full = [];
    for (let k = 0; k < rows; k++) {
      const row = r.subarray(k * cols, (k + 1) * cols),
        old = row.slice();
      if (!old.some((x) => x >= 0)) continue;
      full.push(k);
      for (let j = 0; j < cols; j++)
        if (at(old, j) < 0) {
          let da = 1,
            db = 1;
          while (at(old, (j + cols - da) % cols) < 0) da++;
          while (at(old, (j + db) % cols) < 0) db++;
          row[j] = mix(at(old, (j + cols - da) % cols), at(old, (j + db) % cols), da / (da + db));
        }
    }
    for (let k = 0; k < rows; k++)
      if (!full.includes(k)) {
        const from = full.reduce(
          (a, b) => (a < 0 || Math.abs(b - k) < Math.abs(a - k) ? b : a),
          -1,
        );
        for (let j = 0; j < cols; j++) r[k * cols + j] = from < 0 ? 0.05 : at(r, from * cols + j);
      }
    if (arc < Math.PI)
      for (let k = 0; k < rows; k++) {
        const row = r.subarray(k * cols, (k + 1) * cols),
          edge = Math.floor((arc / TAU) * cols);
        for (let j = edge + 1; j < cols - edge; j++)
          row[j] = j < cols / 2 ? (row[edge] ?? 0) : (row[cols - edge] ?? 0);
      }
    env.taut(1, span);
    if (hang) env.hang(hang[0], hang[1]);
    env.soften(soften);
    return this;
  }
  radius(u: number, angle: number) {
    return this.env.sample(clamp(u), angle);
  }
  point(u: number, angle: number, radius: number) {
    const { c, n, f } = this.frame(u);
    return add(add(c, n, Math.cos(angle) * radius), f, Math.sin(angle) * radius);
  }
  nearest(p: Vec) {
    let best = 0;
    for (let k = 1; k < this.rows; k++)
      if (length(sub(vector(this.c, k), p)) < length(sub(vector(this.c, best), p))) best = k;
    return best / (this.rows - 1);
  }
}

function stops(
  count: number,
  size: number,
  width: number,
  marks: readonly (readonly [number, number])[] = [],
) {
  const list = [0, 1];
  for (let i = 1; i < count; i++) list.push(i / count);
  if (width > 0 && size > width * 3.2)
    for (const d of [0.5, 1, 1.4]) list.push((width * d) / size, 1 - (width * d) / size);
  for (const [at, wide] of marks)
    for (const d of [-1.6, -0.7, 0, 0.7, 1.6]) list.push(clamp(at + (d * wide) / size));
  return list
    .sort((a, b) => a - b)
    .filter((x, i, all) => i === 0 || x - (all[i - 1] ?? 0) > 2e-3 || x === 1);
}

export function plate(piece: Piece, tube: Tube, o: Plate) {
  const {
    u0,
    u1,
    a0,
    a1,
    gap = 0.005,
    flare = 0,
    bulge = 0,
    thick = 0.003,
    roll = 0,
    rollWidth = 0.009,
    groove = 0,
    edge = null,
    lead = null,
    relief = null,
    section = null,
    marks = [],
    arc = null,
    window = null,
    raise = 0,
    crest = 0.5,
    skin,
  } = o;
  const rows = o.rows ?? 6,
    cols = o.cols ?? 16;
  const L = tube.length,
    wide = (tube.radius((u0 + u1) / 2, (a0 + a1) / 2) + gap) * Math.abs(a1 - a0),
    long = (u1 - u0) * L,
    lip = roll || groove ? rollWidth : 0;
  const within = (list: number[], from: number, to: number) => [
    from,
    ...list.filter((x) => x > from + 1e-3 && x < to - 1e-3),
    to,
  ];
  const vs = window ? within(stops(rows, long, 0), window[0], window[1]) : stops(rows, long, lip),
    ws = window
      ? within(stops(cols, wide, 0), window[2], window[3])
      : stops(
          cols,
          wide,
          lip,
          marks.map((at) => [at, 0.006]),
        ),
    outer = [],
    inner = [];
  for (const v of vs) {
    const ro = [],
      ri = [];
    for (const w of ws) {
      const a = mix(a0, a1, w) * (arc ? arc(v) : 1),
        start = u0 + (lead ? lead(w) / L : 0),
        end = u1 + (edge ? edge(w) / L : 0),
        u = mix(start, end, v),
        facet = section ? section(a) : 1;
      const profile = o.followLimb
        ? tube.radius(u, a)
        : mix(tube.radius(start, a), tube.radius(end, a), v);
      let r =
        (profile + gap) * facet +
        flare * v +
        bulge *
          Math.sin(Math.PI * v ** (Math.log(0.5) / Math.log(crest))) ** 0.8 *
          Math.max(0, Math.cos((w - 0.5) * Math.PI)) ** 0.6;
      r = Math.max(r, tube.radius(u, a) + gap * 0.75);
      const e = Math.min(
        v * (end - start) * L,
        (1 - v) * (end - start) * L,
        w * wide,
        (1 - w) * wide,
      );
      const height =
        (lip
          ? roll * (1 - smooth(lip * 0.5, lip, e)) -
            groove * smooth(lip * 0.5, lip, e) * (1 - smooth(lip, lip * 1.4, e))
          : 0) + (relief ? relief(v, w, e) : 0);
      ro.push(tube.point(u, a, r + height + raise));
      ri.push(tube.point(u, a, r + (window ? raise - thick : -thick)));
    }
    outer.push(ro);
    inner.push(ri);
  }
  if (piece.plateUV) {
    const [lo, hi] = o.bell ? [0.02, 0.66] : [0.69, 0.98];
    for (let face = 0; face < 2; face++)
      for (const v of vs)
        for (const w of ws) piece.plateUV.push(0.012 + 0.976 * w, 1 - mix(lo, hi, v));
  }
  piece.slab(outer, inner, skin);
}

export function stud(
  piece: Piece,
  tube: Tube,
  u: number,
  angle: number,
  radius: number,
  size: number,
  skin: Skin,
) {
  const { c, t, n, f } = tube.frame(u),
    out = add(scale(n, Math.cos(angle)), f, Math.sin(angle)),
    around = cross(out, t),
    centre = add(c, out, radius);
  const ring = (r: number, h: number) =>
    Array.from({ length: 8 }, (_, i) =>
      add(
        add(add(centre, t, Math.cos((i / 8) * TAU) * r), around, Math.sin((i / 8) * TAU) * r),
        out,
        h,
      ),
    );
  piece.loft([ring(size, -0.001), ring(size, size * 0.35), ring(size * 0.6, size * 0.75)], skin, {
    capEnd: true,
    flip: dot(cross(t, around), out) > 0,
  });
}
