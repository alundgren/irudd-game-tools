import { finishMantle } from "./human-mantle-surface.js";
import { finishFootwear } from "./human-shoe-surface.js";
import { Piece, analyse, add, dot, lerp3, loops, mix, smooth, sub, unit } from "./human-style-kit.js";
import { band, belt, bootFastenings, box, button, caster, collar, garment, landmarks, patch, shaft, shoe, sleeveGuard } from "./human-style-cloth.js";
import { finishMail } from "./human-mail.js";
import { finishBreastplate, finishShoulder } from "./human-armour-surface.js";
import { armourMakers, armourPieces } from "./human-armour.js";

const colour = (value, label = "Colour") => ({ type: "colour", value, label });
const range = (label, min, max, value, step = (max - min) / 100) => ({ type: "range", label, min, max, value, step });
const choice = (label, options, value = options[0]) => ({ type: "choice", label, options, value });

export const tailorPieces = {
  top: {
    label: "Top or jacket",
    fields: {
      color: colour("#6f7f86"),
      material: choice("Material", ["cloth", "leather", "mail"]),
      sleeve: range("Sleeve end (0 shoulder, 1 elbow, 2 wrist)", 0.05, 1.97, 0.5),
      length: range("Hem (0 waist, 1 seat)", 0, 1, 0.6),
      ease: range("Room over the body, mm", 2, 40, 8, 1),
      stiff: range("Structure (0 soft, 1 holds its shape)", 0, 1, 0.2),
      neck: choice("Neckline", ["crew", "v", "scoop", "high"]),
      depth: range("Neck opening depth, mm", 0, 260, 60, 5),
      collar: choice("Collar", ["none", "shirt", "stand", "hood"]),
      front: choice("Front", ["plain", "placket", "zip", "buttons"]),
      buttons: range("Buttons", 0, 8, 4, 1),
      cuff: range("Cuff band, mm", 0, 60, 16, 1),
      hemBand: range("Hem band, mm", 0, 70, 16, 1),
      gather: range("Hem drawn in (0 hangs free, 1 snug)", 0, 1, 0),
      pockets: choice("Pockets", ["none", "chest", "hip", "chest and hip"]),
      trim: colour("#8f9296", "Buttons and zip"),
    },
  },
  trousers: {
    label: "Trousers or shorts",
    fields: {
      color: colour("#3c4656"),
      material: choice("Material", ["cloth", "leather"]),
      length: range("Leg end (1 knee, 2 ankle)", 0.3, 2.03, 2.03),
      rise: range("Waistband (0 low, 1 natural waist)", 0, 1, 0.55),
      ease: range("Room over the body, mm", 2, 40, 9, 1),
      fit: range("Leg shape (0 straight, 1 follows the leg)", 0, 1, 0.15),
      waistband: range("Waistband, mm", 0, 60, 32, 1),
      hemBand: range("Leg hem, mm", 0, 60, 14, 1),
      pockets: choice("Pockets", ["none", "back", "cargo", "back and cargo"]),
    },
  },
  boots: {
    label: "Boots",
    fields: {
      color: colour("#5b4334"),
      sole: colour("#2c2a28", "Sole"),
      material: choice("Material", ["leather", "cloth"]),
      fastening: choice("Shaft fastening", ["plain", "buckled"]),
      height: range("Top of the shaft (1 knee, 2 ankle)", 1.05, 1.9, 1.5),
      ease: range("Room over the leg, mm", 3, 40, 11, 1),
      straight: range("Shaft (0 follows the calf, 1 straight tube)", 0, 1, 0.5),
      cuff: range("Top band, mm", 0, 70, 40, 1),
      thick: range("Sole, mm", 4, 40, 15, 1),
      heel: range("Heel, mm", 0, 70, 8, 1),
      toe: range("Toe room, mm", 0, 20, 0, 1),
    },
  },
  shoes: {
    label: "Shoes",
    fields: {
      color: colour("#5b4334"),
      sole: colour("#2c2a28", "Sole"),
      material: choice("Material", ["leather", "cloth"]),
      collar: range("Height at the ankle, mm", 30, 140, 58, 1),
      thick: range("Sole, mm", 4, 40, 11, 1),
      heel: range("Heel, mm", 0, 70, 0, 1),
      toe: range("Toe room, mm", 0, 20, 0, 1),
    },
  },
  gloves: {
    label: "Gloves",
    fields: {
      color: colour("#7c8a6c"),
      material: choice("Material", ["leather", "cloth"]),
      from: range("Cuff (1 elbow, 2 wrist)", 1.3, 1.97, 1.86),
      ease: range("Room over the hand, mm", 2, 12, 4, 1),
      cuff: range("Cuff band, mm", 0, 50, 0, 1),
    },
  },
  belt: {
    label: "Belt",
    fields: {
      color: colour("#4a3a2c"),
      material: choice("Material", ["leather", "cloth"]),
      at: range("Height (0 hip band, 1 natural waist)", 0, 1, 0.5),
      height: range("Width, mm", 15, 70, 34, 1),
      buckle: choice("Buckle", ["frame", "none"]),
      trim: colour("#8f9296", "Buckle"),
    },
  },
};
Object.assign(tailorPieces, armourPieces);
export const tailorLimit = 12;

