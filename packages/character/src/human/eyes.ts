import * as T from "three";

const smooth = (v: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const irisRadius = 0.7;

export interface EyeBall {
  readonly centre: T.Vector3;
  readonly radius: number;
}

export interface Opening {
  readonly inner: number;
  readonly outer: number;
  at(a: number): readonly [number, number];
}

export function lidOpening(
  skin: T.Mesh,
  centre: T.Vector3,
  radius: number,
  side: number,
): Opening | null {
  const p = skin.geometry.getAttribute("position").array,
    index = skin.geometry.getIndex()?.array ?? [];
  const wide = 192,
    tall = 128,
    spanA = 1.02 * radius,
    spanY = 0.68 * radius,
    cellA = (2 * spanA) / wide,
    cellY = (2 * spanY) / tall;
  const open = new Uint8Array(wide * tall),
    ball = new Float32Array(wide * tall);
  for (let j = 0; j < tall; j++)
    for (let i = 0; i < wide; i++) {
      const a = -spanA + (i + 0.5) * cellA,
        y = -spanY + (j + 0.5) * cellY,
        d = radius * radius - a * a - y * y;
      ball[j * wide + i] = d > 0 ? Math.sqrt(d) : Infinity;
      open[j * wide + i] = d > 0 ? 1 : 0;
    }
  const points = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const [u = [0, 0, 0], v = [0, 0, 0], w = [0, 0, 0]] = points;
  for (let t = 0; t < index.length; t += 3) {
    let near = true;
    for (let e = 0; e < 3 && near; e++) {
      const i = index[t + e] ?? 0,
        c = points[e] ?? [0, 0, 0];
      c[0] = side * ((p[i * 3] ?? 0) - centre.x);
      c[1] = (p[i * 3 + 1] ?? 0) - centre.y;
      c[2] = (p[i * 3 + 2] ?? 0) - centre.z;
      near = Math.abs(c[0]) < 2 * radius && Math.abs(c[1]) < 2 * radius && c[2] > -0.2 * radius;
    }
    if (!near) continue;
    const [u0 = 0, u1 = 0, u2 = 0] = u,
      [v0 = 0, v1 = 0, v2 = 0] = v,
      [w0 = 0, w1 = 0, w2 = 0] = w;
    const area = (v0 - u0) * (w1 - u1) - (w0 - u0) * (v1 - u1);
    if (Math.abs(area) < 1e-14) continue;
    const i0 = Math.max(0, Math.floor((Math.min(u0, v0, w0) + spanA) / cellA)),
      i1 = Math.min(wide - 1, Math.floor((Math.max(u0, v0, w0) + spanA) / cellA));
    const j0 = Math.max(0, Math.floor((Math.min(u1, v1, w1) + spanY) / cellY)),
      j1 = Math.min(tall - 1, Math.floor((Math.max(u1, v1, w1) + spanY) / cellY));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        if (!open[j * wide + i]) continue;
        const a = -spanA + (i + 0.5) * cellA,
          y = -spanY + (j + 0.5) * cellY;
        const f = ((v0 - a) * (w1 - y) - (w0 - a) * (v1 - y)) / area,
          g = ((w0 - a) * (u1 - y) - (u0 - a) * (w1 - y)) / area,
          h = 1 - f - g;
        if (f < 0 || g < 0 || h < 0) continue;
        if (f * u2 + g * v2 + h * w2 > (ball[j * wide + i] ?? Infinity)) open[j * wide + i] = 0;
      }
  }
  const low = new Float32Array(wide).fill(NaN),
    high = new Float32Array(wide).fill(NaN);
  let first = -1,
    last = -1;
  for (let i = 0; i < wide; i++) {
    let best = 0,
      from = 0,
      run = 0;
    for (let j = 0; j <= tall; j++) {
      if (j < tall && open[j * wide + i]) {
        run++;
        continue;
      }
      if (run > best) {
        best = run;
        from = j - run;
      }
      run = 0;
    }
    if (best < 2 || best === tall) continue;
    low[i] = -spanY + from * cellY;
    high[i] = -spanY + (from + best) * cellY;
    if (first < 0) first = i;
    last = i;
  }
  if (first < 0 || last - first < 12) return null;
  const lo = (i: number) => low[i] ?? NaN,
    hi = (i: number) => high[i] ?? NaN;
  let widest = first;
  for (let i = first; i <= last; i++)
    if (hi(i) - lo(i) > (hi(widest) - lo(widest) || 0)) widest = i;
  first = last = widest;
  while (first > 0 && !Number.isNaN(lo(first - 1))) first--;
  while (last < wide - 1 && !Number.isNaN(lo(last + 1))) last++;
  const inner = -spanA + first * cellA,
    outer = -spanA + (last + 1) * cellA;
  const columns = 33,
    bottom = new Float32Array(columns),
    top = new Float32Array(columns);
  for (let k = 0; k < columns; k++) {
    const at = first + ((last - first) * k) / (columns - 1),
      i = Math.floor(at),
      f = at - i,
      j = Math.min(last, i + 1);
    bottom[k] = lo(i) + (lo(j) - lo(i)) * f;
    top[k] = hi(i) + (hi(j) - hi(i)) * f;
  }
  const lerp = (values: Float32Array, a: number) => {
    const f = T.MathUtils.clamp(((a - inner) / (outer - inner)) * columns - 0.5, 0, columns - 1),
      k = Math.min(columns - 2, Math.floor(f));
    const x = values[k] ?? 0;
    return x + ((values[k + 1] ?? 0) - x) * (f - k);
  };
  const corner = (k: number) => ((bottom[k] ?? 0) + (top[k] ?? 0)) / 2,
    close = (a: number) =>
      smooth(a, inner, inner + (outer - inner) / columns) *
      (1 - smooth(a, outer - (outer - inner) / columns, outer));
  return {
    inner,
    outer,
    at(a) {
      const edge = a < (inner + outer) / 2 ? corner(0) : corner(columns - 1),
        o = close(a);
      return [edge + (lerp(bottom, a) - edge) * o, edge + (lerp(top, a) - edge) * o];
    },
  };
}

