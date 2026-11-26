import {flightCap} from "./human-aviator.js";
import {knitCap} from "./human-watch-cap.js";
import * as T from "three";
import { Piece, add, clamp, cross, mix, noise3, smooth, sub, unit } from "./human-style-kit.js";
import { surfaceBody, surfaceFrame } from "./human-fringe.js";
import { randomStream } from "./random.js";

export const hatStyles = ["None", "Bucket hat", "Beret", "Flat cap", "Ribbed watch cap", "Flying cap and goggles"];
const DEG = Math.PI / 180, TAU = 2 * Math.PI;

const cuts = {
  "Flying cap and goggles": {front:18,side:-23,back:-30,tip:0,gap:.003,cloth:"leather"},
  "Ribbed watch cap": { front: 15, side: 8, back: -9, tip: 0, gap: .0065, cloth: "knit" },
  "Bucket hat": { front: 21, side: 10, back: -6, tip: 0, gap: .0065, cloth: "twill" },
  "Beret": { front: 25, side: 13, back: -2, tip: 5, gap: .006, cloth: "felt" },
  "Flat cap": { front: 15, side: 8, back: -9, tip: 0, gap: .006, cloth: "tweed" },
};

export function hatHead(f) {
  const turn = (u, a) => [u[0] * Math.cos(a) + u[2] * Math.sin(a), u[1], u[2] * Math.cos(a) - u[0] * Math.sin(a)];
  const sides = u => {
    const r = f.bone(u), flat = Math.hypot(u[0], u[2]) || 1e-9, w = smooth(.68, .86, Math.abs(u[0]) / flat) * smooth(.5, .34, u[1]);
    return w ? mix(r, Math.min(r, (f.bone(turn(u, 30 * DEG)) + f.bone(turn(u, -30 * DEG))) / 2), w) : r;
  };
  const crown = 70 * DEG, bone = u => {
    const high = Math.asin(clamp(u[1], -1, 1));
    if (high <= crown) return sides(u);
    const flat = Math.hypot(u[0], u[2]) || 1e-9, c = Math.cos(crown) / flat, base = sides([u[0] * c, Math.sin(crown), u[2] * c]);
    return mix(base > .5 * f.size ? base : f.radii[1], f.radii[1], smooth(crown, 90 * DEG, high));
  };
  const direction = (phi, eps) => { const c = Math.cos(eps); return unit([c * Math.sin(phi) * f.radii[0], Math.sin(eps) * f.radii[1], c * Math.cos(phi) * f.radii[2]]); };
  let earTop = f.earElevation ?? -Infinity;
  for (const side of [-1, 1]) for (let phi = 70; phi <= 120; phi += 5) for (let eps = 34; eps >= -24; eps -= 2) {
    const u = direction(side * phi * DEG, eps * DEG);
    if (f.bone(u) - bone(u) > .004 * f.k) { earTop = Math.max(earTop, eps * DEG); break; }
  }
  return {
    k: f.k, centre: f.centre, size: f.size, earTop, direction,
    place(phi, eps, h) { const u = direction(phi, eps), r = bone(u) + h; return [f.centre[0] + u[0] * r, f.centre[1] + u[1] * r, f.centre[2] + u[2] * r]; },
    over(p) { const d = sub(p, f.centre), r = Math.hypot(d[0], d[1], d[2]) || 1e-9, u = [d[0] / r, d[1] / r, d[2] / r], a = f.aim(p); return { phi: a.phi, eps: a.eps, r, u, h: r - bone(u) }; },
  };
}

function bandLine(f, cut) {
  const side = Math.max(cut.side * DEG, Number.isFinite(f.earTop) ? f.earTop + 5 * DEG : -1), front = cut.front * DEG, back = cut.back * DEG;
  const a = ((front + back) / 2 + side) / 2, b = (front - back) / 2, c = ((front + back) / 2 - side) / 2;
  return phi => a + b * Math.cos(phi) + c * Math.cos(2 * phi) + cut.tip * DEG * Math.sin(phi);
}

