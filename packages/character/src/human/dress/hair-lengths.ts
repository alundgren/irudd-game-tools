// The shapes a strand groom hangs its tied lengths on: tails, knots and
// plaits as rings of points, the tie that holds them and where on the head the
// hair is gathered (hairLengths and TIED in character-view/human-style-hair.js
// at 2761eb1).

import { surfaceFrame, type HeadFrame } from "./fringe.js";
import {
  Piece,
  add,
  cross,
  dot,
  lerp3 as lerp,
  mix,
  smooth,
  sub,
  unit,
  type DressBody,
  type Landmarks,
  type Skin,
  type Vec,
} from "./kit.js";

const TAU = Math.PI * 2;

interface TubeOptions {
  readonly sides?: number;
  readonly ridges?: number;
  readonly twist?: number;
  readonly flat?: number;
}

/** The rings of a tube along a path with a radius profile. */
function tubeRings(
  path: ReadonlyArray<Vec>,
  radius: (t: number) => number,
  { sides = 10, ridges = 0, twist = 0, flat = 1 }: TubeOptions = {},
): Vec[][] {
  const rings: Vec[][] = [];
  let normal: Vec | null = null;
  const pointAt = (i: number): Vec => path[i] ?? [0, 0, 0];
  path.forEach((p, i) => {
    const tangent = unit(
      sub(pointAt(Math.min(path.length - 1, i + 1)), pointAt(Math.max(0, i - 1))),
    );
    const along = normal ? dot(normal, tangent) : 0;
    const n: Vec = unit(
      normal
        ? sub(normal, [tangent[0] * along, tangent[1] * along, tangent[2] * along])
        : cross(tangent, [1, 0, 0]),
    );
    normal = n;
    const side = cross(tangent, n),
      t = i / (path.length - 1),
      r = radius(t);
    rings.push(
      Array.from({ length: sides }, (_, j) => {
        const a = (j / sides) * TAU,
          groove = ridges
            ? 1 - 0.16 * (1 - Math.abs(Math.cos((a * ridges) / 2 + twist * t * TAU)))
            : 1;
        return add(add(p, n, Math.cos(a) * r * groove * flat), side, Math.sin(a) * r * groove);
      }),
    );
  });
  return rings;
}

/** A tube along a path with a radius profile: tails, braid strands and ties. */
function tube(
  piece: Piece,
  path: ReadonlyArray<Vec>,
  radius: (t: number) => number,
  skin: Skin,
  options: TubeOptions = {},
): void {
  piece.loft(tubeRings(path, radius, options), skin, { capStart: true, capEnd: true, flip: true });
}

const bezier = (a: Vec, b: Vec, c: Vec, d: Vec, n: number): Vec[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n,
      u = 1 - t;
    const x = (axis: 0 | 1 | 2) =>
      u * u * u * a[axis] + 3 * u * u * t * b[axis] + 3 * u * t * t * c[axis] + t * t * t * d[axis];
    return [x(0), x(1), x(2)];
  });

/** Skin weights for hair that leaves the head: head, then neck, then upper back. */
export function hangSkin(body: DressBody, m: Landmarks): (p: Vec) => Skin {
  const head = body.bone("head"),
    neck = body.bone("neck_01"),
    chest = body.bone("spine_03"),
    k = m.k;
  return (p) => {
    const low = smooth(m.head[1] + 0.02 * k, m.neck[1] - 0.02 * k, p[1]),
      lower = smooth(m.neck[1] + 0.02 * k, m.neck[1] - 0.1 * k, p[1]);
    return [
      [head, neck, chest, 0],
      [1 - low, low * (1 - lower), low * lower, 0],
    ];
  };
}

/** A tube of tied hair: a tail, a knot wound round and round, a plaited strand or the tuft at its end. */
export interface HairTube {
  readonly rings: ReadonlyArray<ReadonlyArray<Vec>>;
  readonly wound?: boolean;
  readonly rigid?: boolean;
  readonly plait?: boolean;
  readonly tuft?: boolean;
}

/** What holds tied hair: cloth, built as the sculpted styles built it. */
export interface HairTie {
  readonly piece: Piece;
  readonly name: string;
  readonly tone: string;
  readonly type: string;
}

/** The shapes a strand groom hangs its lengths on. */
export interface HairLengths {
  readonly tubes: ReadonlyArray<HairTube>;
  readonly ties: ReadonlyArray<HairTie>;
  /** The direction of the head frame where tied hair is gathered. */
  readonly gather: Vec;
  /** Skin weights for a point of hair that has left the head. */
  readonly skin: (p: Vec) => Skin;
  /** The head's own skin, for what turns with it. */
  readonly rigid: Skin;
}

const tieOf = (piece: Piece): HairTie => ({
  piece,
  name: "Hair tie",
  tone: "#3a3331",
  type: "cloth",
});

export type TiedHairStyle = "Ponytail" | "Bun" | "Braid";

