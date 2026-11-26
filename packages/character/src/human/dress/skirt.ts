// A skirt, a tunic tail or a coat tail hanging round both legs (skirt in
// character-view/human-style-cloth.js and human-skirt-drape.js at 2761eb1).
//
// A draped skirt is a length of cloth sewn to the waist: it lies on the body
// down to the widest place under it, leaves the body there and falls. Its
// pattern is wider at the hem than the fall is, and what is left over stands
// in folds. The hem is where the cloth runs out, so it rides up over a belly or
// a seat and dips between folds. A long one describes a few joints its lower
// cloth hangs from (human/drape.ts moves them).

import type { ClothJoints } from "../cloth-joints.js";
import {
  Envelope,
  Piece,
  add,
  at,
  clamp,
  dot,
  hash1,
  length,
  mergeSkin,
  mix,
  raycaster,
  smooth,
  sub,
  unit,
  type DressBody,
  type Landmarks,
  type Shell,
  type Skin,
  type Vec,
} from "./kit.js";

const TAU = Math.PI * 2;
const ARMS = /^(upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)/;

/** How a named cloth hangs. */
export interface Cloth {
  /** How much wider the pattern grows per metre of length, as radius. */
  readonly sweep: number;
  /** The length over which the cloth leaving the hip turns to a vertical fall; stiff cloth has a long reach. */
  readonly reach: number;
  /** How many folds the fullness gathers into round the whole skirt. */
  readonly folds: number;
  /** The deepest a fold may stand, as a share of its width. */
  readonly deep: number;
  /** How flat the centre front lies. */
  readonly calm: number;
  /** Extra fullness carried behind. */
  readonly back: number;
  /** The most the hem may ride above or dip below its line, in metres before body scaling. */
  readonly lift: number;
  readonly onset: number;
}

/** Cloths that hang differently. */
export const drapes = {
  // Heavy satin: few deep flutes that open late.
  gown: {
    sweep: 0.17,
    reach: 0.26,
    folds: 8,
    deep: 0.3,
    calm: 0.5,
    back: 0.35,
    lift: 0.03,
    onset: 0.14,
  },
  // A gored skirt in a lighter silk: a rounder bell and more, shallower folds.
  gored: {
    sweep: 0.3,
    reach: 0.2,
    folds: 11,
    deep: 0.27,
    calm: 0.2,
    back: 0.2,
    lift: 0.026,
    onset: 0.08,
  },
  // A cotton day dress: many small soft folds from the waist seam.
  dress: {
    sweep: 0.26,
    reach: 0.16,
    folds: 15,
    deep: 0.24,
    calm: 0.1,
    back: 0.1,
    lift: 0.02,
    onset: 0.05,
  },
  // A short wool or twill skirt: nearly straight, a few broad folds.
  skirt: {
    sweep: 0.15,
    reach: 0.14,
    folds: 9,
    deep: 0.2,
    calm: 0.3,
    back: 0.1,
    lift: 0.014,
    onset: 0.06,
  },
  // A woollen robe: a straight heavy tube that breaks in long folds under the belt.
  robe: {
    sweep: 0.1,
    reach: 0.3,
    folds: 7,
    deep: 0.26,
    calm: 0.15,
    back: 0.2,
    lift: 0.022,
    onset: 0.03,
  },
} as const satisfies Readonly<Record<string, Cloth>>;
export type DrapeName = keyof typeof drapes;

const turn = (a: number) => ((a % TAU) + TAU) % TAU;
// Distance round the circle from the centre front.
const fromFront = (a: number) => {
  const t = turn(a);
  return Math.min(t, TAU - t);
};

/** The hanging surface of a skirt. */
export interface DrapeField {
  /** Distance from the ring's centre at a depth and direction, folds included. */
  radius(h: number, a: number): number;
  /** The surface without its folds. */
  mean(h: number, a: number): number;
  /** Where the cloth would fall with no leg carrying it. */
  free(h: number, a: number): number;
  /** How far the folds stand out of (positive) or sink into the mean surface there. */
  relief(h: number, a: number): number;
  /** Depth of the hem in that direction. */
  hem(a: number): number;
  /** Depth at which the cloth leaves the body. */
  leave(a: number): number;
}

