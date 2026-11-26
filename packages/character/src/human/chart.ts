import type { BrowName, HumanBody } from "./body.js";
import { smoothHumanSurface } from "./smooth.js";
import { evaluateHuman } from "./surface.js";

const layout = 2048;
export const chartDensity = 2;

const smooth = (v: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

type Point = readonly [number, number];
export interface ChartEye {
  readonly centre: Point;
  readonly outer: Point;
  readonly inner: Point;
  readonly upper: ReadonlyArray<Point>;
  readonly lower: ReadonlyArray<Point>;
}

export interface FaceChart {
  readonly width: number;
  readonly height: number;
  readonly unit: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly nx: Float32Array;
  readonly ny: Float32Array;
  readonly nz: Float32Array;
  readonly area: Float32Array;
  readonly skin: Float32Array;
  readonly lip: Float32Array;
  readonly lid: Float32Array;
  readonly eye: Float32Array;
  readonly wet: Float32Array;
  readonly hit: Uint8Array;
  readonly points: {
    readonly eyes: readonly [ChartEye, ChartEye];
    readonly brows: ReadonlyArray<ReadonlyArray<Point>>;
    readonly noseTip: Point;
    readonly mouth: {
      readonly centre: Point;
      readonly top: number;
      readonly bottom: number;
      readonly corner: number;
    };
  };
}

const charts = new WeakMap<HumanBody, FaceChart>();

export function chartSize(body: HumanBody): { readonly width: number; readonly height: number } {
  const [left, top, right, bottom] = body.chart.rect;
  return { width: right - left, height: bottom - top };
}

export function faceChart(body: HumanBody): FaceChart {
  const cached = charts.get(body);
  if (cached) return cached;
  const [left, top] = body.chart.rect;
  const { width: W, height: H } = chartSize(body);
  const s = smoothHumanSurface(body, evaluateHuman(body, {}));
  const n = W * H,
    x = new Float32Array(n),
    y = new Float32Array(n),
    z = new Float32Array(n),
    lip = new Float32Array(n),
    lid = new Float32Array(n),
    hit = new Uint8Array(n);
  const P = [0, 0, 0, 0, 0, 0],
    Q = new Float32Array(15);
  const p = (k: number) => P[k] ?? 0,
    q = (k: number) => Q[k] ?? 0;
  for (let c = 0; c < s.bodyTriangles * 3; c += 3) {
    for (let k = 0; k < 3; k++) {
      const v = s.indices[c + k] ?? 0,
        t = s.uvFaces[c + k] ?? 0;
      P[k * 2] = ((s.uv[t * 2] ?? 0) / 65535) * layout - left;
      P[k * 2 + 1] = (1 - (s.uv[t * 2 + 1] ?? 0) / 65535) * layout - top;
      Q[k * 5] = s.positions[v * 3] ?? 0;
      Q[k * 5 + 1] = s.positions[v * 3 + 1] ?? 0;
      Q[k * 5 + 2] = s.positions[v * 3 + 2] ?? 0;
      Q[k * 5 + 3] = Math.max(s.pigments[t * 4] ?? 0, s.pigments[t * 4 + 2] ?? 0) / 255;
      Q[k * 5 + 4] = (s.pigments[t * 4 + 1] ?? 0) / 255;
    }
    const x0 = Math.max(0, Math.floor(Math.min(p(0), p(2), p(4)))),
      x1 = Math.min(W - 1, Math.ceil(Math.max(p(0), p(2), p(4)))),
      y0 = Math.max(0, Math.floor(Math.min(p(1), p(3), p(5)))),
      y1 = Math.min(H - 1, Math.ceil(Math.max(p(1), p(3), p(5))));
    if (x1 < x0 || y1 < y0) continue;
    const det = (p(2) - p(0)) * (p(5) - p(1)) - (p(4) - p(0)) * (p(3) - p(1));
    if (Math.abs(det) < 1e-9) continue;
    for (let j = y0; j <= y1; j++)
      for (let i = x0; i <= x1; i++) {
        const gx = i + 0.5,
          gy = j + 0.5;
        const w1 = ((gx - p(0)) * (p(5) - p(1)) - (p(4) - p(0)) * (gy - p(1))) / det,
          w2 = ((p(2) - p(0)) * (gy - p(1)) - (gx - p(0)) * (p(3) - p(1))) / det,
          w0 = 1 - w1 - w2;
        if (w0 < -0.01 || w1 < -0.01 || w2 < -0.01) continue;
        const at = j * W + i;
        hit[at] = 1;
        x[at] = w0 * q(0) + w1 * q(5) + w2 * q(10);
        y[at] = w0 * q(1) + w1 * q(6) + w2 * q(11);
        z[at] = w0 * q(2) + w1 * q(7) + w2 * q(12);
        lip[at] = w0 * q(3) + w1 * q(8) + w2 * q(13);
        lid[at] = w0 * q(4) + w1 * q(9) + w2 * q(14);
      }
  }
  const f = (a: Float32Array, k: number) => a[k] ?? 0;
  const near = (px: number, py: number): [number, number, number] => {
    const fx = Math.min(W - 1.001, Math.max(0, px - 0.5)),
      fy = Math.min(H - 1.001, Math.max(0, py - 0.5)),
      i = Math.floor(fx),
      j = Math.floor(fy),
      a = fx - i,
      b = fy - j;
    const out: [number, number, number] = [0, 0, 0];
    let total = 0;
    for (const [at, w] of [
      [j * W + i, (1 - a) * (1 - b)],
      [j * W + i + 1, a * (1 - b)],
      [(j + 1) * W + i, (1 - a) * b],
      [(j + 1) * W + i + 1, a * b],
    ] as const) {
      if (!hit[at]) continue;
      total += w;
      out[0] += w * f(x, at);
      out[1] += w * f(y, at);
      out[2] += w * f(z, at);
    }
    if (total < 1e-6) {
      let best = Infinity;
      for (let dj = -6; dj <= 6; dj++)
        for (let di = -6; di <= 6; di++) {
          const u = i + di,
            v = j + dj;
          if (u < 0 || v < 0 || u >= W || v >= H || !hit[v * W + u]) continue;
          const d = di * di + dj * dj;
          if (d < best) {
            best = d;
            out[0] = f(x, v * W + u);
            out[1] = f(y, v * W + u);
            out[2] = f(z, v * W + u);
          }
        }
      return out;
    }
    return [out[0] / total, out[1] / total, out[2] / total];
  };

  const lines = body.chart.lids.map((line) => {
    const points: Point[] = [];
    for (let i = 0; i < line.points.length; i += 2)
      points.push([(line.points[i] ?? 0) * W, (line.points[i + 1] ?? 0) * H]);
    return {
      lower: line.lower,
      points,
      mean: points.reduce((sum, pt) => sum + pt[1], 0) / points.length,
    };
  });
  const middle = lines.reduce((sum, line) => sum + line.mean, 0) / lines.length;
  const eyes = [-1, 1].map((sign) => {
    const mine = lines.filter((line) => Math.sign(line.mean - middle) === sign);
    const upper = mine.find((line) => !line.lower)?.points,
      lower = mine.find((line) => line.lower)?.points;
    if (!upper || !lower) throw new Error("The face chart needs both lids of each eye.");
    return { upper, lower };
  });
  const centre = (eye: { upper: Point[]; lower: Point[] }) => {
    const all = [...eye.upper, ...eye.lower].map(([px, py]) => near(px, py));
    return [0, 1, 2].map((k) => all.reduce((sum, pt) => sum + (pt[k] ?? 0), 0) / all.length);
  };
  const centres = eyes.map(centre);
  const c0 = centres[0] ?? [0, 0, 0],
    c1 = centres[1] ?? [0, 0, 0];
  const eyeY = ((c0[1] ?? 0) + (c1[1] ?? 0)) / 2,
    unit = Math.abs((c0[0] ?? 0) - (c1[0] ?? 0)) * 1000;
  for (let i = 0; i < n; i++) {
    x[i] = f(x, i) * 1000;
    y[i] = (f(y, i) - eyeY) * 1000;
    z[i] = f(z, i) * 1000;
  }
  const spot = near;

  const nx = new Float32Array(n),
    ny = new Float32Array(n),
    nz = new Float32Array(n).fill(1),
    area = new Float32Array(n);
  for (let j = 1; j < H - 1; j++)
    for (let i = 1; i < W - 1; i++) {
      const at = j * W + i;
      if (!hit[at] || !hit[at - 1] || !hit[at + 1] || !hit[at - W] || !hit[at + W]) continue;
      const ax = (f(x, at + 1) - f(x, at - 1)) / 2,
        ay = (f(y, at + 1) - f(y, at - 1)) / 2,
        az = (f(z, at + 1) - f(z, at - 1)) / 2,
        bx = (f(x, at + W) - f(x, at - W)) / 2,
        by = (f(y, at + W) - f(y, at - W)) / 2,
        bz = (f(z, at + W) - f(z, at - W)) / 2;
      let cx = ay * bz - az * by,
        cy = az * bx - ax * bz,
        cz = ax * by - ay * bx;
      const size = Math.hypot(cx, cy, cz);
      area[at] = size;
      if (size < 1e-9) continue;
      if (cz < 0) {
        cx = -cx;
        cy = -cy;
        cz = -cz;
      }
      nx[at] = cx / size;
      ny[at] = cy / size;
      nz[at] = cz / size;
    }

  const outside = new Uint8Array(n),
    stack: number[] = [];
  const push = (i: number) => {
    if (!hit[i] && !outside[i]) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let i = 0; i < W; i++) {
    push(i);
    push((H - 1) * W + i);
  }
  for (let j = 0; j < H; j++) {
    push(j * W);
    push(j * W + W - 1);
  }
  for (let i = stack.pop(); i !== undefined; i = stack.pop()) {
    const px = i % W;
    if (px > 0) push(i - 1);
    if (px < W - 1) push(i + 1);
    if (i >= W) push(i - W);
    if (i < n - W) push(i + W);
  }
  const shore = distanceFrom(outside, W, H),
    skin = new Float32Array(n);
  const [patchX, patchY, patchHalf] = body.chart.mouthPatch,
    keep = patchHalf + 10;
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const at = j * W + i;
      if (!hit[at]) continue;
      if (Math.abs(i + 0.5 - patchX) < keep && Math.abs(j + 0.5 - patchY) < keep) continue;
      skin[at] = smooth(Math.min(i, j, W - 1 - i, H - 1 - j), 4, 16) * smooth(f(shore, at), 2, 9);
    }

  const eye = new Float32Array(n).fill(1e3);
  for (const { upper, lower } of eyes) {
    const u0 = upper[0] ?? [0, 0],
      l0 = lower[0] ?? [0, 0],
      lN = lower.at(-1) ?? [0, 0];
    const ring = [...upper, ...[...lower].reverse()];
    const closed =
      Math.hypot(u0[0] - l0[0], u0[1] - l0[1]) < Math.hypot(u0[0] - lN[0], u0[1] - lN[1])
        ? ring
        : [...upper, ...lower];
    const xs = closed.map((pt) => pt[0]),
      ys = closed.map((pt) => pt[1]),
      pad = 12;
    for (
      let j = Math.max(0, Math.floor(Math.min(...ys)) - pad);
      j <= Math.min(H - 1, Math.ceil(Math.max(...ys)) + pad);
      j++
    )
      for (
        let i = Math.max(0, Math.floor(Math.min(...xs)) - pad);
        i <= Math.min(W - 1, Math.ceil(Math.max(...xs)) + pad);
        i++
      ) {
        const px = i + 0.5,
          py = j + 0.5;
        let inside = false,
          best = Infinity;
        for (let k = 0, m = closed.length - 1; k < closed.length; m = k++) {
          const [ax, ay] = closed[k] ?? [0, 0],
            [bx, by] = closed[m] ?? [0, 0];
          if (ay > py !== by > py && px < ((bx - ax) * (py - ay)) / (by - ay) + ax)
            inside = !inside;
          const ex = bx - ax,
            ey = by - ay,
            t = Math.min(
              1,
              Math.max(0, ((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey || 1)),
            );
          best = Math.min(best, Math.hypot(px - ax - ex * t, py - ay - ey * t));
        }
        const at = j * W + i;
        eye[at] = Math.min(f(eye, at), inside ? -best : best);
      }
  }

  const rim = new Float32Array(n),
    wet = new Float32Array(n);
  for (let at = 0; at < n; at++)
    if (f(eye, at) < 0 || (f(eye, at) < 11 && hit[at] && (f(nz, at) < 0.55 || area[at] === 0)))
      rim[at] = 1;
  for (let j = 1; j < H - 1; j++)
    for (let i = 1; i < W - 1; i++) {
      const at = j * W + i;
      if (f(eye, at) > 14) continue;
      let sum = 0;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) sum += f(rim, at + dj * W + di);
      wet[at] = Math.max(f(rim, at), sum / 9);
    }

  const leftFirst = (c0[0] ?? 0) > (c1[0] ?? 0) ? ([0, 1] as const) : ([1, 0] as const);
  const side = (k: 0 | 1): ChartEye => {
    const { upper, lower } = eyes[k] ?? { upper: [], lower: [] };
    const cent = centres[k] ?? [0, 0, 0];
    const ends = [upper[0] ?? [0, 0], upper.at(-1) ?? [0, 0]].map(([px, py]) => spot(px, py)),
      e0 = ends[0] ?? [0, 0, 0],
      e1 = ends[1] ?? [0, 0, 0],
      outerFirst = Math.abs(e0[0]) > Math.abs(e1[0]);
    const l0 = lower[0] ?? [0, 0],
      lN = lower.at(-1) ?? [0, 0];
    return {
      centre: [(cent[0] ?? 0) * 1000, ((cent[1] ?? 0) - eyeY) * 1000],
      outer: outerFirst ? [e0[0], e0[1]] : [e1[0], e1[1]],
      inner: outerFirst ? [e1[0], e1[1]] : [e0[0], e0[1]],
      upper: outerFirst ? [...upper].reverse() : upper,
      lower:
        Math.abs(spot(l0[0], l0[1])[0]) > Math.abs(spot(lN[0], lN[1])[0])
          ? [...lower].reverse()
          : lower,
    };
  };
  const sides: readonly [ChartEye, ChartEye] = [side(leftFirst[0]), side(leftFirst[1])];
  let noseTip: [number, number, number] = [0, 0, -Infinity],
    mouthTop = -Infinity,
    mouthBottom = Infinity,
    mouthCorner = 0,
    lipSum = 0,
    lipY = 0;
  for (let i = 0; i < n; i++) {
    if (!hit[i]) continue;
    const xi = f(x, i),
      yi = f(y, i),
      zi = f(z, i);
    if (f(lip, i) > 0.5) {
      lipSum++;
      lipY += yi;
      mouthCorner = Math.max(mouthCorner, Math.abs(xi));
      if (Math.abs(xi) < 4) {
        mouthTop = Math.max(mouthTop, yi);
        mouthBottom = Math.min(mouthBottom, yi);
      }
    }
    if (Math.abs(xi) < 3 && yi < -0.2 * unit && yi > -1.2 * unit && zi > noseTip[2])
      noseTip = [xi, yi, zi];
  }
  const strokes = body.chart.strokes("eyebrow001"),
    bins: [Array<Point[] | undefined>, Array<Point[] | undefined>] = [[], []];
  for (let i = 0; i < strokes.length; i += 6) {
    const pt = spot((strokes[i + 2] ?? 0) * W, (strokes[i + 3] ?? 0) * H),
      which = pt[0] > 0 ? 0 : 1,
      slot = Math.min(7, Math.floor((Math.abs(pt[0]) / unit) * 8 - 0.4));
    if (slot < 0) continue;
    const list = (bins[which][slot] ??= []);
    list.push([pt[0], pt[1]]);
  }
  const brows = bins.map((slots) =>
    slots
      .filter((list): list is Point[] => list !== undefined)
      .map((list): Point => [
        list.reduce((sum, pt) => sum + pt[0], 0) / list.length,
        list.reduce((sum, pt) => sum + pt[1], 0) / list.length,
      ]),
  );
  const known = Uint8Array.from(hit);
  for (let round = 0; round < 4; round++) {
    const found: Array<readonly [number, number[]]> = [];
    for (let j = 1; j < H - 1; j++)
      for (let i = 1; i < W - 1; i++) {
        const at = j * W + i;
        if (known[at]) continue;
        const from = [at - 1, at + 1, at - W, at + W].filter((k) => known[k]);
        if (from.length) found.push([at, from]);
      }
    for (const [at, from] of found) {
      known[at] = 1;
      for (const field of [x, y, z])
        field[at] = from.reduce((sum, k) => sum + f(field, k), 0) / from.length;
    }
  }
  const chart: FaceChart = {
    width: W,
    height: H,
    unit,
    x,
    y,
    z,
    nx,
    ny,
    nz,
    area,
    skin,
    lip,
    lid,
    eye,
    wet,
    hit,
    points: {
      eyes: sides,
      brows,
      noseTip: [noseTip[0], noseTip[1]],
      mouth: {
        centre: [0, lipY / Math.max(1, lipSum)],
        top: mouthTop,
        bottom: mouthBottom,
        corner: mouthCorner,
      },
    },
  };
  charts.set(body, chart);
  return chart;
}