function evenHead(f) {
  return (phi, eps, h) => {
    let sum = [0, 0, 0];
    for (const [d, w] of [[-12, .2], [-6, .2], [0, .2], [6, .2], [12, .2]]) sum = add(sum, f.place(phi + d * DEG, eps, h), w);
    return sum;
  };
}

class Felt {
  constructor(skin) { this.piece = new Piece(); this.uv = []; this.skin = skin; }
  loft(rows, uv, { capEnd = false, flip = false } = {}) {
    const closed = rows.map(row => [...row, row[0]]), n = closed[0].length;
    this.piece.loft(closed, this.skin, { closed: false, flip: !flip });
    closed.forEach((row, i) => row.forEach((_, j) => this.uv.push(...uv(i, j / (n - 1)))));
    if (capEnd) {
      const last = closed.at(-1), centre = last.slice(0, -1).reduce((sum, p) => add(sum, p, 1), [0, 0, 0]).map(x => x / (n - 1));
      const hub = this.piece.vertex(centre, this.skin), base = this.piece.count - 1 - n;
      this.uv.push(...uv(rows.length, .5));
      for (let j = 0; j + 1 < n; j++) flip ? this.piece.tri.push(hub, base + j + 1, base + j) : this.piece.tri.push(hub, base + j, base + j + 1);
    }
    return this;
  }
  sheet(outer, inner, uv) {
    this.piece.slab(outer, inner, this.skin);
    for (const grid of [outer, inner]) grid.forEach((row, i) => row.forEach((_, j) => this.uv.push(...uv(i / (outer.length - 1), j / (row.length - 1)))));
    return this;
  }
  mesh(material, name) {
    const mesh = this.piece.mesh(material, "head", name), g = mesh.geometry, normal = g.attributes.normal, p = g.attributes.position;
    g.setAttribute("uv", new T.Float32BufferAttribute(this.uv, 2));
    const seen = new Map();
    for (let i = 0; i < p.count; i++) {
      const key = Math.round(p.getX(i) * 2e4) + "," + Math.round(p.getY(i) * 2e4) + "," + Math.round(p.getZ(i) * 2e4);
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key).push(i);
    }
    for (const list of seen.values()) {
      if (list.length < 2) continue;
      const n = new T.Vector3();
      for (const i of list) n.add(new T.Vector3().fromBufferAttribute(normal, i));
      if (n.length() < list.length * .75) continue;
      n.normalize();
      for (const i of list) normal.setXYZ(i, n.x, n.y, n.z);
    }
    return mesh;
  }
}

const cols = 40;
const ring = make => Array.from({ length: cols }, (_, j) => make(-Math.PI + TAU * j / cols, j));
const outward = (p, f) => unit([p[0] - f.centre[0], 0, p[2] - f.centre[2]]);

function clear(f, p, gap) {
  const o = f.over(p);
  return o.h >= gap ? p : add(f.centre, o.u, o.r + gap - o.h);
}

