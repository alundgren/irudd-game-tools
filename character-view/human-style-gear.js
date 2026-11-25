// Bulky gear worn over the clothes: packs, capes and aprons.
import { Envelope, Piece, add, clamp, cross, dot, mix, smooth, sub, unit } from "./human-style-kit.js";
import { belt, caster, strap } from "./human-style-cloth.js";

const ARMS = /^(upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)/, TAU = Math.PI * 2;

/** A rounded box or cushion: packs, pouches and bedrolls. `half` holds three half-extent vectors; rings run along the second. */
export function pod(piece, centre, half, skin, { power = 4, rings = 9, around = 20 } = {}) {
  const curve = x => Math.sign(x) * Math.abs(x) ** (2 / power), list = [];
  for (let i = 0; i <= rings; i++) {
    const t = -Math.cos(i / rings * Math.PI), s = Math.max(0, 1 - Math.abs(t) ** power) ** (1 / power);
    list.push(Array.from({ length: around }, (_, j) => {
      const a = j / around * TAU;
      return add(add(add(centre, half[1], t), half[0], curve(Math.cos(a)) * s), half[2], curve(Math.sin(a)) * s);
    }));
  }
  piece.loft(list, skin, { flip: dot(cross(half[0], half[1]), half[2]) < 0 });
}

/** Press a path of points onto the clothes, returning [point, outward] pairs for `strap`. */
export function lay(cast, body, points, inside, gap = .002) {
  return points.map(p => {
    const d = unit(sub(p, inside(p))), origin = add(p, d, .35), hit = cast(origin, [-d[0], -d[1], -d[2]]);
    return Number.isFinite(hit) && hit < .6 ? [add(origin, d, gap - hit), d] : null;
  }).filter(Boolean);
}

/** A cape hanging from the shoulders down the back. */
export function cape(body, m, shells, { bottom, ease = .016, open = 1.75, fold = .012, cols = 44 } = {}) {
  const k = m.k, top = m.neck[1] + .005 * k, head = body.weight(/^head/), points = [];
  for (let v = 0; v < body.count; v++) { const y = body.P[v * 3 + 1]; if (body.arm[v] < .1 && head[v] < .5 && y < top + .03 * k && y > bottom - .03 * k) points.push(body.point(v)); }
  for (const s of shells) for (let i = 0; i < s.pos.length; i += 3) if ((s.f?.arm?.[i / 3] ?? 0) < .1 && s.pos[i + 1] < top + .03 * k && s.pos[i + 1] > bottom - .03 * k) points.push([s.pos[i], s.pos[i + 1], s.pos[i + 2]]);
  const depth = top - bottom, rows = Math.round(depth / (.03 * k));
  const env = new Envelope([0, top, m.chest[2]], [0, -1, 0], 0, depth, rows + 1, 64).measure(points).taut(1).hang(-.04, .7).soften(3);
  const chest = body.bone("spine_03"), mid = body.bone("spine_01"), pelvis = body.bone("pelvis");
  const skin = p => { const t = clamp((top - p[1]) / depth), low = smooth(.15, .6, t), far = smooth(.5, 1, t) * .6; return [[chest, mid, pelvis, 0], [1 - low, low * (1 - far), low * far, 0]]; };
  const piece = new Piece(), rings = [], inside = [];
  for (let row = 0; row <= rows; row++) {
    const h = depth * row / rows, deep = row / rows, outer = [], inner = [];
    for (let j = 0; j <= cols; j++) {
      const a = mix(open, TAU - open, j / cols), edge = Math.sin(j / cols * Math.PI) ** .3;
      const r = env.sample(h, a) + ease * k + fold * k * smooth(.1, .9, deep) * Math.sin(j * .9 + 1.7 * Math.sin(j * .23)) * edge;
      outer.push(env.point(h, a, r)); inner.push(env.point(h, a, r - .007 * k));
    }
    rings.push(outer); inside.push(inner);
  }
  piece.slab(rings, inside, skin);
  return { piece, env };
}

