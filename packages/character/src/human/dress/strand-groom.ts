import * as T from "three";
import { context2d, type Raster } from "../../raster.js";
import type { HumanBody } from "../body.js";
import type { HumanSurface } from "../surface.js";
import { evaluateHuman } from "../surface.js";
import type { BuzzScalp } from "../paint-data.js";
import { buzzCut } from "./buzz.js";
import { landmarks } from "./cloth.js";
import { lengthCards } from "./groom-lengths.js";
import { tiedLengths, type HairTie, type TiedHairStyle } from "./hair-lengths.js";
import { sweptScalpTexture } from "./swept-scalp.js";
import type { DressMesh } from "./kit.js";
import {
  add,
  at as item,
  bodyShell,
  clamp,
  connected,
  cross,
  cut,
  dot,
  hash1,
  length,
  mix,
  noise3,
  smooth,
  sub,
  subdivide,
  unit,
  type DressBody,
  type Skin,
  type Vec,
} from "./kit.js";
import { surfaceBody, surfaceFrame, type Aim, type HeadFrame } from "./fringe.js";
import { grownHairStyles, type GrownHairStyle } from "./styles.js";

const DEG = Math.PI / 180,
  TAU = Math.PI * 2;

interface Spec {
  readonly top: number;
  readonly front: number;
  readonly side: number;
  readonly edge: number;
  readonly fade: number;
  readonly lay: number;
  readonly burn: number;
  readonly fringe: number;
  readonly openCrown?: boolean;
  readonly comb?: Comb;
  readonly scalp?: number;
  readonly lengths?: boolean;
  readonly swept?: { readonly gather?: Vec };
}

const TIED_SCALP = {
  top: 56,
  front: 0,
  side: 46,
  edge: 12,
  fade: 6,
  lay: 0.06,
  burn: 0.35,
  fringe: 1,
  lengths: true,
} as const;

const SPECS: Readonly<Record<GrownHairStyle, Spec>> = {
  "Tapered crop": {
    top: 30,
    front: 0.25,
    side: 9,
    edge: 2.2,
    fade: 17,
    lay: 0.24,
    burn: 0.42,
    fringe: 5,
  },
  "Horseshoe crop": {
    top: 24,
    front: 0,
    side: 18,
    edge: 2,
    fade: 13,
    lay: 0.23,
    burn: 0.64,
    fringe: 0,
    openCrown: true,
  },
  "Close crop": {
    top: 9,
    front: 0.1,
    side: 5.5,
    edge: 2,
    fade: 10,
    lay: 0.42,
    burn: 0.3,
    fringe: 2,
  },
  "Buzz cut": { top: 5, front: 0, side: 3.6, edge: 1.5, fade: 9, lay: 0.55, burn: 0.25, fringe: 1 },
  Crop: { top: 21, front: 0.3, side: 10, edge: 3, fade: 13, lay: 0.3, burn: 0.4, fringe: 4 },
  "Side part": {
    top: 44,
    front: 0.2,
    side: 17,
    edge: 4,
    fade: 15,
    lay: 0.2,
    burn: 0.45,
    fringe: 5,
  },
  "Swept back": {
    top: 50,
    front: 0.25,
    side: 19,
    edge: 4,
    fade: 15,
    lay: 0.2,
    burn: 0.45,
    fringe: 1.5,
    comb: "Off the face",
  },
  Ponytail: { ...TIED_SCALP, swept: {} },
  Bun: { ...TIED_SCALP, swept: {} },
  Braid: { ...TIED_SCALP, swept: { gather: [0, -0.3, -1] } },
};

interface EarBox {
  front: number;
  back: number;
  top: number;
  low: number;
}

const earSourceCache = new WeakMap<HumanBody, ReadonlySet<number>>();
export function earSources(human: HumanBody): ReadonlySet<number> {
  const known = earSourceCache.get(human);
  if (known) return known;
  const s = evaluateHuman(human, { height: 1.72 }),
    body = surfaceBody(s),
    f = surfaceFrame(s),
    head = body.weight(/^head/),
    folded = new Uint8Array(body.count);
  for (let v = 0; v < body.count; v++) {
    if (item(head, v) < 0.5) continue;
    const p = body.point(v),
      at = f.aim(p),
      side = Math.abs(at.phi) / DEG,
      up = at.eps / DEG;
    if (side < 62 || side > 132 || up < -50 || up > 12) continue;
    const d = sub(p, f.centre);
    if (
      (item(body.N, v * 3) * d[0] +
        item(body.N, v * 3 + 1) * d[1] +
        item(body.N, v * 3 + 2) * d[2]) /
        length(d) <
      0.2
    )
      folded[v] = 1;
  }
  const found = new Set<number>();
  for (let t = 0; t < body.tri.length; t += 3) {
    const a = item(body.tri, t),
      b = item(body.tri, t + 1),
      c = item(body.tri, t + 2);
    if (folded[a] || folded[b] || folded[c]) for (const v of [a, b, c]) found.add(item(s.ids, v));
  }
  earSourceCache.set(human, found);
  return found;
}

function measureEars(
  human: HumanBody,
  body: DressBody,
  f: HeadFrame,
): { readonly mark: Uint8Array; readonly sides: readonly [EarBox, EarBox] } {
  const source = earSources(human),
    ids = body.surface.ids,
    mark = new Uint8Array(body.count);
  const box = (): EarBox => ({ front: Infinity, back: -Infinity, top: -Infinity, low: Infinity });
  const sides: [EarBox, EarBox] = [box(), box()];
  for (let v = 0; v < body.count; v++) {
    if (!source.has(item(ids, v))) continue;
    mark[v] = 1;
    const at = f.aim(body.point(v)),
      e = sides[at.phi > 0 ? 0 : 1],
      side = Math.abs(at.phi);
    e.front = Math.min(e.front, side);
    e.back = Math.max(e.back, side);
    e.top = Math.max(e.top, at.eps);
    e.low = Math.min(e.low, at.eps);
  }
  for (const e of sides)
    if (!Number.isFinite(e.front))
      Object.assign(e, { front: 84 * DEG, back: 106 * DEG, top: -10 * DEG, low: -46 * DEG });
  return { mark, sides };
}

