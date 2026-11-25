// Garments for the human surface. Each one is cut from the body it dresses, so
// it fits every build, keeps the body's skin weights and follows the same
// anatomical lines (mid upper arm, natural waist, ankle) on everyone.
import { Envelope, Piece, add, bodyShell, clamp, connected, cross, cut, dot, hull2, length, lift, loops, mergeSkin, mix, raycast, raycaster, reach2, relax, smooth, sub, unit } from "./human-style-kit.js";
import { crease } from "./human-style-folds.js";
import { drapeField, drapeJoints, drapes } from "./human-skirt-drape.js";

const ARMS = /^(upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)/;
const TAU = Math.PI * 2;

/** Landmarks every garment is placed against. Heights are world metres. */
export function landmarks(body) {
  const j = body.joint, k = body.scale;
  const m = {
    k, neck: j("neck_01"), head: j("head"), pelvis: j("pelvis"), chest: j("spine_03"), waist: j("spine_02")[1], belly: j("spine_01")[1],
    shoulder: j("upperarm_l")[1], shoulderWidth: j("upperarm_l")[0], hip: j("thigh_l")[1], knee: j("calf_l")[1], ankle: j("foot_l")[1],
  };
  let crotch = Infinity;
  for (let v = 0; v < body.count; v++) {
    const [x, y] = body.point(v);
    if (Math.abs(x) < .012 * k && y < m.pelvis[1] && y > m.knee) crotch = Math.min(crotch, y);
  }
  m.crotch = Number.isFinite(crotch) ? crotch : m.hip - .08 * k;
  m.waistband = mix(m.belly, m.waist, .55);
  return m;
}

function classify(s) {
  const out = { sleeves: [], legs: [], upper: null, lower: null, all: loops(s) };
  const mean = (loop, f) => loop.reduce((t, i) => t + f(i), 0) / loop.length;
  let top = -Infinity, low = Infinity;
  for (const loop of out.all) {
    if (mean(loop, i => s.f.arm[i]) > .1) { out.sleeves.push(loop); continue; }
    if (mean(loop, i => s.f.leg[i]) > .1) { out.legs.push(loop); continue; }
    const y = mean(loop, i => s.anc[i * 3 + 1]);
    if (y > top) { top = y; out.upper = loop; }
    if (y < low) { low = y; out.lower = loop; }
  }
  if (out.upper === out.lower) out.lower = null;
  return out;
}

/** A raised band along an open edge: cuffs, hems, neckbands and waistbands. It is a second layer of the cloth itself. */
export function band(piece, s, loop, { width = .02, rise = .003 } = {}) {
  if (!loop) return;
  // A turned hem or a ribbed cuff is two or three layers of cloth: it stands far enough off the cloth beside it
  // to keep its own edge and shadow when the model is seen whole or reduced for a game.
  rise = Math.max(rise * 1.4, .0042);
  const n = s.count, near = Array.from({ length: n }, () => []), far = new Float32Array(n).fill(Infinity), queue = [...loop];
  for (let t = 0; t < s.tri.length; t += 3) for (let a = 0; a < 3; a++) near[s.tri[t + a]].push(s.tri[t + (a + 1) % 3], s.tri[t + (a + 2) % 3]);
  for (const i of loop) far[i] = 0;
  // Distance over the cloth from the edge.
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    if (far[i] > width * 1.6) continue;
    for (const j of near[i]) { const d = far[i] + length(sub(s.at(i), s.at(j))); if (d < far[j] - 1e-6) { far[j] = d; queue.push(j); } }
  }
  s.f.far = Array.from(far, d => Math.min(d, 9));
  const strip = cut(s, i => width - s.f.far[i]);
  delete s.f.far;
  for (let i = 0; i < strip.count; i++) strip.set(i, add(strip.at(i), strip.normal(i), rise * (.25 + .75 * smooth(width, width * .72, strip.f.far[i])) - (strip.f.far[i] > width * .98 ? rise * .5 : 0)));
  piece.shell(strip, { thickness: rise * .8 });
}

/**
 * How far the neck of this body stands from its own axis in each direction, measured just above its base.
 * A neck opening cut by height alone lands far out on the shoulders of a body whose shoulders slope up to a
 * thick neck; measured from the neck itself it is a ring round the neck on every body.
 */
function neckColumn(body, m) {
  const k = m.k, z0 = m.neck[2], y0 = m.neck[1] + .02 * k, y1 = m.neck[1] + .06 * k, bins = 24, far = new Float32Array(bins), arm = body.weight(ARMS);
  for (let v = 0; v < body.count; v++) {
    const y = body.P[v * 3 + 1];
    if (y < y0 || y > y1 || arm[v] > .2) continue;
    const x = body.P[v * 3], z = body.P[v * 3 + 2] - z0, d = Math.hypot(x, z);
    if (d > .12 * k) continue;
    const b = Math.floor((Math.atan2(x, z) / TAU + .5) * bins) % bins;
    far[b] = Math.max(far[b], d);
  }
  const mean = far.reduce((a, b) => a + b, 0) / bins || .055 * k;
  for (let b = 0; b < bins; b++) if (!far[b]) far[b] = mean;
  const even = Float32Array.from(far, (_, b) => (far[(b + bins - 1) % bins] + 2 * far[b] + far[(b + 1) % bins]) / 4);
  return (x, z) => { const a = (Math.atan2(x, z - z0) / TAU + .5) * bins, b = Math.floor(a) % bins, t = a - Math.floor(a); return mix(even[(b + bins) % bins], even[(b + 1 + bins) % bins], t); };
}