/**
 * The hanging surface of a skirt over `env`, an envelope measured round the
 * figure and pulled taut round each ring, running from the waist seam (row 0)
 * down past the hem. `nominal` is the length to the designed hem line and
 * `seat` the depth of the fork of the legs: the cloth hangs from the trunk
 * above it, and the legs below it only push the cloth out where they stand
 * further out than it falls.
 */
export function drapeField(
  env: Envelope,
  o: Cloth & {
    readonly k: number;
    readonly nominal: number;
    readonly seat?: number;
    readonly seed?: number;
  },
): DrapeField {
  const {
    k,
    nominal,
    seat = nominal,
    seed = 0,
    sweep,
    reach,
    folds,
    deep,
    calm,
    back,
    lift,
    onset,
  } = o;
  const { rows, cols } = env,
    dh = (env.h1 - env.h0) / (rows - 1),
    body = env.r,
    ix = (i: number, j: number) => i * cols + (((j % cols) + cols) % cols);
  // Hanging cloth never turns back in under a prominence.
  const hung = body.slice(),
    fork = Math.min(rows - 1, Math.round(seat / dh));
  for (let j = 0; j < cols; j++)
    for (let i = 1; i < rows; i++)
      hung[ix(i, j)] =
        i > fork ? at(hung, ix(fork, j)) : Math.max(at(hung, ix(i, j)), at(hung, ix(i - 1, j)));
  // Cloth has some stiffness: it does not follow a sharp ledge under the waist seam but rounds it, standing a
  // little proud above the ledge. The corner may be no tighter than a few centimetres.
  const round = 0.045 * k;
  for (let j = 0; j < cols; j++)
    for (let pass = 0; pass < 3; pass++)
      for (let i = rows - 2; i >= 1; i--) {
        const span = Math.max(1, Math.round(round / dh)),
          lo = Math.max(0, i - span),
          hi = Math.min(rows - 1, i + span);
        const chord = mix(at(hung, ix(lo, j)), at(hung, ix(hi, j)), (i - lo) / (hi - lo));
        if (chord > at(hung, ix(i, j))) hung[ix(i, j)] = mix(at(hung, ix(i, j)), chord, 0.7);
      }
  // Round each ring too, without ever letting the cloth inside the figure.
  for (let pass = 0; pass < 2; pass++) {
    const old = hung.slice();
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < cols; j++)
        hung[ix(i, j)] = Math.max(
          at(old, ix(i, j)),
          (at(old, ix(i, j - 1)) + 2 * at(old, ix(i, j)) + at(old, ix(i, j + 1))) / 4,
        );
  }
  // Below the fork a thigh or a knee that stands out carries the cloth, which hangs straight from it in turn.
  const legs = new Float32Array(rows * cols);
  for (let j = 0; j < cols; j++)
    for (let i = fork + 1; i < rows; i++)
      legs[ix(i, j)] = Math.max(at(legs, ix(i - 1, j)), at(body, ix(i, j)));
  for (let pass = 0; pass < 2; pass++) {
    const old = legs.slice();
    for (let i = fork + 1; i < rows; i++)
      for (let j = 0; j < cols; j++)
        legs[ix(i, j)] = Math.max(
          at(old, ix(i, j)),
          (at(old, ix(i, j - 1)) + 2 * at(old, ix(i, j)) + at(old, ix(i, j + 1))) / 4,
        );
  }
  // Where the cloth leaves the body in each direction: the first depth at which it is as far out as it will get.
  const leaveRow = new Float32Array(cols);
  for (let j = 0; j < cols; j++) {
    const most = at(hung, ix(rows - 1, j));
    let i = 0;
    while (i < rows - 1 && at(hung, ix(i, j)) < most - 0.003 * k) i++;
    leaveRow[j] = i;
  }
  for (let pass = 0; pass < 4; pass++) {
    const old = leaveRow.slice();
    for (let j = 0; j < cols; j++)
      leaveRow[j] = (at(old, (j + cols - 1) % cols) + 2 * at(old, j) + at(old, (j + 1) % cols)) / 4;
  }
  // The folds of one skirt: unevenly spaced, some fuller than others, the same for the same figure and cloth.
  const s = (n: number) => hash1(seed * 7 + n) * TAU,
    even = Math.min(1, folds / 11);
  const phase = (a: number) =>
    folds * a +
    even *
      (1.05 * Math.sin(2 * a + s(1)) +
        0.8 * Math.sin(3 * a + s(2)) +
        0.45 * Math.sin(5 * a + s(3))) +
    s(4);
  const fullness = (a: number) =>
    (1 + 0.3 * Math.sin(2.3 * a + s(5)) + 0.18 * Math.sin(4 * a + s(6))) *
    (1 - calm * Math.exp(-((fromFront(a) / 0.5) ** 2))) *
    (1 + back * 0.5 * (1 - Math.cos(a)));
  // A fold seen from above: a broad lobe standing out and a narrower valley between two of them.
  const wave = (p: number) => -(Math.cos(p) + 0.32 * Math.cos(2 * p)) / 1.32;
  const mean = new Float32Array(rows * cols),
    stand = new Float32Array(rows * cols),
    free = new Float32Array(rows * cols);
  for (let j = 0; j < cols; j++) {
    const a = (j / cols) * TAU,
      full = fullness(a),
      lean = 0.5 * Math.sin(a * 2 + s(7));
    for (let i = 0; i < rows; i++) {
      const t = Math.max(0, (i - at(leaveRow, j)) * dh),
        far = at(hung, ix(i, j));
      // Leaving the hip the cloth carries on outward and gravity turns it down: a bell, not a cone.
      const bell = sweep * full * reach * k * (1 - Math.exp(-t / (reach * k)));
      // A leg standing further out than the fall carries the cloth out with it.
      const r = Math.max(far + bell, at(legs, ix(i, j)) + 0.004 * k);
      // What the pattern has over the fall stands in folds. A wave of `folds` lobes and height A round a ring
      // of radius r is longer than the ring by about (folds * A / 2r)^2.
      const spare = Math.max(0, far + sweep * full * t - r),
        width = (TAU * r) / folds;
      const height =
        Math.min(((2 * r) / folds) * Math.sqrt(spare / r), deep * width) * smooth(0, onset * k, t);
      mean[ix(i, j)] = r;
      free[ix(i, j)] = far + bell;
      stand[ix(i, j)] = height * wave(phase(a) + (lean * t) / k);
    }
  }
  // The hem lies where the cloth runs out. Every length of the pattern is as long as the designed hem line
  // needs on average, so cloth that travels further over a belly, a seat or the crest of a fold ends higher.
  const lengths = new Float32Array(rows * cols),
    reachRow = nominal / dh;
  for (let j = 0; j < cols; j++)
    for (let i = 1; i < rows; i++) {
      const dr =
        at(mean, ix(i, j)) + at(stand, ix(i, j)) - at(mean, ix(i - 1, j)) - at(stand, ix(i - 1, j));
      lengths[ix(i, j)] = at(lengths, ix(i - 1, j)) + Math.hypot(dh, dr);
    }
  const along = (j: number, f: number) => {
    const i = Math.min(rows - 2, Math.floor(f));
    return mix(at(lengths, ix(i, j)), at(lengths, ix(i + 1, j)), f - i);
  };
  let cutAt = 0;
  for (let j = 0; j < cols; j++) cutAt += along(j, Math.min(rows - 1, reachRow)) / cols;
  const hemRow = new Float32Array(cols);
  for (let j = 0; j < cols; j++) {
    let i = 1;
    while (i < rows - 1 && at(lengths, ix(i, j)) < cutAt) i++;
    const f =
      i -
      1 +
      clamp(
        (cutAt - at(lengths, ix(i - 1, j))) /
          Math.max(1e-6, at(lengths, ix(i, j)) - at(lengths, ix(i - 1, j))),
      );
    // No hem is cut or pressed dead level: it wanders a little round the skirt and dips between the folds.
    const a = (j / cols) * TAU,
      wander =
        lift *
        k *
        (0.4 * Math.sin(2 * a + s(8)) + 0.28 * Math.sin(3 * a + s(9)) - 0.22 * wave(phase(a)));
    hemRow[j] = clamp(
      f + wander / dh,
      reachRow - (lift * k) / dh,
      Math.min(rows - 1, reachRow + (lift * k) / dh),
    );
  }
  {
    const old = hemRow.slice();
    for (let j = 0; j < cols; j++)
      hemRow[j] = (at(old, (j + cols - 1) % cols) + 2 * at(old, j) + at(old, (j + 1) % cols)) / 4;
  }
  const sample = (field: Float32Array, h: number, a: number) => {
    const fr = clamp((h - env.h0) / dh, 0, rows - 1),
      i = Math.min(rows - 2, Math.floor(fr)),
      t = fr - i,
      fc = (turn(a) / TAU) * cols,
      j = Math.floor(fc) % cols,
      u = fc - Math.floor(fc);
    return mix(
      mix(at(field, ix(i, j)), at(field, ix(i, j + 1)), u),
      mix(at(field, ix(i + 1, j)), at(field, ix(i + 1, j + 1)), u),
      t,
    );
  };
  const ring = (field: Float32Array, a: number) => {
    const fc = (turn(a) / TAU) * cols,
      j = Math.floor(fc) % cols,
      u = fc - Math.floor(fc);
    return mix(at(field, j), at(field, (j + 1) % cols), u);
  };
  return {
    radius: (h, a) => sample(mean, h, a) + sample(stand, h, a),
    mean: (h, a) => sample(mean, h, a),
    free: (h, a) => sample(free, h, a),
    relief: (h, a) => sample(stand, h, a),
    hem: (a) => env.h0 + ring(hemRow, a) * dh,
    leave: (a) => env.h0 + ring(leaveRow, a) * dh,
  };
}

