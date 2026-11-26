// Garments for the human surface (character-view/human-style-cloth.js at
// 2761eb1). Each one is cut from the body it dresses, so it fits every build,
// keeps the body's skin weights and follows the same anatomical lines (mid
// upper arm, natural waist, ankle) on everyone.
//
// Skirts, rolls, hoods worn as cloth, straps and plates come with the outfits
// that use them; this module holds what tops, trousers, belts, gloves, shoes
// and boots are made from.

import type { Ray } from "../../game/raycast.js";
import { crease, type CreaseOptions } from "./folds.js";
import {
  Envelope,
  Piece,
  add,
  at,
  bodyShell,
  clamp,
  connected,
  cross,
  cut,
  dot,
  hull2,
  length,
  lift,
  loops,
  mix,
  raycaster,
  reach2,
  relax,
  smooth,
  sub,
  unit,
  type DressBody,
  type Landmarks,
  type Shell,
  type Skin,
  type Vec,
} from "./kit.js";

const ARMS = /^(upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)/;
const TAU = Math.PI * 2;
type Flat = readonly [number, number];

export type { Landmarks };

export function landmarks(body: DressBody): Landmarks {
  const j = (name: string) => body.joint(name),
    k = body.scale;
  const pelvis = j("pelvis"),
    knee = j("calf_l")[1],
    hip = j("thigh_l")[1],
    belly = j("spine_01")[1],
    waist = j("spine_02")[1];
  let crotch = Infinity;
  for (let v = 0; v < body.count; v++) {
    const [x, y] = body.point(v);
    if (Math.abs(x) < 0.012 * k && y < pelvis[1] && y > knee) crotch = Math.min(crotch, y);
  }
  return {
    k,
    neck: j("neck_01"),
    head: j("head"),
    pelvis,
    chest: j("spine_03"),
    waist,
    belly,
    shoulder: j("upperarm_l")[1],
    shoulderWidth: j("upperarm_l")[0],
    hip,
    knee,
    ankle: j("foot_l")[1],
    crotch: Number.isFinite(crotch) ? crotch : hip - 0.08 * k,
    waistband: mix(belly, waist, 0.55),
  };
}

/** A shell's open edges: sleeve ends, leg ends, and its highest and lowest other loops. */
export interface Edges {
  readonly sleeves: number[][];
  readonly legs: number[][];
  readonly upper: number[] | null;
  readonly lower: number[] | null;
  readonly all: number[][];
}

export function classify(s: Shell): Edges {
  const all = loops(s),
    sleeves: number[][] = [],
    legs: number[][] = [];
  let upper: number[] | null = null,
    lower: number[] | null = null;
  const mean = (loop: ReadonlyArray<number>, f: (i: number) => number) =>
    loop.reduce((t, i) => t + f(i), 0) / loop.length;
  let top = -Infinity,
    low = Infinity;
  for (const loop of all) {
    if (mean(loop, (i) => s.value("arm", i)) > 0.1) {
      sleeves.push(loop);
      continue;
    }
    if (mean(loop, (i) => s.value("leg", i)) > 0.1) {
      legs.push(loop);
      continue;
    }
    const y = mean(loop, (i) => at(s.anc, i * 3 + 1));
    if (y > top) {
      top = y;
      upper = loop;
    }
    if (y < low) {
      low = y;
      lower = loop;
    }
  }
  if (upper === lower) lower = null;
  return { sleeves, legs, upper, lower, all };
}

/** A raised band along an open edge: cuffs, hems, neckbands and waistbands. It is a second layer of the cloth itself. */
export function band(
  piece: Piece,
  s: Shell,
  loop: ReadonlyArray<number> | null | undefined,
  { width = 0.02, rise = 0.003 }: { readonly width?: number; readonly rise?: number } = {},
): void {
  if (!loop) return;
  // A turned hem or a ribbed cuff is two or three layers of cloth: it stands far enough off the cloth beside it
  // to keep its own edge and shadow when the model is seen whole or reduced for a game.
  rise = Math.max(rise * 1.4, 0.0042);
  const n = s.count,
    near = Array.from({ length: n }, (): number[] => []),
    far = new Float32Array(n).fill(Infinity),
    queue = [...loop];
  for (let t = 0; t < s.tri.length; t += 3)
    for (let a = 0; a < 3; a++)
      near[at(s.tri, t + a)]?.push(at(s.tri, t + ((a + 1) % 3)), at(s.tri, t + ((a + 2) % 3)));
  for (const i of loop) far[i] = 0;
  // Distance over the cloth from the edge.
  for (let head = 0; head < queue.length; head++) {
    const i = at(queue, head);
    if (at(far, i) > width * 1.6) continue;
    for (const j of near[i] ?? []) {
      const d = at(far, i) + length(sub(s.at(i), s.at(j)));
      if (d < at(far, j) - 1e-6) {
        far[j] = d;
        queue.push(j);
      }
    }
  }
  s.f["far"] = Array.from(far, (d) => Math.min(d, 9));
  const strip = cut(s, (i) => width - s.value("far", i));
  delete s.f["far"];
  for (let i = 0; i < strip.count; i++) {
    const f = strip.value("far", i);
    strip.set(
      i,
      add(
        strip.at(i),
        strip.normal(i),
        rise * (0.25 + 0.75 * smooth(width, width * 0.72, f)) - (f > width * 0.98 ? rise * 0.5 : 0),
      ),
    );
  }
  piece.shell(strip, { thickness: rise * 0.8 });
}

/**
 * How far the neck of this body stands from its own axis in each direction, measured just above its base.
 * A neck opening cut by height alone lands far out on the shoulders of a body whose shoulders slope up to a
 * thick neck; measured from the neck itself it is a ring round the neck on every body.
 */
function neckColumn(body: DressBody, m: Landmarks): (x: number, z: number) => number {
  const k = m.k,
    z0 = m.neck[2],
    y0 = m.neck[1] + 0.02 * k,
    y1 = m.neck[1] + 0.06 * k,
    bins = 24,
    far = new Float32Array(bins),
    arm = body.weight(ARMS);
  for (let v = 0; v < body.count; v++) {
    const y = at(body.P, v * 3 + 1);
    if (y < y0 || y > y1 || at(arm, v) > 0.2) continue;
    const x = at(body.P, v * 3),
      z = at(body.P, v * 3 + 2) - z0,
      d = Math.hypot(x, z);
    if (d > 0.12 * k) continue;
    const b = Math.floor((Math.atan2(x, z) / TAU + 0.5) * bins) % bins;
    far[b] = Math.max(at(far, b), d);
  }
  const mean = far.reduce((a, b) => a + b, 0) / bins || 0.055 * k;
  for (let b = 0; b < bins; b++) if (!far[b]) far[b] = mean;
  const even = Float32Array.from(
    far,
    (_, b) => (at(far, (b + bins - 1) % bins) + 2 * at(far, b) + at(far, (b + 1) % bins)) / 4,
  );
  return (x, z) => {
    const a = (Math.atan2(x, z - z0) / TAU + 0.5) * bins,
      b = Math.floor(a) % bins,
      t = a - Math.floor(a);
    return mix(at(even, (b + bins) % bins), at(even, (b + 1 + bins) % bins), t);
  };
}

export interface NeckOptions {
  readonly height?: number;
  readonly tilt?: number;
  readonly bow?: number;
  readonly v?: number;
  readonly wide?: number;
  readonly scoop?: number;
  readonly scoopWidth?: number;
  readonly ring?: number;
}

