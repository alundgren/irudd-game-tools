// Wearable armour for the adult human, as extra pieces of a tailored outfit (human-tailor.js).
//   armourPieces   the pieces, their editable fields, limits and starting values
//   armourMakers   builders with the tailor's signature: (body, m, layer, worn, later, options) -> {parts, covers, worn};
//                  options.game builds the plates from fewer faces for the game file
//   armourSet(seed, look)  a whole seeded outfit of tailor layers to start from; armourLooks lists the looks
//   armourTailor({look, seed, pieces})  the same outfit named in a few words, as a saved look keeps it
// Armour is worn over clothes. A cuirass is cut from the wearer's own surface like a garment, hung as a stiff
// shell with room over the figure and divided into plates. Shoulder, limb and hip plates are lofted around a
// measured tube that follows the limb, so they clear the body and whatever is already worn. Every plate is a
// solid sheet with its own edge, moves as one rigid piece and shares its motion between the joints it spans.
import { Envelope, Piece, Shell, add, clamp, cross, cut, dot, hash1, length, lerp3, loops, mix, relax, smooth, sub, subdivide, unit } from "./human-style-kit.js";
import { garment } from "./human-style-cloth.js";
import { breastplateDevices } from "./human-armour-surface.js";
import { mailStandard } from "./human-mail.js";
import { mantle } from "./human-mantle.js";
import { pod } from "./human-style-gear.js";

const TAU = Math.PI * 2, mm = value => value / 1000;
const colour = (value, label = "Colour") => ({ type: "colour", value, label });
const range = (label, min, max, value, step = (max - min) / 100) => ({ type: "range", label, min, max, value, step });
const choice = (label, options, value = options[0]) => ({ type: "choice", label, options, value });
const cuts = ["rounded", "pointed", "angular"], balances = ["matched", "left heavier", "right heavier", "left only", "right only"];
// What a plate is made of, as the surface kinds the materials know.
const finishes = { steel: "metal", leather: "leather", lacquer: "satin" };
const finish = (value = "steel") => choice("Plates", Object.keys(finishes), value);

/** Every armour piece, its editable fields, their limits and starting values. Lengths in millimetres are before body scaling. */
export const armourPieces = {
  travellingMantle: {
    label: "Travelling mantle",
    fields: {
      color: colour("#343c49", "Outer wool"), trim: colour("#797056", "Facing"),
      clasp: colour("#aa9060", "Brooch"), shoulder: choice("Fastened on", ["right", "left"]),
      length: range("Drop", 0, 1, 0.6),
    },
  },
  cuirass: {
    label: "Armour: cuirass",
    fields: {
      color: colour("#8d9197"), trim: colour("#b08d4a", "Edges"), material: finish(),
      device: choice("Embossed device", breastplateDevices),
      build: choice("Build", ["fitted", "segmented", "hardshell"]),
      length: range("Lower edge (0 ribs, 1 hips)", 0, 1, 0.45),
      room: range("Room over the clothes, mm", 6, 40, 14, 1),
      relief: range("Ridges and edges (0 plain, 1 bold)", 0, 1, 0.6),
      lames: range("Waist plates", 1, 6, 3, 1),
      collar: choice("Collar", ["open", "gorget", "ring", "mail standard"]),
      back: choice("Back", ["plain", "pack"]),
      seed: range("Variation", 0, 999, 0, 1),
    },
  },
  pauldrons: {
    label: "Armour: shoulders",
    fields: {
      color: colour("#8d9197"), trim: colour("#b08d4a", "Edges and studs"), material: finish(),
      cut: choice("Cut", cuts),
      lames: range("Plates down the arm", 1, 6, 3, 1),
      size: range("Size (0 light, 1 bulky)", 0, 1, 0.5),
      flange: range("Neck guard (0 none, 1 tall)", 0, 1, 0),
      balance: choice("Left and right", balances),
      room: range("Room over the clothes, mm", 3, 24, 7, 1),
      seed: range("Variation", 0, 999, 0, 1),
    },
  },
  armguards: {
    label: "Armour: arms",
    fields: {
      color: colour("#8d9197"), trim: colour("#5a4636", "Straps and edges"), material: finish(),
      cover: choice("Covers", ["forearm", "forearm and elbow", "whole arm"]),
      cut: choice("Cut", cuts),
      balance: choice("Left and right", balances),
      room: range("Room over the clothes, mm", 3, 20, 6, 1),
      seed: range("Variation", 0, 999, 0, 1),
    },
  },
  legguards: {
    label: "Armour: legs",
    fields: {
      color: colour("#8d9197"), trim: colour("#5a4636", "Straps and edges"), material: finish(),
      cover: choice("Covers", ["shin", "shin and knee", "whole leg"]),
      cut: choice("Cut", cuts),
      room: range("Room over the clothes, mm", 4, 24, 8, 1),
      seed: range("Variation", 0, 999, 0, 1),
    },
  },
  tassets: {
    label: "Armour: hips",
    fields: {
      color: colour("#8d9197"), trim: colour("#b08d4a", "Edges"), material: finish(),
      cut: choice("Cut", cuts),
      plates: choice("Hangs", ["front", "front and sides", "all round"]),
      lames: range("Plates in each", 1, 4, 3, 1),
      length: range("Length (0 hip, 1 above the knee)", 0, 1, 0.45),
      room: range("Room over the clothes, mm", 4, 30, 10, 1),
      seed: range("Variation", 0, 999, 0, 1),
    },
  },
};

const part = (piece, tone, region, name, type = "metal") => ({ piece, tone, region, name, type });
const shellsOf = worn => worn.filter(w => w.shell).map(w => w.shell);
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
/** Repeatable draws for one layer: draw(n) is the same 0..1 value for the same seed and n. */
const draws = seed => n => hash1(Math.round(seed) * 7919 + n * 104729 + 17);
const sideName = sign => (sign > 0 ? "l" : "r");
/** Which sides a piece is built on and how much heavier each is: [[sign, bias]]. */
const sidesOf = balance => ({ matched: [[1, 0], [-1, 0]], "left heavier": [[1, 0.4], [-1, -0.3]], "right heavier": [[1, -0.3], [-1, 0.4]], "left only": [[1, 0.15]], "right only": [[-1, 0.15]] })[balance] ?? [[1, 0], [-1, 0]];

/** Every point a plate has to clear near a height range: the skin and whatever is already worn. */
function figure(body, shells, low, high, keep = () => true) {
  const points = [];
  for (let v = 0; v < body.count; v++) { const y = body.P[v * 3 + 1]; if (y > low && y < high && keep(v)) points.push(body.point(v)); }
  for (const s of shells) for (let i = 0; i < s.pos.length; i += 3) if (s.pos[i + 1] > low && s.pos[i + 1] < high) points.push([s.pos[i], s.pos[i + 1], s.pos[i + 2]]);
  return points;
}

/**
 * A radial map around a bending centre line: for each station along the line and each direction around it,
 * how far the figure reaches. Direction 0 is the `crown` side and positive directions turn towards `front`.
 * `u` runs from 0 to 1 along the line; plates are lofted over it at a distance.
 */
class Tube {
  constructor(path, crown, front, stations = 24, cols = 48) {
    const far = [0];
    for (let i = 1; i < path.length; i++) far.push(far[i - 1] + length(sub(path[i], path[i - 1])));
    this.length = far.at(-1); this.rows = stations; this.cols = cols;
    const at = d => { let i = 1; while (i < path.length - 1 && far[i] < d) i++; return lerp3(path[i - 1], path[i], clamp((d - far[i - 1]) / (far[i] - far[i - 1] || 1))); };
    this.c = Array.from({ length: stations }, (_, k) => at(this.length * k / (stations - 1)));
    this.t = this.c.map((_, k) => unit(sub(this.c[Math.min(stations - 1, k + 1)], this.c[Math.max(0, k - 1)])));
    this.n = this.t.map(t => unit(add(crown, t, -dot(crown, t))));
    this.f = this.t.map((t, k) => { const f = cross(this.n[k], t); return dot(f, front) < 0 ? scale(f, -1) : f; });
    this.env = new Envelope([0, 0, 0], [0, 1, 0], 0, 1, stations, cols);
  }
  frame(u) {
    const x = clamp(u) * (this.rows - 1), i = Math.min(this.rows - 2, Math.floor(x)), s = x - i, over = (u - clamp(u)) * this.length;
    const t = unit(lerp3(this.t[i], this.t[i + 1], s));
    return { c: add(lerp3(this.c[i], this.c[i + 1], s), t, over), t, n: unit(lerp3(this.n[i], this.n[i + 1], s)), f: unit(lerp3(this.f[i], this.f[i + 1], s)) };
  }
  /** Measure points within `reach` of the line. Directions further than `arc` from the crown take the radius at the arc's edge. */
  measure(points, { reach = 0.2, arc = Math.PI, span = 2, soften = 3, hang = null } = {}) {
    const { rows, cols, env } = this, half = this.length / (rows - 1) * 0.75, r = env.r, middle = this.c[rows >> 1], limit = (this.length / 2 + reach + 0.05) ** 2;
    const near = points.filter(p => (p[0] - middle[0]) ** 2 + (p[1] - middle[1]) ** 2 + (p[2] - middle[2]) ** 2 < limit);
    r.fill(-1);
    for (let k = 0; k < rows; k++) {
      const c = this.c[k], t = this.t[k], n = this.n[k], f = this.f[k];
      for (const p of near) {
        const d = sub(p, c);
        if (Math.abs(dot(d, t)) > half) continue;
        const x = dot(d, n), y = dot(d, f), far = Math.hypot(x, y), angle = Math.atan2(y, x);
        if (far > reach || Math.abs(angle) > arc + 0.2) continue;
        const fc = ((angle / TAU + 1) % 1) * cols, j = Math.floor(fc) % cols;
        for (const q of [j, (j + 1) % cols]) r[k * cols + q] = Math.max(r[k * cols + q], far);
      }
    }
    // Unmeasured directions take their neighbours around the ring, and empty rings the nearest measured ring.
    const full = [];
    for (let k = 0; k < rows; k++) {
      const row = r.subarray(k * cols, (k + 1) * cols), old = row.slice();
      if (!old.some(x => x >= 0)) continue;
      full.push(k);
      for (let j = 0; j < cols; j++) if (old[j] < 0) {
        let da = 1, db = 1;
        while (old[(j + cols - da) % cols] < 0) da++;
        while (old[(j + db) % cols] < 0) db++;
        row[j] = mix(old[(j + cols - da) % cols], old[(j + db) % cols], da / (da + db));
      }
    }
    for (let k = 0; k < rows; k++) if (!full.includes(k)) {
      const from = full.reduce((a, b) => (Math.abs(b - k) < Math.abs(a - k) ? b : a), -1);
      for (let j = 0; j < cols; j++) r[k * cols + j] = from < 0 ? 0.05 : r[from * cols + j];
    }
    if (arc < Math.PI) for (let k = 0; k < rows; k++) {
      const row = r.subarray(k * cols, (k + 1) * cols), edge = Math.floor(arc / TAU * cols);
      for (let j = edge + 1; j < cols - edge; j++) row[j] = j < cols / 2 ? row[edge] : row[cols - edge];
    }
    env.taut(1, span);
    if (hang) env.hang(hang[0], hang[1]);
    env.soften(soften);
    return this;
  }
  radius(u, angle) { return this.env.sample(clamp(u), angle); }
  point(u, angle, radius) { const { c, n, f } = this.frame(u); return add(add(c, n, Math.cos(angle) * radius), f, Math.sin(angle) * radius); }
  /** The station nearest to a point, as `u`. */
  nearest(p) { let best = 0; for (let k = 1; k < this.rows; k++) if (length(sub(this.c[k], p)) < length(sub(this.c[best], p))) best = k; return best / (this.rows - 1); }
}

/**
 * Plates for a game file are built from fewer, larger faces. The file keeps a fixed number of triangles for the whole
 * figure, so plates drawn as finely as for the editor would leave too few for the boots, the hands and the face.
 */
let coarse = false;
const built = maker => (body, m, layer, worn, later, options) => {
  coarse = Boolean(options?.game);
  try { return maker(body, m, layer, worn); } finally { coarse = false; }
};
const copyShell = s => {
  const out = new Shell();
  for (const key of ["pos", "anc", "nrm", "bones", "weights", "tri"]) out[key] = s[key].slice();
  for (const name of Object.keys(s.f)) out.f[name] = s.f[name].slice();
  return out;
};

