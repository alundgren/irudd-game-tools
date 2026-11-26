// Bulky gear worn over the clothes: packs, capes, aprons and helmets
// (character-view/human-style-gear.js at 2761eb1).

import type { Ray } from "../../game/raycast.js";
import { belt, caster, strap } from "./cloth.js";
import {
  Envelope,
  Piece,
  add,
  at,
  clamp,
  cross,
  dot,
  mix,
  smooth,
  sub,
  unit,
  type DressBody,
  type Landmarks,
  type Shell,
  type Skin,
  type Vec,
} from "./kit.js";

const ARMS = /^(upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)/,
  TAU = Math.PI * 2;

/** Cloth a piece of gear measures itself over: a fitted shell, or a finished piece's surface. */
export interface WornSurface {
  readonly pos: ArrayLike<number>;
  readonly tri: ArrayLike<number>;
  readonly f?: Readonly<Record<string, ArrayLike<number>>>;
}
const fieldAt = (s: WornSurface, name: string, i: number): number => s.f?.[name]?.[i] ?? 0;

/** A rounded box or cushion: packs, pouches and bedrolls. `half` holds three half-extent vectors; rings run along the second. */
export function pod(
  piece: Piece,
  centre: Vec,
  half: readonly [Vec, Vec, Vec],
  skin: Skin,
  {
    power = 4,
    rings = 9,
    around = 20,
  }: { readonly power?: number; readonly rings?: number; readonly around?: number } = {},
): void {
  const curve = (x: number) => Math.sign(x) * Math.abs(x) ** (2 / power),
    list: Vec[][] = [];
  for (let i = 0; i <= rings; i++) {
    const t = -Math.cos((i / rings) * Math.PI),
      s = Math.max(0, 1 - Math.abs(t) ** power) ** (1 / power);
    list.push(
      Array.from({ length: around }, (_, j) => {
        const a = (j / around) * TAU;
        return add(
          add(add(centre, half[1], t), half[0], curve(Math.cos(a)) * s),
          half[2],
          curve(Math.sin(a)) * s,
        );
      }),
    );
  }
  piece.loft(list, skin, { flip: dot(cross(half[0], half[1]), half[2]) < 0 });
}

/** Press a path of points onto the clothes, returning [point, outward] pairs for `strap`. */
export function lay(
  cast: Ray,
  points: ReadonlyArray<Vec>,
  inside: (p: Vec) => Vec,
  gap = 0.002,
): Array<readonly [Vec, Vec]> {
  const out: Array<readonly [Vec, Vec]> = [];
  for (const p of points) {
    const d = unit(sub(p, inside(p))),
      origin = add(p, d, 0.35),
      hit = cast(origin, [-d[0], -d[1], -d[2]]);
    if (Number.isFinite(hit) && hit < 0.6) out.push([add(origin, d, gap - hit), d]);
  }
  return out;
}

/** A cape hanging from the shoulders down the back. */
export function cape(
  body: DressBody,
  m: Landmarks,
  shells: ReadonlyArray<WornSurface>,
  {
    bottom,
    ease = 0.016,
    open = 1.75,
    fold = 0.012,
    cols = 44,
  }: {
    readonly bottom: number;
    readonly ease?: number;
    readonly open?: number;
    readonly fold?: number;
    readonly cols?: number;
  },
): { readonly piece: Piece; readonly env: Envelope } {
  const k = m.k,
    top = m.neck[1] + 0.005 * k,
    head = body.weight(/^head/),
    points: Vec[] = [];
  for (let v = 0; v < body.count; v++) {
    const y = at(body.P, v * 3 + 1);
    if (at(body.arm, v) < 0.1 && at(head, v) < 0.5 && y < top + 0.03 * k && y > bottom - 0.03 * k)
      points.push(body.point(v));
  }
  for (const s of shells)
    for (let i = 0; i < s.pos.length; i += 3)
      if (
        fieldAt(s, "arm", i / 3) < 0.1 &&
        at(s.pos, i + 1) < top + 0.03 * k &&
        at(s.pos, i + 1) > bottom - 0.03 * k
      )
        points.push([at(s.pos, i), at(s.pos, i + 1), at(s.pos, i + 2)]);
  const depth = top - bottom,
    rows = Math.round(depth / (0.03 * k));
  const env = new Envelope([0, top, m.chest[2]], [0, -1, 0], 0, depth, rows + 1, 64)
    .measure(points)
    .taut(1)
    .hang(-0.04, 0.7)
    .soften(3);
  const chest = body.bone("spine_03"),
    mid = body.bone("spine_01"),
    pelvis = body.bone("pelvis");
  const skin = (p: Vec): Skin => {
    const t = clamp((top - p[1]) / depth),
      low = smooth(0.15, 0.6, t),
      far = smooth(0.5, 1, t) * 0.6;
    return [
      [chest, mid, pelvis, 0],
      [1 - low, low * (1 - far), low * far, 0],
    ];
  };
  const piece = new Piece(),
    rings: Vec[][] = [],
    inside: Vec[][] = [];
  for (let row = 0; row <= rows; row++) {
    const h = (depth * row) / rows,
      deep = row / rows,
      outer: Vec[] = [],
      inner: Vec[] = [];
    for (let j = 0; j <= cols; j++) {
      const a = mix(open, TAU - open, j / cols),
        edge = Math.sin((j / cols) * Math.PI) ** 0.3;
      const r =
        env.sample(h, a) +
        ease * k +
        fold * k * smooth(0.1, 0.9, deep) * Math.sin(j * 0.9 + 1.7 * Math.sin(j * 0.23)) * edge;
      outer.push(env.point(h, a, r));
      inner.push(env.point(h, a, r - 0.007 * k));
    }
    rings.push(outer);
    inside.push(inner);
  }
  piece.slab(rings, inside, skin);
  return { piece, env };
}

