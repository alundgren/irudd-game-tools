import { buzzCut } from "./human-buzz.js";
// Short hair as a groom: a thin layer of roots that fades into the skin, covered by cards of
// strands that follow a combing direction over the measured skull.
//   strandGroom(surface, style, material, plain, skinColor, gameBudget) -> THREE.Mesh[]
// Everything is placed from the adult it is built on: the hairline is drawn round that
// adult's own ears, and every card is seated on that adult's own scalp.
import * as T from "three";
import { sweptScalpTexture } from "./human-swept-scalp.js";
import { add, bodyShell, clamp, connected, cross, cut, dot, hash1, length, mix, noise3, smooth, sub, subdivide, unit } from "./human-style-kit.js";
import { surfaceBody, surfaceFrame } from "./human-fringe.js";
import { evaluateHuman } from "./human-surface.js";
import { hairLengths } from "./human-style-hair.js";
import { landmarks } from "./human-style-cloth.js";
import { lengthCards } from "./human-groom-lengths.js";
import { haloGather, haloTubes, lockCards, lockParting, sweptTail } from "./human-groom-locks.js";
import { clumpMaps, clumpVolume } from "./human-hair-clumps.js";

const DEG = Math.PI / 180, TAU = Math.PI * 2;

/**
 * Lengths are in millimetres on a head of average size.
 *   top, side, edge   hair length on top, round the sides and back, and at the hairline
 *   front             how much longer the hair over the forehead is than the rest of the top
 *   fade              how far the taper from `edge` to `side` reaches up from the hairline, in degrees
 *   lay               how far long hair stands off the head, as a share of its length
 *   burn              where the sideburn ends, from the top of the ear (0) to the lobe (1)
 *   fringe            how far the hair may hang over the forehead, in degrees
 *   comb              a way of combing that the style fixes, whatever the fringe choice
 *   lengths           the style has hair that leaves the head; `scalp` is the share of the cards kept for the scalp
 *   volume            (direction, frame) => how far a mass of curls stands off the head, in millimetres; `rim` is how far
 *                     from the hairline it reaches that depth, in degrees, and `frizz` how far each tuft turns from the comb
 */
const SPECS = {
  "Tapered crop": { top: 30, front: .25, side: 9, edge: 2.2, fade: 17, lay: .24, burn: .42, fringe: 5 },
  "Horseshoe crop": { top: 24, front: 0, side: 18, edge: 2, fade: 13, lay: .23, burn: .64, fringe: 0, openCrown: true },
  "Close crop": { top: 9, front: .1, side: 5.5, edge: 2, fade: 10, lay: .42, burn: .3, fringe: 2 },
};
export const groomStyles = Object.keys(SPECS);
// Styles that keep the names they have always had and are grown as strands on the scalp of the adult who wears them.
const GROWN = {
  "Buzz cut": { top: 5, front: 0, side: 3.6, edge: 1.5, fade: 9, lay: .55, burn: .25, fringe: 1 },
  "Crop": { top: 21, front: .3, side: 10, edge: 3, fade: 13, lay: .3, burn: .4, fringe: 4 },
  "Side part": { top: 44, front: .2, side: 17, edge: 4, fade: 15, lay: .2, burn: .45, fringe: 5 },
  "Swept back": { top: 50, front: .25, side: 19, edge: 4, fade: 15, lay: .2, burn: .45, fringe: 1.5, comb: "Off the face" },
  "Bob": { top: 58, front: 0, side: 48, edge: 16, fade: 6, lay: .1, burn: .5, fringe: 3, lengths: true, scalp: .22 },
  // Long loose hair is locks from the parting to the tips: see human-groom-locks.js.
  "Long": { top: 58, front: 0, side: 48, edge: 16, fade: 6, lay: .1, burn: .5, fringe: 2, locks: { volume: 8, tip: [-.02, -.1] } },
  "Wavy": { top: 58, front: 0, side: 48, edge: 16, fade: 6, lay: .13, burn: .5, fringe: 2, locks: { volume: 11, tip: [.08, .04], wave: .0045, curl: .6 } },
  // "Long centre part" and "Loose waves" are worn from the library: side by side its combed cards read as softer hair
  // than these locks did.
  // The combed scalp follows the fitted hairline. Tails, crowns and knots have their own geometry.
  "Ponytail": { top: 56, front: 0, side: 46, edge: 12, fade: 6, lay: .06, burn: .35, fringe: 1, lengths: true, swept: {} },
  "Bun": { top: 56, front: 0, side: 46, edge: 12, fade: 6, lay: .06, burn: .35, fringe: 1, lengths: true, swept: {} },
  "Braid": { top: 56, front: 0, side: 46, edge: 12, fade: 6, lay: .06, burn: .35, fringe: 1, lengths: true, swept: { gather: [0, -.3, -1] } },
  // Drawn back under a plait that is laid round the head.
  "Crown braid": { top: 56, front: 0, side: 46, edge: 12, fade: 6, lay: .06, burn: .35, fringe: 1, swept: { gather: haloGather, halo: true } },
  "Low ponytail": { top: 56, front: 0, side: 46, edge: 12, fade: 6, lay: .06, burn: .35, fringe: 1, swept: { gather: [0, -.2, -1], tail: { long: .2, thick: .03 } } },
};
// Curls are a volume: the hair stands off the head by its depth, and the surface of that volume is the clumps themselves.
// `curl` is the clump the volume is made of: domes of coils or hanging ringlets (see human-hair-clumps.js): `clump` is
// its width and `deep` how far the surface stands from the middle of the head, both in millimetres; `tall` how many
// times taller than wide a hanging clump is; `drop` how far ringlets hang below the hairline round the sides and back.
// `relief` is how far a clump rises over the creases round it, in millimetres.
const VOLUMES = {
  // Loose ringlets: full on top, close at the sides, tapered to the ears and the nape.
  "Curls": { top: 17, front: 0, side: 15, edge: 7, fade: 6, lay: .55, burn: .4, fringe: 5, frizz: 1.5, rim: 14, scalp: .78, relief: 5, curl: { kind: "ringlet", clump: 23, deep: 122, tall: 1.5, drop: 14 }, volume: at => mix(9, 30, smooth(0, 52 * DEG, at.eps)) * mix(1, 1.12, smooth(.2, .9, at.q[2]) * smooth(.3, .8, at.q[1])) },
  // Long loose ringlets that fall round the ears to the jaw and the nape.
  "Natural curls": { top: 17, front: 0, side: 17, edge: 9, fade: 4, lay: .55, burn: .5, fringe: 7, frizz: 1.5, rim: 15, scalp: .78, relief: 6, curl: { kind: "ringlet", clump: 25, deep: 128, tall: 1.9, drop: 48 }, volume: at => mix(27, 30, smooth(0, 50 * DEG, at.eps)) },
  // A ball round the cranium, as the sculpted style was.
  "Afro": { top: 15, front: 0, side: 15, edge: 8, fade: 5, lay: .6, burn: .45, fringe: 6, frizz: 1.7, rim: 26, round: true, scalp: .8, relief: 7, curl: { kind: "coil", clump: 27, deep: 138, coil: 10.5 }, volume: (at, f) => {
    const ball = f.size + .052 * f.k, shift = [0, -.008 * f.k, .006 * f.k], span = [at.q[0] * f.radii[0], at.q[1] * f.radii[1], at.q[2] * f.radii[2]], u = unit(span), b = dot(u, shift);
    return 1000 / f.k * Math.max(.01 * f.k, -b + Math.sqrt(Math.max(0, b * b - dot(shift, shift) + ball * ball)) - length(span));
  } },
};
// Coils keep their own tubes at full detail. A game model cannot carry those, so there they are clumps on a volume.
const COILS = {
  // Close to the head, squared a little at the front, tapered low round the ears.
  "Coiled crop": { top: 9, front: 0, side: 8, edge: 3, fade: 9, lay: .6, burn: .35, fringe: 3, frizz: 1.7, rim: 10, relief: 1.8, curl: { kind: "coil", clump: 16, deep: 107, coil: 8 }, volume: at => mix(4.5, 11, smooth(0, 45 * DEG, at.eps)) },
  // A rounded shape a hand deep on top that narrows to the ears.
  "Rounded coils": { top: 12, front: 0, side: 11, edge: 5, fade: 7, lay: .6, burn: .4, fringe: 4, frizz: 1.7, rim: 16, relief: 4.5, curl: { kind: "coil", clump: 24, deep: 120, coil: 9.5 }, volume: at => mix(11, 27, smooth(-8 * DEG, 48 * DEG, at.eps)) },
};
Object.assign(SPECS, GROWN, VOLUMES);
/** Every hairstyle this file grows: the two grooms and the earlier styles that are now grown the same way. */
export const grownStyles = Object.keys(SPECS);