/** Parameter stops across `size` metres: even steps, with extra lines where an edge roll of `width` or a `mark` needs them. */
function stops(count, size, width, marks = []) {
  const list = [0, 1];
  for (let i = 1; i < count; i++) list.push(i / count);
  if (width > 0 && size > width * 3.2) for (const d of coarse ? [1] : [0.5, 1, 1.4]) list.push(width * d / size, 1 - width * d / size);
  for (const [at, wide] of marks) for (const d of coarse ? [-1.6, 0, 1.6] : [-1.6, -0.7, 0, 0.7, 1.6]) list.push(clamp(at + d * wide / size));
  return list.sort((a, b) => a - b).filter((x, i, all) => i === 0 || x - all[i - 1] > 2e-3 || x === 1);
}

/**
 * One rigid plate lofted over a tube between stations u0 and u1 and directions a0 and a1.
 *   gap     distance kept from the figure; flare, how much further the far edge stands out, so it overlaps the next plate
 *   bulge   a dome in the middle of the plate; thick, the sheet's thickness
 *   roll    height of a rolled edge of width rollWidth; groove, depth of a line set in from the edge instead
 *   edge(w) and lead(w) move the far and near edges along the tube across the plate, in metres
 *   relief(v, w, e) adds height at a place on the plate; e is the distance to its nearest edge
 *   section(angle) scales the radius by direction, which turns a round plate into a faceted one
 */
function plate(piece, tube, o) {
  const { u0, u1, a0, a1, gap = 0.005, flare = 0, bulge = 0, thick = 0.003, roll = 0, rollWidth = 0.009, groove = 0, edge = null, lead = null, relief = null, section = null, marks = [], arc = null, window = null, raise = 0, crest = 0.5, skin } = o;
  const rows = coarse ? Math.max(2, Math.round((o.rows ?? 6) * 0.55)) : o.rows ?? 6, cols = coarse ? Math.max(4, Math.round((o.cols ?? 16) * 0.55)) : o.cols ?? 16;
  const L = tube.length, wide = (tube.radius((u0 + u1) / 2, (a0 + a1) / 2) + gap) * Math.abs(a1 - a0), long = (u1 - u0) * L, lip = roll || groove ? rollWidth : 0;
  // An inlay is drawn over part of another plate: the same surface between two fractions each way, raised a little.
  const within = (list, from, to) => [from, ...list.filter(x => x > from + 1e-3 && x < to - 1e-3), to];
  const vs = window ? within(stops(rows, long, 0), window[0], window[1]) : stops(rows, long, lip), ws = window ? within(stops(cols, wide, 0), window[2], window[3]) : stops(cols, wide, lip, marks.map(at => [at, 0.006])), outer = [], inner = [];
  for (const v of vs) {
    const ro = [], ri = [];
    for (const w of ws) {
      const a = mix(a0, a1, w) * (arc ? arc(v) : 1), start = u0 + (lead ? lead(w) / L : 0), end = u1 + (edge ? edge(w) / L : 0), u = mix(start, end, v), facet = section ? section(a) : 1;
      // A plate is straight along the limb between its two edges, and never dips into the figure between them.
      const profile = o.followLimb ? tube.radius(u, a) : mix(tube.radius(start, a), tube.radius(end, a), v);
      let r = (profile + gap) * facet + flare * v + bulge * Math.sin(Math.PI * v ** (Math.log(0.5) / Math.log(crest))) ** 0.8 * Math.max(0, Math.cos((w - 0.5) * Math.PI)) ** 0.6;
      r = Math.max(r, tube.radius(u, a) + gap * 0.75);
      const e = Math.min(v * (end - start) * L, (1 - v) * (end - start) * L, w * wide, (1 - w) * wide);
      const height = (lip ? roll * (1 - smooth(lip * 0.5, lip, e)) - groove * smooth(lip * 0.5, lip, e) * (1 - smooth(lip, lip * 1.4, e)) : 0) + (relief ? relief(v, w, e) : 0);
      ro.push(tube.point(u, a, r + height + raise)); ri.push(tube.point(u, a, r + (window ? raise - thick : -thick)));
    }
    outer.push(ro); inner.push(ri);
  }
  if (piece.plateUV) {
    // Each bell occupies the upper part of the chart. Sliding lames and the
    // neck guard share a second strip; every plate keeps its own boundary.
    const [lo, hi] = o.bell ? [.02, .66] : [.69, .98];
    for (let face = 0; face < 2; face++) for (const v of vs) for (const w of ws)
      piece.plateUV.push(.012 + .976*w, 1 - mix(lo, hi, v));
  }
  piece.slab(outer, inner, skin);
}

/** A domed stud or rivet standing on a tube at (u, angle), `radius` from the line. */
function stud(piece, tube, u, angle, radius, size, skin) {
  const { c, t, n, f } = tube.frame(u), out = add(scale(n, Math.cos(angle)), f, Math.sin(angle)), around = cross(out, t), centre = add(c, out, radius);
  const ring = (r, h) => Array.from({ length: 8 }, (_, i) => add(add(add(centre, t, Math.cos(i / 8 * TAU) * r), around, Math.sin(i / 8 * TAU) * r), out, h));
  piece.loft([ring(size, -0.001), ring(size, size * 0.35), ring(size * 0.6, size * 0.75)], skin, { capEnd: true, flip: dot(cross(t, around), out) > 0 });
}

/** Lifts a shell clear of the layers already worn, as the tailor does for cloth. */
function clearOver(s, shells, margin) {
  if (!shells.length) return;
  const cell = 0.024, grid = new Map(), key = (x, y, z) => Math.floor(x / cell) + "," + Math.floor(y / cell) + "," + Math.floor(z / cell);
  for (const under of shells) {
    if (!under.anc || !under.nrm) continue;
    for (let i = 0; i < under.count; i++) {
      const a = under.anchor(i), k = key(...a), d = dot(sub(under.at(i), a), under.normal(i));
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push([a[0], a[1], a[2], d]);
    }
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

/** Distance over a shell from its open edges, up to `limit`. `only` picks the edge vertices to start from. */
function edgeDistance(s, limit, only = null) {
  const n = s.count, near = Array.from({ length: n }, () => []), far = new Float32Array(n).fill(9), queue = [];
  for (let t = 0; t < s.tri.length; t += 3) for (let a = 0; a < 3; a++) near[s.tri[t + a]].push(s.tri[t + (a + 1) % 3], s.tri[t + (a + 2) % 3]);
  for (const loop of loops(s)) for (const i of loop) if (!only || only(i)) { far[i] = 0; queue.push(i); }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    if (far[i] > limit) continue;
    for (const j of near[i]) { const d = far[i] + length(sub(s.at(i), s.at(j))); if (d < far[j] - 1e-6) { far[j] = d; queue.push(j); } }
  }
  return far;
}

/**
 * Adds a shell as a solid sheet: its outer face, a wall around every open edge and an inner face that
 * runs `lining` metres in under the edge. Further in nobody can see the underside, so it is left out.
 */
function solid(piece, s, { thickness = 0.003, lining = 0.03 } = {}) {
  if (coarse) lining = 0;
  const base = piece.count, n = s.count, far = Number.isFinite(lining) ? edgeDistance(s, lining * 1.3) : null, half = new Set();
  for (let i = 0; i < n; i++) piece.vertex(s.at(i), s.skin(i));
  for (let i = 0; i < n; i++) piece.vertex(add(s.at(i), s.normal(i), -thickness), s.skin(i));
  for (let t = 0; t < s.tri.length; t += 3) {
    const a = s.tri[t], b = s.tri[t + 1], c = s.tri[t + 2];
    piece.tri.push(base + a, base + b, base + c);
    if (!far || (far[a] < lining && far[b] < lining && far[c] < lining)) piece.tri.push(base + n + a, base + n + c, base + n + b);
    half.add(a * n + b); half.add(b * n + c); half.add(c * n + a);
  }
  for (const key of half) {
    const a = Math.floor(key / n), b = key % n;
    if (!half.has(b * n + a)) piece.tri.push(base + a, base + n + a, base + n + b, base + a, base + n + b, base + b);
  }
  return piece;
}

/**
 * A raised strip along the open edges of a plate cut from a shell: a rolled or reinforced edge with its own crisp line.
 * `only` picks the edges, and `measure(i)` gives the distance to the edge directly where it is a known line.
 */
function edging(piece, s, { width = 0.011, rise = 0.003, thickness = 0.003, only = null, measure = null } = {}) {
  let far = measure ? Array.from({ length: s.count }, (_, i) => measure(i)) : Array.from(edgeDistance(s, width * 2.2, only));
  if (!measure) {
    // Distance walked along triangle edges zigzags, which would make the strip's inner line ragged.
    const near = Array.from({ length: s.count }, () => new Set());
    for (let t = 0; t < s.tri.length; t += 3) for (let e = 0; e < 3; e++) { near[s.tri[t + e]].add(s.tri[t + (e + 1) % 3]); near[s.tri[t + (e + 1) % 3]].add(s.tri[t + e]); }
    for (let pass = 0; pass < 3; pass++) far = far.map((d, i) => { if (d === 0 || d > width * 2) return d; let sum = 0; for (const j of near[i]) sum += far[j]; return mix(d, sum / near[i].size, 0.6); });
  }
  s.f.far = far;
  const strip = cut(s, i => width - s.f.far[i]);
  delete s.f.far;
  if (!strip.tri.length) return;
  for (let i = 0; i < strip.count; i++) strip.set(i, add(strip.at(i), strip.normal(i), rise * (0.3 + 0.7 * smooth(width, width * 0.6, strip.f.far[i])) - (strip.f.far[i] > width * 0.98 ? rise * 0.6 : 0)));
  solid(piece, strip, { thickness: thickness + rise * 0.8, lining: Infinity });
}

/**
 * A rolled edge along the openings of a plate cut from a shell: the neck and the arm openings. The opening is
 * followed as one line, evened out and resampled at a steady pace, and a rolled wire of a flat oval section is
 * lofted along it. Its line is therefore smooth however the triangles of the shell fall, and it keeps that line
 * when a game model is reduced. `rim` marks the points of the shell that lie on an opening.
 */
function rolledRims(piece, s, rim, { width = 0.006, rise = 0.0035, pace = 0.014, skin, out = 0.0012 } = {}) {
  const half = new Set(), n = s.count, next = new Map(), into = new Set();
  for (let t = 0; t < s.tri.length; t += 3) for (let e = 0; e < 3; e++) half.add(s.tri[t + e] * n + s.tri[t + (e + 1) % 3]);
  for (const key of half) {
    const a = Math.floor(key / n), b = key % n;
    if (!half.has(b * n + a) && rim(a) && rim(b)) { next.set(a, b); into.add(b); }
  }
  const seen = new Set(), chains = [];
  const walk = start => { const chain = [start]; seen.add(start); for (let v = next.get(start); v !== undefined && !seen.has(v); v = next.get(v)) { chain.push(v); seen.add(v); } return chain; };
  for (const a of next.keys()) if (!into.has(a)) chains.push({ ids: walk(a), closed: false });
  for (const a of next.keys()) if (!seen.has(a)) chains.push({ ids: walk(a), closed: true });
  for (const { ids, closed } of chains) {
    let line = ids.map(i => s.at(i)), normal = ids.map(i => s.normal(i));
    let long = 0;
    for (let i = 1; i < line.length; i++) long += length(sub(line[i], line[i - 1]));
    if (closed) long += length(sub(line[0], line.at(-1)));
    if (long < pace * 3) continue;
    // Resample at a steady pace along the line, then even out what the triangles left in it.
    const count = Math.max(4, Math.round(long / pace)), far = [0];
    const ring = closed ? [...line, line[0]] : line, ringN = closed ? [...normal, normal[0]] : normal;
    for (let i = 1; i < ring.length; i++) far.push(far[i - 1] + length(sub(ring[i], ring[i - 1])));
    const sample = (list, d) => { let i = 1; while (i < ring.length - 1 && far[i] < d) i++; return lerp3(list[i - 1], list[i], clamp((d - far[i - 1]) / (far[i] - far[i - 1] || 1))); };
    const steps = closed ? count : count + 1;
    line = Array.from({ length: steps }, (_, i) => sample(ring, far.at(-1) * i / count));
    normal = Array.from({ length: steps }, (_, i) => unit(sample(ringN, far.at(-1) * i / count)));
    const at = (list, i) => closed ? list[(i + steps) % steps] : list[clamp(i, 0, steps - 1)];
    for (let pass = 0; pass < 3; pass++) line = line.map((p, i) => (!closed && (i === 0 || i === steps - 1) ? p : lerp3(p, lerp3(at(line, i - 1), at(line, i + 1), 0.5), 0.5)));
    const rings = line.map((p, i) => {
      const t = unit(sub(at(line, i + 1), at(line, i - 1))), up = unit(add(normal[i], t, -dot(normal[i], t))), across = cross(t, up), c = add(p, up, out);
      return [[0, 1], [1, 0.15], [0.6, -0.7], [-0.6, -0.7], [-1, 0.15]].map(([x, y]) => add(add(c, across, x * width), up, y * rise));
    });
    if (closed) rings.push(rings[0]);
    piece.loft(rings, skin, { closed: true, capStart: !closed, capEnd: !closed });
  }
}

/** One rigid skin for a plate of the trunk at a height: the spine joints share it as they share the body there. */
function spineSkin(body, m, y) {
  const k = m.k, at = name => body.joint(name)[1], step = name => smooth(at(name) - 0.04 * k, at(name) + 0.02 * k, y);
  const w3 = step("spine_03"), w2 = (1 - w3) * step("spine_02"), w1 = (1 - w3 - w2) * step("spine_01");
  return body.blend([["spine_03", w3], ["spine_02", w2], ["spine_01", w1], ["pelvis", Math.max(0, 1 - w3 - w2 - w1)]]);
}
function setSkin(s, skin) {
  for (let i = 0; i < s.count; i++) { const [bones, weights] = typeof skin === "function" ? skin(i) : skin; for (let j = 0; j < 4; j++) { s.bones[i * 4 + j] = bones[j]; s.weights[i * 4 + j] = weights[j]; } }
  return s;
}

/**
 * Gives the front of a stiff shell one even form over the chest. The front is read as a height map, blurred by a
 * fixed distance and raised where the figure stands higher, no further than that asks. A breastplate then has room
 * for any chest and shows none of its anatomy. The map is a grid in space, because the points of a shell lie as
 * close together as those of the body under it, and a blur from point to point would leave its finest forms in.
 */
function fairChest(s, m, hem) {
  const k = m.k, n = s.count, cell = 0.006 * k;
  let zc = 0;
  for (let i = 0; i < n; i++) zc += s.pos[i * 3 + 2] / n;
  const weight = Float32Array.from({ length: n }, (_, i) => smooth(0.01 * k, 0.06 * k, s.pos[i * 3 + 2] - zc) * smooth(hem - 0.01 * k, hem + 0.05 * k, s.pos[i * 3 + 1]) * smooth(m.neck[1] - 0.03 * k, m.neck[1] - 0.1 * k, s.pos[i * 3 + 1]) * (1 - smooth(0.3, 0.7, s.f.wArm[i])));
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) if (weight[i]) { x0 = Math.min(x0, s.pos[i * 3]); x1 = Math.max(x1, s.pos[i * 3]); y0 = Math.min(y0, s.pos[i * 3 + 1]); y1 = Math.max(y1, s.pos[i * 3 + 1]); }
  if (!(x1 > x0)) return;
  const pad = 8, w = Math.ceil((x1 - x0) / cell) + 2 * pad + 1, h = Math.ceil((y1 - y0) / cell) + 2 * pad + 1;
  const col = x => (x - x0) / cell + pad, row = y => (y - y0) / cell + pad;
  let high = new Float32Array(w * h).fill(-Infinity);
  const tris = s.tri.length / 3;
  // Every triangle of the front is drawn into the map, so a cell between two points is not left empty.
  for (let t = 0; t < tris; t++) {
    const a = s.tri[t * 3], b = s.tri[t * 3 + 1], c = s.tri[t * 3 + 2];
    if (!weight[a] && !weight[b] && !weight[c]) continue;
    for (let u = 0; u <= 4; u++) for (let v = 0; v <= 4 - u; v++) {
      const wa = u / 4, wb = v / 4, wc = 1 - wa - wb, at = d => s.pos[a * 3 + d] * wa + s.pos[b * 3 + d] * wb + s.pos[c * 3 + d] * wc;
      const i = Math.round(col(at(0))), j = Math.round(row(at(1)));
      if (i >= 0 && i < w && j >= 0 && j < h) high[j * w + i] = Math.max(high[j * w + i], at(2));
    }
  }
  // Empty cells take the mean of their filled neighbours until none is left.
  for (let left = true, guard = 0; left && guard < w + h; guard++) {
    left = false;
    const next = high.slice();
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      if (high[j * w + i] > -Infinity) continue;
      let sum = 0, count = 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const v = high[(j + dj) * w + i + di]; if (i + di >= 0 && i + di < w && j + dj >= 0 && j + dj < h && v > -Infinity) { sum += v; count++; } }
      if (count) next[j * w + i] = sum / count; else left = true;
    }
    high = next;
  }
  const box = (field, r, pick) => {
    // One pass along the rows and one along the columns: a mean, or the highest value, within `r` cells.
    for (const [di, dj] of [[1, 0], [0, 1]]) {
      const next = new Float32Array(w * h);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        let sum = 0, most = -Infinity, count = 0;
        for (let q = -r; q <= r; q++) { const ii = clamp(i + di * q, 0, w - 1), jj = clamp(j + dj * q, 0, h - 1), v = field[jj * w + ii]; sum += v; most = Math.max(most, v); count++; }
        next[j * w + i] = pick ? most : sum / count;
      }
      field = next;
    }
    return field;
  };
  let even = high;
  for (let pass = 0; pass < 3; pass++) even = box(even, 6, false);
  // How far the figure stands over the even form, spread to the cells round it and then blurred no wider than it
  // was spread: the sum clears every point and is as smooth as the even form itself.
  let over = high.map((v, i) => Math.max(0, v - even[i]));
  over = box(box(box(over, 6, true), 2, false), 2, false);
  const sample = (field, x, y) => {
    const fi = clamp(col(x), 0, w - 1.001), fj = clamp(row(y), 0, h - 1.001), i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
    return mix(mix(field[j * w + i], field[j * w + i + 1], u), mix(field[(j + 1) * w + i], field[(j + 1) * w + i + 1], u), v);
  };
  for (let i = 0; i < n; i++) if (weight[i]) {
    const x = s.pos[i * 3], y = s.pos[i * 3 + 1], target = sample(even, x, y) + sample(over, x, y) + 0.001 * k;
    s.pos[i * 3 + 2] += weight[i] * (target - s.pos[i * 3 + 2]);
  }
}

