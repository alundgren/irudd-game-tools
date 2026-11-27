import { girth } from "./cloth.js";
import {
  Piece,
  Shell,
  add,
  at,
  bodyShell,
  clamp,
  cross,
  cut,
  dot,
  length,
  loops,
  mix,
  raycaster,
  smooth,
  sub,
  unit,
  Envelope,
  type DressBody,
  type Landmarks,
  type Skin,
  type Vec,
} from "./kit.js";
import {
  draftShirt,
  meshPanels,
  type PanelMesh,
  type ShirtDraft,
  type ShirtSpec,
} from "./pattern.js";

export interface SewOptions {
  readonly spec: ShirtSpec;
  readonly stiff: number;
  readonly thickness: number;
  readonly under: ReadonlyArray<Shell>;
  readonly belt: { readonly y: number; readonly half: number; readonly reach: number } | null;
  readonly tuck: { readonly y: number; readonly shell: Shell } | null;
}

export interface SewnView {
  readonly s: Shell;
  readonly upper: number[] | null;
  readonly lower: number[] | null;
  readonly sleeves: number[][];
}

export interface Sewn {
  readonly piece: Piece;
  readonly view: SewnView;
  readonly cover: Shell;
  readonly strap: Envelope | null;
  readonly stats: SewStats;
}

export interface SewStats {
  readonly particles: number;
  readonly triangles: number;
  readonly substeps: number;
  readonly milliseconds: number;
  readonly cached: boolean;
}

const FINGERS = "(upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)";

class Collider {
  readonly rest: Float64Array;
  readonly restN: Float64Array;
  readonly P: Float64Array;
  readonly N: Float64Array;
  readonly near: Int32Array[];
  readonly cell: number;
  grid = new Map<number, number[]>();
  readonly skip: Uint8Array;
  constructor(
    pos: ArrayLike<number>,
    nrm: ArrayLike<number>,
    tri: ArrayLike<number>,
    cell: number,
    skip?: Uint8Array,
  ) {
    const n = Math.floor(pos.length / 3);
    this.rest = Float64Array.from({ length: n * 3 }, (_, i) => at(pos, i));
    this.restN = Float64Array.from({ length: n * 3 }, (_, i) => at(nrm, i));
    this.P = this.rest.slice();
    this.N = this.restN.slice();
    this.cell = cell;
    this.skip = skip ?? new Uint8Array(n);
    const sets = Array.from({ length: n }, () => new Set<number>());
    for (let t = 0; t < tri.length; t += 3)
      for (let k = 0; k < 3; k++) {
        const a = at(tri, t + k),
          b = at(tri, t + ((k + 1) % 3));
        sets[a]?.add(b);
        sets[b]?.add(a);
      }
    this.near = sets.map((s) => Int32Array.from(s));
    this.rebuild();
  }
  key(x: number, y: number, z: number): number {
    return x + 512 + (y + 512) * 1024 + (z + 512) * 1048576;
  }
  rebuild(): void {
    this.grid.clear();
    const c = this.cell,
      P = this.P;
    for (let v = 0; v < P.length / 3; v++) {
      if (this.skip[v]) continue;
      const k = this.key(
        Math.floor((P[v * 3] ?? 0) / c),
        Math.floor((P[v * 3 + 1] ?? 0) / c),
        Math.floor((P[v * 3 + 2] ?? 0) / c),
      );
      const list = this.grid.get(k);
      if (list) list.push(v);
      else this.grid.set(k, [v]);
    }
  }
  search(x: number, y: number, z: number): number {
    const c = this.cell,
      cx = Math.floor(x / c),
      cy = Math.floor(y / c),
      cz = Math.floor(z / c),
      P = this.P;
    let best = -1,
      bestD = Infinity;
    for (let ring = 0; ring <= 2 && (best < 0 || ring <= 1); ring++)
      for (let i = -ring; i <= ring; i++)
        for (let j = -ring; j <= ring; j++)
          for (let l = -ring; l <= ring; l++) {
            if (Math.max(Math.abs(i), Math.abs(j), Math.abs(l)) !== ring) continue;
            for (const v of this.grid.get(this.key(cx + i, cy + j, cz + l)) ?? []) {
              const d =
                ((P[v * 3] ?? 0) - x) ** 2 +
                ((P[v * 3 + 1] ?? 0) - y) ** 2 +
                ((P[v * 3 + 2] ?? 0) - z) ** 2;
              if (d < bestD) {
                bestD = d;
                best = v;
              }
            }
          }
    return best;
  }
  climb(v: number, x: number, y: number, z: number): number {
    const P = this.P;
    let d =
      ((P[v * 3] ?? 0) - x) ** 2 + ((P[v * 3 + 1] ?? 0) - y) ** 2 + ((P[v * 3 + 2] ?? 0) - z) ** 2;
    for (let step = 0; step < 24; step++) {
      let moved = false;
      for (const w of this.near[v] ?? []) {
        if (this.skip[w]) continue;
        const e =
          ((P[w * 3] ?? 0) - x) ** 2 +
          ((P[w * 3 + 1] ?? 0) - y) ** 2 +
          ((P[w * 3 + 2] ?? 0) - z) ** 2;
        if (e < d) {
          d = e;
          v = w;
          moved = true;
        }
      }
      if (!moved) break;
    }
    return v;
  }
}

interface Pose {
  readonly left: Float32Array;
  readonly right: Float32Array;
  readonly shoulderL: Vec;
  readonly shoulderR: Vec;
}

const rotateZ = (p: Vec, pivot: Vec, angle: number): Vec => {
  const c = Math.cos(angle),
    s = Math.sin(angle),
    x = p[0] - pivot[0],
    y = p[1] - pivot[1];
  return [pivot[0] + c * x - s * y, pivot[1] + s * x + c * y, p[2]];
};