function curve(knots: ReadonlyArray<readonly [number, number]>): (at: number) => number {
  const n = knots.length,
    x = knots.map((k) => k[0]),
    y = knots.map((k) => k[1]),
    d: number[] = [],
    m: number[] = Array.from({ length: n }, () => 0);
  const X = (i: number) => item(x, i),
    Y = (i: number) => item(y, i),
    D = (i: number) => item(d, i),
    M = (i: number) => item(m, i);
  for (let i = 0; i + 1 < n; i++) d.push((Y(i + 1) - Y(i)) / (X(i + 1) - X(i)));
  m[0] = D(0);
  m[n - 1] = D(n - 2);
  for (let i = 1; i + 1 < n; i++)
    if (D(i - 1) * D(i) > 0) {
      const a = X(i) - X(i - 1),
        b = X(i + 1) - X(i);
      m[i] = (3 * (a + b)) / ((2 * b + a) / D(i - 1) + (b + 2 * a) / D(i));
    }
  return (at) => {
    if (at <= X(0)) return Y(0);
    if (at >= X(n - 1)) return Y(n - 1);
    let i = 0;
    while (at > X(i + 1)) i++;
    const h = X(i + 1) - X(i),
      t = (at - X(i)) / h;
    return (
      (2 * t ** 3 - 3 * t * t + 1) * Y(i) +
      (t ** 3 - 2 * t * t + t) * h * M(i) +
      (3 * t * t - 2 * t ** 3) * Y(i + 1) +
      (t ** 3 - t * t) * h * M(i + 1)
    );
  };
}

function sideLine(ear: EarBox, spec: Spec): (at: number) => number {
  const F = clamp(ear.front / DEG, 76, 96),
    B = clamp(ear.back / DEG, F + 12, 118),
    top = ear.top / DEG,
    low = ear.low / DEG,
    burn = mix(top, low, spec.burn);
  return curve([
    [0, 27],
    [28, 28],
    [47, 31],
    [F - 25, 29],
    [F - 18.5, 14],
    [F - 15.5, burn + 7],
    [F - 13, burn + (spec.swept ? 6 : 0)],
    [F - 6, burn],
    [F - 3.5, burn + (spec.swept ? 9 : 4)],
    [F - 1, top + 3.5],
    [B + 1, top + 3.5],
    [B + 6, top - 2],
    [B + 13, mix(top, low, 0.5)],
    [B + 24, low + 3],
    [Math.max(B + 34, 147), -47],
    [165, -52],
    [180, -50],
  ]);
}

interface ScalpAt {
  readonly r: number;
  readonly n: Vec;
  readonly v: number;
}