/** A pack on the back with shoulder straps and an optional bedroll, or an air supply with two tanks. */
export function backpack(body, m, shells, { bedroll = true, tanks = false } = {}) {
  const k = m.k, cast = caster(shells, true), top = m.shoulder - (tanks ? -.02 : .01) * k, tall = (tanks ? .42 : .37) * k, wide = Math.min(.29 * k, m.shoulderWidth * 1.65), deep = (tanks ? .1 : .125) * k;
  let back = Infinity;
  for (const x of [-.06, 0, .06]) for (const t of [.2, .5, .8]) { const d = cast([x * k, top - tall * t, m.chest[2] - .6], [0, 0, 1]); if (Number.isFinite(d)) back = Math.min(back, d); }
  if (!Number.isFinite(back)) return null;
  const z = m.chest[2] - .6 + back - deep / 2 - .004 * k, centre = [0, top - tall / 2, z];
  const skin = body.blend([["spine_03", .65], ["spine_02", .35]]), pack = new Piece(), gear = new Piece();
  pod(pack, centre, [[wide / 2, 0, 0], [0, tall / 2, 0], [0, 0, deep / 2]], skin, { power: 3.4, rings: 12, around: 28 });
  if (tanks) for (const x of [-.25, .25]) {
    pod(gear, [wide * x, top - tall * .47, z - deep * .62], [[wide * .2, 0, 0], [0, tall * .43, 0], [0, 0, wide * .2]], skin, { power: 2.6, rings: 12 });
    pod(pack, [wide * x, top - tall * .02, z - deep * .62], [[wide * .07, 0, 0], [0, tall * .05, 0], [0, 0, wide * .07]], skin, { power: 5, rings: 4, around: 12 });
  } else {
    pod(pack, [0, top - tall * .68, z - deep * .5], [[wide * .36, 0, 0], [0, tall * .2, 0], [0, 0, deep * .3]], skin, { power: 3.2 });
    pod(gear, [0, top - tall * .16, z - deep * .08], [[wide * .53, 0, 0], [0, tall * .19, 0], [0, 0, deep * .56]], skin, { power: 5, rings: 8, around: 24 });
  }
  if (bedroll && !tanks) {
    const c = [0, top + .05 * k, z - .01 * k];
    pod(pack, c, [[0, 0, .058 * k], [wide * .62, 0, 0], [0, .058 * k, 0]], skin, { power: 2.4, rings: 10 });
    for (const x of [-.3, .3]) pod(gear, add(c, [wide * x, 0, 0]), [[0, 0, .061 * k], [.011 * k, 0, 0], [0, .061 * k, 0]], skin, { power: 6, rings: 4 });
  }
  for (const sign of [1, -1]) {
    const x = sign * m.shoulderWidth * .6, q = [x, m.shoulder - .1 * k, m.chest[2]], over = [];
    for (let a = 200; a >= -40; a -= 12) { const r = a * Math.PI / 180; over.push(add(q, [0, Math.sin(r), Math.cos(r)], .05)); }
    const path = lay(cast, body, over, () => q, .003 * k);
    if (path.length < 2) continue;
    const end = path.at(-1)[0], corner = [sign * wide * .46, top - tall * .86, z + deep * .3];
    const under = [];
    for (let t = .12; t <= 1; t += .11) under.push([mix(end[0], corner[0], t) + sign * .09 * k * Math.sin(t * Math.PI), mix(end[1], corner[1], t), mix(end[2], corner[2], t)]);
    path.push(...lay(cast, body, under, p => [0, p[1], m.chest[2]], .003 * k));
    path.unshift([[x * .8, top - .02 * k, z + deep * .35], [0, 1, 0]]);
    strap(gear, body, path, { width: .034 * k, thick: .005 * k });
  }
  return { pack, gear };
}