export function eyeBalls(
  positions: ArrayLike<number>,
  eyeGroups: ReadonlyArray<ArrayLike<number>>,
  origin: readonly [number, number, number],
): EyeBall[] {
  const at = (id: number, d: number) => positions[id * 3 + d] ?? 0;
  return eyeGroups.map((ids) => {
    let use = Array.from(ids),
      centre = [0, 0, 0],
      radius = 0;
    for (let pass = 0; pass < 4 && use.length >= 8; pass++) {
      const mean = [0, 0, 0];
      for (const id of use)
        for (let d = 0; d < 3; d++) mean[d] = (mean[d] ?? 0) + at(id, d) / use.length;
      const m = new Float64Array(16),
        rhs = new Float64Array(4);
      for (const id of use) {
        const q = [0, 1, 2].map((d) => at(id, d) - (mean[d] ?? 0)),
          [q0 = 0, q1 = 0, q2 = 0] = q,
          row = [2 * q0, 2 * q1, 2 * q2, 1],
          value = q0 * q0 + q1 * q1 + q2 * q2;
        for (let i = 0; i < 4; i++) {
          rhs[i] = (rhs[i] ?? 0) + (row[i] ?? 0) * value;
          for (let j = 0; j < 4; j++)
            m[i * 4 + j] = (m[i * 4 + j] ?? 0) + (row[i] ?? 0) * (row[j] ?? 0);
        }
      }
      const get = (k: number) => m[k] ?? 0;
      for (let i = 0; i < 4; i++) {
        let pivot = i;
        for (let r = i + 1; r < 4; r++)
          if (Math.abs(get(r * 4 + i)) > Math.abs(get(pivot * 4 + i))) pivot = r;
        if (pivot !== i) {
          for (let j = 0; j < 4; j++) {
            const x = get(i * 4 + j);
            m[i * 4 + j] = get(pivot * 4 + j);
            m[pivot * 4 + j] = x;
          }
          const x = rhs[i] ?? 0;
          rhs[i] = rhs[pivot] ?? 0;
          rhs[pivot] = x;
        }
        for (let r = 0; r < 4; r++) {
          if (r === i || !get(i * 4 + i)) continue;
          const f = get(r * 4 + i) / get(i * 4 + i);
          for (let j = 0; j < 4; j++) m[r * 4 + j] = get(r * 4 + j) - f * get(i * 4 + j);
          rhs[r] = (rhs[r] ?? 0) - f * (rhs[i] ?? 0);
        }
      }
      const c = [0, 1, 2].map((i) => (rhs[i] ?? 0) / get(i * 5));
      const [c0 = 0, c1 = 0, c2 = 0] = c;
      radius = Math.sqrt((rhs[3] ?? 0) / get(15) + c0 * c0 + c1 * c1 + c2 * c2);
      const found = c.map((v, d) => v + (mean[d] ?? 0));
      centre = found;
      const far = (id: number) =>
        Math.hypot(...[0, 1, 2].map((d) => at(id, d) - (found[d] ?? 0))) - radius;
      const kept = use.filter((id) => far(id) < 0.012 * radius);
      if (kept.length === use.length) break;
      use = kept;
    }
    return {
      centre: new T.Vector3(
        (centre[0] ?? 0) - origin[0],
        (centre[1] ?? 0) - origin[1],
        (centre[2] ?? 0) - origin[2],
      ),
      radius,
    };
  });
}