function posed(collider: Collider, pose: Pose, lift: number): void {
  const { rest, restN, P, N } = collider,
    cl = Math.cos(lift),
    sl = Math.sin(lift);
  for (let v = 0; v < rest.length / 3; v++) {
    const wl = pose.left[v] ?? 0,
      wr = pose.right[v] ?? 0;
    let x = rest[v * 3] ?? 0,
      y = rest[v * 3 + 1] ?? 0,
      nx = restN[v * 3] ?? 0,
      ny = restN[v * 3 + 1] ?? 0;
    const z = rest[v * 3 + 2] ?? 0,
      nz = restN[v * 3 + 2] ?? 0;
    if (wl > 0 || wr > 0) {
      const lx = x - pose.shoulderL[0],
        ly = y - pose.shoulderL[1],
        rx = x - pose.shoulderR[0],
        ry = y - pose.shoulderR[1];
      const ax = pose.shoulderL[0] + cl * lx - sl * ly - x,
        ay = pose.shoulderL[1] + sl * lx + cl * ly - y,
        bx = pose.shoulderR[0] + cl * rx + sl * ry - x,
        by = pose.shoulderR[1] - sl * rx + cl * ry - y;
      const anx = cl * nx - sl * ny - nx,
        any = sl * nx + cl * ny - ny,
        bnx = cl * nx + sl * ny - nx,
        bny = -sl * nx + cl * ny - ny;
      x += wl * ax + wr * bx;
      y += wl * ay + wr * by;
      nx += wl * anx + wr * bnx;
      ny += wl * any + wr * bny;
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    P[v * 3] = x;
    P[v * 3 + 1] = y;
    P[v * 3 + 2] = z;
    N[v * 3] = nx / l;
    N[v * 3 + 1] = ny / l;
    N[v * 3 + 2] = nz / l;
  }
  collider.rebuild();
}

interface Section {
  readonly half: number;
  readonly depth: number;
  readonly centre: number;
}

function sections(body: DressBody, from: number, to: number): (y: number) => Section {
  const arm = body.weight(new RegExp("^" + FINGERS)),
    head = body.weight(/^(head|neck)/),
    step = 0.01 * body.scale,
    rows = Math.max(2, Math.ceil((to - from) / step) + 1),
    table: Section[] = [];
  for (let r = 0; r < rows; r++) {
    const y = from + r * step;
    let half = 0,
      z0 = Infinity,
      z1 = -Infinity;
    for (let v = 0; v < body.count; v++) {
      if (Math.abs(at(body.P, v * 3 + 1) - y) > 0.012 * body.scale) continue;
      if (at(arm, v) > 0.2 || at(head, v) > 0.5) continue;
      half = Math.max(half, Math.abs(at(body.P, v * 3)));
      z0 = Math.min(z0, at(body.P, v * 3 + 2));
      z1 = Math.max(z1, at(body.P, v * 3 + 2));
    }
    const prev = table[r - 1];
    table.push(
      Number.isFinite(z0) && half > 0.05 * body.scale
        ? { half, depth: (z1 - z0) / 2, centre: (z0 + z1) / 2 }
        : (prev ?? { half: 0.15, depth: 0.1, centre: 0 }),
    );
  }
  return (y) =>
    table[clamp(Math.round((y - from) / step), 0, rows - 1)] ?? {
      half: 0.15,
      depth: 0.1,
      centre: 0,
    };
}

function shoulderRidge(body: DressBody): (x: number) => readonly [number, number] {
  const arm = body.weight(new RegExp("^" + FINGERS)),
    head = body.weight(/^(head|neck)/),
    step = 0.01 * body.scale,
    bins = 40,
    top = new Float64Array(bins).fill(-Infinity),
    mid = new Float64Array(bins);
  for (let v = 0; v < body.count; v++) {
    if (at(arm, v) > 0.5 || at(head, v) > 0.5) continue;
    const b = Math.floor(Math.abs(at(body.P, v * 3)) / step);
    if (b >= bins || at(body.P, v * 3 + 1) <= at(top, b)) continue;
    top[b] = at(body.P, v * 3 + 1);
    mid[b] = at(body.P, v * 3 + 2);
  }
  for (let b = 1; b < bins; b++)
    if (!Number.isFinite(at(top, b)) || at(top, b) < at(top, 0) - 0.12 * body.scale) {
      top[b] = at(top, b - 1);
      mid[b] = at(mid, b - 1);
    }
  return (x) => {
    const b = Math.min(bins - 1, Math.floor(Math.abs(x) / step));
    return [at(top, b), at(mid, b)];
  };
}

function ellipse(a: number, b: number): (s: number) => readonly [number, number] {
  const n = 96,
    arc = new Float64Array(n + 1);
  for (let i = 1; i <= n; i++) {
    const t0 = ((i - 1) / n) * (Math.PI / 2),
      t1 = (i / n) * (Math.PI / 2);
    arc[i] =
      at(arc, i - 1) +
      Math.hypot(a * (Math.sin(t1) - Math.sin(t0)), b * (Math.cos(t1) - Math.cos(t0)));
  }
  const quarter = at(arc, n);
  return (s) => {
    const sign = s < 0 ? -1 : 1,
      d = Math.abs(s);
    if (d >= quarter) {
      const extra = d - quarter;
      return [sign * a, -extra];
    }
    let lo = 0,
      hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (at(arc, mid) < d) lo = mid;
      else hi = mid;
    }
    const f = (d - at(arc, lo)) / (at(arc, hi) - at(arc, lo) || 1),
      t = ((lo + f) / n) * (Math.PI / 2);
    return [sign * a * Math.sin(t), b * Math.cos(t)];
  };
}

function ramanujan(ratio: number, perimeter: number): number {
  const unitPerimeter = Math.PI * (3 * (ratio + 1) - Math.sqrt((3 * ratio + 1) * (ratio + 3)));
  return perimeter / unitPerimeter;
}

interface Layout {
  readonly panels: PanelMesh[];
  readonly offset: number[];
  readonly count: number;
  readonly x: Float64Array;
  readonly flip: boolean[];
}