function neckline(s, m, { height = 0, tilt = .15, bow = 8, v = 0, wide = 0, scoop = 0, scoopWidth = .075, ring = .018 }, column = null) {
  const k = m.k, base = m.neck[1] + (.035 + height) * k, z0 = m.neck[2];
  return i => {
    const x = s.anc[i * 3], y = s.anc[i * 3 + 1], z = z0 + clamp(s.anc[i * 3 + 2] - z0, -.08 * k, .075 * k);
    // The cut is highest beside the neck, lower at the nape and lowest at the throat; `wide` opens it into a boat neck.
    let f = base - tilt * (z - z0) - bow * (z - z0) ** 2 / k - wide * Math.abs(x) - y;
    // Cloth that lies on the slope of the shoulder stays, however high the slope climbs: the opening is a ring round the neck.
    if (column && !wide) f = Math.max(f, Math.min(Math.hypot(x, s.anc[i * 3 + 2] - z0) - column(x, s.anc[i * 3 + 2]) - ring * k, base + .022 * k - y));
    if (v && z > z0) f = Math.min(f, base - v * k + Math.abs(x) * 1.9 - y);
    if (scoop && z > z0 && Math.abs(x) < scoopWidth * k) f = Math.min(f, base - scoop * k * (1 - (x / (scoopWidth * k)) ** 2) - y);
    return f;
  };
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
/** Moves cloth out to at least `room` beyond another shell on the same side of the body, measured along the skin's normal. */
function outside(s, shell, room, sided = true) {
  let low = Infinity, high = -Infinity, x = 0;
  for (let i = 0; i < shell.pos.length; i += 3) { low = Math.min(low, shell.pos[i + 1]); high = Math.max(high, shell.pos[i + 1]); x += shell.pos[i]; }
  const start = .03, cast = raycaster(shell.pos, shell.tri);
  for (let i = 0; i < s.count; i++) {
    const y = s.pos[i * 3 + 1];
    if (y < low - .03 || y > high + .03 || (sided && s.anc[i * 3] * x < 0)) continue;
    const a = s.anchor(i), n = s.normal(i), hit = cast(add(a, n, -start), n) - start, d = dot(sub(s.at(i), a), n);
    // A hit far from the skin is some other part of the shell, across a gap.
    if (hit < .06 && d < hit + room) s.set(i, add(s.at(i), n, hit + room - d));
  }
}

export function garment(body, m, o = {}) {
  const k = m.k, { sleeve = .55, hem = null, leg = 2.03, waist = null, ease = .006, gap = .004, fall = .5, rise = 1.2, tension = 1, span = 2, passes = 6,
    sleeveEase = 0, sleeveFall = null, legEase = 0, taper = .06, flare = 4, extra = null, under = [], soft = 6, chestSoft = 34, keep = .85, folds = 1, over = [], below = 0 } = o;
  let s = bodyShell(body);
  const y = i => s.anc[i * 3 + 1];
  if (waist === null) {
    s = cut(s, i => sleeve - s.f.arm[i]);
    s = cut(s, neckline(s, m, o.neck ?? {}, neckColumn(body, m)));
  } else {
    s = cut(s, i => waist - y(i));
    s = cut(s, i => .5 - s.f.wArm[i]);
  }
  const low = hem === null ? null : Math.max(hem, m.crotch + .012 * k);
  s = low === null ? cut(s, i => leg - s.f.leg[i]) : cut(s, i => y(i) - low + 10 * s.f.wArm[i]);
  s = connected(s, waist === null ? m.chest : m.pelvis);
  const room = i => (ease + sleeveEase * smooth(.3, .8, s.f.wArm[i]) + legEase * smooth(.3, .8, s.f.wLeg[i]) * smooth(.1, .4, s.f.leg[i]) + (extra ? extra(y(i), i, s) : 0)) * k;
  // Cloth lies on a softened figure, so small anatomy does not print through, but never inside the real one.
  const chest = (py, pz, armed) => waist !== null ? 0 : (1 - smooth(.1, .4, armed)) * smooth(m.waist, m.chest[1], py) * smooth(m.neck[1] - .02 * k, m.neck[1] - .08 * k, py) * smooth(-.02 * k, .03 * k, pz - m.chest[2]);
  const front = i => chest(y(i), s.anc[i * 3 + 2], s.f.wArm[i]);
  if (soft) relax(s, { passes: soft, gap: -1, edge: 0, alongNormal: true });
  if (soft && waist === null) relax(s, { passes: chestSoft, gap: -1, edge: 0, hold: front, alongNormal: true });
  const figure = s.pos.slice();
  for (let i = 0; i < s.count; i++) {
    const n = s.normal(i), p = add(s.at(i), n, room(i)), d = dot(sub(p, s.anchor(i)), n), least = Math.min(gap, ease) * k * (1 - .6 * front(i));
    s.set(i, d < least ? add(p, n, least - d) : p);
  }
  // Left and right halves may meet on the centre plane but never cross it, however close to it they start.
  const apart = i => { if (s.f.wArm[i] < .3 && Math.abs(s.anc[i * 3]) > .0002 && s.pos[i * 3] * s.anc[i * 3] < 0) s.pos[i * 3] = 0; };
  for (let i = 0; i < s.count; i++) apart(i);
  const arm = body.weight(ARMS), head = body.weight(/^head/), topY = waist === null ? m.neck[1] + .04 * k : waist + .02 * k, bottom = (low ?? m.crotch - .01 * k) - (low === null ? 0 : below * k), torso = [];
  for (let v = 0; v < body.count; v++) { const py = body.P[v * 3 + 1]; if (arm[v] < .35 && head[v] < .5 && py > bottom - .04 * k && py < topY + .03 * k && chest(py, body.P[v * 3 + 2], arm[v]) < .5) torso.push(body.point(v)); }
  // Over the chest the cloth hangs from the softened figure, so it spans the breastbone and shows no points.
  if (waist === null) for (let i = 0; i < s.count; i++) if (s.f.wArm[i] < .35 && front(i) > .2) torso.push([figure[i * 3], figure[i * 3 + 1], figure[i * 3 + 2]]);
  // Layers already worn count as part of the figure this garment hangs over.
  for (const layer of under) for (let i = 0; i < layer.pos.length; i += 3) { const py = layer.pos[i + 1]; if (py > bottom - .04 * k && py < topY + .03 * k && (layer.f?.wArm?.[i / 3] ?? 0) < .35) torso.push([layer.pos[i], py, layer.pos[i + 2]]); }
  const depth = topY - bottom + .02 * k;
  // The rings keep one centre line: a centre that followed the figure would hide how far the cloth falls back under a bulge.
  const env = new Envelope([0, topY, m.chest[2]], [0, -1, 0], 0, depth, Math.round(depth / (.016 * k)), 48);
  env.fixed = true;
  env.measure(torso).taut(waist === null ? tension : 1, waist === null ? span : Math.max(span, 1.7)).hang(fall, rise).soften(waist === null ? 6 : 2);
  env.drape(s, i => (1 - smooth(.2, .6, s.f.wArm[i])) * (low === null ? smooth(m.crotch + .01 * k, m.crotch + .05 * k, y(i)) : 1), room);
  if (sleeveFall !== null && waist === null) for (const side of ["l", "r"]) {
    const root = body.joint("upperarm_" + side), end = body.joint("hand_" + side), points = [], w = body.weight(new RegExp("^(upperarm|lowerarm)_" + side));
    for (let v = 0; v < body.count; v++) if (w[v] > .5) points.push(body.point(v));
    const reach = length(sub(end, root)), sign = side === "l" ? 1 : -1;
    new Envelope(root, sub(end, root), 0, reach, Math.round(reach / (.02 * k)), 24).measure(points).taut(1).hang(sleeveFall, 1.5).soften(1)
      .drape(s, i => s.anc[i * 3] * sign > 0 ? smooth(.4, .9, s.f.wArm[i]) * smooth(.1, .4, s.f.arm[i]) : 0, room);
  }
  if (low === null) for (const side of ["l", "r"]) {
    const root = body.joint("thigh_" + side), end = body.joint("foot_" + side), w = body.weight(new RegExp("^(thigh|calf)_" + side)), points = [];
    for (let v = 0; v < body.count; v++) if (w[v] > .5) points.push(body.point(v));
    const reach = length(sub(end, root)), sign = side === "l" ? 1 : -1;
    new Envelope(root, sub(end, root), 0, reach, Math.round(reach / (.02 * k)), 32).measure(points).taut(1).hang(taper, flare).soften(1)
      .drape(s, i => s.anc[i * 3] * sign > 0 ? smooth(.3, .8, s.f.wLeg[i]) * smooth(.18, .45, s.f.leg[i]) : 0, room);
  }
  // Relaxing may span hollows but must not shrink the garment back onto the skin.
  const rest = Array.from({ length: s.count }, (_, i) => dot(sub(s.at(i), s.anchor(i)), s.normal(i)));
  for (let i = 0; i < s.count; i++) apart(i);
  // Skin in the cleft of the seat and under it faces sideways or down, not outward. A hem hanging over it bridges the
  // cleft, so cloth cut from there follows its neighbours. A gap kept along that skin would fold the cloth into the
  // centre plane or hang it as a tongue below the seat.
  const bridged = i => {
    if (low === null || s.f.wArm[i] > .3 || y(i) > m.pelvis[1] + .03 * k) return false;
    const x = s.anc[i * 3], z = s.anc[i * 3 + 2] - m.chest[2], far = Math.hypot(x, z) || 1;
    return (s.nrm[i * 3] * x + s.nrm[i * 3 + 2] * z) / far < .75;
  };
  relax(s, { passes, gap: i => bridged(i) ? -1 : Math.max(gap * k * (1 - .6 * front(i)), rest[i] * keep), apart: true });
  relax(s, { passes: 3, strength: .4, gap: i => bridged(i) ? -1 : Math.max(gap * k * (1 - .6 * front(i)), rest[i] * keep * .9), apart: true });
  const creases = typeof folds === "number" ? { amount: folds } : folds;
  if (creases && (creases.amount ?? 1) > 0) {
    s.f.calm = Array.from({ length: s.count }, (_, i) => front(i));
    s = crease(s, body, m, { upper: waist === null, lower: low === null, waistband: waist ?? m.waistband, ease: ease + (low === null && waist !== null ? legEase : 0), legEnd: leg, sleeveEnd: sleeve, low, gap, seed: Math.round(ease * 9000 + sleeve * 40 + leg * 17 + (hem ?? 0) * 60) % 89, ...creases });
    for (let i = 0; i < s.count; i++) apart(i);
  }
  if (waist === null) {
    // Fabric hangs from its neckline. Continuing the chest envelope up to
    // that cut leaves a stiff standing rim even on a scoop-neck dress.
    const belowOpening = neckline(s, m, o.neck ?? {});
    for (let i = 0; i < s.count; i++) {
      const a = s.anchor(i);
      const influence = (1 - smooth(.002*k, .075*k, belowOpening(i))) *
        (1 - smooth(.10*k, .16*k, Math.abs(a[0]))) * (1 - smooth(.08, .35, s.f.wArm[i]));
      if (!influence) continue;
      const seam = add(a, s.normal(i), clamp(room(i) * .65, .002*k, .012*k));
      const p = s.at(i);
      s.set(i, p.map((v, d) => mix(v, seam[d], influence)));
    }
  }
  for (const shell of over) outside(s, shell, .005 * k);
  // Trouser legs join in a seam a little below the body, which closes the small opening under the seat.
  if (low === null) for (let i = 0; i < s.count; i++) {
    const x = s.pos[i * 3], depth = (m.crotch + .06 * k - s.pos[i * 3 + 1]) / (.12 * k);
    const inward = -s.nrm[i * 3] * Math.sign(s.anc[i * 3]);
    if (depth < 0 || depth > 1 || inward < 0 || (s.f.wLeg[i] < .2 && inward < .3)) continue;
    const near = .024 * k * (1 - smooth(.5, 1, depth));
    s.pos[i * 3] = x * smooth(near * .6, near * 1.5, Math.abs(x));
  }
  return { s, env, room, ...classify(s) };
}

/** Rays against one or more finished shells, for placing pockets, plackets and straps on cloth. */
export function caster(shells, torsoOnly = false) {
  const list = shells.map(s => {
    if (!torsoOnly || !s.f?.wArm) return s;
    const tri = [];
    for (let t = 0; t < s.tri.length; t += 3) if (s.f.wArm[s.tri[t]] < .4 && s.f.wArm[s.tri[t + 1]] < .4 && s.f.wArm[s.tri[t + 2]] < .4) tri.push(s.tri[t], s.tri[t + 1], s.tri[t + 2]);
    return { pos: s.pos, tri };
  }).map(s => raycaster(s.pos, s.tri));
  return (origin, direction) => list.reduce((best, cast) => Math.min(best, cast(origin, direction)), Infinity);
}

/** A raised panel projected onto cloth: pockets, plackets, flaps and patches. */
export function patch(piece, cast, body, { centre, facing, across, up = [0, 1, 0], width, height, rise = .003, nx = 5, ny = 5, skin }) {
  const f = unit(facing), a = unit(across), u = unit(up), rows = [];
  let nearest = Infinity, furthest = 0;
  for (let j = -1; j <= ny + 1; j++) {
    const row = [];
    for (let i = -1; i <= nx + 1; i++) {
      const border = i < 0 || i > nx || j < 0 || j > ny;
      const x = (clamp(i, 0, nx) / nx - .5) * width + (i < 0 ? -.0015 : i > nx ? .0015 : 0), y = (clamp(j, 0, ny) / ny - .5) * height + (j < 0 ? -.0015 : j > ny ? .0015 : 0);
      const origin = add(add(add(centre, a, x), u, y), f, .3), d = cast(origin, [-f[0], -f[1], -f[2]]);
      if (!Number.isFinite(d)) return false;
      nearest = Math.min(nearest, d); furthest = Math.max(furthest, d);
      row.push(add(origin, f, -d + (border ? -.0015 : rise)));
    }
    rows.push(row);
  }
  // A ray that slipped past the edge of a limb lands on whatever lies behind it; such a panel is left out.
  if (furthest - nearest > .6 * Math.max(width, height)) return false;
  piece.loft(rows, skin ?? (p => body.skinAt(p)), { closed: false, flip: dot(cross(u, a), f) < 0 });
  return true;
}

/** A small disc lying on cloth. */
export function button(piece, cast, body, { centre, facing, radius = .006, rise = .0035 }) {
  const f = unit(facing), origin = add(centre, f, .3), d = cast(origin, [-f[0], -f[1], -f[2]]);
  if (!Number.isFinite(d)) return;
  const p = add(origin, f, -d), a = unit(cross(f, [0, 1, 0])), u = cross(a, f), skin = body.skinAt(p);
  const ring = (r, h) => Array.from({ length: 10 }, (_, i) => add(add(add(p, a, Math.cos(i / 10 * TAU) * r), u, Math.sin(i / 10 * TAU) * r), f, h));
  piece.loft([ring(radius, -.001), ring(radius, rise * .8), ring(radius * .7, rise)], skin, { capEnd: true });
}

/** A box, for buckles and clasps. `half` holds three half-extent vectors. */
export function box(piece, centre, half, skin) {
  const corner = (a, b, c) => add(add(add(centre, half[0], a), half[1], b), half[2], c);
  const flip = dot(cross(half[0], half[1]), half[2]) < 0;
  for (const [axis, sign] of [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]]) {
    const p = (u, v) => axis === 0 ? corner(sign, u, v) : axis === 1 ? corner(v, sign, u) : corner(u, v, sign);
    const q = [p(-1, -1), p(1, -1), p(1, 1), p(-1, 1)].map(x => piece.vertex(x, skin));
    (sign > 0) !== flip ? piece.tri.push(q[0], q[1], q[2], q[0], q[2], q[3]) : piece.tri.push(q[0], q[2], q[1], q[0], q[3], q[2]);
  }
}

