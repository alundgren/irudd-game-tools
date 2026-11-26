import { fittedBrow } from "./human-brow-styles.js";
import * as T from "three";
import { browCover, browRoots, chartDensity, chartHeight, chartPixel, chartPoint, chartWidth, faceChart } from "./human-face-chart.js";
import { facialHairStyle, growthAt } from "./human-face-hair.js";
import { randomStream } from "./random.js";

const W = chartWidth,
  H = chartHeight,
  D = chartDensity;

const kinds = {
  Freckles: { places: ["Nose and cheeks", "Cheeks", "Nose", "Whole face", "Forehead"], move: true, side: "Both", strength: 0.5, size: 0.5 },
  "Sun spots": { places: ["Cheekbones", "Temples", "Forehead", "Whole face"], move: true, side: "Both", strength: 0.5, size: 0.5 },
  "Beauty mark": { places: ["Cheek", "Above lip", "Under eye", "Chin", "Temple", "Jaw"], move: true, side: "Left", strength: 0.6, size: 0.4 },
  Scar: { places: ["Brow", "Cheek", "Above lip", "Chin", "Forehead", "Nose bridge", "Across the eye"], move: true, turn: true, side: "Left", strength: 0.55, size: 0.5 },
  Eyeliner: { places: ["Lash line", "Winged", "Smoked"], worn: true, side: "Both", strength: 0.45, size: 0.35 },
  "Paint band": { places: ["Eyes", "Nose bridge", "Cheek", "Forehead", "Chin"], worn: true, move: true, turn: true, side: "Both", strength: 0.8, size: 0.45 },
  "Paint streaks": { places: ["Cheek", "Under eye", "Forehead", "Chin"], worn: true, move: true, turn: true, side: "Both", strength: 0.8, size: 0.45 },
  "Paint dots": { places: ["Under eye", "Brow", "Nose bridge", "Forehead", "Chin"], worn: true, move: true, turn: true, side: "Both", strength: 0.85, size: 0.45 },
};
export const faceMarkKinds = Object.keys(kinds);
export const faceMarkSides = ["Both", "Left", "Right"];
export const faceMarkLimit = 8;
export const faceMarkPalette = ["#ece6d8", "#d9a441", "#c8452f", "#1f8a8a", "#2b4fa8", "#6b4aa0", "#4f9a5b", "#c2387d", "#35b8d0", "#1d1b1e"];
export const faceMarkKind = (kind) => (Object.hasOwn(kinds, kind) ? kinds[kind] : null);

const hex = (v) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
const within = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
const fields = new Set(["kind", "place", "side", "strength", "size", "tone", "seed", "across", "up", "turn"]);
export function validFaceMark(m) {
  if (!m || typeof m !== "object" || Array.isArray(m)) return false;
  const kind = faceMarkKind(m.kind);
  return Boolean(
    kind &&
      Object.keys(m).every((key) => fields.has(key)) &&
      kind.places.includes(m.place) &&
      faceMarkSides.includes(m.side) &&
      within(m.strength, 0, 1) &&
      within(m.size, 0, 1) &&
      Number.isInteger(m.seed) &&
      within(m.seed, 0, 0xffffffff) &&
      (m.tone === undefined || hex(m.tone)) &&
      (m.across === undefined || within(m.across, -1, 1)) &&
      (m.up === undefined || within(m.up, -1, 1)) &&
      (m.turn === undefined || within(m.turn, -90, 90)),
  );
}
export const validFaceMarks = (list) => Array.isArray(list) && list.length <= faceMarkLimit && list.every(validFaceMark);

export function faceMark(kind, seed = 0, set = {}) {
  const k = faceMarkKind(kind);
  if (!k) throw new Error("Unknown face mark: " + kind + ".");
  const mark = { kind, place: k.places[0], side: k.side, strength: k.strength, size: k.size, seed: seed >>> 0, ...set };
  if (!validFaceMark(mark)) throw new Error("Invalid " + kind.toLowerCase() + " settings.");
  return mark;
}
export function changeFaceMarkKind(mark, kind) {
  const k = faceMarkKind(kind);
  if (!k) throw new Error("Unknown face mark: " + kind + ".");
  const { place, across, up, turn, ...rest } = mark;
  return { ...rest, kind, place: k.places.includes(place) ? place : k.places[0], ...(k.move && across !== undefined ? { across } : {}), ...(k.move && up !== undefined ? { up } : {}), ...(k.turn && turn !== undefined ? { turn } : {}) };
}

const decode = Float32Array.from({ length: 256 }, (_, i) => {
  const v = i / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
});
const encodeValue = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const encode = Uint8Array.from({ length: 4097 }, (_, i) => Math.round(Math.min(255, Math.max(0, encodeValue((i / 4096) ** 2)))));
const toByte = (v) => encode[Math.round(Math.sqrt(Math.min(1, Math.max(0, v))) * 4096)];
const linear = (text) => [1, 3, 5].map((at) => decode[parseInt(text.slice(at, at + 2), 16)]);
const weight = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (v, a, b) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function naturalTone(mark, skin) {
  const fair = smooth(weight(skin), 0.03, 0.4),
    scale = (dark, light) => skin.map((v, k) => v * mix(dark[k], light[k], fair));
  switch (mark.kind) {
    case "Freckles":
      return scale([0.42, 0.36, 0.33], [0.6, 0.4, 0.27]);
    case "Sun spots":
      return scale([0.56, 0.5, 0.46], [0.7, 0.53, 0.4]);
    case "Beauty mark":
      return scale([0.22, 0.18, 0.16], [0.2, 0.13, 0.1]);
    case "Scar":
      return scale([1.9, 1.42, 1.36], [1.16, 0.9, 0.88]);
    case "Eyeliner":
      return skin.map((v, k) => mix([0.012, 0.01, 0.011][k], v, 0.06));
    default:
      return linear(faceMarkPalette[mark.seed % faceMarkPalette.length]);
  }
}
const toneOf = (mark, skin) => (mark.tone ? linear(mark.tone) : naturalTone(mark, skin));
export const faceMarkToneHex = (mark, skin) =>
  mark.tone ?? "#" + naturalTone(mark, linear(skin)).map((v) => toByte(Math.min(1, v)).toString(16).padStart(2, "0")).join("");