function scalpMap(
  body: DressBody,
  f: HeadFrame,
  ears: { readonly mark: Uint8Array },
): (u: Vec) => ScalpAt {
  const A = 240,
    B = 120,
    R = new Float32Array(A * B),
    N = new Float32Array(A * B * 3),
    V = new Int32Array(A * B).fill(-1);
  const scalp = body.weight(/^(head|neck)/),
    P = body.P,
    BN = body.N,
    c = f.centre,
    at = new Float32Array(body.count * 3),
    used = new Uint8Array(body.count);
  for (let v = 0; v < body.count; v++) {
    if (item(scalp, v) < 0.3 || ears.mark[v]) continue;
    const dx = item(P, v * 3) - c[0],
      dy = item(P, v * 3 + 1) - c[1],
      dz = item(P, v * 3 + 2) - c[2],
      r = Math.hypot(dx, dy, dz);
    let a = Math.atan2(dy, dz);
    if (a < -Math.PI / 2) a += TAU;
    at[v * 3] = ((a + Math.PI / 2) / TAU) * A;
    at[v * 3 + 1] = ((Math.asin(clamp(dx / r, -1, 1)) + Math.PI / 2) / Math.PI) * B;
    at[v * 3 + 2] = r;
    used[v] = 1;
  }
  const g = (i: number) => item(at, i),
    n3 = (i: number) => item(BN, i),
    p3 = (i: number) => item(P, i);
  for (let t = 0; t < body.tri.length; t += 3) {
    const i = item(body.tri, t),
      j = item(body.tri, t + 1),
      k = item(body.tri, t + 2);
    if (!used[i] || !used[j] || !used[k]) continue;
    const x0 = g(i * 3),
      y0 = g(i * 3 + 1),
      x1 = g(j * 3),
      y1 = g(j * 3 + 1),
      x2 = g(k * 3),
      y2 = g(k * 3 + 1);
    const lo = Math.min(x0, x1, x2),
      hi = Math.max(x0, x1, x2);
    if (hi - lo > A / 2) continue;
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-9) continue;
    const mx = (p3(i * 3) + p3(j * 3) + p3(k * 3)) / 3 - c[0],
      my = (p3(i * 3 + 1) + p3(j * 3 + 1) + p3(k * 3 + 1)) / 3 - c[1],
      mz = (p3(i * 3 + 2) + p3(j * 3 + 2) + p3(k * 3 + 2)) / 3 - c[2];
    if (
      (n3(i * 3) + n3(j * 3) + n3(k * 3)) * mx +
        (n3(i * 3 + 1) + n3(j * 3 + 1) + n3(k * 3 + 1)) * my +
        (n3(i * 3 + 2) + n3(j * 3 + 2) + n3(k * 3 + 2)) * mz <=
      0
    )
      continue;
    const ya = Math.min(y0, y1, y2),
      yb = Math.max(y0, y1, y2);
    for (
      let row = Math.max(0, Math.floor(ya - 0.5));
      row <= Math.min(B - 1, Math.ceil(yb - 0.5));
      row++
    )
      for (
        let col = Math.max(0, Math.floor(lo - 0.5));
        col <= Math.min(A - 1, Math.ceil(hi - 0.5));
        col++
      ) {
        const x = col + 0.5,
          y = row + 0.5;
        const w0 = ((x1 - x) * (y2 - y) - (x2 - x) * (y1 - y)) / area,
          w1 = ((x2 - x) * (y0 - y) - (x0 - x) * (y2 - y)) / area,
          w2 = 1 - w0 - w1;
        if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue;
        const r = w0 * g(i * 3 + 2) + w1 * g(j * 3 + 2) + w2 * g(k * 3 + 2),
          cell = row * A + col;
        if (r <= item(R, cell)) continue;
        R[cell] = r;
        for (let d = 0; d < 3; d++)
          N[cell * 3 + d] = w0 * n3(i * 3 + d) + w1 * n3(j * 3 + d) + w2 * n3(k * 3 + d);
        V[cell] = w0 >= w1 && w0 >= w2 ? i : w1 >= w2 ? j : k;
      }
  }
  const steps: ReadonlyArray<readonly [number, number]> = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ];
  for (let pass = 0; pass < 24; pass++) {
    const old = R.slice();
    let empty = 0;
    for (let row = 0; row < B; row++)
      for (let col = 0; col < A; col++) {
        const cell = row * A + col;
        if (item(old, cell) > 0) continue;
        let sum = 0,
          count = 0,
          from = -1;
        for (const [dr, dc] of steps) {
          const r = row + dr,
            q = col + dc;
          if (r < 0 || r >= B || q < 0 || q >= A || !(item(old, r * A + q) > 0)) continue;
          sum += item(old, r * A + q);
          count++;
          from = r * A + q;
        }
        if (!count) {
          empty++;
          continue;
        }
        R[cell] = sum / count;
        V[cell] = item(V, from);
        for (let d = 0; d < 3; d++) N[cell * 3 + d] = item(N, from * 3 + d);
      }
    if (!empty) break;
  }
  return (u) => {
    let a = Math.atan2(u[1], u[2]);
    if (a < -Math.PI / 2) a += TAU;
    const x = clamp(((a + Math.PI / 2) / TAU) * A - 0.5, 0, A - 1.001),
      y = clamp(((Math.asin(clamp(u[0], -1, 1)) + Math.PI / 2) / Math.PI) * B - 0.5, 0, B - 1.001);
    const col = Math.floor(x),
      row = Math.floor(y),
      s = x - col,
      t = y - row,
      c00 = row * A + col,
      c01 = c00 + 1,
      c10 = c00 + A,
      c11 = c10 + 1;
    const w = [(1 - s) * (1 - t), s * (1 - t), (1 - s) * t, s * t],
      cells = [c00, c01, c10, c11],
      n: [number, number, number] = [0, 0, 0];
    let r = 0,
      best = 0;
    for (let i = 0; i < 4; i++) {
      const wi = item(w, i),
        ci = item(cells, i);
      r += wi * item(R, ci);
      if (wi > item(w, best)) best = i;
      for (let d = 0; d < 3; d++) n[d] = item(n, d) + wi * item(N, ci * 3 + d);
    }
    return { r, n: unit(n), v: item(V, item(cells, best)) };
  };
}

const scale = (v: Vec, s: number): Vec => [v[0] * s, v[1] * s, v[2] * s];
const tangent = (q: Vec, v: Vec): Vec => {
  const along = dot(q, v);
  return unit([v[0] - q[0] * along, v[1] - q[1] * along, v[2] - q[2] * along]);
};
const aimAt = (phi: number, eps: number): Vec => [
  Math.cos(eps) * Math.sin(phi),
  Math.sin(eps),
  Math.cos(eps) * Math.cos(phi),
];
function onArc(q: Vec, a: Vec, b: Vec): Vec {
  const n = unit(cross(a, b)),
    flat = unit(sub(q, scale(n, dot(q, n))));
  if (dot(cross(a, flat), n) >= 0 && dot(cross(flat, b), n) >= 0) return flat;
  return dot(q, a) > dot(q, b) ? a : b;
}

type Comb = "As cut" | "Parted" | "Swept left" | "Swept right" | "Off the face";
interface CombSpec {
  readonly from: ReadonlyArray<Vec>;
  readonly forward: number;
  readonly back: number;
}
const COMBS: Readonly<Record<Comb, CombSpec>> = {
  "As cut": { from: [[0.12, 0.8, -0.58]], forward: 0.15, back: 0.3 },
  Parted: { from: [[0.05, 0.8, -0.6], aimAt(-5 * DEG, 30 * DEG)], forward: 0.45, back: 0.3 },
  "Swept left": { from: [[-0.1, 0.8, -0.58], aimAt(-42 * DEG, 31 * DEG)], forward: 0.6, back: 0.3 },
  "Swept right": { from: [[0.1, 0.8, -0.58], aimAt(42 * DEG, 31 * DEG)], forward: 0.6, back: 0.3 },
  "Off the face": {
    from: [aimAt(-72 * DEG, 8 * DEG), aimAt(0, 12 * DEG), aimAt(72 * DEG, 8 * DEG)],
    forward: 0,
    back: 0.85,
  },
};
const isComb = (name: string | undefined): name is Comb =>
  name !== undefined && Object.hasOwn(COMBS, name);