/** The outline of whatever is worn at a height, measured around the torso. */
export function girth(body, m, shells, y, reach = .05) {
  const k = m.k, points = [];
  for (const s of shells) for (let i = 0; i < s.pos.length; i += 3) if (Math.abs(s.pos[i + 1] - y) < reach * k * 1.3 && (s.f?.wArm?.[i / 3] ?? 0) < .3) points.push([s.pos[i], s.pos[i + 1], s.pos[i + 2]]);
  const env = new Envelope([0, y + reach * k, m.pelvis[2]], [0, -1, 0], 0, 2 * reach * k, 7, 64).measure(points);
  // A waist seam is a cross-section of the cloth at this height. Taking
  // the widest vertex from adjacent rows can leave it hovering over a taper.
  const cut = shells.map(s => {
    const tri = [];
    for (let i = 0; i < s.tri.length; i += 3) {
      const a = s.tri[i], b = s.tri[i + 1], c = s.tri[i + 2];
      if (s.f?.wArm && Math.max(s.f.wArm[a], s.f.wArm[b], s.f.wArm[c]) > .35) continue;
      const ya = s.pos[3*a + 1], yb = s.pos[3*b + 1], yc = s.pos[3*c + 1];
      if (Math.max(ya, yb, yc) >= y - reach*k && Math.min(ya, yb, yc) <= y + reach*k) tri.push(a, b, c);
    }
    return { pos: s.pos, tri };
  });
  const cast = caster(cut);
  for (let row = 0; row < env.rows; row++) {
    const h = env.h1 * row / (env.rows - 1);
    for (let col = 0; col < env.cols; col++) {
      const index = row * env.cols + col, angle = col * TAU / env.cols;
      const from = Math.max(env.r[index], .05*k) + .08*k;
      const hit = cast(env.point(h, angle, from), [Math.sin(angle), 0, -Math.cos(angle)]);
      if (hit < from) env.r[index] = from - hit;
    }
  }
  return env.taut(1);
}