/** A collar standing on the neck opening of a cuirass: a gorget of two plates or one thick lock ring. */
function collarPlates(body, m, shells, kind, room, relief, plates, trim) {
  const k = m.k, base = add(m.neck, [0, -0.03 * k, -0.004 * k]), top = add(m.neck, [0, 0.06 * k, 0.012 * k]), head = body.weight(/^head/);
  const points = figure(body, shells, base[1] - 0.05 * k, top[1] + 0.03 * k, v => head[v] < 0.6);
  const tube = new Tube([base, top], [0, 0, 1], [1, 0, 0], 12, 48).measure(points, { reach: 0.13 * k, soften: 2 });
  const neck = body.blend([["neck_01", 0.35], ["spine_03", 0.65]]), chest = body.rigid("spine_03"), all = Math.PI - 0.001;
  if (kind === "ring") {
    plate(plates, tube, { u0: 0.2, u1: 0.62, a0: -all, a1: all, rows: 5, cols: 44, gap: (0.012 + room * 0.3) * k, bulge: 0.004 * k, thick: 0.012 * k, groove: 0.0015 * k, rollWidth: 0.007 * k, skin: chest });
    plate(trim, tube, { u0: 0.34, u1: 0.48, a0: -all, a1: all, rows: 2, cols: 44, gap: (0.0185 + room * 0.3) * k, thick: 0.004 * k, skin: chest });
    return;
  }
  // The lower plate lies on the chest and shoulders; the upper one stands round the neck and opens towards the jaw.
  const edge = { thick: 0.003 * k, roll: (0.001 + 0.002 * relief) * k, rollWidth: 0.008 * k };
  plate(plates, tube, { u0: 0.24, u1: 0.52, a0: -all, a1: all, rows: 4, cols: 44, gap: 0.009 * k, ...edge, skin: chest });
  plate(plates, tube, { u0: 0.36, u1: 0.88, a0: -all, a1: all, rows: 5, cols: 44, gap: 0.016 * k, flare: 0.008 * k, edge: w => -0.022 * k * Math.max(0, Math.cos((w - 0.5) * TAU)) ** 2, ...edge, skin: neck });
}

