import type { BrowName, HumanBody } from "./body.js";
import { browRoots, chartPoint, faceChart, type FaceChart } from "./chart.js";
import type { FaceMark } from "./marks.js";

const smooth = (v: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const luminance = (c: ReadonlyArray<number>) =>
  0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);

export const hash = (i: number, j: number, seed: number): number => {
  let h =
    Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^
    Math.imul(j ^ 0xc2b2ae35, 0x27d4eb2f) ^
    Math.imul(seed | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
};
export function noise(x: number, y: number, seed: number): number {
  const i = Math.floor(x),
    j = Math.floor(y),
    a = x - i,
    b = y - j,
    u = a * a * (3 - 2 * a),
    v = b * b * (3 - 2 * b);
  return (
    (hash(i, j, seed) * (1 - u) + hash(i + 1, j, seed) * u) * (1 - v) +
    (hash(i, j + 1, seed) * (1 - u) + hash(i + 1, j + 1, seed) * u) * v
  );
}

const reach = 0.36;
export function sidesOf(mark: FaceMark, central: boolean): number[] {
  if (central) return mark.side === "Right" ? [-1] : [1];
  return mark.side === "Both" ? [1, -1] : [mark.side === "Left" ? 1 : -1];
}
export interface Placement {
  readonly sign: number;
  readonly central: boolean;
  readonly half: boolean;
  readonly centre: readonly [number, number];
  readonly along: readonly [number, number];
}
export function placements(
  mark: FaceMark,
  c: FaceChart,
  [out, up]: readonly [number, number],
  angle = 0,
): Placement[] {
  const central = out === 0,
    u = c.unit,
    turn = ((angle + (mark.turn ?? 0)) * Math.PI) / 180;
  return sidesOf(mark, central).map((sign) => ({
    sign,
    central,
    half: central && mark.side !== "Both",
    centre: [sign * (out + (mark.across ?? 0) * reach) * u, (up + (mark.up ?? 0) * reach) * u],
    along: [sign * Math.cos(turn), Math.sin(turn)],
  }));
}
export const halfOf = (place: Placement, mx: number) =>
  place.half ? smooth(place.sign * mx, -0.5, 0.5) : 1;

export function boxAround(
  c: FaceChart,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): readonly [number, number, number, number] | null {
  const W = c.width,
    H = c.height;
  let i0 = W,
    j0 = H,
    i1 = -1,
    j1 = -1;
  for (let j = 0; j < H; j++)
    for (let i = 0, at = j * W; i < W; i++, at++) {
      const x = c.x[at] ?? 0,
        y = c.y[at] ?? 0;
      if ((c.skin[at] ?? 0) <= 0 || x < x0 || x > x1 || y < y0 || y > y1) continue;
      if (i < i0) i0 = i;
      if (i > i1) i1 = i;
      if (j < j0) j0 = j;
      if (j > j1) j1 = j;
    }
  return i1 < 0 ? null : [i0 - 2, j0 - 2, i1 + 2, j1 + 2];
}
export function slope(c: FaceChart, at: number, dx: number, dy: number): number {
  const nz = Math.max(0.3, c.nz[at] ?? 1),
    lean = ((c.nx[at] ?? 0) * dx + (c.ny[at] ?? 0) * dy) / nz;
  return Math.sqrt(1 + lean * lean);
}
export interface Near {
  distance: number;
  along: number;
  nx: number;
  ny: number;
}
export function toLine(
  points: ReadonlyArray<readonly [number, number]>,
  px: number,
  py: number,
  out: Near,
): Near {
  let best = Infinity,
    where = 0,
    nx = 0,
    ny = 1;
  const last = points.length - 1;
  for (let k = 0; k < last; k++) {
    const [ax, ay] = points[k] ?? [0, 0],
      [bx, by] = points[k + 1] ?? [0, 0],
      ex = bx - ax,
      ey = by - ay,
      t = Math.min(1, Math.max(0, ((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey || 1)));
    const qx = px - ax - ex * t,
      qy = py - ay - ey * t,
      d = qx * qx + qy * qy;
    if (d < best) {
      best = d;
      where = (k + t) / last;
      nx = qx;
      ny = qy;
    }
  }
  out.distance = Math.sqrt(best);
  out.along = where;
  const size = out.distance || 1;
  out.nx = nx / size;
  out.ny = ny / size;
  return out;
}

export interface MarkShape {
  readonly box: readonly [number, number, number, number];
  readonly groove?: number;
  readonly ridge?: number;
  readonly rough: number | null;
  readonly tone?: ReadonlyArray<number> | null;
  readonly liner?: boolean;
  alpha(mx: number, my: number, mz: number, at: number): number;
}

const scarPlaces: Readonly<
  Record<string, readonly [readonly [number, number] | null, number, number]>
> = {
  Brow: [null, 74, 0.62],
  "Across the eye": [[0.6, 0.05], 77, 2.45],
  Cheek: [[0.74, -0.56], -26, 1.1],
  "Above lip": [[0.2, -0.74], 78, 0.42],
  Chin: [[0.14, -1.44], 32, 0.6],
  Forehead: [[0.36, 0.72], 12, 1],
  "Nose bridge": [[0, -0.2], 18, 0.6],
};

export function scarShapes(
  mark: FaceMark,
  c: FaceChart,
  skin: ReadonlyArray<number> | null = null,
): MarkShape[] {
  const [anchor, angle, scale] = scarPlaces[mark.place] ?? [null, 0, 1];
  const fair = skin ? smooth(luminance(skin), 0.03, 0.4) : 1,
    flush =
      skin && !mark.tone
        ? skin.map((v, k) => v * mix([0.78, 0.7, 0.68][k] ?? 0, [0.97, 0.78, 0.77][k] ?? 0, fair))
        : null;
  const shapes: MarkShape[] = [],
    seed = mark.seed,
    width = 0.75 + 1.1 * mark.strength,
    length = (9 + 26 * mark.size) * scale;
  const brow = c.points.brows[0]?.at(-3) ?? [0, 0],
    from: readonly [number, number] = anchor ?? [
      Math.abs(brow[0]) / c.unit,
      brow[1] / c.unit + 0.03,
    ];
  for (const place of placements(mark, c, from, angle)) {
    const [ax, ay] = place.along,
      bow = (hash(1, 11, seed) - 0.5) * 0.2 * length,
      points: Array<readonly [number, number]> = [];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10,
        along = (t - 0.5) * length,
        off =
          bow * Math.sin(Math.PI * t) +
          0.5 * Math.sin(t * 7 + 6.28 * hash(2, 11, seed)) +
          0.28 * Math.sin(t * 17 + 6.28 * hash(3, 11, seed));
      points.push([
        place.centre[0] + ax * along - ay * off,
        place.centre[1] + ay * along + ax * off,
      ]);
    }
    const xs = points.map((pt) => pt[0]),
      ys = points.map((pt) => pt[1]),
      box = boxAround(
        c,
        Math.min(...xs) - 3,
        Math.min(...ys) - 3,
        Math.max(...xs) + 3,
        Math.max(...ys) + 3,
      ),
      near: Near = { distance: 0, along: 0, nx: 0, ny: 1 };
    if (!box) continue;
    const longScar = mark.place === "Across the eye";
    if (longScar)
      shapes.push({
        box,
        ridge: 0.4,
        rough: 0.45,
        tone: flush,
        alpha(mx, my, _mz, at) {
          toLine(points, mx, my, near);
          const fade = Math.sin(Math.PI * near.along) ** 0.6;
          const side = near.nx * -ay + near.ny * ax;
          const offset = near.distance * slope(c, at, near.nx, near.ny);
          const rim = offset - width * fade * (0.9 + 0.18 * Math.sin(near.along * 28));
          return side > 0.15 ? 0.72 * fade * Math.exp(-((rim / 0.75) ** 2)) * halfOf(place, mx) : 0;
        },
      });
    for (const [wide, strength, groove] of [
      [2.4, 0.22 + 0.25 * mark.strength, 0],
      [1, 0.7 + 0.29 * mark.strength, longScar ? 0.78 : 0.18],
    ] as const)
      shapes.push({
        box,
        groove,
        rough: groove ? 0.56 : null,
        tone: groove ? null : flush,
        alpha(mx, my, _mz, at) {
          toLine(points, mx, my, near);
          const taper = Math.sin(Math.PI * Math.min(1, Math.max(0, near.along))) ** 0.55,
            grain = 0.8 + 0.4 * noise(near.along * length * 1.1, 3, seed),
            half = width * wide * taper * grain + 0.02;
          return (
            strength *
            (1 - smooth(near.distance * slope(c, at, near.nx, near.ny), half * 0.35, half)) *
            halfOf(place, mx)
          );
        },
      });
  }
  return shapes;
}

export function browParting(
  body: HumanBody,
  marks: ReadonlyArray<FaceMark>,
  name: BrowName,
): Uint8Array | null {
  const scars = marks.filter((mark) => mark.kind === "Scar");
  if (!scars.length) return null;
  const c = faceChart(body),
    roots = browRoots(body, name),
    shapes = scars.flatMap((mark) => scarShapes(mark, c).filter((shape) => !shape.groove)),
    parted = new Uint8Array(roots.length / 2);
  let any = false;
  for (let k = 0; k < parted.length; k++) {
    const px = roots[k * 2] ?? 0,
      py = roots[k * 2 + 1] ?? 0,
      [mx, my, mz] = chartPoint(body, px, py),
      at =
        Math.min(c.height - 1, Math.max(0, Math.floor(py))) * c.width +
        Math.min(c.width - 1, Math.max(0, Math.floor(px)));
    if (shapes.some((shape) => shape.alpha(mx, my, mz, at) > 0.1)) {
      parted[k] = 1;
      any = true;
    }
  }
  return any ? parted : null;
}