function place(
  body: DressBody,
  m: Landmarks,
  draft: ShirtDraft,
  panels: PanelMesh[],
  lift: number,
): Layout {
  const k = m.k,
    offset: number[] = [];
  let count = 0;
  for (const p of panels) {
    offset.push(count);
    count += p.uv.length;
  }
  const x = new Float64Array(count * 3),
    section = sections(body, draft.hemY, draft.underarmY),
    vua = draft.underarmY - draft.hemY;
  const front = panels.find((p) => p.name === "front");
  const sideWidth = (v: number) => {
    if (!front) return 0.25;
    let best = 0;
    for (const [u, w] of front.uv)
      if (Math.abs(w - Math.min(v, vua)) < 0.02 * k) best = Math.max(best, Math.abs(u));
    return best;
  };
  const rings = new Map<number, (s: number) => readonly [number, number]>();
  const ringAt = (v: number) => {
    const key = Math.round(Math.min(v, vua) / (0.01 * k));
    let r = rings.get(key);
    if (!r) {
      const y = draft.hemY + Math.min(v, vua),
        sec = section(y),
        clearance = 0.02 * k,
        ratio = (sec.half + clearance) / (sec.depth + clearance),
        b = ramanujan(ratio, 4 * Math.max(sideWidth(v), sec.half + sec.depth));
      r = ellipse(ratio * b, b);
      rings.set(key, r);
    }
    return r;
  };
  const centreAt = (v: number) => section(draft.hemY + Math.min(v, vua)).centre;
  const ridge = shoulderRidge(body);
  const wrap = (ex: number, y: number, z: number, sign: number): readonly [number, number] => {
    const [top, mid] = ridge(ex),
      crest = top + 0.015 * k,
      r = Math.max(0.04 * k, Math.abs(z - mid)),
      y0 = crest - r;
    if (y <= y0) return [y, z];
    const e = y - y0,
      theta = e / r;
    if (theta <= Math.PI / 2) return [y0 + r * Math.sin(theta), mid + sign * r * Math.cos(theta)];
    return [crest, mid - sign * (e - (r * Math.PI) / 2)];
  };
  const S = { l: body.joint("upperarm_l"), r: body.joint("upperarm_r") },
    E = { l: body.joint("lowerarm_l"), r: body.joint("lowerarm_r") },
    W = { l: body.joint("hand_l"), r: body.joint("hand_r") };
  const flip: boolean[] = [];
  panels.forEach((panel, pi) => {
    const base = at(offset, pi);
    if (panel.name === "front" || panel.name === "back") {
      const sign = panel.name === "front" ? 1 : -1;
      flip.push(sign < 0);
      panel.uv.forEach(([u, v], i) => {
        const [ex, ez] = ringAt(v)(u),
          [wy, wz] = wrap(ex, draft.hemY + v, centreAt(v) + sign * ez, sign);
        x[(base + i) * 3] = ex;
        x[(base + i) * 3 + 1] = wy;
        x[(base + i) * 3 + 2] = wz;
      });
      return;
    }
    const side = panel.name.endsWith("_l") ? "l" : "r",
      dir = side === "l" ? 1 : -1,
      angle = dir * lift,
      s = S[side],
      e = rotateZ(E[side], s, angle),
      w = rotateZ(W[side], s, angle),
      upper = length(sub(e, s));
    flip.push(side === "l");
    let widest = 0;
    for (const [u] of panel.uv) widest = Math.max(widest, Math.abs(u));
    const cuffHalf = panel.uv.reduce(
      (best, [u, v]) => (v < 0.005 * k ? Math.max(best, Math.abs(u)) : best),
      0,
    );
    const capBaseV = Math.max(0.03 * k, draft.sleeveEnd - draft.capBase);
    panel.uv.forEach(([u, v], i) => {
      const d = draft.sleeveEnd - v,
        axis = d <= upper ? unit(sub(e, s)) : unit(sub(w, e)),
        centre = d <= upper ? add(s, axis, d) : add(e, axis, d - upper),
        width = 2 * mix(cuffHalf, widest, clamp(v / capBaseV)),
        r = width / (2 * Math.PI),
        phi = u / r;
      const fz: Vec = [0, 0, 1],
        f = unit(
          sub(fz, [axis[0] * dot(fz, axis), axis[1] * dot(fz, axis), axis[2] * dot(fz, axis)]),
        ),
        o = unit(cross(f, axis)),
        flipped: Vec = [-o[0], -o[1], -o[2]],
        outward = dot(o, [dir, 0.4, 0]) < 0 ? flipped : o;
      const p = add(add(centre, outward, r * Math.cos(phi)), f, r * Math.sin(phi));
      x[(base + i) * 3] = p[0];
      x[(base + i) * 3 + 1] = p[1];
      x[(base + i) * 3 + 2] = p[2];
    });
  });
  return { panels, offset, count, x, flip };
}

interface Constraints {
  readonly a: Int32Array;
  readonly b: Int32Array;
  readonly rest: Float64Array;
  readonly compliance: Float64Array;
}

function constraints(layout: Layout, bendCompliance: number): Constraints {
  const a: number[] = [],
    b: number[] = [],
    rest: number[] = [],
    comp: number[] = [];
  layout.panels.forEach((panel, pi) => {
    const base = at(layout.offset, pi),
      opposite = new Map<string, number[]>();
    const dist = (i: number, j: number) => {
      const p = panel.uv[i] ?? [0, 0],
        q = panel.uv[j] ?? [0, 0];
      return Math.hypot(p[0] - q[0], p[1] - q[1]);
    };
    for (let t = 0; t < panel.tri.length; t += 3)
      for (let e = 0; e < 3; e++) {
        const i = at(panel.tri, t + e),
          j = at(panel.tri, t + ((e + 1) % 3)),
          o = at(panel.tri, t + ((e + 2) % 3)),
          key = Math.min(i, j) + ":" + Math.max(i, j);
        const list = opposite.get(key);
        if (list) list.push(o);
        else {
          opposite.set(key, [o]);
          a.push(base + i);
          b.push(base + j);
          rest.push(dist(i, j));
          comp.push(0);
        }
      }
    for (const list of opposite.values()) {
      if (list.length !== 2) continue;
      const [c = 0, d = 0] = list;
      a.push(base + c);
      b.push(base + d);
      rest.push(dist(c, d));
      comp.push(bendCompliance);
    }
    for (const id of panel.free) {
      const ids = panel.edges.get(id) ?? [];
      for (let i = 2; i < ids.length; i++) {
        const c = at(ids, i - 2),
          d = at(ids, i);
        a.push(base + c);
        b.push(base + d);
        rest.push(dist(c, d));
        comp.push(bendCompliance * 0.05);
      }
    }
  });
  return {
    a: Int32Array.from(a),
    b: Int32Array.from(b),
    rest: Float64Array.from(rest),
    compliance: Float64Array.from(comp),
  };
}

function stitches(layout: Layout, draft: ShirtDraft): Array<readonly [number, number]> {
  const pairs: Array<readonly [number, number]> = [];
  const ids = (panel: string, edge: string) => {
    const pi = layout.panels.findIndex((p) => p.name === panel),
      list = layout.panels[pi]?.edges.get(edge) ?? [];
    return list.map((i) => at(layout.offset, pi) + i);
  };
  const d = (i: number, j: number) =>
    Math.hypot(
      at(layout.x, i * 3) - at(layout.x, j * 3),
      at(layout.x, i * 3 + 1) - at(layout.x, j * 3 + 1),
      at(layout.x, i * 3 + 2) - at(layout.x, j * 3 + 2),
    );
  for (const seam of draft.seams) {
    const p = ids(...seam.a),
      q = ids(...seam.b),
      n = Math.min(p.length, q.length);
    if (!n) continue;
    const same = d(at(p, 0), at(q, 0)) + d(at(p, n - 1), at(q, n - 1)),
      reverse = d(at(p, 0), at(q, n - 1)) + d(at(p, n - 1), at(q, 0));
    for (let i = 0; i < n; i++) pairs.push([at(p, i), at(q, reverse < same ? n - 1 - i : i)]);
  }
  return pairs;
}

