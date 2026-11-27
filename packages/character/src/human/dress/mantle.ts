import {
  Envelope,
  Piece,
  add,
  clamp,
  mergeSkin,
  mix,
  raycaster,
  smooth,
  unit,
  sub,
  lerp3,
  type Vec,
  type DressBody,
  type Landmarks,
  type Shell,
} from "./kit.js";

const ARMS = /^(upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)/,
  TAU = Math.PI * 2;

function shoulderYoke(
  body: DressBody,
  m: Landmarks,
  shells: readonly Shell[],
  envelopePoint: (h: number, angle: number) => Vec,
) {
  const k = m.k,
    centre = add(m.neck, [0, -0.13 * k, 0]);
  const neckCast = raycaster(body.P, body.tri);
  const head = body.weight(/^head/),
    triangles: number[] = [];
  for (let i = 0; i < body.tri.length; i += 3) {
    const a = body.tri[i] ?? 0,
      b = body.tri[i + 1] ?? 0,
      c = body.tri[i + 2] ?? 0;
    if (
      [a, b, c].some(
        (v) => (head[v] ?? 0) < 0.4 && Math.abs((body.P[v * 3 + 1] ?? 0) - m.neck[1]) < 0.24 * k,
      )
    )
      triangles.push(a, b, c);
  }
  const surfaces = [raycaster(body.P, triangles), ...shells.map((s) => raycaster(s.pos, s.tri))];
  return (h: number, angle: number, ease: number, inset: number) => {
    const length = 0.135 * k,
      rad: Vec = [-Math.sin(angle), 0, Math.cos(angle)];
    const throat: Vec = [
      m.neck[0],
      m.neck[1] + (0.023 - 0.041 * Math.max(0, rad[2])) * k,
      m.neck[2],
    ];
    const skin = neckCast(throat, rad, 0.19 * k);
    const rim = add(throat, rad, (Number.isFinite(skin) ? skin : 0.065 * k) + 0.013 * k);
    const hem = envelopePoint(length, angle);
    const t = clamp(h / length);
    const target = lerp3(rim, hem, t),
      dir = unit(sub(target, centre));
    const distance = (p: Vec) => Math.hypot(...sub(p, centre));
    const reach = 0.46 * k,
      origin = add(centre, dir, reach),
      inward: Vec = [-dir[0], -dir[1], -dir[2]];
    const hit = Math.min(...surfaces.map((cast) => cast(origin, inward, reach)));
    const measured = Number.isFinite(hit) ? reach - hit + (0.008 * k + ease) : distance(target);
    const radius = mix(
      mix(distance(rim), measured, smooth(0, 0.18, t)),
      distance(hem),
      smooth(0.65, 1, t),
    );
    return add(centre, dir, radius - inset);
  };
}