function neckline(
  s: Shell,
  m: Landmarks,
  {
    height = 0,
    tilt = 0.15,
    bow = 8,
    v = 0,
    wide = 0,
    scoop = 0,
    scoopWidth = 0.075,
    ring = 0.018,
  }: NeckOptions,
  column: ((x: number, z: number) => number) | null = null,
): (i: number) => number {
  const k = m.k,
    base = m.neck[1] + (0.035 + height) * k,
    z0 = m.neck[2];
  return (i) => {
    const x = at(s.anc, i * 3),
      y = at(s.anc, i * 3 + 1),
      z = z0 + clamp(at(s.anc, i * 3 + 2) - z0, -0.08 * k, 0.075 * k);
    // The cut is highest beside the neck, lower at the nape and lowest at the throat; `wide` opens it into a boat neck.
    let f = base - tilt * (z - z0) - (bow * (z - z0) ** 2) / k - wide * Math.abs(x) - y;
    // Cloth that lies on the slope of the shoulder stays, however high the slope climbs: the opening is a ring round the neck.
    if (column && !wide)
      f = Math.max(
        f,
        Math.min(
          Math.hypot(x, at(s.anc, i * 3 + 2) - z0) - column(x, at(s.anc, i * 3 + 2)) - ring * k,
          base + 0.022 * k - y,
        ),
      );
    if (v && z > z0) f = Math.min(f, base - v * k + Math.abs(x) * 1.9 - y);
    if (scoop && z > z0 && Math.abs(x) < scoopWidth * k)
      f = Math.min(f, base - scoop * k * (1 - (x / (scoopWidth * k)) ** 2) - y);
    return f;
  };
}

/** Moves cloth out to at least `room` beyond another shell on the same side of the body, measured along the skin's normal. */
function outside(s: Shell, shell: Shell, room: number, sided = true): void {
  let low = Infinity,
    high = -Infinity,
    x = 0;
  for (let i = 0; i < shell.pos.length; i += 3) {
    low = Math.min(low, at(shell.pos, i + 1));
    high = Math.max(high, at(shell.pos, i + 1));
    x += at(shell.pos, i);
  }
  const start = 0.03,
    cast = raycaster(shell.pos, shell.tri);
  for (let i = 0; i < s.count; i++) {
    const y = at(s.pos, i * 3 + 1);
    if (y < low - 0.03 || y > high + 0.03 || (sided && at(s.anc, i * 3) * x < 0)) continue;
    const a = s.anchor(i),
      n = s.normal(i),
      hit = cast(add(a, n, -start), n) - start,
      d = dot(sub(s.at(i), a), n);
    // A hit far from the skin is some other part of the shell, across a gap.
    if (hit < 0.06 && d < hit + room) s.set(i, add(s.at(i), n, hit + room - d));
  }
}

/**
 * Cuts a garment from the body and lets it hang.
 *   sleeve  where sleeves end along the arm (0 shoulder, 1 elbow, 2 wrist)
 *   hem     world height of a top's lower edge, or null when it has legs
 *   leg     where legs end (0 hip, 1 knee, 2 ankle)
 *   waist   upper edge height for trousers and skirts' underlayers
 *   ease    cloth distance from the skin; `extra(y)` adds room over other layers
 *   fall    how quickly hanging cloth returns to the body below a prominence
 *   taper   the same along the legs: low values give straight wide legs
 *   folds   how strongly the cloth creases (0 smooth, 1 everyday cloth), or {amount, size, detail}
 *   over    shells this cloth is worn over, such as boot shafts under trouser legs: it stays outside them
 *   below   how far under its hem a top looks for a belly or a seat it has to stand out for, with `rise` the
 *           slope at which it comes back in above one
 */
export interface GarmentOptions {
  readonly sleeve?: number;
  readonly hem?: number | null;
  readonly leg?: number;
  readonly waist?: number | null;
  readonly ease?: number;
  readonly gap?: number;
  readonly fall?: number;
  readonly rise?: number;
  readonly tension?: number;
  readonly span?: number;
  readonly passes?: number;
  readonly sleeveEase?: number;
  readonly sleeveFall?: number | null;
  readonly legEase?: number;
  readonly taper?: number;
  readonly flare?: number;
  readonly extra?: ((y: number, i: number, s: Shell) => number) | null;
  readonly under?: ReadonlyArray<Shell>;
  readonly soft?: number;
  readonly chestSoft?: number;
  readonly keep?: number;
  readonly folds?: number | CreaseOptions;
  readonly over?: ReadonlyArray<Shell>;
  readonly below?: number;
  readonly neck?: NeckOptions;
}

export interface Garment extends Edges {
  readonly s: Shell;
  readonly env: Envelope;
  readonly room: (i: number) => number;
}