const hash = (i, j, seed) => {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(j ^ 0xc2b2ae35, 0x27d4eb2f) ^ Math.imul(seed | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
};
function noise(x, y, seed) {
  const i = Math.floor(x),
    j = Math.floor(y),
    a = x - i,
    b = y - j,
    u = a * a * (3 - 2 * a),
    v = b * b * (3 - 2 * b);
  return (hash(i, j, seed) * (1 - u) + hash(i + 1, j, seed) * u) * (1 - v) + (hash(i, j + 1, seed) * (1 - u) + hash(i + 1, j + 1, seed) * u) * v;
}

const reach = 0.36;
function sidesOf(mark, central) {
  if (central) return mark.side === "Right" ? [-1] : [1];
  return mark.side === "Both" ? [1, -1] : [mark.side === "Left" ? 1 : -1];
}
function placements(mark, c, [out, up], angle = 0) {
  const central = out === 0,
    u = c.unit,
    turn = ((angle + (mark.turn ?? 0)) * Math.PI) / 180;
  return sidesOf(mark, central).map((sign) => ({
    sign,
    central,
    half: central && mark.side !== "Both",
    centre: [sign * (out + (mark.across ?? 0) * reach) * u, (up + (mark.up ?? 0) * reach) * u],
    along: [sign * Math.cos(turn), Math.sin(turn)],
  }));
}
const halfOf = (place, mx) => (place.half ? smooth(place.sign * mx, -0.5, 0.5) : 1);

function boxAround(c, x0, y0, x1, y1) {
  let i0 = W,
    j0 = H,
    i1 = -1,
    j1 = -1;
  for (let j = 0; j < H; j++)
    for (let i = 0, at = j * W; i < W; i++, at++) {
      if (c.skin[at] <= 0 || c.x[at] < x0 || c.x[at] > x1 || c.y[at] < y0 || c.y[at] > y1) continue;
      if (i < i0) i0 = i;
      if (i > i1) i1 = i;
      if (j < j0) j0 = j;
      if (j > j1) j1 = j;
    }
  return i1 < 0 ? null : [i0 - 2, j0 - 2, i1 + 2, j1 + 2];
}
function slope(c, at, dx, dy) {
  const nz = Math.max(0.3, c.nz[at]),
    lean = (c.nx[at] * dx + c.ny[at] * dy) / nz;
  return Math.sqrt(1 + lean * lean);
}
function toLine(points, px, py, out) {
  let best = Infinity,
    where = 0,
    nx = 0,
    ny = 1;
  const last = points.length - 1;
  for (let k = 0; k < last; k++) {
    const [ax, ay] = points[k],
      [bx, by] = points[k + 1],
      ex = bx - ax,
      ey = by - ay,
      t = Math.min(1, Math.max(0, ((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey || 1)));
    const qx = px - ax - ex * t,
      qy = py - ay - ey * t,
      d = qx * qx + qy * qy;
    if (d < best) {
      best = d;
      where = (k + t) / last;
      nx = qx;
      ny = qy;
    }
  }
  out.distance = Math.sqrt(best);
  out.along = where;
  const size = out.distance || 1;
  out.nx = nx / size;
  out.ny = ny / size;
  return out;
}

function spot(c, at, cx, cy, radius, opacity, { stretch = 1, angle = 0, ragged = 0, phase = 0, core = 0.45 } = {}) {
  const cz = c.z[at],
    n = [c.nx[at], c.ny[at], c.nz[at]];
  let e1 = [n[2], 0, -n[0]];
  const size = Math.hypot(...e1) || 1;
  e1 = e1.map((v) => v / size);
  const e2 = [n[1] * e1[2] - n[2] * e1[1], n[2] * e1[0] - n[0] * e1[2], n[0] * e1[1] - n[1] * e1[0]];
  const cos = Math.cos(angle),
    sin = Math.sin(angle),
    rx = radius * stretch,
    ry = radius / stretch,
    half = Math.ceil((Math.max(rx, ry) * (1 + ragged) * 1.7) / Math.sqrt(Math.max(0.04, c.area[at]))) + 1,
    i = at % W,
    j = (at - i) / W;
  return {
    box: [i - half, j - half, i + half, j + half],
    alpha(mx, my, mz) {
      const dx = mx - cx,
        dy = my - cy,
        dz = mz - cz,
        a = dx * e1[0] + dy * e1[1] + dz * e1[2],
        b = dx * e2[0] + dy * e2[1] + dz * e2[2],
        u = (a * cos + b * sin) / rx,
        v = (b * cos - a * sin) / ry;
      let r = Math.sqrt(u * u + v * v);
      if (ragged && r < 1.6) {
        const turn = Math.atan2(v, u);
        r /= 1 + ragged * (0.6 * Math.sin(2 * turn + phase) + 0.4 * Math.sin(3 * turn + 2.3 * phase) + 0.3 * Math.sin(5 * turn + 4.1 * phase));
      }
      return r >= 1 ? 0 : opacity * (1 - smooth(r, core, 1));
    },
  };
}

function scatter(mark, c, look, { density, centres, spread, radius, opacity, ragged, core, grain }) {
  const u = c.unit,
    seed = mark.seed,
    wide = (0.55 + 0.9 * mark.size) * spread,
    dx = (mark.across ?? 0) * reach * u,
    dy = (mark.up ?? 0) * reach * u,
    brow = browCover(look.brow),
    candidates = 220000,
    perPixel = (W * H) / candidates,
    next = randomStream(seed ^ 0x3c6ef372),
    spots = [];
  for (let k = 0; k < candidates; k++) {
    const px = next() * W,
      py = next() * H,
      rank = next(),
      at = Math.floor(py) * W + Math.floor(px);
    if (c.skin[at] < 0.35 || c.lip[at] > 0.04 || c.wet[at] > 0.02) continue;
    const mx = c.x[at],
      my = c.y[at];
    let field = 0;
    for (const [out, up, sx, sy, gain] of centres) {
      for (const sign of out === 0 ? [0] : [1, -1]) {
        const ex = (mx - sign * (out * u + dx) - (sign ? 0 : dx)) / (sx * u * wide),
          ey = (my - up * u - dy) / (sy * u * wide);
        field += gain * Math.exp(-(ex * ex + ey * ey));
      }
    }
    if (mark.side !== "Both") field *= smooth((mark.side === "Left" ? 1 : -1) * mx, -5, 7);
    field *= 0.12 + 0.88 * smooth(Math.hypot(Math.abs(mx) - 0.5 * u, my * 1.5) / u, 0.2, 0.42);
    const group = 0.3 + 1.4 * noise(mx / grain + 31, my / grain + 17, seed);
    const expected = density * Math.min(1, field) * group * (1 - 0.85 * c.lid[at]) * (1 - brow[at]) * Math.min(0.7, c.area[at]) * perPixel;
    if (rank >= expected) continue;
    const a = hash(k, 1, seed),
      b = hash(k, 2, seed),
      r = radius[0] + (radius[1] - radius[0]) * a ** 2.4;
    spots.push(
      spot(c, at, mx, my, r * (0.85 + 0.3 * mark.size), opacity[0] + (opacity[1] - opacity[0]) * b * (1 - 0.4 * a), {
        stretch: 1 + 0.2 * hash(k, 3, seed),
        angle: 3.1416 * hash(k, 4, seed),
        ragged,
        phase: 6.2832 * hash(k, 5, seed),
        core,
      }),
    );
  }
  return spots;
}

const builders = {
  Freckles(mark, c, look) {
    const centres = {
      "Nose and cheeks": [[0, -0.34, 0.26, 0.2, 1], [0.6, -0.38, 0.33, 0.23, 0.95]],
      Cheeks: [[0.66, -0.42, 0.3, 0.24, 1]],
      Nose: [[0, -0.36, 0.2, 0.26, 1]],
      "Whole face": [[0, -0.32, 1.05, 0.98, 0.42], [0, -0.34, 0.8, 0.26, 0.4]],
      Forehead: [[0, 0.74, 0.72, 0.3, 1]],
    }[mark.place];
    const s = mark.strength;
    return {
      keep: 1, beard: 0.9,
      shapes: scatter(mark, c, look, { density: 0.42 * (0.1 + 0.9 * s ** 1.4), centres, spread: 1, radius: [0.35, 1.25], opacity: [0.2 + 0.14 * s, 0.55 + 0.3 * s], ragged: 0, core: 0.12, grain: 9 }),
    };
  },
  "Sun spots"(mark, c, look) {
    const centres = {
      Cheekbones: [[0.74, -0.3, 0.3, 0.2, 1]],
      Temples: [[0.98, 0.24, 0.2, 0.32, 1]],
      Forehead: [[0, 0.78, 0.7, 0.28, 1]],
      "Whole face": [[0, -0.2, 1.05, 1.0, 0.75]],
    }[mark.place];
    const s = mark.strength;
    return {
      keep: 1, beard: 0.9,
      shapes: scatter(mark, c, look, { density: 0.016 * (0.25 + 0.75 * s), centres, spread: 1, radius: [1.0, 3.3], opacity: [0.16 + 0.1 * s, 0.3 + 0.3 * s], ragged: 0.22, core: 0.2, grain: 16 }),
    };
  },
  "Beauty mark"(mark, c) {
    const anchor = { Cheek: [0.62, -0.62], "Above lip": [0.3, -0.84], "Under eye": [0.62, -0.3], Chin: [0.2, -1.48], Temple: [1.0, 0.12], Jaw: [0.8, -1.15] }[mark.place];
    const shapes = [];
    for (const place of placements(mark, c, anchor)) {
      const cx = place.centre[0] + place.sign * (hash(1, 7, mark.seed) - 0.5) * 0.12 * c.unit,
        cy = place.centre[1] + (hash(2, 7, mark.seed) - 0.5) * 0.12 * c.unit,
        at = chartPixel(cx, cy);
      if (at < 0) continue;
      shapes.push(
        spot(c, at, c.x[at], c.y[at], 0.65 + 1.0 * mark.size, 0.55 + 0.42 * mark.strength, {
          stretch: 1 + 0.2 * hash(3, 7, mark.seed), angle: 3.1416 * hash(4, 7, mark.seed), core: 0.62,
        }),
      );
    }
    return { keep: 1, beard: 0.6, shapes };
  },
  Scar(mark, c, look) {
    const [anchor, angle, scale] = {
      Brow: [null, 74, 0.62], "Across the eye": [[0.60, 0.05], 77, 2.45], Cheek: [[0.74, -0.56], -26, 1.1], "Above lip": [[0.2, -0.74], 78, 0.42], Chin: [[0.14, -1.44], 32, 0.6],
      Forehead: [[0.36, 0.72], 12, 1], "Nose bridge": [[0, -0.2], 18, 0.6],
    }[mark.place];
    const fair = look ? smooth(weight(look.skin), 0.03, 0.4) : 1,
      flush = look && !mark.tone ? look.skin.map((v, k) => v * mix([0.78, 0.7, 0.68][k], [0.97, 0.78, 0.77][k], fair)) : null;
    const shapes = [],
      seed = mark.seed,
      width = 0.75 + 1.1 * mark.strength,
      length = (9 + 26 * mark.size) * scale;
    const brow = c.points.brows[0].at(-3),
      from = anchor ?? [Math.abs(brow[0]) / c.unit, brow[1] / c.unit + 0.03];
    for (const place of placements(mark, c, from, angle)) {
      const [ax, ay] = place.along,
        bow = (hash(1, 11, seed) - 0.5) * 0.2 * length,
        points = [];
      for (let k = 0; k <= 10; k++) {
        const t = k / 10,
          along = (t - 0.5) * length,
          off = bow * Math.sin(Math.PI * t) + 0.5 * Math.sin(t * 7 + 6.28 * hash(2, 11, seed)) + 0.28 * Math.sin(t * 17 + 6.28 * hash(3, 11, seed));
        points.push([place.centre[0] + ax * along - ay * off, place.centre[1] + ay * along + ax * off]);
      }
      const xs = points.map((p) => p[0]),
        ys = points.map((p) => p[1]),
        box = boxAround(c, Math.min(...xs) - 3, Math.min(...ys) - 3, Math.max(...xs) + 3, Math.max(...ys) + 3),
        near = {};
      if (!box) continue;
      const longScar = mark.place === "Across the eye";
      if (longScar) shapes.push({
        box, ridge: .40, rough: .45, tone: flush,
        alpha(mx, my, mz, at) {
          toLine(points, mx, my, near);
          const fade = Math.sin(Math.PI * near.along) ** .6;
          const side = near.nx * (-ay) + near.ny * ax;
          const offset = near.distance * slope(c, at, near.nx, near.ny);
          const rim = offset - width * fade * (.90 + .18 * Math.sin(near.along * 28));
          return side > .15 ? .72 * fade * Math.exp(-((rim / .75) ** 2)) * halfOf(place, mx) : 0;
        },
      });
      for (const [wide, strength, groove] of [[2.4, 0.22 + 0.25 * mark.strength, 0], [1, 0.7 + 0.29 * mark.strength, longScar ? 0.78 : 0.18]])
        shapes.push({
          box, groove, rough: groove ? 0.56 : null, tone: groove ? null : flush,
          alpha(mx, my, mz, at) {
            toLine(points, mx, my, near);
            const taper = Math.sin(Math.PI * Math.min(1, Math.max(0, near.along))) ** 0.55,
              grain = 0.8 + 0.4 * noise(near.along * length * 1.1, 3, seed),
              half = width * wide * taper * grain + 0.02;
            return strength * (1 - smooth(near.distance * slope(c, at, near.nx, near.ny), half * 0.35, half)) * halfOf(place, mx);
          },
        });
    }
    return { keep: 0.8, beard: 0.5, shapes };
  },
  Eyeliner(mark, c) {
    const shapes = [],
      smoked = mark.place === "Smoked",
      winged = mark.place === "Winged",
      strength = 0.5 + 0.48 * mark.strength,
      thick = (smoked ? 1.1 + 2.4 * mark.size : 0.8 + 1.9 * mark.size) * (mark.place === "Lash line" ? 0.85 : 1);
    for (const sign of sidesOf(mark, false)) {
      const eye = c.points.eyes[sign > 0 ? 0 : 1],
        lines = [[eye.upper, 1], ...(smoked ? [[eye.lower, 0.5]] : [])];
      for (const [margin, gain] of lines) {
        const flat = margin.map(([px, py]) => chartPoint(px, py).slice(0, 2)),
          xs = flat.map((p) => p[0]),
          ys = flat.map((p) => p[1]),
          pad = thick * (smoked ? 2.2 : 1) + 2,
          box = boxAround(c, Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad),
          near = {},
          lower = margin === eye.lower;
        if (!box) continue;
        shapes.push({
          liner: true, box,
          alpha(mx, my) {
            toLine(flat, mx, my, near);
            const t = near.along;
            if (smoked) return strength * gain * Math.exp(-((near.distance / thick) ** 2)) * smooth(t, 0, 0.2);
            if ((lower ? -near.ny : near.ny) * near.distance < -0.35) return 0;
            const line = thick * (0.3 + 0.7 * smooth(t, 0.1, 0.85));
            return strength * (1 - smooth(near.distance, line, line + 0.45)) * smooth(t, 0.03, 0.24);
          },
        });
      }
      if (winged) {
        const [cx, cy] = eye.outer,
          far = 3 + 7.5 * mark.size,
          dir = [sign * Math.cos(0.42), Math.sin(0.42)],
          tip = [cx + dir[0] * far, cy + dir[1] * far],
          root = [cx - dir[0] * 1.2, cy - dir[1] * 1.2 + 0.2],
          box = boxAround(c, Math.min(root[0], tip[0]) - 3, Math.min(root[1], tip[1]) - 3, Math.max(root[0], tip[0]) + 3, Math.max(root[1], tip[1]) + 3),
          near = {};
        if (box)
          shapes.push({
            liner: true, box,
            alpha(mx, my, mz, at) {
              toLine([root, tip], mx, my, near);
              const half = thick * 0.95 * (1 - near.along) ** 0.9 + 0.05;
              return near.along >= 1 ? 0 : strength * (1 - smooth(near.distance * slope(c, at, near.nx, near.ny), half * 0.55, half + 0.3));
            },
          });
      }
    }
    return { keep: 0.35, beard: 0, shapes };
  },
  "Paint band"(mark, c) {
    const [anchor, angle, long, thin, wide] = {
      Eyes: [[0, 0.03], 0, 1.16, 9, 30], "Nose bridge": [[0, -0.3], 0, 0.98, 4, 20], Cheek: [[0.72, -0.5], -18, 0.36, 4, 16],
      Forehead: [[0, 0.78], 0, 0.85, 4, 20], Chin: [[0, -1.5], 90, 0.3, 4, 20],
    }[mark.place];
    const shapes = [],
      seed = mark.seed,
      half = (thin + (wide - thin) * mark.size) / 2,
      length = long * c.unit,
      strength = 0.4 + 0.59 * mark.strength;
    for (const place of placements(mark, c, anchor, angle)) {
      const [ax, ay] = place.along,
        [cx, cy] = place.centre,
        ex = Math.abs(ax) * length + Math.abs(ay) * half + 3,
        ey = Math.abs(ay) * length + Math.abs(ax) * half + 3,
        box = boxAround(c, cx - ex, cy - ey, cx + ex, cy + ey);
      if (!box) continue;
      shapes.push({
        box, rough: 0.74,
        alpha(mx, my) {
          const dx = mx - cx,
            dy = my - cy,
            along = dx * ax + dy * ay,
            across = dy * ax - dx * ay;
          const edge = half * (1 + 0.07 * (noise(along / 4 + 9, across > 0 ? 1 : 5, seed) - 0.5)) + 0.35 * (noise(along / 1.3, across > 0 ? 2 : 6, seed) - 0.5),
            body = 1 - smooth(Math.abs(across), edge - 0.5, edge + 0.25),
            streak = noise(across / 0.7 + 40, along / 26, seed),
            end = length * (0.86 + 0.14 * streak);
          const kept = place.half ? smooth(place.sign * mx + 5 * (streak - 0.5), -1.8, 1.8) : 1;
          return strength * body * (1 - smooth(Math.abs(along), end - 3.5, end)) * (0.9 + 0.1 * streak) * kept;
        },
      });
    }
    return { keep: 0.5, beard: 0.5, shapes };
  },
  "Paint streaks"(mark, c) {
    const [anchor, angle, long] = { Cheek: [[0.74, -0.5], -20, 0.42], "Under eye": [[0.52, -0.5], -90, 0.34], Forehead: [[0, 0.82], 90, 0.36], Chin: [[0, -1.44], -90, 0.28] }[mark.place];
    const shapes = [],
      seed = mark.seed,
      count = 2 + Math.floor(hash(1, 13, seed) * 2.6),
      half = 1.1 + 2.1 * mark.size,
      strength = 0.4 + 0.59 * mark.strength;
    for (const place of placements(mark, c, anchor, angle)) {
      const [ax, ay] = place.along,
        [cx, cy] = place.centre;
      for (let k = 0; k < count; k++) {
        const off = (k - (count - 1) / 2) * half * 2.9,
          length = long * c.unit * (0.7 + 0.5 * hash(k, 14, seed)),
          start = (hash(k, 15, seed) - 0.5) * 5 - length / 2,
          from = [cx + ax * start - ay * off, cy + ay * start + ax * off],
          to = [from[0] + ax * length, from[1] + ay * length],
          box = boxAround(c, Math.min(from[0], to[0]) - half - 2, Math.min(from[1], to[1]) - half - 2, Math.max(from[0], to[0]) + half + 2, Math.max(from[1], to[1]) + half + 2),
          near = {};
        if (!box) continue;
        shapes.push({
          box, rough: 0.74,
          alpha(mx, my, mz, at) {
            toLine([from, to], mx, my, near);
            const t = near.along,
              streak = noise((mx * ay - my * ax) / 0.6 + 7 * k, t * 2.2, seed),
              wide = half * (1 - 0.5 * t ** 1.5) * (0.96 + 0.08 * noise(t * 9, k, seed));
            return strength * (1 - smooth(near.distance * slope(c, at, near.nx, near.ny), wide - 0.45, wide + 0.2)) * (1 - smooth(t, 0.55 + 0.4 * streak, 1)) * (0.9 + 0.1 * streak) * halfOf(place, mx);
          },
        });
      }
    }
    return { keep: 0.5, beard: 0.5, shapes };
  },
  "Paint dots"(mark, c) {
    const u = c.unit,
      seed = mark.seed,
      strength = 0.45 + 0.52 * mark.strength,
      radius = 1.8 + 3.2 * mark.size,
      shapes = [];
    const [anchor, angle, long, bow, count] = {
      "Under eye": [[0.54, -0.33], 6, 0.38, -0.07, 5], Brow: [[0.56, 0.36], 4, 0.42, 0.06, 5], "Nose bridge": [[0, -0.3], 0, 0.7, 0.03, 7],
      Forehead: [[0, 0.72], 90, 0.3, 0, 3], Chin: [[0, -1.46], 90, 0.15, 0, 3],
    }[mark.place];
    for (const place of placements(mark, c, anchor, angle)) {
      const [ax, ay] = place.along,
        [cx, cy] = place.centre;
      for (let k = 0; k < count; k++) {
        const t = count === 1 ? 0 : (k / (count - 1)) * 2 - 1,
          along = t * long * u,
          off = bow * u * (1 - t * t),
          mx = cx + ax * along - ay * off * place.sign,
          my = cy + ay * along + ax * off * place.sign;
        if (place.half && place.sign * mx < radius * 0.5) continue;
        const at = chartPixel(mx, my);
        if (at < 0 || Math.hypot(c.x[at] - mx, c.y[at] - my) > 2.5) continue;
        const size = radius * (anchor[0] === 0 && angle === 90 ? 1 - 0.18 * k : 1 - 0.2 * Math.abs(t)) * (0.93 + 0.14 * hash(k, 17, seed));
        shapes.push({ ...spot(c, at, mx, my, size, strength, { stretch: 1 + 0.08 * hash(k, 18, seed), angle: 3.1416 * hash(k, 19, seed), core: 0.72 }), rough: 0.74 });
      }
    }
    return { keep: 0.5, beard: 0.5, shapes };
  },
};

export function browParting(form, name) {
  const scars = (form.faceMarks ?? []).filter((mark) => mark.kind === "Scar");
  if (!scars.length || !validFaceMarks(scars)) return null;
  const c = faceChart(),
    roots = browRoots(name),
    shapes = scars.flatMap((mark) => builders.Scar(mark, c).shapes.filter((shape) => !shape.groove)),
    parted = new Uint8Array(roots.length / 2);
  let any = false;
  for (let k = 0; k < parted.length; k++) {
    const px = roots[k * 2],
      py = roots[k * 2 + 1],
      [mx, my, mz] = chartPoint(px, py),
      at = Math.min(H - 1, Math.max(0, Math.floor(py))) * W + Math.min(W - 1, Math.max(0, Math.floor(px)));
    if (shapes.some((shape) => shape.alpha(mx, my, mz, at) > 0.1)) parted[k] = any = 1;
  }
  return any ? parted : null;
}

const fullest = (mark) => (mark.kind === "Scar" ? 0.95 : mark.kind === "Freckles" || mark.kind === "Sun spots" ? 0.9 : 0.99);

const covers = new Map();
function hairCover(name) {
  const style = facialHairStyle(name);
  if (!style) return null;
  if (!covers.has(name)) {
    const cover = new Float32Array(W * H),
      at = [0, 0, 0];
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        growthAt((i + 0.5) / W, (j + 0.5) / H, at);
        cover[j * W + i] = smooth(Math.max(style.cover[0] * at[0], style.cover[1] * at[1], style.cover[2] * at[2]), 0.06, 0.7) * style.paint;
      }
    covers.set(name, cover);
  }
  return covers.get(name);
}

export function paintFaceMarks(target, marks, look) {
  const c = faceChart(),
    FW = W * D,
    FH = H * D,
    skin = look.skin.map((v) => Math.max(v, 1e-4)),
    startBase = (look.base ?? skin).map((v) => Math.max(v, 1e-4)),
    skinWeight = weight(skin),
    cover = hairCover(look.facialHair),
    map = target.map,
    changed = new Set();
  if (map.length !== FW * FH * 4) throw new Error("The face paint has an unexpected size.");
  const ordered = [...marks.filter((mark) => !kinds[mark.kind].worn), ...marks.filter((mark) => kinds[mark.kind].worn)],
    layers = ordered.map((mark) => ({ ...builders[mark.kind](mark, c, look), tone: toneOf(mark, skin), top: fullest(mark) }));

  const base = startBase.map((v, k) => {
    const wanted = Math.max(v, ...layers.map((layer) => skin[k] + (layer.tone[k] - skin[k]) * layer.top));
    if (wanted <= v * 1.0001) return v;
    const byte = Math.max(1, Math.floor(encodeValue(v / wanted)));
    return v / decode[byte];
  });
  if (base.some((v, k) => v !== startBase[k])) {
    const tables = base.map((v, k) => Float32Array.from(decode, (d) => {
      const value = encodeValue(d * (startBase[k] / v));
      return Math.abs(value - Math.round(value)) < 1e-4 ? Math.round(value) : value;
    }));
    for (let j = 0, p = 0; j < FH; j++)
      for (let i = 0; i < FW; i++, p += 4) {
        const dither = hash(i, j, 0x51f15e);
        for (let k = 0; k < 3; k++) map[p + k] = Math.floor(tables[k][map[p + k]] + dither);
      }
    changed.add("map");
  }

  for (const layer of layers)
    for (const shape of layer.shapes) {
      const i0 = Math.max(0, Math.floor(shape.box[0] * D)),
        i1 = Math.min(FW - 1, Math.ceil((shape.box[2] + 1) * D)),
        j0 = Math.max(0, Math.floor(shape.box[1] * D)),
        j1 = Math.min(FH - 1, Math.ceil((shape.box[3] + 1) * D));
      for (let j = j0; j <= j1; j++) {
        const fy = Math.min(H - 1.001, Math.max(0, (j + 0.5) / D - 0.5)),
          sj = Math.floor(fy),
          b = fy - sj;
        for (let i = i0; i <= i1; i++) {
          const fx = Math.min(W - 1.001, Math.max(0, (i + 0.5) / D - 0.5)),
            si = Math.floor(fx),
            a = fx - si,
            at = sj * W + si,
            w0 = (1 - a) * (1 - b),
            w1 = a * (1 - b),
            w2 = (1 - a) * b,
            w3 = a * b,
            read = (f) => w0 * f[at] + w1 * f[at + 1] + w2 * f[at + W] + w3 * f[at + W + 1];
          const open = read(c.skin);
          if (open <= 0.004) continue;
          const nearest = at + (a > 0.5 ? 1 : 0) + (b > 0.5 ? W : 0);
          let alpha = shape.alpha(read(c.x), read(c.y), read(c.z), nearest, fx + 0.5, fy + 0.5);
          if (alpha <= 0.004) continue;
          const eye = read(c.eye);
          alpha *= open * (1 - smooth(read(c.lip), 0.03, 0.22)) * (shape.liner ? smooth(eye, -0.8, 0.2) : 1 - smooth(read(c.wet), 0.04, 0.5));
          if (cover) alpha *= 1 - layer.beard * read(cover);
          if (alpha <= 0.004) continue;
          const p = (j * FW + i) * 4,
            tone = shape.tone ?? layer.tone,
            now = [decode[map[p]] * base[0], decode[map[p + 1]] * base[1], decode[map[p + 2]] * base[2]],
            shade = 1 + (Math.min(1.08, Math.max(0.45, weight(now) / skinWeight)) - 1) * layer.keep;
          for (let k = 0; k < 3; k++) map[p + k] = toByte((now[k] + (Math.min(base[k], tone[k] * shade) - now[k]) * alpha) / base[k]);
          changed.add("map");
          if (shape.rough != null && target.rough) {
            target.rough[p + 1] = Math.round(mix(target.rough[p + 1], Math.min(255, (shape.rough / 0.8) * 255), alpha * 0.8));
            changed.add("rough");
          }
          if (shape.ridge && target.bump) {
            for (let k=0; k<3; k++)
              target.bump[p+k] = Math.min(255, Math.round(target.bump[p+k] + 128*shape.ridge*alpha));
            changed.add("bump");
          }
          if (shape.groove && target.bump) {
            const low = 1 - shape.groove * alpha;
            for (let k = 0; k < 3; k++) target.bump[p + k] = Math.round(target.bump[p + k] * low);
            changed.add("bump");
          }
        }
      }
    }
  return { base, changed };
}

export function drawIdentityMarks(seed, { skin = "#b08566", age = 0 } = {}) {
  const next = randomStream((seed ^ 0x7a3c91e5) >>> 0),
    pick = (list) => list[Math.floor(next() * list.length)],
    own = () => Math.floor(next() * 4294967296),
    between = (lo, hi) => Math.round((lo + (hi - lo) * next()) * 100) / 100,
    fair = smooth(weight(linear(skin)), 0.03, 0.4),
    marks = [];
  const rolls = [next(), next(), next(), next()],
    freckles = faceMark("Freckles", own(), { place: pick(["Nose and cheeks", "Nose and cheeks", "Cheeks", "Whole face", "Nose"]), strength: between(0.25, 0.8), size: between(0.3, 0.8) }),
    spots = faceMark("Sun spots", own(), { place: pick(["Cheekbones", "Cheekbones", "Temples", "Whole face", "Forehead"]), strength: between(0.3, 0.75), size: between(0.3, 0.7) }),
    mole = faceMark("Beauty mark", own(), { place: pick(["Cheek", "Above lip", "Under eye", "Chin", "Temple", "Jaw"]), side: pick(["Left", "Right"]), strength: between(0.45, 0.85), size: between(0.2, 0.6) }),
    scar = faceMark("Scar", own(), { place: pick(["Brow", "Brow", "Cheek", "Chin", "Above lip", "Forehead", "Across the eye"]), side: pick(["Left", "Right"]), strength: between(0.4, 0.75), size: between(0.3, 0.7) });
  if (rolls[0] < 0.1 + 0.22 * fair) marks.push(freckles);
  if (rolls[1] < 0.04 + 0.32 * smooth(age, 0.35, 0.8)) marks.push(spots);
  if (rolls[2] < 0.16) marks.push(mole);
  if (rolls[3] < 0.07) marks.push(scar);
  return marks;
}
export function drawWornMarks(next) {
  const pick = (list) => list[Math.floor(next() * list.length)],
    own = () => Math.floor(next() * 4294967296),
    between = (lo, hi) => Math.round((lo + (hi - lo) * next()) * 100) / 100,
    rolls = [next(), next()],
    liner = faceMark("Eyeliner", own(), { place: pick(["Lash line", "Lash line", "Winged", "Smoked"]), strength: between(0.3, 0.6), size: between(0.2, 0.5) }),
    kind = pick(["Paint band", "Paint streaks", "Paint dots"]),
    paint = faceMark(kind, own(), { place: pick(faceMarkKind(kind).places), side: pick(["Both", "Left", "Right", "Left", "Right"]), strength: between(0.65, 0.95), size: between(0.3, 0.65), tone: pick(faceMarkPalette) });
  return [...(rolls[0] < 0.16 ? [liner] : []), ...(rolls[1] < 0.04 ? [paint] : [])];
}
export function wearFaceMarks(form, worn) {
  const marks = [...(form.faceMarks ?? []).filter((mark) => !faceMarkKind(mark.kind)?.worn), ...worn].slice(0, faceMarkLimit),
    { faceMarks, ...rest } = form;
  return marks.length ? { ...rest, faceMarks: marks } : rest;
}

export const faceMarkInstructions = {
  kinds: Object.fromEntries(faceMarkKinds.map((kind) => [kind, kinds[kind].places])),
  sides: faceMarkSides,
  palette: faceMarkPalette,
  usage:
    'setForm.set.faceMarks replaces the list of marks on an adult face, and null removes them all. Give at most ' + faceMarkLimit +
    ' marks, each {kind, place, side, strength, size, seed} with a place listed for its kind. Side is the wearer\'s own; Left or Right ' +
    "on a place in the middle of the face keeps the mark to that half. Strength and size run from 0 to 1. Seed is an unsigned 32-bit " +
    "integer that fixes the scatter of freckles and the hand of a scar or a brush stroke: keep it to change a mark steadily and use " +
    "the request's variation seed for a new one. Optional tone (#rrggbb) is the colour of the mark itself on any skin; without it " +
    "freckles, spots, beauty marks, scars and eyeliner take a natural tone for the skin and paint takes one of the palette. Optional " +
    "across and up (-1 to 1) move a mark outwards and upwards from its place, and turn (-90 to 90 degrees) rotates scars and paint. " +
    "Freckles, Sun spots, Beauty mark and Scar belong to the person. Eyeliner and the paints are worn. Marks keep clear of the lips " +
    "and eyes, show in colour views and exports, and leave the clay view plain. Send the whole list each time, keeping the marks that stay.",
};

const painted = new Map();
function texture(canvas, like) {
  const t = new T.CanvasTexture(canvas);
  t.colorSpace = like.colorSpace;
  t.anisotropy = like.anisotropy;
  return t;
}
export function markFace(material, form) {
  const marks = form.faceMarks,
    source = material.map?.image;
  if (!marks?.length || !validFaceMarks(marks) || typeof document === "undefined" || !source?.getContext) return material;
  if (source.width !== W * D || source.height !== H * D) return material;
  const currentBase = [material.color.r, material.color.g, material.color.b],
    trueSkin = Array.isArray(material.userData?.skinColor) ? material.userData.skinColor : currentBase,
    look = {
      skin: trueSkin,
      base: currentBase,
      brow: fittedBrow(form),
      facialHair: form.humanStyle?.facialHair,
    };
  const key = [material.map.uuid, material.color.getHexString(), trueSkin.map((v) => v.toFixed(4)).join(","), look.brow, look.facialHair, JSON.stringify(marks)].join("|");
  if (painted.has(key)) {
    const kept = painted.get(key);
    painted.delete(key);
    painted.set(key, kept);
  } else {
    if (painted.size >= 3) {
      const oldest = painted.keys().next().value;
      for (const t of painted.get(oldest).owned) t.dispose();
      painted.delete(oldest);
    }
    const copy = (image) => {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const pen = canvas.getContext("2d", { willReadFrequently: true });
      pen.drawImage(image, 0, 0);
      return { canvas, pen, pixels: pen.getImageData(0, 0, canvas.width, canvas.height) };
    };
    const relief = marks.some((mark) => mark.kind === "Scar" || mark.kind.startsWith("Paint")),
      sameSize = (t) => t?.image?.getContext && t.image.width === source.width && t.image.height === source.height,
      colour = copy(source),
      rough = relief && sameSize(material.roughnessMap) ? copy(material.roughnessMap.image) : null,
      bump = relief && sameSize(material.bumpMap) ? copy(material.bumpMap.image) : null;
    const { base, changed } = paintFaceMarks({ map: colour.pixels.data, rough: rough?.pixels.data, bump: bump?.pixels.data }, marks, look);
    const entry = { base, owned: [] };
    for (const [name, layer, like] of [["map", colour, material.map], ["rough", rough, material.roughnessMap], ["bump", bump, material.bumpMap]]) {
      if (!layer || !changed.has(name)) continue;
      layer.pen.putImageData(layer.pixels, 0, 0);
      entry[name] = texture(layer.canvas, like);
      entry.owned.push(entry[name]);
    }
    painted.set(key, entry);
  }
  const entry = painted.get(key);
  if (entry.map) material.map = entry.map;
  if (entry.rough) material.roughnessMap = entry.rough;
  if (entry.bump) material.bumpMap = entry.bump;
  material.color.setRGB(...entry.base);
  return material;
}