// ---------------------------------------------------------------------------------------------
// The ears

let earSource = null;
/** Source vertex ids of both ears, found once on the reference adult by their folded skin. */
export function earSources() {
  if (earSource) return earSource;
  const s = evaluateHuman({ height: 1.72 }), body = surfaceBody(s), f = surfaceFrame(s), head = body.weight(/^head/), folded = new Uint8Array(body.count);
  for (let v = 0; v < body.count; v++) {
    if (head[v] < .5) continue;
    const p = body.point(v), at = f.aim(p), side = Math.abs(at.phi) / DEG, up = at.eps / DEG;
    if (side < 62 || side > 132 || up < -50 || up > 12) continue;
    const d = sub(p, f.centre);
    // The skull faces away from its centre everywhere. The folds of an ear do not.
    if ((body.N[v * 3] * d[0] + body.N[v * 3 + 1] * d[1] + body.N[v * 3 + 2] * d[2]) / length(d) < .2) folded[v] = 1;
  }
  earSource = new Set();
  for (let t = 0; t < body.tri.length; t += 3) {
    const a = body.tri[t], b = body.tri[t + 1], c = body.tri[t + 2];
    if (folded[a] || folded[b] || folded[c]) for (const v of [a, b, c]) earSource.add(s.ids[v]);
  }
  return earSource;
}

/** Which vertices of this adult are ear, and how far each ear reaches: front, back, top and lobe as angles. */
function measureEars(body, f) {
  const source = earSources(), ids = body.surface.ids, mark = new Uint8Array(body.count);
  const box = () => ({ front: Infinity, back: -Infinity, top: -Infinity, low: Infinity });
  const sides = [box(), box()];
  for (let v = 0; v < body.count; v++) {
    if (!source.has(ids[v])) continue;
    mark[v] = 1;
    const at = f.aim(body.point(v)), e = sides[at.phi > 0 ? 0 : 1], side = Math.abs(at.phi);
    e.front = Math.min(e.front, side); e.back = Math.max(e.back, side); e.top = Math.max(e.top, at.eps); e.low = Math.min(e.low, at.eps);
  }
  // A surface without the usual ears still gets a hairline.
  for (const e of sides) if (!Number.isFinite(e.front)) Object.assign(e, { front: 84 * DEG, back: 106 * DEG, top: -10 * DEG, low: -46 * DEG });
  return { mark, sides };
}

// ---------------------------------------------------------------------------------------------
// The hairline