export function tailorLayer(piece, values = {}) {
  const spec = tailorPieces[piece];
  if (!spec) throw new Error("Unknown outfit piece.");
  return { piece, ...Object.fromEntries(Object.entries(spec.fields).map(([key, field]) => [key, field.value])), ...values };
}
export function tailorProblems(tailor) {
  if (!tailor || typeof tailor !== "object" || Array.isArray(tailor) ||
      Object.keys(tailor).some(key => key !== "layers")) return ["Use an object containing layers."];
  if (!Array.isArray(tailor.layers) || !tailor.layers.length || tailor.layers.length > tailorLimit)
    return ["Choose between 1 and " + tailorLimit + " outfit layers."];
  const problems = [];
  for (const [index, layer] of tailor.layers.entries()) {
    if (!layer || typeof layer !== "object" || Array.isArray(layer) ||
        !Object.hasOwn(tailorPieces, layer.piece)) {
      problems.push("Layer " + (index + 1) + " needs a known outfit piece.");
      continue;
    }
    const fields = tailorPieces[layer.piece].fields;
    for (const [key, value] of Object.entries(layer)) {
      if (key === "piece") continue;
      const label = layer.piece + "." + key;
      if (!Object.hasOwn(fields, key)) {
        problems.push(label + " is unavailable. Fields for " + layer.piece + " are " + Object.keys(fields).join(", ") + ".");
        continue;
      }
      const field = fields[key];
      if (field.type === "colour") {
        if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value))
          problems.push(label + " needs a six-digit hex colour.");
      } else if (field.type === "choice") {
        if (!field.options.includes(value)) problems.push(label + " accepts " + field.options.join(", ") + ".");
      } else if (!Number.isFinite(value) || value < field.min || value > field.max) {
        problems.push(label + " must be between " + field.min + " and " + field.max + ".");
      }
    }
  }
  return problems;
}
export function validTailor(tailor) {
  return tailorProblems(tailor).length === 0;
}
export function defaultTailor(clothColor = "#6f7f86") {
  return {
    layers: [
      tailorLayer("trousers"),
      tailorLayer("top", { color: clothColor, sleeve: 1.42, collar: "shirt", front: "buttons", neck: "v", depth: 50 }),
      tailorLayer("belt"),
      tailorLayer("shoes"),
    ],
  };
}

const mm = (value) => value / 1000;
const part = (piece, tone, region, name, type = "cloth") => ({ piece, tone, region, name, type });
const complete = (layer) => tailorLayer(layer.piece, layer);

function pocket(piece, cast, body, m, { x, y, z = m.chest[2], width = 0.1, height = 0.11, facing = [0, 0, 1], across = [1, 0, 0], flap = true, rise = 0.0028 }) {
  const k = m.k, centre = [x, y, z];
  patch(piece, cast, body, { centre, facing, across, width: width * k, height: height * k, rise: rise * k, skin: body.trunkAt });
  if (flap) patch(piece, cast, body, { centre: [x, y + height * k * 0.36, z], facing, across, width: (width + 0.008) * k, height: height * k * 0.34, rise: (rise + 0.0028) * k, ny: 2, skin: body.trunkAt });
}

