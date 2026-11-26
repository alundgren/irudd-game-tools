import {
  Shell,
  add,
  at,
  clamp,
  cross,
  dot,
  hash1,
  length,
  mergeSkin,
  mix,
  noise3,
  smooth,
  sub,
  unit,
  type DressBody,
  type Landmarks,
  type Vec,
} from "./kit.js";

const TAU = Math.PI * 2;
const wrap = (angle: number) => angle - TAU * Math.round(angle / TAU);

interface Fold {
  readonly c: number;
  readonly s: number;
  readonly turn?: number;
  readonly r?: number;
  readonly u?: number;
  readonly v: number;
  readonly long: number;
  readonly wide: number;
  readonly lean: number;
  readonly curl: number;
  readonly high: number;
}
type FoldShape = Omit<Fold, "c" | "s">;

function ridge(f: Fold, u: number, v: number, spread: number): number {
  const du = f.turn === undefined ? u - (f.u ?? 0) : wrap(u - f.turn) * (f.r ?? 0),
    dv = v - f.v,
    along = du * f.c + dv * f.s,
    long = f.long * (0.5 + 0.5 * spread);
  if (Math.abs(along) >= long) return 0;
  const across = -du * f.s + dv * f.c - f.curl * along * along,
    x = across / ((across > 0 ? f.wide * f.lean : f.wide / f.lean) * spread);
  if (Math.abs(x) >= 1) return 0;
  const a = along / long;
  return f.high * (1 - a * a) ** 1.5 * (1 - x * x) ** 2;
}

function ridges(list: ReadonlyArray<Fold>, u: number, v: number, spread = 1): number {
  let sum = 0;
  for (const f of list) {
    const h = ridge(f, u, v, spread);
    sum += h * h * h;
  }
  return Math.cbrt(sum);
}
const line = (slope: number, o: FoldShape): Fold => ({
  c: Math.cos(slope),
  s: Math.sin(slope),
  ...o,
});