const memo = new Map<string, { readonly x: Float64Array; readonly strap: Envelope | null }>();

const TAU = Math.PI * 2;

class Strap {
  readonly s: Float64Array;
  readonly floor: Float64Array;
  readonly push: Float64Array;
  readonly hm: number;
  start = 0;
  readonly target: number;
  readonly env: Envelope;
  readonly y: number;
  readonly half: number;
  readonly k: number;
  readonly cols: number;
  constructor(env: Envelope, y: number, half: number, k: number, gap: number, cols = 96) {
    this.env = env;
    this.y = y;
    this.half = half;
    this.k = k;
    this.cols = cols;
    this.hm = env.local([0, y, 0])[0];
    this.s = new Float64Array(cols);
    this.floor = new Float64Array(cols);
    this.push = new Float64Array(cols);
    const goal = new Float64Array(cols);
    for (let j = 0; j < cols; j++) {
      const u = env.sample(this.hm, (j / cols) * TAU);
      this.floor[j] = u + 0.001 * k;
      goal[j] = u + gap + 0.0015 * k;
    }
    this.target = this.perimeter(goal);
  }
  perimeter(r: ArrayLike<number>): number {
    let total = 0;
    for (let j = 0; j < this.cols; j++) {
      const a = this.env.point(this.hm, (j / this.cols) * TAU, at(r, j)),
        b = this.env.point(
          this.hm,
          (((j + 1) % this.cols) / this.cols) * TAU,
          at(r, (j + 1) % this.cols),
        );
      total += Math.hypot(a[0] - b[0], a[2] - b[2]);
    }
    return total;
  }
  radius(angle: number): number {
    const f = ((((angle / TAU) % 1) + 1) % 1) * this.cols,
      j = Math.floor(f) % this.cols;
    return mix(at(this.s, j), at(this.s, (j + 1) % this.cols), f - Math.floor(f));
  }
  fit(x: Float64Array, n: number, band: number, skip: Uint8Array): void {
    const k = this.k;
    this.s.fill(0);
    for (let i = 0; i < n; i++) {
      if (skip[i]) continue;
      const p: Vec = [at(x, i * 3), at(x, i * 3 + 1), at(x, i * 3 + 2)];
      if (Math.abs(p[1] - this.y) > band) continue;
      const [, angle, r] = this.env.polar(p),
        j = Math.round(((((angle / TAU) % 1) + 1) % 1) * this.cols) % this.cols;
      this.s[j] = Math.max(at(this.s, j), r);
    }
    for (let j = 0; j < this.cols; j++)
      this.s[j] = Math.max(at(this.s, j), at(this.floor, j)) + 0.012 * k;
    this.relax(3);
    this.start = this.perimeter(this.s);
  }
  relax(passes: number): void {
    const c = this.cols;
    for (let pass = 0; pass < passes; pass++) {
      const old = this.s.slice();
      for (let j = 0; j < c; j++)
        this.s[j] = Math.max(
          at(this.floor, j),
          0.5 * at(old, j) + 0.25 * (at(old, (j + c - 1) % c) + at(old, (j + 1) % c)),
        );
    }
  }
  tighten(rest: number): void {
    const now = this.perimeter(this.s);
    if (now > rest) {
      const f = mix(1, rest / now, 0.04);
      for (let j = 0; j < this.cols; j++) this.s[j] = at(this.s, j) * f;
    }
    this.relax(1);
  }
  envelope(m: Landmarks, reach: number): Envelope {
    const k = this.k,
      cols = 64,
      e = new Envelope([0, this.y + reach * k, m.pelvis[2]], [0, -1, 0], 0, 2 * reach * k, 7, cols),
      [cu, cv] = this.env.centre(this.hm);
    e.cu.fill(cu);
    e.cv.fill(cv);
    for (let row = 0; row < e.rows; row++)
      for (let col = 0; col < cols; col++)
        e.r[row * cols + col] = this.radius((col / cols) * TAU) - 0.0015 * k;
    return e;
  }
}

class SelfContact {
  readonly root: Int32Array;
  readonly near: Int32Array[];
  readonly stamp: Int32Array;
  readonly size = 1 << 14;
  readonly start: Int32Array;
  readonly cursor: Int32Array;
  readonly items: Int32Array;
  readonly cellOf: Int32Array;
  readonly h: number;
  constructor(
    n: number,
    edges: Constraints,
    stitch: ReadonlyArray<readonly [number, number]>,
    h: number,
  ) {
    this.h = h;
    const root = Int32Array.from({ length: n }, (_, i) => i);
    const find = (i: number): number => {
      while (at(root, i) !== i) {
        root[i] = at(root, at(root, i));
        i = at(root, i);
      }
      return i;
    };
    for (const [i, j] of stitch) {
      const a = find(i),
        b = find(j);
      if (a !== b) root[Math.max(a, b)] = Math.min(a, b);
    }
    for (let i = 0; i < n; i++) root[i] = find(i);
    this.root = root;
    const adj = Array.from({ length: n }, () => new Set<number>());
    for (let c = 0; c < edges.a.length; c++) {
      if (at(edges.compliance, c) !== 0) continue;
      const a = at(root, at(edges.a, c)),
        b = at(root, at(edges.b, c));
      adj[a]?.add(b);
      adj[b]?.add(a);
    }
    this.near = adj.map((set, r) => {
      const two = new Set<number>([r, ...set]);
      for (const q of set) for (const w of adj[q] ?? []) two.add(w);
      return Int32Array.from(two);
    });
    this.stamp = new Int32Array(n);
    this.start = new Int32Array(this.size + 1);
    this.cursor = new Int32Array(this.size);
    this.items = new Int32Array(n);
    this.cellOf = new Int32Array(n);
  }
  cell(x: number, y: number, z: number): number {
    return (
      (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & (this.size - 1)
    );
  }
  solve(x: Float64Array): void {
    const n = this.items.length,
      h = this.h,
      inv = 1 / h,
      start = this.start;
    start.fill(0);
    for (let i = 0; i < n; i++) {
      const c = this.cell(
        Math.floor((x[i * 3] ?? 0) * inv),
        Math.floor((x[i * 3 + 1] ?? 0) * inv),
        Math.floor((x[i * 3 + 2] ?? 0) * inv),
      );
      this.cellOf[i] = c;
      start[c + 1] = (start[c + 1] ?? 0) + 1;
    }
    for (let c = 0; c < this.size; c++) start[c + 1] = (start[c + 1] ?? 0) + (start[c] ?? 0);
    this.cursor.set(start.subarray(0, this.size));
    for (let i = 0; i < n; i++) {
      const c = this.cellOf[i] ?? 0;
      this.items[this.cursor[c] ?? 0] = i;
      this.cursor[c] = (this.cursor[c] ?? 0) + 1;
    }
    for (let i = 0; i < n; i++) {
      for (const r of this.near[this.root[i] ?? 0] ?? []) this.stamp[r] = i + 1;
      const cx = Math.floor((x[i * 3] ?? 0) * inv),
        cy = Math.floor((x[i * 3 + 1] ?? 0) * inv),
        cz = Math.floor((x[i * 3 + 2] ?? 0) * inv);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++) {
            const c = this.cell(cx + dx, cy + dy, cz + dz),
              end = start[c + 1] ?? 0;
            for (let e = start[c] ?? 0; e < end; e++) {
              const j = this.items[e] ?? 0;
              if (j <= i || this.stamp[this.root[j] ?? 0] === i + 1) continue;
              const ex = (x[i * 3] ?? 0) - (x[j * 3] ?? 0),
                ey = (x[i * 3 + 1] ?? 0) - (x[j * 3 + 1] ?? 0),
                ez = (x[i * 3 + 2] ?? 0) - (x[j * 3 + 2] ?? 0),
                d2 = ex * ex + ey * ey + ez * ez;
              if (d2 >= h * h || d2 < 1e-14) continue;
              const d = Math.sqrt(d2),
                f = (h - d) / 2 / d;
              x[i * 3] = (x[i * 3] ?? 0) + ex * f;
              x[i * 3 + 1] = (x[i * 3 + 1] ?? 0) + ey * f;
              x[i * 3 + 2] = (x[i * 3 + 2] ?? 0) + ez * f;
              x[j * 3] = (x[j * 3] ?? 0) - ex * f;
              x[j * 3 + 1] = (x[j * 3 + 1] ?? 0) - ey * f;
              x[j * 3 + 2] = (x[j * 3 + 2] ?? 0) - ez * f;
            }
          }
    }
  }
}