function snug(s, weight, limit, least = 0.0012) {
  for (let i = 0; i < s.count; i++) {
    const w = weight(i);
    if (w <= 0) continue;
    const a = s.anchor(i), n = s.normal(i), d = dot(sub(s.at(i), a), n), most = typeof limit === "function" ? limit(i) : limit, floor = typeof least === "function" ? least(i) : least;
    s.set(i, lerp3(s.at(i), add(a, n, Math.min(Math.max(d, Math.min(floor, most)), most)), Math.min(1, w)));
  }
}

function clear(s, shells, margin) {
  if (!shells.length) return;
  const cell = 0.024, grid = new Map(), key = (x, y, z) => Math.floor(x / cell) + "," + Math.floor(y / cell) + "," + Math.floor(z / cell);
  for (const under of shells) for (let i = 0; i < under.count; i++) {
    const a = under.anchor(i), k = key(...a), d = dot(sub(under.at(i), a), under.normal(i));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push([a[0], a[1], a[2], d]);
  }
  for (let i = 0; i < s.count; i++) {
    const a = s.anchor(i), n = s.normal(i);
    let most = -Infinity;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++)
      for (const [x, y, z, d] of grid.get(key(a[0] + dx * cell, a[1] + dy * cell, a[2] + dz * cell)) ?? [])
        if ((x - a[0]) ** 2 + (y - a[1]) ** 2 + (z - a[2]) ** 2 < 0.022 ** 2) most = Math.max(most, d);
    const d = dot(sub(s.at(i), a), n);
    if (d < most + margin) s.set(i, add(s.at(i), n, most + margin - d));
  }
}

function cover(body, s, margin) {
  const over = new Float32Array(body.count).fill(-1), P = body.P, grid = new Map(), key = (x, y, z) => Math.floor(x / margin) + "," + Math.floor(y / margin) + "," + Math.floor(z / margin);
  for (const loop of loops(s)) for (const i of loop) {
    const a = s.anchor(i), k = key(...a);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(a);
  }
  for (let i = 0; i < s.count; i++) {
    const a = s.anchor(i), v = body.nearest(a, 1);
    if (v < 0 || (P[v * 3] - a[0]) ** 2 + (P[v * 3 + 1] - a[1]) ** 2 + (P[v * 3 + 2] - a[2]) ** 2 > 1e-8) continue;
    const d = dot(sub(s.at(i), a), s.normal(i));
    over[v] = over[v] < 0 ? d : Math.min(over[v], d);
  }
  for (let v = 0; v < body.count; v++) {
    if (over[v] < 0) continue;
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    open: for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++)
      for (const a of grid.get(key(x + dx * margin, y + dy * margin, z + dz * margin)) ?? [])
        if ((a[0] - x) ** 2 + (a[1] - y) ** 2 + (a[2] - z) ** 2 < margin * margin) { over[v] = -1; break open; }
  }
  return over;
}

function conceal(body, made) {
  const margin = 0.03 * body.scale, covers = made.map((layer) => (layer.covers ?? []).map((s) => cover(body, s, margin))), hidden = new Set(), P = body.P, N = body.N;
  for (const layer of covers) for (const over of layer) for (let v = 0; v < body.count; v++) if (over[v] > 0.0005) hidden.add(body.surface.ids[v]);
  made.forEach((layer, index) => {
    const others = covers.flatMap((list, other) => (other === index ? [] : list));
    if (!others.length) return;
    for (const { piece } of layer.parts) {
      const inside = new Uint8Array(piece.count);
      for (let i = 0; i < piece.count; i++) {
        const p = [piece.pos[i * 3], piece.pos[i * 3 + 1], piece.pos[i * 3 + 2]], v = body.nearest(p, 3);
        if (v < 0) continue;
        const d = (p[0] - P[v * 3]) * N[v * 3] + (p[1] - P[v * 3 + 1]) * N[v * 3 + 1] + (p[2] - P[v * 3 + 2]) * N[v * 3 + 2];
        inside[i] = others.some((over) => over[v] - 0.0005 > d) ? 1 : 0;
      }
      const tri = [];
      for (let t = 0; t < piece.tri.length; t += 3) if (!(inside[piece.tri[t]] && inside[piece.tri[t + 1]] && inside[piece.tri[t + 2]])) tri.push(piece.tri[t], piece.tri[t + 1], piece.tri[t + 2]);
      piece.tri = tri;
    }
  });
  return hidden;
}