// Tails, knots and plaits: tubes as rings of points, the tie that holds them and where on the head the hair is gathered.
const TIED: Readonly<
  Record<
    TiedHairStyle,
    (body: DressBody, m: Landmarks, f: HeadFrame) => Omit<HairLengths, "skin" | "rigid">
  >
> = {
  Ponytail(body, m, f) {
    const k = f.k,
      at: Vec = [0, 0.55 * f.radii[1], -0.83 * f.radii[2]],
      root = add(f.centre, unit(at), f.size * 1.02),
      tie = new Piece();
    const rings = tubeRings(
      bezier(
        root,
        add(root, [0, 0.035 * k, -0.06 * k]),
        add(root, [0, -0.08 * k, -0.1 * k]),
        [0, m.neck[1] - 0.04 * k, root[2] - 0.05 * k],
        18,
      ),
      (t) =>
        k *
        mix(0.02, 0.027, Math.sin(Math.PI * Math.min(1, t * 1.6))) *
        (1 - smooth(0.6, 1, t) * 0.8),
      { ridges: 9, twist: 0.4, sides: 18 },
    );
    tube(
      tie,
      [add(root, [0, -0.004 * k, 0.008 * k]), add(root, [0, 0.008 * k, -0.016 * k])],
      () => 0.024 * k,
      body.rigid("head"),
      { sides: 14 },
    );
    return { gather: [0, 0.55, -0.83], tubes: [{ rings }], ties: [tieOf(tie)] };
  },
  Bun(_body, _m, f) {
    const k = f.k,
      out = unit([0, 0.5 * f.radii[1], -0.86 * f.radii[2]]),
      root = add(f.centre, out, f.size * 1.08),
      side: Vec = [1, 0, 0],
      up = cross(out, side),
      rings: Vec[][] = [];
    for (let i = 0; i <= 12; i++) {
      const lat = mix(-0.42, 0.5, i / 12) * Math.PI,
        r = 0.043 * k * Math.cos(lat),
        h = 0.034 * k * Math.sin(lat);
      rings.push(
        Array.from({ length: 28 }, (_, j) => {
          const a = (j / 28) * TAU,
            groove = 1 - 0.1 * (1 - Math.abs(Math.cos(a * 3.5 + i * 0.55)));
          return add(
            add(add(root, out, h), side, Math.cos(a) * r * groove),
            up,
            Math.sin(a) * r * groove,
          );
        }),
      );
    }
    return { gather: [0, 0.5, -0.86], tubes: [{ rings, wound: true, rigid: true }], ties: [] };
  },
  Braid(body, m, f) {
    const k = f.k,
      skin = hangSkin(body, m),
      start = f.place(Math.PI, -0.42, -0.004 * k),
      end: Vec = [0, m.chest[1] + 0.04 * k, 0],
      spine: Vec[] = [],
      tubes: HairTube[] = [];
    for (let i = 0; i <= 44; i++) {
      const t = i / 44,
        y = mix(start[1], end[1], t);
      const p: Vec = [0, y, mix(start[2], m.chest[2] - 0.14 * k, smooth(0, 0.5, t))];
      const cleared = body.clear(p, 0.026 * k);
      spine.push(lerp(p, cleared, smooth(0.01, 0.28, t)));
    }
    for (let strand = 0; strand < 3; strand++) {
      const path = spine.map((p, i): Vec => {
        const t = i / 44,
          a = t * TAU * 5.5 + (strand * TAU) / 3,
          thin = 1 - 0.35 * smooth(0.6, 1, t);
        return [
          p[0] + Math.sin(a) * 0.014 * k * thin,
          p[1],
          p[2] + Math.sin(2 * a) * 0.007 * k * thin,
        ];
      });
      tubes.push({
        rings: tubeRings(
          path,
          (t) => k * 0.0125 * (1 - 0.4 * smooth(0.6, 1, t)) * smooth(-0.02, 0.06, t),
          { sides: 8 },
        ),
        plait: true,
      });
    }
    const last = spine[spine.length - 1] ?? end,
      tie = new Piece();
    tube(
      tie,
      [add(last, [0, 0.012 * k, 0]), add(last, [0, -0.006 * k, 0])],
      () => 0.014 * k,
      skin(last),
      { sides: 12 },
    );
    tubes.push({
      rings: tubeRings(
        [add(last, [0, -0.004 * k, 0]), add(last, [0, -0.05 * k, 0.004 * k])],
        (t) => k * mix(0.013, 0.003, t),
        { ridges: 7, sides: 14 },
      ),
      tuft: true,
    });
    return { gather: [0, -0.5, -0.86], tubes, ties: [tieOf(tie)] };
  },
};

/** The tied lengths of a style on this body. */
export function tiedLengths(body: DressBody, m: Landmarks, name: TiedHairStyle): HairLengths {
  const f = surfaceFrame(body.surface),
    skin = hangSkin(body, m);
  return { ...TIED[name](body, m, f), skin, rigid: body.rigid("head") };
}