interface Flow {
  (q: Vec): Vec;
  readonly reach: (q: Vec) => number;
}

function combing(look: Comb, gather: Vec | null): Flow {
  const comb = COMBS[look],
    from = comb.from.map(unit),
    to = gather && unit(gather);
  const first = from[0] ?? unit([0.12, 0.8, -0.58]);
  const sourceOf = (q: Vec): Vec => {
    let source = first;
    if (from.length > 1) {
      let best = -2;
      for (let i = 0; i + 1 < from.length; i++) {
        const p = onArc(q, from[i] ?? first, from[i + 1] ?? first),
          near = dot(p, q);
        if (near > best) {
          best = near;
          source = p;
        }
      }
    }
    return source;
  };
  const flow = (q: Vec): Vec => {
    const source = sourceOf(q),
      away = sub(scale(q, dot(q, source)), source),
      far = length(away);
    const forward = tangent(q, [0, 0, 1]),
      down = tangent(q, [0, -1, 0]),
      rear = tangent(q, [0, 0, -1]);
    let top: Vec = far > 1e-4 ? [away[0] / far, away[1] / far, away[2] / far] : forward;
    top = unit(add(top, forward, comb.forward * smooth(0.1, 0.6, q[1])));
    const low = unit(add(down, rear, comb.back * Math.abs(q[0]))),
      hang = smooth(40 * DEG, 12 * DEG, Math.asin(clamp(q[1], -1, 1)));
    let lie = tangent(q, [
      mix(top[0], low[0], hang),
      mix(top[1], low[1], hang),
      mix(top[2], low[2], hang),
    ]);
    if (to) {
      const pull = sub(to, q);
      lie = length(pull) > 0.05 ? tangent(q, pull) : down;
    }
    const turn =
        0.5 * (noise3(q[0] * 5 + 11, q[1] * 5, q[2] * 5) - 0.5) +
        0.3 * (noise3(q[0] * 17, q[1] * 17 + 5, q[2] * 17) - 0.5),
      side = cross(q, lie);
    return unit(add(scale(lie, Math.cos(turn)), side, Math.sin(turn)));
  };
  return Object.assign(flow, {
    reach: (q: Vec) => Math.acos(clamp(dot(q, to ?? sourceOf(q)), -1, 1)),
  });
}

type Tile = readonly [number, number, number, number];
const TILES: {
  readonly long: ReadonlyArray<Tile>;
  readonly short: ReadonlyArray<Tile>;
  readonly solid: Tile;
} = {
  long: Array.from({ length: 4 }, (_, i): Tile => [i * 64, 0, 64, 128]),
  short: Array.from({ length: 7 }, (_, i): Tile => [
    (i % 4) * 64,
    128 + Math.floor(i / 4) * 64,
    64,
    64,
  ]),
  solid: [192, 192, 64, 64],
};

let artwork: {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
} | null = null;
function tuftPixels(): {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
} {
  if (artwork) return artwork;
  const size = 256,
    data = new Uint8ClampedArray(size * size * 4);
  const draw = (
    [left, top, wide, tall]: Tile,
    seed: number,
    {
      strands,
      thick,
      reach,
      ragged,
      locks = 3,
    }: {
      readonly strands: number;
      readonly thick: number;
      readonly reach: number;
      readonly ragged: number;
      readonly locks?: number;
    },
  ) => {
    const rows: {
      x0: number;
      to: number;
      root: number;
      tip: number;
      lean: number;
      wave: number;
      phase: number;
      turns: number;
      thick: number;
      tone: number;
    }[] = [];
    const points = Array.from(
      { length: locks },
      (_, i) => 7 + ((wide - 14) * (i + 0.25 + 0.5 * hash1(seed * 53 + i))) / locks,
    );
    for (let s = 0; s < strands; s++) {
      const rnd = (n: number) => hash1(seed * 977 + s * 31 + n),
        x0 = 5 + ((wide - 10) * (s + 0.15 + 0.7 * rnd(1))) / strands;
      const to = points.reduce(
          (best, x) => (Math.abs(x - x0) < Math.abs(best - x0) ? x : best),
          item(points, 0),
        ),
        far = Math.abs(to - x0) / (wide / locks);
      rows.push({
        x0,
        to,
        root: ragged * rnd(2) * rnd(3),
        tip: 1 - reach * clamp(0.25 * rnd(4) + 1.5 * far) ** 1.3,
        lean: (rnd(5) - 0.5) * 5,
        wave: 1.2 * rnd(6),
        phase: TAU * rnd(7),
        turns: 0.7 + 1.5 * rnd(8),
        thick: thick * (0.75 + 0.5 * rnd(9)),
        tone: (0.42 + 0.58 * rnd(10)) * (0.84 + 0.16 * hash1(seed * 71 + Math.round(to))),
      });
    }
    for (let y = 0; y < tall; y++) {
      const t = 1 - (y + 0.5) / tall,
        centres = rows.map(
          (r) =>
            mix(r.x0, r.to, 0.8 * smooth(0.3, 1, t)) +
            r.lean * t * t * (1 - t) * 2 +
            r.wave * Math.sin(r.phase + r.turns * Math.PI * t) * (1 - 0.6 * t),
        );
      for (let x = 0; x < wide; x++) {
        let cover = 0,
          tone = 0,
          near = Infinity,
          nearTone = 0.8;
        rows.forEach((r, i) => {
          const along = (t - r.root) / (r.tip - r.root),
            far = Math.abs(x + 0.5 - item(centres, i));
          if (along > -0.15 && along < 1.1 && far < near) {
            near = far;
            nearTone = r.tone;
          }
          if (along <= 0 || along >= 1) return;
          const half = r.thick * smooth(0, 0.1, along) * mix(1, 0.32, along ** 1.4),
            c = clamp(half - far + 0.5);
          if (c > cover) {
            cover = c;
            tone = r.tone * (0.74 + 0.26 * clamp((half - far) / 1.2));
          }
        });
        const shade = ((cover > 0 ? tone : nearTone) * (0.8 + 0.2 * t)) ** (1 / 2.2),
          at = ((top + y) * size + left + x) * 4,
          edge = x < 2 || x >= wide - 2 || y < 1 || y >= tall - 1;
        data[at] = data[at + 1] = data[at + 2] = Math.round(255 * shade);
        data[at + 3] = edge ? 0 : Math.max(Math.round(255 * cover), near < 3.5 ? 14 : 0);
      }
    }
  };
  TILES.long.forEach((tile, i) =>
    draw(tile, 3 + i, { strands: 19, thick: 2.3, reach: 0.4, ragged: 0.1, locks: 2 + (i % 2) }),
  );
  TILES.short.forEach((tile, i) =>
    draw(tile, 40 + i, { strands: 20, thick: 2.2, reach: 0.62, ragged: 0.3, locks: 2 + (i % 2) }),
  );
  {
    const [left, top, wide, tall] = TILES.solid;
    for (let x = 0; x < wide; x++) {
      const fine = hash1(9001 + x),
        broad = noise3(x / 5.5 + 3, 0.5, 7.5);
      for (let y = 0; y < tall; y++) {
        const at = ((top + y) * size + left + x) * 4,
          tone = clamp(
            0.52 + 0.3 * broad + 0.2 * fine + 0.06 * (noise3(x / 3, y / 19, 2.5) - 0.5),
            0.3,
            1,
          );
        data[at] = data[at + 1] = data[at + 2] = Math.round(255 * tone ** (1 / 2.2));
        data[at + 3] = x < 1 || x >= wide - 1 || y < 1 || y >= tall - 1 ? 0 : 255;
      }
    }
  }
  return (artwork = { width: size, height: size, data });
}