/** A bib apron over the front of the clothes, with a waist tie and shoulder straps. */
export function apron(body, m, shells, { top = m.chest[1] + .1 * m.k, bottom = m.knee + .05 * m.k } = {}) {
  const k = m.k, cast = caster(shells, true), arm = body.weight(ARMS), points = [];
  for (let v = 0; v < body.count; v++) { const y = body.P[v * 3 + 1]; if (arm[v] < .3 && y < top + .04 * k && y > bottom - .03 * k) points.push(body.point(v)); }
  for (const s of shells) for (let i = 0; i < s.pos.length; i += 3) if ((s.f?.wArm?.[i / 3] ?? 0) < .3 && s.pos[i + 1] < top + .04 * k && s.pos[i + 1] > bottom - .03 * k) points.push([s.pos[i], s.pos[i + 1], s.pos[i + 2]]);
  const depth = top - bottom, rows = Math.round(depth / (.025 * k)), cols = 28;
  const env = new Envelope([0, top, m.chest[2]], [0, -1, 0], 0, depth, rows + 1, 64).measure(points).taut(1).hang(.05, 1).soften(2);
  const piece = new Piece(), rings = [], inside = [], tie = m.waist - .005 * k;
  const half = y => mix(1.2, .5, smooth(tie - .03 * k, tie + .04 * k, y)) * mix(1, .82, smooth(tie + .05 * k, top, y));
  for (let row = 0; row <= rows; row++) {
    const h = depth * row / rows, w = half(top - h), outer = [], inner = [];
    for (let j = 0; j <= cols; j++) { const a = mix(-w, w, j / cols), r = env.sample(h, a) + .008 * k; outer.push(env.point(h, a, r)); inner.push(env.point(h, a, r - .005 * k)); }
    rings.push(outer); inside.push(inner);
  }
  const ties = new Piece();
  piece.slab(rings, inside, p => body.skinAt(p[1] > m.crotch ? p : [p[0], p[1], m.pelvis[2]]));
  belt(ties, body, m, shells, tie, { height: .018, thick: .003, buckle: false });
  for (const sign of [1, -1]) {
    const a = sign * half(top) * .92, from = env.point(.005 * k, a, env.sample(0, a) + .008 * k), mid = [sign * .06 * k, m.neck[1] + .02 * k, m.neck[2]], end = [sign * .035 * k, tie + .02 * k, m.chest[2] - .3];
    const line = [];
    for (let t = 0; t <= 1; t += .1) line.push([mix(from[0], mid[0], t), mix(from[1], mid[1], t), mix(from[2], mid[2], t)]);
    for (let t = .12; t <= 1; t += .11) line.push([mix(mid[0], end[0], t), mix(mid[1], end[1], t), mix(mid[2], end[2], t)]);
    strap(ties, body, lay(cast, body, line, p => [p[0] * .6, Math.min(p[1], m.shoulder) - .09 * k, m.chest[2]], .002 * k), { width: .022 * k, thick: .003 * k });
  }
  return { piece, ties };
}

/** An open-faced shell helmet around the head, with a collar ring it locks into. */
export function helmet(body, m, { room = .05, open = .92 } = {}) {
  const k = m.k, head = body.weight(/^head/), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < body.count; v++) if (head[v] > .6) for (let d = 0; d < 3; d++) { lo[d] = Math.min(lo[d], body.P[v * 3 + d]); hi[d] = Math.max(hi[d], body.P[v * 3 + d]); }
  const centre = [0, (lo[1] + hi[1]) / 2 + .012 * k, (lo[2] + hi[2]) / 2 - .004 * k], radius = Math.max(hi[1] - lo[1], hi[2] - lo[2]) / 2 + room * k;
  // Rings circle the line of sight, so the face opening is a clean round edge.
  const sight = unit([0, -.12, 1]), side = [1, 0, 0], up = cross(sight, side), skin = body.rigid("head"), shell = new Piece(), trim = new Piece();
  const ring = (angle, r) => Array.from({ length: 40 }, (_, j) => {
    const a = j / 40 * TAU, x = Math.cos(a) * Math.sin(angle), y = Math.sin(a) * Math.sin(angle);
    return add(add(add(centre, sight, Math.cos(angle) * r), side, x * r), up, y * r * 1.04);
  });
  const outer = [], inner = [];
  for (let i = 0; i <= 18; i++) { const angle = mix(open, Math.PI - .001, i / 18); outer.push(ring(angle, radius)); inner.push(ring(angle, radius - .009 * k)); }
  shell.loft(outer, skin);
  shell.loft(inner, skin, { flip: true });
  shell.loft([ring(open, radius - .009 * k), ring(open - .02, radius - .004 * k), ring(open - .02, radius + .006 * k), ring(open + .03, radius + .007 * k), ring(open + .05, radius)], skin);
  const base = [0, m.neck[1] + .035 * k, m.neck[2] + .004 * k], collar = (r, y) => Array.from({ length: 40 }, (_, j) => [base[0] + Math.cos(j / 40 * TAU) * r, base[1] + y, base[2] + Math.sin(j / 40 * TAU) * r * 1.08]);
  const wide = radius * .8, neck = body.blend([["neck_01", .5], ["spine_03", .5]]);
  trim.loft([collar(wide - .02 * k, -.03 * k), collar(wide + .012 * k, -.03 * k), collar(wide + .016 * k, -.012 * k), collar(wide + .012 * k, .006 * k), collar(wide - .012 * k, .008 * k), collar(wide - .02 * k, -.03 * k)], neck);
  return { shell, trim, centre, radius };
}