function hood(piece, s, loop, m, cast) {
  if (!loop) return;
  const k = m.k, z0 = m.neck[2], sides = 10, rings = Array.from({ length: sides }, () => []);
  for (const i of loop) {
    const p = s.at(i), o = unit([p[0], 0, p[2] - z0]), back = smooth(1.45, 2.6, Math.abs(Math.atan2(p[0], p[2] - z0)));
    const deep = (0.004 + 0.017 * back) * k, tall = (0.006 + 0.082 * back * back) * k, centre = [p[0] + o[0] * deep * 0.9, p[1] + 0.004 * k - tall * back, p[2] + o[2] * deep * 0.9];
    const from = [p[0] + o[0] * 0.4, centre[1], p[2] + o[2] * 0.4], reach = back > 0 ? cast(from, [-o[0], 0, -o[2]]) : Infinity;
    if (Number.isFinite(reach)) for (const d of [0, 2]) centre[d] = mix(centre[d], from[d] - o[d] * (reach - deep * 0.9), back);
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      rings[j].push([centre[0] + o[0] * Math.cos(a) * deep, centre[1] + Math.sin(a) * tall, centre[2] + o[2] * Math.cos(a) * deep]);
    }
  }
  const skins = loop.map((i) => s.skin(i));
  piece.loft([...rings, rings[0]], (p, i, j) => skins[j]);
}