function cuirass(body, m, layer, worn) {
  const k = m.k, room = mm(layer.room), under = shellsOf(worn), kind = finishes[layer.material], relief = layer.relief, draw = draws(layer.seed), build = layer.build;
  const hem = mix(m.waist + 0.05 * k, m.belly - 0.02 * k, layer.length), neckY = m.neck[1];
  // A stiff shell: it bridges the chest and the small of the back, falls nearly straight and shows no creases.
  const g = garment(body, m, { sleeve: -0.07, hem, ease: room, gap: Math.min(room, 0.012), fall: build === "fitted" ? 0.55 : 0.3, rise: 1.2, tension: 1, span: 3, passes: 12, soft: 12, chestSoft: 90, neck: { height: -0.02, wide: 0.13, bow: 5, scoop: 0.034, scoopWidth: 0.068 }, folds: 0, under });
  clearOver(g.s, under, 0.006 * k);
  // A plate is one smooth form: hollows left between the chest muscles or breasts are filled, never deepened.
  const stand = Array.from({ length: g.s.count }, (_, i) => dot(sub(g.s.at(i), g.s.anchor(i)), g.s.normal(i)));
  relax(g.s, { passes: 24, strength: 0.6, edge: 0.3, gap: i => stand[i], apart: true });
  fairChest(g.s, m, hem);
  const s = coarse ? copyShell(g.s) : subdivide(g.s), n = s.count;
  let zc = 0;
  for (let i = 0; i < n; i++) zc += s.pos[i * 3 + 2] / n;
  const ribs = mix(Math.max(hem + 0.07 * k, m.waist + 0.035 * k), m.shoulder, 0.3) + (draw(1) - 0.5) * 0.02 * k;
  const push = (i, d, a) => { s.pos[i * 3 + d] += a; };
  // The lower edge kicks out over the hips in every build, so the waist reads as narrower than the plates over it.
  for (let i = 0; i < n; i++) {
    const out = unit([s.pos[i * 3], 0, s.pos[i * 3 + 2] - zc]), kick = 0.012 * k * smooth(hem + 0.05 * k, hem, s.pos[i * 3 + 1]) ** 2;
    push(i, 0, out[0] * kick); push(i, 2, out[2] * kick);
  }
  if (build === "fitted") for (let i = 0; i < n; i++) {
    // A keel down the breastbone and a fuller chest over it, fading at the neck and the waist.
    const x = s.pos[i * 3], y = s.pos[i * 3 + 1], z = s.pos[i * 3 + 2] - zc, along = smooth(hem + 0.02 * k, ribs + 0.02 * k, y) * smooth(neckY - 0.05 * k, neckY - 0.17 * k, y);
    if (z > 0) push(i, 2, smooth(0, 0.03 * k, z) * along * (relief * 0.014 * k * Math.exp(-((x / (0.02 * k)) ** 2)) + 0.01 * k * Math.exp(-((x / (0.1 * k)) ** 2))));
    // A shallow channel down the spine keeps the back plate from reading as a barrel.
    else push(i, 2, smooth(0, 0.03 * k, -z) * along * relief * 0.006 * k * Math.exp(-((x / (0.03 * k)) ** 2)));
  }
  if (build !== "hardshell") {
    // A breastplate is raised from a sheet: it swells over the chest and its sides run in to the waist, where the
    // plates below begin. Nothing is drawn in, so it clears whatever is worn under it.
    const mid = mix(ribs, neckY, 0.45), tall = (neckY - ribs) * 0.42;
    for (let i = 0; i < n; i++) {
      const x = s.pos[i * 3], y = s.pos[i * 3 + 1], z = s.pos[i * 3 + 2] - zc;
      // Fullest low on the chest, where it stands over the first plate of the waist, and run out towards the neck.
      if (z > 0) push(i, 2, smooth(0, 0.03 * k, z) * 0.019 * k * smooth(ribs - 0.01 * k, ribs + 0.05 * k, y) * smooth(neckY - 0.03 * k, mid - 0.02 * k, y) * Math.exp(-((x / (0.13 * k)) ** 2)));
    }
    // Below the ribs every plate is a hoop: one even curve round the trunk, whatever folds the cloth under it has.
    const low = [];
    for (let i = 0; i < n; i++) if (s.pos[i * 3 + 1] < ribs + 0.03 * k) low.push(i);
    const angle = low.map(i => Math.atan2(s.pos[i * 3], s.pos[i * 3 + 2] - zc)), far = low.map(i => Math.hypot(s.pos[i * 3], s.pos[i * 3 + 2] - zc)), bins = 40, rows = Math.max(1, Math.ceil((ribs + 0.03 * k - hem) / (0.012 * k)));
    const sum = new Float32Array(bins * rows), most = new Float32Array(bins * rows), count = new Float32Array(bins * rows);
    const cell = j => { const a = Math.floor((angle[j] / TAU + 0.5) * bins) % bins, r = clamp(Math.floor((s.pos[low[j] * 3 + 1] - hem) / (0.012 * k)), 0, rows - 1); return r * bins + (a + bins) % bins; };
    low.forEach((i, j) => { const c = cell(j); sum[c] += far[j]; most[c] = Math.max(most[c], far[j]); count[c]++; });
    let even = Float32Array.from(sum, (v, c) => count[c] ? v / count[c] : 0);
    for (let pass = 0; pass < 4; pass++) even = even.map((v, c) => { const r = Math.floor(c / bins), a = c % bins; let total = 0, weight = 0; for (const d of [-2, -1, 0, 1, 2]) { const o = r * bins + (a + d + bins) % bins; if (count[o]) { total += even[o] * (3 - Math.abs(d)); weight += 3 - Math.abs(d); } } return weight ? total / weight : v; });
    low.forEach((i, j) => {
      // Never inside the surface it was: the hoop is the even curve or the highest point under it.
      const c = cell(j), target = Math.max(even[c], far[j]), blend = smooth(ribs + 0.03 * k, ribs, s.pos[i * 3 + 1]) * (1 - smooth(0.25, 0.6, s.f.wArm?.[i] ?? 0));
      const grow = 1 + blend * (target / Math.max(far[j], 1e-6) - 1);
      s.pos[i * 3] *= grow; s.pos[i * 3 + 2] = zc + (s.pos[i * 3 + 2] - zc) * grow;
    });
  }
  // Plates are cut where the finished shell is, not where the skin under it was, so their lines run level.
  s.f.y = Array.from({ length: n }, (_, i) => s.pos[i * 3 + 1]);
  s.f.x = Array.from({ length: n }, (_, i) => Math.abs(s.pos[i * 3]));
  s.f.z = Array.from({ length: n }, (_, i) => s.pos[i * 3 + 2] - zc);
  // The neck and arm openings of the shell, which take a rolled edge.
  s.f.rim = new Array(n).fill(0);
  for (const loop of loops(s)) for (const i of loop) if (s.pos[i * 3 + 1] > ribs + 0.02 * k) s.f.rim[i] = 1;
  // How far round the trunk a point is: 0 at the breastbone, π at the spine.
  const turn = (p, i) => Math.atan2(p.f.x[i], p.f.z[i]);
  const plates = new Piece(), trim = new Piece();
  const chest = body.rigid("spine_03"), rise = (0.002 + 0.004 * relief) * k, thick = (kind === "leather" ? 0.006 : 0.0045) * k;
  /** One plate: the part of the shell that passes every test in `keep`, lifted, made rigid and given a raised edge where `edged` says. */
  const cutPlate = (keep, lift, skin, o = {}) => {
    let p = s;
    for (const test of keep) { const from = p; p = cut(from, i => test(from, i)); }
    if (!p.tri.length) return;
    const edged = o.edged ? Array.from({ length: p.count }, (_, i) => o.edged(p, i)) : null;
    if (lift) for (let i = 0; i < p.count; i++) p.set(i, add(p.at(i), p.normal(i), lift(p, i, p.f.y[i])));
    setSkin(p, skin);
    solid(plates, p, { thickness: o.thick ?? thick });
    // The game file keeps the edges in the trim colour; a raised edge in a plate's own colour is too fine for it.
    const rolled = build !== "hardshell" && !o.measure && o.low === undefined;
    if (rolled) rolledRims(trim, p, i => p.f.rim[i] > 0.99, { width: 0.0058 * k, rise: (0.003 + 0.002 * relief) * k, pace: (coarse ? 0.02 : 0.011) * k, skin });
    else if (!(coarse && o.plain)) edging(o.plain ? plates : trim, p, { width: (o.width ?? 0.014) * k, rise: o.rise ?? rise, thickness: o.thick ?? thick, only: edged ? i => edged[i] : null, measure: o.measure ? i => o.measure(p, i) : o.low === undefined ? null : i => p.f.y[i] - o.low });
  };
  const Y = (p, i) => p.f.y[i];
  /**
   * The plates of the waist as hoops lofted round the trunk from `top` down, `count` of them `band` tall. Each is
   * tucked under the one above and stands out at its lower edge. A hoop is an even band of its own, so it stays
   * one clean plate when a game model is reduced, where a strip cut from the body's own mesh breaks into dents.
   */
  const hoops = (top, count, band, step) => {
    if (!count) return;
    const points = [];
    for (let i = 0; i < n; i++) if (s.pos[i * 3 + 1] < top + 0.05 * k) points.push([s.pos[i * 3], s.pos[i * 3 + 1], s.pos[i * 3 + 2]]);
    const low = top - count * band, long = top + 0.014 * k - low, all = Math.PI - 0.001;
    const tube = new Tube([[0, top + 0.014 * k, zc], [0, low, zc]], [0, 0, 1], [1, 0, 0], Math.max(6, Math.round(long / (0.012 * k))), 64).measure(points, { reach: 0.5 * k, span: 1.2, soften: 3 });
    for (let j = 0; j < count; j++) {
      const u0 = j * band / long, u1 = ((j + 1) * band + 0.014 * k) / long;
      plate(plates, tube, { u0, u1, a0: -all, a1: all, rows: 3, cols: 56, gap: 0.0012 * k, flare: step, thick, roll: rise * 0.7, rollWidth: 0.007 * k, skin: spineSkin(body, m, top - (j + 0.5) * band) });
    }
  };
  const seam = Math.PI / 2, lap = 0.07;
  /** A plate of the chest as a breastplate and a backplate that laps over it, with a raised edge along the join. */
  const pair = (keep, lift, skin, o = {}) => {
    cutPlate([...keep, (p, i) => seam + lap - turn(p, i)], lift, skin, { ...o, edged: o.edged ? (p, i) => o.edged(p, i) && turn(p, i) < seam + lap * 0.5 : (p, i) => turn(p, i) < seam + lap * 0.5 });
    cutPlate([...keep, (p, i) => turn(p, i) - seam], (p, i, h) => (lift ? lift(p, i, h) : 0) + 0.0042 * k * smooth(seam + 0.5, seam + 0.08, turn(p, i)), skin, o);
  };
  if (build === "fitted") {
    // A breastplate and backplate in one, and over it a lower plate that rises to a point at the front and the back.
    const peak = (0.07 + 0.05 * draw(2)) * k, line = (p, i) => ribs - 0.05 * k + peak * (Math.max(0, 1 - turn(p, i) / 0.85) ** 1.3 + 0.7 * Math.max(0, 1 - (Math.PI - turn(p, i)) / 0.8) ** 1.3);
    const count = Math.max(0, Math.round(layer.lames) - 1), band = Math.min(0.036 * k, (ribs - 0.05 * k - hem) / Math.max(1, count + 1.2)), skirtTop = hem + count * band, step = 0.007 * k;
    pair([(p, i) => Y(p, i) - line(p, i) + 0.014 * k], null, chest, { edged: (p, i) => Y(p, i) > line(p, i) + 0.02 * k });
    cutPlate([(p, i) => line(p, i) - Y(p, i), (p, i) => Y(p, i) - skirtTop + (count ? 0 : 1)], () => step, spineSkin(body, m, (ribs + skirtTop) / 2), { measure: (p, i) => (line(p, i) - Y(p, i)) * 0.8 });
    // Narrow plates below it take up the bending of the waist.
    hoops(skirtTop, count, band, step);
  } else if (build === "segmented") {
    // A chest plate and bands round the waist, each band standing over the one below it.
    const count = Math.round(layer.lames), band = (ribs - hem) / count, step = (0.007 + 0.003 * relief) * k;
    pair([(p, i) => Y(p, i) - ribs], (p, i, h) => step * smooth(ribs + 0.05 * k, ribs, h), chest);
    hoops(ribs, count, band, step);
  } else {
    // Hard shell: a chest shell with a chevron edge, and separate plates on the belly and the small of the back.
    // The flanks and the lines between the plates stay open, so the suit worn under it shows.
    const chevron = (p, i) => ribs - 0.035 * k * Math.max(0, 1 - turn(p, i) / 0.75) - 0.02 * k * Math.max(0, 1 - (Math.PI - turn(p, i)) / 0.7);
    cutPlate([(p, i) => Y(p, i) - chevron(p, i)], null, chest, { plain: true, width: 0.009, rise: rise * 0.7 });
    // A raised panel on the breastbone, six-sided.
    const mid = mix(ribs, neckY, 0.42), tall = (neckY - ribs) * 0.2, half = (0.05 + 0.02 * draw(3)) * k;
    cutPlate([(p, i) => p.f.z[i], (p, i) => half - p.f.x[i] - 0.55 * Math.abs(Y(p, i) - mid), (p, i) => tall - Math.abs(Y(p, i) - mid)], () => (0.004 + 0.003 * relief) * k, chest, { plain: true, width: 0.006, rise: rise * 0.5 });
    const count = Math.round(layer.lames), gapY = 0.007 * k, band = (ribs - 0.045 * k - hem) / count;
    for (let j = 0; j < count; j++) {
      const top = ribs - 0.045 * k - j * band, low = top - band + gapY, wide = 0.85 - j * 0.06, skin = spineSkin(body, m, (top + low) / 2);
      for (const back of [false, true]) cutPlate([(p, i) => top - Y(p, i), (p, i) => Y(p, i) - low, (p, i) => (back ? wide * 0.8 - (Math.PI - turn(p, i)) : wide - turn(p, i)) * 0.1], () => 0.002 * k, skin, { plain: true, width: 0.007, rise: rise * 0.6 });
    }
    // An accent bar under the collar.
    let bar = cut(s, i => s.f.z[i]);
    for (const test of [q => 0.045 * k - q.x, q => 0.006 * k - Math.abs(q.y - (mid + tall + 0.022 * k))]) { const from = bar; bar = cut(from, i => test({ x: from.f.x[i], y: from.f.y[i] })); }
    for (let i = 0; i < bar.count; i++) bar.set(i, add(bar.at(i), bar.normal(i), 0.004 * k));
    if (bar.tri.length) solid(trim, setSkin(bar, chest), { thickness: 0.004 * k, lining: Infinity });
  }
  const straps = new Piece(), buckles = new Piece();
  if (build !== "hardshell") {
    // Leathers hold the backplate to the breastplate: one over each shoulder and two down each flank, each with
    // a buckle on the breastplate. They are cut from the shell, so they lie on the plates wherever those are.
    const strap = (keep, buckle) => {
      let p = s;
      for (const test of keep) { const from = p; p = cut(from, i => test(from, i)); }
      if (!p.tri.length) return;
      const metal = cut(p, i => buckle(p, i));
      for (let i = 0; i < p.count; i++) p.set(i, add(p.at(i), p.normal(i), 0.0034 * k));
      solid(straps, setSkin(p, chest), { thickness: 0.003 * k, lining: Infinity });
      if (metal.tri.length) { for (let i = 0; i < metal.count; i++) metal.set(i, add(metal.at(i), metal.normal(i), 0.0058 * k)); solid(buckles, setSkin(metal, chest), { thickness: 0.003 * k, lining: Infinity }); }
    };
    // Where the shoulder of the shell is: between the neck opening and the arm opening, at its top.
    let inner = Infinity, outer = 0, crest = -Infinity;
    for (let i = 0; i < n; i++) if (Math.abs(s.f.z[i]) < 0.012 * k && s.f.y[i] > neckY - 0.07 * k) { inner = Math.min(inner, s.f.x[i]); outer = Math.max(outer, s.f.x[i]); crest = Math.max(crest, s.f.y[i]); }
    if (outer > inner) {
      const centre = mix(inner, outer, 0.5), half = Math.min(0.016 * k, (outer - inner) * 0.34), reach = 0.085 * k;
      strap([(p, i) => half - Math.abs(p.f.x[i] - centre), (p, i) => reach - Math.abs(p.f.z[i]) - 0.6 * (crest - p.f.y[i]), (p, i) => p.f.y[i] - (crest - 0.09 * k)],
        (p, i) => Math.min(p.f.z[i] - 0.03 * k, 0.058 * k - p.f.z[i], half * 1.5 - Math.abs(p.f.x[i] - centre)));
    }
    const armpit = m.shoulder - 0.11 * k, span = Math.max(0.03 * k, armpit - ribs);
    for (const at of [0.25, 0.72]) {
      const y0 = ribs + span * at, tall = 0.011 * k;
      strap([(p, i) => tall - Math.abs(p.f.y[i] - y0), (p, i) => 0.34 - Math.abs(turn(p, i) - seam - 0.03)],
        (p, i) => Math.min(seam - 0.1 - turn(p, i), turn(p, i) - (seam - 0.27)));
    }
  }
  // What the tailor may leave out under the plates: the trunk part of the shell only, because cloth near the arm
  // openings moves with the arms and shows when they lift.
  const clav = body.weight(/^(clavicle|upperarm)/), top = build === "hardshell" ? ribs + 0.02 * k : -Infinity;
  const covers = [cut(g.s, i => { const v = body.nearest(g.s.anchor(i), 1); return Math.min(0.2 - (v < 0 ? 1 : clav[v]), g.s.pos[i * 3 + 1] - top); })];
  const cuirass = part(plates, layer.color, "spine_03", "Cuirass", kind);
  cuirass.plateFinish = { kind, build, ribs, lames: layer.lames, color: layer.color, trim: layer.trim, device: layer.device, bottom: hem, top: neckY, centreZ: zc };
  const parts = [cuirass];
  if (trim.tri.length) parts.push(part(trim, layer.trim, "spine_03", build === "hardshell" ? "Cuirass accent" : "Cuirass edging", kind === "leather" ? "metal" : kind));
  if (straps.tri.length) parts.push(part(straps, "#4b3628", "spine_03", "Cuirass straps", "leather"));
  if (buckles.tri.length) parts.push(part(buckles, layer.trim, "spine_03", "Cuirass buckles", "metal"));
  if (layer.collar === "mail standard") {
    const columns = coarse ? 44 : 64;
    const standard = mailStandard(body, m, [...under, s, plates, trim], columns);
    parts.push(part(standard.mail, "#494544", "spine_03", "Mail standard", "mail"));
    parts.push(part(standard.band, "#4b3628", "spine_03", "Mail standard band", "leather"), part(standard.buckle, layer.trim, "spine_03", "Mail standard buckle", "metal"));
  } else if (layer.collar !== "open") {
    const ring = new Piece(), accent = new Piece();
    collarPlates(body, m, [...under, s], layer.collar, room, relief, ring, accent);
    parts.push(part(ring, layer.color, "spine_03", layer.collar === "ring" ? "Collar ring" : "Gorget", kind));
    if (accent.tri.length) parts.push(part(accent, layer.trim, "spine_03", "Collar accent", kind));
  }
  if (layer.back === "pack") {
    // A slim unit between the shoulder blades, standing on the back plate.
    let reach = 0;
    for (let i = 0; i < n; i++) if (Math.abs(s.pos[i * 3]) < 0.07 * k && Math.abs(s.pos[i * 3 + 1] - (m.shoulder - 0.1 * k)) < 0.09 * k && s.f.z[i] < 0) reach = Math.max(reach, -s.f.z[i]);
    const unitPiece = new Piece(), vents = new Piece(), centre = [0, m.shoulder - 0.1 * k, zc - reach - 0.022 * k];
    pod(unitPiece, centre, [[0.08 * k, 0, 0], [0, 0.115 * k, 0], [0, 0, 0.03 * k]], chest, { power: 9, rings: 12, around: 28 });
    for (const sx of [-1, 1]) pod(vents, add(centre, [sx * 0.04 * k, 0.03 * k, -0.03 * k]), [[0.022 * k, 0, 0], [0, 0.06 * k, 0], [0, 0, 0.012 * k]], chest, { power: 4, rings: 6, around: 12 });
    parts.push(part(unitPiece, layer.color, "spine_03", "Back unit", kind), part(vents, layer.trim, "spine_03", "Back unit vents", kind));
  }
  return { parts, covers, worn: { kind: "cuirass", shell: s, mantleSurfaces: parts.map(p => p.piece), ease: room, hem } };
}