/** A belt over the clothes at a height, with an optional buckle. */
export function belt(piece, body, m, shells, y, { height = .034, thick = .004, buckle = true, cols = 64 } = {}) {
  const k = m.k, env = girth(body, m, shells, y), mid = .05 * k, hh = height * k / 2;
  const radius = (dy, a) => env.sample(mid + dy, a) + .0015 * k;
  const ring = (dy, dr) => Array.from({ length: cols }, (_, j) => {
    const a = j / cols * TAU;
    return env.point(mid + dy, a, radius(dy, a) + dr);
  });
  const t = thick * k;
  piece.loft([ring(hh, -.004 * k), ring(hh, t), ring(hh * .5, t * 1.15), ring(-hh * .5, t * 1.15), ring(-hh, t), ring(-hh, -.004 * k)], p => body.trunkAt(p));
  if (buckle) {
    const p = env.point(mid, 0, radius(0, 0) + t), s = body.trunkAt(p);
    box(piece, add(p, [0, 0, .002 * k]), [[.021 * k, 0, 0], [0, hh * 1.25, 0], [0, 0, .003 * k]], s);
  }
  return env;
}

/**
 * A skirt, tunic tail or coat tail hanging around both legs from a height.
 *   yoke  how far up the top turns in under the garment it hangs from; 0 leaves the top standing free
 */