const makers = {
  "Bucket hat"(f, line, cut, gap, skin) {
    const k = f.k, head = evenHead(f), felt = new Felt(skin), rows = [], band = ring(phi => head(phi, line(phi), gap));
    const brim = (phi, p, s, under) => {
      const out = outward(p, f), wave = (noise3(Math.cos(phi) * 1.7 + 3, Math.sin(phi) * 1.7, 4.2) - .5) * .008 * k * s;
      const wide = (.039 + .004 * Math.cos(phi)) * k, q = add(add(p, out, wide * s), [0, 1, 0], -(.018 * k) * s ** 1.25 + wave);
      return under ? add(add(q, [0, 1, 0], -.0028 * k), out, s < 1 ? 0 : -.001 * k) : q;
    };
    rows.push(ring(phi => clear(f, head(phi, line(phi) + 5 * DEG, .0012 * k), .0008 * k)), ring(phi => clear(f, head(phi, line(phi), .0012 * k), .0008 * k)));
    for (const s of [.02, .35, .7, 1]) rows.push(band.map((p, j) => brim(-Math.PI + TAU * j / cols, p, s, true)));
    for (const s of [1, .7, .35, .04]) rows.push(band.map((p, j) => brim(-Math.PI + TAU * j / cols, p, s, false)));
    const lift = t => gap + k * (.0045 + .0095 * smooth(0, .34, t) - .0035 * smooth(.62, 1, t)), steps = [0, .1, .22, .36, .5, .62, .74, .86, .95];
    for (const t of steps) rows.push(ring(phi => clear(f, head(phi, mix(line(phi), 90 * DEG, t), lift(t)), gap)));
    const v = i => i / (rows.length);
    felt.loft(rows, (i, u) => [u, v(i)], { capEnd: true });
    return [{ felt, tone: "main", name: "Bucket hat" }];
  },
  "Beret"(f, line, cut, gap, skin) {
    const k = f.k, head = evenHead(f), felt = new Felt(skin), rim = new Felt(skin), lean = -105 * DEG;
    const full = phi => .5 + .5 * Math.cos(phi - lean), up = [0, 1, 0];
    const rows = [];
    for (const t of [0, .05, .12, .2, .3, .42, .55, .68, .8, .9, .96]) rows.push(ring(phi => {
      const w = full(phi), roll = Math.sin(Math.PI * Math.min(1, t / .46)) ** .75, p = head(phi, mix(line(phi), 90 * DEG, t), gap + k * (.003 + (.008 + .026 * w) * roll + .004 * w * (1 - t)));
      return clear(f, add(p, up, -k * (.004 + .016 * w) * roll * (1 - t)), gap);
    }));
    felt.loft(rows, (i, u) => [u, i / rows.length], { capEnd: true });
    const crest = clear(f, f.place(lean, 84 * DEG, 0), gap + .004 * k);
    const tip = add(crest, up, .012 * k), stalk = new Felt(skin);
    stalk.loft([0, .5, 1].map(s => Array.from({ length: 6 }, (_, j) => add(add(mix3(add(crest, up, .003 * k), tip, s), [1, 0, 0], Math.cos(TAU * j / 6) * .0022 * k * (1 - .4 * s)), [0, 0, 1], Math.sin(TAU * j / 6) * .0022 * k * (1 - .4 * s)))), (i, u) => [u, .98], { capEnd: true });
    const grip = [[-.0045, .0012], [-.006, .004], [-.002, .0068], [.004, .0064], [.007, .0035], [.0065, .001]];
    rim.loft(grip.map(([rise, off]) => ring(phi => clear(f, head(phi, line(phi) + rise * k / f.size, gap * .2 + off * k), .0006 * k))), (i, u) => [u, i / grip.length], { flip: false });
    return [{ felt, tone: "main", name: "Beret" }, { felt: stalk, tone: "main", name: "Beret stalk" }, { felt: rim, tone: "trim", name: "Beret rim" }];
  },
  "Flat cap"(f, line, cut, gap, skin) {
    const k = f.k, head = evenHead(f), felt = new Felt(skin), peak = new Felt(skin), ahead = phi => ((1 + Math.cos(phi)) / 2) ** 1.6;
    const forward = unit([0, -.2, 1]);
    const rows = [ring(phi => clear(f, head(phi, line(phi) + 4 * DEG, .0012 * k), .0008 * k)), ring(phi => clear(f, head(phi, line(phi) - 2.5 * DEG * ahead(phi), .0012 * k), .0008 * k))];
    const lift = t => gap + k * (.002 + .009 * Math.sin(Math.PI * Math.min(1, t * 1.9)) * (1 - t) + .0015);
    for (const t of [0, .07, .16, .28, .42, .56, .7, .84, .95]) rows.push(ring(phi => {
      const reach = ahead(phi), body = head(phi, mix(line(phi), 90 * DEG, t), lift(t) + .005 * k * (1 - reach) * Math.sin(Math.PI * Math.min(1, t * 2.4)));
      const p = add(add(body, forward, .04 * k * reach * (1 - t) ** 1.15), [0, 1, 0], -.004 * k * reach * (1 - t) * smooth(0, .3, t));
      return clear(f, p, gap);
    }));
    felt.loft(rows, (i, u) => [u, i / rows.length], { capEnd: true });
    const across = 17, along = 6, reach = 64 * DEG, top = [], under = [];
    for (let i = 0; i < along; i++) {
      const s = i / (along - 1), a = [], b = [];
      for (let j = 0; j < across; j++) {
        const x = j / (across - 1) * 2 - 1, phi = x * reach, root = clear(f, head(phi, line(phi) - 1.5 * DEG, .0005 * k), .002 * k), far = .05 * k * Math.cos(x * Math.PI / 2) ** .62;
        const p = add(add(root, forward, far * s + .002 * k * s), [0, 1, 0], -(.007 * k) * x * x * s + .0015 * k * Math.sin(Math.PI * s));
        a.push(p); b.push(add(p, [0, 1, 0], -(.0034 * k) * (1 - .45 * s)));
      }
      top.push(a); under.push(b);
    }
    peak.sheet(top, under, (s, x) => [x, s]);
    const button = new Felt(skin), at = clear(f, f.place(0, 80 * DEG, 0), lift(.9) + .001 * k), axis = unit(sub(at, f.centre)), a1 = unit(cross(axis, [1, 0, 0])), a2 = cross(axis, a1);
    button.loft([[.0055, 0], [.0052, .002], [.003, .0034]].map(([r, h]) => Array.from({ length: 8 }, (_, j) => add(add(add(at, axis, h * k), a1, Math.cos(TAU * j / 8) * r * k), a2, Math.sin(TAU * j / 8) * r * k))), (i, u) => [u, .99], { capEnd: true });
    return [{ felt, tone: "main", name: "Flat cap" }, { felt: peak, tone: "main", name: "Cap peak", flat: true }, { felt: button, tone: "main", name: "Cap button" }];
  },
};
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

