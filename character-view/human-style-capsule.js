import { Piece, mix, smooth } from "./human-style-kit.js";
import { band, belt, box, button, caster, foldRelief, garment, hood, plate, skirt } from "./human-style-cloth.js";
import { pod } from "./human-style-gear.js";
import { boots, buckle, finish, part, pocket, shoes } from "./human-style-outfits.js";

import { mantle } from "./human-mantle.js";

const TAU = Math.PI * 2;

function wayfarer(body, m, { hooded }) {
  const parts = [], k = m.k, seam = m.waist - .01 * k;
  const legs = garment(body, m, { waist: m.waistband, leg: 1.6, ease: .009, taper: .25 });
  parts.push(part(new Piece().shell(legs.s), "dark", "pelvis", "Breeches"));
  const tunic = garment(body, m, { sleeve: 1.93, hem: seam - .03 * k, ease: .012, fall: .15, tension: 1, span: 2.2, sleeveFall: .2, sleeveEase: .004, passes: 7, neck: { v: .06 } });
  const tails = skirt(body, m, { top: seam + .012 * k, bottom: m.crotch - (hooded ? .2 : .13) * k, ease: .014, flare: .13, fold: .008, folds: 9, shells: [tunic.s, legs.s] });
  parts.push(part(finish(tunic, k, { neck: .016, cuff: .034, rise: .003 }), "main", "spine_03", "Tunic"), part(tails.piece, "main", "pelvis", "Tunic skirt"));
  const leather = new Piece(), metal = new Piece();
  belt(leather, body, m, [tunic.s], seam, { height: .056, thick: .005, buckle: false });
  buckle(metal, body, m, [tunic.s], seam, .056);
  const env = belt(leather, body, m, [tunic.s, tails.piece], seam - .05 * k, { height: .02, thick: .005, buckle: false });
  const at = env.point(.05 * k + .045 * k, hooded ? -1.1 : 1.1, env.sample(.05 * k, hooded ? -1.1 : 1.1) + .03 * k);
  pod(leather, at, [[.042 * k, 0, -.02 * k * (hooded ? -1 : 1)], [0, .052 * k, 0], [.012 * k, 0, .024 * k]], body.rigid("pelvis"), { power: 3.2 });
  parts.push(part(leather, "leather", "spine_01", "Belts and pouch", "leather"));
  const elbow = body.joint("lowerarm_l")[1];
  const fall = y => m.neck[1] - y;
  const shape = hooded
    ? { drop: a => Math.min(mix(fall(m.waist) + .03 * k, fall(m.hip) + .04 * k, smooth(.5, 2.6, a)), mix(fall(elbow) - .01 * k, 9, smooth(.5, 1.15, Math.abs(a - 1.45)))), open: v => .05 + .34 * v ** 1.5, facing: .07, fold: .012, armLow: elbow - .01 * k }
    : { drop: a => mix(fall(m.chest[1]) + .12 * k, fall(m.knee) + .14 * k, smooth(1.45, 1.95, a)), open: v => .1 + .9 * v ** 1.3, facing: .09, fold: .014, armLow: elbow + .05 * k, split: .3, flare: .06 };
  const cloak = mantle(body, m, [tunic.s, tails.piece], shape);
  if (hooded) hood(cloak.cloth, body, [tunic.s, { pos: cloak.cloth.pos.slice(), tri: cloak.cloth.tri.slice() }], tunic.s, tunic.upper, m, { length: .2, thick: .026, stand: .022, front: .5 });
  parts.push(part(cloak.cloth, "accent", "spine_03", hooded ? "Shoulder cloak" : "Split mantle"), part(cloak.lining, "light", "spine_03", "Mantle lining"));
  const skinAt = body.rigid("spine_03");
  for (const v of hooded ? [.1, .3] : [.09]) {
    const a = cloak.at(v, 1, .006 * k), b = cloak.at(v, -1, .006 * k), mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.max(a[2], b[2]) + .004 * k], wide = Math.abs(a[0] - b[0]) / 2;
    for (const q of [a, b]) pod(metal, [q[0], q[1], q[2] + .002 * k], [[(hooded ? .011 : .019) * k, 0, 0], [0, (hooded ? .011 : .019) * k, 0], [0, 0, .006 * k]], skinAt, { power: 2.2, rings: 6, around: 12 });
    box(hooded ? leather : metal, mid, [[wide, 0, 0], [0, (hooded ? .006 : .004) * k, 0], [0, 0, .003 * k]], skinAt);
  }
  parts.push(part(metal, "metal", "spine_03", "Clasp and buckle", "metal"));
  boots(body, m, parts, { from: hooded ? 1.42 : 1.26, cuff: .05, ease: .016 });
  return parts;
}

