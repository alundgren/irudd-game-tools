import { Piece, mix, smooth } from "./human-style-kit.js";
import { band, belt, bootFastenings, box, button, caster, collar, foldRelief, garment, hood, patch, plate, roll, shaft, shoe, skirt, sleeveGuard } from "./human-style-cloth.js";
import { apron, backpack, cape, helmet, pod } from "./human-style-gear.js";
import { capsule } from "./human-style-capsule.js";

export const part = (piece, tone, region, name, type = "cloth") => ({ piece, tone, region, name, type });

export function shoes(body, m, parts, o = {}, tone = "leather", soleTone = "sole", name = "Shoe") {
  for (const side of ["l", "r"]) {
    const made = shoe(body, m, side, o);
    parts.push(part(made.upper, tone, "foot_" + side, name, "leather"));
    parts.push({ ...part(made.sole, soleTone, "foot_" + side, name + " sole", "leather"), ground: made.ground });
  }
}
export function boots(body, m, parts, { from = 1.5, ease = .011, cuff = .04, ...o } = {}, tone = "leather") {
  const shafts = [];
  shoes(body, m, parts, { collar: .1, sole: .015, heel: .008, ...o }, tone, "sole", "Boot");
  for (const side of ["l", "r"]) {
    const leg = shaft(body, m, side, { from, ease, foot: .07 }), piece = new Piece().shell(leg.s);
    if (cuff) band(piece, leg.s, highest(leg), { width: cuff * m.k, rise: .003 * m.k });
    parts.push(part(piece, tone, "calf_" + side, "Boot shaft", "leather"));
    if (cuff) {
      const { leather, metal } = bootFastenings(body, m, side, leg.s);
      if (leather.count) parts.push(part(leather, "sole", "calf_" + side, "Boot straps", "leather"),
        part(metal, "metal", "calf_" + side, "Boot buckles", "metal"));
    }
    shafts.push(leg.s);
  }
  return shafts;
}
const highest = g => g.all.reduce((best, loop) => !best || meanY(g.s, loop) > meanY(g.s, best) ? loop : best, null);
const meanY = (s, loop) => loop.reduce((t, i) => t + s.pos[i * 3 + 1], 0) / loop.length;

export function finish(g, k, { neck = 0, cuff = 0, hem = 0, legs = 0, waist = 0, rise = .0015, thickness } = {}) {
  const piece = new Piece().shell(g.s, { thickness });
  if (neck) band(piece, g.s, g.upper, { width: neck * k, rise: rise * k });
  if (waist) band(piece, g.s, g.upper, { width: waist * k, rise: rise * k });
  if (hem) band(piece, g.s, g.lower, { width: hem * k, rise: rise * k });
  if (cuff) for (const loop of g.sleeves) band(piece, g.s, loop, { width: cuff * k, rise: rise * k });
  if (legs) for (const loop of g.legs) band(piece, g.s, loop, { width: legs * k, rise: rise * k });
  return piece;
}
const overWaist = (m, room) => y => room * smooth(m.waistband + .04 * m.k, m.waistband + .012 * m.k, y);

export function front(piece, cast, body, m, { top, bottom, width = .032, rise = .004, buttons = 0, x = 0, buttonTone = null }) {
  const k = m.k;
  patch(piece, cast, body, { centre: [x, (top + bottom) / 2, m.chest[2]], facing: [0, 0, 1], across: [1, 0, 0], width: width * k, height: top - bottom, rise: rise * k, nx: 2, ny: 26 });
  const studs = buttonTone ? new Piece() : piece;
  for (let i = 0; i < buttons; i++) button(studs, cast, body, { centre: [x, mix(top - .03 * k, bottom + .04 * k, buttons === 1 ? 0 : i / (buttons - 1)), m.chest[2]], facing: [0, 0, 1], radius: .0075 * k, rise: (rise + .0035) * k });
  return studs;
}
export function pocket(piece, cast, body, m, { x, y, width = .1, height = .11, facing = [0, 0, 1], across = [1, 0, 0], flap = true, rise = .0045, z = m.chest[2], skin = p => body.trunkAt(p) }) {
  const k = m.k, centre = [x, y, z];
  const depth = dy => cast([x - facing[0] * .6, y + dy - facing[1] * .6, z - facing[2] * .6].map((c, n) => c + 2 * facing[n] * .6), facing.map(c => -c));
  const top = depth(height * k * .5), mid = depth(0), low = depth(-height * k * .5);
  if (![top, mid, low].every(Number.isFinite) || Math.abs(top - low) > height * k * .25 || (top + low) / 2 - mid > .005 * k) return;
  patch(piece, cast, body, { centre, facing, across, width: width * k, height: height * k, rise: rise * k, skin });
  if (flap) patch(piece, cast, body, { centre: [x, y + height * k * .36, z], facing, across, width: (width + .008) * k, height: height * k * .34, rise: (rise + .004) * k, ny: 2, skin });
}
function jeans(body, m, o = {}) {
  const k = m.k, g = garment(body, m, { waist: m.waistband, taper: .07, ease: .008, ...o }), piece = finish(g, k, { waist: .032, legs: .014, rise: .002 });
  return { g, piece };
}
function backPockets(piece, g, body, m) {
  const cast = caster([g.s]);
  for (const sign of [1, -1]) pocket(piece, cast, body, m, { x: sign * .078 * m.k, y: m.hip + .025 * m.k, facing: [sign * .3, 0, -1], across: [1, 0, sign * .3], width: .115, height: .12, flap: false, rise: .002, z: m.pelvis[2] });
}
function cargoPockets(piece, g, body, m) {
  const cast = caster([g.s]), k = m.k;
  for (const sign of [1, -1]) {
    const hip = body.joint(sign > 0 ? "thigh_l" : "thigh_r"), knee = body.joint(sign > 0 ? "calf_l" : "calf_r");
    pocket(piece, cast, body, m, { x: mix(hip[0], knee[0], .62), y: mix(hip[1], knee[1], .62), z: mix(hip[2], knee[2], .62), facing: [sign, 0, 0], across: [0, 0, 1], width: .13, height: .15, rise: .006 });
  }
}

