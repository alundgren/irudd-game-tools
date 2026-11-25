// Folds for cloth cut from the body. A garment arrives hanging smoothly; here it gets the broad
// creases everyday cloth shows where it is compressed or pulled: behind the knee, stacked on the
// shoe, fanning from the fork of the legs, under the seat, at the elbow, the armpit and the waist.
//
// Every fold only adds cloth outward, so none can open a way through to the skin. Its depth grows
// with the slack the drape left at that place, which is why a snug garment shows a few fine
// tension lines, a loose one deeper and wider folds, and cloth stretched over a belly stays smooth.
import { Shell, add, clamp, cross, dot, hash1, length, mergeSkin, mix, noise3, smooth, sub, unit } from "./human-style-kit.js";

const TAU = Math.PI * 2;
const wrap = angle => angle - TAU * Math.round(angle / TAU);

/**
 * One fold on a flat chart of the cloth: a ridge along a gently curved line that tapers to nothing at
 * both ends. `lean` makes one flank steeper than the other, as a fold lying over to one side is.
 * Charts are in metres on a 1.72 m figure. A fold with `turn` lies on a limb: its `u` runs around the limb.
 */
function ridge(f, u, v, spread) {
  const du = f.turn === undefined ? u - f.u : wrap(u - f.turn) * f.r, dv = v - f.v, along = du * f.c + dv * f.s, long = f.long * (.5 + .5 * spread);
  if (Math.abs(along) >= long) return 0;
  const across = -du * f.s + dv * f.c - f.curl * along * along, x = across / ((across > 0 ? f.wide * f.lean : f.wide / f.lean) * spread);
  if (Math.abs(x) >= 1) return 0;
  const a = along / long;
  return f.high * (1 - a * a) ** 1.5 * (1 - x * x) ** 2;
}
/**
 * Several folds together: where two cross, the higher one shows and the other adds a little.
 * `spread` widens every fold, which gives the ground the folds stand on.
 */
function ridges(list, u, v, spread = 1) {
  let sum = 0;
  for (const f of list) { const h = ridge(f, u, v, spread); sum += h * h * h; }
  return Math.cbrt(sum);
}
const line = (slope, o) => ({ c: Math.cos(slope), s: Math.sin(slope), ...o });