export function garment(body: DressBody, m: Landmarks, o: GarmentOptions = {}): Garment {
  const k = m.k,
    {
      sleeve = 0.55,
      hem = null,
      leg = 2.03,
      waist = null,
      ease = 0.006,
      gap = 0.004,
      fall = 0.5,
      rise = 1.2,
      tension = 1,
      span = 2,
      passes = 6,
      sleeveEase = 0,
      sleeveFall = null,
      legEase = 0,
      taper = 0.06,
      flare = 4,
      extra = null,
      under = [],
      soft = 6,
      chestSoft = 34,
      keep = 0.85,
      folds = 1,
      over = [],
      below = 0,
    } = o;
  let s = bodyShell(body);
  const y = (i: number) => at(s.anc, i * 3 + 1);
  if (waist === null) {
    s = cut(s, (i) => sleeve - s.value("arm", i));
    s = cut(s, neckline(s, m, o.neck ?? {}, neckColumn(body, m)));
  } else {
    s = cut(s, (i) => waist - y(i));
    s = cut(s, (i) => 0.5 - s.value("wArm", i));
  }
  const low = hem === null ? null : Math.max(hem, m.crotch + 0.012 * k);
  s =
    low === null
      ? cut(s, (i) => leg - s.value("leg", i))
      : cut(s, (i) => y(i) - low + 10 * s.value("wArm", i));
  s = connected(s, waist === null ? m.chest : m.pelvis);
  const room = (i: number) =>
    (ease +
      sleeveEase * smooth(0.3, 0.8, s.value("wArm", i)) +
      legEase * smooth(0.3, 0.8, s.value("wLeg", i)) * smooth(0.1, 0.4, s.value("leg", i)) +
      (extra ? extra(y(i), i, s) : 0)) *
    k;
  // Cloth lies on a softened figure, so small anatomy does not print through, but never inside the real one.
  const chest = (py: number, pz: number, armed: number) =>
    waist !== null
      ? 0
      : (1 - smooth(0.1, 0.4, armed)) *
        smooth(m.waist, m.chest[1], py) *
        smooth(m.neck[1] - 0.02 * k, m.neck[1] - 0.08 * k, py) *
        smooth(-0.02 * k, 0.03 * k, pz - m.chest[2]);
  const front = (i: number) => chest(y(i), at(s.anc, i * 3 + 2), s.value("wArm", i));
  if (soft) relax(s, { passes: soft, gap: -1, edge: 0, alongNormal: true });
  if (soft && waist === null)
    relax(s, { passes: chestSoft, gap: -1, edge: 0, hold: front, alongNormal: true });
  const figure = s.pos.slice();
  for (let i = 0; i < s.count; i++) {
    const n = s.normal(i),
      p = add(s.at(i), n, room(i)),
      d = dot(sub(p, s.anchor(i)), n),
      least = Math.min(gap, ease) * k * (1 - 0.6 * front(i));
    s.set(i, d < least ? add(p, n, least - d) : p);
  }
  // Left and right halves may meet on the centre plane but never cross it, however close to it they start.
  const apart = (i: number) => {
    if (
      s.value("wArm", i) < 0.3 &&
      Math.abs(at(s.anc, i * 3)) > 0.0002 &&
      at(s.pos, i * 3) * at(s.anc, i * 3) < 0
    )
      s.pos[i * 3] = 0;
  };
  for (let i = 0; i < s.count; i++) apart(i);
  const arm = body.weight(ARMS),
    head = body.weight(/^head/),
    topY = waist === null ? m.neck[1] + 0.04 * k : waist + 0.02 * k,
    bottom = (low ?? m.crotch - 0.01 * k) - (low === null ? 0 : below * k),
    torso: Vec[] = [];
  for (let v = 0; v < body.count; v++) {
    const py = at(body.P, v * 3 + 1);
    if (
      at(arm, v) < 0.35 &&
      at(head, v) < 0.5 &&
      py > bottom - 0.04 * k &&
      py < topY + 0.03 * k &&
      chest(py, at(body.P, v * 3 + 2), at(arm, v)) < 0.5
    )
      torso.push(body.point(v));
  }
  // Over the chest the cloth hangs from the softened figure, so it spans the breastbone and shows no points.
  if (waist === null)
    for (let i = 0; i < s.count; i++)
      if (s.value("wArm", i) < 0.35 && front(i) > 0.2)
        torso.push([at(figure, i * 3), at(figure, i * 3 + 1), at(figure, i * 3 + 2)]);
  // Layers already worn count as part of the figure this garment hangs over.
  for (const layer of under)
    for (let i = 0; i < layer.pos.length; i += 3) {
      const py = at(layer.pos, i + 1);
      if (py > bottom - 0.04 * k && py < topY + 0.03 * k && layer.value("wArm", i / 3) < 0.35)
        torso.push([at(layer.pos, i), py, at(layer.pos, i + 2)]);
    }
  const depth = topY - bottom + 0.02 * k;
  // The rings keep one centre line: a centre that followed the figure would hide how far the cloth falls back under a bulge.
  const env = new Envelope(
    [0, topY, m.chest[2]],
    [0, -1, 0],
    0,
    depth,
    Math.round(depth / (0.016 * k)),
    48,
  );
  env.fixed = true;
  env
    .measure(torso)
    .taut(waist === null ? tension : 1, waist === null ? span : Math.max(span, 1.7))
    .hang(fall, rise)
    .soften(waist === null ? 6 : 2);
  env.drape(
    s,
    (i) =>
      (1 - smooth(0.2, 0.6, s.value("wArm", i))) *
      (low === null ? smooth(m.crotch + 0.01 * k, m.crotch + 0.05 * k, y(i)) : 1),
    room,
  );
  if (sleeveFall !== null && waist === null)
    for (const side of ["l", "r"]) {
      const root = body.joint("upperarm_" + side),
        end = body.joint("hand_" + side),
        points: Vec[] = [],
        w = body.weight(new RegExp("^(upperarm|lowerarm)_" + side));
      for (let v = 0; v < body.count; v++) if (at(w, v) > 0.5) points.push(body.point(v));
      const reach = length(sub(end, root)),
        sign = side === "l" ? 1 : -1;
      new Envelope(root, sub(end, root), 0, reach, Math.round(reach / (0.02 * k)), 24)
        .measure(points)
        .taut(1)
        .hang(sleeveFall, 1.5)
        .soften(1)
        .drape(
          s,
          (i) =>
            at(s.anc, i * 3) * sign > 0
              ? smooth(0.4, 0.9, s.value("wArm", i)) * smooth(0.1, 0.4, s.value("arm", i))
              : 0,
          room,
        );
    }
  if (low === null)
    for (const side of ["l", "r"]) {
      const root = body.joint("thigh_" + side),
        end = body.joint("foot_" + side),
        w = body.weight(new RegExp("^(thigh|calf)_" + side)),
        points: Vec[] = [];
      for (let v = 0; v < body.count; v++) if (at(w, v) > 0.5) points.push(body.point(v));
      const reach = length(sub(end, root)),
        sign = side === "l" ? 1 : -1;
      new Envelope(root, sub(end, root), 0, reach, Math.round(reach / (0.02 * k)), 32)
        .measure(points)
        .taut(1)
        .hang(taper, flare)
        .soften(1)
        .drape(
          s,
          (i) =>
            at(s.anc, i * 3) * sign > 0
              ? smooth(0.3, 0.8, s.value("wLeg", i)) * smooth(0.18, 0.45, s.value("leg", i))
              : 0,
          room,
        );
    }
  // Relaxing may span hollows but must not shrink the garment back onto the skin.
  const rest = Array.from({ length: s.count }, (_, i) =>
    dot(sub(s.at(i), s.anchor(i)), s.normal(i)),
  );
  for (let i = 0; i < s.count; i++) apart(i);
  // Skin in the cleft of the seat and under it faces sideways or down, not outward. A hem hanging over it bridges the
  // cleft, so cloth cut from there follows its neighbours. A gap kept along that skin would fold the cloth into the
  // centre plane or hang it as a tongue below the seat.
  const bridged = (i: number) => {
    if (low === null || s.value("wArm", i) > 0.3 || y(i) > m.pelvis[1] + 0.03 * k) return false;
    const x = at(s.anc, i * 3),
      z = at(s.anc, i * 3 + 2) - m.chest[2],
      far = Math.hypot(x, z) || 1;
    return (at(s.nrm, i * 3) * x + at(s.nrm, i * 3 + 2) * z) / far < 0.75;
  };
  relax(s, {
    passes,
    gap: (i) => (bridged(i) ? -1 : Math.max(gap * k * (1 - 0.6 * front(i)), at(rest, i) * keep)),
    apart: true,
  });
  relax(s, {
    passes: 3,
    strength: 0.4,
    gap: (i) =>
      bridged(i) ? -1 : Math.max(gap * k * (1 - 0.6 * front(i)), at(rest, i) * keep * 0.9),
    apart: true,
  });
  const creases: CreaseOptions = typeof folds === "number" ? { amount: folds } : folds;
  if ((creases.amount ?? 1) > 0) {
    s.f["calm"] = Array.from({ length: s.count }, (_, i) => front(i));
    s = crease(s, body, m, {
      upper: waist === null,
      lower: low === null,
      waistband: waist ?? m.waistband,
      ease: ease + (low === null && waist !== null ? legEase : 0),
      legEnd: leg,
      sleeveEnd: sleeve,
      low,
      gap,
      seed: Math.round(ease * 9000 + sleeve * 40 + leg * 17 + (hem ?? 0) * 60) % 89,
      ...creases,
    });
    for (let i = 0; i < s.count; i++) apart(i);
  }
  if (waist === null) {
    // Fabric hangs from its neckline. Continuing the chest envelope up to
    // that cut leaves a stiff standing rim even on a scoop-neck dress.
    const belowOpening = neckline(s, m, o.neck ?? {});
    for (let i = 0; i < s.count; i++) {
      const a = s.anchor(i);
      const influence =
        (1 - smooth(0.002 * k, 0.075 * k, belowOpening(i))) *
        (1 - smooth(0.1 * k, 0.16 * k, Math.abs(a[0]))) *
        (1 - smooth(0.08, 0.35, s.value("wArm", i)));
      if (!influence) continue;
      const seam = add(a, s.normal(i), clamp(room(i) * 0.65, 0.002 * k, 0.012 * k));
      const p = s.at(i);
      s.set(i, [
        mix(p[0], seam[0], influence),
        mix(p[1], seam[1], influence),
        mix(p[2], seam[2], influence),
      ]);
    }
  }
  for (const shell of over) outside(s, shell, 0.005 * k);
  // Trouser legs join in a seam a little below the body, which closes the small opening under the seat.
  if (low === null)
    for (let i = 0; i < s.count; i++) {
      const x = at(s.pos, i * 3),
        depth = (m.crotch + 0.06 * k - at(s.pos, i * 3 + 1)) / (0.12 * k);
      const inward = -at(s.nrm, i * 3) * Math.sign(at(s.anc, i * 3));
      if (depth < 0 || depth > 1 || inward < 0 || (s.value("wLeg", i) < 0.2 && inward < 0.3))
        continue;
      const near = 0.024 * k * (1 - smooth(0.5, 1, depth));
      s.pos[i * 3] = x * smooth(near * 0.6, near * 1.5, Math.abs(x));
    }
  return { s, env, room, ...classify(s) };
}