function fingerprint(body: DressBody, options: SewOptions, spacing: number): string {
  let h = 0;
  for (let i = 0; i < body.P.length; i += 37) h = (h * 31 + Math.round(at(body.P, i) * 1e5)) | 0;
  let u = 0;
  for (const s of options.under)
    for (let i = 0; i < s.pos.length; i += 41) u = (u * 31 + Math.round(at(s.pos, i) * 1e5)) | 0;
  return JSON.stringify([
    h,
    u,
    options.spec,
    options.stiff,
    options.thickness,
    options.belt,
    spacing,
  ]);
}

function simulate(
  body: DressBody,
  m: Landmarks,
  layout: Layout,
  stitch: ReadonlyArray<readonly [number, number]>,
  options: SewOptions,
  lift: number,
  spacing: number,
): { readonly x: Float64Array; readonly substeps: number; readonly strap: Envelope | null } {
  const k = m.k,
    n = layout.count,
    x = layout.x.slice(),
    prev = x.slice(),
    vel = new Float64Array(n * 3),
    con = constraints(layout, mix(0.3, 0.006, options.stiff)),
    stitchStart = stitch.map(([i, j]) =>
      Math.hypot(
        (x[i * 3] ?? 0) - (x[j * 3] ?? 0),
        (x[i * 3 + 1] ?? 0) - (x[j * 3 + 1] ?? 0),
        (x[i * 3 + 2] ?? 0) - (x[j * 3 + 2] ?? 0),
      ),
    );
  const pose: Pose = {
    left: body.weight(new RegExp("^" + FINGERS + ".*_l$")),
    right: body.weight(new RegExp("^" + FINGERS + ".*_r$")),
    shoulderL: body.joint("upperarm_l"),
    shoulderR: body.joint("upperarm_r"),
  };
  const hands = body.weight(/^(hand|thumb|index|middle|ring|pinky)/),
    forearms = body.weight(/^(lowerarm|hand|thumb|index|middle|ring|pinky)/),
    skinOf = (mask: Float32Array) =>
      new Collider(
        body.P.subarray(0, body.count * 3),
        body.N,
        body.tri,
        0.03 * k,
        Uint8Array.from(mask, (w) => (w > 0.4 ? 1 : 0)),
      ),
    skin = skinOf(hands),
    trunk = skinOf(forearms);
  posed(skin, pose, lift);
  posed(trunk, pose, lift);
  const sleeve = new Uint8Array(n);
  layout.panels.forEach((panel, pi) => {
    if (!panel.name.startsWith("sleeve")) return;
    sleeve.fill(1, at(layout.offset, pi), at(layout.offset, pi) + panel.uv.length);
  });
  const layers = options.under.map((s) => new Collider(s.pos, s.nrm, s.tri, 0.03 * k));
  const colliders = [skin, trunk, ...layers],
    hints = colliders.map(() => new Int32Array(n).fill(-1)),
    tops = colliders.map((col, ci) => {
      if (ci < 2) return Infinity;
      let top = -Infinity;
      for (let i = 1; i < col.P.length; i += 3) top = Math.max(top, col.P[i] ?? 0);
      return top + 0.04 * k;
    }),
    tucked = options.tuck ? 2 + options.under.indexOf(options.tuck.shell) : -1;
  const gap = options.thickness + 0.0025 * k,
    friction = 0.35,
    stick = 0.9,
    slide = 0.6,
    squeezed = new Uint8Array(n),
    self = new SelfContact(n, con, stitch, 0.45 * spacing);
  let strap: Strap | null = null;
  const fps = 60,
    sub = 8,
    dt = 1 / fps / sub,
    frames = 180,
    stitchEnd = 30,
    gravityFrom = 0,
    gravityTo = 8,
    lowerFrom = 50,
    lowerTo = 115,
    beltFrom = 118,
    tuckFrom = 110;
  const press = (st: Strap, band: number) => {
    st.push.fill(0);
    squeezed.fill(0);
    const c = st.cols;
    for (let i = 0; i < n; i++) {
      const py = x[i * 3 + 1] ?? 0;
      if (sleeve[i] || Math.abs(py - st.y) > band) continue;
      const p: Vec = [x[i * 3] ?? 0, py, x[i * 3 + 2] ?? 0],
        [h, angle, r] = st.env.polar(p),
        f = ((((angle / TAU) % 1) + 1) % 1) * c,
        j0 = Math.floor(f) % c,
        j1 = (j0 + 1) % c,
        t = f - Math.floor(f),
        limit =
          mix(at(st.s, j0), at(st.s, j1), t) -
          0.0005 * k +
          0.35 * Math.max(0, Math.abs(py - st.y) - st.half - 0.005 * k);
      if (r <= limit) continue;
      const depth = (r - limit) * 0.5,
        q = st.env.point(h, angle, r - depth),
        o = st.env.point(h, angle, 0),
        rl = Math.hypot(q[0] - o[0], q[2] - o[2]) || 1,
        rx = (q[0] - o[0]) / rl,
        rz = (q[2] - o[2]) / rl;
      st.push[j0] = Math.max(at(st.push, j0), depth * (1 - t));
      st.push[j1] = Math.max(at(st.push, j1), depth * t);
      squeezed[i] = 1;
      const dx = q[0] - (prev[i * 3] ?? 0),
        dy = py - (prev[i * 3 + 1] ?? 0),
        dz = q[2] - (prev[i * 3 + 2] ?? 0),
        along = dx * rx + dz * rz,
        tx = dx - along * rx,
        tz = dz - along * rz,
        tl = Math.hypot(tx, dy, tz),
        keep = tl < stick * depth ? 1 : Math.min(1, (slide * depth) / tl);
      x[i * 3] = q[0] - tx * keep;
      x[i * 3 + 1] = py - dy * keep;
      x[i * 3 + 2] = q[2] - tz * keep;
    }
    for (let j = 0; j < c; j++) st.s[j] = at(st.s, j) + at(st.push, j);
  };
  for (let frame = 0; frame < frames; frame++) {
    if (frame >= lowerFrom && frame <= lowerTo) {
      posed(skin, pose, lift * (1 - smooth(lowerFrom, lowerTo, frame)));
      posed(trunk, pose, lift * (1 - smooth(lowerFrom, lowerTo, frame)));
    }
    const released = frame > lowerTo + 4;
    if (frame === beltFrom && options.belt) {
      const shells = options.under.length ? options.under : [bodyShell(body)];
      strap = new Strap(
        girth(body, m, shells, options.belt.y),
        options.belt.y,
        options.belt.half,
        k,
        gap,
      );
      strap.fit(x, n, options.belt.half + 0.002 * k, sleeve);
    }
    const g = 9.81 * smooth(gravityFrom, gravityTo, frame),
      stitchScale = Math.max(0, 1 - frame / stitchEnd),
      damping = frame > lowerTo ? 0.985 : 0.995,
      beltRest = strap ? mix(strap.start, strap.target, smooth(beltFrom, beltFrom + 25, frame)) : 0,
      tuckLimit = mix(0.15 * k, -0.003 * k, smooth(tuckFrom, tuckFrom + 30, frame));
    for (let s = 0; s < sub; s++) {
      for (let i = 0; i < n; i++) {
        vel[i * 3 + 1] = (vel[i * 3 + 1] ?? 0) - g * dt;
        for (let c = 0; c < 3; c++) {
          prev[i * 3 + c] = x[i * 3 + c] ?? 0;
          x[i * 3 + c] = (x[i * 3 + c] ?? 0) + (vel[i * 3 + c] ?? 0) * dt;
        }
      }
      for (let c = 0; c < con.a.length; c++) {
        const i = con.a[c] ?? 0,
          j = con.b[c] ?? 0;
        const dx = (x[i * 3] ?? 0) - (x[j * 3] ?? 0),
          dy = (x[i * 3 + 1] ?? 0) - (x[j * 3 + 1] ?? 0),
          dz = (x[i * 3 + 2] ?? 0) - (x[j * 3 + 2] ?? 0),
          l = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (l < 1e-9) continue;
        const alpha = (con.compliance[c] ?? 0) / (dt * dt),
          lambda = -(l - (con.rest[c] ?? 0)) / (2 + alpha) / l;
        x[i * 3] = (x[i * 3] ?? 0) + lambda * dx;
        x[i * 3 + 1] = (x[i * 3 + 1] ?? 0) + lambda * dy;
        x[i * 3 + 2] = (x[i * 3 + 2] ?? 0) + lambda * dz;
        x[j * 3] = (x[j * 3] ?? 0) - lambda * dx;
        x[j * 3 + 1] = (x[j * 3 + 1] ?? 0) - lambda * dy;
        x[j * 3 + 2] = (x[j * 3 + 2] ?? 0) - lambda * dz;
      }
      stitch.forEach(([i, j], c) => {
        const target = (stitchStart[c] ?? 0) * stitchScale;
        const dx = (x[i * 3] ?? 0) - (x[j * 3] ?? 0),
          dy = (x[i * 3 + 1] ?? 0) - (x[j * 3 + 1] ?? 0),
          dz = (x[i * 3 + 2] ?? 0) - (x[j * 3 + 2] ?? 0),
          l = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (l <= target || l < 1e-9) return;
        const lambda = -(l - target) / 2 / l;
        x[i * 3] = (x[i * 3] ?? 0) + lambda * dx;
        x[i * 3 + 1] = (x[i * 3 + 1] ?? 0) + lambda * dy;
        x[i * 3 + 2] = (x[i * 3 + 2] ?? 0) + lambda * dz;
        x[j * 3] = (x[j * 3] ?? 0) - lambda * dx;
        x[j * 3 + 1] = (x[j * 3 + 1] ?? 0) - lambda * dy;
        x[j * 3 + 2] = (x[j * 3 + 2] ?? 0) - lambda * dz;
      });
      if (strap) {
        press(strap, strap.half + 0.03 * k);
        strap.tighten(beltRest);
      }
      colliders.forEach((col, ci) => {
        const hint = hints[ci] ?? new Int32Array(n),
          reach = 0.05 * k,
          clearance = ci < 2 ? gap : gap + 0.001 * k,
          top = tops[ci] ?? Infinity,
          inside =
            ci === tucked && frame >= tuckFrom ? (options.tuck?.y ?? 0) - 0.004 * k : -Infinity;
        for (let i = 0; i < n; i++) {
          if (ci === 0 && !sleeve[i] && !released) continue;
          if (ci === 1 && (sleeve[i] || released)) continue;
          const px = x[i * 3] ?? 0,
            py = x[i * 3 + 1] ?? 0,
            pz = x[i * 3 + 2] ?? 0;
          if (py > top) continue;
          let v = hint[i] ?? 0;
          v = v < 0 || s === 0 ? col.search(px, py, pz) : col.climb(v, px, py, pz);
          hint[i] = v;
          if (v < 0) continue;
          const nx = col.N[v * 3] ?? 0,
            ny = col.N[v * 3 + 1] ?? 0,
            nz = col.N[v * 3 + 2] ?? 0,
            d =
              (px - (col.P[v * 3] ?? 0)) * nx +
              (py - (col.P[v * 3 + 1] ?? 0)) * ny +
              (pz - (col.P[v * 3 + 2] ?? 0)) * nz;
          if (py < inside) {
            if (d > tuckLimit) {
              x[i * 3] = px - nx * (d - tuckLimit);
              x[i * 3 + 1] = py - ny * (d - tuckLimit);
              x[i * 3 + 2] = pz - nz * (d - tuckLimit);
            }
            continue;
          }
          if (d >= clearance || d < -reach) continue;
          const push = clearance - d;
          let qx = px + nx * push,
            qy = py + ny * push,
            qz = pz + nz * push;
          const mx = qx - (prev[i * 3] ?? 0),
            my = qy - (prev[i * 3 + 1] ?? 0),
            mz = qz - (prev[i * 3 + 2] ?? 0),
            along = mx * nx + my * ny + mz * nz,
            tx = mx - along * nx,
            ty = my - along * ny,
            tz = mz - along * nz,
            tl = Math.hypot(tx, ty, tz),
            grip =
              frame < stitchEnd
                ? 0
                : squeezed[i]
                  ? tl < stick * push
                    ? 1
                    : Math.min(1, (slide * push) / tl)
                  : friction;
          qx -= grip * tx;
          qy -= grip * ty;
          qz -= grip * tz;
          x[i * 3] = qx;
          x[i * 3 + 1] = qy;
          x[i * 3 + 2] = qz;
        }
      });
      if (frame >= stitchEnd && s % 2 === 1) self.solve(x);
      const most = 3;
      for (let i = 0; i < n; i++) {
        let vx = ((x[i * 3] ?? 0) - (prev[i * 3] ?? 0)) / dt,
          vy = ((x[i * 3 + 1] ?? 0) - (prev[i * 3 + 1] ?? 0)) / dt,
          vz = ((x[i * 3 + 2] ?? 0) - (prev[i * 3 + 2] ?? 0)) / dt;
        const speed = Math.hypot(vx, vy, vz);
        const scale = (speed > most ? most / speed : 1) * damping;
        vx *= scale;
        vy *= scale;
        vz *= scale;
        vel[i * 3] = vx;
        vel[i * 3 + 1] = vy;
        vel[i * 3 + 2] = vz;
      }
    }
  }
  const root = Int32Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (at(root, i) !== i) {
      root[i] = at(root, at(root, i));
      i = at(root, i);
    }
    return i;
  };
  for (const [i, j] of stitch) {
    const a = find(i),
      b = find(j);
    if (a !== b) root[Math.max(a, b)] = Math.min(a, b);
  }
  const sum = new Float64Array(n * 3),
    count = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const r = find(i);
    count[r] = at(count, r) + 1;
    for (let c = 0; c < 3; c++) sum[r * 3 + c] = at(sum, r * 3 + c) + (x[i * 3 + c] ?? 0);
  }
  for (let i = 0; i < n; i++) {
    const r = find(i);
    for (let c = 0; c < 3; c++) x[i * 3 + c] = at(sum, r * 3 + c) / at(count, r);
  }
  return {
    x,
    substeps: frames * sub,
    strap: strap && options.belt ? strap.envelope(m, options.belt.reach) : null,
  };
}