const tuftTextures = new WeakMap<Raster, T.CanvasTexture>();
function tuftMap(raster: Raster): T.CanvasTexture {
  const known = tuftTextures.get(raster);
  if (known) return known;
  const { width, height, data } = tuftPixels();
  const canvas = raster.canvas(width, height),
    pen = context2d(canvas),
    image = pen.createImageData(width, height);
  image.data.set(data);
  pen.putImageData(image, 0, 0);
  const map = new T.CanvasTexture(canvas);
  map.name = "Hair tufts";
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = 4;
  tuftTextures.set(raster, map);
  return map;
}

interface Layer {
  readonly position: number[];
  readonly normal: number[];
  color: number[] | null;
  readonly uv: number[] | null;
  index: number[];
  readonly bones: number[];
  readonly weights: number[];
}
const layer = (uv: boolean): Layer => ({
  position: [],
  normal: [],
  color: [],
  uv: uv ? [] : null,
  index: [],
  bones: [],
  weights: [],
});

interface Groom {
  readonly roots: Layer;
  readonly cards: Layer;
  readonly swept: ReadonlyArray<(at: number) => number> | null;
  readonly ties: ReadonlyArray<HairTie>;
}

function groomGeometry(
  human: HumanBody,
  surface: HumanSurface,
  name: GrownHairStyle,
  fringe: string | undefined,
  hairColor: string | undefined,
  skin: string,
  budget: number,
): Groom {
  const spec = SPECS[name];
  const body = surfaceBody(surface),
    f = surfaceFrame(surface),
    k = f.k,
    mm = k / 1000,
    ears = measureEars(human, body, f),
    lines = ears.sides.map((e) => sideLine(e, spec));
  const lengths =
    spec.lengths && isTiedHairStyle(name) ? tiedLengths(body, landmarks(body), name) : null;
  const look: Comb = spec.comb ?? (isComb(fringe) ? fringe : "As cut"),
    flow = combing(look, lengths?.gather ?? spec.swept?.gather ?? null),
    scalp = scalpMap(body, f, ears);
  const hair = new T.Color(hairColor ?? "#48372e"),
    tone = new T.Color(skin);
  const lineOf = (side: number) => lines[side] ?? (() => 0);
  const traced = lines.map((line, side) => {
    const points = new Float32Array(361 * 3);
    for (let i = 0; i <= 360; i++)
      points.set(aimAt((((side ? -1 : 1) * i) / 2) * DEG, line(i / 2) * DEG), i * 3);
    return points;
  });
  const margin = (phi: number, eps: number): number => {
    const side = phi > 0 ? 0 : 1,
      points = traced[side] ?? new Float32Array(),
      q = aimAt(phi, eps);
    let near = -1;
    for (let i = 0; i < points.length; i += 3) {
      const d = q[0] * item(points, i) + q[1] * item(points, i + 1) + q[2] * item(points, i + 2);
      if (d > near) near = d;
    }
    const lower =
      (Math.acos(Math.min(1, near)) / DEG) *
      (eps / DEG >= lineOf(side)(Math.abs(phi) / DEG) ? 1 : -1);
    if (!spec.openCrown) return lower;
    const upper = 30 - 27 * q[2] - 41 * Math.max(0, q[2]) + 2.1 * q[0] - eps / DEG;
    return Math.min(lower, upper);
  };
  const world = (q: Vec): Vec => unit([q[0] * f.radii[0], q[1] * f.radii[1], q[2] * f.radii[2]]);
  const seat = (q: Vec, h: number): { readonly p: Vec; readonly n: Vec; readonly v: number } => {
    const u = world(q),
      at = scalp(u),
      r = at.r;
    return {
      p: [
        f.centre[0] + u[0] * r + at.n[0] * h,
        f.centre[1] + u[1] * r + at.n[1] * h,
        f.centre[2] + u[2] * r + at.n[2] * h,
      ],
      n: at.n,
      v: at.v,
    };
  };
  const lock = (q: Vec): number => {
    let sum = 0,
      a = q,
      b = q;
    for (let i = 0; i < 5; i++) {
      sum +=
        noise3(a[0] * 46 + 5, a[1] * 46, a[2] * 46) + noise3(b[0] * 46 + 5, b[1] * 46, b[2] * 46);
      a = unit(add(a, flow(a), 0.055));
      b = unit(add(b, flow(b), -0.055));
    }
    return clamp((sum / 10 - 0.5) * 5.5, -1, 1);
  };
  const cutAt = (q: Vec, far: number) => {
    const eps = Math.asin(clamp(q[1], -1, 1)),
      top = smooth(14 * DEG, 46 * DEG, eps),
      front = smooth(0.15, 0.85, q[2]) * smooth(0.35, 0.8, q[1]);
    const forehead = spec.openCrown ? 0 : smooth(4 * DEG, 18 * DEG, eps);
    const full = mix(spec.side, spec.top * (1 + spec.front * front), top);
    const len = mix(mix(spec.edge, full, smooth(0, spec.fade, far)), full, forehead) * mm;
    const fade = spec.openCrown
      ? mix(6, 14, smooth(0, 18 * DEG, eps))
      : mix(5.5, 3, smooth(0, 14 * DEG, eps));
    const cover = mix(smooth(0, fade, far) ** 0.8, smooth(-0.5, 2.5, far), forehead);
    const lift = len * mix(0.55, spec.lay, smooth(0.004 * k, 0.018 * k, len));
    return {
      len,
      lift,
      under: 0.0005 * k + clamp(0.2 * lift, 0.0022 * k, 0.004 * k) * smooth(1.5, 9, far),
      top,
      forehead,
      cover,
      fade,
    };
  };

  const roots = layer(Boolean(spec.swept));
  {
    const wear = body.weight(/^(head|neck)/);
    let s = bodyShell(body, { wear });
    const line = Array.from({ length: s.count }, () => -1),
      worn = s.f["wear"] ?? [];
    for (let i = 0; i < s.count; i++) {
      if (item(worn, i) < 0.5 || ears.mark[i]) continue;
      const at = f.aim(s.anchor(i));
      line[i] =
        margin(at.phi, at.eps) +
        (spec.swept ? 3.5 : -1.6) +
        1.5 * (noise3(at.q[0] * 21 + 3, at.q[1] * 21, at.q[2] * 21) - 0.5);
    }
    s = cut(s, (i) => item(line, i));
    s = connected(s, [0, f.top, f.centre[2]]);
    s = subdivide(s);
    for (let i = 0; i < s.count; i++) {
      const a = s.anchor(i),
        at = f.aim(a),
        far = Math.max(0, margin(at.phi, at.eps)),
        here = cutAt(at.q, far),
        n = s.normal(i);
      const lifted = here.under + (spec.swept ? mm * (1.2 + 2.2 * smooth(0, 12, far)) : 0);
      const p = add(a, n, lifted);
      roots.position.push(p[0], p[1], p[2]);
      roots.normal.push(n[0], n[1], n[2]);
      if (spec.swept) {
        const edge = lineOf(at.phi > 0 ? 0 : 1)(Math.abs(at.phi) / DEG);
        const boundary = edge - 6;
        const radius = 0.495 * clamp((90 - at.eps / DEG) / Math.max(1, 90 - boundary));
        roots.uv?.push(0.5 + radius * Math.sin(at.phi), 0.5 + radius * Math.cos(at.phi));
      }
      const shade = (0.66 + 0.16 * lock(at.q)) * mix(1, 0.88, here.top) * (spec.swept ? 0.8 : 1),
        solid = clamp(0.15 + 0.85 * here.cover);
      if (spec.swept) roots.color?.push(1, 1, 1);
      else
        roots.color?.push(
          mix(tone.r, hair.r * shade, solid),
          mix(tone.g, hair.g * shade, solid),
          mix(tone.b, hair.b * shade, solid),
        );
      const [bones, weights] = s.skin(i);
      roots.bones.push(...bones);
      roots.weights.push(...weights);
    }
    roots.index = s.tri.slice();
  }

  const cards = layer(true);
  const wear = body.weight(/^(head|neck)/),
    P = body.P,
    game = budget > 0;
  const point = (v: number): Vec => [item(P, v * 3), item(P, v * 3 + 1), item(P, v * 3 + 2)];
  const plan: {
    readonly a: Vec;
    readonly b: Vec;
    readonly d: Vec;
    readonly count: number;
    readonly t: number;
  }[] = [];
  let wanted = 0;
  for (let t = 0; t < body.tri.length; t += 3) {
    const i = item(body.tri, t),
      j = item(body.tri, t + 1),
      c = item(body.tri, t + 2);
    if (
      item(wear, i) < 0.5 ||
      item(wear, j) < 0.5 ||
      item(wear, c) < 0.5 ||
      ears.mark[i] ||
      ears.mark[j] ||
      ears.mark[c]
    )
      continue;
    const a = point(i),
      b = point(j),
      d = point(c);
    const mid: Vec = [(a[0] + b[0] + d[0]) / 3, (a[1] + b[1] + d[1]) / 3, (a[2] + b[2] + d[2]) / 3],
      at = f.aim(mid),
      far = margin(at.phi, at.eps);
    if (far < -4) continue;
    const here = cutAt(at.q, Math.max(0, far)),
      area = length(cross(sub(b, a), sub(d, a))) / 2;
    const wide = clamp(here.len * 0.3, 0.004 * k, 0.0065 * k),
      layers = mix(1.7, 2.8, here.top) * mix(1, 1.35, here.forehead * smooth(9, 0, far));
    const count = (area * layers) / (wide * Math.max(here.len, 0.006 * k));
    plan.push({ a, b, d, count, t });
    wanted += count;
  }
  const hung = layer(true);
  if (lengths) lengthCards(hung, lengths, { tiles: TILES.long, solid: TILES.solid, hair, k, game });
  const allowed = spec.swept
      ? 0
      : game
        ? Math.floor(((budget * 0.3) / 2.4) * (spec.scalp ?? 1))
        : Math.floor(2600 * (spec.scalp ?? 1)),
    thin = Math.min(1, allowed / Math.max(1, wanted)),
    widen = 1 / Math.sqrt(thin);
  let carry = 0.5,
    card = 0;
  for (const { a, b, d, count, t } of plan) {
    carry += count * thin;
    for (; carry >= 1; carry--) {
      const rnd = (n: number) => hash1(t * 131 + card * 17 + n);
      card++;
      let u = rnd(1),
        v = rnd(2);
      if (u + v > 1) {
        u = 1 - u;
        v = 1 - v;
      }
      const root: Vec = [
        a[0] + (b[0] - a[0]) * u + (d[0] - a[0]) * v,
        a[1] + (b[1] - a[1]) * u + (d[1] - a[1]) * v,
        a[2] + (b[2] - a[2]) * u + (d[2] - a[2]) * v,
      ];
      const at: Aim = f.aim(root),
        far = margin(at.phi, at.eps);
      if (far < 0) continue;
      const here = cutAt(at.q, far);
      const lie = flow,
        t0 = lie(at.q);
      if (
        rnd(3) >
        mix(
          smooth(0.45 * here.fade, here.fade + 1.3, far) ** 0.7,
          smooth(-0.3, 1, far),
          here.forehead,
        )
      )
        continue;
      let len = Math.max(here.len, 0.0045 * k) * (0.65 + 0.6 * rnd(4));
      const base = seat(at.q, 0),
        ahead = seat(unit(add(at.q, t0, 0.04)), 0),
        metre = length(sub(ahead.p, base.p)) / 0.04;
      if (length(sub(base.p, root)) > 0.004 * k) continue;
      const tipFar = (l: number) => {
        const tip = f.aim(seat(unit(add(at.q, t0, l / metre)), 0).p);
        return margin(tip.phi, tip.eps);
      };
      const over = mix(
        1,
        spec.fringe * (0.55 + 0.45 * noise3(at.q[0] * 9 + 2, at.q[1] * 9, at.q[2] * 9)),
        here.forehead,
      );
      if (tipFar(len) < -over) {
        let short = 0,
          reach = len;
        for (let i = 0; i < 7; i++) {
          const mid = (short + reach) / 2;
          if (tipFar(mid) < -over) reach = mid;
          else short = mid;
        }
        len = Math.max(short, 0.12 * len);
      }
      if (len < 0.0025 * k) continue;
      const long = len > 0.009 * k,
        steps = game ? (len > 0.014 * k ? 2 : 1) : len > 0.014 * k ? 3 : len > 0.006 * k ? 2 : 1;
      const wide =
          clamp(len * 0.3, 0.0032 * k, 0.0065 * k) *
          (0.8 + 0.4 * rnd(5)) *
          Math.min(1.5, widen) *
          mix(1, 0.75, here.forehead * smooth(6, 0, far)),
        lift =
          here.lift *
          Math.min(1, len / here.len) *
          (0.6 + 0.4 * rnd(6)) *
          mix(smooth(-1, 6, far), 1, here.forehead) *
          mix(0.35, 1, smooth(0.06, 0.45, flow.reach(at.q)));
      const tiles = long ? TILES.long : TILES.short,
        tile = tiles[Math.floor(rnd(7) * tiles.length) % tiles.length] ?? TILES.solid,
        flip = rnd(8) < 0.5;
      const span = clamp(wide / (0.0065 * k), 0.3, 1),
        start = (1 - span) * rnd(11);
      const roll = (rnd(9) - 0.5) * 0.4,
        tilt =
          0.5 * (noise3(at.q[0] * 7 + 9, at.q[1] * 7, at.q[2] * 7) - 0.5) + 0.2 * (rnd(12) - 0.5),
        shade = (1 + 0.14 * (rnd(10) - 0.5)) * (1 + 0.24 * lock(at.q));
      const fine = 0.5 * (1 - here.forehead) * (1 - smooth(0, here.fade, far));
      const skinning: Skin = body.skinOf(base.v >= 0 ? base.v : body.nearest(root, 8)),
        first = cards.position.length / 3,
        path: { readonly p: Vec; readonly n: Vec; readonly v: number }[] = [];
      let q = at.q;
      for (let step = 0; step <= steps; step++) {
        const along = step / steps;
        path.push(
          seat(
            q,
            mix(
              here.under + 0.0004 * k,
              Math.max(lift, here.under + 0.0012 * k),
              along ** 1.25 * (1 - 0.35 * along ** 3),
            ),
          ),
        );
        if (step < steps) q = unit(add(q, lie(q), len / steps / metre));
      }
      const station = (i: number) => path[i] ?? seat(at.q, 0);
      if (
        path.some(
          (s, step) =>
            step && length(sub(s.p, station(step - 1).p)) > (1.6 * len) / steps + 0.004 * k,
        )
      )
        continue;
      path.forEach((s, step) => {
        const along = step / steps,
          run = unit(sub(station(Math.min(steps, step + 1)).p, station(Math.max(0, step - 1)).p));
        let across = unit(cross(s.n, run));
        across = unit(add(scale(across, Math.cos(roll)), s.n, Math.sin(roll)));
        const half = wide * 0.5 * (1 - 0.3 * along),
          face = unit(
            add(add(cross(run, across), s.n, mix(2.4, 0.8, here.top)), run, tilt * (1 + here.top)),
          );
        for (const sign of [-1, 1]) {
          const p = add(s.p, across, sign * half);
          cards.position.push(p[0], p[1], p[2]);
          cards.normal.push(face[0], face[1], face[2]);
          const value = shade * (0.74 + 0.32 * along);
          cards.color?.push(
            mix(hair.r * value, tone.r, fine),
            mix(hair.g * value, tone.g, fine),
            mix(hair.b * value, tone.b, fine),
          );
          const x = tile[0] + 2 + (tile[2] - 4) * ((sign < 0 !== flip ? 0 : 1) * span + start),
            y = tile[1] + 1.5 + (tile[3] - 3) * (1 - along);
          cards.uv?.push(x / 256, 1 - y / 256);
          cards.bones.push(...skinning[0]);
          cards.weights.push(...skinning[1]);
        }
        if (step) {
          const n = first + step * 2;
          cards.index.push(n - 2, n + 1, n - 1, n - 2, n, n + 1);
        }
      });
    }
  }
  const shift = cards.position.length / 3;
  const append = (to: number[] | null, from: ReadonlyArray<number> | null) => {
    if (to && from) for (const x of from) to.push(x);
  };
  append(cards.position, hung.position);
  append(cards.normal, hung.normal);
  append(cards.color, hung.color);
  append(cards.uv, hung.uv);
  append(cards.bones, hung.bones);
  append(cards.weights, hung.weights);
  for (const i of hung.index) cards.index.push(i + shift);
  return { roots, cards, swept: spec.swept ? lines : null, ties: lengths ? lengths.ties : [] };
}