function distanceFrom(marked: Uint8Array, W: number, H: number): Float32Array {
  const far = 1e6,
    d = new Float32Array(W * H);
  for (let i = 0; i < d.length; i++) d[i] = marked[i] ? 0 : far;
  const g = (k: number) => d[k] ?? far;
  const pass = (from: number, to: number, step: number) => {
    for (let y = from; y !== to; y += step)
      for (let x = from === 0 ? 0 : W - 1; x >= 0 && x < W; x += step) {
        const i = y * W + x;
        let best = g(i);
        if (x - step >= 0 && x - step < W) best = Math.min(best, g(i - step) + 1);
        const yy = y - step;
        if (yy >= 0 && yy < H) {
          best = Math.min(best, g(i - step * W) + 1);
          if (x - step >= 0 && x - step < W) best = Math.min(best, g(i - step * W - step) + 1.414);
          if (x + step >= 0 && x + step < W) best = Math.min(best, g(i - step * W + step) + 1.414);
        }
        d[i] = best;
      }
  };
  pass(0, H, 1);
  pass(H - 1, -1, -1);
  return d;
}

export function browRoots(body: HumanBody, name: BrowName): Float32Array {
  const { width: W, height: H } = chartSize(body);
  const strokes = body.chart.strokes(name),
    roots = new Float32Array(strokes.length / 3);
  for (let i = 0, k = 0; i < strokes.length; i += 6) {
    roots[k++] = (strokes[i] ?? 0) * W;
    roots[k++] = (strokes[i + 1] ?? 0) * H;
  }
  return roots;
}