function welded(layout: Layout, stitch: ReadonlyArray<readonly [number, number]>, x: Float64Array) {
  const n = layout.count,
    root = Int32Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (at(root, i) !== i) i = at(root, i);
    return i;
  };
  for (const [i, j] of stitch) {
    const a = find(i),
      b = find(j);
    if (a !== b) root[Math.max(a, b)] = Math.min(a, b);
  }
  const index = new Int32Array(n).fill(-1),
    owner: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (at(index, r) < 0) {
      index[r] = owner.length;
      owner.push(r);
    }
    index[i] = at(index, r);
  }
  const tri: number[] = [],
    local: number[] = [];
  layout.panels.forEach((panel, pi) => {
    const base = at(layout.offset, pi),
      flip = layout.flip[pi] ?? false;
    for (let t = 0; t < panel.tri.length; t += 3) {
      const a = base + at(panel.tri, t),
        b = base + at(panel.tri, t + 1),
        c = base + at(panel.tri, t + 2);
      if (flip) local.push(a, c, b);
      else local.push(a, b, c);
    }
  });
  for (const i of local) tri.push(at(index, i));
  const pos = owner.flatMap((i) => [at(x, i * 3), at(x, i * 3 + 1), at(x, i * 3 + 2)]);
  const nrm = new Float64Array(owner.length * 3);
  for (let t = 0; t < tri.length; t += 3) {
    const a = at(tri, t),
      b = at(tri, t + 1),
      c = at(tri, t + 2);
    const pa: Vec = [at(pos, a * 3), at(pos, a * 3 + 1), at(pos, a * 3 + 2)],
      f = cross(
        sub([at(pos, b * 3), at(pos, b * 3 + 1), at(pos, b * 3 + 2)], pa),
        sub([at(pos, c * 3), at(pos, c * 3 + 1), at(pos, c * 3 + 2)], pa),
      );
    for (const v of [a, b, c])
      for (let d = 0; d < 3; d++) nrm[v * 3 + d] = at(nrm, v * 3 + d) + (f[d] ?? 0);
  }
  for (let v = 0; v < owner.length; v++) {
    const l = Math.hypot(at(nrm, v * 3), at(nrm, v * 3 + 1), at(nrm, v * 3 + 2)) || 1;
    for (let d = 0; d < 3; d++) nrm[v * 3 + d] = at(nrm, v * 3 + d) / l;
  }
  return { index, owner, pos, nrm, tri, local };
}