type Edge = (depth: number) => number;
export interface MantlePattern {
  drop: (angle: number, side: number) => number;
  open: Edge;
  swing?: Edge;
  ease?: number;
  fold?: number;
  facing?: number;
  cols?: number;
  armLow?: number;
  split?: number;
  flare?: number;
}
export function mantle(
  body: DressBody,
  m: Landmarks,
  shells: readonly Shell[],
  {
    drop,
    open,
    swing,
    ease = 0.018,
    fold = 0.011,
    facing = 0.1,
    cols = 60,
    armLow = m.waist,
    split = 0,
    flare = 0,
  }: MantlePattern,
) {
  const k = m.k,
    top = m.neck[1] + 0.006 * k,
    arm = body.weight(ARMS),
    head = body.weight(/^head/),
    points: Vec[] = [];
  let depth = 0;
  for (let j = 0; j <= 32; j++) {
    const angle = (j / 32) * Math.PI;
    depth = Math.max(depth, drop(angle, 1), drop(angle, -1));
  }
  const bottom = top - depth;
  for (let v = 0; v < body.count; v++) {
    const y = body.P[v * 3 + 1] ?? 0;
    if (
      (head[v] ?? 0) < 0.5 &&
      y < top + 0.03 * k &&
      y > bottom - 0.03 * k &&
      ((arm[v] ?? 0) < 0.1 || y > armLow)
    )
      points.push(body.point(v));
  }
  for (const s of shells)
    for (let i = 0; i < s.pos.length; i += 3) {
      const y = s.pos[i + 1] ?? 0;
      if (
        y < top + 0.03 * k &&
        y > bottom - 0.03 * k &&
        ((s.f["wArm"]?.[i / 3] ?? 0) < 0.1 || y > armLow)
      )
        points.push([s.pos[i] ?? 0, y, s.pos[i + 2] ?? 0]);
    }
  const rows = Math.max(6, Math.round(depth / (0.028 * k)));
  const env = new Envelope([0, top, m.chest[2]], [0, -1, 0], 0, depth, rows + 1, 64)
    .measure(points)
    .taut(1)
    .hang(swing ? 0.16 : -0.035, swing ? 5 : 0.7)
    .soften(swing ? 1 : 3);
  const chest = body.bone("spine_03"),
    mid = body.bone("spine_01"),
    pelvis = body.bone("pelvis"),
    long = top - m.knee;
  const left = Math.sign(body.joint("upperarm_l")[0]) || 1,
    upper = { l: body.bone("upperarm_l"), r: body.bone("upperarm_r") };
  const skin = (p: Vec) => {
    const t = clamp((top - p[1]) / long),
      low = smooth(0.15, 0.6, t),
      far = smooth(0.5, 1, t) * 0.6,
      v = body.nearest(p, 3);
    const lifted =
      v >= 0
        ? 0.8 * smooth(0.3, 0.8, arm[v] ?? 0) * smooth(armLow - 0.06 * k, armLow + 0.04 * k, p[1])
        : 0;
    return mergeSkin([
      [chest, (1 - low) * (1 - lifted)],
      [mid, low * (1 - far) * (1 - lifted)],
      [pelvis, low * far * (1 - lifted)],
      [p[0] * left > 0 ? upper.l : upper.r, lifted],
    ]);
  };
  const widest = new Map<number, number>(),
    reach = (h: number, angle: number) => {
      const key = Math.round(angle * 40),
        r = Math.max(env.sample(h, angle), widest.get(key) ?? 0);
      widest.set(key, r);
      return r;
    };
  const hangRadius = (h: number, angle: number) => {
    if (!swing) return reach(h, angle);
    let radius = env.sample(h, angle);
    for (let row = 0; row < rows; row++) {
      const above = (row * depth) / rows;
      if (above >= h) break;
      radius = Math.max(radius, env.sample(above, angle) - 0.025 * (h - above));
    }
    return radius;
  };
  const yoke =
    swing &&
    shoulderYoke(body, m, shells, (h, angle) =>
      env.point(h, angle, hangRadius(h, angle) + ease * k * 0.55),
    );
  const point = (v: number, cutAngle: number, inset: number): Vec => {
    const angle = cutAngle + (swing ? swing(v) : 0);
    const around = Math.min(angle, TAU - angle),
      h = drop(around, angle <= Math.PI ? 1 : -1) * v;
    const fullness = swing ? 0.26 + 0.94 * smooth(0, 0.55, v) : 1 + 1.2 * v;
    const pleats = swing
      ? 0.68 * Math.cos(7 * cutAngle - 1.9 * v + 0.77 * Math.sin(cutAngle * 2)) +
        0.32 * Math.cos(12 * cutAngle + 1.6 * v + 0.5 * Math.sin(cutAngle * 3))
      : Math.sin(angle * 9 + 1.7 * Math.sin(angle * 2.3));
    const foldDepth = swing
      ? smooth(0.01, 0.42, v) * (0.3 + 0.7 * smooth(0, 0.65, around))
      : smooth(0.15, 0.9, v) * smooth(0, 0.25, around - open(v));
    const r =
      hangRadius(h, angle) +
      ease * k * fullness +
      flare * k * v * v * smooth(1.2, 2.2, around) +
      fold * k * foldDepth * pleats;
    const hanging = env.point(h, angle, r - inset);
    if (!yoke || h >= 0.135 * k) return hanging;
    const fitted = yoke(h, angle, 0.007 * k * foldDepth * (1 + pleats), inset);
    const blend = smooth(0.09 * k, 0.135 * k, h);
    return lerp3(fitted, hanging, blend);
  };
  const cloth = new Piece(),
    lining = new Piece(),
    turned = (v: number) => facing * (1 + 1.4 * v),
    part = (v: number) => split * smooth(0.3, 1, v);
  const spans: [Piece, Edge, Edge, number][] = [
    [lining, open, (v) => open(v) + turned(v), 5],
    [lining, (v) => TAU - open(v) - turned(v), (v) => TAU - open(v), 5],
  ];
  if (split)
    spans.push(
      [cloth, (v) => open(v) + turned(v), (v) => Math.PI - part(v), Math.round(cols / 2)],
      [cloth, (v) => Math.PI + part(v), (v) => TAU - open(v) - turned(v), Math.round(cols / 2)],
    );
  else spans.push([cloth, (v) => open(v) + turned(v), (v) => TAU - open(v) - turned(v), cols]);
  const grids = spans.map(([piece, from, to, columns]) => ({
    piece,
    from,
    to,
    columns,
    outer: new Array<Vec[]>(),
    inner: new Array<Vec[]>(),
  }));
  for (let row = 0; row <= rows; row++) {
    const v = row / rows;
    for (const grid of grids) {
      const points = (inset: number) =>
        Array.from({ length: grid.columns + 1 }, (_, col) =>
          point(v, mix(grid.from(v), grid.to(v), col / grid.columns), inset),
        );
      grid.outer.push(points(0));
      grid.inner.push(points(0.006 * k));
    }
  }
  for (const { piece, outer, inner, columns } of grids) {
    piece.slab(outer, inner, skin);
    if (swing && piece === cloth) {
      const coordinates = (piece.mantleUV ??= []);
      for (const sheet of [outer, inner])
        sheet.forEach((strip, row) =>
          strip.forEach((_, col) => coordinates.push(col / columns, 1 - row / rows)),
        );
    }
  }
  return {
    cloth,
    lining,
    env,
    top,
    at: (v: number, side: number, lift = 0): Vec => {
      const gap = open(v) + turned(v) * 0.5,
        angle = side > 0 ? gap : TAU - gap;
      if (!swing) {
        const h = drop(gap, side) * v;
        return env.point(h, angle, env.sample(h, angle) + ease * k + lift);
      }
      const row = Math.round(rows * v);
      const grid = grids[side > 0 ? 0 : 1]?.outer[row];
      if (!grid?.length) throw new Error("Missing mantle edge.");
      const point = grid[Math.floor(grid.length / 2)] ?? [0, 0, 0];
      const actual = angle + swing(row / rows);
      return [point[0] - lift * Math.sin(actual), point[1], point[2] + lift * Math.cos(actual)];
    },
  };
}