export function skirt(body, m, { top, bottom, ease = .012, flare = .12, fold = 0, folds = 14, cols = 72, shells = [], open = 0, yoke = 0, gores = false, drape = null }) {
  const k = m.k, arm = body.weight(ARMS), points = [];
  // A draped skirt is measured a little past its hem line, which the cloth may dip below.
  const cloth = drape ? { ...drapes[drape.cloth ?? "gored"], ...drape } : null, past = cloth ? (cloth.lift + .012) * k : 0;
  for (let v = 0; v < body.count; v++) { const y = body.P[v * 3 + 1]; if (arm[v] < .3 && y < top + .04 * k && y > bottom - (cloth ? .008 : .03) * k) points.push(body.point(v)); }
  for (const s of shells) for (let i = 0; i < s.pos.length; i += 3) if (s.pos[i + 1] < top + .04 * k && s.pos[i + 1] > bottom - (cloth ? .008 : .03) * k && (s.f?.wArm?.[i / 3] ?? 0) < .3) points.push([s.pos[i], s.pos[i + 1], s.pos[i + 2]]);
  const depth = top - bottom, rows = Math.max(4, Math.round(depth / (.022 * k)));
  let env, field = null;
  if (cloth) {
    // The rings keep one centre line, so cloth that hangs straight down keeps its distance from it.
    env = new Envelope([0, top, m.pelvis[2]], [0, -1, 0], 0, depth + past, Math.round((depth + past) / (.016 * k)) + 1, cols);
    env.fixed = true;
    env.measure(points).taut(1);
    field = drapeField(env, { k, nominal: depth, seat: top - m.crotch + .05 * k, seed: Math.round(m.waist * 1013 + m.shoulderWidth * 7919 + depth * 331 + cols), ...cloth });
  } else env = new Envelope([0, top, m.pelvis[2]], [0, -1, 0], 0, depth, rows + 1, cols).measure(points).taut(1).hang(-flare, 1).soften(2);
  const pelvis = body.bone("pelvis"), sides = ["l", "r"].map(s => ({ hip: body.joint("thigh_" + s), knee: body.joint("calf_" + s), thigh: body.bone("thigh_" + s), calf: body.bone("calf_" + s) }));
  // The skin a point of the skirt hangs in front of, found by walking from the cloth towards the leg behind it.
  const behind = p => {
    const { hip, knee } = sides[(p[0] >= 0) === (sides[0].hip[0] >= 0) ? 0 : 1], t = (hip[1] - p[1]) / (hip[1] - knee[1]), up = smooth(0, .14 * k, p[1] - hip[1]);
    const core = t > 0 ? [mix(hip[0], knee[0], t), p[1], mix(hip[2], knee[2], t)] : [hip[0] * (1 - up), p[1], mix(hip[2], m.pelvis[2], up)];
    const way = sub(core, p), steps = Math.max(1, Math.ceil(length(way) / (.012 * k)));
    for (let n = 0; n <= steps; n++) {
      const q = add(p, way, n / steps), v = body.nearest(q, 1);
      // A hand hanging beside the skirt is skin too, but the skirt does not follow it.
      if (v >= 0 && arm[v] < .05 && length(sub(q, body.point(v))) < .02 * k) return v;
    }
    return body.nearest(core, 3);
  };
  // Cloth moves with the leg behind it, so a lifted thigh carries the skirt instead of passing through it. Across
  // the middle the two legs share the cloth, and below the knee it mostly stays with the thigh.
  const skin = p => {
    const shin = smooth(m.knee + .02 * k, m.knee - .12 * k, p[1]) * .7, own = smooth(0, .04 * k, Math.abs(p[0])) * .5 + .5, out = [];
    for (const [q, share] of [[p, own], [[-p[0], p[1], p[2]], 1 - own]]) {
      if (share <= 0) continue;
      const v = behind(q);
      if (v < 0) { out.push([pelvis, share]); continue; }
      const [bones, weights] = body.skinOf(v);
      bones.forEach((bone, n) => {
        const leg = sides.find(side => side.calf === bone);
        if (leg) out.push([bone, weights[n] * share * shin], [leg.thigh, weights[n] * share * (1 - shin)]);
        else out.push([bone, weights[n] * share]);
      });
    }
    return mergeSkin(out);
  };
  // A long draped skirt describes joints its lower cloth can hang from. Its own weights stay on the body.
  const rig = field ? drapeJoints(body, m, env, field, { top, bottom }) : null;
  const at = (row, j, inset) => {
    if (field) {
      // Rows divide the cloth from the seam to wherever its hem falls in this direction.
      const a = j / cols * TAU, deep = row / rows, h = deep * field.hem(a);
      return env.point(h, a, field.radius(h, a) + ease * k * mix(.3, 1, smooth(0, .1, deep)) - inset);
    }
    const h = depth * row / rows, a = j / cols * TAU, deep = row / rows;
    const phase = a * folds + 1.3 * Math.sin(a * 3);
    const hem = smooth(.35, 1, deep);
    // Gores stay over the hips before opening in soft flutes below the knee.
    // The back carries a little more fullness than the front facing.
    const swing = phase + hem * (1.15 * Math.sin(2*a + .4) + .6 * Math.cos(3*a));
    const flute = Math.sin(swing) + .24*Math.cos(2*swing + .6);
    const wave = fold * k * (gores ? (.25*deep + 1.18*hem)*flute : deep*Math.sin(phase));
    const extra = gores ? k * hem * (.062 + .017*Math.cos(phase*.5) + .046*(1-Math.cos(a))) : 0;
    const p = env.point(h, a, env.sample(h, a) + ease * k * mix(.35, 1, smooth(0, .12, deep)) + wave + extra - inset);
    if (gores) p[1] += k * deep ** 4 * (.014 * Math.cos(a) + .007 * Math.cos(phase));
    return p;
  };
  const piece = new Piece(), rings = [];
  if (yoke > 0) {
    // A full skirt stands off the garment above it. Its top slopes in and ends just under that cloth, found by rays,
    // so there is no gap to look down into.
    const casts = shells.map(s => raycaster(s.pos, s.tri)), up = yoke * k, off = .35 * ease * k;
    const inner = Array.from({ length: cols }, (_, j) => {
      const a = j / cols * TAU, r = (field ? field.radius(0, a) : env.sample(0, a)) + off, from = env.point(-up, a, r), way = unit(sub(env.point(-up, a, 0), from));
      const hit = casts.reduce((best, cast) => Math.min(best, cast(from, way)), Infinity);
      return add(from, way, hit < .5 * r ? hit + .004 * k : off + .006 * k);
    });
    rings.push(inner, inner.map((q, j) => { const p = at(0, j, 0); return [mix(q[0], p[0], .65), mix(q[1], p[1], .4), mix(q[2], p[2], .65)]; }));
  }
  for (let row = 0; row <= rows; row++) rings.push(Array.from({ length: cols }, (_, j) => at(row, j, 0)));
  // The cloth turns under at the hem and runs back up as a lining, so the inside is cloth from any angle.
  for (let row = rows; row >= 0; row--) rings.push(Array.from({ length: cols }, (_, j) => at(row, j, .005 * k)));
  piece.loft(rings, skin, { flip: true });
  if (rig) piece.clothJoints = rig;
  // How far the folds stand out of the hanging surface, for shading them where a reduced model cannot carry them.
  // The shading is painted on charts seen from the front and from behind, which have no room for the flanks.
  const relief = (deep, angle) => field ? field.relief(deep * field.hem(angle), angle) * smooth(.3, .62, Math.abs(Math.cos(angle))) : 0;
  if (field) {
    const heights = new Float32Array(piece.count), lead = rings.length - 2 * (rows + 1);
    for (let n = 0; n < 2 * (rows + 1); n++) { const row = n <= rows ? n : 2 * rows + 1 - n; for (let j = 0; j < cols; j++) heights[(lead + n) * cols + j] = relief(row / rows, j / cols * TAU); }
    piece.foldBands = [[0, heights]];
    piece.draped = true;
  }
  return { piece, env, skin, field, relief, rig, pointAt: (depth, angle, lift = 0) => at(depth * rows, angle / TAU * cols, -lift) };
}

/**
 * Records how far the folds stand out of each point of a sheet just lofted onto a draped skirt, `relief(u, v)` in
 * metres over its rows and columns, so a reduced model can shade the folds it cannot carry.
 */
