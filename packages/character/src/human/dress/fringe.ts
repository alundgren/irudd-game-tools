// The head as hair sees it, and a comb that takes a fringe off the eyes
// (character-view/human-fringe.js at 2761eb1). Every groom measures the same
// frame from the adult it is built on, so a parting or a sweep follows the
// actual skull, the actual eyes and the actual hairline.

import type { HumanSurface } from "../surface.js";
import {
  analyse,
  at,
  clamp,
  length,
  mix,
  smooth,
  sub,
  unit,
  type DressBody,
  type Vec,
} from "./kit.js";

const DEG = Math.PI / 180;
// Hairline height (degrees above the cranium centre) by direction: 0 is the front, 180 the nape.
const HAIRLINE: ReadonlyArray<readonly [number, number]> = [
  [0, 27],
  [28, 28],
  [50, 31],
  [64, 25],
  [74, 6],
  [80, -4],
  [87, 3],
  [96, 5],
  [110, 3],
  [122, -14],
  [140, -40],
  [180, -52],
];
const row = (rows: ReadonlyArray<readonly [number, number]>, i: number) => rows[i] ?? [0, 0];
// A smooth curve through the rows, so the line has no corners where two rows meet.
const table = (rows: ReadonlyArray<readonly [number, number]>, x: number): number => {
  const n = rows.length - 1,
    i = Math.min(
      n,
      Math.max(
        1,
        rows.findIndex((r) => x <= r[0]),
      ),
    );
  if (x >= row(rows, n)[0]) return row(rows, n)[1];
  const [x0, y0] = row(rows, Math.max(0, i - 2)),
    [x1, y1] = row(rows, i - 1),
    [x2, y2] = row(rows, i),
    [x3, y3] = row(rows, Math.min(n, i + 1));
  const t = (x - x1) / (x2 - x1),
    a = ((y2 - y0) / (x2 - x0 || 1)) * (x2 - x1),
    b = ((y3 - y1) / (x3 - x1 || 1)) * (x2 - x1);
  return (
    (2 * t ** 3 - 3 * t * t + 1) * y1 +
    (t ** 3 - 2 * t * t + t) * a +
    (3 * t * t - 2 * t ** 3) * y2 +
    (t ** 3 - t * t) * b
  );
};
/** Hairline elevation in radians at an azimuth in radians. */
export const hairline = (phi: number): number => table(HAIRLINE, Math.abs(phi) / DEG) * DEG;

export interface Aim {
  readonly q: Vec;
  /** Azimuth: 0 at the front, positive to the wearer's left. */
  readonly phi: number;
  /** Elevation. */
  readonly eps: number;
}
export interface Over {
  readonly phi: number;
  readonly eps: number;
  readonly r: number;
  readonly u: Vec;
  /** Height above the head. */
  readonly h: number;
}
export interface FrameEye {
  readonly centre: Vec;
  readonly phi: number;
  readonly eps: number;
  readonly wide: number;
  readonly tall: number;
}

/** Cranium centre, size and directions used to place every style. */
export interface HeadFrame {
  readonly k: number;
  readonly centre: Vec;
  readonly radii: Vec;
  readonly top: number;
  readonly eye: Vec;
  readonly size: number;
  readonly earElevation: number;
  readonly eyes: ReadonlyArray<FrameEye>;
  aim(p: Vec): Aim;
  /** Distance from the centre to the head along a unit direction, in metres. */
  bone(u: Vec): number;
  over(p: Vec): Over;
  place(phi: number, eps: number, h: number): Vec;
  /** The point pushed out of the skin to leave a gap. */
  clear(p: Vec, gap: number): Vec;
}