/** A curve through knots that never overshoots them. */
function curve(knots) {
  const n = knots.length, x = knots.map(k => k[0]), y = knots.map(k => k[1]), d = [], m = new Array(n).fill(0);
  for (let i = 0; i + 1 < n; i++) d.push((y[i + 1] - y[i]) / (x[i + 1] - x[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i + 1 < n; i++) if (d[i - 1] * d[i] > 0) { const a = x[i] - x[i - 1], b = x[i + 1] - x[i]; m[i] = 3 * (a + b) / ((2 * b + a) / d[i - 1] + (b + 2 * a) / d[i]); }
  return at => {
    if (at <= x[0]) return y[0];
    if (at >= x[n - 1]) return y[n - 1];
    let i = 0;
    while (at > x[i + 1]) i++;
    const h = x[i + 1] - x[i], t = (at - x[i]) / h;
    return (2 * t ** 3 - 3 * t * t + 1) * y[i] + (t ** 3 - 2 * t * t + t) * h * m[i] + (3 * t * t - 2 * t ** 3) * y[i + 1] + (t ** 3 - t * t) * h * m[i + 1];
  };
}

/**
 * The hairline of one side as elevation by direction, both in degrees: across the forehead, back at
 * the temple, down the sideburn in front of the ear, over the ear, down behind it and across the nape.
 */
function sideLine(ear, spec) {
  const F = clamp(ear.front / DEG, 76, 96), B = clamp(ear.back / DEG, F + 12, 118), top = ear.top / DEG, low = ear.low / DEG, burn = mix(top, low, spec.burn);
  return curve([
    [0, 27], [28, 28], [47, 31], [F - 25, 29], [F - 18.5, 14], [F - 15.5, burn + 7], [F - 13, burn + (spec.swept ? 6 : 0)], [F - 6, burn],
    [F - 3.5, burn + (spec.swept ? 9 : 4)], [F - 1, top + 3.5], [B + 1, top + 3.5], [B + 6, top - 2], [B + 13, mix(top, low, .5)], [B + 24, low + 3],
    [Math.max(B + 34, 147), -47], [165, -52], [180, -50],
  ]);
}

// ---------------------------------------------------------------------------------------------
// The scalp

/**
 * The skull without its ears as a map from direction to distance, skin normal and nearest vertex.
 * Directions are laid out round the axis through the ears, so the map has no pole where hair grows.
 */
function scalpMap(body, f, ears) {
  const A = 240, B = 120, R = new Float32Array(A * B), N = new Float32Array(A * B * 3), V = new Int32Array(A * B).fill(-1);
  const scalp = body.weight(/^(head|neck)/), P = body.P, c = f.centre, at = new Float32Array(body.count * 3), used = new Uint8Array(body.count);
  for (let v = 0; v < body.count; v++) {
    if (scalp[v] < .3 || ears.mark[v]) continue;
    const dx = P[v * 3] - c[0], dy = P[v * 3 + 1] - c[1], dz = P[v * 3 + 2] - c[2], r = Math.hypot(dx, dy, dz);
    let a = Math.atan2(dy, dz);
    if (a < -Math.PI / 2) a += TAU;
    at[v * 3] = (a + Math.PI / 2) / TAU * A; at[v * 3 + 1] = (Math.asin(clamp(dx / r, -1, 1)) + Math.PI / 2) / Math.PI * B; at[v * 3 + 2] = r;
    used[v] = 1;
  }
  for (let t = 0; t < body.tri.length; t += 3) {
    const i = body.tri[t], j = body.tri[t + 1], k = body.tri[t + 2];
    if (!used[i] || !used[j] || !used[k]) continue;
    const x0 = at[i * 3], y0 = at[i * 3 + 1], x1 = at[j * 3], y1 = at[j * 3 + 1], x2 = at[k * 3], y2 = at[k * 3 + 1];
    const lo = Math.min(x0, x1, x2), hi = Math.max(x0, x1, x2);
    if (hi - lo > A / 2) continue;
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-9) continue;
    // Skin that faces the centre is the inside of a nostril or an eyelid.
    const mx = (P[i * 3] + P[j * 3] + P[k * 3]) / 3 - c[0], my = (P[i * 3 + 1] + P[j * 3 + 1] + P[k * 3 + 1]) / 3 - c[1], mz = (P[i * 3 + 2] + P[j * 3 + 2] + P[k * 3 + 2]) / 3 - c[2];
    if ((body.N[i * 3] + body.N[j * 3] + body.N[k * 3]) * mx + (body.N[i * 3 + 1] + body.N[j * 3 + 1] + body.N[k * 3 + 1]) * my + (body.N[i * 3 + 2] + body.N[j * 3 + 2] + body.N[k * 3 + 2]) * mz <= 0) continue;
    const ya = Math.min(y0, y1, y2), yb = Math.max(y0, y1, y2);
    for (let row = Math.max(0, Math.floor(ya - .5)); row <= Math.min(B - 1, Math.ceil(yb - .5)); row++) for (let col = Math.max(0, Math.floor(lo - .5)); col <= Math.min(A - 1, Math.ceil(hi - .5)); col++) {
      const x = col + .5, y = row + .5;
      const w0 = ((x1 - x) * (y2 - y) - (x2 - x) * (y1 - y)) / area, w1 = ((x2 - x) * (y0 - y) - (x0 - x) * (y2 - y)) / area, w2 = 1 - w0 - w1;
      if (w0 < -.02 || w1 < -.02 || w2 < -.02) continue;
      const r = w0 * at[i * 3 + 2] + w1 * at[j * 3 + 2] + w2 * at[k * 3 + 2], cell = row * A + col;
      if (r <= R[cell]) continue;
      R[cell] = r;
      for (let d = 0; d < 3; d++) N[cell * 3 + d] = w0 * body.N[i * 3 + d] + w1 * body.N[j * 3 + d] + w2 * body.N[k * 3 + d];
      V[cell] = w0 >= w1 && w0 >= w2 ? i : w1 >= w2 ? j : k;
    }
  }
  // Cells no triangle reached, and the patch where an ear was, take what surrounds them.
  for (let pass = 0; pass < 24; pass++) {
    const old = R.slice();
    let empty = 0;
    for (let row = 0; row < B; row++) for (let col = 0; col < A; col++) {
      const cell = row * A + col;
      if (old[cell] > 0) continue;
      let sum = 0, count = 0, from = -1;
      for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const r = row + dr, q = col + dc;
        if (r < 0 || r >= B || q < 0 || q >= A || !(old[r * A + q] > 0)) continue;
        sum += old[r * A + q]; count++; from = r * A + q;
      }
      if (!count) { empty++; continue; }
      R[cell] = sum / count; V[cell] = V[from];
      for (let d = 0; d < 3; d++) N[cell * 3 + d] = N[from * 3 + d];
    }
    if (!empty) break;
  }
  /** Distance `r`, unit normal `n` and nearest vertex `v` along a unit direction. */
  return u => {
    let a = Math.atan2(u[1], u[2]);
    if (a < -Math.PI / 2) a += TAU;
    const x = clamp((a + Math.PI / 2) / TAU * A - .5, 0, A - 1.001), y = clamp((Math.asin(clamp(u[0], -1, 1)) + Math.PI / 2) / Math.PI * B - .5, 0, B - 1.001);
    const col = Math.floor(x), row = Math.floor(y), s = x - col, t = y - row, c00 = row * A + col, c01 = c00 + 1, c10 = c00 + A, c11 = c10 + 1;
    const w = [(1 - s) * (1 - t), s * (1 - t), (1 - s) * t, s * t], cells = [c00, c01, c10, c11], n = [0, 0, 0];
    let r = 0, best = 0;
    for (let i = 0; i < 4; i++) { r += w[i] * R[cells[i]]; if (w[i] > w[best]) best = i; for (let d = 0; d < 3; d++) n[d] += w[i] * N[cells[i] * 3 + d]; }
    return { r, n: unit(n), v: V[cells[best]] };
  };
}

// ---------------------------------------------------------------------------------------------
// Combing

const tangent = (q, v) => { const along = dot(q, v); return unit([v[0] - q[0] * along, v[1] - q[1] * along, v[2] - q[2] * along]); };
const aimAt = (phi, eps) => [Math.cos(eps) * Math.sin(phi), Math.sin(eps), Math.cos(eps) * Math.cos(phi)];
/** The nearest point to `q` on the great arc from `a` to `b`. */
function onArc(q, a, b) {
  const n = unit(cross(a, b)), flat = unit(sub(q, n.map(x => x * dot(q, n))));
  if (dot(cross(a, flat), n) >= 0 && dot(cross(flat, b), n) >= 0) return flat;
  return dot(q, a) > dot(q, b) ? a : b;
}

/**
 * Ways to comb the top, by the fringe choice. Hair runs away from `from`, a point or an arc on the
 * head; `forward` adds a pull towards the forehead and `back` sweeps the sides to the rear.
 */