const maps = new Map();
function clothMaps(cloth, name, colour) {
  if (typeof document === "undefined") return null;
  const key = cloth + name + colour;
  if (maps.has(key)) return maps.get(key);
  const w = 512, h = 256, canvas = document.createElement("canvas"), relief = document.createElement("canvas");
  canvas.width = relief.width = w; canvas.height = relief.height = h;
  const ctx = canvas.getContext("2d"), rtx = relief.getContext("2d"), image = ctx.createImageData(w, h), high = rtx.createImageData(w, h);
  const base = new T.Color(colour), rgb = [base.r, base.g, base.b].map(c => c <= .0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - .055);
  const hash = (x, y) => { let n = Math.imul(x, 374761393) + Math.imul(y, 668265263); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967295; };
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i += 4) {
    const v = 1 - y / h;
    let light = 1, yarn = .5;
    if (cloth === "tweed") {
      const stripe = Math.floor(x / 10), rib = ((stripe % 2 ? x + y : x - y) % 4 + 4) % 4 < 2;
      const fleck = hash(x >> 1, y >> 1);
      light = (rib ? 1.16 : .8) * (fleck > .93 ? 1.5 : fleck < .08 ? .7 : 1) * (.95 + .1 * hash(x, y));
      yarn = rib ? .68 : .34;
    } else if (cloth === "felt") {
      const nap = hash(x, y) * .5 + hash(x >> 1, y >> 1) * .3 + hash(x >> 2, y >> 2) * .2;
      light = .9 + .2 * nap; yarn = .35 + .3 * nap;
    } else {
      const cord = ((x + y * 2) % 4 + 4) % 4 < 2;
      light = (cord ? 1.06 : .93) * (.97 + .06 * hash(x, y)); yarn = cord ? .6 : .42;
      const rows = name === "Bucket hat" ? [.13, .18, .23, .3, .35, .4, .83] : [], near = rows.some(r => Math.abs(v - r) < .006);
      if (near) { light *= .88; yarn = .2; }
    }
    for (let c = 0; c < 3; c++) image.data[i + c] = 255 * clamp(rgb[c] * light, 0, 1);
    high.data[i] = high.data[i + 1] = high.data[i + 2] = 255 * yarn;
    image.data[i + 3] = high.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0); rtx.putImageData(high, 0, 0);
  const map = new T.CanvasTexture(canvas), bump = new T.CanvasTexture(relief);
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = bump.anisotropy = 4;
  map.wrapS = bump.wrapS = T.RepeatWrapping;
  if (maps.size >= 12) { const oldest = maps.keys().next().value; for (const t of maps.get(oldest)) t.dispose(); maps.delete(oldest); }
  maps.set(key, [map, bump]);
  return maps.get(key);
}