function clothNormals(s) {
  const n = new Float32Array(s.count * 3), p = s.pos;
  for (let t = 0; t < s.tri.length; t += 3) {
    const a = s.tri[t] * 3, b = s.tri[t + 1] * 3, c = s.tri[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    for (const k of [a, b, c]) { n[k] += x; n[k + 1] += y; n[k + 2] += z; }
  }
  for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
  return n;
}

/**
 * Splits every edge longer than `target(a, b, shell)` allows, a few rounds over. New points lie on the
 * curve through their neighbours instead of on the chord, so a refined tube is rounder, not only denser.
 */
export function refine(s, target, rounds = 3) {
  for (let round = 0; round < rounds; round++) {
    const n = s.count, names = Object.keys(s.f), normals = clothNormals(s), made = new Map(), out = new Shell();
    for (const key of ["pos", "anc", "nrm", "bones", "weights"]) out[key] = s[key].slice();
    for (const name of names) out.f[name] = s.f[name].slice();
    const curved = (points, dirs, a, b, d) => {
      // Half way between the chord and the two tangent planes is where a smooth curve through both ends runs.
      let ha = 0, hb = 0;
      for (let e = 0; e < 3; e++) { const half = (points[b * 3 + e] - points[a * 3 + e]) / 2; ha += half * dirs[a * 3 + e]; hb -= half * dirs[b * 3 + e]; }
      return (points[a * 3 + d] + points[b * 3 + d]) / 2 - (ha * dirs[a * 3 + d] + hb * dirs[b * 3 + d]) / 4;
    };
    const middle = (a, b) => {
      const key = a < b ? a * n + b : b * n + a;
      if (made.has(key)) return made.get(key);
      const long = Math.hypot(s.pos[a * 3] - s.pos[b * 3], s.pos[a * 3 + 1] - s.pos[b * 3 + 1], s.pos[a * 3 + 2] - s.pos[b * 3 + 2]);
      if (long <= target(a, b, s)) { made.set(key, -1); return -1; }
      made.set(key, out.count);
      for (let d = 0; d < 3; d++) { out.pos.push(curved(s.pos, normals, a, b, d)); out.anc.push(curved(s.anc, s.nrm, a, b, d)); out.nrm.push(s.nrm[a * 3 + d] + s.nrm[b * 3 + d]); }
      const at = out.nrm.length - 3, l = Math.hypot(out.nrm[at], out.nrm[at + 1], out.nrm[at + 2]) || 1;
      for (let d = 0; d < 3; d++) out.nrm[at + d] /= l;
      const pairs = [];
      for (let j = 0; j < 4; j++) pairs.push([s.bones[a * 4 + j], s.weights[a * 4 + j]], [s.bones[b * 4 + j], s.weights[b * 4 + j]]);
      const [bones, weights] = mergeSkin(pairs);
      out.bones.push(...bones); out.weights.push(...weights);
      for (const name of names) out.f[name].push((s.f[name][a] + s.f[name][b]) / 2);
      return made.get(key);
    };
    let split = 0;
    for (let t = 0; t < s.tri.length; t += 3) {
      const v = [s.tri[t], s.tri[t + 1], s.tri[t + 2]], m = [middle(v[0], v[1]), middle(v[1], v[2]), middle(v[2], v[0])], cuts = (m[0] >= 0) + (m[1] >= 0) + (m[2] >= 0);
      split += cuts;
      if (!cuts) out.tri.push(v[0], v[1], v[2]);
      else if (cuts === 3) out.tri.push(v[0], m[0], m[2], m[0], v[1], m[1], m[2], m[1], v[2], m[0], m[1], m[2]);
      else if (cuts === 1) { const e = m.findIndex(x => x >= 0), a = v[e], b = v[(e + 1) % 3], c = v[(e + 2) % 3]; out.tri.push(a, m[e], c, m[e], b, c); }
      else {
        // Two cut edges meet at one corner: that corner keeps a triangle and the rest is a quad split along its shorter diagonal.
        const e = m.findIndex(x => x < 0), a = v[e], b = v[(e + 1) % 3], c = v[(e + 2) % 3], bc = m[(e + 1) % 3], ca = m[(e + 2) % 3];
        const far = (i, j) => Math.hypot(out.pos[i * 3] - out.pos[j * 3], out.pos[i * 3 + 1] - out.pos[j * 3 + 1], out.pos[i * 3 + 2] - out.pos[j * 3 + 2]);
        out.tri.push(ca, bc, c);
        far(a, bc) < far(b, ca) ? out.tri.push(a, b, bc, a, bc, ca) : out.tri.push(a, b, ca, b, bc, ca);
      }
    }
    s = out;
    if (!split) break;
  }
  return s;
}

/**
 * Skin weights change unevenly across a joint from one vertex to the next, which is invisible on skin but
 * leaves a ragged line where cloth folds over itself. Cloth takes one even blend across the joint instead,
 * no wider than the skin's own, so it folds along a clean line and stays outside the skin.
 */
function evenJoint(s, body, field, upper, lower, { half = .2, amount = 1 } = {}) {
  for (const side of ["l", "r"]) {
    const a = body.bone(upper + "_" + side), b = body.bone(lower + "_" + side), sign = side === "l" ? 1 : -1;
    for (let i = 0; i < s.count; i++) {
      const t = s.f[field][i];
      if (s.anc[i * 3] * sign <= 0 || t < 1 - half || t > 1 + half) continue;
      let wa = 0, wb = 0;
      for (let j = i * 4; j < i * 4 + 4; j++) { if (s.bones[j] === a) wa += s.weights[j]; else if (s.bones[j] === b) wb += s.weights[j]; }
      const both = wa + wb;
      if (both < .5) continue;
      const share = mix(wb / both, smooth(1 - half, 1 + half, t), amount), pairs = [[a, both * (1 - share)], [b, both * share]];
      for (let j = i * 4; j < i * 4 + 4; j++) if (s.bones[j] !== a && s.bones[j] !== b) pairs.push([s.bones[j], s.weights[j]]);
      const [bones, weights] = mergeSkin(pairs);
      for (let j = 0; j < 4; j++) { s.bones[i * 4 + j] = bones[j]; s.weights[i * 4 + j] = weights[j]; }
    }
  }
}

/**
 * Refines a draped garment and raises its folds. Returns the new shell.
 *   upper      the garment has a body and sleeves; lower, it has legs. Coveralls have both
 *   ease       the garment's room over the body, metres before scaling
 *   legEnd     where legs end (1 knee, 2 ankle); sleeveEnd the same along the arm
 *   low        lower edge height of a top
 *   amount     scales every fold; 0 leaves the cloth smooth
 *   size       scales fold width and spacing; heavy cloth folds wider
 *   seed       makes two garments on one body fold differently
 *   detail     scales how finely folded cloth is meshed
 */
export function crease(s, body, m, { upper = true, lower = false, waistband = m.waistband, ease = .008, legEnd = 2, sleeveEnd = .5, low = null, amount = 1, size = 1, seed = 0, gap = .004, detail = 1 } = {}) {
  const k = m.k, snug = smooth(.0025, .008, ease), loose = smooth(.007, .018, ease), wide = size * mix(.9, 1.5, loose), bulk = 1 + 1.3 * loose, floor = Math.max(gap * 1.2, ease * .45) + .0005;
  if (amount <= 0 || snug <= 0) return s;
  const hem = low ?? waistband, middle = mix(m.waist, m.chest[1], .25), centre = m.chest[2];
  const sides = ["l", "r"].map(name => {
    const j = bone => body.joint(bone + "_" + name), hip = j("thigh"), knee = j("calf"), ankle = j("foot"), shoulder = j("upperarm"), elbow = j("lowerarm"), wrist = j("hand"), sign = name === "l" ? 1 : -1;
    const frame = (from, to) => {
      const a = unit(sub(to, from)), e1 = unit(sub([0, 0, 1], [a[0] * a[2], a[1] * a[2], a[2] * a[2]]));
      let e2 = sub([0, -1, 0], [a[0] * -a[1], a[1] * -a[1], a[2] * -a[1]]);
      e2 = sub(e2, [e1[0] * dot(e2, e1), e1[1] * dot(e2, e1), e1[2] * dot(e2, e1)]);
      return { from, a, e1, e2: length(e2) > .3 ? unit(e2) : unit(cross(e1, a)) };
    };
    const salt = seed * 31 + (name === "l" ? 17 : 91);
    let draws = 0;
    // Every fold is placed by its own draws, so the two sides of one garment never mirror each other.
    const r = (a = 0, b = 1) => mix(a, b, hash1(salt * 131 + ++draws * 7 + 3)), flip = () => r() < .5 ? -1 : 1;
    const side = { sign, hip, knee, ankle, shoulder, thigh: length(sub(knee, hip)), calf: length(sub(ankle, knee)), upper: length(sub(elbow, shoulder)), fore: length(sub(wrist, elbow)), arms: [frame(shoulder, elbow), frame(elbow, wrist)], salt };
    /** Compressed cloth at a joint folds in a zigzag: ridges of alternating slant stacked along the limb. */
    const zigzag = (count, turn, radius, step, long, broad) => {
      const first = flip();
      return Array.from({ length: count }, (_, n) => line(first * (n % 2 ? 1 : -1) * r(.2, .5), {
        turn: turn + r(-.2, .2) + first * (n % 2 ? .13 : -.13), r: radius, v: (n - (count - 1) / 2 + r(-.2, .2)) * step, long: long * r(.8, 1.15), wide: broad * r(.85, 1.2),
        lean: r(.8, 1.25), curl: r(-2, 2), high: r(.7, 1) * (1 - .22 * Math.abs(n - (count - 1) / 2)),
      }));
    };
    /** Spare length settles above an edge in crescents that spiral round the limb. */
    const stack = (count, radius, step, long, broad, first) => {
      const start = first + r(-.5, .5), way = flip();
      return Array.from({ length: count }, (_, n) => line(r(-.25, .25), {
        turn: start + way * n * r(2, 2.7), r: radius, v: .02 + (n + r(-.15, .15)) * step, long: long * r(.8, 1.2), wide: broad * r(.85, 1.2), lean: r(.7, 1.4), curl: r(-3, 3), high: r(.75, 1) * (1 - .14 * n),
      }));
    };
    /** Tension lines fanning out of one point. */
    const fan = (angles, from, long, broad) => angles.map(angle => {
      const a = angle + r(-.08, .08), half = long * r(.75, 1.2) / 2;
      return line(a, { u: from[0] + Math.cos(a) * (.022 + half), v: from[1] + Math.sin(a) * (.022 + half), long: half, wide: broad * r(.85, 1.15), lean: r(.7, 1.4), curl: r(-1.5, 3), high: r(.6, 1) });
    });
    // Loose cloth gathers in fewer, broader folds than snug cloth.
    side.knee0 = zigzag(loose > .6 ? 2 : loose > .2 ? 3 : 4, Math.PI + .25, .07, .04 * wide, .07 * Math.sqrt(wide), .024 * wide);
    side.kneecap = [line(r(-.15, .15), { turn: r(-.15, .15), r: .07, v: -.055 + r(-.008, .008), long: r(.045, .055), wide: .024 * wide, lean: 1.4, curl: r(2.5, 4), high: 1 })];
    side.cuff = stack(legEnd > 1.99 ? 4 : 3, .05, .036 * wide, .07, .022 * wide, 0);
    side.whiskers = fan(r() < .5 ? [-.15, .16, .46, .8] : [-.05, .3, .66], [.026, .004], .12, .016 * wide);
    side.seat = [line(r(-.12, .12), { u: r(-.01, .02), v: r(-.014, .006), long: r(.065, .085), wide: r(.024, .03) * wide, lean: 1.4, curl: r(1.5, 3.5), high: 1 }),
      line(r(-.15, .15), { u: r(-.04, 0), v: -.05 * wide + r(-.006, .006), long: r(.04, .06), wide: .022 * wide, lean: 1.2, curl: r(1, 3), high: .65 })];
    side.drag = r() < .8 ? [line(Math.PI / 2 + r(.25, .55), { turn: r(.2, .9), r: .08, v: r(-.27, -.17), long: r(.09, .13), wide: r(.026, .032) * wide, lean: r(.7, 1.4), curl: r(-1, 1), high: 1 })] : [];
    side.swags = [0, 1].map(n => line(r(-.2, .2), { turn: sign * (1.75 + r(-.25, .25)), r: .15, v: n ? -.065 * wide + r(-.008, .008) : r(0, .03), long: r(.08, .12), wide: r(.028, .036) * wide, lean: 1.3, curl: r(1.2, 2.5), high: n ? .7 : 1 }))
      .filter(f => middle + f.v * k > hem + .04 * k);
    side.small = sign > 0 && hem < m.waistband - .03 * k ? [line(r(-.15, .15), { turn: Math.PI + r(-.3, .3), r: .15, v: (hem - middle) / k + .065 + r(-.01, .01), long: r(.07, .1), wide: .03 * wide, lean: 1.3, curl: r(1.5, 2.5), high: .7 })] : [];
    side.pit = [fan([-.25, -.7, -1.15], [.02, 0], .11, .016 * wide), fan([-.6], [.02, 0], .1, .018 * wide)];
    side.head = [0, 1].map(n => line(r(.25, .55), { turn: Math.PI / 2 + .4 + r(-.25, .25), r: .05, v: .05 + n * .04 * wide + r(-.008, .008), long: r(.04, .055), wide: r(.018, .022) * wide, lean: 1.3, curl: r(-2, 2), high: n ? .7 : 1 }));
    side.elbow = zigzag(3, .35, .045, .033 * wide, .048 * Math.sqrt(wide), .019 * wide);
    side.wrist = stack(loose > .5 ? 3 : 2, .036, .032 * wide, .048, .019 * wide, Math.PI / 2);
    return side;
  });
  const of = i => sides[s.anc[i * 3] >= 0 ? 0 : 1];
  /** Angle around the leg: 0 at the front, a quarter turn at the outside, half a turn at the back. */
  const legAngle = i => {
    const side = of(i), t = s.f.leg[i], q = t < 1 ? clamp(t) : clamp(t - 1), from = t < 1 ? side.hip : side.knee, to = t < 1 ? side.knee : side.ankle;
    return Math.atan2((s.anc[i * 3] - mix(from[0], to[0], q)) * side.sign, s.anc[i * 3 + 2] - mix(from[2], to[2], q));
  };
  /** Angle around the arm: 0 at the front, a quarter turn underneath, half a turn at the back. */
  const armAngle = i => {
    const side = of(i), f = side.arms[s.f.arm[i] < 1 ? 0 : 1], d = sub(s.anchor(i), f.from);
    return Math.atan2(dot(d, f.e2), dot(d, f.e1));
  };
  // Slack is the room between the cloth and the closest it may lie to the skin: about half the garment's ease,
  // since loose cloth rests on the body in places. It is averaged over neighbours, because folds that took
  // their depth from one vertex at a time would roughen the cloth.
  let slack = null;
  const measure = () => {
    let now = Float32Array.from({ length: s.count }, (_, i) => Math.max(0, dot(sub(s.at(i), s.anchor(i)), s.normal(i)) / k - floor));
    for (let pass = 0; pass < 4; pass++) {
      const sum = new Float32Array(s.count), links = new Uint16Array(s.count);
      for (let t = 0; t < s.tri.length; t += 3) for (let e = 0; e < 3; e++) { const a = s.tri[t + e], b = s.tri[t + (e + 1) % 3]; sum[a] += now[b]; links[a]++; }
      now = now.map((x, i) => links[i] ? (x + sum[i] / links[i]) / 2 : x);
    }
    slack = now;
  };
  const slackAt = i => slack[i];
  const drift = i => noise3(s.anc[i * 3] / (.13 * k) + seed, s.anc[i * 3 + 1] / (.13 * k), s.anc[i * 3 + 2] / (.13 * k)) - .5;

  // Folds at one vertex, in metres on a 1.72 m figure. Snug cloth raises a crest by `out`. Cloth with slack also sinks
  // by up to `into` around each crest, towards the body, so loose cloth gathers instead of only swelling.
  function tally() {
    const sum = { high: 0, sink: 0, deep: 0 };
    sum.fold = (out, into, list, u, v) => {
      const shape = ridges(list, u, v), ground = into > 0 ? ridges(list, u, v, 2.6) : 0;
      if (shape <= 0 && ground <= 0) return;
      sum.high += out * shape; sum.sink += into * Math.max(0, ground - shape);
      sum.deep = Math.max(sum.deep, (out + into) * Math.min(1, 3 * Math.max(shape, ground * .4)));
    };
    return sum;
  }
  function trousers(i) {
    const side = of(i), t = s.f.leg[i], x = Math.abs(s.anc[i * 3]) / k, y = s.anc[i * 3 + 1], nz = s.nrm[i * 3 + 2], slack = slackAt(i), inner = -s.nrm[i * 3] * side.sign, sum = tally();
    const open = 1 - smooth(.25, .65, inner) * smooth(1.1, .7, t);
    // Whiskers: tension lines from the fork of the legs towards the hips.
    if (nz > .1 && t < .6) { const on = smooth(.1, .45, nz) * open; sum.fold(on * Math.min(.008, .005 * snug * mix(1, .55, loose) + .12 * slack), on * Math.min(.006 * bulk, .4 * slack), side.whiskers, x, (y - m.crotch) / k); }
    // Under the seat: smile lines where the cloth leaves the seat for the back of the thigh.
    if (nz < -.1 && t < .6) { const on = smooth(.1, .5, -nz) * open; sum.fold(on * Math.min(.009, .004 * snug + .15 * slack), on * mix(1, .5, loose) * Math.min(.012, .5 * slack), side.seat, x - Math.abs(side.hip[0]) / k, (y - m.crotch) / k); }
    if (t > .3 && legEnd > 1.25) {
      const angle = legAngle(i), h = (t - 1) * (t < 1 ? side.thigh : side.calf) / k;
      sum.fold(Math.min(.01, .0058 * snug + .12 * slack), loose * Math.min(.009, .6 * slack), side.knee0, angle, h);
      sum.fold(Math.min(.005, .0026 * snug + .1 * slack), 0, side.kneecap, angle, h);
      sum.fold(open * Math.min(.006, .002 * snug + .12 * slack), open * Math.min(.008, .5 * slack), side.drag, angle, h);
      // Stacking: the length left over at the ankle.
      if (legEnd > 1.75) { const above = (Math.min(legEnd, 2.02) - t) * side.calf / k, edge = mix(.35, 1, smooth(0, .016, above)); sum.fold(edge * Math.min(.012, (.0045 + .005 * smooth(1.9, 2.02, legEnd)) * snug + .15 * slack), edge * Math.min(.014 * bulk, .7 * slack), side.cuff, angle, above); }
    }
    if (t > .2 && slack > 0) {
      // Loose legs hang in long soft valleys instead of one smooth tube.
      const phase = 2.7 * legAngle(i) + 1.1 * Math.sin(2.3 * t + TAU * hash1(side.salt)) + 1.5 * drift(i) + TAU * hash1(side.salt + 1);
      sum.sink += smooth(.3, .75, t) * open * Math.min(.014 * loose + .002, .45 * slack) * (.5 - .5 * Math.cos(phase));
    }
    return sum;
  }
  function top(i) {
    const side = of(i), y = s.anc[i * 3 + 1], x = s.anc[i * 3], nz = s.nrm[i * 3 + 2], armed = s.f.wArm[i], slack = slackAt(i), calm = s.f.calm?.[i] ?? 0, sum = tally();
    const around = Math.atan2(x, s.anc[i * 3 + 2] - centre), trunk = 1 - smooth(.25, .6, armed);
    if (trunk > 0) {
      // Whatever is worn under a top reaches up to the waistband, so cloth only sinks above it.
      const free = smooth(m.waistband + .02 * k, m.waistband + .07 * k, y), v = (y - middle) / k, on = trunk * (1 - .8 * calm);
      // The waist: between the chest and the seat the cloth sags in a couple of swags, lowest at the side.
      sum.fold(on * Math.min(.007, .0012 * snug + .2 * slack), on * free * Math.min(.008, .5 * slack), side.swags, around, v);
      sum.fold(on * Math.min(.007, .0012 * snug + .25 * slack), 0, sides[0].small, around, v);
      // The armpit: tension lines fan from under the arm across the chest and the shoulder blade.
      const pit = trunk * (1 - .75 * calm) * smooth(.05, .3, Math.abs(nz));
      sum.fold(pit * Math.min(.006, .0034 * snug * mix(1, .6, loose) + .12 * slack), (nz > 0 ? 1 : 0) * pit * free * Math.min(.004, .3 * slack), side.pit[nz > 0 ? 0 : 1], (Math.abs(side.shoulder[0]) - .012 * k - Math.abs(x)) / k, (y - side.shoulder[1]) / k + .075);
      // A loose hem does not hang in a perfect ring.
      const wave = 2.5 * around + 1.6 * Math.sin(around + TAU * hash1(seed + 5)) + 4 * drift(i);
      sum.high += trunk * smooth(.12, 0, (y - hem) / k) * Math.min(.012 * loose + .001, .5 * slack) * (.5 - .5 * Math.cos(wave));
    }
    if (armed > .4) {
      const t = s.f.arm[i], angle = armAngle(i), on = smooth(.4, .75, armed), long = sleeveEnd > 1.25, end = Math.min(sleeveEnd, .9) * side.upper / k;
      // The sleeve head: folds run from the armpit up over the arm.
      if (t < .9) { const head = on * smooth(end - .012, end - .04, t * side.upper / k); sum.fold(head * Math.min(.007, .003 * snug + .15 * slack), head * Math.min(.009 * bulk, .6 * slack), side.head, angle, t * side.upper / k); }
      // The elbow gathers like the back of a knee, and a long sleeve stacks above its cuff.
      if (long && t > .5) sum.fold(on * Math.min(.008, .0036 * snug + .12 * slack), on * Math.min(.012 * bulk, .7 * slack), side.elbow, angle, (t - 1) * (t < 1 ? side.upper : side.fore) / k);
      if (sleeveEnd > 1.6 && t > 1.2) { const above = (Math.min(sleeveEnd, 1.98) - t) * side.fore / k, edge = on * mix(.35, 1, smooth(0, .014, above)); sum.fold(edge * Math.min(.009, .003 * snug + .15 * slack), edge * Math.min(.013 * bulk, .7 * slack), side.wrist, angle, above); }
      if (long && slack > 0) sum.sink += on * smooth(.15, .5, t) * Math.min(.018 * loose + .0015, .4 * slack) * (.5 - .5 * Math.cos(2.3 * angle + 1.2 * Math.sin(2.6 * t + TAU * hash1(side.salt + 2)) + 3 * drift(i)));
    }
    return sum;
  }
  // Coveralls are a top above the waistband and trousers below it.
  const part = i => upper && lower ? smooth(waistband - .02 * k, waistband + .04 * k, s.anc[i * 3 + 1]) : upper ? 1 : 0;
  const none = { high: 0, sink: 0, deep: 0 }, scale = k * amount;
  const folds = i => { const u = part(i), a = u > 0 ? top(i) : none, b = u < 1 ? trousers(i) : none; return [(a.high * u + b.high * (1 - u)) * scale, (a.deep * u + b.deep * (1 - u)) * scale, (a.sink * u + b.sink * (1 - u)) * scale]; };
  const coarse = .021, fine = .0095;

  if (lower && legEnd > 1.25) evenJoint(s, body, "leg", "thigh", "calf");
  if (upper && sleeveEnd > 1.25) evenJoint(s, body, "arm", "upperarm", "lowerarm", { half: .18 });
  // Cloth is refined only as far as the folds at a place need: fine where they are sharp, coarser where it lies smooth.
  for (let round = 0; round < 3; round++) {
    measure();
    s.f.fold = Array.from({ length: s.count }, (_, i) => clamp((folds(i)[1] - .0008 * k) / (.002 * k)));
    const before = s.count;
    s = refine(s, (a, b, now) => mix(coarse, fine / detail, Math.max(now.f.fold[a], now.f.fold[b])) * k * 1.3, 1);
    if (s.count === before) break;
  }
  delete s.f.fold;
  measure();
  const normals = clothNormals(s), height = new Float32Array(s.count), sink = new Float32Array(s.count);
  for (let i = 0; i < s.count; i++) { const f = folds(i); height[i] = f[0]; sink[i] = f[2]; }
  // Averaging takes the saw teeth off a ridge that runs slantwise across the triangles.
  for (const field of [height, sink, height, sink]) {
    const sum = new Float32Array(s.count), links = new Uint16Array(s.count);
    for (let t = 0; t < s.tri.length; t += 3) for (let e = 0; e < 3; e++) { const a = s.tri[t + e], b = s.tri[t + (e + 1) % 3]; sum[a] += field[b]; links[a]++; }
    for (let i = 0; i < s.count; i++) if (links[i] && (field[i] > 0 || sum[i] > 0)) field[i] = mix(field[i], sum[i] / links[i], .5);
  }
  s.f.foldMetres = new Float32Array(s.count);
  for (let i = 0; i < s.count; i++) {
    if (height[i] <= 0 && sink[i] <= 0) continue;
    // Crests stand along the cloth's own normal. Where that has turned far from the body's, the cloth is bridging a
    // hollow and its folds fade out. Cloth sinks towards the skin it hangs over and stops at the least room the
    // garment keeps, or where it already lay if that was closer.
    const own = [normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]], before = dot(sub(s.at(i), s.anchor(i)), s.normal(i)), on = smooth(.4, .75, dot(own, s.normal(i)));
    if (on <= 0) continue;
    // Both ways it moves along its own normal: far off the skin, the skin's normals differ too much from point to point.
    const facing = dot(own, s.normal(i)), p = add(s.at(i), own, (height[i] - sink[i]) * on), least = Math.min(before, floor * k), d = dot(sub(p, s.anchor(i)), s.normal(i));
    const next = d < least ? add(p, own, (least - d) / facing) : p;
    s.f.foldMetres[i] = dot(sub(next,s.at(i)), own);
    s.set(i,next);
  }
  return s;
}