function meshOf(part: Layer, material: T.Material, name: string, uv: boolean): DressMesh {
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(part.position, 3));
  g.setAttribute("normal", new T.Float32BufferAttribute(part.normal, 3));
  if (part.color) g.setAttribute("color", new T.Float32BufferAttribute(part.color, 3));
  g.setAttribute(
    "uv",
    uv && part.uv
      ? new T.Float32BufferAttribute(part.uv, 2)
      : new T.BufferAttribute(new Float32Array((part.position.length / 3) * 2).fill(0.5), 2),
  );
  g.setIndex(part.index);
  const mesh = new T.Mesh(g, material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.userData["styleRegion"] = "head";
  return {
    mesh,
    region: "head",
    boneIndices: Uint8Array.from(part.bones),
    weights: Float32Array.from(part.weights),
  };
}

const isTiedHairStyle = (name: GrownHairStyle): name is TiedHairStyle =>
  name === "Ponytail" || name === "Bun" || name === "Braid";

export const isGrownHairStyle = (name: string | undefined): name is GrownHairStyle =>
  grownHairStyles.some((style) => style === name);

export function strandGroom(
  human: HumanBody,
  surface: HumanSurface,
  style: {
    readonly hair: GrownHairStyle;
    readonly fringe?: string | undefined;
    readonly hairColor?: string | undefined;
  },
  material: (tone: string, type: string) => T.Material,
  finish: {
    readonly raster: Raster;
    readonly buzz: BuzzScalp;
    readonly sweptTone: Uint8Array;
  } | null,
  skinColor: string,
  gameBudget = 0,
): DressMesh[] {
  if (style.hair === "Buzz cut" && finish)
    return [
      buzzCut(human, surface, style.hairColor, material, skinColor, finish.raster, finish.buzz),
    ];
  const groom = groomGeometry(
    human,
    surface,
    style.hair,
    style.fringe,
    style.hairColor,
    skinColor,
    gameBudget,
  );
  if (!finish) {
    groom.roots.color = null;
    groom.cards.color = null;
  }
  const under = material("#ffffff", "hair").clone(),
    over = material("#ffffff", "hair").clone();
  if (finish) {
    if (under instanceof T.MeshStandardMaterial) {
      under.vertexColors = true;
      under.roughness = 1;
      if (groom.swept) {
        under.map = sweptScalpTexture(
          finish.raster,
          finish.sweptTone,
          groom.swept,
          new T.Color(skinColor),
          new T.Color(style.hairColor ?? "#48372e"),
          style.fringe === "Swept left",
        );
        under.alphaTest = 0.36;
        under.roughness = 0.7;
        under.userData = { ...under.userData, portrait: true, hairCards: true };
      }
    }
    if (over instanceof T.MeshStandardMaterial) {
      over.vertexColors = true;
      over.roughness = 0.72;
      over.map = tuftMap(finish.raster);
    }
    over.alphaTest = 0.4;
  }
  over.side = T.DoubleSide;
  over.userData = { ...over.userData, fibreLOD: true };
  const roots = meshOf(groom.roots, under, style.hair + " roots", Boolean(groom.roots.uv));
  roots.mesh.userData["hairRoots"] = true;
  if (!groom.cards.index.length) {
    over.dispose();
    return [roots];
  }
  const cards = meshOf(groom.cards, over, style.hair, true);
  cards.mesh.userData["strandGroom"] = true;
  cards.mesh.castShadow = false;
  const ties = groom.ties
    .filter((part) => part.piece.tri.length)
    .map((part) => part.piece.mesh(material(part.tone, part.type), "head", part.name));
  return [roots, cards, ...ties];
}