export function hatColour(style = {}) {
  return style.hatColor ?? style.clothSecond ?? "#5a4a3c";
}

const balding = new Set(["None", "Buzz cut"]);
function tuckHair(f, line, gap, meshes, holdLength = false) {
  const limit = gap * .5, hold = 10 * DEG, ease = 30 * DEG;
  for (const mesh of meshes) {
    const position = mesh.geometry?.attributes?.position;
    if (!position) continue;
    mesh.geometry = mesh.geometry.clone();
    const p = mesh.geometry.attributes.position;
    let moved = 0;
    for (let i = 0; i < p.count; i++) {
      const at = [p.getX(i), p.getY(i), p.getZ(i)], o = f.over(at);
      if (o.h <= limit * .5 || o.h > .2) continue;
      const below = line(o.phi) - o.eps;
      if (below >= ease) continue;
      const pressed = limit * (1 - Math.exp(-o.h / limit)), h = mix(pressed, o.h, smooth(hold, ease, below));
      if (h >= o.h - 1e-5) continue;
      const r = o.r - o.h + h;
      const y = holdLength && o.eps < 0 ? at[1] : f.centre[1] + o.u[1] * r;
      p.setXYZ(i, f.centre[0] + o.u[0] * r, y, f.centre[2] + o.u[2] * r);
      moved++;
    }
    if (moved) { p.needsUpdate = true; mesh.geometry.computeBoundingBox(); mesh.geometry.computeBoundingSphere(); }
  }
}

export function fittedHat(surface, style, hair, material, plain = false) {
  const cut = cuts[style.hat];
  if (!cut) return [];
  const body = surfaceBody(surface), frame = surfaceFrame(surface), f = hatHead(frame);
  const flight = style.hat === "Flying cap and goggles";
  const line = flight ? phi => .35 - 1.12 * smooth(.32, 1.27, Math.abs(phi)) : bandLine(f, cut);
  const gap = (balding.has(style.hair ?? "None") ? .0032 : cut.gap) * f.k;
  tuckHair(f, line, gap, hair, flight);
  if (flight) return flightCap({ ...f, radii: frame.radii }, style, material, plain, body.rigid("head")[0][0]);
  if (style.hat === "Ribbed watch cap") {
    const skull = { ...f, radii: surfaceFrame(surface).radii };
    return [knitCap(skull, style, material, plain, body.rigid("head")[0][0], gap)];
  }
  const colour = "#" + new T.Color(hatColour(style)).getHexString(), trim = "#" + new T.Color(colour).multiplyScalar(.5).getHexString();
  const skin = body.rigid("head");
  return makers[style.hat](f, line, cut, gap, skin).map(part => {
    const tone = part.tone === "trim" ? trim : colour, m = material(tone, part.tone === "trim" ? "leather" : "cloth").clone();
    if (!plain) {
      m.roughness = part.tone === "trim" ? .55 : cut.cloth === "twill" ? .82 : .93;
      m.metalness = 0;
      const drawn = part.tone === "main" && part.name === style.hat || part.flat ? clothMaps(cut.cloth, part.name, tone) : null;
      if (drawn) { m.color.set(0xffffff); m.map = drawn[0]; m.bumpMap = drawn[1]; m.bumpScale = cut.cloth === "tweed" ? .0009 : .0006; }
    }
    m.side = T.DoubleSide;
    (m.userData ??= {}).fibreLOD = true;
    m.name = part.name;
    const mesh = part.felt.mesh(m, part.name);
    mesh.userData.hat = style.hat;
    return mesh;
  });
}
const worn = {
  work: { chance: .3, hats: [[5, "Flat cap"], [1, "Bucket hat"]] },
  smart: { chance: .17, hats: [[3, "Beret"], [2.5, "Flat cap"]] },
  dress: { chance: .2, hats: [[5, "Beret"], [1.5, "Bucket hat"]] },
  casual: { chance: .15, hats: [[4, "Bucket hat"], [2, "Flat cap"], [1.5, "Beret"]] },
  sun: { chance: .3, hats: [[6, "Bucket hat"], [1, "Flat cap"]] },
};
const wardrobes = {
  "Chore jacket": "work", "Workshop apron": "work", "Coveralls": "work", "Workshop overalls": "work", "Overshirt and denim": "work", "Field jacket and denim": "work",
  "Overcoat": "smart", "Tailored suit": "smart", "Shirt and chinos": "smart", "Striped shirt and jeans": "smart",
  "Sweater and skirt": "dress", "Day dress": "dress", "Striped blouse and skirt": "dress", "Shift dress": "dress", "Rib knit and full skirt": "dress",
  "T-shirt and jeans": "casual", "Hoodie and joggers": "casual", "Track top and leggings": "casual", "separates": "casual", "Bomber and wide trousers": "casual", "Rolled bomber and cuffed trousers": "casual",
  "Explorer": "sun", "Running kit": "sun",
};
const piled = /bun|crown braid|natural curls|afro|coil|top knot|high/i;