/** Rays against one or more finished shells, for placing pockets, plackets and straps on cloth. */
export function caster(shells: ReadonlyArray<Shell>, torsoOnly = false): Ray {
  const list = shells
    .map((s) => {
      if (!torsoOnly || !s.f["wArm"]) return { pos: s.pos, tri: s.tri };
      const tri: number[] = [];
      for (let t = 0; t < s.tri.length; t += 3)
        if (
          s.value("wArm", at(s.tri, t)) < 0.4 &&
          s.value("wArm", at(s.tri, t + 1)) < 0.4 &&
          s.value("wArm", at(s.tri, t + 2)) < 0.4
        )
          tri.push(at(s.tri, t), at(s.tri, t + 1), at(s.tri, t + 2));
      return { pos: s.pos, tri };
    })
    .map((s) => raycaster(s.pos, s.tri));
  return (origin, direction) =>
    list.reduce((best, cast) => Math.min(best, cast(origin, direction)), Infinity);
}

export interface PatchOptions {
  readonly centre: Vec;
  readonly facing: Vec;
  readonly across: Vec;
  readonly up?: Vec;
  readonly width: number;
  readonly height: number;
  readonly rise?: number;
  readonly nx?: number;
  readonly ny?: number;
  readonly skin?: (p: Vec) => Skin;
}

/** A raised panel projected onto cloth: pockets, plackets, flaps and patches. */
export function patch(
  piece: Piece,
  cast: Ray,
  body: DressBody,
  {
    centre,
    facing,
    across,
    up = [0, 1, 0],
    width,
    height,
    rise = 0.003,
    nx = 5,
    ny = 5,
    skin,
  }: PatchOptions,
): boolean {
  const f = unit(facing),
    a = unit(across),
    u = unit(up),
    rows: Vec[][] = [];
  let nearest = Infinity,
    furthest = 0;
  for (let j = -1; j <= ny + 1; j++) {
    const row: Vec[] = [];
    for (let i = -1; i <= nx + 1; i++) {
      const border = i < 0 || i > nx || j < 0 || j > ny;
      const x = (clamp(i, 0, nx) / nx - 0.5) * width + (i < 0 ? -0.0015 : i > nx ? 0.0015 : 0),
        y = (clamp(j, 0, ny) / ny - 0.5) * height + (j < 0 ? -0.0015 : j > ny ? 0.0015 : 0);
      const origin = add(add(add(centre, a, x), u, y), f, 0.3),
        d = cast(origin, [-f[0], -f[1], -f[2]]);
      if (!Number.isFinite(d)) return false;
      nearest = Math.min(nearest, d);
      furthest = Math.max(furthest, d);
      row.push(add(origin, f, -d + (border ? -0.0015 : rise)));
    }
    rows.push(row);
  }
  // A ray that slipped past the edge of a limb lands on whatever lies behind it; such a panel is left out.
  if (furthest - nearest > 0.6 * Math.max(width, height)) return false;
  piece.loft(rows, skin ?? ((p) => body.skinAt(p)), {
    closed: false,
    flip: dot(cross(u, a), f) < 0,
  });
  return true;
}

/** A small disc lying on cloth. */
export function button(
  piece: Piece,
  cast: Ray,
  body: DressBody,
  {
    centre,
    facing,
    radius = 0.006,
    rise = 0.0035,
  }: {
    readonly centre: Vec;
    readonly facing: Vec;
    readonly radius?: number;
    readonly rise?: number;
  },
): void {
  const f = unit(facing),
    origin = add(centre, f, 0.3),
    d = cast(origin, [-f[0], -f[1], -f[2]]);
  if (!Number.isFinite(d)) return;
  const p = add(origin, f, -d),
    a = unit(cross(f, [0, 1, 0])),
    u = cross(a, f),
    skin = body.skinAt(p);
  const ring = (r: number, h: number) =>
    Array.from({ length: 10 }, (_, i) =>
      add(add(add(p, a, Math.cos((i / 10) * TAU) * r), u, Math.sin((i / 10) * TAU) * r), f, h),
    );
  piece.loft([ring(radius, -0.001), ring(radius, rise * 0.8), ring(radius * 0.7, rise)], skin, {
    capEnd: true,
  });
}

/** A box, for buckles and clasps. `half` holds three half-extent vectors. */
export function box(piece: Piece, centre: Vec, half: readonly [Vec, Vec, Vec], skin: Skin): void {
  const corner = (a: number, b: number, c: number) =>
    add(add(add(centre, half[0], a), half[1], b), half[2], c);
  const flip = dot(cross(half[0], half[1]), half[2]) < 0;
  for (const [axis, sign] of [
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [2, 1],
    [2, -1],
  ] as const) {
    const p = (u: number, v: number) =>
      axis === 0 ? corner(sign, u, v) : axis === 1 ? corner(v, sign, u) : corner(u, v, sign);
    const q = [p(-1, -1), p(1, -1), p(1, 1), p(-1, 1)].map((x) => piece.vertex(x, skin));
    const [q0 = 0, q1 = 0, q2 = 0, q3 = 0] = q;
    if (sign > 0 !== flip) piece.tri.push(q0, q1, q2, q0, q2, q3);
    else piece.tri.push(q0, q2, q1, q0, q3, q2);
  }
}