/** How far the head reaches from the cranium centre, by unit direction. */
function dome(body: DressBody, centre: Vec): (q: Vec) => number {
  const head = body.weight(/^head/),
    step = 6 * DEG,
    cols = 60,
    rows = 30,
    far = new Float32Array(cols * rows).fill(-1);
  for (let v = 0; v < body.count; v++) {
    if (at(head, v) < 0.5) continue;
    const d = sub(body.point(v), centre),
      r = length(d),
      i = clamp(Math.floor((Math.asin(d[1] / r) + Math.PI / 2) / step), 0, rows - 1),
      j = Math.floor((Math.atan2(d[0], d[2]) + Math.PI) / step) % cols;
    far[i * cols + j] = Math.max(at(far, i * cols + j), r);
  }
  // The jaw can leave a broad empty sector on the underside of a narrow head.
  // Fill every direction before interpolating radii, including the polar rows.
  for (let pass = 0; pass < rows + cols / 2 && far.includes(-1); pass++) {
    const old = far.slice();
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < cols; j++)
        if (at(old, i * cols + j) < 0)
          far[i * cols + j] = Math.max(
            at(old, i * cols + ((j + 1) % cols)),
            at(old, i * cols + ((j + cols - 1) % cols)),
            at(old, Math.max(0, i - 1) * cols + j),
            at(old, Math.min(rows - 1, i + 1) * cols + j),
          );
  }
  return (q) => {
    const fr = clamp((Math.asin(clamp(q[1], -1, 1)) + Math.PI / 2) / step - 0.5, 0, rows - 1),
      fc = ((Math.atan2(q[0], q[2]) + Math.PI) / step - 0.5 + cols) % cols;
    const i = Math.min(rows - 2, Math.floor(fr)),
      t = fr - i,
      j = Math.floor(fc) % cols,
      n = (j + 1) % cols,
      u = fc - Math.floor(fc);
    return mix(
      mix(at(far, i * cols + j), at(far, i * cols + n), u),
      mix(at(far, (i + 1) * cols + j), at(far, (i + 1) * cols + n), u),
      t,
    );
  };
}

/** The head frame measured on an analysed body. */
export function headFrame(body: DressBody): HeadFrame {
  const k = body.scale,
    head = body.weight(/^head/),
    { positions, ids } = body.surface,
    joint = body.joint("head");
  let top = -Infinity,
    sum: [number, number, number] | null = null,
    count = 0;
  const balls: [Vec[], Vec[]] = [[], []];
  for (let v = 0; v < body.count; v++)
    if (at(head, v) > 0.5) top = Math.max(top, at(body.P, v * 3 + 1));
  for (let v = body.count; v < ids.length; v++) {
    const id = at(ids, v);
    if (id < 14598 || id > 14741) continue;
    sum ??= [0, 0, 0];
    sum[1] += at(positions, v * 3 + 1);
    sum[2] += at(positions, v * 3 + 2);
    count++;
    const p: Vec = [at(positions, v * 3), at(positions, v * 3 + 1), at(positions, v * 3 + 2)];
    balls[p[0] > 0 ? 0 : 1].push(p);
  }
  const eye: Vec = sum
    ? [0, sum[1] / count, sum[2] / count]
    : [0, top - 0.118 * k, joint[2] + 0.07 * k];
  let back = Infinity,
    front = -Infinity,
    wide = 0;
  for (let v = 0; v < body.count; v++) {
    if (at(head, v) < 0.5) continue;
    const [x, y, z] = body.point(v);
    if (y > eye[1]) back = Math.min(back, z);
    if (y > eye[1] + 0.02 * k) front = Math.max(front, z);
    if (y > eye[1] + 0.03 * k) wide = Math.max(wide, Math.abs(x));
  }
  const centre: Vec = [0, eye[1] + 0.22 * (top - eye[1]), (back + front) / 2],
    radii: Vec = [wide, top - centre[1], (front - back) / 2];
  const aim = (p: Vec): Aim => {
    const q = unit([
      (p[0] - centre[0]) / radii[0],
      (p[1] - centre[1]) / radii[1],
      (p[2] - centre[2]) / radii[2],
    ]);
    return {
      q,
      phi: Math.atan2(q[0], q[2]),
      eps: Math.asin(clamp(q[1], -1, 1)),
    };
  };
  let reach: ((q: Vec) => number) | null = null;
  const bone = (u: Vec) => (reach ??= dome(body, centre))(u);
  // Native cage landmarks at the upper rim of each ear. An ear close to the
  // skull can disappear from a radial silhouette while its rim still needs clearance.
  const earRims = [5413, 12012].map((id) => ids.indexOf(id)).filter((i) => i >= 0);
  const eyes = balls.map((found, n): FrameEye => {
    const points: ReadonlyArray<Vec> = found.length
      ? found
      : [[(n ? -1 : 1) * 0.031 * k, eye[1], eye[2]]];
    const total = points.reduce<Vec>((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]);
    const mid: Vec = [total[0] / points.length, total[1] / points.length, total[2] / points.length],
      to = aim(mid);
    let widest = 4 * DEG,
      tallest = 4 * DEG;
    // Only the front of each eyeball faces out of the head.
    for (const p of points)
      if (p[2] > mid[2]) {
        const a = aim(p);
        widest = Math.max(widest, Math.abs(a.phi - to.phi));
        tallest = Math.max(tallest, Math.abs(a.eps - to.eps));
      }
    return {
      centre: mid,
      phi: to.phi,
      eps: to.eps,
      wide: widest,
      tall: tallest,
    };
  });
  return {
    k,
    centre,
    radii,
    top,
    eye,
    aim,
    size: (radii[0] + radii[1] + radii[2]) / 3,
    bone,
    over: (p) => {
      const d = sub(p, centre),
        r = length(d) || 1e-9,
        u: Vec = [d[0] / r, d[1] / r, d[2] / r],
        a = aim(p);
      return { phi: a.phi, eps: a.eps, r, u, h: r - bone(u) };
    },
    place: (phi, eps, h) => {
      const c = Math.cos(eps),
        u = unit([
          c * Math.sin(phi) * radii[0],
          Math.sin(eps) * radii[1],
          c * Math.cos(phi) * radii[2],
        ]),
        r = bone(u) + h;
      return [centre[0] + u[0] * r, centre[1] + u[1] * r, centre[2] + u[2] * r];
    },
    earElevation: Math.max(...earRims.map((i) => aim(body.point(i)).eps)),
    clear: (p, gap) => body.clear(p, gap),
    eyes,
  };
}