const COMBS = {
  "As cut": { from: [[.12, .8, -.58]], forward: .15, back: .3 },
  "Parted": { from: [[.05, .8, -.6], aimAt(-5 * DEG, 30 * DEG)], forward: .45, back: .3 },
  "Swept left": { from: [[-.1, .8, -.58], aimAt(-42 * DEG, 31 * DEG)], forward: .6, back: .3 },
  "Swept right": { from: [[.1, .8, -.58], aimAt(42 * DEG, 31 * DEG)], forward: .6, back: .3 },
  "Off the face": { from: [aimAt(-72 * DEG, 8 * DEG), aimAt(0, 12 * DEG), aimAt(72 * DEG, 8 * DEG)], forward: 0, back: .85 },
};

/** The direction hair lies at a unit direction `q` of the head frame, as a unit tangent there. */
function combing(look, { parting = null, gather = null } = {}) {
  // Loose lengths run away from where they part; tied hair runs to where it is gathered.
  const comb = parting ? { from: parting, forward: 0, back: .3 } : COMBS[look] ?? COMBS["As cut"], from = comb.from.map(unit), to = gather && unit(gather);
  const sourceOf = q => {
    let source = from[0];
    if (from.length > 1) {
      let best = -2;
      for (let i = 0; i + 1 < from.length; i++) { const p = onArc(q, from[i], from[i + 1]), near = dot(p, q); if (near > best) { best = near; source = p; } }
    }
    return source;
  };
  const flow = q => {
    const source = sourceOf(q), away = sub(q.map(x => x * dot(q, source)), source), far = length(away);
    const forward = tangent(q, [0, 0, 1]), down = tangent(q, [0, -1, 0]), rear = tangent(q, [0, 0, -1]);
    let top = far > 1e-4 ? away.map(x => x / far) : forward;
    top = unit(add(top, forward, comb.forward * smooth(.1, .6, q[1])));
    // Below the widest part of the head hair hangs, and on the sides it is brushed a little to the rear.
    const low = unit(add(down, rear, comb.back * Math.abs(q[0]))), hang = smooth(40 * DEG, 12 * DEG, Math.asin(clamp(q[1], -1, 1)));
    let lie = tangent(q, [mix(top[0], low[0], hang), mix(top[1], low[1], hang), mix(top[2], low[2], hang)]);
    if (to) { const pull = sub(to, q); lie = length(pull) > .05 ? tangent(q, pull) : down; }
    // Hair never lies in perfectly even rows.
    const turn = .5 * (noise3(q[0] * 5 + 11, q[1] * 5, q[2] * 5) - .5) + .3 * (noise3(q[0] * 17, q[1] * 17 + 5, q[2] * 17) - .5), side = cross(q, lie);
    return unit(add(lie.map(x => x * Math.cos(turn)), side, Math.sin(turn)));
  };
  /** The angle in radians from a direction to where the combing starts. Hair there fans out in every direction. */
  flow.reach = q => Math.acos(clamp(dot(q, to ?? sourceOf(q)), -1, 1));
  return flow;
}

// ---------------------------------------------------------------------------------------------
// The strand artwork

let artwork = null;
// Tufts sit in a 256 pixel square: four long ones above two rows of four short ones.
// The last short place holds unbroken combed hair, for hair seen in the mass under the cards.
const TILES = { long: Array.from({ length: 4 }, (_, i) => [i * 64, 0, 64, 128]), short: Array.from({ length: 7 }, (_, i) => [(i % 4) * 64, 128 + Math.floor(i / 4) * 64, 64, 64]), solid: [192, 192, 64, 64] };
/** The places of the strand picture: `long` and `short` tufts and the `solid` tile, each [left, top, wide, tall] in pixels of 256. */
export const tuftTiles = TILES;

/**
 * Strands drawn as pixels: `data` is RGBA, rows from the top, with tips up and roots down in every
 * tile. The colour is a grey that the hair colour is multiplied by; the alpha is the strands.
 */
export function tuftPixels() {
  if (artwork) return artwork;
  const size = 256, data = new Uint8ClampedArray(size * size * 4);
  const draw = ([left, top, wide, tall], seed, { strands, thick, reach, ragged, locks = 3 }) => {
    const rows = [];
    // Strands gather into a few locks towards their tips. A lock keeps its point when the picture is drawn small,
    // where single strands would run together into a block.
    const points = Array.from({ length: locks }, (_, i) => 7 + (wide - 14) * (i + .25 + .5 * hash1(seed * 53 + i)) / locks);
    for (let s = 0; s < strands; s++) {
      const rnd = n => hash1(seed * 977 + s * 31 + n), x0 = 5 + (wide - 10) * (s + .15 + .7 * rnd(1)) / strands;
      const to = points.reduce((best, x) => Math.abs(x - x0) < Math.abs(best - x0) ? x : best), far = Math.abs(to - x0) / (wide / locks);
      // The strand in the middle of a lock is its longest.
      rows.push({ x0, to, root: ragged * rnd(2) * rnd(3), tip: 1 - reach * clamp(.25 * rnd(4) + 1.5 * far) ** 1.3, lean: (rnd(5) - .5) * 5, wave: 1.2 * rnd(6), phase: TAU * rnd(7), turns: .7 + 1.5 * rnd(8), thick: thick * (.75 + .5 * rnd(9)), tone: (.42 + .58 * rnd(10)) * (.84 + .16 * hash1(seed * 71 + Math.round(to))) });
    }
    for (let y = 0; y < tall; y++) {
      // 0 at the root, 1 at the tip.
      const t = 1 - (y + .5) / tall, centres = rows.map(r => mix(r.x0, r.to, .8 * smooth(.3, 1, t)) + r.lean * t * t * (1 - t) * 2 + r.wave * Math.sin(r.phase + r.turns * Math.PI * t) * (1 - .6 * t));
      for (let x = 0; x < wide; x++) {
        let cover = 0, tone = 0, near = Infinity, nearTone = .8;
        rows.forEach((r, i) => {
          const along = (t - r.root) / (r.tip - r.root), far = Math.abs(x + .5 - centres[i]);
          if (along > -.15 && along < 1.1 && far < near) { near = far; nearTone = r.tone; }
          if (along <= 0 || along >= 1) return;
          // A strand starts fine, is fullest low down and thins to its tip.
          const half = r.thick * smooth(0, .1, along) * mix(1, .32, along ** 1.4), c = clamp(half - far + .5);
          // A strand is darker along its edges, where the next one shades it.
          if (c > cover) { cover = c; tone = r.tone * (.74 + .26 * clamp((half - far) / 1.2)); }
        });
        // Tones are amounts of light, stored the way a picture stores them, so a card is as bright as the roots under it.
        const shade = ((cover > 0 ? tone : nearTone) * (.8 + .2 * t)) ** (1 / 2.2), at = ((top + y) * size + left + x) * 4, edge = x < 2 || x >= wide - 2 || y < 1 || y >= tall - 1;
        data[at] = data[at + 1] = data[at + 2] = Math.round(255 * shade);
        // A faint alpha next to every strand keeps its colour when the picture is filtered or redrawn.
        data[at + 3] = edge ? 0 : Math.max(Math.round(255 * cover), near < 3.5 ? 14 : 0);
      }
    }
  };
  TILES.long.forEach((tile, i) => draw(tile, 3 + i, { strands: 19, thick: 2.3, reach: .4, ragged: .1, locks: 2 + i % 2 }));
  TILES.short.forEach((tile, i) => draw(tile, 40 + i, { strands: 20, thick: 2.2, reach: .62, ragged: .3, locks: 2 + i % 2 }));
  {
    // Unbroken hair: streaks of tone that run the way the strands do, with no gaps.
    const [left, top, wide, tall] = TILES.solid;
    for (let x = 0; x < wide; x++) {
      const fine = hash1(9001 + x), broad = noise3(x / 5.5 + 3, .5, 7.5);
      for (let y = 0; y < tall; y++) {
        const at = ((top + y) * size + left + x) * 4, tone = clamp(.52 + .3 * broad + .2 * fine + .06 * (noise3(x / 3, y / 19, 2.5) - .5), .3, 1);
        data[at] = data[at + 1] = data[at + 2] = Math.round(255 * tone ** (1 / 2.2));
        // The same clear gutter as every tuft has.
        data[at + 3] = x < 1 || x >= wide - 1 || y < 1 || y >= tall - 1 ? 0 : 255;
      }
    }
  }
  return artwork = { width: size, height: size, data };
}