/** The outline of whatever is worn at a height, measured around the torso. */
export function girth(
  _body: DressBody,
  m: Landmarks,
  shells: ReadonlyArray<Shell>,
  y: number,
  reach = 0.05,
): Envelope {
  const k = m.k,
    points: Vec[] = [];
  for (const s of shells)
    for (let i = 0; i < s.pos.length; i += 3)
      if (Math.abs(at(s.pos, i + 1) - y) < reach * k * 1.3 && s.value("wArm", i / 3) < 0.3)
        points.push([at(s.pos, i), at(s.pos, i + 1), at(s.pos, i + 2)]);
  const env = new Envelope(
    [0, y + reach * k, m.pelvis[2]],
    [0, -1, 0],
    0,
    2 * reach * k,
    7,
    64,
  ).measure(points);
  // A waist seam is a cross-section of the cloth at this height. Taking
  // the widest vertex from adjacent rows can leave it hovering over a taper.
  const sections = shells.map((s) => {
    const tri: number[] = [];
    for (let i = 0; i < s.tri.length; i += 3) {
      const a = at(s.tri, i),
        b = at(s.tri, i + 1),
        c = at(s.tri, i + 2);
      if (
        s.f["wArm"] &&
        Math.max(s.value("wArm", a), s.value("wArm", b), s.value("wArm", c)) > 0.35
      )
        continue;
      const ya = at(s.pos, 3 * a + 1),
        yb = at(s.pos, 3 * b + 1),
        yc = at(s.pos, 3 * c + 1);
      if (Math.max(ya, yb, yc) >= y - reach * k && Math.min(ya, yb, yc) <= y + reach * k)
        tri.push(a, b, c);
    }
    return { pos: s.pos, tri };
  });
  const casts = sections.map((s) => raycaster(s.pos, s.tri)),
    cast: Ray = (o, d) => casts.reduce((best, c) => Math.min(best, c(o, d)), Infinity);
  for (let row = 0; row < env.rows; row++) {
    const h = (env.h1 * row) / (env.rows - 1);
    for (let col = 0; col < env.cols; col++) {
      const index = row * env.cols + col,
        angle = (col * TAU) / env.cols;
      const from = Math.max(at(env.r, index), 0.05 * k) + 0.08 * k;
      const hit = cast(env.point(h, angle, from), [Math.sin(angle), 0, -Math.cos(angle)]);
      if (hit < from) env.r[index] = from - hit;
    }
  }
  return env.taut(1);
}

/** A belt over the clothes at a height, with an optional buckle. */
export function belt(
  piece: Piece,
  body: DressBody,
  m: Landmarks,
  shells: ReadonlyArray<Shell>,
  y: number,
  {
    height = 0.034,
    thick = 0.004,
    buckle = true,
    cols = 64,
  }: {
    readonly height?: number;
    readonly thick?: number;
    readonly buckle?: boolean;
    readonly cols?: number;
  } = {},
): Envelope {
  const k = m.k,
    env = girth(body, m, shells, y),
    mid = 0.05 * k,
    hh = (height * k) / 2;
  const radius = (dy: number, a: number) => env.sample(mid + dy, a) + 0.0015 * k;
  const ring = (dy: number, dr: number) =>
    Array.from({ length: cols }, (_, j) => {
      const a = (j / cols) * TAU;
      return env.point(mid + dy, a, radius(dy, a) + dr);
    });
  const t = thick * k;
  piece.loft(
    [
      ring(hh, -0.004 * k),
      ring(hh, t),
      ring(hh * 0.5, t * 1.15),
      ring(-hh * 0.5, t * 1.15),
      ring(-hh, t),
      ring(-hh, -0.004 * k),
    ],
    (p) => body.trunkAt(p),
  );
  if (buckle) {
    const p = env.point(mid, 0, radius(0, 0) + t),
      s = body.trunkAt(p);
    box(
      piece,
      add(p, [0, 0, 0.002 * k]),
      [
        [0.021 * k, 0, 0],
        [0, hh * 1.25, 0],
        [0, 0, 0.003 * k],
      ],
      s,
    );
  }
  return env;
}

/** A fold-down or standing collar grown from a neck opening. */
export function collar(
  piece: Piece,
  s: Shell,
  loop: ReadonlyArray<number> | null,
  m: Landmarks,
  {
    stand = 0.022,
    fall = 0.04,
    kind = "shirt",
    gap = 0.16,
  }: {
    readonly stand?: number;
    readonly fall?: number;
    readonly kind?: "shirt" | "stand";
    readonly gap?: number;
  } = {},
): void {
  if (!loop) return;
  const k = m.k,
    z0 = m.neck[2],
    rings: Vec[][] = kind === "shirt" ? [[], [], [], [], [], []] : [[], [], [], [], []];
  const ringAt = (n: number): Vec[] => rings[n] ?? [];
  for (const i of loop) {
    const p = s.at(i),
      out = unit([p[0], 0, p[2] - z0]),
      angle = Math.abs(Math.atan2(p[0], p[2] - z0));
    // The collar closes to nothing at the centre front and is longest at its points.
    const open = smooth(0, gap, angle),
      point = 1 + 0.5 * smooth(1.2, 0.35, angle),
      h =
        Math.min(stand * k, Math.max(0.012 * k, m.neck[1] + 0.09 * k - p[1])) *
        (kind === "shirt" ? mix(0.55, 1, smooth(0.2, 1.4, angle)) : 1) *
        open;
    // A collar stands the way the cloth it is sewn to runs: on a shoulder that slopes up to the neck it leans in
    // with the slope, where one raised straight up would stand away from the neck as a funnel.
    const n = s.normal(i),
      along = dot([0, 1, 0], n),
      slope = unit([-n[0] * along, 1 - n[1] * along, -n[2] * along]),
      up = unit([slope[0] * 0.75, 0.25 + slope[1] * 0.75, slope[2] * 0.75]);
    const raise = (o: number, u: number): Vec =>
      u > 0
        ? [p[0] + out[0] * o + up[0] * u, p[1] + up[1] * u, p[2] + out[2] * o + up[2] * u]
        : [p[0] + out[0] * o, p[1] + u, p[2] + out[2] * o];
    if (kind === "shirt") {
      ringAt(0).push(raise(0.0005 * k, -0.002 * k));
      ringAt(1).push(raise(-0.004 * k * open, h));
      ringAt(2).push(raise(0.006 * k * open, h + 0.003 * k * open));
      ringAt(3).push(
        raise((0.024 + 0.014 * (point - 1)) * k * open, h - fall * k * point * open * 0.5),
      );
      ringAt(4).push(raise((0.033 + 0.016 * (point - 1)) * k * open, h - fall * k * point * open));
      // The under side of the leaf, a few millimetres in: the collar has an edge and casts its own shadow.
      ringAt(5).push(
        raise(
          (0.029 + 0.016 * (point - 1)) * k * open,
          h - fall * k * point * open - 0.0005 * k * open,
        ),
      );
    } else {
      ringAt(0).push(raise(0.001 * k, -0.002 * k));
      ringAt(1).push(raise(0.004 * k, h * 0.5));
      ringAt(2).push(raise(0.004 * k, h));
      ringAt(3).push(raise(-0.001 * k, h));
      ringAt(4).push(raise(-0.002 * k, 0));
    }
  }
  const skins = loop.map((i) => s.skin(i));
  piece.loft(
    rings,
    (_p, _i, j) =>
      skins[j] ?? [
        [0, 0, 0, 0],
        [1, 0, 0, 0],
      ],
    { flip: kind === "shirt" },
  );
}