/** Flat faces with soft corners instead of a round section: a radius scale by direction for `plate`. */
const facet = sides => a => { const sector = TAU / sides, x = ((a + sector / 2) % sector + sector) % sector - sector / 2; return 0.93 / Math.cos(x) + 0.07; };

/**
 * A seated shoulder for forged and leather harness. A shallow cop sits on the point of the shoulder. Narrow lames
 * run from it up the shoulder towards the neck, each tucked under the one outside it, and down the arm, each
 * tucked under the one above. A leather tab with a buckle holds the top lame to the cuirass and a strap round the
 * arm holds the lowest. Every plate lies as close over the clothes as its room allows and follows the limb.
 */
function spaulder(body, m, tube, sign, o, plates, trim, leather) {
  const k = m.k, side = sideName(sign), { size, draw } = o, pointed = o.cut === "pointed";
  const S = body.joint("upperarm_" + side), uS = tube.nearest(S), U = d => uS + d / tube.length;
  const skin = t => body.blend([["clavicle_" + side, (1 - t) * 0.7], ["spine_03", (1 - t) * 0.3], ["upperarm_" + side, t]]);
  const thick = 0.003 * k, lap = 0.009 * k, roll = (pointed ? 0.0016 : 0.0022) * k, rollWidth = 0.007 * k;
  const crease = pointed ? (v, w) => 0.0035 * k * Math.exp(-(((w - 0.5) / 0.05) ** 2)) : null, marks = pointed ? [0.5] : [];
  const half = 0.96 + 0.22 * size, down = (0.036 + 0.012 * size) * k, inward = 0.016 * k, room = o.room, step = (0.0045 + 0.0015 * size) * k;
  // The far edge of each plate dips at the middle on a pointed cut and lifts a little at the sides on a rounded one.
  const sweep = w => (pointed ? 0.022 * k * (1 - Math.abs(2 * w - 1)) ** 1.4 : -0.008 * k * (2 * w - 1) ** 2);
  const base = { thick, roll, rollWidth, relief: crease, marks, followLimb: true };
  // Lames towards the neck, narrowing as the shoulder does. The innermost is laid first and lies lowest.
  const up = clamp(Math.round(0.9 + size * 1.3 + Math.max(0, o.flange) * 0.8), 1, 3), pitchUp = (0.024 + 0.004 * size) * k;
  for (let j = up - 1; j >= 0; j--) {
    const from = -inward - (j + 1) * pitchUp, to = -inward - j * pitchUp + lap, wide = half * (0.62 - 0.1 * j);
    // Its inner edge stands over the lame inside it; its outer edge runs in under the next plate out.
    const lift = (v, w, e) => step * 0.7 * (1 - v) ** 1.5 * (j === up - 1 ? 0.35 : 1) + (crease ? crease(v, w, e) : 0);
    plate(plates, tube, { ...base, u0: U(from), u1: U(to), a0: -wide, a1: wide, rows: 3, cols: 14, gap: room, relief: lift, skin: skin(0.06 + 0.06 * (up - 1 - j)) });
  }
  // The cop: a shallow dome over the point of the shoulder, narrower towards the neck.
  const cop = { ...base, bell: true, u0: U(-inward - lap * 0.4), u1: U(down), a0: -half, a1: half, rows: 8, cols: 20, followLimb: false, gap: room + step * 0.8, flare: step * 0.6, bulge: (0.003 + 0.007 * size) * k, crest: 0.5, edge: sweep, arc: v => mix(0.66, 1, smooth(0, 0.55, v)), skin: skin(0.3) };
  plate(plates, tube, cop);
  // Lames down the arm. The lower ones belong more to the arm, so they slide under the cop as it lifts.
  const count = o.lames, pitch = (0.031 + 0.009 * size) * k, narrow = pointed ? 0.08 : 0.045;
  let low = down;
  for (let i = 0; i < count; i++) {
    const jitter = 1 + (draw(10 + i) - 0.5) * 0.16, top = low - lap, last = i === count - 1, wide = half - 0.07 - i * narrow, t = count === 1 ? 0.85 : mix(0.62, 1, i / (count - 1));
    low = top + lap + pitch * jitter;
    const lame = { ...base, u0: U(top), u1: U(low), a0: -wide, a1: wide, rows: 3, cols: 18, gap: room, flare: step, bulge: 0.001 * k, edge: w => sweep(w) * (last && pointed ? 1.25 : 0.7), lead: w => sweep(w) * 0.45, skin: skin(t) };
    plate(plates, tube, lame);
  }
  // The strap round the arm under the lowest lame, with its buckle at the front.
  const band = 0.02 * k, at = U(low - pitch * 0.55), arm = skin(1), lastWide = half - 0.07 - (count - 1) * narrow;
  plate(leather, tube, { u0: at - band / 2 / tube.length, u1: at + band / 2 / tube.length, a0: lastWide - 0.12, a1: TAU - lastWide + 0.12, rows: 2, cols: 16, gap: Math.max(0.002 * k, room - 0.003 * k), thick: 0.0028 * k, followLimb: true, skin: arm });
  plate(trim, tube, { u0: at - band * 0.8 / tube.length, u1: at + band * 0.8 / tube.length, a0: lastWide + 0.1, a1: lastWide + 0.34, rows: 2, cols: 4, gap: Math.max(0.004 * k, room - 0.001 * k), thick: 0.004 * k, followLimb: true, skin: arm });
  // The leather that holds the top lame to the cuirass, running in over the shoulder with its buckle.
  const tabFrom = -inward - up * pitchUp - 0.04 * k, tabTo = -inward - up * pitchUp + 0.012 * k;
  if (U(tabFrom) > 0.02) {
    const tab = { u0: U(tabFrom), u1: U(tabTo), a0: -0.17, a1: 0.17, rows: 3, cols: 3, gap: room + step * 0.5, thick: 0.003 * k, followLimb: true, skin: skin(0.04) };
    plate(leather, tube, tab);
    plate(trim, tube, { ...tab, a0: -0.25, a1: 0.25, rows: 2, cols: 3, u0: U(tabFrom + 0.012 * k), u1: U(tabFrom + 0.026 * k), gap: room + step * 0.5 + 0.0025 * k, thick: 0.0035 * k });
  }
}