const bodies = new WeakMap<HumanSurface, DressBody>(),
  frames = new WeakMap<HumanSurface, HeadFrame>();
/** The analysed body of an evaluated surface, measured once. */
export function surfaceBody(surface: HumanSurface): DressBody {
  let found = bodies.get(surface);
  if (!found) bodies.set(surface, (found = analyse(surface)));
  return found;
}
/** The head frame of an evaluated surface, measured once. */
export function surfaceFrame(surface: HumanSurface): HeadFrame {
  let found = frames.get(surface);
  if (!found) frames.set(surface, (found = headFrame(surfaceBody(surface))));
  return found;
}

interface Way {
  /** The parting between the temples: -1 the wearer's right, 1 the left. */
  readonly part: number;
  /** How much forehead shows at the temples. */
  readonly open: number;
  readonly lean: number;
  readonly flat?: boolean;
  readonly lie?: number;
}
const WAYS: Readonly<Record<string, Way>> = {
  Parted: { part: 0, open: 1, lean: 0.55 },
  "Swept left": { part: -0.5, open: 1, lean: 0.65 },
  "Swept right": { part: 0.5, open: 1, lean: 0.65 },
  "Off the face": { part: 0, open: 0.2, lean: 0, flat: true, lie: 0.5 },
};

/**
 * Comb the fringe of any groom off the face. `positions` holds x, y, z per
 * vertex in world coordinates and is changed in place; vertices that are not
 * over the face stay where they are.
 *
 * Hair is followed from the hairline down. Over the face it may only hang as
 * far as an arch that is shortest at the parting and reaches the brow at the
 * temples, so the eyes and brows stay in view. Each strand is shortened in
 * proportion to fit under the arch, leans from the parting towards the temple,
 * and is laid close to the forehead. Nothing above the hairline moves, so the
 * scalp keeps its cover, and every point keeps a positive height over the
 * measured skull.
 */