/** A hood worn down: its stand rises from the neck opening and its pouch lies on the cloth of the upper back. */
export function hood(
  piece: Piece,
  body: DressBody,
  shells: ReadonlyArray<{ readonly pos: ArrayLike<number>; readonly tri: ArrayLike<number> }>,
  s: Shell,
  loop: ReadonlyArray<number> | null,
  m: Landmarks,
  {
    length = 0.17,
    thick = 0.022,
    stand = 0.022,
    front = 0.3,
  }: {
    readonly length?: number;
    readonly thick?: number;
    readonly stand?: number;
    readonly front?: number;
  } = {},
): void {
  if (!loop) return;
  const k = m.k,
    z0 = m.neck[2],
    top = Math.max(...loop.map((i) => at(s.pos, i * 3 + 1))),
    floor = top - (length + 0.05) * k,
    tri: number[] = [],
    pos: number[] = [];
  // Only the cloth of the upper back can lie under the hood, which keeps the rays that find it cheap.
  for (const shell of shells) {
    const base = pos.length / 3;
    for (let i = 0; i < shell.pos.length; i++) pos.push(at(shell.pos, i));
    for (let t = 0; t < shell.tri.length; t += 3)
      if ([0, 1, 2].every((e) => at(shell.pos, at(shell.tri, t + e) * 3 + 1) > floor - 0.03 * k))
        tri.push(base + at(shell.tri, t), base + at(shell.tri, t + 1), base + at(shell.tri, t + 2));
  }
  const cast = raycaster(pos, tri),
    fall = [0.03, 0.14, 0.28, 0.43, 0.58, 0.73, 0.86, 0.96],
    rings = Array.from({ length: fall.length + 5 }, (): Vec[] => []),
    skins: Skin[] = [],
    under: Skin[] = [];
  for (const i of loop) {
    const p = s.at(i),
      o = unit([p[0], 0, p[2] - z0]),
      back = smooth(1, 2.5, Math.abs(Math.atan2(p[0], p[2] - z0)));
    const long = mix(0.02, length, back ** 1.5) * k,
      rise = stand * k * mix(0.4, 1, back);
    // The hood is folded along the middle of the back, a little off centre, with a soft lobe to either side.
    const side = (p[0] - 0.005 * k) / k,
      crease = Math.exp(-((side / 0.02) ** 2)) * back,
      lobe = Math.exp(-(((Math.abs(side) - 0.055) / 0.03) ** 2)) * back * (side > 0 ? 1.15 : 0.9);
    const deep = thick * k * mix(front, 1, back);
    // Where the hood lies at a depth below the opening: on the cloth behind it, found by a ray from outside.
    const rest = (d: number): Vec => {
      const origin: Vec = [p[0] + o[0] * 0.3, p[1] - d, p[2] + o[2] * 0.3],
        hit = cast(origin, [-o[0], 0, -o[2]]);
      // A ray that misses, or that finds cloth further in than the opening itself, falls back to a line down from it.
      return Number.isFinite(hit) && hit < 0.3 + 0.02 * k
        ? [origin[0] - o[0] * hit, origin[1], origin[2] - o[2] * hit]
        : [p[0] + o[0] * d * 0.3, p[1] - d, p[2] + o[2] * d * 0.3];
    };
    const lift3 = (q: Vec, away: number, up: number): Vec => [
        q[0] + o[0] * away,
        q[1] + up,
        q[2] + o[2] * away,
      ],
      column: Vec[] = [];
    column.push(
      lift3(p, -0.003 * k, -0.004 * k),
      lift3(p, 0.003 * k, rise * 0.8),
      lift3(p, deep * 0.55, rise),
      lift3(p, deep * 1.02, rise * 0.45),
    );
    for (const f of fall) {
      const pouch =
        (0.72 + 0.4 * Math.sin(Math.PI * f ** 0.8)) *
        (1 - 0.42 * crease * smooth(0.05, 0.45, f)) *
        (1 + 0.22 * lobe * Math.sin(Math.PI * f));
      column.push(lift3(rest(f * long), deep * pouch * mix(1, 0.6, smooth(0.8, 1, f)), 0));
    }
    column.push(lift3(rest(long * 1.05), 0.0015 * k, 0));
    column.forEach((q, row) => rings[row]?.push(q));
    skins.push(s.skin(i));
    under.push(body.skinAt(rest(long * 0.6)));
  }
  const none: Skin = [
    [0, 0, 0, 0],
    [1, 0, 0, 0],
  ];
  // The stand moves with the neck opening and the pouch with the back it lies on.
  piece.loft(rings, (_q, row, j) => (row < 4 ? skins[j] : under[j]) ?? none, { flip: true });
}

/** A strip of webbing or leather along a path of points with outward directions. */
export function strap(
  piece: Piece,
  body: DressBody,
  path: ReadonlyArray<readonly [Vec, Vec]>,
  { width = 0.03, thick = 0.004 }: { readonly width?: number; readonly thick?: number } = {},
): void {
  const rings: Vec[][] = [[], [], [], []];
  if (path.length < 2) return;
  const pointAt = (i: number): Vec => path[i]?.[0] ?? [0, 0, 0];
  path.forEach(([p, n], i) => {
    const tangent = unit(
        sub(pointAt(Math.min(path.length - 1, i + 1)), pointAt(Math.max(0, i - 1))),
      ),
      side = unit(cross(tangent, n)),
      up = unit(cross(side, tangent));
    rings[0]?.push(add(add(p, side, -width / 2), up, -0.002));
    rings[1]?.push(add(add(p, side, -width / 2), up, thick));
    rings[2]?.push(add(add(p, side, width / 2), up, thick));
    rings[3]?.push(add(add(p, side, width / 2), up, -0.002));
  });
  piece.loft(rings, (p) => body.skinAt(p), { closed: false });
}

/**
 * A band lying around the neck opening: a scarf or a fur trim. `flat` above 1 makes it taller than it is thick,
 * `lumps` makes it uneven like fur, and `wraps` winds shallow folds round it like wound cloth.
 */
export function roll(
  piece: Piece,
  s: Shell,
  loop: ReadonlyArray<number> | null,
  m: Landmarks,
  {
    radius = 0.03,
    back = 1,
    front = 0.25,
    drop = 0.01,
    out = 0,
    flat = 0.75,
    lumps = 0,
    wraps = 0,
    sides = 10,
  }: {
    readonly radius?: number;
    readonly back?: number;
    readonly front?: number;
    readonly drop?: number;
    readonly out?: number;
    readonly flat?: number;
    readonly lumps?: number;
    readonly wraps?: number;
    readonly sides?: number;
  } = {},
): void {
  if (!loop) return;
  const k = m.k,
    z0 = m.neck[2],
    rings = Array.from({ length: sides }, (): Vec[] => []);
  for (const i of loop) {
    const p = s.at(i),
      o = unit([p[0], 0, p[2] - z0]),
      turn = Math.atan2(p[0], p[2] - z0),
      angle = Math.abs(turn);
    // Unevenness follows the direction round the neck, so it stays the same however finely the opening is cut.
    const r =
      radius *
      k *
      mix(front, back, smooth(0.6, 2.2, angle)) *
      (1 + lumps * Math.sin(turn * 11) * Math.sin(turn * 3.1 + 1));
    const centre: Vec = [
      p[0] + o[0] * (r * 0.7 + out * k),
      p[1] + r * flat * 0.5 - drop * k * smooth(0.6, 2.2, angle),
      p[2] + o[2] * (r * 0.7 + out * k),
    ];
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * TAU,
        fold = 1 - wraps * (0.5 + 0.5 * Math.cos(2 * a + 5 * turn + 1.3 * Math.sin(turn * 2))) ** 2;
      rings[j]?.push([
        centre[0] + o[0] * Math.cos(a) * r * fold,
        centre[1] + Math.sin(a) * r * flat * mix(1, fold, 0.4),
        centre[2] + o[2] * Math.cos(a) * r * fold,
      ]);
    }
  }
  const skins = loop.map((i) => s.skin(i)),
    none: Skin = [
      [0, 0, 0, 0],
      [1, 0, 0, 0],
    ];
  piece.loft([...rings, rings[0] ?? []], (_p, _i, j) => skins[j] ?? none);
}