function almond(radius: number): Opening {
  const inner = -0.66 * radius,
    outer = 0.7 * radius;
  return {
    inner,
    outer,
    at(a) {
      const t = T.MathUtils.clamp((a - inner) / (outer - inner), 0, 1),
        arch = Math.sin(Math.PI * t) ** 0.8;
      return [-0.19 * radius * arch - 0.02 * radius, 0.25 * radius * arch - 0.02 * radius];
    },
  };
}

type Rgb = readonly [number, number, number];
interface Look {
  readonly sky: number;
  readonly cast: Rgb;
  readonly flesh: Rgb;
  readonly rim: Rgb;
}

export function socketTint(
  above: number,
  below: number,
  fromInner: number,
  fromOuter: number,
  look: Look,
): Rgb {
  const hidden = Math.max(smooth(-above, 0, 0.8), smooth(-below, 0, 0.8));
  const lid = Math.exp(-Math.max(above, 0) / 1.5),
    lashes = Math.exp(-Math.max(above, 0) / 3.8),
    low = Math.exp(-Math.max(below, 0));
  const margin = Math.exp(-((Math.max(above, 0) / 0.62) ** 2)),
    ledge = (1 - smooth(below, 0.45, 1.05)) * (1 - smooth(-below, 0.1, 0.5));
  const shade =
    look.sky *
    (1 - 0.58 * lid) *
    (1 - 0.32 * lashes) *
    (1 - 0.48 * margin) *
    (1 - 0.36 * low * (1 - ledge)) *
    (1 - 0.45 * hidden);
  const near = Math.max(lid, low),
    flesh = 1 - smooth(fromInner, 0.7, 2.4),
    pink = 0.3 * (1 - smooth(fromOuter, 0, 3.2)) + 0.16 * near;
  const pinkShare = [0, 0.2, 0.24] as const;
  const tone = ([0, 1, 2] as const).map((k) => {
    let v = 1;
    v *= 1 - pink * pinkShare[k];
    v += (look.flesh[k] - v) * flesh;
    if (ledge) v += (look.rim[k] - v) * 0.8 * ledge * (1 - flesh);
    return v * look.cast[k];
  });
  return [(tone[0] ?? 0) * shade, (tone[1] ?? 0) * shade, (tone[2] ?? 0) * shade];
}