/** One shoulder: a cap over the point of the shoulder, plates down the arm under it and an optional guard towards the neck. */
function pauldron(body, m, points, sign, o, plates, trim, leather) {
  const k = m.k, side = sideName(sign), S = body.joint("upperarm_" + side), E = body.joint("lowerarm_" + side), arm = unit(sub(E, S)), { cut: style, size, draw } = o;
  const count = o.lames, pitch = (0.03 + 0.008 * size) * k, lap = 0.011 * k, down = (0.05 + 0.02 * size) * k, inward = (0.03 + 0.022 * size) * k;
  const A = add(S, [-sign * (inward + 0.06 * k), -0.014 * k, 0]), D = add(S, arm, Math.min(down + count * pitch + 0.05 * k, length(sub(E, S)) * 0.85));
  const B = [0, 1, 2].map(d => 2 * S[d] - 0.5 * A[d] - 0.5 * D[d]), path = Array.from({ length: 33 }, (_, i) => { const t = i / 32; return [0, 1, 2].map(d => (1 - t) ** 2 * A[d] + 2 * t * (1 - t) * B[d] + t * t * D[d]); });
  const tube = new Tube(path, [sign * 0.5, 0.85, 0], [0, 0, 1], 30, 48).measure(points, { reach: 0.17 * k, arc: 2.2, span: 1.8, soften: 2 });
  const uS = tube.nearest(S), U = d => uS + d / tube.length, angular = style === "angular", pointed = style === "pointed";
  if (!angular) {
    // A seated shoulder is measured against the arm and the top of the shoulder only. The chest and the back
    // beside the arm are left out, or the plates would stand off the arm to clear them and read as a bowl.
    const own = points.filter(p => sign * (p[0] - S[0]) > -0.03 * k || p[1] > S[1] - 0.005 * k);
    return spaulder(body, m, new Tube(path, [sign * 0.5, 0.85, 0], [0, 0, 1], 30, 48).measure(own, { reach: 0.17 * k, arc: 2.2, span: 1.2, soften: 2 }), sign, o, plates, trim, leather);
  }
  const skin = t => body.blend([["clavicle_" + side, (1 - t) * 0.7], ["spine_03", (1 - t) * 0.3], ["upperarm_" + side, t]]);
  const thick = (angular ? 0.006 : 0.003) * k, flare = thick + 0.003 * k, roll = angular ? 0 : (pointed ? 0.0018 : 0.0028) * k, groove = angular ? 0.0018 * k : 0;
  const section = angular ? facet(7) : null, crease = pointed ? (v, w) => 0.004 * k * Math.exp(-(((w - 0.5) / 0.045) ** 2)) : null;
  const half = (pointed ? 1.15 : 1.25) + 0.3 * size, capGap = o.room + 0.002 * k, dome = (0.004 + 0.015 * size) * k;
  // The cap narrows towards the neck, so it sits on the shoulder and not across the chest. Its far edge stands over the first plate of the arm.
  const sweep = w => (pointed ? 0.03 * k * (1 - Math.abs(2 * w - 1)) ** 1.3 : angular ? -0.012 * k * smooth(0.55, 1, Math.abs(2 * w - 1)) : -0.014 * k * (2 * w - 1) ** 2);
  const cap = { bell: true, u0: U(-inward), u1: U(down), a0: -half, a1: half, rows: 9, cols: 22, gap: capGap, flare, bulge: dome, thick, edge: sweep, section, crest: 0.62, arc: v => mix(0.45, 1, smooth(0, 0.6, v)), skin: skin(0.3) };
  plate(plates, tube, { ...cap, roll, groove, rollWidth: 0.009 * k, relief: crease, marks: pointed ? [0.5] : [] });
  // On angular plates a bar in the accent colour is set into the cap; on the others studs hold the leathers.
  if (angular) plate(trim, tube, { ...cap, window: [0.5, 0.62, 0.22, 0.78], raise: 0.0015 * k, thick: 0.003 * k });
  else for (const w of [0.09, 0.91]) plate(trim, tube, { ...cap, window: [0.86, 0.92, w - 0.035, w + 0.035], raise: 0.003 * k, thick: 0.003 * k });
  // Plates down the arm, each tucked under the one above. The lower ones belong more to the arm, so they slide under the cap as it lifts.
  for (let i = 0; i < count; i++) {
    const jitter = 1 + (draw(10 + i) - 0.5) * 0.24, top = down - lap + i * pitch, low = top + pitch * jitter + lap, wide = half - 0.1 - i * (pointed ? 0.1 : 0.06), last = i === count - 1, t = count === 1 ? 0.85 : mix(0.6, 1, i / (count - 1));
    const lame = { u0: U(top), u1: U(low), a0: -wide, a1: wide, rows: 4, cols: 20, gap: o.room + (angular ? 0.002 * k : 0), flare: last ? flare * 0.6 : flare, bulge: 0.002 * k, thick, edge: w => sweep(w) * (last && pointed ? 1.2 : 0.75), lead: angular ? null : w => sweep(w) * 0.5, section, skin: skin(t) };
    plate(plates, tube, { ...lame, roll, groove, rollWidth: 0.008 * k, relief: crease, marks: pointed ? [0.5] : [] });
    if (!angular) for (const w of [0.08, 0.92]) plate(trim, tube, { ...lame, window: [0.72, 0.84, w - 0.03, w + 0.03], raise: 0.0028 * k, thick: 0.003 * k });
  }
  // The guard towards the neck lies under the cap and turns up into a standing flange.
  if (o.flange > 0.02) {
    const tall = (0.008 + o.flange * 0.024) * k, from = Math.max(-inward - (0.016 + 0.012 * o.flange) * k, (0.02 - uS) * tube.length);
    plate(plates, tube, { u0: U(from), u1: U(-inward + lap * 0.6), a0: -half * 0.42, a1: half * 0.42, rows: 5, cols: 16, gap: o.room, thick, roll, groove, rollWidth: 0.008 * k,
      relief: (v, w) => tall * (1 - v) ** 2 * Math.max(0, Math.cos((w - 0.5) * Math.PI)), section, skin: skin(0.08) });
  }
}

function pauldrons(body, m, layer, worn) {
  const k = m.k, kind = finishes[layer.material], points = figure(body, shellsOf(worn), m.shoulder - 0.32 * k, m.neck[1] + 0.06 * k), parts = [], draw = draws(layer.seed);
  for (const [sign, bias] of sidesOf(layer.balance)) {
    const plates = new Piece(), trim = new Piece(), leather = new Piece(), side = sideName(sign);
    plates.plateUV = [];
    pauldron(body, m, points, sign, { cut: layer.cut, size: clamp(layer.size + bias), lames: clamp(Math.round(layer.lames + bias * 3), 1, 6), flange: bias < 0 ? 0 : clamp(layer.flange + Math.max(0, bias) * 0.6), room: mm(layer.room) * k, draw }, plates, trim, leather);
    parts.push({ ...part(plates, layer.color, "upperarm_" + side, "Pauldron", kind), shoulderFinish: layer });
    if (trim.tri.length) parts.push(part(trim, layer.trim, "upperarm_" + side, layer.cut === "angular" ? "Pauldron accent" : "Pauldron studs", kind === "leather" ? "metal" : kind));
    if (leather.tri.length) parts.push(part(leather, "#4b3628", "upperarm_" + side, "Pauldron straps", "leather"));
  }
  return { parts, covers: [], worn: { kind: "pauldrons", mantleSurfaces: parts.map(p => p.piece) } };
}

/** Plate options shared by the pieces of one cut. */
function styleOf(cutName, k, leather) {
  const angular = cutName === "angular", pointed = cutName === "pointed", thick = (angular ? 0.005 : leather ? 0.0045 : 0.003) * k;
  return { angular, pointed, thick, flare: thick + 0.003 * k, roll: angular ? 0 : (pointed ? 0.0018 : 0.0026) * k, groove: angular ? 0.0016 * k : 0, rollWidth: 0.008 * k };
}

/** A band of leather round a limb, holding a plate that covers one side of it. */
function strapRound(piece, tube, u, width, gap, skin, from, to) {
  // A strap is too narrow to keep its shape in the game file, where it would be reduced to loose slivers.
  if (coarse) return;
  plate(piece, tube, { u0: u - width / 2 / tube.length, u1: u + width / 2 / tube.length, a0: from, a1: to, rows: 2, cols: 20, gap, thick: 0.0028, skin });
}

function armguards(body, m, layer, worn) {
  const k = m.k, kind = finishes[layer.material], shells = shellsOf(worn), parts = [], st = styleOf(layer.cut, k, kind === "leather"), room = mm(layer.room) * k, draw = draws(layer.seed);
  const points = figure(body, shells, m.shoulder - 0.75 * k, m.shoulder + 0.05 * k), elbow = layer.cover !== "forearm", whole = layer.cover === "whole arm";
  for (const [sign, bias] of sidesOf(layer.balance)) {
    const side = sideName(sign), S = body.joint("upperarm_" + side), E = body.joint("lowerarm_" + side), H = body.joint("hand_" + side), plates = new Piece(), straps = new Piece();
    plates.plateUV = [];
    const fore = body.rigid("lowerarm_" + side), upper = body.rigid("upperarm_" + side), bend = body.blend([["lowerarm_" + side, 0.5], ["upperarm_" + side, 0.5]]);
    // The back of the forearm faces away from the body and a little behind.
    const lower = new Tube([E, H], [sign * 0.75, 0.35, -0.55], [0, 0, 1], 16, 40).measure(points, { reach: 0.1 * k, soften: 3 });
    const full = bias > 0.2 || (layer.balance === "matched" && layer.room > 9), wrap = st.angular ? 1.75 : full ? 2.25 : 1.95, section = st.angular ? facet(6) : null;
    const guard = { bell: true, followLimb: true, u0: 0.14, u1: 0.9, a0: -wrap, a1: wrap, rows: 7, cols: 22, gap: room, flare: -0.001 * k, lead: w => -0.02 * k * Math.max(0, Math.cos((w - 0.5) * Math.PI)) ** 1.5 * (st.pointed ? 1.6 : 1), bulge: (st.angular ? 0.004 : 0.002) * k, thick: st.thick, section, skin: fore };
    plate(plates, lower, { ...guard, roll: st.roll, groove: st.groove, rollWidth: st.rollWidth, relief: st.pointed ? (v, w) => 0.0035 * k * Math.exp(-(((w - 0.5) / 0.05) ** 2)) : st.angular ? null : v => 0.004 * k * (1 - v) ** 3, marks: st.pointed ? [0.5] : [] });
    // The inner half closes the guard on a heavier arm; a lighter one is strapped on.
    if (full && !st.angular) plate(plates, lower, { u0: 0.2, u1: 0.88, a0: wrap - 0.12, a1: TAU - wrap + 0.12, rows: 5, cols: 14, gap: room - 0.0015 * k, thick: st.thick, roll: st.roll * 0.6, rollWidth: st.rollWidth, skin: fore });
    else for (const u of [0.3, 0.72]) strapRound(straps, lower, u, (st.angular ? 0.03 : 0.017) * k, room - 0.003 * k, fore, wrap - 0.25, TAU - wrap + 0.25);
    if (st.angular) plate(straps, lower, { ...guard, window: [0.3, 0.62, 0.4, 0.6], raise: 0.0015 * k, thick: 0.003 * k });
    if (elbow) {
      // The elbow cop bends with the arm: it sits where the two directions meet and faces away from the inside of the bend.
      const a = unit(sub(S, E)), b = unit(sub(H, E)), inside = add(a, b), out = length(inside) > 0.08 ? scale(unit(inside), -1) : [0, 0, -1];
      const P0 = add(E, a, 0.075 * k), P1 = add(E, b, 0.075 * k), mid = [0, 1, 2].map(d => 2 * E[d] - 0.5 * P0[d] - 0.5 * P1[d]), path = Array.from({ length: 17 }, (_, i) => { const t = i / 16; return [0, 1, 2].map(d => (1 - t) ** 2 * P0[d] + 2 * t * (1 - t) * mid[d] + t * t * P1[d]); });
      const joint = new Tube(path, out, [0, 0, 1], 14, 40).measure(points, { reach: 0.1 * k, arc: 2.2, soften: 3 });
      plate(plates, joint, { u0: 0.2, u1: 0.8, a0: -1.45, a1: 1.45, rows: 6, cols: 16, gap: room + 0.004 * k, bulge: (0.01 + 0.006 * Math.max(0, bias)) * k, thick: st.thick, roll: st.roll, groove: st.groove, rollWidth: st.rollWidth, edge: w => -0.012 * k * (2 * w - 1) ** 2, lead: w => 0.012 * k * (2 * w - 1) ** 2, relief: st.pointed ? (v, w) => 0.004 * k * Math.exp(-(((w - 0.5) / 0.06) ** 2)) : null, section: st.angular ? facet(6) : null, marks: st.pointed ? [0.5] : [], skin: bend });
    }
    if (whole) {
      const high = new Tube([S, E], [sign * 0.8, 0.5, -0.2], [0, 0, 1], 16, 40).measure(points, { reach: 0.11 * k, soften: 3 });
      plate(plates, high, { u0: 0.5 + 0.06 * draw(3), u1: 0.86, a0: -1.9, a1: 1.9, rows: 5, cols: 20, gap: room + 0.001 * k, flare: st.flare * 0.5, thick: st.thick, roll: st.roll, groove: st.groove, rollWidth: st.rollWidth, section: st.angular ? facet(6) : null, skin: upper });
      strapRound(straps, high, 0.68, 0.017 * k, room - 0.002 * k, upper, 1.7, TAU - 1.7);
    }
    parts.push({ ...part(plates, layer.color, "lowerarm_" + side, elbow ? "Arm guard" : "Vambrace", kind), limbFinish: layer });
    if (straps.tri.length) parts.push(part(straps, layer.trim, "lowerarm_" + side, st.angular ? "Arm guard accent" : "Arm guard straps", st.angular ? kind : "leather"));
  }
  return { parts, covers: [], worn: { kind: "armguards" } };
}