export function chartPoint(body: HumanBody, px: number, py: number): [number, number, number] {
  const c = faceChart(body),
    W = c.width,
    H = c.height,
    fx = Math.min(W - 1.001, Math.max(0, px - 0.5)),
    fy = Math.min(H - 1.001, Math.max(0, py - 0.5)),
    i = Math.floor(fx),
    j = Math.floor(fy),
    a = fx - i,
    b = fy - j,
    at = j * W + i;
  const read = (field: Float32Array) =>
    ((field[at] ?? 0) * (1 - a) + (field[at + 1] ?? 0) * a) * (1 - b) +
    ((field[at + W] ?? 0) * (1 - a) + (field[at + W + 1] ?? 0) * a) * b;
  return [read(c.x), read(c.y), read(c.z)];
}

const browMasks = new WeakMap<HumanBody, Map<BrowName, Float32Array>>();
export function browCover(body: HumanBody, name: BrowName): Float32Array {
  let masks = browMasks.get(body);
  if (!masks) browMasks.set(body, (masks = new Map<BrowName, Float32Array>()));
  const found = masks.get(name);
  if (found) return found;
  const { width: W, height: H } = chartSize(body);
  const mask = new Float32Array(W * H),
    strokes = body.chart.strokes(name),
    at = (i: number) => strokes[i] ?? 0;
  for (let i = 0; i < strokes.length; i += 6)
    for (let t = 0; t <= 1; t += 0.125) {
      const a = (1 - t) * (1 - 2 * t),
        b = 4 * t * (1 - t),
        c = t * (2 * t - 1),
        px = (a * at(i) + b * at(i + 2) + c * at(i + 4)) * W,
        py = (a * at(i + 1) + b * at(i + 3) + c * at(i + 5)) * H;
      for (let dj = -3; dj <= 3; dj++)
        for (let di = -3; di <= 3; di++) {
          const u = Math.floor(px) + di,
            v = Math.floor(py) + dj;
          if (u < 0 || v < 0 || u >= W || v >= H) continue;
          const k = v * W + u;
          mask[k] = Math.min(1, (mask[k] ?? 0) + 0.3 * Math.exp(-(di * di + dj * dj) / 3));
        }
    }
  masks.set(name, mask);
  return mask;
}

export function chartPixel(body: HumanBody, mx: number, my: number): number {
  const c = faceChart(body);
  let best = Infinity,
    found = -1;
  for (let at = 0; at < c.width * c.height; at++) {
    if ((c.skin[at] ?? 0) < 0.5) continue;
    const dx = (c.x[at] ?? 0) - mx,
      dy = (c.y[at] ?? 0) - my,
      d = dx * dx + dy * dy;
    if (d < best) {
      best = d;
      found = at;
    }
  }
  return found;
}