/** How many joints stand round each level of a hanging skirt. */
export const drapeColumns = 8;

/**
 * Joints for the hanging part of a skirt, in the space the figure was fitted
 * in: a ring at mid length and another at the hem, and the legs as rows of
 * balls. The cloth keeps its weights on the body; the rig hangs the cloth below
 * the hips on these joints. Null for a skirt too short to hang free of the
 * thighs.
 */
export function drapeJoints(
  body: DressBody,
  m: Landmarks,
  env: Envelope,
  field: DrapeField,
  o: {
    readonly top: number;
    readonly bottom: number;
    readonly name?: string;
    readonly least?: number;
  },
): ClothJoints | null {
  const { top, bottom, name = "Skirt", least = 0.2 } = o;
  const k = m.k,
    high = m.hip + 0.02 * k,
    low = m.hip - 0.17 * k;
  if (low - bottom < least * k) return null;
  const joints: Array<ClothJoints["joints"][number]> = [],
    flat = (p: Vec, c: Vec) => Math.hypot(p[0] - c[0], p[2] - c[2]);
  [mix(low, bottom, 0.42), bottom].forEach((y, level) => {
    for (let c = 0; c < drapeColumns; c++) {
      const a = ((c + 0.5) / drapeColumns) * TAU,
        h = top - y,
        point = env.point(h, a, field.mean(h, a)),
        centre = env.point(h, a, 0);
      // The cloth this joint carries hangs from the hips at the height where the body lets go of it.
      const from = env.point(top - low, a, field.mean(top - low, a)),
        r = flat(point, centre) || 1;
      joints.push({
        name: name + "_" + (level + 1) + "_" + (c + 1),
        level,
        column: c,
        at: point,
        from,
        dir: [(point[0] - centre[0]) / r, (point[2] - centre[2]) / r],
        free: field.free(h, a),
      });
    }
  });
  // The legs as rows of balls, each as thick as the limb is there.
  const legs: Array<ClothJoints["legs"][number]> = [];
  for (const side of ["l", "r"])
    for (const [from, to, limb] of [
      ["thigh", "calf", true],
      ["calf", "foot", true],
      ["foot", "ball", false],
    ] as const) {
      const a = body.joint(from + "_" + side),
        b = body.joint(to + "_" + side),
        axis = sub(b, a),
        span = dot(axis, axis) || 1,
        count = limb ? 6 : 2;
      const w = limb ? body.weight(new RegExp("^(thigh|calf)_" + side)) : null,
        far = Array.from({ length: count }, (): number[] => []);
      if (w)
        for (let v = 0; v < body.count; v++) {
          if (at(w, v) < 0.5) continue;
          const p = body.point(v),
            t = dot(sub(p, a), axis) / span,
            i = Math.floor(t * count);
          if (i >= 0 && i < count)
            far[i]?.push(
              length(sub(p, [a[0] + axis[0] * t, a[1] + axis[1] * t, a[2] + axis[2] * t])),
            );
        }
      const radii = far.map((list) => {
        list.sort((x, y) => x - y);
        return list.length > 8
          ? at(list, Math.floor(list.length * 0.9))
          : (limb ? 0.06 : 0.045) * k;
      });
      legs.push({ from: from + "_" + side, to: to + "_" + side, radii });
    }
  const origin = env.point(0, 0, 0);
  // Above `high` the cloth is the body's, below `low` the joints'.
  return {
    name,
    columns: drapeColumns,
    joints,
    legs,
    axis: [origin[0], origin[2]],
    pelvis: body.joint("pelvis"),
    floor: body.floor,
    scale: k,
    low,
    high,
  };
}