export function foldRelief(piece, base, rows, cols, relief) {
  const heights = new Float32Array((rows + 1) * (cols + 1));
  for (let i = 0; i <= rows; i++) for (let j = 0; j <= cols; j++) heights[i * (cols + 1) + j] = relief(j / cols, i / rows);
  (piece.foldBands ??= []).push([base, heights]);
  piece.draped = true;
}

/** A fold-down or standing collar grown from a neck opening. */
export function collar(piece, s, loop, m, { stand = .022, fall = .04, kind = "shirt", gap = .16 } = {}) {
  if (!loop) return;
  const k = m.k, z0 = m.neck[2], rings = kind === "shirt" ? [[], [], [], [], [], []] : [[], [], [], [], []];
  for (const i of loop) {
    const p = s.at(i), out = unit([p[0], 0, p[2] - z0]), angle = Math.abs(Math.atan2(p[0], p[2] - z0));
    // The collar closes to nothing at the centre front and is longest at its points.
    const open = smooth(0, gap, angle), point = 1 + .5 * smooth(1.2, .35, angle), h = Math.min(stand * k, Math.max(.012 * k, m.neck[1] + .09 * k - p[1])) * (kind === "shirt" ? mix(.55, 1, smooth(.2, 1.4, angle)) : 1) * open;
    // A collar stands the way the cloth it is sewn to runs: on a shoulder that slopes up to the neck it leans in
    // with the slope, where one raised straight up would stand away from the neck as a funnel.
    const n = s.normal(i), along = dot([0, 1, 0], n), slope = unit([-n[0] * along, 1 - n[1] * along, -n[2] * along]), up = unit([slope[0] * .75, .25 + slope[1] * .75, slope[2] * .75]);
    const lift3 = (o, u) => u > 0 ? [p[0] + out[0] * o + up[0] * u, p[1] + up[1] * u, p[2] + out[2] * o + up[2] * u] : [p[0] + out[0] * o, p[1] + u, p[2] + out[2] * o];
    if (kind === "shirt") {
      rings[0].push(lift3(.0005 * k, -.002 * k));
      rings[1].push(lift3(-.004 * k * open, h));
      rings[2].push(lift3(.006 * k * open, h + .003 * k * open));
      rings[3].push(lift3((.024 + .014 * (point - 1)) * k * open, h - fall * k * point * open * .5));
      rings[4].push(lift3((.033 + .016 * (point - 1)) * k * open, h - fall * k * point * open));
      // The under side of the leaf, a few millimetres in: the collar has an edge and casts its own shadow.
      rings[5].push(lift3((.029 + .016 * (point - 1)) * k * open, h - fall * k * point * open - .0005 * k * open));
    } else {
      rings[0].push(lift3(.001 * k, -.002 * k));
      rings[1].push(lift3(.004 * k, h * .5));
      rings[2].push(lift3(.004 * k, h));
      rings[3].push(lift3(-.001 * k, h));
      rings[4].push(lift3(-.002 * k, 0));
    }
  }
  const skins = loop.map(i => s.skin(i));
  piece.loft(rings, (p, i, j) => skins[j], { flip: kind === "shirt" });
}

/**
 * A band lying around the neck opening: a scarf or a fur trim. `flat` above 1 makes it taller than it is thick,
 * `lumps` makes it uneven like fur, and `wraps` winds shallow folds round it like wound cloth.
 */
export function roll(piece, s, loop, m, { radius = .03, back = 1, front = .25, drop = .01, out = 0, flat = .75, lumps = 0, wraps = 0, sides = 10 } = {}) {
  if (!loop) return;
  const k = m.k, z0 = m.neck[2], rings = Array.from({ length: sides }, () => []);
  for (const i of loop) {
    const p = s.at(i), o = unit([p[0], 0, p[2] - z0]), turn = Math.atan2(p[0], p[2] - z0), angle = Math.abs(turn);
    // Unevenness follows the direction round the neck, so it stays the same however finely the opening is cut.
    const r = radius * k * mix(front, back, smooth(.6, 2.2, angle)) * (1 + lumps * Math.sin(turn * 11) * Math.sin(turn * 3.1 + 1));
    const centre = [p[0] + o[0] * (r * .7 + out * k), p[1] + r * flat * .5 - drop * k * smooth(.6, 2.2, angle), p[2] + o[2] * (r * .7 + out * k)];
    for (let j = 0; j < sides; j++) {
      const a = j / sides * TAU, fold = 1 - wraps * (.5 + .5 * Math.cos(2 * a + 5 * turn + 1.3 * Math.sin(turn * 2))) ** 2;
      rings[j].push([centre[0] + o[0] * Math.cos(a) * r * fold, centre[1] + Math.sin(a) * r * flat * mix(1, fold, .4), centre[2] + o[2] * Math.cos(a) * r * fold]);
    }
  }
  const skins = loop.map(i => s.skin(i));
  piece.loft([...rings, rings[0]], (p, i, j) => skins[j]);
}

/**
 * A hood worn down. It leaves the neck opening as a low soft stand, lies on the shoulders and hangs between the
 * shoulder blades as a flat pouch folded along the middle, resting on the cloth in `shells`.
 *   length  how far the pouch hangs down the back; thick, how far it stands off the cloth under it
 *   stand   how high it rises at the nape; front, the share of that thickness left at the throat
 */