function clothNormals(s: Shell): Float32Array {
  const n = new Float32Array(s.count * 3),
    p = s.pos;
  for (let t = 0; t < s.tri.length; t += 3) {
    const a = at(s.tri, t) * 3,
      b = at(s.tri, t + 1) * 3,
      c = at(s.tri, t + 2) * 3;
    const ux = at(p, b) - at(p, a),
      uy = at(p, b + 1) - at(p, a + 1),
      uz = at(p, b + 2) - at(p, a + 2),
      vx = at(p, c) - at(p, a),
      vy = at(p, c + 1) - at(p, a + 1),
      vz = at(p, c + 2) - at(p, a + 2);
    const x = uy * vz - uz * vy,
      y = uz * vx - ux * vz,
      z = ux * vy - uy * vx;
    for (const k of [a, b, c]) {
      n[k] = at(n, k) + x;
      n[k + 1] = at(n, k + 1) + y;
      n[k + 2] = at(n, k + 2) + z;
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(at(n, i), at(n, i + 1), at(n, i + 2)) || 1;
    n[i] = at(n, i) / l;
    n[i + 1] = at(n, i + 1) / l;
    n[i + 2] = at(n, i + 2) / l;
  }
  return n;
}

export function refine(
  shell: Shell,
  target: (a: number, b: number, s: Shell) => number,
  rounds = 3,
): Shell {
  let s = shell;
  for (let round = 0; round < rounds; round++) {
    const n = s.count,
      names = Object.keys(s.f),
      normals = clothNormals(s),
      made = new Map<number, number>(),
      out = new Shell();
    out.pos = s.pos.slice();
    out.anc = s.anc.slice();
    out.nrm = s.nrm.slice();
    out.bones = s.bones.slice();
    out.weights = s.weights.slice();
    const source = s;
    const lanes = names.map((name) => {
      const from = source.f[name] ?? [],
        to = Array.from(from);
      out.f[name] = to;
      return [from, to] as const;
    });
    const curved = (
      points: ArrayLike<number>,
      dirs: ArrayLike<number>,
      a: number,
      b: number,
      d: number,
    ) => {
      let ha = 0,
        hb = 0;
      for (let e = 0; e < 3; e++) {
        const half = (at(points, b * 3 + e) - at(points, a * 3 + e)) / 2;
        ha += half * at(dirs, a * 3 + e);
        hb -= half * at(dirs, b * 3 + e);
      }
      return (
        (at(points, a * 3 + d) + at(points, b * 3 + d)) / 2 -
        (ha * at(dirs, a * 3 + d) + hb * at(dirs, b * 3 + d)) / 4
      );
    };
    const middle = (a: number, b: number): number => {
      const key = a < b ? a * n + b : b * n + a;
      const known = made.get(key);
      if (known !== undefined) return known;
      const p = source.pos;
      const long = Math.hypot(
        at(p, a * 3) - at(p, b * 3),
        at(p, a * 3 + 1) - at(p, b * 3 + 1),
        at(p, a * 3 + 2) - at(p, b * 3 + 2),
      );
      if (long <= target(a, b, source)) {
        made.set(key, -1);
        return -1;
      }
      const index = out.count;
      made.set(key, index);
      for (let d = 0; d < 3; d++) {
        out.pos.push(curved(source.pos, normals, a, b, d));
        out.anc.push(curved(source.anc, source.nrm, a, b, d));
        out.nrm.push(at(source.nrm, a * 3 + d) + at(source.nrm, b * 3 + d));
      }
      const k = out.nrm.length - 3,
        l = Math.hypot(at(out.nrm, k), at(out.nrm, k + 1), at(out.nrm, k + 2)) || 1;
      for (let d = 0; d < 3; d++) out.nrm[k + d] = at(out.nrm, k + d) / l;
      const pairs: Array<readonly [number, number]> = [];
      for (let j = 0; j < 4; j++)
        pairs.push(
          [at(source.bones, a * 4 + j), at(source.weights, a * 4 + j)],
          [at(source.bones, b * 4 + j), at(source.weights, b * 4 + j)],
        );
      const [bones, weights] = mergeSkin(pairs);
      out.bones.push(...bones);
      out.weights.push(...weights);
      for (const [from, to] of lanes) to.push((at(from, a) + at(from, b)) / 2);
      return index;
    };
    let split = 0;
    for (let t = 0; t < s.tri.length; t += 3) {
      const v = [at(s.tri, t), at(s.tri, t + 1), at(s.tri, t + 2)],
        m = [middle(at(v, 0), at(v, 1)), middle(at(v, 1), at(v, 2)), middle(at(v, 2), at(v, 0))],
        cuts = m.filter((x) => x >= 0).length;
      split += cuts;
      if (!cuts) out.tri.push(at(v, 0), at(v, 1), at(v, 2));
      else if (cuts === 3)
        out.tri.push(
          at(v, 0),
          at(m, 0),
          at(m, 2),
          at(m, 0),
          at(v, 1),
          at(m, 1),
          at(m, 2),
          at(m, 1),
          at(v, 2),
          at(m, 0),
          at(m, 1),
          at(m, 2),
        );
      else if (cuts === 1) {
        const e = m.findIndex((x) => x >= 0),
          a = at(v, e),
          b = at(v, (e + 1) % 3),
          c = at(v, (e + 2) % 3);
        out.tri.push(a, at(m, e), c, at(m, e), b, c);
      } else {
        const e = m.findIndex((x) => x < 0),
          a = at(v, e),
          b = at(v, (e + 1) % 3),
          c = at(v, (e + 2) % 3),
          bc = at(m, (e + 1) % 3),
          ca = at(m, (e + 2) % 3);
        const far = (i: number, j: number) =>
          Math.hypot(
            at(out.pos, i * 3) - at(out.pos, j * 3),
            at(out.pos, i * 3 + 1) - at(out.pos, j * 3 + 1),
            at(out.pos, i * 3 + 2) - at(out.pos, j * 3 + 2),
          );
        out.tri.push(ca, bc, c);
        if (far(a, bc) < far(b, ca)) out.tri.push(a, b, bc, a, bc, ca);
        else out.tri.push(a, b, ca, b, bc, ca);
      }
    }
    s = out;
    if (!split) break;
  }
  return s;
}

function evenJoint(
  s: Shell,
  body: DressBody,
  field: string,
  upper: string,
  lower: string,
  { half = 0.2, amount = 1 }: { readonly half?: number; readonly amount?: number } = {},
): void {
  for (const side of ["l", "r"]) {
    const a = body.bone(upper + "_" + side),
      b = body.bone(lower + "_" + side),
      sign = side === "l" ? 1 : -1;
    for (let i = 0; i < s.count; i++) {
      const t = s.value(field, i);
      if (at(s.anc, i * 3) * sign <= 0 || t < 1 - half || t > 1 + half) continue;
      let wa = 0,
        wb = 0;
      for (let j = i * 4; j < i * 4 + 4; j++) {
        if (s.bones[j] === a) wa += at(s.weights, j);
        else if (s.bones[j] === b) wb += at(s.weights, j);
      }
      const both = wa + wb;
      if (both < 0.5) continue;
      const share = mix(wb / both, smooth(1 - half, 1 + half, t), amount),
        pairs: Array<readonly [number, number]> = [
          [a, both * (1 - share)],
          [b, both * share],
        ];
      for (let j = i * 4; j < i * 4 + 4; j++)
        if (s.bones[j] !== a && s.bones[j] !== b) pairs.push([at(s.bones, j), at(s.weights, j)]);
      const [bones, weights] = mergeSkin(pairs);
      for (let j = 0; j < 4; j++) {
        s.bones[i * 4 + j] = at(bones, j);
        s.weights[i * 4 + j] = at(weights, j);
      }
    }
  }
}

export interface CreaseOptions {
  readonly upper?: boolean;
  readonly lower?: boolean;
  readonly waistband?: number;
  readonly ease?: number;
  readonly legEnd?: number;
  readonly sleeveEnd?: number;
  readonly low?: number | null;
  readonly amount?: number;
  readonly size?: number;
  readonly seed?: number;
  readonly gap?: number;
  readonly detail?: number;
}

interface Side {
  readonly sign: number;
  readonly hip: Vec;
  readonly knee: Vec;
  readonly ankle: Vec;
  readonly shoulder: Vec;
  readonly thigh: number;
  readonly calf: number;
  readonly upper: number;
  readonly fore: number;
  readonly arms: ReadonlyArray<{
    readonly from: Vec;
    readonly a: Vec;
    readonly e1: Vec;
    readonly e2: Vec;
  }>;
  readonly salt: number;
  readonly knee0: ReadonlyArray<Fold>;
  readonly kneecap: ReadonlyArray<Fold>;
  readonly cuff: ReadonlyArray<Fold>;
  readonly whiskers: ReadonlyArray<Fold>;
  readonly seat: ReadonlyArray<Fold>;
  readonly drag: ReadonlyArray<Fold>;
  readonly swags: ReadonlyArray<Fold>;
  readonly small: ReadonlyArray<Fold>;
  readonly pit: readonly [ReadonlyArray<Fold>, ReadonlyArray<Fold>];
  readonly head: ReadonlyArray<Fold>;
  readonly elbow: ReadonlyArray<Fold>;
  readonly wrist: ReadonlyArray<Fold>;
}

interface Tally {
  high: number;
  sink: number;
  deep: number;
  fold(out: number, into: number, list: ReadonlyArray<Fold>, u: number, v: number): void;
}

export function crease(
  shell: Shell,
  body: DressBody,
  m: Landmarks,
  options: CreaseOptions = {},
): Shell {
  const {
    upper = true,
    lower = false,
    waistband = m.waistband,
    ease = 0.008,
    legEnd = 2,
    sleeveEnd = 0.5,
    low = null,
    amount = 1,
    size = 1,
    seed = 0,
    gap = 0.004,
    detail = 1,
  } = options;
  let s = shell;
  const k = m.k,
    snug = smooth(0.0025, 0.008, ease),
    loose = smooth(0.007, 0.018, ease),
    wide = size * mix(0.9, 1.5, loose),
    bulk = 1 + 1.3 * loose,
    floor = Math.max(gap * 1.2, ease * 0.45) + 0.0005;
  if (amount <= 0 || snug <= 0) return s;
  const hem = low ?? waistband,
    middle = mix(m.waist, m.chest[1], 0.25),
    centre = m.chest[2];
  const sides = ["l", "r"].map((name): Side => {
    const j = (bone: string) => body.joint(bone + "_" + name),
      hip = j("thigh"),
      knee = j("calf"),
      ankle = j("foot"),
      shoulder = j("upperarm"),
      elbow = j("lowerarm"),
      wrist = j("hand"),
      sign = name === "l" ? 1 : -1;
    const frame = (from: Vec, to: Vec) => {
      const a = unit(sub(to, from)),
        e1 = unit(sub([0, 0, 1], [a[0] * a[2], a[1] * a[2], a[2] * a[2]]));
      let e2 = sub([0, -1, 0], [a[0] * -a[1], a[1] * -a[1], a[2] * -a[1]]);
      e2 = sub(e2, [e1[0] * dot(e2, e1), e1[1] * dot(e2, e1), e1[2] * dot(e2, e1)]);
      return { from, a, e1, e2: length(e2) > 0.3 ? unit(e2) : unit(cross(e1, a)) };
    };
    const salt = seed * 31 + (name === "l" ? 17 : 91);
    let draws = 0;
    const r = (a = 0, b = 1) => mix(a, b, hash1(salt * 131 + ++draws * 7 + 3)),
      flip = () => (r() < 0.5 ? -1 : 1);
    const zigzag = (
      count: number,
      turn: number,
      radius: number,
      step: number,
      long: number,
      broad: number,
    ) => {
      const first = flip();
      return Array.from({ length: count }, (_, n) =>
        line(first * (n % 2 ? 1 : -1) * r(0.2, 0.5), {
          turn: turn + r(-0.2, 0.2) + first * (n % 2 ? 0.13 : -0.13),
          r: radius,
          v: (n - (count - 1) / 2 + r(-0.2, 0.2)) * step,
          long: long * r(0.8, 1.15),
          wide: broad * r(0.85, 1.2),
          lean: r(0.8, 1.25),
          curl: r(-2, 2),
          high: r(0.7, 1) * (1 - 0.22 * Math.abs(n - (count - 1) / 2)),
        }),
      );
    };
    const stack = (
      count: number,
      radius: number,
      step: number,
      long: number,
      broad: number,
      first: number,
    ) => {
      const start = first + r(-0.5, 0.5),
        way = flip();
      return Array.from({ length: count }, (_, n) =>
        line(r(-0.25, 0.25), {
          turn: start + way * n * r(2, 2.7),
          r: radius,
          v: 0.02 + (n + r(-0.15, 0.15)) * step,
          long: long * r(0.8, 1.2),
          wide: broad * r(0.85, 1.2),
          lean: r(0.7, 1.4),
          curl: r(-3, 3),
          high: r(0.75, 1) * (1 - 0.14 * n),
        }),
      );
    };
    const fan = (
      angles: ReadonlyArray<number>,
      from: readonly [number, number],
      long: number,
      broad: number,
    ) =>
      angles.map((angle) => {
        const a = angle + r(-0.08, 0.08),
          half = (long * r(0.75, 1.2)) / 2;
        return line(a, {
          u: from[0] + Math.cos(a) * (0.022 + half),
          v: from[1] + Math.sin(a) * (0.022 + half),
          long: half,
          wide: broad * r(0.85, 1.15),
          lean: r(0.7, 1.4),
          curl: r(-1.5, 3),
          high: r(0.6, 1),
        });
      });
    const knee0 = zigzag(
      loose > 0.6 ? 2 : loose > 0.2 ? 3 : 4,
      Math.PI + 0.25,
      0.07,
      0.04 * wide,
      0.07 * Math.sqrt(wide),
      0.024 * wide,
    );
    const kneecap = [
      line(r(-0.15, 0.15), {
        turn: r(-0.15, 0.15),
        r: 0.07,
        v: -0.055 + r(-0.008, 0.008),
        long: r(0.045, 0.055),
        wide: 0.024 * wide,
        lean: 1.4,
        curl: r(2.5, 4),
        high: 1,
      }),
    ];
    const cuff = stack(legEnd > 1.99 ? 4 : 3, 0.05, 0.036 * wide, 0.07, 0.022 * wide, 0);
    const whiskers = fan(
      r() < 0.5 ? [-0.15, 0.16, 0.46, 0.8] : [-0.05, 0.3, 0.66],
      [0.026, 0.004],
      0.12,
      0.016 * wide,
    );
    const seat = [
      line(r(-0.12, 0.12), {
        u: r(-0.01, 0.02),
        v: r(-0.014, 0.006),
        long: r(0.065, 0.085),
        wide: r(0.024, 0.03) * wide,
        lean: 1.4,
        curl: r(1.5, 3.5),
        high: 1,
      }),
      line(r(-0.15, 0.15), {
        u: r(-0.04, 0),
        v: -0.05 * wide + r(-0.006, 0.006),
        long: r(0.04, 0.06),
        wide: 0.022 * wide,
        lean: 1.2,
        curl: r(1, 3),
        high: 0.65,
      }),
    ];
    const drag =
      r() < 0.8
        ? [
            line(Math.PI / 2 + r(0.25, 0.55), {
              turn: r(0.2, 0.9),
              r: 0.08,
              v: r(-0.27, -0.17),
              long: r(0.09, 0.13),
              wide: r(0.026, 0.032) * wide,
              lean: r(0.7, 1.4),
              curl: r(-1, 1),
              high: 1,
            }),
          ]
        : [];
    const swags = [0, 1]
      .map((n) =>
        line(r(-0.2, 0.2), {
          turn: sign * (1.75 + r(-0.25, 0.25)),
          r: 0.15,
          v: n ? -0.065 * wide + r(-0.008, 0.008) : r(0, 0.03),
          long: r(0.08, 0.12),
          wide: r(0.028, 0.036) * wide,
          lean: 1.3,
          curl: r(1.2, 2.5),
          high: n ? 0.7 : 1,
        }),
      )
      .filter((f) => middle + f.v * k > hem + 0.04 * k);
    const small =
      sign > 0 && hem < m.waistband - 0.03 * k
        ? [
            line(r(-0.15, 0.15), {
              turn: Math.PI + r(-0.3, 0.3),
              r: 0.15,
              v: (hem - middle) / k + 0.065 + r(-0.01, 0.01),
              long: r(0.07, 0.1),
              wide: 0.03 * wide,
              lean: 1.3,
              curl: r(1.5, 2.5),
              high: 0.7,
            }),
          ]
        : [];
    const pit = [
      fan([-0.25, -0.7, -1.15], [0.02, 0], 0.11, 0.016 * wide),
      fan([-0.6], [0.02, 0], 0.1, 0.018 * wide),
    ] as const;
    const head = [0, 1].map((n) =>
      line(r(0.25, 0.55), {
        turn: Math.PI / 2 + 0.4 + r(-0.25, 0.25),
        r: 0.05,
        v: 0.05 + n * 0.04 * wide + r(-0.008, 0.008),
        long: r(0.04, 0.055),
        wide: r(0.018, 0.022) * wide,
        lean: 1.3,
        curl: r(-2, 2),
        high: n ? 0.7 : 1,
      }),
    );
    const elbowFolds = zigzag(3, 0.35, 0.045, 0.033 * wide, 0.048 * Math.sqrt(wide), 0.019 * wide);
    const wristFolds = stack(
      loose > 0.5 ? 3 : 2,
      0.036,
      0.032 * wide,
      0.048,
      0.019 * wide,
      Math.PI / 2,
    );
    return {
      sign,
      hip,
      knee,
      ankle,
      shoulder,
      thigh: length(sub(knee, hip)),
      calf: length(sub(ankle, knee)),
      upper: length(sub(elbow, shoulder)),
      fore: length(sub(wrist, elbow)),
      arms: [frame(shoulder, elbow), frame(elbow, wrist)],
      salt,
      knee0,
      kneecap,
      cuff,
      whiskers,
      seat,
      drag,
      swags,
      small,
      pit,
      head,
      elbow: elbowFolds,
      wrist: wristFolds,
    };
  });
  const [left, right] = sides;
  if (!left || !right) return s;
  const leftSide: Side = left;
  const of = (i: number) => (at(s.anc, i * 3) >= 0 ? left : right);
  const legAngle = (i: number) => {
    const side = of(i),
      t = s.value("leg", i),
      q = t < 1 ? clamp(t) : clamp(t - 1),
      from = t < 1 ? side.hip : side.knee,
      to = t < 1 ? side.knee : side.ankle;
    return Math.atan2(
      (at(s.anc, i * 3) - mix(from[0], to[0], q)) * side.sign,
      at(s.anc, i * 3 + 2) - mix(from[2], to[2], q),
    );
  };
  const armAngle = (i: number) => {
    const side = of(i),
      f = side.arms[s.value("arm", i) < 1 ? 0 : 1],
      d = sub(s.anchor(i), f?.from ?? [0, 0, 0]);
    return Math.atan2(dot(d, f?.e2 ?? [0, 0, 0]), dot(d, f?.e1 ?? [0, 0, 0]));
  };
  let slack = new Float32Array(0);
  const measure = () => {
    let now = Float32Array.from({ length: s.count }, (_, i) =>
      Math.max(0, dot(sub(s.at(i), s.anchor(i)), s.normal(i)) / k - floor),
    );
    for (let pass = 0; pass < 4; pass++) {
      const sum = new Float32Array(s.count),
        links = new Uint16Array(s.count);
      for (let t = 0; t < s.tri.length; t += 3)
        for (let e = 0; e < 3; e++) {
          const a = at(s.tri, t + e),
            b = at(s.tri, t + ((e + 1) % 3));
          sum[a] = at(sum, a) + at(now, b);
          links[a] = at(links, a) + 1;
        }
      const before = now;
      now = before.map((x, i) => (links[i] ? (x + at(sum, i) / at(links, i)) / 2 : x));
    }
    slack = now;
  };
  const slackAt = (i: number) => at(slack, i);
  const drift = (i: number) =>
    noise3(
      at(s.anc, i * 3) / (0.13 * k) + seed,
      at(s.anc, i * 3 + 1) / (0.13 * k),
      at(s.anc, i * 3 + 2) / (0.13 * k),
    ) - 0.5;

  function tally(): Tally {
    const sum: Tally = {
      high: 0,
      sink: 0,
      deep: 0,
      fold(out, into, list, u, v) {
        const shape = ridges(list, u, v),
          ground = into > 0 ? ridges(list, u, v, 2.6) : 0;
        if (shape <= 0 && ground <= 0) return;
        sum.high += out * shape;
        sum.sink += into * Math.max(0, ground - shape);
        sum.deep = Math.max(
          sum.deep,
          (out + into) * Math.min(1, 3 * Math.max(shape, ground * 0.4)),
        );
      },
    };
    return sum;
  }
  function trousers(i: number): Tally {
    const side = of(i),
      t = s.value("leg", i),
      x = Math.abs(at(s.anc, i * 3)) / k,
      y = at(s.anc, i * 3 + 1),
      nz = at(s.nrm, i * 3 + 2),
      slack = slackAt(i),
      inner = -at(s.nrm, i * 3) * side.sign,
      sum = tally();
    const open = 1 - smooth(0.25, 0.65, inner) * smooth(1.1, 0.7, t);
    if (nz > 0.1 && t < 0.6) {
      const on = smooth(0.1, 0.45, nz) * open;
      sum.fold(
        on * Math.min(0.008, 0.005 * snug * mix(1, 0.55, loose) + 0.12 * slack),
        on * Math.min(0.006 * bulk, 0.4 * slack),
        side.whiskers,
        x,
        (y - m.crotch) / k,
      );
    }
    if (nz < -0.1 && t < 0.6) {
      const on = smooth(0.1, 0.5, -nz) * open;
      sum.fold(
        on * Math.min(0.009, 0.004 * snug + 0.15 * slack),
        on * mix(1, 0.5, loose) * Math.min(0.012, 0.5 * slack),
        side.seat,
        x - Math.abs(side.hip[0]) / k,
        (y - m.crotch) / k,
      );
    }
    if (t > 0.3 && legEnd > 1.25) {
      const angle = legAngle(i),
        h = ((t - 1) * (t < 1 ? side.thigh : side.calf)) / k;
      sum.fold(
        Math.min(0.01, 0.0058 * snug + 0.12 * slack),
        loose * Math.min(0.009, 0.6 * slack),
        side.knee0,
        angle,
        h,
      );
      sum.fold(Math.min(0.005, 0.0026 * snug + 0.1 * slack), 0, side.kneecap, angle, h);
      sum.fold(
        open * Math.min(0.006, 0.002 * snug + 0.12 * slack),
        open * Math.min(0.008, 0.5 * slack),
        side.drag,
        angle,
        h,
      );
      if (legEnd > 1.75) {
        const above = ((Math.min(legEnd, 2.02) - t) * side.calf) / k,
          edge = mix(0.35, 1, smooth(0, 0.016, above));
        sum.fold(
          edge *
            Math.min(0.012, (0.0045 + 0.005 * smooth(1.9, 2.02, legEnd)) * snug + 0.15 * slack),
          edge * Math.min(0.014 * bulk, 0.7 * slack),
          side.cuff,
          angle,
          above,
        );
      }
    }
    if (t > 0.2 && slack > 0) {
      const phase =
        2.7 * legAngle(i) +
        1.1 * Math.sin(2.3 * t + TAU * hash1(side.salt)) +
        1.5 * drift(i) +
        TAU * hash1(side.salt + 1);
      sum.sink +=
        smooth(0.3, 0.75, t) *
        open *
        Math.min(0.014 * loose + 0.002, 0.45 * slack) *
        (0.5 - 0.5 * Math.cos(phase));
    }
    return sum;
  }
  function top(i: number): Tally {
    const side = of(i),
      y = at(s.anc, i * 3 + 1),
      x = at(s.anc, i * 3),
      nz = at(s.nrm, i * 3 + 2),
      armed = s.value("wArm", i),
      slack = slackAt(i),
      calm = s.value("calm", i),
      sum = tally();
    const around = Math.atan2(x, at(s.anc, i * 3 + 2) - centre),
      trunk = 1 - smooth(0.25, 0.6, armed);
    if (trunk > 0) {
      const free = smooth(m.waistband + 0.02 * k, m.waistband + 0.07 * k, y),
        v = (y - middle) / k,
        on = trunk * (1 - 0.8 * calm);
      sum.fold(
        on * Math.min(0.007, 0.0012 * snug + 0.2 * slack),
        on * free * Math.min(0.008, 0.5 * slack),
        side.swags,
        around,
        v,
      );
      sum.fold(on * Math.min(0.007, 0.0012 * snug + 0.25 * slack), 0, leftSide.small, around, v);
      const pit = trunk * (1 - 0.75 * calm) * smooth(0.05, 0.3, Math.abs(nz));
      sum.fold(
        pit * Math.min(0.006, 0.0034 * snug * mix(1, 0.6, loose) + 0.12 * slack),
        (nz > 0 ? 1 : 0) * pit * free * Math.min(0.004, 0.3 * slack),
        side.pit[nz > 0 ? 0 : 1],
        (Math.abs(side.shoulder[0]) - 0.012 * k - Math.abs(x)) / k,
        (y - side.shoulder[1]) / k + 0.075,
      );
      const wave = 2.5 * around + 1.6 * Math.sin(around + TAU * hash1(seed + 5)) + 4 * drift(i);
      sum.high +=
        trunk *
        smooth(0.12, 0, (y - hem) / k) *
        Math.min(0.012 * loose + 0.001, 0.5 * slack) *
        (0.5 - 0.5 * Math.cos(wave));
    }
    if (armed > 0.4) {
      const t = s.value("arm", i),
        angle = armAngle(i),
        on = smooth(0.4, 0.75, armed),
        long = sleeveEnd > 1.25,
        end = (Math.min(sleeveEnd, 0.9) * side.upper) / k;
      if (t < 0.9) {
        const head = on * smooth(end - 0.012, end - 0.04, (t * side.upper) / k);
        sum.fold(
          head * Math.min(0.007, 0.003 * snug + 0.15 * slack),
          head * Math.min(0.009 * bulk, 0.6 * slack),
          side.head,
          angle,
          (t * side.upper) / k,
        );
      }
      if (long && t > 0.5)
        sum.fold(
          on * Math.min(0.008, 0.0036 * snug + 0.12 * slack),
          on * Math.min(0.012 * bulk, 0.7 * slack),
          side.elbow,
          angle,
          ((t - 1) * (t < 1 ? side.upper : side.fore)) / k,
        );
      if (sleeveEnd > 1.6 && t > 1.2) {
        const above = ((Math.min(sleeveEnd, 1.98) - t) * side.fore) / k,
          edge = on * mix(0.35, 1, smooth(0, 0.014, above));
        sum.fold(
          edge * Math.min(0.009, 0.003 * snug + 0.15 * slack),
          edge * Math.min(0.013 * bulk, 0.7 * slack),
          side.wrist,
          angle,
          above,
        );
      }
      if (long && slack > 0)
        sum.sink +=
          on *
          smooth(0.15, 0.5, t) *
          Math.min(0.018 * loose + 0.0015, 0.4 * slack) *
          (0.5 -
            0.5 *
              Math.cos(
                2.3 * angle + 1.2 * Math.sin(2.6 * t + TAU * hash1(side.salt + 2)) + 3 * drift(i),
              ));
    }
    return sum;
  }
  const part = (i: number) =>
    upper && lower
      ? smooth(waistband - 0.02 * k, waistband + 0.04 * k, at(s.anc, i * 3 + 1))
      : upper
        ? 1
        : 0;
  const none = { high: 0, sink: 0, deep: 0 },
    scale = k * amount;
  const folds = (i: number): Vec => {
    const u = part(i),
      a = u > 0 ? top(i) : none,
      b = u < 1 ? trousers(i) : none;
    return [
      (a.high * u + b.high * (1 - u)) * scale,
      (a.deep * u + b.deep * (1 - u)) * scale,
      (a.sink * u + b.sink * (1 - u)) * scale,
    ];
  };
  const coarse = 0.021,
    fine = 0.0095;

  if (lower && legEnd > 1.25) evenJoint(s, body, "leg", "thigh", "calf");
  if (upper && sleeveEnd > 1.25) evenJoint(s, body, "arm", "upperarm", "lowerarm", { half: 0.18 });
  for (let round = 0; round < 3; round++) {
    measure();
    s.f["fold"] = Array.from({ length: s.count }, (_, i) =>
      clamp((folds(i)[1] - 0.0008 * k) / (0.002 * k)),
    );
    const before = s.count;
    s = refine(
      s,
      (a, b, now) =>
        mix(coarse, fine / detail, Math.max(now.value("fold", a), now.value("fold", b))) * k * 1.3,
      1,
    );
    if (s.count === before) break;
  }
  delete s.f["fold"];
  measure();
  const normals = clothNormals(s),
    height = new Float32Array(s.count),
    sink = new Float32Array(s.count);
  for (let i = 0; i < s.count; i++) {
    const f = folds(i);
    height[i] = f[0];
    sink[i] = f[2];
  }
  for (const field of [height, sink, height, sink]) {
    const sum = new Float32Array(s.count),
      links = new Uint16Array(s.count);
    for (let t = 0; t < s.tri.length; t += 3)
      for (let e = 0; e < 3; e++) {
        const a = at(s.tri, t + e),
          b = at(s.tri, t + ((e + 1) % 3));
        sum[a] = at(sum, a) + at(field, b);
        links[a] = at(links, a) + 1;
      }
    for (let i = 0; i < s.count; i++)
      if (links[i] && (at(field, i) > 0 || at(sum, i) > 0))
        field[i] = mix(at(field, i), at(sum, i) / at(links, i), 0.5);
  }
  const foldMetres = new Float32Array(s.count);
  s.f["foldMetres"] = foldMetres;
  for (let i = 0; i < s.count; i++) {
    if (at(height, i) <= 0 && at(sink, i) <= 0) continue;
    const own: Vec = [at(normals, i * 3), at(normals, i * 3 + 1), at(normals, i * 3 + 2)],
      before = dot(sub(s.at(i), s.anchor(i)), s.normal(i)),
      on = smooth(0.4, 0.75, dot(own, s.normal(i)));
    if (on <= 0) continue;
    const facing = dot(own, s.normal(i)),
      p = add(s.at(i), own, (at(height, i) - at(sink, i)) * on),
      least = Math.min(before, floor * k),
      d = dot(sub(p, s.anchor(i)), s.normal(i));
    const next = d < least ? add(p, own, (least - d) / facing) : p;
    foldMetres[i] = dot(sub(next, s.at(i)), own);
    s.set(i, next);
  }
  return s;
}