/** The two ends tuck below the shin plate. Across the back the fastening sits on the worn surface. */
function calfStrap(piece, tube, u, width, plateGap, skin, wrap, k) {
  const outer = [], inner = [], steps = coarse ? 10 : 20;
  for (const edge of [-0.5, 0.5]) {
    const at = u + edge * width / tube.length, face = [], back = [];
    for (let i = 0; i <= steps; i++) {
      const w = i / steps, a = mix(wrap - 0.24, TAU - wrap + 0.24, w);
      const end = 1 - smooth(0, 0.21, Math.min(w, 1 - w));
      const r = tube.radius(at, a) + mix(0.0025 * k, plateGap - 0.001 * k, end);
      face.push(tube.point(at, a, r));
      back.push(tube.point(at, a, r - 0.0025 * k));
    }
    outer.push(face);
    inner.push(back);
  }
  piece.slab(outer, inner, skin);
}

function legguards(body, m, layer, worn) {
  const k = m.k, kind = finishes[layer.material], shells = shellsOf(worn), parts = [], st = styleOf(layer.cut, k, kind === "leather"), draw = draws(layer.seed);
  const shafts = worn.find(w => w.kind === "boots")?.shafts ?? [];
  const room = mm(layer.room) * k, points = figure(body, [...shells, ...shafts], body.floor + 0.03 * k, m.hip + 0.03 * k, v => Math.abs(body.P[v * 3]) > 0.004);
  const knee = layer.cover !== "shin", whole = layer.cover === "whole leg", section = st.angular ? facet(6) : null;
  for (const sign of [1, -1]) {
    const side = sideName(sign), T = body.joint("thigh_" + side), K = body.joint("calf_" + side), F = body.joint("foot_" + side), plates = new Piece(), straps = new Piece();
    plates.plateUV = [];
    const own = points.filter(p => p[0] * sign > 0), shin = body.rigid("calf_" + side), thigh = body.rigid("thigh_" + side), bend = body.blend([["calf_" + side, 0.5], ["thigh_" + side, 0.5]]);
    const lower = new Tube([K, F], [sign * 0.12, 0, 1], [sign, 0, 0], 18, 40).measure(own, { reach: 0.12 * k, soften: 3 });
    const gap = room, wrap = st.angular ? 1.6 : whole ? 2.2 : 1.85;
    // The greave follows the shin from under the knee to the ankle and opens over the instep.
    const greave = { bell: true, followLimb: true, u0: 0.11, u1: 0.9, a0: -wrap, a1: wrap, rows: 8, cols: 22, gap, lead: w => k * (.024 - .057 * Math.sin(w * Math.PI) ** 2), edge: w => k * (.012 - .041 * Math.sin(w * Math.PI) ** 4), bulge: 0.002 * k, thick: st.thick, section, skin: shin };
    plate(plates, lower, { ...greave, roll: st.roll, groove: st.groove, rollWidth: st.rollWidth, relief: st.angular ? null : (v, w) => (st.pointed ? 0.0045 : 0.0025) * k * Math.exp(-(((w - 0.5) / 0.05) ** 2)), marks: st.angular ? [] : [0.5] });
    if (whole && !st.angular) plate(plates, lower, { u0: 0.16, u1: 0.86, a0: wrap - 0.12, a1: TAU - wrap + 0.12, rows: 6, cols: 14, gap: gap - 0.0015 * k, thick: st.thick, roll: st.roll * 0.6, rollWidth: st.rollWidth, skin: shin });
    else {
      const bands = new Piece();
      for (const u of [0.28, 0.7]) calfStrap(bands, lower, u, (st.angular ? 0.032 : 0.018) * k, gap, shin, wrap, k);
      parts.push(part(bands, st.angular ? "#463d36" : layer.trim, "calf_" + side, "Greave straps", "leather"));
    }
    if (st.angular) plate(straps, lower, { ...greave, window: [0.24, 0.5, 0.43, 0.57], raise: 0.0015 * k, thick: 0.003 * k });
    if (knee) {
      const a = unit(sub(T, K)), b = unit(sub(F, K)), P0 = add(K, a, 0.1 * k), P1 = add(K, b, 0.085 * k), mid = [0, 1, 2].map(d => 2 * K[d] - 0.5 * P0[d] - 0.5 * P1[d]), path = Array.from({ length: 17 }, (_, i) => { const t = i / 16; return [0, 1, 2].map(d => (1 - t) ** 2 * P0[d] + 2 * t * (1 - t) * mid[d] + t * t * P1[d]); });
      const joint = new Tube(path, [sign * 0.1, 0, 1], [sign, 0, 0], 16, 40).measure(own, { reach: 0.13 * k, arc: 2.3, soften: 3 });
      const cap = room + 0.004 * k;
      // The knee cop with a narrow plate above and below it, so the knee can fold.
      if (!st.angular) for (const [u0, u1, t] of [[0.08, 0.36, 0.2], [0.64, 0.92, 0.8]]) plate(plates, joint, { u0, u1, a0: -1.25, a1: 1.25, rows: 3, cols: 14, gap: cap - 0.002 * k, thick: st.thick, roll: st.roll * 0.7, rollWidth: st.rollWidth, skin: body.blend([["calf_" + side, t], ["thigh_" + side, 1 - t]]) });
      plate(plates, joint, { u0: 0.27, u1: 0.73, a0: -1.4, a1: 1.4, rows: 6, cols: 16, gap: cap + st.thick, bulge: 0.012 * k, thick: st.thick, roll: st.roll, groove: st.groove, rollWidth: st.rollWidth, edge: w => -0.014 * k * (2 * w - 1) ** 2, lead: w => 0.014 * k * (2 * w - 1) ** 2,
        relief: st.pointed ? (v, w) => 0.005 * k * Math.exp(-(((w - 0.5) / 0.06) ** 2)) : null, section, marks: st.pointed ? [0.5] : [], skin: bend });
    }
    if (whole) {
      const high = new Tube([T, K], [sign * 0.35, 0, 1], [sign, 0, 0], 18, 40).measure(own, { reach: 0.16 * k, arc: 2.4, soften: 3 });
      plate(plates, high, { u0: 0.34 + 0.05 * draw(4), u1: 0.84, a0: -1.25, a1: 1.6, rows: 7, cols: 20, gap: room + 0.002 * k, thick: st.thick, roll: st.roll, groove: st.groove, rollWidth: st.rollWidth, lead: w => -0.03 * k * Math.max(0, Math.cos((w - 0.45) * Math.PI)) ** 2,
        relief: st.angular ? null : (v, w) => 0.003 * k * Math.exp(-(((w - 0.44) / 0.05) ** 2)), section, marks: st.angular ? [] : [0.44], skin: thigh });
      strapRound(straps, high, 0.6, 0.02 * k, room - 0.002 * k, thigh, 1.4, TAU - 1.1);
    }
    parts.push({ ...part(plates, layer.color, "calf_" + side, knee ? "Leg guard" : "Greave", kind), limbFinish: layer });
    if (straps.tri.length) parts.push(part(straps, layer.trim, "calf_" + side, st.angular ? "Leg guard accent" : "Leg guard straps", st.angular ? kind : "leather"));
  }
  return { parts, covers: [], worn: { kind: "legguards" } };
}

function tassets(body, m, layer, worn) {
  const k = m.k, kind = finishes[layer.material], shells = shellsOf(worn), st = styleOf(layer.cut, k, kind === "leather"), draw = draws(layer.seed), room = mm(layer.room) * k;
  const cuirassWorn = worn.findLast(w => w.kind === "cuirass"), top = (cuirassWorn?.hem ?? m.waist - 0.03 * k) + 0.012 * k, knee = body.joint("calf_l")[1], bottom = mix(m.hip - 0.05 * k, mix(m.hip, knee, 0.78), layer.length);
  const arm = body.weight(/^(upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)/), points = figure(body, shells, bottom - 0.04 * k, top + 0.05 * k, v => arm[v] < 0.3);
  const tube = new Tube([[0, top, m.pelvis[2]], [0, bottom, m.pelvis[2]]], [0, 0, 1], [1, 0, 0], Math.max(8, Math.round((top - bottom) / (0.02 * k))), 64).measure(points, { reach: 0.4 * k, span: 1.2, soften: 2, hang: st.angular ? [0.5, 1] : [-0.1, 1] });
  // Where each plate hangs round the hips and how wide it is, in radians. Angular plates are narrower and leave the suit showing between them.
  const places = { front: [[0.44, 0.74]], "front and sides": [[0.44, 0.74], [1.38, 0.86]], "all round": [[0.44, 0.74], [1.38, 0.86], [2.5, 0.92]] }[layer.plates].map(([at, wide]) => (st.angular ? [at === 0.44 ? 0.5 : at, wide * 0.72] : [at, wide]));
  const plates = new Piece(), trim = new Piece(), count = Math.round(layer.lames), lap = 0.017 * k / tube.length, parts = [];
  for (const sign of [1, -1]) for (const [n, [at, wide]] of places.entries()) {
    const side = sideName(sign), centre = sign * at, a0 = centre - wide / 2, a1 = centre + wide / 2, long = n === 0 ? 1 : n === 1 ? 0.8 : 0.66, each = long / count;
    for (let j = 0; j < count; j++) {
      const u0 = Math.max(0, j * each - (j ? lap : 0)), u1 = Math.min(1, (j + 1) * each * (1 + (j === count - 1 ? (draw(n * 7 + j) - 0.5) * 0.12 : 0))), last = j === count - 1, share = (n === 0 ? 1 : n === 1 ? 0.75 : 0.9) * mix(0.36, 0.5, count === 1 ? 0.6 : j / (count - 1));
      const sweep = w => (last ? (st.pointed ? 0.045 * k * (1 - Math.abs(2 * w - 1)) ** 1.2 - 0.02 * k : st.angular ? -0.02 * k * smooth(0.5, 1, Math.abs(2 * w - 1)) : -0.02 * k * (2 * w - 1) ** 2) : 0);
      plate(plates, tube, { u0, u1, a0, a1, rows: 4, cols: 16, gap: room + 0.002 * k, flare: st.flare + 0.004 * k * j, thick: st.thick, roll: st.roll, groove: st.groove, rollWidth: st.rollWidth, edge: sweep, bulge: 0.003 * k,
        relief: st.pointed ? (v, w) => 0.004 * k * Math.exp(-(((w - 0.5) / 0.05) ** 2)) : null, marks: st.pointed ? [0.5] : [], skin: body.blend([["pelvis", 1 - share], ["thigh_" + side, share]]) });
      if (!st.angular && !last) for (const a of [a0 + 0.07, a1 - 0.07]) stud(trim, tube, u1 - 0.013 * k / tube.length, a, tube.radius(u1, a) + room + 0.002 * k + st.flare + 0.004 * k * j, 0.0038 * k, body.blend([["pelvis", 1 - share], ["thigh_" + side, share]]));
    }
  }
  parts.push(part(plates, layer.color, "pelvis", "Tassets", kind));
  if (trim.tri.length) parts.push(part(trim, layer.trim, "pelvis", "Tasset studs", kind === "leather" ? "metal" : kind));
  return { parts, covers: [], worn: { kind: "tassets" } };
}