/** A fitted plate or pad over part of the body, such as a shoulder guard. */
export function plate(
  body: DressBody,
  m: Landmarks,
  keep: ReadonlyArray<(s: Shell, i: number) => number>,
  {
    ease = 0.012,
    passes = 10,
    near,
  }: { readonly ease?: number; readonly passes?: number; readonly near?: Vec } = {},
): Edges & { readonly s: Shell } {
  let s = bodyShell(body);
  for (const test of keep) {
    const shell = s;
    s = cut(shell, (i) => test(shell, i));
  }
  if (near) s = connected(s, near);
  lift(s, ease * m.k);
  relax(s, { passes, gap: ease * 0.7 * m.k });
  return { s, ...classify(s) };
}

/** Hands or forearms in fitted leather: gloves and bracers. One strapped on over a sleeve names that sleeve in `over` and lies outside it. */
export function sleeveGuard(
  body: DressBody,
  m: Landmarks,
  side: string,
  {
    from = 1.82,
    to = 3,
    ease = 0.0025,
    passes = 2,
    over = [],
    room = 0.004,
  }: {
    readonly from?: number;
    readonly to?: number;
    readonly ease?: number;
    readonly passes?: number;
    readonly over?: ReadonlyArray<Shell>;
    readonly room?: number;
  } = {},
): Edges & { readonly s: Shell } {
  const k = m.k,
    sign = side === "l" ? 1 : -1;
  let s = bodyShell(body);
  s = cut(s, (i) => (at(s.anc, i * 3) * sign > 0 ? s.value("arm", i) - from : -1));
  if (to < 2.5) s = cut(s, (i) => to - s.value("arm", i));
  lift(s, ease * k);
  relax(s, { passes, gap: ease * 0.6 * k, strength: 0.4 });
  for (const shell of over) outside(s, shell, room * k, false);
  return { s, ...classify(s) };
}

export interface ShoeOptions {
  readonly collar?: number;
  readonly sole?: number;
  readonly ease?: number;
  readonly heel?: number;
  readonly toe?: number;
}