export function hood(piece, body, shells, s, loop, m, { length = .17, thick = .022, stand = .022, front = .3 } = {}) {
  if (!loop) return;
  const k = m.k, z0 = m.neck[2], top = Math.max(...loop.map(i => s.pos[i * 3 + 1])), floor = top - (length + .05) * k, tri = [], pos = [];
  // Only the cloth of the upper back can lie under the hood, which keeps the rays that find it cheap.
  for (const shell of shells) {
    const base = pos.length / 3;
    for (const x of shell.pos) pos.push(x);
    for (let t = 0; t < shell.tri.length; t += 3) if ([0, 1, 2].every(e => shell.pos[shell.tri[t + e] * 3 + 1] > floor - .03 * k)) tri.push(base + shell.tri[t], base + shell.tri[t + 1], base + shell.tri[t + 2]);
  }
  const cast = raycaster(pos, tri), fall = [.03, .14, .28, .43, .58, .73, .86, .96], rings = Array.from({ length: fall.length + 5 }, () => []), skins = [], under = [];
  for (const i of loop) {
    const p = s.at(i), o = unit([p[0], 0, p[2] - z0]), back = smooth(1, 2.5, Math.abs(Math.atan2(p[0], p[2] - z0)));
    const long = mix(.02, length, back ** 1.5) * k, rise = stand * k * mix(.4, 1, back);
    // The hood is folded along the middle of the back, a little off centre, with a soft lobe to either side.
    const side = (p[0] - .005 * k) / k, crease = Math.exp(-((side / .02) ** 2)) * back, lobe = Math.exp(-(((Math.abs(side) - .055) / .03) ** 2)) * back * (side > 0 ? 1.15 : .9);
    const deep = thick * k * mix(front, 1, back);
    // Where the hood lies at a depth below the opening: on the cloth behind it, found by a ray from outside.
    const rest = d => {
      const origin = [p[0] + o[0] * .3, p[1] - d, p[2] + o[2] * .3], hit = cast(origin, [-o[0], 0, -o[2]]);
      // A ray that misses, or that finds cloth further in than the opening itself, falls back to a line down from it.
      return Number.isFinite(hit) && hit < .3 + .02 * k ? [origin[0] - o[0] * hit, origin[1], origin[2] - o[2] * hit] : [p[0] + o[0] * d * .3, p[1] - d, p[2] + o[2] * d * .3];
    };
    const lift3 = (q, away, up) => [q[0] + o[0] * away, q[1] + up, q[2] + o[2] * away], column = [];
    column.push(lift3(p, -.003 * k, -.004 * k), lift3(p, .003 * k, rise * .8), lift3(p, deep * .55, rise), lift3(p, deep * 1.02, rise * .45));
    for (const f of fall) {
      const pouch = (.72 + .4 * Math.sin(Math.PI * f ** .8)) * (1 - .42 * crease * smooth(.05, .45, f)) * (1 + .22 * lobe * Math.sin(Math.PI * f));
      column.push(lift3(rest(f * long), deep * pouch * mix(1, .6, smooth(.8, 1, f)), 0));
    }
    column.push(lift3(rest(long * 1.05), .0015 * k, 0));
    column.forEach((q, row) => rings[row].push(q));
    skins.push(s.skin(i)); under.push(body.skinAt(rest(long * .6)));
  }
  // The stand moves with the neck opening and the pouch with the back it lies on.
  piece.loft(rings, (q, row, j) => row < 4 ? skins[j] : under[j], { flip: true });
}

/** A strip of webbing or leather along a path of points with outward directions. */
export function strap(piece, body, path, { width = .03, thick = .004 } = {}) {
  const rings = [[], [], [], []];
  if (path.length < 2) return;
  path.forEach(([p, n], i) => {
    const tangent = unit(sub(path[Math.min(path.length - 1, i + 1)][0], path[Math.max(0, i - 1)][0])), side = unit(cross(tangent, n)), up = unit(cross(side, tangent));
    rings[0].push(add(add(p, side, -width / 2), up, -.002)); rings[1].push(add(add(p, side, -width / 2), up, thick));
    rings[2].push(add(add(p, side, width / 2), up, thick)); rings[3].push(add(add(p, side, width / 2), up, -.002));
  });
  piece.loft(rings, p => body.skinAt(p), { closed: false });
}

/** Hands or forearms in fitted leather: gloves and bracers. One strapped on over a sleeve names that sleeve in `over` and lies outside it. */
export function sleeveGuard(body, m, side, { from = 1.82, to = 3, ease = .0025, passes = 2, over = [], room = .004 } = {}) {
  const k = m.k, sign = side === "l" ? 1 : -1;
  let s = bodyShell(body);
  s = cut(s, i => s.anc[i * 3] * sign > 0 ? s.f.arm[i] - from : -1);
  if (to < 2.5) s = cut(s, i => to - s.f.arm[i]);
  lift(s, ease * k);
  relax(s, { passes, gap: ease * .6 * k, strength: .4 });
  for (const shell of over) outside(s, shell, room * k, false);
  return { s, ...classify(s) };
}

/** A fitted plate or pad over part of the body, such as a shoulder guard. */
export function plate(body, m, keep, { ease = .012, passes = 10, near } = {}) {
  let s = bodyShell(body);
  for (const test of keep) s = cut(s, i => test(s, i));
  if (near) s = connected(s, near);
  lift(s, ease * m.k);
  relax(s, { passes, gap: ease * .7 * m.k });
  return { s, ...classify(s) };
}