export function drawHat(seed, direction, look, hair = "None") {
  const draw = randomStream((seed ^ 0x7a3c91e5) >>> 0), layers = look.style?.tailor?.layers ?? [];
  let kind = wardrobes[look.wardrobe];
  if (look.wardrobe === "separates") {
    const short = layers.some(layer => layer.piece === "trousers" && layer.length < 1.2), hooded = layers.some(layer => layer.collar === "hood");
    if (hooded) kind = null;
    else if (short) kind = "sun";
    else if (direction === "Workwear" || layers.some(layer => layer.piece === "top" && (layer.stiff ?? 0) >= .55 && layer.front === "buttons" && !layer.collar)) kind = "work";
    else if (direction === "Smart") kind = "smart";
  }
  if (!kind || look.style?.armour || piled.test(hair)) return { hat: "None" };
  const rule = worn[kind], lean = direction === "Festive" ? .6 : direction === "Outdoors" && kind !== "smart" ? 1.4 : 1;
  if (draw() >= rule.chance * lean) {
    const flyingOutfit = ["Bomber and wide trousers", "Rolled bomber and cuffed trousers", "Explorer", "Field jacket and denim"].includes(look.wardrobe);
    if (flyingOutfit && randomStream((seed ^ 0x719a4b) >>> 0)() < .27) {
      return { hat: "Flying cap and goggles", hatColor: look.style?.leatherColor ?? "#6c4d39" };
    }
    const knit = randomStream((seed ^ 0x53ac47) >>> 0);
    if ((kind === "work" || kind === "casual") && knit() < .11 * lean) {
      const style = look.style ?? {};
      return { hat: "Ribbed watch cap", hatColor: quiet(style.clothSecond ?? style.clothColor ?? "#534d44", knit()) };
    }
    return { hat: "None" };
  }
  let at = draw() * rule.hats.reduce((sum, [weight]) => sum + weight, 0), hat = rule.hats.at(-1)[1];
  for (const [weight, name] of rule.hats) if ((at -= weight) < 0) { hat = name; break; }
  const s = look.style ?? {}, tones = [s.clothSecond, s.accentColor, s.leatherColor, s.clothColor].filter(Boolean), pickTone = draw();
  const light = colour => { const c = new T.Color(colour); return .299 * c.r + .587 * c.g + .114 * c.b; };
  let colour;
  if (hat === "Flat cap") colour = quiet(tones.find(tone => light(tone) < .34) ?? "#4c463f", pickTone);
  else if (hat === "Beret") colour = pickTone < .5 && s.accentColor ? s.accentColor : tones.find(tone => light(tone) < .3) ?? "#2f2a33";
  else colour = pickTone < .45 ? s.clothLight ?? "#e2d8c3" : pickTone < .8 ? s.clothSecond ?? "#8f8662" : "#b9a37c";
  return { hat, hatColor: "#" + new T.Color(colour).getHexString() };
}
function quiet(colour, k) {
  const c = new T.Color(colour), hsl = c.getHSL({ h: 0, s: 0, l: 0 });
  return "#" + new T.Color().setHSL(hsl.h, hsl.s * (.3 + .3 * k), clamp(hsl.l * .9 + .08, .16, .42)).getHexString();
}