/** A shoe lofted from convex slices of the foot, so toes merge into a toe box. */
export function shoe(
  body: DressBody,
  m: Landmarks,
  side: string,
  { collar = 0.058, sole = 0.011, ease = 0.005, heel = 0, toe = 0 }: ShoeOptions = {},
): { readonly upper: Piece; readonly sole: Piece; readonly ground: number } {
  const k = m.k,
    ankle = body.joint("foot_" + side),
    ball = body.joint("ball_" + side);
  const f = unit([ball[0] - ankle[0], 0, ball[2] - ankle[2]]),
    across: Vec = [f[2], 0, -f[0]];
  const w = body.weight(new RegExp("^(foot|ball|calf)_" + side)),
    top = body.floor + collar * k,
    points: Array<readonly [number, number, number]> = [];
  let t0 = Infinity,
    t1 = -Infinity;
  for (let v = 0; v < body.count; v++) {
    if (at(w, v) < 0.5 || at(body.P, v * 3 + 1) > top + 0.05 * k) continue;
    const d = sub(body.point(v), ankle),
      t = dot(d, f);
    points.push([t, dot(d, across), at(body.P, v * 3 + 1)]);
    if (at(body.P, v * 3 + 1) < top) {
      t0 = Math.min(t0, t);
      t1 = Math.max(t1, t);
    }
  }
  t1 += toe * k;
  const slices = 20,
    around = 24,
    dt = (t1 - t0) / slices,
    rings: Vec[][] = [],
    centres: Array<[number, number] | null> = [],
    radii: Array<number[] | null> = [];
  for (let i = 0; i < slices; i++) {
    const t = t0 + (i + 0.5) * dt,
      flat: Flat[] = [];
    for (const [pt, x, y] of points)
      if (Math.abs(pt - t) < dt * 0.9) flat.push([x, Math.min(y, top)]);
    if (flat.length < 3) {
      radii.push(null);
      centres.push(null);
      continue;
    }
    let lo = Infinity,
      hi = -Infinity;
    for (const [x] of flat) {
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
    flat.push([lo, body.floor], [hi, body.floor]);
    const outline = hull2(flat),
      ys = outline.map((p) => p[1]),
      centre: [number, number] = [(lo + hi) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    centres.push(centre);
    radii.push(
      Array.from(
        { length: around },
        (_, j) => reach2(outline, centre, (j / around) * TAU) + ease * k,
      ),
    );
  }
  const known = radii.map((r, i) => (r ? i : -1)).filter((i) => i >= 0);
  for (let i = 0; i < slices; i++)
    if (!radii[i]) {
      const n = known.reduce((a, b) => (Math.abs(b - i) < Math.abs(a - i) ? b : a));
      radii[i] = (radii[n] ?? []).slice();
      const c = centres[n];
      centres[i] = c ? [c[0], c[1]] : [0, 0];
    }
  const R = (i: number): number[] => radii[i] ?? [],
    C = (i: number): [number, number] => centres[i] ?? [0, 0];
  for (let pass = 0; pass < 2; pass++) {
    const old = radii.map((r) => (r ?? []).slice()),
      oldCentres = centres.map((c): [number, number] => (c ? [c[0], c[1]] : [0, 0]));
    for (let i = 1; i < slices - 1; i++) {
      const r = R(i),
        before = old[i - 1] ?? [],
        now = old[i] ?? [],
        after = old[i + 1] ?? [];
      for (let j = 0; j < around; j++)
        r[j] = Math.max(at(now, j), (at(before, j) + 2 * at(now, j) + at(after, j)) / 4);
      const c = C(i),
        cb = oldCentres[i - 1] ?? [0, 0],
        cn = oldCentres[i] ?? [0, 0],
        ca = oldCentres[i + 1] ?? [0, 0];
      for (let d = 0; d < 2; d++) c[d] = (at(cb, d) + 2 * at(cn, d) + at(ca, d)) / 4;
    }
  }
  const world = (t: number, x: number, y: number): Vec => [
    ankle[0] + f[0] * t + across[0] * x,
    y,
    ankle[2] + f[2] * t + across[2] * x,
  ];
  const ring = (i: number, t: number, scale: number) =>
    Array.from({ length: around }, (_, j) => {
      const a = (j / around) * TAU,
        r = at(R(i), j) * scale,
        c = C(i);
      return world(
        t,
        c[0] + Math.cos(a) * r,
        Math.max(body.floor + 0.0005, c[1] + Math.sin(a) * r),
      );
    });
  rings.push(ring(0, t0 - dt * 0.3, 0.5), ring(0, t0 - dt * 0.05, 0.85));
  for (let i = 0; i < slices; i++) rings.push(ring(i, t0 + (i + 0.5) * dt, 1));
  rings.push(ring(slices - 1, t1 + dt * 0.05, 0.85), ring(slices - 1, t1 + dt * 0.3, 0.5));
  const tBall = dot(sub(ball, ankle), f),
    foot = body.bone("foot_" + side),
    toes = body.bone("ball_" + side);
  const skin = (p: Vec): Skin => {
    const b = smooth(tBall - 0.015 * k, tBall + 0.02 * k, dot(sub(p, ankle), f));
    return [
      [foot, toes, 0, 0],
      [1 - b, b, 0, 0],
    ];
  };
  const upper = new Piece().loft(rings, skin, { capStart: true, capEnd: true, flip: true });
  const rowCount = rings.length,
    shoeUV: number[] = [];
  upper.shoeUV = shoeUV;
  const uvAt = (row: number, col: number) => {
    const angle = (col / around + 0.25) % 1;
    shoeUV.push(0.005 + 0.99 * angle, 1 - (0.005 + (0.99 * row) / (rowCount - 1)));
  };
  for (let row = 0; row < rowCount; row++) for (let col = 0; col < around; col++) uvAt(row, col);
  for (const row of [0, rowCount - 1]) {
    uvAt(row, around / 4);
    for (let col = 0; col < around; col++) uvAt(row, col);
  }
  // The sole follows the outline of the upper seen from above.
  const print = hull2(
    rings.flatMap((r) =>
      r
        .filter((p) => p[1] < body.floor + 0.03 * k)
        .map((p): Flat => {
          const d = sub(p, ankle);
          return [dot(d, f), dot(d, across)];
        }),
    ),
  );
  const centre = print.reduce<Flat>(
    (sum, p) => [sum[0] + p[0] / print.length, sum[1] + p[1] / print.length],
    [0, 0],
  );
  const steps = 40,
    lip = 0.003 * k,
    edge: Flat[] = [];
  for (let j = 0; j < steps; j++) {
    const a = (j / steps) * TAU,
      r = reach2(print, centre, a) + lip;
    edge.push([centre[0] + Math.cos(a) * r, centre[1] + Math.sin(a) * r]);
  }
  // The sole stands on the floor the bare foot stands on and wraps the rim of the upper, so a shod figure keeps its height and its ground contact.
  const rise = (t: number) =>
    body.floor +
    (sole + 0.004) * k +
    heel * k * (1 - smooth(-0.012 * k, 0.004 * k, t - (t0 + (t1 - t0) * 0.34)));
  const slab = new Piece().loft(
    [edge.map(([t, x]) => world(t, x, body.floor)), edge.map(([t, x]) => world(t, x, rise(t)))],
    skin,
    { capStart: true, capEnd: true, flip: true },
  );
  return { upper, sole: slab, ground: body.floor };
}

/** Buckled leather straps seated on the finished shaft at each sampled height. */
export function bootFastenings(
  body: DressBody,
  m: Landmarks,
  side: string,
  shell: Shell,
): { readonly leather: Piece; readonly metal: Piece } {
  const leather = new Piece(),
    metal = new Piece(),
    k = m.k;
  const ankle = body.joint("foot_" + side),
    knee = body.joint("calf_" + side);
  let lowest = Infinity,
    highest = -Infinity;
  for (let i = 1; i < shell.pos.length; i += 3) {
    lowest = Math.min(lowest, at(shell.pos, i));
    highest = Math.max(highest, at(shell.pos, i));
  }
  const bottom = Math.max(lowest, body.floor + 0.1 * k);
  const span = highest - bottom;
  if (span < 0.055 * k) return { leather, metal };
  const cast = caster([shell]);
  const direction = (angle: number): Vec => [Math.sin(angle), 0, Math.cos(angle)];
  const half = 0.009 * k;
  function surface(y: number, angle: number, offset: number): Vec | null {
    const axisT = (y - ankle[1]) / (knee[1] - ankle[1]);
    const axis: Vec = [mix(ankle[0], knee[0], axisT), y, mix(ankle[2], knee[2], axisT)];
    const n = direction(angle),
      from = 0.24 * k;
    const radius = from - cast(add(axis, n, from), [-n[0], -n[1], -n[2]]);
    return radius > 0 ? add(axis, n, radius + offset) : null;
  }
  const cols = 28,
    buckleAngle = ((side === "l" ? 1 : -1) * Math.PI) / 3;
  for (const t of span > 0.14 * k ? [0.22, 0.7] : [0.45]) {
    const y = bottom + t * span;
    const ring = (dy: number, offset: number) =>
      Array.from({ length: cols }, (_, i) => surface(y + dy, (i * TAU) / cols, offset * k));
    const rings = [
      ring(half, -0.001),
      ring(half, 0.0035),
      ring(-half, 0.0035),
      ring(-half, -0.001),
    ];
    const centre = surface(y, buckleAngle, 0.0055 * k);
    const solid = rings.map((row) => row.filter((p): p is Vec => p !== null));
    if (!centre || solid.some((row) => row.length !== cols)) continue;
    leather.loft(solid, (p) => body.skinAt(p));
    const n = direction(buckleAngle),
      tangent: Vec = [n[2], 0, -n[0]];
    const skin = body.skinAt(centre);
    const rail = (x: number, h: number, width: number, height: number) =>
      box(
        metal,
        add(add(centre, tangent, x * k), [0, 1, 0], h * k),
        [
          [tangent[0] * width * k, tangent[1] * width * k, tangent[2] * width * k],
          [0, height * k, 0],
          [n[0] * 0.002 * k, n[1] * 0.002 * k, n[2] * 0.002 * k],
        ],
        skin,
      );
    for (const sign of [-1, 1]) {
      rail(0, sign * 0.012, 0.016, 0.002);
      rail(sign * 0.014, 0, 0.002, 0.012);
    }
    rail(-0.006, 0, 0.01, 0.0015);
  }
  return { leather, metal };
}

/** A straight boot shaft from below the knee to the ankle, over the shoe. */
export function shaft(
  body: DressBody,
  m: Landmarks,
  side: string,
  {
    from = 1.45,
    ease = 0.006,
    taper = 0.05,
    foot = 0.06,
  }: {
    readonly from?: number;
    readonly ease?: number;
    readonly taper?: number;
    readonly foot?: number;
  } = {},
): Edges & { readonly s: Shell } {
  const k = m.k,
    sign = side === "l" ? 1 : -1;
  let s = bodyShell(body);
  s = cut(s, (i) => (at(s.anc, i * 3) * sign > 0 ? s.value("leg", i) - from : -1));
  s = cut(s, (i) => at(s.anc, i * 3 + 1) - (body.floor + foot * k));
  lift(s, ease * k);
  const root = body.joint("calf_" + side),
    end = body.joint("foot_" + side),
    w = body.weight(new RegExp("^(calf|foot)_" + side)),
    points: Vec[] = [];
  for (let v = 0; v < body.count; v++)
    if (at(w, v) > 0.5 && at(body.P, v * 3 + 1) > body.floor + 0.04 * k) points.push(body.point(v));
  const span = length(sub(end, root)) + 0.03 * k;
  new Envelope(root, sub(end, root), 0, span, Math.round(span / (0.02 * k)), 24)
    .measure(points)
    .taut(1)
    .hang(taper, 1)
    .soften(1)
    .drape(s, null, ease * k);
  relax(s, { passes: 4, gap: 0.004 * k });
  return { s, ...classify(s) };
}