function top(body, m, layer, worn, later) {
  const k = m.k, parts = [], stiff = layer.stiff;
  const hem = mix(m.waist, m.crotch + 0.02 * k, layer.length), waists = worn.filter((w) => w.kind === "trousers");
  const seat = layer.collar === "none" ? 0 : -0.02;
  const openPlate = layer.collar === "stand" && later.some(outer => outer.piece === "cuirass" && outer.collar === "open");
  const depth = mm(layer.depth), neck = layer.neck === "v" ? { v: depth, height: seat } : layer.neck === "scoop" ? { scoop: depth, scoopWidth: 0.075, height: seat } : layer.neck === "high" ? { height: openPlate ? -.013 : .012 } : { height: seat };
  const band0 = waists.length ? Math.max(...waists.map((w) => w.waist)) : null;
  const g = garment(body, m, {
    sleeve: layer.sleeve, hem, ease: mm(layer.ease), neck,
    fall: mix(0.45, 0.06, stiff), tension: 1, span: mix(2, 2.8, stiff), sleeveFall: mix(0.5, 0.08, stiff), sleeveEase: stiff > 0.5 ? 0.004 : 0.002,
    passes: Math.round(mix(6, 9, stiff)),
    extra: band0 === null ? null : (y) => 0.006 * smooth(band0 + 0.04 * k, band0 + 0.012 * k, y),
    under: worn.filter((w) => w.shell).map((w) => w.shell),
  });
  const layered = worn.filter((w) => w.kind === "top").reduce((sum, w) => sum + w.ease + 0.004, 0), near = (mm(layer.ease) + layered) * k, least = near - mm(layer.ease) * 0.5 * k, y = (i) => g.s.anc[i * 3 + 1];
  const over = (i) => (band0 === null ? 0 : (Math.max(...waists.map((w) => w.ease)) + 0.005) * k * smooth(band0 + 0.02 * k, band0 - 0.01 * k, y(i)));
  snug(g.s, (i) => smooth(m.neck[1] - 0.075 * k, m.neck[1] - 0.005 * k, y(i)) * (1 - smooth(0.2, 0.6, g.s.f.wArm[i])), near, least);
  if (layer.sleeve < 0.3) snug(g.s, (i) => smooth(0.03, 0.25, g.s.f.wArm[i]) * smooth(0.3, 0.15, layer.sleeve), near, least);
  if (layer.gather) snug(g.s, (i) => layer.gather * smooth(hem + (mm(layer.hemBand) + 0.13) * k, hem + mm(layer.hemBand) * 0.6 * k, y(i)) * (1 - smooth(0.2, 0.6, g.s.f.wArm[i])), (i) => near + over(i), (i) => least + over(i));
  const thickness = layer.material === "leather" ? 0.006 : 0.004;
  clear(g.s, worn.filter((w) => w.shell).map((w) => w.shell), thickness + 0.0015 * k);
  const piece = new Piece().shell(g.s, { thickness }), rise = (stiff > 0.5 ? 0.0025 : 0.0018) * k;
  if (layer.cuff) for (const loop of g.sleeves) band(piece, g.s, loop, { width: mm(layer.cuff) * k, rise });
  if (layer.hemBand) band(piece, g.s, g.lower, { width: mm(layer.hemBand) * k, rise });
  if (layer.collar === "none" && layer.neck !== "high") band(piece, g.s, g.upper, { width: 0.013 * k, rise });
  const tuckedCollar = later.some(outer => outer.piece === "top" && outer.neck === "high" && outer.collar === "stand");
  if (layer.collar === "shirt" && !tuckedCollar) collar(piece, g.s, g.upper, m, stiff > 0.5 ? { stand: 0.02, fall: 0.042 } : {});
  if (layer.collar === "stand") collar(piece, g.s, g.upper, m, { kind: "stand", stand: openPlate ? .022 : .04 });
  const cast = caster([g.s]);
  if (layer.collar === "hood") hood(piece, g.s, g.upper, m, cast);
  const topY = m.neck[1] - (layer.neck === "v" ? depth + 0.02 : 0.045) * k, trim = new Piece();
  if (layer.front !== "plain" && topY > hem + 0.08 * k) {
    const zip = layer.front === "zip";
    patch(piece, cast, body, { centre: [0, (topY + hem) / 2, m.chest[2]], facing: [0, 0, 1], across: [1, 0, 0], width: (zip ? 0.024 : 0.032) * k, height: topY - hem, rise: 0.004 * k, nx: 2, ny: 26 });
    if (zip) {
      patch(trim, cast, body, { centre: [0, (topY + hem) / 2, m.chest[2]], facing: [0, 0, 1], across: [1, 0, 0], width: 0.008 * k, height: topY - hem - 0.01 * k, rise: 0.0065 * k, nx: 1, ny: 26 });
      patch(trim, cast, body, { centre: [0, topY - 0.012 * k, m.chest[2]], facing: [0, 0, 1], across: [1, 0, 0], width: 0.011 * k, height: 0.026 * k, rise: 0.007 * k, nx: 1, ny: 2 });
    } else if (layer.front === "buttons") {
      const count = Math.round(layer.buttons);
      for (let i = 0; i < count; i++) button(trim, cast, body, { centre: [0, mix(topY - 0.03 * k, hem + 0.04 * k, count === 1 ? 0 : i / (count - 1)), m.chest[2]], facing: [0, 0, 1], radius: 0.0075 * k, rise: 0.0075 * k });
    }
  }
  if (layer.pockets.includes("chest")) for (const sign of stiff > 0.5 ? [1, -1] : [1]) pocket(piece, cast, body, m, { x: sign * 0.088 * k, y: m.chest[1] + 0.1 * k, width: 0.095, height: 0.1, flap: stiff > 0.5 });
  if (layer.pockets.includes("hip") && hem < m.waist - 0.1 * k) for (const sign of [1, -1]) pocket(piece, cast, body, m, { x: sign * 0.1 * k, y: Math.max(hem + 0.09 * k, m.waistband - 0.03 * k), width: 0.13, height: 0.13, flap: false });
  parts.push(part(piece, layer.color, "spine_03", layer.collar === "hood" ? "Hooded top" : stiff > 0.5 ? "Jacket" : "Top", layer.material));
  if (trim.tri.length) parts.push(part(trim, layer.trim, "spine_03", layer.front === "zip" ? "Zip" : "Buttons", "metal"));
  return { parts, covers: [g.s], worn: { kind: "top", shell: g.s, ease: mm(layer.ease) } };
}