/** A pack on the back with shoulder straps and an optional bedroll, or an air supply with two tanks. */
export function backpack(
  body: DressBody,
  m: Landmarks,
  shells: ReadonlyArray<Shell>,
  { bedroll = true, tanks = false }: { readonly bedroll?: boolean; readonly tanks?: boolean } = {},
): { readonly pack: Piece; readonly gear: Piece } | null {
  const k = m.k,
    cast = caster(shells, true),
    top = m.shoulder - (tanks ? -0.02 : 0.01) * k,
    tall = (tanks ? 0.42 : 0.37) * k,
    wide = Math.min(0.29 * k, m.shoulderWidth * 1.65),
    deep = (tanks ? 0.1 : 0.125) * k;
  let back = Infinity;
  for (const x of [-0.06, 0, 0.06])
    for (const t of [0.2, 0.5, 0.8]) {
      const d = cast([x * k, top - tall * t, m.chest[2] - 0.6], [0, 0, 1]);
      if (Number.isFinite(d)) back = Math.min(back, d);
    }
  if (!Number.isFinite(back)) return null;
  const z = m.chest[2] - 0.6 + back - deep / 2 - 0.004 * k,
    centre: Vec = [0, top - tall / 2, z];
  const skin = body.blend([
      ["spine_03", 0.65],
      ["spine_02", 0.35],
    ]),
    pack = new Piece(),
    gear = new Piece();
  pod(
    pack,
    centre,
    [
      [wide / 2, 0, 0],
      [0, tall / 2, 0],
      [0, 0, deep / 2],
    ],
    skin,
    { power: 3.4, rings: 12, around: 28 },
  );
  if (tanks)
    for (const x of [-0.25, 0.25]) {
      pod(
        gear,
        [wide * x, top - tall * 0.47, z - deep * 0.62],
        [
          [wide * 0.2, 0, 0],
          [0, tall * 0.43, 0],
          [0, 0, wide * 0.2],
        ],
        skin,
        { power: 2.6, rings: 12 },
      );
      pod(
        pack,
        [wide * x, top - tall * 0.02, z - deep * 0.62],
        [
          [wide * 0.07, 0, 0],
          [0, tall * 0.05, 0],
          [0, 0, wide * 0.07],
        ],
        skin,
        { power: 5, rings: 4, around: 12 },
      );
    }
  else {
    pod(
      pack,
      [0, top - tall * 0.68, z - deep * 0.5],
      [
        [wide * 0.36, 0, 0],
        [0, tall * 0.2, 0],
        [0, 0, deep * 0.3],
      ],
      skin,
      { power: 3.2 },
    );
    pod(
      gear,
      [0, top - tall * 0.16, z - deep * 0.08],
      [
        [wide * 0.53, 0, 0],
        [0, tall * 0.19, 0],
        [0, 0, deep * 0.56],
      ],
      skin,
      { power: 5, rings: 8, around: 24 },
    );
  }
  if (bedroll && !tanks) {
    const c: Vec = [0, top + 0.05 * k, z - 0.01 * k];
    pod(
      pack,
      c,
      [
        [0, 0, 0.058 * k],
        [wide * 0.62, 0, 0],
        [0, 0.058 * k, 0],
      ],
      skin,
      { power: 2.4, rings: 10 },
    );
    for (const x of [-0.3, 0.3])
      pod(
        gear,
        add(c, [wide * x, 0, 0]),
        [
          [0, 0, 0.061 * k],
          [0.011 * k, 0, 0],
          [0, 0.061 * k, 0],
        ],
        skin,
        { power: 6, rings: 4 },
      );
  }
  for (const sign of [1, -1]) {
    const x = sign * m.shoulderWidth * 0.6,
      q: Vec = [x, m.shoulder - 0.1 * k, m.chest[2]],
      over: Vec[] = [];
    for (let a = 200; a >= -40; a -= 12) {
      const r = (a * Math.PI) / 180;
      over.push(add(q, [0, Math.sin(r), Math.cos(r)], 0.05));
    }
    const path = lay(cast, over, () => q, 0.003 * k);
    const last = path.at(-1);
    if (path.length < 2 || !last) continue;
    const end = last[0],
      corner: Vec = [sign * wide * 0.46, top - tall * 0.86, z + deep * 0.3];
    const under: Vec[] = [];
    for (let t = 0.12; t <= 1; t += 0.11)
      under.push([
        mix(end[0], corner[0], t) + sign * 0.09 * k * Math.sin(t * Math.PI),
        mix(end[1], corner[1], t),
        mix(end[2], corner[2], t),
      ]);
    path.push(...lay(cast, under, (p) => [0, p[1], m.chest[2]], 0.003 * k));
    path.unshift([
      [x * 0.8, top - 0.02 * k, z + deep * 0.35],
      [0, 1, 0],
    ]);
    strap(gear, body, path, { width: 0.034 * k, thick: 0.005 * k });
  }
  return { pack, gear };
}