export function sewShirt(body: DressBody, m: Landmarks, options: SewOptions): Sewn {
  const started = performance.now(),
    k = m.k,
    spacing = 0.022 * k,
    lift = 0.7,
    draft = draftShirt(body, m, options.spec),
    panels = meshPanels(draft, spacing),
    layout = place(body, m, draft, panels, lift),
    pairs = stitches(layout, draft);
  const key = fingerprint(body, options, spacing);
  let hit = memo.get(key),
    substeps = 0;
  const cached = !!hit;
  if (!hit) {
    const run = simulate(body, m, layout, pairs, options, lift, spacing);
    hit = { x: run.x, strap: run.strap };
    substeps = run.substeps;
    memo.set(key, hit);
    while (memo.size > 4) {
      const first = memo.keys().next().value;
      if (first === undefined) break;
      memo.delete(first);
    }
  }
  const x = hit.x,
    w = welded(layout, pairs, x);
  const panelOf = new Int32Array(layout.count);
  layout.panels.forEach((_, pi) => {
    const end = pi + 1 < layout.offset.length ? at(layout.offset, pi + 1) : layout.count;
    for (let i = at(layout.offset, pi); i < end; i++) panelOf[i] = pi;
  });
  const skins: Skin[] = w.owner.map((i) => {
    const p: Vec = [
      at(w.pos, at(w.index, i) * 3),
      at(w.pos, at(w.index, i) * 3 + 1),
      at(w.pos, at(w.index, i) * 3 + 2),
    ];
    return (layout.panels[at(panelOf, i)]?.name ?? "").startsWith("sleeve")
      ? body.skinAt(p)
      : body.trunkAt(p);
  });
  const arm = body.weight(new RegExp("^" + FINGERS));
  const s = new Shell();
  s.pos = w.pos.slice();
  s.nrm = Array.from(w.nrm);
  s.anc = s.pos.map((v, i) => v - at(w.nrm, i) * 0.004 * k);
  s.tri = w.tri.slice();
  s.bones = skins.flatMap((sk) => [...sk[0]]);
  s.weights = skins.flatMap((sk) => [...sk[1]]);
  s.f = {
    wArm: w.owner.map((i) => {
      const v = body.nearest([at(x, i * 3), at(x, i * 3 + 1), at(x, i * 3 + 2)], 3);
      return v < 0 ? 0 : at(arm, v);
    }),
  };
  const boundary = loops(s),
    mean = (loop: ReadonlyArray<number>, axis: number) =>
      loop.reduce((t, i) => t + at(s.pos, i * 3 + axis), 0) / loop.length;
  const sleeves = boundary.filter((l) => Math.abs(mean(l, 0)) > 0.12 * k),
    middle = boundary
      .filter((l) => Math.abs(mean(l, 0)) <= 0.12 * k)
      .sort((a, b) => mean(b, 1) - mean(a, 1));
  const view: SewnView = {
    s,
    upper: middle[0] ?? null,
    lower: middle.length > 1 ? (middle.at(-1) ?? null) : null,
    sleeves,
  };
  const piece = new Piece(),
    t = options.thickness,
    uv: number[] = [],
    weld: number[] = [];
  let u0 = Infinity,
    v0 = Infinity,
    u1 = -Infinity,
    v1 = -Infinity;
  const chartOf = (i: number): readonly [number, number] => {
    const pi = at(panelOf, i),
      panel = layout.panels[pi],
      local = i - at(layout.offset, pi),
      [u, v] = panel?.uv[local] ?? [0, 0],
      [cu, cv] = panel?.chart ?? [0, 0];
    return [u + cu, v + cv];
  };
  for (let i = 0; i < layout.count; i++) {
    const [u, v] = chartOf(i);
    u0 = Math.min(u0, u);
    v0 = Math.min(v0, v);
    u1 = Math.max(u1, u);
    v1 = Math.max(v1, v);
  }
  u0 -= 0.008;
  v0 -= 0.008;
  const du = u1 - u0 + 0.008,
    dv = v1 - v0 + 0.008;
  const vertex = (i: number, inner: boolean) => {
    const r = at(w.index, i),
      p: Vec = [at(w.pos, r * 3), at(w.pos, r * 3 + 1), at(w.pos, r * 3 + 2)],
      nr: Vec = [at(w.nrm, r * 3), at(w.nrm, r * 3 + 1), at(w.nrm, r * 3 + 2)],
      [u, v] = chartOf(i),
      id = piece.vertex(inner ? add(p, nr, -t) : p, skins[r] ?? body.rigid("spine_02"));
    uv.push((u - u0) / du, (v - v0) / dv);
    return id;
  };
  const outer = Int32Array.from({ length: layout.count }, (_, i) => vertex(i, false));
  for (let i = 0; i < layout.count; i++) weld.push(at(w.index, i));
  const inner = Int32Array.from({ length: layout.count }, (_, i) => vertex(i, true));
  for (let i = 0; i < layout.count; i++) weld.push(w.owner.length + at(w.index, i));
  for (let c = 0; c < w.local.length; c += 3) {
    const a = at(w.local, c),
      b = at(w.local, c + 1),
      d = at(w.local, c + 2);
    piece.tri.push(at(outer, a), at(outer, b), at(outer, d));
    piece.tri.push(at(inner, a), at(inner, d), at(inner, b));
  }
  const edgeUse = new Map<string, number>(),
    directed: Array<readonly [number, number]> = [];
  for (let c = 0; c < w.tri.length; c += 3)
    for (let e = 0; e < 3; e++) {
      const a = at(w.tri, c + e),
        b = at(w.tri, c + ((e + 1) % 3)),
        key = Math.min(a, b) + ":" + Math.max(a, b);
      edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1);
      directed.push([a, b]);
    }
  const rep = new Int32Array(w.owner.length);
  w.owner.forEach((i, r) => {
    rep[r] = i;
  });
  for (const [a, b] of directed) {
    if (edgeUse.get(Math.min(a, b) + ":" + Math.max(a, b)) !== 1) continue;
    const oa = vertex(at(rep, a), false),
      ob = vertex(at(rep, b), false),
      ia = vertex(at(rep, a), true),
      ib = vertex(at(rep, b), true);
    weld.push(-1, -1, -1, -1);
    piece.tri.push(oa, ia, ib, oa, ib, ob);
  }
  piece.uv = uv;
  piece.weld = weld;
  piece.chart = { u0, v0, du, dv };
  const cover = coverShell(body, w.pos, w.tri, k);
  const triangles = w.tri.length / 3;
  return {
    piece,
    view,
    cover,
    strap: hit.strap,
    stats: {
      particles: layout.count,
      triangles,
      substeps,
      milliseconds: performance.now() - started,
      cached,
    },
  };
}

function coverShell(
  body: DressBody,
  pos: ReadonlyArray<number>,
  tri: ReadonlyArray<number>,
  k: number,
): Shell {
  const cast = raycaster(pos, tri),
    s = bodyShell(body),
    covered = new Float32Array(s.count);
  for (let v = 0; v < s.count; v++) {
    const a = s.anchor(v),
      n = s.normal(v),
      d = cast(add(a, n, -0.002 * k), n);
    if (d < 0.15 * k) {
      s.set(v, add(a, n, Math.max(0.001 * k, d - 0.002 * k)));
      covered[v] = 1;
    } else covered[v] = -1;
  }
  return cut(s, (i) => at(covered, i));
}