let tuftTexture = null;
/** The strand picture as a texture, shared by every groom and by facial hair. */
export function tuftMap() {
  if (tuftTexture) return tuftTexture;
  const { width, height, data } = tuftPixels();
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    canvas.getContext("2d").putImageData(new ImageData(data, width, height), 0, 0);
    tuftTexture = new T.CanvasTexture(canvas);
  } else {
    // Without a page the same pixels are used directly, turned over as a canvas would be.
    const turned = new Uint8Array(data.length);
    for (let y = 0; y < height; y++) turned.set(data.subarray(y * width * 4, (y + 1) * width * 4), (height - 1 - y) * width * 4);
    tuftTexture = new T.DataTexture(turned, width, height, T.RGBAFormat);
    tuftTexture.magFilter = T.LinearFilter; tuftTexture.minFilter = T.LinearMipmapLinearFilter; tuftTexture.generateMipmaps = true;
    tuftTexture.needsUpdate = true;
  }
  tuftTexture.name = "Hair tufts";
  tuftTexture.colorSpace = T.SRGBColorSpace;
  tuftTexture.anisotropy = 4;
  return tuftTexture;
}

// ---------------------------------------------------------------------------------------------
// The groom

/**
 * The geometry of a groom as plain arrays.
 *   roots   {position, normal, color, index, bones, weights}    the layer under the cards
 *   cards   the same with `uv`                                   the strands
 * `budget` is the triangle allowance of a game model; 0 builds full detail.
 */