/** A shoe lofted from convex slices of the foot, so toes merge into a toe box. */
export function shoe(body, m, side, { collar = .058, sole = .011, ease = .005, heel = 0, toe = 0 } = {}) {
  const k = m.k, ankle = body.joint("foot_" + side), ball = body.joint("ball_" + side);
  const f = unit([ball[0] - ankle[0], 0, ball[2] - ankle[2]]), across = [f[2], 0, -f[0]];
  const w = body.weight(new RegExp("^(foot|ball|calf)_" + side)), top = body.floor + collar * k, points = [];
  let t0 = Infinity, t1 = -Infinity;
  for (let v = 0; v < body.count; v++) {
    if (w[v] < .5 || body.P[v * 3 + 1] > top + .05 * k) continue;
    const d = sub(body.point(v), ankle), t = dot(d, f);
    points.push([t, dot(d, across), body.P[v * 3 + 1]]);
    if (body.P[v * 3 + 1] < top) { t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
  }
  t1 += toe * k;
  const slices = 20, around = 24, dt = (t1 - t0) / slices, rings = [], centres = [], radii = [];
  for (let i = 0; i < slices; i++) {
    const t = t0 + (i + .5) * dt, flat = [];
    for (const [pt, x, y] of points) if (Math.abs(pt - t) < dt * .9) flat.push([x, Math.min(y, top)]);
    if (flat.length < 3) { radii.push(null); centres.push(null); continue; }
    let lo = Infinity, hi = -Infinity;
    for (const [x] of flat) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
    flat.push([lo, body.floor], [hi, body.floor]);
    const outline = hull2(flat), ys = outline.map(p => p[1]), centre = [(lo + hi) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    centres.push(centre);
    radii.push(Array.from({ length: around }, (_, j) => reach2(outline, centre, j / around * TAU) + ease * k));
  }
  const known = radii.map((r, i) => r ? i : -1).filter(i => i >= 0);
  for (let i = 0; i < slices; i++) if (!radii[i]) { const n = known.reduce((a, b) => Math.abs(b - i) < Math.abs(a - i) ? b : a); radii[i] = radii[n].slice(); centres[i] = centres[n].slice(); }
  for (let pass = 0; pass < 2; pass++) {
    const old = radii.map(r => r.slice()), oldCentres = centres.map(c => c.slice());
    for (let i = 1; i < slices - 1; i++) {
      for (let j = 0; j < around; j++) radii[i][j] = Math.max(old[i][j], (old[i - 1][j] + 2 * old[i][j] + old[i + 1][j]) / 4);
      for (let d = 0; d < 2; d++) centres[i][d] = (oldCentres[i - 1][d] + 2 * oldCentres[i][d] + oldCentres[i + 1][d]) / 4;
    }
  }
  const world = (t, x, y) => [ankle[0] + f[0] * t + across[0] * x, y, ankle[2] + f[2] * t + across[2] * x];
  const ring = (i, t, scale) => Array.from({ length: around }, (_, j) => {
    const a = j / around * TAU, r = radii[i][j] * scale;
    return world(t, centres[i][0] + Math.cos(a) * r, Math.max(body.floor + .0005, centres[i][1] + Math.sin(a) * r));
  });
  rings.push(ring(0, t0 - dt * .3, .5), ring(0, t0 - dt * .05, .85));
  for (let i = 0; i < slices; i++) rings.push(ring(i, t0 + (i + .5) * dt, 1));
  rings.push(ring(slices - 1, t1 + dt * .05, .85), ring(slices - 1, t1 + dt * .3, .5));
  const tBall = dot(sub(ball, ankle), f), foot = body.bone("foot_" + side), toes = body.bone("ball_" + side);
  const skin = p => { const b = smooth(tBall - .015 * k, tBall + .02 * k, dot(sub(p, ankle), f)); return [[foot, toes, 0, 0], [1 - b, b, 0, 0]]; };
  const upper = new Piece().loft(rings, skin, { capStart: true, capEnd: true, flip: true });
  const rowCount = rings.length;
  upper.shoeUV = [];
  const shoeUV = (row, col) => {
    const angle = (col / around + .25) % 1;
    upper.shoeUV.push(.005 + .99 * angle, 1 - (.005 + .99 * row / (rowCount - 1)));
  };
  for (let row = 0; row < rowCount; row++)
    for (let col = 0; col < around; col++) shoeUV(row, col);
  for (const row of [0, rowCount - 1]) {
    shoeUV(row, around / 4);
    for (let col = 0; col < around; col++) shoeUV(row, col);
  }
  // The sole follows the outline of the upper seen from above.
  const print = hull2(rings.flatMap(r => r.filter(p => p[1] < body.floor + .03 * k).map(p => { const d = sub(p, ankle); return [dot(d, f), dot(d, across)]; })));
  const centre = print.reduce((sum, p) => [sum[0] + p[0] / print.length, sum[1] + p[1] / print.length], [0, 0]);
  const steps = 40, lip = .003 * k, edge = [];
  for (let j = 0; j < steps; j++) { const a = j / steps * TAU, r = reach2(print, centre, a) + lip; edge.push([centre[0] + Math.cos(a) * r, centre[1] + Math.sin(a) * r]); }
  // The sole stands on the floor the bare foot stands on and wraps the rim of the upper, so a shod figure keeps its height and its ground contact.
  const rise = t => body.floor + (sole + .004) * k + heel * k * (1 - smooth(-.012 * k, .004 * k, t - (t0 + (t1 - t0) * .34)));
  const slab = new Piece().loft([edge.map(([t, x]) => world(t, x, body.floor)), edge.map(([t, x]) => world(t, x, rise(t)))], skin, { capStart: true, capEnd: true, flip: true });
  return { upper, sole: slab, ground: body.floor };
}

/** Buckled leather straps seated on the finished shaft at each sampled height. */
export function bootFastenings(body, m, side, shell) {
  const leather = new Piece(), metal = new Piece(), k = m.k;
  const ankle = body.joint("foot_" + side), knee = body.joint("calf_" + side);
  const heights = shell.pos.filter((_, i) => i % 3 === 1);
  const bottom = Math.max(Math.min(...heights), body.floor + .10 * k);
  const span = Math.max(...heights) - bottom;
  if (span < .055 * k) return { leather, metal };
  const cast = caster([shell]);
  const direction = angle => [Math.sin(angle), 0, Math.cos(angle)];
  const half = .009 * k;
  function surface(y, angle, offset) {
    const axisT = (y - ankle[1]) / (knee[1] - ankle[1]);
    const axis = [mix(ankle[0], knee[0], axisT), y, mix(ankle[2], knee[2], axisT)];
    const n = direction(angle), from = .24 * k;
    const radius = from - cast(add(axis, n, from), n.map(v => -v));
    return radius > 0 ? add(axis, n, radius + offset) : null;
  }
  const cols = 28, buckleAngle = (side === "l" ? 1 : -1) * Math.PI / 3;
  for (const t of span > .14 * k ? [.22, .70] : [.45]) {
    const y = bottom + t * span;
    const ring = (dy, offset) => Array.from({ length: cols }, (_, i) =>
      surface(y + dy, i * TAU / cols, offset * k));
    const rings = [ring(half, -.001), ring(half, .0035), ring(-half, .0035), ring(-half, -.001)];
    const centre = surface(y, buckleAngle, .0055 * k);
    if (!centre || rings.some(row => row.includes(null))) continue;
    leather.loft(rings, p => body.skinAt(p));
    const n = direction(buckleAngle), tangent = [n[2], 0, -n[0]];
    const skin = body.skinAt(centre);
    const rail = (x, h, width, height) => box(metal, add(add(centre, tangent, x*k), [0, 1, 0], h*k),
      [tangent.map(v => v*width*k), [0, height*k, 0], n.map(v => v*.002*k)], skin);
    for (const sign of [-1, 1]) {
      rail(0, sign*.012, .016, .002);
      rail(sign*.014, 0, .002, .012);
    }
    rail(-.006, 0, .010, .0015);
  }
  return { leather, metal };
}

/** A straight boot shaft from below the knee to the ankle, over the shoe. */
export function shaft(body, m, side, { from = 1.45, ease = .006, taper = .05, foot = .06 } = {}) {
  const k = m.k, sign = side === "l" ? 1 : -1;
  let s = bodyShell(body);
  s = cut(s, i => s.anc[i * 3] * sign > 0 ? s.f.leg[i] - from : -1);
  s = cut(s, i => s.anc[i * 3 + 1] - (body.floor + foot * k));
  lift(s, ease * k);
  const root = body.joint("calf_" + side), end = body.joint("foot_" + side), w = body.weight(new RegExp("^(calf|foot)_" + side)), points = [];
  for (let v = 0; v < body.count; v++) if (w[v] > .5 && body.P[v * 3 + 1] > body.floor + .04 * k) points.push(body.point(v));
  const span = length(sub(end, root)) + .03 * k;
  new Envelope(root, sub(end, root), 0, span, Math.round(span / (.02 * k)), 24).measure(points).taut(1).hang(taper, 1).soften(1).drape(s, null, ease * k);
  relax(s, { passes: 4, gap: .004 * k });
  return { s, ...classify(s) };
}