export function combFringe(positions: Float32Array, frame: HeadFrame, fringe: string): number {
  const way = WAYS[fringe];
  if (!way) return 0;
  const k = frame.k,
    eyes = frame.eyes;
  // The window that must stay clear: out to a little beyond both eyes and up to the brow.
  const temple = clamp(
    Math.max(...eyes.map((e) => Math.abs(e.phi) + e.wide)) + 12 * DEG,
    30 * DEG,
    56 * DEG,
  );
  const brow = Math.max(...eyes.map((e) => e.eps + e.tall)) + 3 * DEG;
  const part = way.part * temple,
    tail = 13 * DEG,
    soft = 10 * DEG,
    floor = 0.003 * k,
    lie = 0.011 * k * (way.lie ?? 1);
  // First find how far the hair hangs below the hairline in each direction.
  const limit = temple + Math.abs(part) + tail,
    step = 4 * DEG,
    bins = new Float32Array(Math.ceil((2 * limit) / step) + 1),
    found: number[] = [];
  for (let v = 0; v < positions.length / 3; v++) {
    const p: Vec = [at(positions, v * 3), at(positions, v * 3 + 1), at(positions, v * 3 + 2)];
    // Only the front of the head can carry a fringe.
    if (p[2] < frame.centre[2] - 0.25 * frame.radii[2]) continue;
    const o = frame.over(p),
      depth = hairline(o.phi) - o.eps;
    if (depth <= 0 || Math.abs(o.phi) >= limit) continue;
    const bin = Math.floor((o.phi + limit) / step);
    if (depth > at(bins, bin)) bins[bin] = depth;
    found.push(v, o.phi, depth, o.h);
  }
  const longest = (phi: number) => {
    const x = (phi + limit) / step - 0.5,
      i = clamp(Math.floor(x), 0, bins.length - 2);
    return Math.max(at(bins, i), at(bins, i + 1), mix(at(bins, i), at(bins, i + 1), clamp(x - i)));
  };
  let moved = 0;
  for (let n = 0; n < found.length; n += 4) {
    const v = at(found, n),
      phiAt = at(found, n + 1),
      depth = at(found, n + 2),
      height = at(found, n + 3);
    const x = phiAt - part,
      side = x < 0 ? -1 : 1,
      reach = Math.abs(x),
      span = temple - side * part;
    if (reach >= span + tail) continue;
    // 0 at the hairline, 1 at the tips.
    const along = depth / Math.max(depth, longest(phiAt));
    // Strands lean towards the temple; right at the parting they have nowhere to go.
    const out =
      reach < span ? reach + (span - reach) * way.lean * smooth(0, soft, reach) * along : reach;
    const phi = part + side * out,
      line = hairline(phi),
      room = Math.max(4 * DEG, line - brow) * way.open;
    // A short fringe is left at the parting itself, so the hair there is not pinched to nothing.
    const arch = way.flat ? 1 : mix(0.25, 1, smooth(0, 1, clamp(out / span)) ** 0.75);
    let allowed = Math.max(0.4 * DEG, room * arch);
    if (out > span) allowed /= Math.max(1e-4, 1 - smooth(span, span + tail, out));
    const kept = Math.min(depth, along * allowed),
      change = 1 - kept / depth;
    if (change < 1e-4 && out === reach) continue;
    // Shortened hair lies on the forehead and thins towards its tips, but never touches the skin.
    const low = floor + lie * (1 - Math.exp(-Math.max(0, height) / lie)) * (1 - 0.7 * along);
    // The measured skull is coarse, so the nearest skin has the last word.
    const q = frame.clear(
      frame.place(phi, line - kept, Math.max(floor, mix(height, low, smooth(0, 0.5, change)))),
      floor,
    );
    positions[v * 3] = q[0];
    positions[v * 3 + 1] = q[1];
    positions[v * 3 + 2] = q[2];
    moved++;
  }
  return moved;
}

/**
 * Lift vertices over the forehead that ended up in the skin. A card that was
 * combed flat can still cut through the curve of the forehead between its
 * corners; this checks the points the cards are finally drawn with. Returns
 * how many it moved.
 */
export function settleFringe(positions: Float32Array, frame: HeadFrame, fringe: string): number {
  if (!WAYS[fringe]) return 0;
  const gap = 0.003 * frame.k,
    reach = frame.size * 1.5;
  let moved = 0;
  for (let v = 0; v < positions.length / 3; v++) {
    const p: Vec = [at(positions, v * 3), at(positions, v * 3 + 1), at(positions, v * 3 + 2)];
    if (
      p[2] < frame.centre[2] ||
      p[1] < frame.eye[1] ||
      Math.hypot(p[0] - frame.centre[0], p[1] - frame.centre[1], p[2] - frame.centre[2]) > reach
    )
      continue;
    const q = frame.clear(p, gap);
    if (q === p) continue;
    positions[v * 3] = q[0];
    positions[v * 3 + 1] = q[1];
    positions[v * 3 + 2] = q[2];
    moved++;
  }
  return moved;
}