function socketLook(skinColour: string, age: number): Look {
  const skin = new T.Color(skinColour),
    a = T.MathUtils.clamp(age, 0, 1);
  const rgb = [skin.r, skin.g, skin.b] as const;
  const share = (k: 0 | 1 | 2) => Math.min(1, rgb[k] / Math.max(skin.r, 1e-3));
  const ageing = [1, 1 - 0.02 * a, 1 - 0.07 * a] as const;
  const cast: Rgb = [
    (1 - 0.1 + 0.1 * share(0)) * ageing[0],
    (1 - 0.1 + 0.1 * share(1)) * ageing[1],
    (1 - 0.1 + 0.1 * share(2)) * ageing[2],
  ];
  const flesh: Rgb = [
    0.6 * (0.7 + 0.3 * share(0)),
    0.3 * (0.7 + 0.3 * share(1)),
    0.27 * (0.7 + 0.3 * share(2)),
  ];
  const rim: Rgb = [
    0.82 * (0.62 + 0.38 * share(0)),
    0.5 * (0.62 + 0.38 * share(1)),
    0.46 * (0.62 + 0.38 * share(2)),
  ];
  return { sky: 0.84, cast, flesh, rim };
}

const gazeTargets = [
  ["LookLeft", 1, 0.32],
  ["LookRight", 1, -0.32],
  ["LookUp", 0, -0.23],
  ["LookDown", 0, 0.23],
] as const;
const anatomy = {
  iris: [0.0108, 0.0124],
  irisOfOpening: 0.5,
  lidCover: 0.00215,
  coverShare: 0.78,
  pupilClear: 0.00055,
  sink: 0.0003,
  cornea: 7.8 / 11.7,
  glint: 0.56,
} as const;

export interface EyeFit {
  readonly centre: T.Vector3;
  readonly side: number;
  readonly ball: number;
  readonly opening: Opening;
  readonly iris: number;
  readonly first: number;
  readonly count: number;
}

export const eyeFitsOf = new WeakMap<T.Object3D, ReadonlyArray<EyeFit>>();

interface Fit {
  readonly centre: T.Vector3;
  readonly side: number;
  readonly ball: number;
  readonly opening: Opening;
  readonly iris: number;
  readonly a: number;
  readonly y: number;
  first: number;
  count: number;
}

export interface EyeOptions {
  readonly skin: string;
  readonly age: number;
  readonly plain: boolean;
  readonly scale: number;
  readonly textures?: { readonly map: T.Texture; readonly roughnessMap: T.Texture } | undefined;
}