function bomber(body, m, { rolled }) {
  const parts = [], k = m.k, waist = m.waist + .012 * k;
  const legs = garment(body, m, { waist, leg: rolled ? 1.84 : 1.98, ease: .015, legEase: rolled ? .02 : .028, taper: .012, flare: 4, soft: 12, folds: .45 });
  const lower = finish(legs, k, { waist: .046, legs: rolled ? .07 : .055, rise: .0035 }), cast = caster([legs.s]);
  for (const sign of [1, -1]) pocket(lower, cast, body, m, { x: sign * .062 * k, y: m.waist - .09 * k, width: .012, height: .15, flap: false, rise: .004, z: m.pelvis[2] });
  parts.push(part(lower, "dark", "pelvis", rolled ? "Cuffed wide trousers" : "Wide trousers"));
  const tee = garment(body, m, { sleeve: .3, hem: waist - .03 * k, ease: .005, neck: rolled ? { scoop: .04, scoopWidth: .07 } : {} });
  parts.push(part(finish(tee, k, { neck: .012 }), "light", "spine_03", "Tucked top"));
  const leather = new Piece(), metal = new Piece();
  belt(leather, body, m, [legs.s, tee.s], waist - .024 * k, { height: .03, thick: .004, buckle: false });
  buckle(metal, body, m, [legs.s, tee.s], waist - .024 * k, .03);
  parts.push(part(leather, "leather", "pelvis", "Belt", "leather"), part(metal, "metal", "pelvis", "Buckle", "metal"));
  const jacket = garment(body, m, { sleeve: rolled ? 1.22 : 1.93, hem: waist - .012 * k, ease: .03, gap: .012, fall: .05, tension: 1, span: 3, sleeveFall: .06, sleeveEase: .008, passes: 10, neck: { v: rolled ? .2 : .26, height: .012 }, under: [tee.s, legs.s] });
  const shell = new Piece().shell(jacket.s, { thickness: .006 }), ribs = new Piece();
  const edge = jacket.lower;
  if (edge) {
    const points = edge.map(i => jacket.s.at(i));
    const centre = points.reduce((sum, p) => [sum[0] + p[0], sum[1] + p[2]], [0, 0]).map(x => x / points.length);
    const ring = (down, gather) => points.map(([x, y, z]) => [
      centre[0] + (x - centre[0]) * gather, y - down * k, centre[1] + (z - centre[1]) * gather,
    ]);
    const signedArea = points.reduce((sum, p, i) => {
      const next = points[(i + 1) % points.length];
      return sum + p[0] * next[2] - p[2] * next[0];
    }, 0);
    ribs.loft([ring(-.003, .99), ring(.001, 1.002), ring(.022, .988), ring(.043, .966), ring(.043, .94)],
      (_p, _row, j) => jacket.s.skin(edge[j]), { flip: signedArea > 0 });
  }
  band(ribs, jacket.s, jacket.upper, { width: .03 * k, rise: .0045 * k });
  for (const loop of jacket.sleeves) band(ribs, jacket.s, loop, { width: (rolled ? .06 : .05) * k, rise: (rolled ? .007 : .0045) * k });
  const on = caster([jacket.s]);
  for (const sign of [1, -1]) pocket(shell, on, body, m, { x: sign * .105 * k, y: m.chest[1] - .015 * k, width: .03, height: .12, flap: false, rise: .004, across: [1, sign * .35, 0] });
  parts.push(part(shell, "main", "spine_03", rolled ? "Rolled-sleeve bomber" : "Short bomber"), part(ribs, "accent", "spine_03", "Ribbing"));
  if (rolled) shoes(body, m, parts, { collar: .05, sole: .012, heel: .014 }, "leather", "sole", "Loafer");
  else shoes(body, m, parts, { collar: .066, sole: .024, toe: .004 }, "light", "light", "Chunky trainer");
  return parts;
}