export const outfits = {
  "T-shirt and jeans"(body, m) {
    const parts = [], k = m.k, lower = jeans(body, m);
    backPockets(lower.piece, lower.g, body, m);
    parts.push(part(lower.piece, "dark", "pelvis", "Jeans"));
    const tee = garment(body, m, { sleeve: .5, hem: m.hip - .02 * k, ease: .008, fall: .16, extra: overWaist(m, .006), under: [lower.piece] });
    parts.push(part(finish(tee, k, { neck: .013, cuff: .016, hem: .016, rise: .0018 }), "main", "spine_03", "T-shirt"));
    shoes(body, m, parts, { collar: .06, sole: .014 }, "light", "light", "Trainer");
    return parts;
  },
  "Hoodie and joggers"(body, m) {
    const parts = [], k = m.k;
    const legs = garment(body, m, { waist: m.waistband, leg: 1.92, ease: .013, taper: .11, flare: .8 });
    parts.push(part(finish(legs, k, { legs: .04, rise: .003 }), "dark", "pelvis", "Joggers"));
    const fleece = garment(body, m, { sleeve: 1.9, hem: m.hip - .035 * k, ease: .016, fall: .12, tension: 1, span: 2.4, sleeveFall: .1, sleeveEase: .004, passes: 8, neck: {}, under: [legs.s] });
    const piece = finish(fleece, k, { cuff: .045, hem: .05, rise: .003 }), cast = caster([fleece.s]);
    hood(piece, body, [fleece.s], fleece.s, fleece.upper, m, { length: .17, thick: .024, stand: .026 });
    patch(piece, cast, body, { centre: [0, m.waist - .03 * k, m.chest[2]], facing: [0, 0, 1], across: [1, 0, 0], width: .27 * k, height: .13 * k, rise: .005 * k, nx: 8 });
    for (const sign of [1, -1]) patch(piece, cast, body, { centre: [sign * .032 * k, m.neck[1] - .1 * k, m.chest[2]], facing: [0, 0, 1], across: [1, 0, 0], width: .006 * k, height: .12 * k, rise: .004 * k, nx: 1, ny: 8 });
    parts.push(part(piece, "main", "spine_03", "Hoodie"));
    shoes(body, m, parts, { collar: .062, sole: .016 }, "light", "light", "Trainer");
    return parts;
  },
  "Shirt and chinos"(body, m) {
    const parts = [], k = m.k;
    const shirt = garment(body, m, { sleeve: 1.42, hem: m.waistband - .03 * k, ease: .008, fall: .16, sleeveFall: .5, sleeveEase: .003, neck: { v: .05 } });
    const top = finish(shirt, k, { cuff: .04, rise: .004 }), cast = caster([shirt.s]);
    collar(top, shirt.s, shirt.upper, m, {});
    const studs = front(top, cast, body, m, { top: m.neck[1] - .05 * k, bottom: m.waistband + .0 * k, buttons: 5, buttonTone: "light" });
    pocket(top, cast, body, m, { x: .085 * k, y: m.chest[1] + .11 * k, width: .085, height: .09, flap: false, rise: .002 });
    parts.push(part(top, "main", "spine_03", "Shirt"), part(studs, "light", "spine_03", "Buttons"));
    const legs = garment(body, m, { waist: m.waistband + .012 * k, taper: .05, ease: .011 }), lower = finish(legs, k, { legs: .012 });
    backPockets(lower, legs, body, m);
    parts.push(part(lower, "dark", "pelvis", "Chinos"));
    const leather = new Piece(), metal = new Piece();
    belt(leather, body, m, [legs.s], m.waistband - .008 * k, { buckle: false });
    buckle(metal, body, m, [legs.s], m.waistband - .008 * k);
    parts.push(part(leather, "leather", "pelvis", "Belt", "leather"), part(metal, "metal", "pelvis", "Buckle", "metal"));
    shoes(body, m, parts, { collar: .052, sole: .008, heel: .01 });
    return parts;
  },
  "Sweater and skirt"(body, m) {
    const parts = [], k = m.k;
    const tights = garment(body, m, { waist: m.waistband, leg: 1.97, ease: .0025, gap: .0015, taper: 9, passes: 2 });
    parts.push(part(new Piece().shell(tights.s, { close: false }), "dark", "pelvis", "Tights"));
    const knit = garment(body, m, { sleeve: 1.93, hem: m.waist - .05 * k, ease: .013, fall: .15, tension: 1, span: 2.2, sleeveFall: .15, passes: 8, neck: {} });
    parts.push(part(finish(knit, k, { neck: .028, cuff: .05, rise: .004 }), "main", "spine_03", "Sweater"));
    const lower = skirt(body, m, { top: m.waist + .005 * k, bottom: m.knee + .01 * k, ease: .01, flare: .14, fold: .007, shells: [tights.s, knit.s], yoke: .012, drape: { cloth: "skirt" } });
    belt(lower.piece, body, m, [knit.s, lower.piece], m.waist - .012 * k, { height: .04, thick: .003, buckle: false });
    parts.push(part(lower.piece, "accent", "pelvis", "Skirt"));
    shoes(body, m, parts, { collar: .11, sole: .01, heel: .022 }, "leather", "sole", "Ankle boot");
    return parts;
  },
  "Day dress"(body, m) {
    const parts = [], k = m.k, seam = m.waist - .01 * k;
    const bodice = garment(body, m, { sleeve: .36, hem: seam - .02 * k, ease: .008, fall: .25, tension: 1, span: 2, below: .16, rise: .5, neck: { scoop: .07, scoopWidth: .08 } });
    const piece = finish(bodice, k, { neck: .01, cuff: .012, rise: .0015 });
    const lower = skirt(body, m, { top: seam + .01 * k, bottom: m.knee - .05 * k, ease: .012, flare: .24, fold: .011, folds: 18, shells: [bodice.s], yoke: .012, drape: { cloth: "dress" } });
    parts.push(part(piece, "main", "spine_03", "Dress bodice"), part(lower.piece, "main", "pelvis", "Dress skirt"));
    const sash = new Piece();
    belt(sash, body, m, [bodice.s, lower.piece], seam, { height: .04, thick: .0065, buckle: false });
    parts.push(part(sash, "dark", "spine_01", "Sash"));
    shoes(body, m, parts, { collar: .04, sole: .006, heel: .004 }, "dark", "sole", "Flat");
    return parts;
  },
  "Evening gown"(body, m) {
    const k = m.k, seam = m.waist - .027*k, parts = [];
    const bodice = garment(body, m, { sleeve: .27, hem: seam - .026*k, ease: .008, fall: .18, below: .16, rise: .5,
      neck: { height: -.023, scoop: .105, scoopWidth: .117, wide: .07 } });
    const top = finish(bodice, k, { neck: .012, cuff: .014 });
    parts.push(part(top, "main", "spine_03", "Evening bodice", "satin"));
    const skirtTop = seam + .015*k, skirtEnd = m.ankle + .045*k;
    const lower = skirt(body, m, { top: skirtTop, bottom: skirtEnd, ease: .013, flare: .075,
      fold: .031, folds: 8, cols: 84, shells: [bodice.s], yoke: .018, gores: true, drape: { cloth: "gown" } });
    const tau = Math.PI*2;
    const angle = (u,v) => { const gap = .12 + .69*v; return gap + u*(tau-2*gap) + .29 - .4*v; };
    const atHip = a => .5 + .5 * Math.cos(a - 1.2);
    const fall = a => .71 + .10*(1-Math.cos(a)) - .25*atHip(a)**3;
    const at = (d,a,lift=0) => lower.pointAt(d,a,lift*k);
    const pleat = (u, v, a) => {
      const tuck = atHip(a);
      const gather = .5 + .5*Math.cos(25*v + 4*(1-Math.cos(a-1.2)) - 3*Math.sin(a));
      const swag = (.005 + .017*tuck*tuck) * gather**2 * Math.sin(Math.PI*v)**.7;
      const hanging = (.006 + .010*v) * (1 + Math.sin(a*7 - 1.9*v + .55*Math.sin(a*2)));
      return (swag + hanging) * Math.min(1, u*22, (1-u)*22) * smooth(1,.93,v) * smooth(0,.13,v);
    };
    const panel = (u,v) => {
      const a = angle(u,v);
      return at(.012*smooth(0,.1,v) + fall(a)*v, a, pleat(u,v,a));
    };
    const leftSign = Math.sign(body.joint("thigh_l")[0]);
    const skin = p => {
      const thigh = smooth(m.hip+.04*k, m.hip-.16*k, p[1]);
      const shin = thigh*.6*smooth(m.knee+.025*k, m.knee-.14*k, p[1]);
      const l = smooth(-.09*k,.09*k,leftSign*p[0]);
      return body.blend([["pelvis",1-thigh],["thigh_l",l*(thigh-shin)],["thigh_r",(1-l)*(thigh-shin)],
        ["calf_l",l*shin],["calf_r",(1-l)*shin]]);
    };
    const grid = (rows,cols,get) => Array.from({length:rows+1},(_,i) =>
      Array.from({length:cols+1},(_,j) => get(j/cols,i/rows)));
    const field = new Piece(), wrap = new Piece(), edging = new Piece();
    const sheet = (piece, rows, cols, get, relief) => {
      const base = piece.count;
      piece.loft(grid(rows,cols,get),skin,{closed:false,flip:true});
      if (relief) foldRelief(piece, base, rows, cols, relief);
    };
    const wrapRows = 22, wrapColumns = 72;
    sheet(wrap,wrapRows,wrapColumns,(u,v) => panel(u,v*.967), (u,v) => {
      const a = angle(u,v*.967);
      return lower.relief(.012 + fall(a)*v*.967, a) + (pleat(u,v*.967,a) - .012)*k;
    });
    wrap.clothGrid = [wrapRows+1,wrapColumns+1];
    sheet(edging,1,72,(u,v) => panel(u,.967+v*.033));
    sheet(field,16,20,(u,v) => {
      const left = angle(1,v)-tau, right = angle(0,v);
      const a = mix(left,right,u);
      return at(.012+v*fall(a),a);
    }, (u,v) => { const a = mix(angle(1,v)-tau, angle(0,v), u); return lower.relief(.012+v*fall(a), a); });
    for (const [start,end,cols] of [[angle(0,1),angle(1,1),72],[angle(1,1)-tau,angle(0,1),20]]) {
      const hemPoint = (u,v) => {
        const a = mix(start,end,u), d = mix(.012+fall(a),1,v);
        return at(d,a);
      };
      sheet(field,10,cols,hemPoint, (u,v) => { const a = mix(start,end,u); return lower.relief(mix(.012+fall(a),1,v), a); });
      sheet(field,2,cols,(u,v) => at(1-.024*v,mix(start,end,u),-.005*v));
    }
    if (lower.rig) for (const piece of [field, wrap, edging]) piece.clothJoints = lower.rig;
    parts.push(part(field, "main", "pelvis", "Gored satin skirt", "satin"),
      part(wrap, "dark", "pelvis", "Gathered overskirt", "satin"),
      part(edging, "accent", "pelvis", "Overskirt binding", "satin"));
    const sash = new Piece();
    belt(sash, body, m, [bodice.s, lower.piece], seam, { height: .047, thick: .004, buckle: false });
    parts.push(part(sash, "dark", "spine_01", "Sash", "satin"));
    shoes(body, m, parts, { collar: .05, sole: .008, heel: .025 }, "dark", "sole", "Dress shoe");
    return parts;
  },
  "Running kit"(body, m) {
    const parts = [], k = m.k;
    const shorts = garment(body, m, { waist: m.waistband, leg: .58, ease: .014, taper: .02, flare: .3 });
    parts.push(part(finish(shorts, k, { waist: .03, legs: .012, rise: .002 }), "dark", "pelvis", "Shorts"));
    const vest = garment(body, m, { sleeve: .06, hem: m.hip + .0 * k, ease: .009, fall: .2, neck: { scoop: .05, scoopWidth: .07 }, extra: overWaist(m, .008), under: [shorts.s] });
    parts.push(part(finish(vest, k, { neck: .012, cuff: .012, hem: .012 }), "main", "spine_03", "Vest"));
    const socks = new Piece();
    for (const side of ["l", "r"]) { const sock = shaft(body, m, side, { from: 1.84, ease: .003, taper: 9, foot: .05 }); socks.shell(sock.s); }
    parts.push(part(socks, "light", "pelvis", "Socks"));
    shoes(body, m, parts, { collar: .06, sole: .018 }, "accent", "light", "Trainer");
    return parts;
  },
  "Coveralls"(body, m) {
    const parts = [], k = m.k;
    const suit = garment(body, m, { sleeve: 1.93, leg: 1.93, ease: .014, fall: .15, tension: 1, span: 2.2, taper: .035, sleeveFall: .12, passes: 7, neck: { v: .045 } });
    const piece = finish(suit, k, { cuff: .03, legs: .03, rise: .003 }), cast = caster([suit.s]);
    collar(piece, suit.s, suit.upper, m, { stand: .02, fall: .04 });
    front(piece, cast, body, m, { top: m.neck[1] - .045 * k, bottom: m.crotch + .07 * k, width: .022 });
    for (const sign of [1, -1]) pocket(piece, cast, body, m, { x: sign * .09 * k, y: m.chest[1] + .1 * k, width: .1, height: .1 });
    cargoPockets(piece, suit, body, m);
    parts.push(part(piece, "main", "spine_03", "Coveralls"));
    const webbing = new Piece(), metal = new Piece();
    belt(webbing, body, m, [suit.s], m.waist - .01 * k, { height: .04, thick: .003, buckle: false });
    buckle(metal, body, m, [suit.s], m.waist - .01 * k, .04);
    parts.push(part(webbing, "dark", "spine_01", "Belt"), part(metal, "metal", "spine_01", "Buckle", "metal"));
    shoes(body, m, parts, { collar: .12, sole: .017, heel: .008, toe: .006 }, "leather", "sole", "Work boot");
    return parts;
  },
  "Chore jacket"(body, m) {
    const parts = [], k = m.k, lower = jeans(body, m, { taper: .035, ease: .012 });
    cargoPockets(lower.piece, lower.g, body, m);
    parts.push(part(lower.piece, "dark", "pelvis", "Work trousers"));
    const tee = garment(body, m, { sleeve: .3, hem: m.waistband - .02 * k, ease: .005, neck: {} });
    parts.push(part(new Piece().shell(tee.s), "light", "spine_03", "Undershirt"));
    const coat = garment(body, m, { sleeve: 1.93, hem: m.hip - .05 * k, ease: .017, fall: .1, tension: 1, span: 2.4, sleeveFall: .1, passes: 8, neck: { v: .1 }, under: [lower.g.s, tee.s] });
    const piece = finish(coat, k, { cuff: .028, hem: .02, rise: .0025 }), cast = caster([coat.s]);
    collar(piece, coat.s, coat.upper, m, { stand: .022, fall: .046 });
    const studs = front(piece, cast, body, m, { top: m.neck[1] - .1 * k, bottom: m.hip - .04 * k, width: .03, buttons: 4, buttonTone: "metal" });
    pocket(piece, cast, body, m, { x: .09 * k, y: m.chest[1] + .1 * k, width: .1, height: .1, flap: false });
    for (const sign of [1, -1]) pocket(piece, cast, body, m, { x: sign * .1 * k, y: m.waistband - .03 * k, width: .13, height: .14, flap: false });
    parts.push(part(piece, "main", "spine_03", "Chore jacket"), part(studs, "metal", "spine_03", "Buttons", "metal"));
    shoes(body, m, parts, { collar: .12, sole: .017, heel: .008, toe: .006 }, "leather", "sole", "Work boot");
    return parts;
  },
  "Workshop apron"(body, m) {
    const parts = [], k = m.k;
    const legs = garment(body, m, { waist: m.waistband + .012 * k, taper: .05, ease: .011 });
    const shirt = garment(body, m, { sleeve: 1.3, hem: m.waistband - .03 * k, ease: .008, fall: .16, sleeveFall: .4, sleeveEase: .003, neck: { v: .04 } });
    const top = finish(shirt, k, { cuff: .045, rise: .0045 });
    collar(top, shirt.s, shirt.upper, m, {});
    parts.push(part(top, "light", "spine_03", "Shirt"), part(finish(legs, k, { waist: .03, legs: .012 }), "dark", "pelvis", "Trousers"));
    const made = apron(body, m, [shirt.s, legs.s]), cast = caster([shirt.s, legs.s]);
    parts.push(part(made.piece, "main", "spine_02", "Apron", "leather"), part(made.ties, "leather", "spine_02", "Apron ties", "leather"));
    shoes(body, m, parts, { collar: .11, sole: .015, heel: .008 }, "leather", "sole", "Work boot");
    return parts;
  },
  "Overcoat"(body, m) {
    const parts = [], k = m.k, seam = m.waist - .015 * k;
    const legs = garment(body, m, { waist: m.waistband, taper: .05, ease: .01 });
    parts.push(part(finish(legs, k, { legs: .012 }), "dark", "pelvis", "Trousers"));
    const coat = garment(body, m, { sleeve: 1.95, hem: seam - .02 * k, ease: .02, fall: .08, tension: 1, span: 2.6, sleeveFall: .08, passes: 9, neck: { v: .09 } });
    const piece = finish(coat, k, { cuff: .03, rise: .002 }), cast = caster([coat.s]);
    collar(piece, coat.s, coat.upper, m, { stand: .026, fall: .056 });
    const tails = skirt(body, m, { top: seam + .012 * k, bottom: m.knee + .0 * k, ease: .02, flare: .07, fold: .006, folds: 9, shells: [coat.s, legs.s] });
    const studs = front(piece, cast, body, m, { top: m.neck[1] - .1 * k, bottom: seam + .03 * k, width: .03, buttons: 3, buttonTone: "dark" });
    parts.push(part(piece, "main", "spine_03", "Overcoat"), part(tails.piece, "main", "pelvis", "Coat skirt"), part(studs, "dark", "spine_03", "Buttons"));
    const tie = new Piece(), scarf = new Piece();
    belt(tie, body, m, [coat.s], seam, { height: .04, thick: .005, buckle: true });
    parts.push(part(tie, "main", "spine_01", "Coat belt"));
    roll(scarf, coat.s, coat.upper, m, { radius: .019, front: .95, drop: -.01, out: .004, flat: 1.7, wraps: .3, sides: 14 });
    parts.push(part(scarf, "accent", "neck_01", "Scarf"));
    shoes(body, m, parts, { collar: .055, sole: .009, heel: .012 });
    return parts;
  },
  "Traveller"(body, m) {
    const parts = [], k = m.k, seam = m.waist - .01 * k;
    const legs = garment(body, m, { waist: m.waistband, leg: 1.6, ease: .009, taper: .25 });
    parts.push(part(new Piece().shell(legs.s), "dark", "pelvis", "Breeches"));
    const under = garment(body, m, { sleeve: 1.93, hem: seam - .03 * k, ease: .004, neck: {} });
    parts.push(part(finish(under, k, { cuff: .02, neck: .012 }), "light", "spine_03", "Undershirt"));
    const tunic = garment(body, m, { sleeve: 1.05, hem: seam - .02 * k, ease: .013, fall: .15, tension: 1, span: 2.2, sleeveFall: .12, sleeveEase: .004, passes: 7, neck: { v: .075 } });
    const piece = finish(tunic, k, { neck: .014, cuff: .018, rise: .002 });
    const tails = skirt(body, m, { top: seam + .012 * k, bottom: m.crotch - .12 * k, ease: .014, flare: .1, fold: .006, folds: 11, shells: [tunic.s, legs.s] });
    parts.push(part(piece, "main", "spine_03", "Tunic"), part(tails.piece, "main", "pelvis", "Tunic skirt"));
    const leather = new Piece(), metal = new Piece();
    const env = belt(leather, body, m, [tunic.s], seam, { height: .042, thick: .005, buckle: false });
    buckle(metal, body, m, [tunic.s], seam, .042);
    const at = env.point(.05 * k + .05 * k, 1.15, env.sample(.05 * k, 1.15) + .03 * k);
    pod(leather, at, [[.04 * k, 0, -.02 * k], [0, .05 * k, 0], [.012 * k, 0, .024 * k]], body.rigid("pelvis"), { power: 3.2 });
    parts.push(part(leather, "leather", "spine_01", "Belt and pouch", "leather"), part(metal, "metal", "spine_01", "Buckle", "metal"));
    const cloak = cape(body, m, [tunic.s, tails.piece], { bottom: m.knee - .1 * k });
    hood(cloak.piece, body, [tunic.s, { pos: cloak.piece.pos.slice(), tri: cloak.piece.tri.slice() }], tunic.s, tunic.upper, m, { length: .19, thick: .022, stand: .02, front: .45 });
    parts.push(part(cloak.piece, "accent", "spine_03", "Cloak"));
    boots(body, m, parts, { from: 1.32, cuff: .05, ease: .016 });
    return parts;
  },
  "Explorer"(body, m) {
    const parts = [], k = m.k, lower = jeans(body, m, { taper: .04, ease: .012 });
    cargoPockets(lower.piece, lower.g, body, m);
    parts.push(part(lower.piece, "dark", "pelvis", "Field trousers"));
    const coat = garment(body, m, { sleeve: 1.93, hem: m.hip - .04 * k, ease: .017, fall: .1, tension: 1, span: 2.4, sleeveFall: .1, passes: 8, neck: {} });
    const piece = finish(coat, k, { cuff: .03, hem: .02, rise: .0025 }), cast = caster([coat.s]);
    collar(piece, coat.s, coat.upper, m, { kind: "stand", stand: .04 });
    front(piece, cast, body, m, { top: m.neck[1] + .0 * k, bottom: m.hip - .03 * k, width: .03 });
    for (const sign of [1, -1]) {
      pocket(piece, cast, body, m, { x: sign * .09 * k, y: m.chest[1] + .1 * k, width: .1, height: .1 });
      pocket(piece, cast, body, m, { x: sign * .1 * k, y: m.waistband - .03 * k, width: .13, height: .13 });
    }
    parts.push(part(piece, "main", "spine_03", "Field jacket"));
    const pack = backpack(body, m, [coat.s]);
    if (pack) parts.push(part(pack.pack, "accent", "spine_03", "Backpack"), part(pack.gear, "leather", "spine_03", "Pack straps", "leather"));
    const webbing = new Piece();
    belt(webbing, body, m, [coat.s], m.waist - .02 * k, { height: .036, thick: .004 });
    parts.push(part(webbing, "leather", "spine_01", "Belt", "leather"));
    shoes(body, m, parts, { collar: .12, sole: .018, heel: .008, toe: .005 }, "leather", "sole", "Hiking boot");
    return parts;
  },
  "Parka"(body, m) {
    const parts = [], k = m.k, seam = m.waist - .02 * k;
    const footwear = [], shafts = boots(body, m, footwear, { from: 1.55, cuff: 0, ease: .011, sole: .02, toe: .006 });
    const legs = garment(body, m, { waist: m.waistband, taper: .03, ease: .015, leg: 1.85, over: shafts });
    parts.push(part(new Piece().shell(legs.s), "dark", "pelvis", "Snow trousers"));
    const coat = garment(body, m, { sleeve: 1.96, hem: seam - .02 * k, ease: .03, fall: .04, tension: 1, span: 3, sleeveFall: .04, sleeveEase: .004, passes: 10, neck: {} });
    const piece = finish(coat, k, { cuff: .035, rise: .003 }), cast = caster([coat.s]);
    const yoke = .016, tails = skirt(body, m, { top: seam + .012 * k, bottom: m.crotch - .1 * k, ease: .03, flare: .02, shells: [coat.s, legs.s], yoke });
    front(piece, cast, body, m, { top: m.neck[1] + .01 * k, bottom: seam + .02 * k, width: .04, rise: .004 });
    for (const sign of [1, -1]) pocket(tails.piece, caster([{ pos: tails.piece.pos, tri: tails.piece.tri }]), body, m, { x: sign * .11 * k, y: m.hip + .01 * k, width: .13, height: .13, rise: .004, z: m.pelvis[2], skin: tails.skin });
    parts.push(part(piece, "main", "spine_03", "Parka"), part(tails.piece, "main", "pelvis", "Parka skirt"));
    const cord = new Piece(), trim = new Piece();
    belt(cord, body, m, [coat.s], seam + (.012 + yoke) * k, { height: .022, thick: .006, buckle: false });
    parts.push(part(cord, "dark", "spine_01", "Drawcord"));
    hood(piece, body, [coat.s], coat.s, coat.upper, m, { length: .2, thick: .03, stand: .024, front: .5 });
    roll(trim, coat.s, coat.upper, m, { radius: .024, front: .6, drop: -.008, out: .012, flat: .8, lumps: .2, sides: 12 });
    parts.push(part(trim, "light", "spine_03", "Fur trim", "hair"));
    for (const side of ["l", "r"]) { const glove = sleeveGuard(body, m, side, { from: 1.86, ease: .007, passes: 4 }); parts.push(part(new Piece().shell(glove.s), "leather", "hand_" + side, "Glove", "leather")); }
    parts.push(...footwear);
    return parts;
  },
  "Leather armour"(body, m) {
    const parts = [], k = m.k, seam = m.waist - .015 * k;
    const legs = garment(body, m, { waist: m.waistband, leg: 1.6, ease: .009, taper: .25 });
    parts.push(part(new Piece().shell(legs.s), "dark", "pelvis", "Breeches"));
    const tunic = garment(body, m, { sleeve: 1.93, hem: seam - .03 * k, ease: .008, fall: .18, sleeveFall: .3, sleeveEase: .003, neck: {} });
    const tails = skirt(body, m, { top: seam + .01 * k, bottom: m.crotch - .1 * k, ease: .012, flare: .1, fold: .006, folds: 11, shells: [tunic.s, legs.s] });
    parts.push(part(finish(tunic, k, { neck: .014 }), "main", "spine_03", "Tunic"), part(tails.piece, "main", "pelvis", "Tunic skirt"));
    const vest = garment(body, m, { sleeve: .05, hem: seam - .0 * k, ease: .02, gap: .015, fall: .15, tension: 1, span: 3, passes: 14, neck: { v: .03 } });
    const armour = finish(vest, k, { neck: .014, cuff: .014, hem: .02, rise: .004, thickness: .007 });
    for (const sign of [1, -1]) {
      const cap = plate(body, m, [(s, i) => s.anc[i * 3] * sign > 0 ? .42 - s.f.arm[i] : -1, (s, i) => s.f.arm[i] + .06, (s, i) => s.anc[i * 3 + 1] - (m.shoulder - .1 * k) + 10 * s.f.wArm[i]], { ease: .03, passes: 12, near: body.joint(sign > 0 ? "upperarm_l" : "upperarm_r") });
      const piece = new Piece().shell(cap.s, { thickness: .008 });
      for (const loop of cap.all) band(piece, cap.s, loop, { width: .014 * k, rise: .003 * k });
      parts.push(part(piece, "leather", sign > 0 ? "upperarm_l" : "upperarm_r", "Shoulder guard", "leather"));
      const side = sign > 0 ? "l" : "r", guard = sleeveGuard(body, m, side, { from: 1.2, to: 1.9, ease: .011, passes: 6, over: [tunic.s] }), bracer = new Piece().shell(guard.s, { thickness: .006 });
      for (const loop of guard.all) band(bracer, guard.s, loop, { width: .014 * k, rise: .003 * k });
      parts.push(part(bracer, "leather", "lowerarm_" + side, "Bracer", "leather"));
    }
    parts.push(part(armour, "leather", "spine_03", "Cuirass", "leather"));
    const strapPiece = new Piece(), metal = new Piece();
    belt(strapPiece, body, m, [vest.s], seam, { height: .045, thick: .006, buckle: false });
    buckle(metal, body, m, [vest.s], seam, .045);
    parts.push(part(strapPiece, "dark", "spine_01", "Belt", "leather"), part(metal, "metal", "spine_01", "Buckle", "metal"));
    boots(body, m, parts, { from: 1.28, cuff: .05, ease: .016 });
    return parts;
  },
  "Pressure suit"(body, m) {
    const parts = [], k = m.k;
    const suit = garment(body, m, { sleeve: 1.97, leg: 1.97, ease: .034, gap: .011, fall: .03, tension: 1, span: 3.2, taper: .02, sleeveFall: .03, sleeveEase: .004, passes: 12, soft: 10, neck: { height: .012 } });
    const piece = new Piece().shell(suit.s, { thickness: .01 }), rings = new Piece(), cast = caster([suit.s]);
    for (const loop of [...suit.sleeves, ...suit.legs]) band(rings, suit.s, loop, { width: .034 * k, rise: .011 * k });
    for (const sign of [1, -1]) pocket(piece, cast, body, m, { x: sign * .1 * k, y: m.waist + .02 * k, width: .11, height: .1, rise: .008 });
    patch(piece, cast, body, { centre: [0, m.chest[1] + .1 * k, m.chest[2]], facing: [0, 0, 1], across: [1, 0, 0], width: .17 * k, height: .11 * k, rise: .016 * k, nx: 6 });
    for (const x of [-.045, 0, .045]) button(rings, cast, body, { centre: [x * k, m.chest[1] + .1 * k, m.chest[2]], facing: [0, 0, 1], radius: .011 * k, rise: .022 * k });
    parts.push(part(piece, "main", "spine_03", "Pressure suit"));
    const hood = helmet(body, m), pack = backpack(body, m, [suit.s], { tanks: true });
    parts.push(Object.assign(part(hood.shell, "light", "head", "Helmet", "metal"), { helmet: true }), part(hood.trim, "metal", "spine_03", "Helmet ring", "metal"));
    if (pack) parts.push(part(pack.pack, "dark", "spine_03", "Air pack"), part(pack.gear, "light", "spine_03", "Air tanks", "metal"));
    const webbing = new Piece();
    belt(webbing, body, m, [suit.s], m.waist - .03 * k, { height: .05, thick: .008, buckle: true });
    parts.push(part(webbing, "dark", "spine_01", "Harness belt", "leather"), part(rings, "metal", "spine_03", "Lock rings", "metal"));
    for (const side of ["l", "r"]) { const glove = sleeveGuard(body, m, side, { from: 1.9, ease: .008, passes: 4 }); parts.push(part(new Piece().shell(glove.s), "dark", "hand_" + side, "Suit glove", "leather")); }
    shoes(body, m, parts, { collar: .13, sole: .024, heel: .004, toe: .01, ease: .012 }, "dark", "sole", "Suit boot");
    return parts;
  },
};

export function buckle(piece, body, m, shells, y, height = .034) {
  const probe = new Piece(), k = m.k, env = belt(probe, body, m, shells, y, { height, buckle: false });
  const p = env.point(.05 * k, 0, env.sample(.05 * k, 0) + .0075 * k), skin = body.trunkAt(p), h = height * k * .62, w = .021 * k, t = .0035 * k;
  for (const [dx, dy, sx, sy] of [[0, h, w + t, t], [0, -h, w + t, t], [w, 0, t, h], [-w, 0, t, h], [0, 0, t * .8, h]]) box(piece, [p[0] + dx, p[1] + dy, p[2]], [[sx, 0, 0], [0, sy, 0], [0, 0, t]], skin);
}

Object.assign(outfits, capsule);