function trousers(body, m, layer, worn, later) {
  const k = m.k, waist = mix(m.belly, m.waist, layer.rise), boots = worn.find((w) => w.kind === "boots");
  const tucked = later.find((l) => l.piece === "boots" && l.height < layer.length);
  const g = garment(body, m, {
    waist, leg: layer.length, ease: mm(layer.ease), taper: 0.03 * 300 ** layer.fit, flare: layer.fit > 0.6 ? 4 : mix(0.8, 4, layer.fit / 0.6),
    legEase: boots && layer.length > boots.height ? Math.max(0, boots.ease + 0.004 - mm(layer.ease)) : 0,
    passes: layer.fit > 0.8 ? 3 : 6, under: worn.filter((w) => w.shell).map((w) => w.shell),
  });
  if (tucked) {
    snug(g.s, (i) => smooth(tucked.height - 0.1, tucked.height + 0.03, g.s.f.leg[i]) * smooth(0.3, 0.7, g.s.f.wLeg[i]), 0.0012 * k, 0.0012 * k);
  }
  const thickness = layer.material === "leather" ? 0.006 : 0.004;
  clear(g.s, worn.filter((w) => w.shell).map((w) => w.shell), thickness + 0.0015 * k);
  const piece = new Piece().shell(g.s, { thickness });
  if (layer.waistband) band(piece, g.s, g.upper, { width: mm(layer.waistband) * k, rise: 0.002 * k });
  if (layer.hemBand) for (const loop of g.legs) band(piece, g.s, loop, { width: mm(layer.hemBand) * k, rise: 0.002 * k });
  const cast = caster([g.s]);
  if (layer.pockets.includes("back")) for (const sign of [1, -1]) pocket(piece, cast, body, m, { x: sign * 0.078 * k, y: m.hip + 0.025 * k, z: m.pelvis[2], facing: [sign * 0.3, 0, -1], across: [1, 0, sign * 0.3], width: 0.115, height: 0.12, flap: false, rise: 0.002 });
  if (layer.pockets.includes("cargo") && layer.length > 0.9) for (const sign of [1, -1]) {
    const hip = body.joint(sign > 0 ? "thigh_l" : "thigh_r"), knee = body.joint(sign > 0 ? "calf_l" : "calf_r"), at = (d) => mix(hip[d], knee[d], 0.62);
    pocket(piece, cast, body, m, { x: at(0), y: at(1), z: at(2), facing: [sign, 0, 0], across: [0, 0, 1], width: 0.13, height: 0.15, rise: 0.006 });
  }
  return { parts: [part(piece, layer.color, "pelvis", layer.length < 1.2 ? "Shorts" : "Trousers", layer.material)], covers: [g.s], worn: { kind: "trousers", shell: g.s, ease: mm(layer.ease), length: layer.length, waist } };
}

function footwear(body, m, layer, worn, tall) {
  const parts = [], covers = [], k = m.k, name = tall ? "Boot" : "Shoe";
  let ground = body.floor;
  const ease = tall ? mm(layer.ease) : 0;
  for (const side of ["l", "r"]) {
    const made = shoe(body, m, side, { collar: tall ? 0.1 : mm(layer.collar), sole: mm(layer.thick), heel: mm(layer.heel), toe: mm(layer.toe), ease: tall ? Math.max(0.005, ease - 0.001) : 0.005 });
    parts.push(part(made.upper, layer.color, "foot_" + side, name, layer.material), { ...part(made.sole, layer.sole, "foot_" + side, name + " sole", "leather"), ground: made.ground });
    ground = Math.min(ground, made.ground);
    if (!tall) continue;
    const leg = shaft(body, m, side, { from: layer.height, ease, taper: 0.03 * 300 ** (1 - layer.straight), foot: 0.05 }), fit = Math.max(0.005, ease - 0.001) * k;
    snug(leg.s, (i) => smooth(body.floor + 0.2 * k, body.floor + 0.1 * k, leg.s.anc[i * 3 + 1]), fit + 0.0015 * k, fit);
    const piece = new Piece().shell(leg.s);
    covers.push(leg.s);
    if (layer.cuff) {
      const meanY = (loop) => loop.reduce((t, i) => t + leg.s.pos[i * 3 + 1], 0) / loop.length;
      band(piece, leg.s, leg.all.reduce((best, loop) => (!best || meanY(loop) > meanY(best) ? loop : best), null), { width: mm(layer.cuff) * k, rise: 0.003 * k });
    }
    parts.push(part(piece, layer.color, "calf_" + side, "Boot shaft", layer.material));
    if (layer.fastening === "buckled") {
      const { leather, metal } = bootFastenings(body, m, side, leg.s);
      if (leather.count) parts.push(part(leather, layer.sole, "calf_" + side, "Boot straps", "leather"),
        part(metal, "#a69574", "calf_" + side, "Boot buckles", "metal"));
    }
  }
  return { parts, covers, worn: { kind: tall ? "boots" : "shoes", height: tall ? layer.height : 2, ease, shafts: covers }, ground };
}