/** A bib apron over the front of the clothes, with a waist tie and shoulder straps. */
export function apron(
  body: DressBody,
  m: Landmarks,
  shells: ReadonlyArray<Shell>,
  {
    top = m.chest[1] + 0.1 * m.k,
    bottom = m.knee + 0.05 * m.k,
  }: { readonly top?: number; readonly bottom?: number } = {},
): { readonly piece: Piece; readonly ties: Piece } {
  const k = m.k,
    cast = caster(shells, true),
    arm = body.weight(ARMS),
    points: Vec[] = [];
  for (let v = 0; v < body.count; v++) {
    const y = at(body.P, v * 3 + 1);
    if (at(arm, v) < 0.3 && y < top + 0.04 * k && y > bottom - 0.03 * k) points.push(body.point(v));
  }
  for (const s of shells)
    for (let i = 0; i < s.pos.length; i += 3)
      if (
        s.value("wArm", i / 3) < 0.3 &&
        at(s.pos, i + 1) < top + 0.04 * k &&
        at(s.pos, i + 1) > bottom - 0.03 * k
      )
        points.push([at(s.pos, i), at(s.pos, i + 1), at(s.pos, i + 2)]);
  const depth = top - bottom,
    rows = Math.round(depth / (0.025 * k)),
    cols = 28;
  const env = new Envelope([0, top, m.chest[2]], [0, -1, 0], 0, depth, rows + 1, 64)
    .measure(points)
    .taut(1)
    .hang(0.05, 1)
    .soften(2);
  const piece = new Piece(),
    rings: Vec[][] = [],
    inside: Vec[][] = [],
    tie = m.waist - 0.005 * k;
  const half = (y: number) =>
    mix(1.2, 0.5, smooth(tie - 0.03 * k, tie + 0.04 * k, y)) *
    mix(1, 0.82, smooth(tie + 0.05 * k, top, y));
  for (let row = 0; row <= rows; row++) {
    const h = (depth * row) / rows,
      w = half(top - h),
      outer: Vec[] = [],
      inner: Vec[] = [];
    for (let j = 0; j <= cols; j++) {
      const a = mix(-w, w, j / cols),
        r = env.sample(h, a) + 0.008 * k;
      outer.push(env.point(h, a, r));
      inner.push(env.point(h, a, r - 0.005 * k));
    }
    rings.push(outer);
    inside.push(inner);
  }
  const ties = new Piece();
  piece.slab(rings, inside, (p) => body.skinAt(p[1] > m.crotch ? p : [p[0], p[1], m.pelvis[2]]));
  belt(ties, body, m, shells, tie, { height: 0.018, thick: 0.003, buckle: false });
  for (const sign of [1, -1]) {
    const a = sign * half(top) * 0.92,
      from = env.point(0.005 * k, a, env.sample(0, a) + 0.008 * k),
      mid: Vec = [sign * 0.06 * k, m.neck[1] + 0.02 * k, m.neck[2]],
      end: Vec = [sign * 0.035 * k, tie + 0.02 * k, m.chest[2] - 0.3];
    const line: Vec[] = [];
    for (let t = 0; t <= 1; t += 0.1)
      line.push([mix(from[0], mid[0], t), mix(from[1], mid[1], t), mix(from[2], mid[2], t)]);
    for (let t = 0.12; t <= 1; t += 0.11)
      line.push([mix(mid[0], end[0], t), mix(mid[1], end[1], t), mix(mid[2], end[2], t)]);
    strap(
      ties,
      body,
      lay(
        cast,
        line,
        (p) => [p[0] * 0.6, Math.min(p[1], m.shoulder) - 0.09 * k, m.chest[2]],
        0.002 * k,
      ),
      { width: 0.022 * k, thick: 0.003 * k },
    );
  }
  return { piece, ties };
}