export interface SkirtOptions {
  readonly top: number;
  readonly bottom: number;
  readonly ease?: number;
  readonly flare?: number;
  readonly fold?: number;
  readonly folds?: number;
  readonly cols?: number;
  readonly shells?: ReadonlyArray<Shell>;
  /** How far up the top turns in under the garment it hangs from; 0 leaves the top standing free. */
  readonly yoke?: number;
  readonly gores?: boolean;
  /** Hang the skirt as this cloth, measured round the figure. */
  readonly drape?: { readonly cloth?: DrapeName } & Partial<Cloth>;
}

export interface Skirt {
  readonly piece: Piece;
  readonly env: Envelope;
  readonly skin: (p: Vec) => Skin;
  readonly field: DrapeField | null;
  readonly rig: ClothJoints | null;
  /** A point of the cloth at a share of its length and an angle, lifted off it. */
  pointAt(depth: number, angle: number, lift?: number): Vec;
}

/** A skirt, tunic tail or coat tail hanging round both legs from a height. */
export function skirt(body: DressBody, m: Landmarks, o: SkirtOptions): Skirt {
  const {
    top,
    bottom,
    ease = 0.012,
    flare = 0.12,
    fold = 0,
    folds = 14,
    cols = 72,
    shells = [],
    yoke = 0,
    gores = false,
    drape = null,
  } = o;
  const k = m.k,
    arm = body.weight(ARMS),
    points: Vec[] = [];
  // A draped skirt is measured a little past its hem line, which the cloth may dip below.
  const cloth: Cloth | null = drape ? { ...drapes[drape.cloth ?? "gored"], ...drape } : null,
    past = cloth ? (cloth.lift + 0.012) * k : 0;
  const below = bottom - (cloth ? 0.008 : 0.03) * k;
  for (let v = 0; v < body.count; v++) {
    const y = at(body.P, v * 3 + 1);
    if (at(arm, v) < 0.3 && y < top + 0.04 * k && y > below) points.push(body.point(v));
  }
  for (const s of shells)
    for (let i = 0; i < s.pos.length; i += 3) {
      const y = at(s.pos, i + 1);
      if (y < top + 0.04 * k && y > below && s.value("wArm", i / 3) < 0.3)
        points.push([at(s.pos, i), y, at(s.pos, i + 2)]);
    }
  const depth = top - bottom,
    rows = Math.max(4, Math.round(depth / (0.022 * k)));
  let env: Envelope,
    field: DrapeField | null = null;
  if (cloth) {
    // The rings keep one centre line, so cloth that hangs straight down keeps its distance from it.
    env = new Envelope(
      [0, top, m.pelvis[2]],
      [0, -1, 0],
      0,
      depth + past,
      Math.round((depth + past) / (0.016 * k)) + 1,
      cols,
    );
    env.fixed = true;
    env.measure(points).taut(1);
    field = drapeField(env, {
      ...cloth,
      k,
      nominal: depth,
      seat: top - m.crotch + 0.05 * k,
      seed: Math.round(m.waist * 1013 + m.shoulderWidth * 7919 + depth * 331 + cols),
    });
  } else
    env = new Envelope([0, top, m.pelvis[2]], [0, -1, 0], 0, depth, rows + 1, cols)
      .measure(points)
      .taut(1)
      .hang(-flare, 1)
      .soften(2);
  const pelvis = body.bone("pelvis"),
    sides = (["l", "r"] as const).map((s) => ({
      hip: body.joint("thigh_" + s),
      knee: body.joint("calf_" + s),
      thigh: body.bone("thigh_" + s),
      calf: body.bone("calf_" + s),
    }));
  const [left, right] = sides;
  if (!left || !right) throw new Error("A skirt needs both legs.");
  // The skin a point of the skirt hangs in front of, found by walking from the cloth towards the leg behind it.
  const behind = (p: Vec) => {
    const { hip, knee } = p[0] >= 0 === left.hip[0] >= 0 ? left : right,
      t = (hip[1] - p[1]) / (hip[1] - knee[1]),
      up = smooth(0, 0.14 * k, p[1] - hip[1]);
    const core: Vec =
      t > 0
        ? [mix(hip[0], knee[0], t), p[1], mix(hip[2], knee[2], t)]
        : [hip[0] * (1 - up), p[1], mix(hip[2], m.pelvis[2], up)];
    const way = sub(core, p),
      steps = Math.max(1, Math.ceil(length(way) / (0.012 * k)));
    for (let n = 0; n <= steps; n++) {
      const q = add(p, way, n / steps),
        v = body.nearest(q, 1);
      // A hand hanging beside the skirt is skin too, but the skirt does not follow it.
      if (v >= 0 && at(arm, v) < 0.05 && length(sub(q, body.point(v))) < 0.02 * k) return v;
    }
    return body.nearest(core, 3);
  };
  // Cloth moves with the leg behind it, so a lifted thigh carries the skirt instead of passing through it. Across
  // the middle the two legs share the cloth, and below the knee it mostly stays with the thigh.
  const skin = (p: Vec): Skin => {
    const shin = smooth(m.knee + 0.02 * k, m.knee - 0.12 * k, p[1]) * 0.7,
      own = smooth(0, 0.04 * k, Math.abs(p[0])) * 0.5 + 0.5,
      out: Array<readonly [number, number]> = [];
    for (const [q, share] of [
      [p, own],
      [[-p[0], p[1], p[2]], 1 - own],
    ] as const) {
      if (share <= 0) continue;
      const v = behind(q);
      if (v < 0) {
        out.push([pelvis, share]);
        continue;
      }
      const [bones, weights] = body.skinOf(v);
      bones.forEach((bone, n) => {
        const leg = sides.find((side) => side.calf === bone);
        if (leg)
          out.push(
            [bone, at(weights, n) * share * shin],
            [leg.thigh, at(weights, n) * share * (1 - shin)],
          );
        else out.push([bone, at(weights, n) * share]);
      });
    }
    return mergeSkin(out);
  };
  // A long draped skirt describes joints its lower cloth can hang from. Its own weights stay on the body.
  const rig = field ? drapeJoints(body, m, env, field, { top, bottom }) : null;
  const place = (row: number, j: number, inset: number): Vec => {
    if (field) {
      // Rows divide the cloth from the seam to wherever its hem falls in this direction.
      const a = (j / cols) * TAU,
        deep = row / rows,
        h = deep * field.hem(a);
      return env.point(
        h,
        a,
        field.radius(h, a) + ease * k * mix(0.3, 1, smooth(0, 0.1, deep)) - inset,
      );
    }
    const h = (depth * row) / rows,
      a = (j / cols) * TAU,
      deep = row / rows;
    const phase = a * folds + 1.3 * Math.sin(a * 3);
    const hem = smooth(0.35, 1, deep);
    // Gores stay over the hips before opening in soft flutes below the knee.
    // The back carries a little more fullness than the front facing.
    const swing = phase + hem * (1.15 * Math.sin(2 * a + 0.4) + 0.6 * Math.cos(3 * a));
    const flute = Math.sin(swing) + 0.24 * Math.cos(2 * swing + 0.6);
    const wave = fold * k * (gores ? (0.25 * deep + 1.18 * hem) * flute : deep * Math.sin(phase));
    const extra = gores
      ? k * hem * (0.062 + 0.017 * Math.cos(phase * 0.5) + 0.046 * (1 - Math.cos(a)))
      : 0;
    const p = env.point(
      h,
      a,
      env.sample(h, a) + ease * k * mix(0.35, 1, smooth(0, 0.12, deep)) + wave + extra - inset,
    );
    return gores
      ? [p[0], p[1] + k * deep ** 4 * (0.014 * Math.cos(a) + 0.007 * Math.cos(phase)), p[2]]
      : p;
  };
  const piece = new Piece(),
    rings: Vec[][] = [];
  if (yoke > 0) {
    // A full skirt stands off the garment above it. Its top slopes in and ends just under that cloth, found by
    // rays, so there is no gap to look down into.
    const casts = shells.map((s) => raycaster(s.pos, s.tri)),
      up = yoke * k,
      off = 0.35 * ease * k;
    const inner = Array.from({ length: cols }, (_, j): Vec => {
      const a = (j / cols) * TAU,
        r = (field ? field.radius(0, a) : env.sample(0, a)) + off,
        from = env.point(-up, a, r),
        way = unit(sub(env.point(-up, a, 0), from));
      const hit = casts.reduce((best, cast) => Math.min(best, cast(from, way)), Infinity);
      return add(from, way, hit < 0.5 * r ? hit + 0.004 * k : off + 0.006 * k);
    });
    rings.push(
      inner,
      inner.map((q, j): Vec => {
        const p = place(0, j, 0);
        return [mix(q[0], p[0], 0.65), mix(q[1], p[1], 0.4), mix(q[2], p[2], 0.65)];
      }),
    );
  }
  for (let row = 0; row <= rows; row++)
    rings.push(Array.from({ length: cols }, (_, j) => place(row, j, 0)));
  // The cloth turns under at the hem and runs back up as a lining, so the inside is cloth from any angle.
  for (let row = rows; row >= 0; row--)
    rings.push(Array.from({ length: cols }, (_, j) => place(row, j, 0.005 * k)));
  piece.loft(rings, skin, { flip: true });
  if (rig) piece.clothJoints = rig;
  // How far the folds stand out of the hanging surface, for shading them where a reduced model cannot carry
  // them. The shading is painted on charts seen from the front and from behind, which have no room for the
  // flanks.
  if (field) {
    const relief = (deep: number, angle: number) =>
      field.relief(deep * field.hem(angle), angle) * smooth(0.3, 0.62, Math.abs(Math.cos(angle)));
    const heights = new Float32Array(piece.count),
      lead = rings.length - 2 * (rows + 1);
    for (let n = 0; n < 2 * (rows + 1); n++) {
      const row = n <= rows ? n : 2 * rows + 1 - n;
      for (let j = 0; j < cols; j++)
        heights[(lead + n) * cols + j] = relief(row / rows, (j / cols) * TAU);
    }
    piece.foldBands = [[0, heights]];
    piece.draped = true;
  }
  return {
    piece,
    env,
    skin,
    field,
    rig,
    pointAt: (depthShare, angle, lift = 0) => place(depthShare * rows, (angle / TAU) * cols, -lift),
  };
}