function gloves(body, m, layer) {
  const parts = [], covers = [];
  for (const side of ["l", "r"]) {
    const glove = sleeveGuard(body, m, side, { from: layer.from, ease: mm(layer.ease), passes: 3 }), piece = new Piece().shell(glove.s);
    covers.push(glove.s);
    if (layer.cuff) for (const loop of glove.all) band(piece, glove.s, loop, { width: mm(layer.cuff) * m.k, rise: 0.003 * m.k });
    parts.push(part(piece, layer.color, "hand_" + side, "Glove", layer.material));
  }
  return { parts, covers, worn: { kind: "gloves" } };
}

function waistBelt(body, m, layer, worn) {
  const k = m.k, shells = worn.filter((w) => w.shell).map((w) => w.shell), parts = [];
  if (!shells.length) return { parts, worn: { kind: "belt" } };
  const y = mix(m.waistband - 0.008 * k, m.waist - 0.01 * k, layer.at), strap = new Piece(), height = mm(layer.height);
  const env = belt(strap, body, m, shells, y, { height, buckle: false });
  parts.push(part(strap, layer.color, y > mix(m.waistband, m.waist, 0.5) ? "spine_01" : "pelvis", "Belt", layer.material));
  if (layer.buckle === "frame") {
    const metal = new Piece(), p = env.point(0.05 * k, 0, env.sample(0.05 * k, 0) + 0.0075 * k), skin = body.skinAt(p), h = height * k * 0.62, w = 0.021 * k, t = 0.0035 * k;
    for (const [dx, dy, sx, sy] of [[0, h, w + t, t], [0, -h, w + t, t], [w, 0, t, h], [-w, 0, t, h], [0, 0, t * 0.8, h]]) box(metal, [p[0] + dx, p[1] + dy, p[2]], [[sx, 0, 0], [0, sy, 0], [0, 0, t]], skin);
    parts.push(part(metal, layer.trim, parts[0].region, "Buckle", "metal"));
  }
  return { parts, worn: { kind: "belt" } };
}

const makers = { top, trousers, boots: (b, m, l, w) => footwear(b, m, l, w, true), shoes: (b, m, l, w) => footwear(b, m, l, w, false), gloves, belt: waistBelt, ...armourMakers };

export function tailorParts(body, m, tailor, options = {}) {
  if (!validTailor(tailor)) throw new Error("Unknown or out-of-range outfit piece.");
  const parts = [], worn = [], all = [];
  let ground = body.floor;
  const layers = tailor.layers.map(complete);
  for (const layer of layers) {
    const made = makers[layer.piece](body, m, layer, worn, layers.slice(worn.length + 1), options);
    parts.push(...made.parts);
    worn.push(made.worn);
    all.push(made);
    if (made.ground !== undefined) ground = Math.min(ground, made.ground);
  }
  return Object.assign(parts, { ground, hidden: conceal(body, all) });
}
export function tailorHuman(surface, tailor, material, finish = null, options = {}) {
  const body = analyse(surface), m = landmarks(body), parts = tailorParts(body, m, tailor, options), meshes = [];
  for (const made of parts) if (made.piece.tri.length) {
    const mesh = made.piece.mesh(material(made.tone, made.type === "mail" ? "cloth" : made.type), made.region, made.name);
    if (!options.plain) finishFootwear(mesh, made.piece.shoeUV);
    mesh.userData.styleType = made.type;
    if (made.type === "mail" && !options.plain) finishMail(mesh, m, made.linkColumns, made.piece.mailUV, Boolean(options.game));
    if (made.mantleFinish && !options.plain) finishMantle(mesh, made.piece.mantleUV, made.mantleFinish);
    if (made.plateFinish && !options.plain) finishBreastplate(mesh, made.plateFinish);
    const stamping = made.shoulderFinish ?? made.limbFinish;
    if (stamping && !options.plain) finishShoulder(mesh, made.piece.plateUV, stamping, Boolean(made.limbFinish));
    meshes.push(mesh);
  }
  finish?.(meshes, m);
  return Object.assign(meshes, { ground: parts.ground, hidden: parts.hidden });
}