export function groomGeometry(surface, style, { skin = "#96735d", budget = 0, tucked = false } = {}) {
  const spec = SPECS[style.hair] ?? (budget > 0 ? COILS[style.hair] : null);
  if (!spec) return null;
  const body = surfaceBody(surface), f = surfaceFrame(surface), k = f.k, mm = k / 1000, ears = measureEars(body, f), lines = ears.sides.map(e => sideLine(e, spec));
  const lengths = spec.lengths ? hairLengths(body, landmarks(body), style.hair, style) : null;
  // Hair cut all round falls from its crown. Longer hair parts along a line from the forehead over the top of the head.
  const pole = lengths?.pole && unit(lengths.pole), parting = spec.locks ? lockParting(spec.locks, style.fringe) : !pole ? null : lengths.sheets[0].around ? [pole] : [aimAt(Math.atan2(pole[0], pole[2]) * .6, 30 * DEG), pole, unit([pole[0] * .5, .8, -.58])];
  const look = spec.comb ?? (COMBS[style.fringe] ? style.fringe : "As cut"), flow = combing(look, { parting, gather: lengths?.gather ?? spec.swept?.gather }), scalp = scalpMap(body, f, ears);
  const hair = new T.Color(style.hairColor ?? "#48372e"), tone = new T.Color(skin);
  // Each hairline as points half a degree apart, to measure how far any direction is from it.
  const traced = lines.map((line, side) => { const points = new Float32Array(361 * 3); for (let i = 0; i <= 360; i++) points.set(aimAt((side ? -1 : 1) * i / 2 * DEG, line(i / 2) * DEG), i * 3); return points; });
  /** The angle in degrees from a direction to the hairline; negative outside it. */
  const margin = (phi, eps) => {
    const side = phi > 0 ? 0 : 1, points = traced[side], q = aimAt(phi, eps);
    let near = -1;
    for (let i = 0; i < points.length; i += 3) { const d = q[0] * points[i] + q[1] * points[i + 1] + q[2] * points[i + 2]; if (d > near) near = d; }
    const lower = Math.acos(Math.min(1, near)) / DEG * (eps / DEG >= lines[side](Math.abs(phi) / DEG) ? 1 : -1);
    if (!spec.openCrown) return lower;
    // The temporal fringe follows the ear. At the occiput it meets the
    // higher rear hairline, leaving one continuous area of exposed crown.
    const upper = 30 - 27*q[2] - 41*Math.max(0, q[2]) + 2.1*q[0] - eps/DEG;
    return Math.min(lower, upper);
  };
  const world = q => unit([q[0] * f.radii[0], q[1] * f.radii[1], q[2] * f.radii[2]]);
  // `out` is the depth of a volume of curls here: it stands straight out from the middle of the head, as a ball does.
  const seat = (q, h, out = 0) => { const u = world(q), at = scalp(u), r = at.r + out; return { p: [f.centre[0] + u[0] * r + at.n[0] * h, f.centre[1] + u[1] * r + at.n[1] * h, f.centre[2] + u[2] * r + at.n[2] * h], n: out ? unit(add(at.n, u, 1)) : at.n, v: at.v }; };
  /**
   * How far a volume of curls stands off the head at a direction `at` and an angle `far` from the hairline, in metres.
   * This is the smooth mass; its clumps rise and sink round it (see human-hair-clumps.js).
   */
  const volume = (at, far) => {
    if (!spec.volume) return 0;
    const rise = clamp(far / spec.rim), lumps = 1 + .22 * (noise3(at.q[0] * 8 + 4, at.q[1] * 8, at.q[2] * 8) - .5) * smooth(.3, 1, rise);
    return Math.max(0, spec.volume(at, f) * mm * lumps * (spec.round ? smooth(0, 1, rise) ** .6 : smooth(0, 1, rise)));
  };
  /**
   * Light and dark locks: fine noise gathered along the line hair is combed in, so a lock keeps its
   * tone from card to card and differs from the lock beside it. About -1 to 1.
   */
  const lock = q => {
    let sum = 0, a = q, b = q;
    for (let i = 0; i < 5; i++) {
      sum += noise3(a[0] * 46 + 5, a[1] * 46, a[2] * 46) + noise3(b[0] * 46 + 5, b[1] * 46, b[2] * 46);
      a = unit(add(a, flow(a), .055)); b = unit(add(b, flow(b), -.055));
    }
    return clamp((sum / 10 - .5) * 5.5, -1, 1);
  };
  /** Hair length and how far it stands off the head, in metres, at a direction and a distance from the hairline. */
  const cutAt = (q, phi, far) => {
    const eps = Math.asin(clamp(q[1], -1, 1)), top = smooth(14 * DEG, 46 * DEG, eps), front = smooth(.15, .85, q[2]) * smooth(.35, .8, q[1]);
    // Across the forehead and round the temples the hairline is a clean edge; lower down it is a taper.
    const forehead = spec.openCrown ? 0 : smooth(4 * DEG, 18 * DEG, eps);
    const full = mix(spec.side, spec.top * (1 + spec.front * front), top);
    // The taper: shortest at the hairline round the sides and the back, but not across the forehead.
    const len = mix(mix(spec.edge, full, smooth(0, spec.fade, far)), full, forehead) * mm;
    // Colour fades into the skin over the last few millimetres only; the taper itself is in the length.
    // The temple is a narrow wedge between two hairlines, so its fade is narrower than the one at the nape.
    const fade = spec.openCrown ? mix(6, 14, smooth(0, 18 * DEG, eps)) : mix(5.5, 3, smooth(0, 14 * DEG, eps));
    const cover = mix(smooth(0, fade, far) ** .8, smooth(-.5, 2.5, far), forehead);
    const lift = len * mix(.55, spec.lay, smooth(.004 * k, .018 * k, len));
    // The roots stay under every card: only a little off the skin, and less still at the hairline.
    // A game model thins the skin and the roots separately, so the roots keep at least two millimetres over it inside the hairline.
    return { len, lift, under: .0005 * k + clamp(.2 * lift, .0022 * k, .004 * k) * smooth(1.5, 9, far), top, forehead, cover, fade };
  };

  // Curls are one sculpted mass of clumps: it is the scalp cover, the body and the outline of the hair at once.
  if (spec.curl) {
    const mass = clumpVolume({ spec, f, k, body, margin, cutAt, seat, volume, hair, tone });
    return { roots: mass, cards: { position: [], normal: [], color: [], uv: [], index: [], bones: [], weights: [] }, look, ties: [], curls: spec.curl };
  }
  // The roots: scalp inside the hairline, lifted a little, coloured from skin to hair.
  const roots = { position: [], normal: [], color: [], index: [], bones: [], weights: [] };
  if (spec.swept) roots.uv = [];
  {
    const wear = body.weight(/^(head|neck)/);
    let s = bodyShell(body, { wear });
    s.f.line = new Array(s.count).fill(-1);
    for (let i = 0; i < s.count; i++) {
      if (s.f.wear[i] < .5 || ears.mark[i]) continue;
      const at = f.aim(s.anchor(i));
      s.f.line[i] = margin(at.phi, at.eps) + (spec.swept ? 3.5 : -1.6) + 1.5 * (noise3(at.q[0] * 21 + 3, at.q[1] * 21, at.q[2] * 21) - .5);
    }
    s = cut(s, i => s.f.line[i]);
    s = connected(s, [0, f.top, f.centre[2]]);
    s = subdivide(s);
    for (let i = 0; i < s.count; i++) {
      const a = s.anchor(i), at = f.aim(a), far = Math.max(0, margin(at.phi, at.eps)), here = cutAt(at.q, at.phi, far), n = s.normal(i);
      const p = add(add(a, n, here.under + (spec.swept ? mm * (1.2 + 2.2 * smooth(0, 12, far)) : 0)), unit(sub(a, f.centre)), volume(at, far));
      roots.position.push(p[0], p[1], p[2]); roots.normal.push(n[0], n[1], n[2]);
      // Streaks along the combing direction, darker where the hair is deep.
      // Under locks the roots are as dark as the strand picture makes the locks, so where a lock begins does not show.
      if (spec.swept) {
        const edge = lines[at.phi > 0 ? 0 : 1](Math.abs(at.phi) / DEG);
        const boundary = edge - 6;
        const radius = .495 * clamp((90 - at.eps / DEG) / Math.max(1, 90 - boundary));
        roots.uv.push(.5 + radius * Math.sin(at.phi), .5 + radius * Math.cos(at.phi));
      }
      const shade = (.66 + .16 * lock(at.q)) * mix(1, .88, here.top) * (spec.swept || spec.locks ? .8 : 1), solid = clamp(.15 + .85 * here.cover);
      if (spec.swept) roots.color.push(1, 1, 1);
      else roots.color.push(mix(tone.r, hair.r * shade, solid), mix(tone.g, hair.g * shade, solid), mix(tone.b, hair.b * shade, solid));
      const [bones, weights] = s.skin(i);
      roots.bones.push(...bones); roots.weights.push(...weights);
    }
    roots.index = s.tri.slice();
  }

  // The cards: each is rooted on the scalp and follows the combing direction.
  const cards = { position: [], normal: [], color: [], uv: [], index: [], bones: [], weights: [] };
  const wear = body.weight(/^(head|neck)/), P = body.P, game = budget > 0;
  // A first pass counts what full cover needs, so that a game model can thin it evenly.
  const plan = [];
  let wanted = 0;
  for (let t = 0; t < body.tri.length; t += 3) {
    const i = body.tri[t], j = body.tri[t + 1], c = body.tri[t + 2];
    if (wear[i] < .5 || wear[j] < .5 || wear[c] < .5 || ears.mark[i] || ears.mark[j] || ears.mark[c]) continue;
    const a = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], b = [P[j * 3], P[j * 3 + 1], P[j * 3 + 2]], d = [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]];
    const mid = [(a[0] + b[0] + d[0]) / 3, (a[1] + b[1] + d[1]) / 3, (a[2] + b[2] + d[2]) / 3], at = f.aim(mid), far = margin(at.phi, at.eps);
    if (far < -4) continue;
    const here = cutAt(at.q, at.phi, Math.max(0, far)), area = length(cross(sub(b, a), sub(d, a))) / 2;
    // Cards overlap about twice on top and thin out where the roots show the fade.
    const wide = clamp(here.len * .3, .004 * k, .0065 * k), layers = mix(1.7, 2.8, here.top) * mix(1, 1.35, here.forehead * smooth(9, 0, far));
    // A volume has more surface to cover than the scalp under it.
    const count = area * layers / (wide * Math.max(here.len, .006 * k)) * (1 + volume(at, Math.max(0, far)) / (.09 * k)) ** 2 * Math.hypot(1, (volume(at, Math.max(0, far) + 2) - volume(at, Math.max(0, far))) / (.0032 * k));
    plan.push({ a, b, d, count, t });
    wanted += count;
  }
  // Full detail carries up to 2,600 cards; a game model spends three tenths of its strand allowance here.
  // Hair that leaves the head is built first, so a game model can give the scalp what is left of its allowance.
  // Under a helmet it is tucked away and only the scalp shows.
  const hung = { position: [], normal: [], color: [], uv: [], index: [], bones: [], weights: [] };
  if (spec.swept?.tail) {
    const m = landmarks(body);
    sweptTail(hung, { gather: spec.swept.gather ?? lengths.gather, tail: spec.swept.tail, f, k, m, body, seat, skinOf: hairLengths(body, m, "Long").skin, tiles: TILES, hair, game, tucked });
  }
  if (spec.swept?.halo) lengthCards(hung, { sheets: [], tubes: haloTubes(seat, k, game), skin: body.rigid("head") }, { tiles: TILES.long, solid: TILES.solid, hair, k, centre: f.centre, game });
  if (spec.locks) {
    const m = landmarks(body);
    lockCards(hung, { locks: spec.locks, fringe: style.fringe, f, k, m, body, seat, skinOf: hairLengths(body, m, "Long").skin, tiles: TILES, hair, game, tucked });
  } else if (lengths && !tucked) lengthCards(hung, lengths, { tiles: TILES.long, solid: TILES.solid, hair, k, centre: f.centre, game });
  // Long cards over the scalp take four triangles each, short ones two or four.
  // Locks cover the scalp themselves.
  const allowed = spec.locks || spec.swept ? 0 : game ? (lengths ? Math.max(120, Math.floor((budget * .3 - hung.index.length / 3) / 4.1)) : Math.floor(budget * .3 / 2.4 * (spec.scalp ?? 1))) : Math.floor(2600 * (spec.scalp ?? 1)), thin = Math.min(1, allowed / Math.max(1, wanted)), widen = 1 / Math.sqrt(thin);
  let carry = .5, card = 0;
  for (const { a, b, d, count, t } of plan) {
    carry += count * thin;
    for (; carry >= 1; carry--) {
      const rnd = n => hash1(t * 131 + card * 17 + n);
      card++;
      let u = rnd(1), v = rnd(2);
      if (u + v > 1) { u = 1 - u; v = 1 - v; }
      const root = [a[0] + (b[0] - a[0]) * u + (d[0] - a[0]) * v, a[1] + (b[1] - a[1]) * u + (d[1] - a[1]) * v, a[2] + (b[2] - a[2]) * u + (d[2] - a[2]) * v];
      const at = f.aim(root), far = margin(at.phi, at.eps);
      if (far < 0) continue;
      // Curls turn every way: each tuft lies at its own angle to the comb.
      const here = cutAt(at.q, at.phi, far), out = volume(at, far), twist = spec.frizz ? spec.frizz * 2 * (rnd(13) - .5) : 0;
      const lie = twist ? q => { const t = flow(q), side = cross(q, t); return unit(add(t.map(x => x * Math.cos(twist)), side, Math.sin(twist))); } : flow, t0 = lie(at.q);
      // Hair thins out towards the hairline round the sides and back, where the roots carry the fade.
      // Across the forehead it grows thickly right up to the line.
      // The outermost part of the fade is left to the roots alone: a lone tuft on bare skin reads as a chip.
      if (rnd(3) > mix(smooth(.45 * here.fade, here.fade + 1.3, far) ** .7, smooth(-.3, 1, far), here.forehead)) continue;
      let len = Math.max(here.len, .0045 * k) * (.65 + .6 * rnd(4));
      // How far one radian of the head frame is on this head, here.
      const base = seat(at.q, 0), ahead = seat(unit(add(at.q, t0, .04)), 0), metre = length(sub(ahead.p, base.p)) / .04;
      // Beside an ear two surfaces lie in one direction. A strand grows only where the map is the skin its root is on.
      if (length(sub(base.p, root)) > .004 * k) continue;
      // A card may only hang a little past the hairline: more over the forehead, least round the ears.
      // The fringe ends on one gently wandering line, so its edge is strand tips and not card ends.
      const tipFar = l => { const tip = f.aim(seat(unit(add(at.q, t0, l / metre)), 0).p); return margin(tip.phi, tip.eps); };
      const over = mix(1, spec.fringe * (.55 + .45 * noise3(at.q[0] * 9 + 2, at.q[1] * 9, at.q[2] * 9)), here.forehead);
      if (!out && tipFar(len) < -over) {
        let short = 0, reach = len;
        for (let i = 0; i < 7; i++) { const mid = (short + reach) / 2; if (tipFar(mid) < -over) reach = mid; else short = mid; }
        len = Math.max(short, .12 * len);
      }
      if (len < .0025 * k) continue;
      const long = len > .009 * k, steps = game ? (len > .014 * k ? 2 : 1) : len > .014 * k ? 3 : len > .006 * k ? 2 : 1;
      const wide = clamp(len * .3, .0032 * k, .0065 * k) * (.8 + .4 * rnd(5)) * Math.min(1.5, widen) * mix(1, .75, here.forehead * smooth(6, 0, far)), lift = here.lift * Math.min(1, len / here.len) * (.6 + .4 * rnd(6)) * mix(smooth(-1, 6, far), 1, here.forehead) * mix(.35, 1, smooth(.06, .45, flow.reach(at.q)));
      const tiles = long ? TILES.long : TILES.short, tile = tiles[Math.floor(rnd(7) * tiles.length) % tiles.length], flip = rnd(8) < .5;
      // A narrow card shows a narrow part of its tile, so strands stay the same size on every card.
      const span = clamp(wide / (.0065 * k), .3, 1), start = (1 - span) * rnd(11);
      const roll = (rnd(9) - .5) * .4, tilt = .5 * (noise3(at.q[0] * 7 + 9, at.q[1] * 7, at.q[2] * 7) - .5) + .2 * (rnd(12) - .5), shade = (1 + .14 * (rnd(10) - .5)) * (1 + .24 * lock(at.q));
      // The last hairs before bare skin are fine, so they take some of its colour.
      const fine = .5 * (1 - here.forehead) * (1 - smooth(0, here.fade, far));
      const skinning = body.skinOf(base.v >= 0 ? base.v : body.nearest(root, 8)), first = cards.position.length / 3, path = [];
      let q = at.q;
      for (let step = 0; step <= steps; step++) {
        const along = step / steps;
        // A strand rises from its root and settles again towards its tip.
        path.push(seat(q, mix(here.under + .0004 * k, Math.max(lift, here.under + .0012 * k), along ** 1.25 * (1 - .35 * along ** 3)), out));
        if (step < steps) q = unit(add(q, lie(q), len / steps / metre));
      }
      // A strand stays on the scalp it grows from. One that would jump to another surface, such as an ear, is left out.
      if (path.some((station, step) => step && length(sub(station.p, path[step - 1].p)) > 1.6 * len / steps + .004 * k)) continue;
      path.forEach((station, step) => {
        const along = step / steps, run = unit(sub(path[Math.min(steps, step + 1)].p, path[Math.max(0, step - 1)].p));
        let across = unit(cross(station.n, run));
        across = unit(add(across.map(x => x * Math.cos(roll)), station.n, Math.sin(roll)));
        const half = wide * .5 * (1 - .3 * along), face = unit(add(add(cross(run, across), station.n, mix(2.4, .8, here.top)), run, tilt * (1 + here.top)));
        for (const sign of [-1, 1]) {
          const p = add(station.p, across, sign * half);
          cards.position.push(p[0], p[1], p[2]); cards.normal.push(face[0], face[1], face[2]);
          // A card starts as dark as the roots it grows from, so where it begins does not show.
          const value = shade * (.74 + .32 * along);
          cards.color.push(mix(hair.r * value, tone.r, fine), mix(hair.g * value, tone.g, fine), mix(hair.b * value, tone.b, fine));
          // Picture rows run from the tip at the top of a tile to the root at its foot.
          const x = tile[0] + 2 + (tile[2] - 4) * (((sign < 0) !== flip ? 0 : 1) * span + start), y = tile[1] + 1.5 + (tile[3] - 3) * (1 - along);
          cards.uv.push(x / 256, 1 - y / 256);
          cards.bones.push(...skinning[0]); cards.weights.push(...skinning[1]);
        }
        if (step) { const n = first + step * 2; cards.index.push(n - 2, n + 1, n - 1, n - 2, n, n + 1); }
      });
    }
  }
  const shift = cards.position.length / 3;
  for (const key of ["position", "normal", "color", "uv", "bones", "weights"]) for (const x of hung[key]) cards[key].push(x);
  for (const i of hung.index) cards.index.push(i + shift);
  return { roots, cards, look, swept: spec.swept ? lines : null, ties: lengths && !tucked ? lengths.ties : [] };
}