export function humanEyes(
  skin: T.Mesh | undefined,
  centres: ReadonlyArray<EyeBall>,
  material: (color: string) => T.Material,
  options: EyeOptions,
): T.Mesh {
  const { plain, scale } = options;
  const look = socketLook(options.skin, options.age),
    mm = 0.001 * scale;
  const fits: Fit[] = centres.map(({ centre, radius }) => {
    const side = centre.x >= 0 ? 1 : -1,
      ball = radius - anatomy.sink * scale;
    const opening = (skin && lidOpening(skin, centre, ball, side)) || almond(ball);
    const width = opening.outer - opening.inner;
    const iris = T.MathUtils.clamp(
      anatomy.irisOfOpening * width,
      anatomy.iris[0] * scale,
      anatomy.iris[1] * scale,
    );
    const a = opening.inner + 0.485 * width;
    let bottom = 0,
      top = 0;
    for (const f of [-0.25, 0, 0.25]) {
      const [b, t] = opening.at(a + f * iris);
      bottom += b / 3;
      top += t / 3;
    }
    const most = iris / 2 - (0.36 * iris) / 2 - anatomy.pupilClear * scale;
    const cover = Math.min(
      most,
      Math.max(anatomy.coverShare * (iris - (top - bottom)), anatomy.lidCover * scale),
    );
    return { centre, side, ball, opening, iris, a, y: top + cover - iris / 2, first: 0, count: 0 };
  });
  const pitch =
    fits.reduce((sum, f) => sum + Math.asin(T.MathUtils.clamp(f.y / f.ball, -0.6, 0.6)), 0) /
    fits.length;
  const turn =
    fits.reduce((sum, f) => sum + Math.asin(T.MathUtils.clamp(f.a / f.ball, -0.6, 0.6)), 0) /
    fits.length;
  const position: number[] = [],
    normal: number[] = [],
    uv: number[] = [],
    colour: number[] = [],
    index: number[] = [],
    moving: number[] = [],
    domed: number[] = [];
  const v = new T.Vector3(),
    n = new T.Vector3();
  const white: Rgb = [1, 1, 1];
  for (const fit of fits) {
    const { centre, side, ball, opening } = fit,
      start = position.length / 3;
    const tint = (a: number, y: number, least = -Infinity): Rgb => {
      const [bottom, top] = opening.at(a);
      return socketTint(
        Math.max(least, (top - y) / mm),
        Math.max(least, (y - bottom) / mm),
        (a - opening.inner) / mm,
        (opening.outer - a) / mm,
        look,
      );
    };
    const onBall = (a: number, y: number, r: number) => {
      const out = Math.hypot(a, y),
        keep = Math.min(1, (0.96 * r) / Math.max(out, 1e-9));
      return v.set(side * a * keep, y * keep, Math.sqrt(r * r - (out * keep) ** 2));
    };
    const across = [-2.6, -0.2, 0.6, 1.6, 2.8].map((d) => opening.inner + d * mm);
    const inner = across.at(-1) ?? 0,
      far = opening.outer - 2.8 * mm,
      spans = 5;
    for (let k = 1; k < spans; k++) across.push(inner + ((far - inner) * k) / spans);
    for (const d of [-2.8, -1.4, -0.4, 0.2, 2.6]) across.push(opening.outer + d * mm);
    const rows = 9;
    across.forEach((a, i) => {
      const [bottom, top] = opening.at(a),
        h = Math.max(0, top - bottom);
      const ys = [
        bottom - 2.6 * mm,
        bottom - 0.2 * mm,
        bottom + Math.min(0.4 * mm, 0.12 * h),
        bottom + Math.min(1.2 * mm, 0.3 * h),
        top - Math.min(2.6 * mm, 0.45 * h),
        top - Math.min(1.3 * mm, 0.28 * h),
        top - Math.min(0.5 * mm, 0.1 * h),
        top + 0.2 * mm,
        top + 1.8 * mm,
      ];
      for (const y of ys) {
        onBall(a, y, ball);
        position.push(centre.x + v.x, centre.y + v.y, centre.z + v.z);
        n.copy(v).normalize();
        normal.push(n.x, n.y, n.z);
        uv.push(0.75 + (0.22 * a) / ball, 0.5 + (0.44 * y) / ball);
        colour.push(...(plain ? white : tint(a, y)));
        moving.push(0);
        domed.push(-1);
      }
      if (!i) return;
      for (let r = 0; r < rows - 1; r++) {
        const p = start + (i - 1) * rows + r,
          q = start + i * rows + r;
        if (side > 0) index.push(p, q, q + 1, p, q + 1, p + 1);
        else index.push(p, q + 1, q, p, p + 1, q + 1);
      }
    });
    const outer = ball + anatomy.sink * scale;
    const mStart = position.length / 3,
      mCols = 9,
      mA0 = opening.inner + 1.1 * mm,
      mA1 = opening.outer - 0.9 * mm;
    for (let i = 0; i < mCols; i++) {
      const t = i / (mCols - 1),
        a = mA0 + (mA1 - mA0) * t,
        [bottom] = opening.at(a);
      const endFade = smooth(t, 0, 0.18) * (1 - smooth(t, 0.82, 1));
      const baseC = plain ? white : tint(a, bottom + 0.25 * mm);
      for (let r = 0; r < 2; r++) {
        const y = bottom + (r ? 0.58 : -0.14) * mm,
          rad = outer + (r ? 0.05 : 0.24) * mm;
        onBall(a, y, rad);
        position.push(centre.x + v.x, centre.y + v.y, centre.z + v.z);
        n.copy(v).normalize();
        n.y += r ? 0.52 : 0.78;
        n.normalize();
        normal.push(n.x, n.y, n.z);
        uv.push(0.62 + 0.26 * t, 0.94);
        const wet = [0.94, 0.86, 0.84] as const;
        const moist = plain
          ? white
          : baseC.map((c, k) => {
              const rimCol = (look.rim[k] ?? 0) * 0.55 + 0.45 * (wet[k] ?? 0);
              return T.MathUtils.clamp(
                c + (rimCol * look.sky - c) * (0.55 - 0.2 * r) * endFade,
                0,
                1,
              );
            });
        colour.push(...moist);
        moving.push(0);
        domed.push(-1);
      }
      if (!i) continue;
      const p = mStart + (i - 1) * 2,
        q = mStart + i * 2;
      if (side > 0) index.push(p, q, q + 1, p, q + 1, p + 1);
      else index.push(p, q + 1, q, p, p + 1, q + 1);
    }
    const first = position.length / 3,
      r = fit.iris / 2,
      corneal = anatomy.cornea * fit.iris;
    const seat = Math.sqrt(outer * outer - r * r) - Math.sqrt(corneal * corneal - r * r);
    const rings = [0.3, 0.42, 0.62, 0.82, 0.95, 1.03, 1.08, 1.13],
      around = 16;
    const height = (q: number) => {
      const rho = q * r,
        sphere = Math.sqrt(outer * outer - rho * rho);
      let z = q < 1.03 ? Math.max(sphere, seat + Math.sqrt(corneal * corneal - rho * rho)) : sphere;
      if (plain)
        z -=
          ball *
          ((1 - smooth(q, 0.78, 0.97)) * (0.05 + 0.07 * Math.max(0, 1 - q * q)) +
            0.07 * (1 - smooth(q, 0.32, 0.44)));
      return z;
    };
    const aim = new T.Quaternion().setFromEuler(new T.Euler(-pitch, side * turn, 0, "YXZ"));
    const place = (q: number, angle: number) => {
      v.set(q * r * Math.cos(angle), q * r * Math.sin(angle), height(q)).applyQuaternion(aim);
      const a = side * v.x;
      const bowlBias = 1 - 0.11 * Math.sin(angle) * (1 - smooth(q, 0.72, 1));
      let shade: Rgb = white;
      if (!plain) {
        const sum = [0, 0, 0];
        for (const d of [-0.25, 0, 0.25]) {
          const c = tint(a, v.y + d * mm, 0.25);
          for (let k = 0; k < 3; k++) sum[k] = (sum[k] ?? 0) + (c[k] ?? 0) / 3;
        }
        shade = [
          T.MathUtils.clamp((sum[0] ?? 0) * bowlBias, 0, 1),
          T.MathUtils.clamp((sum[1] ?? 0) * bowlBias, 0, 1),
          T.MathUtils.clamp((sum[2] ?? 0) * bowlBias, 0, 1),
        ];
      }
      position.push(centre.x + v.x, centre.y + v.y, centre.z + v.z);
      uv.push(
        0.25 + 0.25 * q * irisRadius * Math.cos(angle),
        0.5 + 0.5 * q * irisRadius * Math.sin(angle),
      );
      colour.push(...shade);
      moving.push(1);
      normal.push(0, 0, 0);
      domed.push(q < 1.03 ? q : -1);
    };
    place(0, 0);
    rings.forEach((q, j) => {
      for (let k = 0; k < around; k++) place(q, ((k + 0.5 * (j % 2)) / around) * 2 * Math.PI);
      for (let k = 0; k < around; k++) {
        const b = first + 1 + j * around + k,
          c = first + 1 + j * around + ((k + 1) % around);
        if (!j) {
          index.push(first, b, c);
          continue;
        }
        const shift = j % 2 ? 0 : -1,
          p = first + 1 + (j - 1) * around + ((k + around + shift + 1) % around),
          q2 = first + 1 + (j - 1) * around + ((k + around + shift) % around);
        index.push(q2, b, p, p, b, c);
      }
    });
    fit.first = first;
    fit.count = position.length / 3 - first;
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(position, 3));
  geometry.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  if (!plain) geometry.setAttribute("color", new T.Float32BufferAttribute(colour, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const made = geometry.getAttribute("normal");
  const placed = geometry.getAttribute("position");
  for (const fit of fits) {
    const rim = fit.first + fit.count - 16;
    for (let i = rim; i < fit.first + fit.count; i++) {
      n.fromBufferAttribute(placed, i).sub(fit.centre).normalize();
      made.setXYZ(i, n.x, n.y, n.z);
    }
  }
  for (let i = 0; i < moving.length; i++)
    if (!moving[i])
      made.setXYZ(i, normal[i * 3] ?? 0, normal[i * 3 + 1] ?? 0, normal[i * 3 + 2] ?? 0);
  if (!plain)
    for (const fit of fits) {
      const axis = n.fromBufferAttribute(made, fit.first).clone(),
        apex = new T.Vector3().fromBufferAttribute(placed, fit.first);
      const corneal = anatomy.cornea * fit.iris;
      for (let i = fit.first + 1; i < fit.first + fit.count; i++) {
        const q = domed[i] ?? -1;
        if (q < 0) continue;
        v.fromBufferAttribute(placed, i).sub(apex);
        v.addScaledVector(axis, -v.dot(axis));
        const rho = v.length(),
          share = anatomy.glint + (1 - anatomy.glint) * smooth(q, 0.4, 1),
          sine = Math.min(0.94, rho / (corneal * share));
        if (rho < 1e-9) continue;
        v.multiplyScalar(sine / rho).addScaledVector(axis, Math.sqrt(1 - sine * sine));
        const keep = smooth(q, 0.86, 1.03);
        n.fromBufferAttribute(made, i);
        v.lerp(n, keep).normalize();
        made.setXYZ(i, v.x, v.y, v.z);
      }
    }
  geometry.morphTargetsRelative = true;
  const turned = gazeTargets.map(([name, axis, angle]) => {
    const shift = new Float32Array(position.length),
      lean = new Float32Array(position.length);
    const from = new T.Vector3(),
      a = new T.Vector3().setComponent(axis, 1);
    for (const fit of fits)
      for (let i = fit.first; i < fit.first + fit.count; i++) {
        from.fromBufferAttribute(placed, i);
        v.copy(from)
          .sub(fit.centre)
          .applyAxisAngle(a, angle)
          .add(fit.centre)
          .sub(from)
          .toArray(shift, i * 3);
        from.fromBufferAttribute(made, i);
        v.copy(from)
          .applyAxisAngle(a, angle)
          .sub(from)
          .toArray(lean, i * 3);
      }
    const moved = new T.BufferAttribute(shift, 3),
      leaned = new T.BufferAttribute(lean, 3);
    moved.name = leaned.name = name;
    return [moved, leaned] as const;
  });
  geometry.morphAttributes["position"] = turned.map((pair) => pair[0]);
  geometry.morphAttributes["normal"] = turned.map((pair) => pair[1]);
  const m = material("#ffffff").clone();
  if (!plain && options.textures && m instanceof T.MeshStandardMaterial) {
    m.map = options.textures.map;
    m.roughnessMap = options.textures.roughnessMap;
    m.roughness = 1;
    m.metalness = 0;
    m.vertexColors = true;
  }
  const mesh = new T.Mesh(geometry, m);
  mesh.name = "high-poly";
  mesh.userData["eyePiece"] = "Iris";
  eyeFitsOf.set(
    mesh,
    fits.map((f) => ({ ...f, centre: f.centre.clone() })),
  );
  return mesh;
}