function bodiced(body, m, { draped }) {
  const parts = [], k = m.k, seam = m.waist - .02 * k;
  const bodice = garment(body, m, { sleeve: draped ? .46 : .16, hem: seam - .026 * k, ease: .007, fall: .22, below: .16, rise: .5, sleeveEase: draped ? .022 : 0, sleeveFall: draped ? .05 : null,
    neck: draped ? { height: -.02, scoop: .085, scoopWidth: .12, wide: .075 } : { height: -.012, scoop: .1, scoopWidth: .085, wide: .03 } });
  const top = finish(bodice, k, { neck: .014, cuff: draped ? .03 : .014, rise: .003 });
  parts.push(part(top, "main", "spine_03", "Bodice", "satin"));
  if (!draped) for (const sign of [1, -1]) {
    const cap = plate(body, m, [(s, i) => s.anc[i * 3] * sign > 0 ? .3 - s.f.arm[i] : -1, (s, i) => s.f.arm[i] + .05, (s, i) => s.anc[i * 3 + 1] - (m.shoulder - .075 * k) + 10 * s.f.wArm[i]], { ease: .024, passes: 12, near: body.joint(sign > 0 ? "upperarm_l" : "upperarm_r") });
    const wing = new Piece().shell(cap.s, { thickness: .006 });
    for (const loop of cap.all) band(wing, cap.s, loop, { width: .012 * k, rise: .003 * k });
    parts.push(part(wing, "accent", sign > 0 ? "upperarm_l" : "upperarm_r", "Shoulder wing", "satin"));
  }
  const length = draped ? m.ankle + .05 * k : mix(m.knee, m.ankle, .42);
  const lower = skirt(body, m, { top: seam + .015 * k, bottom: length, ease: .014, flare: draped ? .16 : .26, fold: draped ? .022 : .018, folds: draped ? 12 : 10, cols: 84, shells: [bodice.s], yoke: .018, gores: true, drape: draped ? { cloth: "gown", sweep: .21, folds: 10, calm: .2 } : { cloth: "gored" } });
  const centre = draped ? .55 : 0, spread = draped ? .34 : .5, edge = v => .05 + spread * v ** 1.25, face = v => .035 + .11 * v;
  const at = (v, a, lift = 0) => lower.pointAt(.012 + .988 * v, ((a + centre) % TAU + TAU) % TAU, lift * k);
  const left = Math.sign(body.joint("thigh_l")[0]) || 1;
  const skin = p => {
    const thigh = smooth(m.hip + .04 * k, m.hip - .16 * k, p[1]), shin = thigh * .6 * smooth(m.knee + .025 * k, m.knee - .14 * k, p[1]), l = smooth(-.09 * k, .09 * k, left * p[0]);
    return body.blend([["pelvis", 1 - thigh], ["thigh_l", l * (thigh - shin)], ["thigh_r", (1 - l) * (thigh - shin)], ["calf_l", l * shin], ["calf_r", (1 - l) * shin]]);
  };
  const grid = (rows, cols, get) => Array.from({ length: rows + 1 }, (_, i) => Array.from({ length: cols + 1 }, (_, j) => get(j / cols, i / rows)));
  const sheet = (piece, rows, cols, get, relief) => {
    const base = piece.count;
    piece.loft(grid(rows, cols, get), skin, { closed: false, flip: true });
    if (relief) foldRelief(piece, base, rows, cols, relief);
  };
  const reliefAt = (v, a) => lower.relief(.012 + .988 * v, ((a + centre) % TAU + TAU) % TAU);
  const wrap = new Piece(), panel = new Piece(), facings = new Piece();
  const spans = [[wrap, v => edge(v) + face(v), v => TAU - edge(v) - face(v), 72], [panel, v => -edge(v), edge, 22], [facings, edge, v => edge(v) + face(v), 6], [facings, v => TAU - edge(v) - face(v), v => TAU - edge(v), 6]];
  for (const [piece, from, to, cols] of spans) {
    sheet(piece, 18, cols, (u, v) => at(v, mix(from(v), to(v), u)), (u, v) => reliefAt(v, mix(from(v), to(v), u)));
    sheet(piece, 2, cols, (u, v) => at(1 - .03 * v, mix(from(1), to(1), u), -.005 * v));
  }
  if (lower.rig) for (const piece of [wrap, panel, facings]) piece.clothJoints = lower.rig;
  parts.push(part(wrap, draped ? "main" : "dark", "pelvis", draped ? "Draped skirt" : "Gored skirt", "satin"), part(panel, "accent", "pelvis", "Skirt panel", "satin"), part(facings, "light", "pelvis", "Skirt facing", "satin"));
  const girdle = new Piece(), studs = new Piece(), tall = draped ? .05 : .085;
  belt(girdle, body, m, [bodice.s, lower.piece], seam + (draped ? 0 : .014 * k), { height: tall, thick: .004, buckle: false });
  const on = caster([{ pos: girdle.pos, tri: girdle.tri }]);
  if (!draped) for (let i = 0; i < 4; i++) button(studs, on, body, { centre: [0, seam + .014 * k + mix(-.3, .3, i / 3) * tall * k, m.chest[2]], facing: [0, 0, 1], radius: .0075 * k, rise: .005 * k });
  parts.push(part(girdle, draped ? "accent" : "main", "spine_01", draped ? "Sash" : "Girdle", "satin"));
  if (studs.tri.length) parts.push(part(studs, "metal", "spine_01", "Girdle studs", "metal"));
  if (draped) shoes(body, m, parts, { collar: .05, sole: .008, heel: .025 }, "dark", "sole", "Dress shoe");
  else shoes(body, m, parts, { collar: .11, sole: .01, heel: .024 }, "leather", "sole", "Ankle boot");
  return parts;
}

export const capsule = {
  "Split mantle": (body, m) => wayfarer(body, m, { hooded: false }),
  "Hooded shoulder cloak": (body, m) => wayfarer(body, m, { hooded: true }),
  "Bomber and wide trousers": (body, m) => bomber(body, m, { rolled: false }),
  "Rolled bomber and cuffed trousers": (body, m) => bomber(body, m, { rolled: true }),
  "Bodice and gored skirt": (body, m) => bodiced(body, m, { draped: false }),
  "Draped bodice gown": (body, m) => bodiced(body, m, { draped: true }),
};