function meshOf(part, material, name, uv = false) {
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(part.position, 3));
  g.setAttribute("normal", new T.Float32BufferAttribute(part.normal, 3));
  if (part.color) g.setAttribute("color", new T.Float32BufferAttribute(part.color, 3));
  g.setAttribute("uv", uv ? new T.Float32BufferAttribute(part.uv, 2) : new T.BufferAttribute(new Float32Array(part.position.length / 3 * 2).fill(.5), 2));
  g.setIndex(part.index);
  const mesh = new T.Mesh(g, material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.humanWeights = { weights: Float32Array.from(part.weights), boneIndices: Uint8Array.from(part.bones) };
  mesh.userData.styleRegion = "head";
  return mesh;
}

/** The meshes of a strand groom, or none when the hairstyle is not one. */
export function strandGroom(surface, style, material, plain, skinColor, gameBudget = 0, { tucked = false } = {}) {
  if (style.hair === "Buzz cut" && !plain) {
    const cropped = buzzCut(surface, style, material, skinColor);
    if (cropped) return [cropped];
  }
  const groom = groomGeometry(surface, style, { skin: skinColor, budget: gameBudget, tucked });
  if (!groom) return [];
  if (plain) { delete groom.roots.color; delete groom.cards.color; }
  const under = material("#ffffff", "hair").clone(), over = material("#ffffff", "hair").clone();
  if (!plain) {
    under.vertexColors = over.vertexColors = true;
    under.roughness = 1; over.roughness = .72;
    if (groom.curls) {
      // The picture and its relief are drawn from the same clumps the mass is built of. Built to the size a game
      // model carries, so its export keeps every clump whole.
      const drawn = clumpMaps(groom.curls);
      under.map = drawn.map; under.bumpMap = drawn.bumpMap; under.bumpScale = .003;
      under.roughness = .88;
      // The band along the hairline is cut out of the picture into fine hairs; the mass itself is whole.
      // Seen from under its edge the mass shows its inside, not the room behind it.
      under.alphaTest = .5; under.alphaToCoverage = true; under.side = T.DoubleSide;
      under.userData = { ...under.userData, hairCards: true, portrait: true, fibreLOD: true };
    }
    if (groom.swept) {
      under.map = sweptScalpTexture(groom.swept, new T.Color(skinColor), new T.Color(style.hairColor ?? "#48372e"), style.fringe === "Swept left");
      under.alphaTest = .36;
      under.roughness = .70;
      under.userData = { ...under.userData, portrait: true, hairCards: true };
    }
    if (!groom.curls) over.map = tuftMap();
    // A plain cutout, as in an exported file. Alpha to coverage breaks strands this fine into pale speckles
    // in the workshop view.
    over.alphaTest = .4;
  }
  over.side = T.DoubleSide;
  // The cards are already built to the size a game model can carry, so its export keeps every one.
  over.userData = { ...over.userData, fibreLOD: true };
  const roots = meshOf(groom.roots, under, style.hair + " roots", Boolean(groom.roots.uv));
  roots.userData.hairRoots = true;
  // Clay has no picture to cut clumps out of a card, so there the raised and sunken volume is the hair.
  if ((plain && groom.curls) || !groom.cards.index.length) {
    over.dispose();
    return [roots];
  }
  const cards = meshOf(groom.cards, over, style.hair, true);
  cards.userData.strandGroom = true;
  // The roots cast the shadow of the hair. The strands lie a few millimetres over them and add nothing
  // to it that shows, so they are left out of the shadow pass.
  cards.castShadow = false;
  // What holds tied hair is cloth, built as the earlier styles built it.
  const ties = groom.ties.filter(part => part.piece.tri.length).map(part => part.piece.mesh(material(part.tone, part.type), "head", part.name));
  return [roots, cards, ...ties];
}