function travellingMantle(body, m, layer, worn, later, options) {
  const k = m.k;
  // The positive angular side of a downward-facing envelope crosses the right shoulder.
  const side = layer.shoulder === "right" ? 1 : -1;
  const shortDrop = (m.neck[1] - m.chest[1]) + .045 * k;
  const longDrop = (m.neck[1] - m.waist) + (.10 + .32 * layer.length) * k;
  const surfaces = [...shellsOf(worn), ...worn.flatMap(layer => layer.mantleSurfaces ?? [])];
  const cut = mantle(body, m, surfaces, {
    open: v => .40 + 1.28 * v,
    swing: v => -side * (.28 + .83 * v),
    drop: (a, direction) => mix(shortDrop, longDrop, smooth(.74, 2.45, a)
      * (.91 + .09 * side * direction * Math.sin(a)) + .12 * Math.max(0, side * direction * Math.sin(a)) ** 2),
    facing: .065, ease: .018, fold: .039, flare: .016, armLow: m.shoulder - .19 * k,
    cols: options?.game ? 32 : 54,
  });
  const metal = new Piece(), pin = cut.at(.21, side, .004 * k);
  const skin = body.rigid("spine_03");
  // Cast penannular brooch, with two terminals separated at the bottom and a diagonal pin.
  const rings = [];
  for (let j = 0; j <= 22; j++) {
    const a = mix(.36, TAU - .36, j / 22), x = Math.sin(a), y = -Math.cos(a);
    rings.push(Array.from({length: 6}, (_, n) => {
      const u = TAU * n / 6, radius = (.023 + .0038 * Math.cos(u)) * k;
      return [pin[0] + x * radius, pin[1] + y * radius, pin[2] + .0038 * k * Math.sin(u)];
    }));
  }
  metal.loft(rings, skin, {capStart:true, capEnd:true});
  pod(metal, pin, [[.004*k, -.001*k, 0], [.010*k, .027*k, 0], [0, 0, .004*k]], skin);
  return { parts: [
    { ...part(cut.cloth, layer.color, "spine_03", "Travelling mantle", "cloth"), mantleFinish: layer },
    part(cut.lining, layer.trim, "spine_03", "Wool facing", "cloth"),
    part(metal, layer.clasp, "spine_03", "Mantle brooch", "metal"),
  ], covers: [], worn: {kind:"travellingMantle"} };
}

export const armourMakers = { travellingMantle, cuirass: built(cuirass), pauldrons: built(pauldrons), armguards: built(armguards), legguards: built(legguards), tassets: built(tassets) };

/** The looks a whole set can start from. Each is a way of combining the pieces, not a fixed costume: the seed chooses within it. */
export const armourLooks = ["Light fantasy", "Heavy fantasy", "Light sci-fi", "Heavy sci-fi"];

/**
 * A whole outfit of tailor layers in a look: clothes to wear under the plates and the plates themselves.
 * The same seed and look always give the same outfit; another seed changes cuts, proportions, sides and colours.
 * Missing fields take each piece's starting values, so the result can be edited piece by piece afterwards.
 */
export function armourSet(seed = 0, look = armourLooks[0]) {
  const draw = draws(seed), pick = (n, list) => list[Math.floor(draw(n) * list.length) % list.length], heavy = /^Heavy/.test(look), scifi = /sci-fi/.test(look);
  seed = Math.abs(Math.round(seed)) % 1000;
  const lopsided = pick(1, ["left heavier", "right heavier"]), single = pick(1, ["left only", "right only"]), layers = [];
  if (scifi) {
    const [shell, accent] = pick(2, [["#d5d8d2", "#d9642c"], ["#59664f", "#d8c23a"], ["#3f4650", "#35a7c2"], ["#b9b3a2", "#a8322c"], ["#c8ccd0", "#2f6fb5"]]), suit = pick(3, ["#23272c", "#2a2f38", "#2c2a28"]);
    const plates = { color: shell, trim: accent, material: "lacquer" };
    layers.push({ piece: "trousers", color: suit, fit: 1, ease: 4, waistband: 0, hemBand: 0, pockets: "none" });
    layers.push({ piece: "top", color: suit, sleeve: 1.95, length: 0.7, ease: 3, stiff: 0.1, neck: "high", collar: "stand", front: "plain", cuff: 0, hemBand: 0, pockets: "none" });
    layers.push({ piece: "boots", color: pick(4, ["#2b2d30", "#3a3c40"]), sole: "#1c1d1f", height: heavy ? 1.45 : 1.6, ease: 7, straight: 0.3, cuff: 26, thick: heavy ? 24 : 16, heel: 4, toe: 6 });
    layers.push({ piece: "gloves", color: suit, from: 1.9, ease: 3, cuff: 0 });
    layers.push({ piece: "cuirass", ...plates, build: "hardshell", length: heavy ? 0.5 : 0.2, room: heavy ? 22 : 11, relief: 0.4 + 0.5 * draw(5), lames: heavy ? 3 : 2, collar: heavy ? "ring" : "open", back: heavy || draw(6) > 0.5 ? "pack" : "plain", seed });
    if (heavy) layers.push({ piece: "tassets", ...plates, cut: "angular", plates: "front and sides", lames: 1, length: 0.2 + 0.2 * draw(7), room: 12, seed });
    layers.push({ piece: "armguards", ...plates, cut: "angular", cover: heavy ? "whole arm" : "forearm", balance: heavy ? "matched" : pick(8, ["matched", lopsided]), room: heavy ? 9 : 5, seed });
    layers.push({ piece: "legguards", ...plates, cut: "angular", cover: heavy ? "whole leg" : "shin and knee", room: heavy ? 11 : 6, seed });
    layers.push({ piece: "pauldrons", ...plates, cut: "angular", lames: heavy ? 2 : 1, size: heavy ? 0.75 + 0.25 * draw(9) : 0.2 + 0.25 * draw(9), flange: heavy ? 0.3 * draw(10) : 0, balance: heavy ? pick(11, ["matched", lopsided, lopsided]) : pick(11, [single, lopsided, "matched"]), room: heavy ? 10 : 6, seed });
    return { layers };
  }
  const [steel, edge] = pick(2, [["#8d9197", "#b08d4a"], ["#70767d", "#8f9296"], ["#9a927f", "#6b4a2e"], ["#5d6066", "#b9772f"], ["#a2a6aa", "#59606b"]]), cloth = pick(3, ["#5b3f3a", "#3e4a5a", "#4d5540", "#6a5a44", "#4a3d52"]), hide = pick(4, ["#5b4334", "#4a3a2c", "#6b4d36"]);
  const leatherLight = !heavy && draw(5) > 0.5, plates = { color: leatherLight ? hide : steel, trim: edge, material: leatherLight ? "leather" : "steel" }, limb = { color: steel, trim: hide, material: "steel" };
  const cutName = pick(6, ["rounded", "pointed", "rounded"]);
  layers.push({ piece: "trousers", color: pick(7, ["#3a3d44", "#44403a", "#33373a"]), fit: 0.7, ease: 7, pockets: "none", hemBand: 0 });
  // A padded coat under the plates: stiff, high at the neck and long enough to show below the cuirass.
  layers.push({ piece: "top", color: cloth, material: heavy && draw(19) < .58 ? "mail" : "cloth", sleeve: 1.9, length: 0.95, ease: heavy ? 9 : 7, stiff: 0.75, neck: "high", collar: "stand", front: "plain", cuff: 14, hemBand: 12, pockets: "none" });
  layers.push({ piece: "boots", color: hide, fastening: "buckled", height: heavy ? 1.3 : 1.45, ease: 9, straight: 0.4, cuff: 30, thick: 12, heel: 10 });
  if (heavy || draw(8) > 0.4) layers.push({ piece: "gloves", color: hide, from: 1.7, ease: 4, cuff: 10 });
  layers.push({ piece: "cuirass", ...plates, build: heavy ? pick(9, ["fitted", "segmented"]) : pick(9, ["fitted", "fitted", "segmented"]), length: heavy ? 0.55 : 0.3, room: heavy ? 18 : 10, relief: 0.45 + 0.5 * draw(10), lames: heavy ? 4 : 3, collar: heavy ? "gorget" : "open", seed });
  if (heavy) layers.push({ piece: "tassets", color: steel, trim: edge, material: "steel", cut: cutName, plates: pick(11, ["front and sides", "all round"]), lames: 3, length: 0.35 + 0.3 * draw(12), room: 12, seed });
  layers.push({ piece: "armguards", ...limb, cut: cutName, cover: heavy ? "whole arm" : "forearm", balance: heavy ? "matched" : pick(13, ["matched", single, lopsided]), room: heavy ? 10 : 5, seed });
  if (heavy || draw(14) > 0.5) layers.push({ piece: "legguards", ...limb, cut: cutName, cover: heavy ? "whole leg" : "shin", room: heavy ? 10 : 6, seed });
  layers.push({ piece: "pauldrons", color: steel, trim: edge, material: "steel", cut: cutName, lames: heavy ? 3 + Math.floor(draw(15) * 2) : 2, size: heavy ? 0.7 + 0.3 * draw(16) : 0.15 + 0.3 * draw(16), flange: heavy ? 0.4 + 0.6 * draw(17) : 0, balance: heavy ? pick(18, [lopsided, lopsided, "matched"]) : pick(18, [single, lopsided, lopsided]), room: heavy ? 9 : 6, seed });
  layers.push({ piece: "belt", color: hide, at: 0.75, height: heavy ? 44 : 34 });
  return { layers };
}

/**
 * A whole set named in a few words, as `humanStyle.armour` keeps it: { look, seed, pieces }. `pieces` changes single
 * choices of a piece of the set, adds an armour piece the look leaves off, or leaves a piece off with null:
 * { look: "Heavy fantasy", seed: 12, pieces: { pauldrons: { balance: "left only" }, tassets: null } }.
 * The wardrobe checks the values themselves against each piece's fields.
 */
export function validArmour(armour) {
  if (!armour || typeof armour !== "object" || Array.isArray(armour)) return false;
  const { look = armourLooks[0], seed = 0, pieces = {}, ...rest } = armour;
  if (Object.keys(rest).length || !armourLooks.includes(look) || !Number.isInteger(seed) || seed < 0 || seed > 999999 || !pieces || typeof pieces !== "object" || Array.isArray(pieces)) return false;
  const worn = new Set([...Object.keys(armourPieces), ...armourSet(seed, look).layers.map(layer => layer.piece)]);
  return Object.entries(pieces).every(([piece, changes]) => worn.has(piece) && (changes === null || (typeof changes === "object" && !Array.isArray(changes) && !("piece" in changes))));
}
/** The tailor layers of a set named with `validArmour`'s words. */
export function armourTailor({ look = armourLooks[0], seed = 0, pieces = {} } = {}) {
  const layers = armourSet(seed, look).layers.filter(layer => pieces[layer.piece] !== null).map(layer => ({ ...layer, ...pieces[layer.piece] }));
  // An armour piece the look leaves off is put on before the shoulders, which lie over everything else.
  const extra = Object.keys(armourPieces).filter(piece => pieces[piece] && !layers.some(layer => layer.piece === piece)).map(piece => ({ piece, ...pieces[piece] }));
  const at = layers.findIndex(layer => layer.piece === "pauldrons");
  layers.splice(at < 0 ? layers.length : at, 0, ...extra);
  return { layers };
}
/** What an assistant needs to know to dress an adult in armour without writing code. */
export const armourInstructions = {
  looks: armourLooks,
  pieces: Object.fromEntries(Object.entries(armourPieces).map(([piece, spec]) => [piece, Object.fromEntries(Object.entries(spec.fields).filter(([, field]) => field.type === "choice").map(([key, field]) => [key, field.options]))])),
  numericLimits: Object.fromEntries(Object.entries(armourPieces).map(([piece, spec]) => [
    piece,
    Object.fromEntries(Object.entries(spec.fields).filter(([, field]) => field.type === "range")
      .map(([key, field]) => [key, [field.min, field.max]])),
  ])),
  example: { op: "setForm", set: { outfit: "Work clothes", humanStyle: { armour: { look: "Light fantasy", seed: 31 } } } },
  fields: "Each piece lists its accepted overrides. Numeric pairs are inclusive ranges. A look plus a seed gives a complete outfit. Add piece overrides only for specific changes.",
  usage: "setForm.set.humanStyle.armour = { look, seed } dresses an adult in a whole armour set over its own undergarment; form.outfit must be Work clothes. The seed (0 to 999999) chooses cuts, proportions, which side is heavier and the colours within the look, so try another seed for another variation. pieces changes single parts and keeps the rest of the set: { pieces: { pauldrons: { balance: \"left only\", size: 0.8 }, cuirass: { build: \"segmented\", collar: \"gorget\" }, tassets: null } }. null leaves a part off; naming an armour part the look leaves off adds it. Every part also takes color, trim (#rrggbb), material (steel, leather, lacquer), room in millimetres over the clothes and its own seed (0 to 999). Sizes and lengths run 0 to 1. Choosing a preset outfit puts the armour away. For full control write the same parts as humanStyle.tailor.layers, in dressing order.",
};
