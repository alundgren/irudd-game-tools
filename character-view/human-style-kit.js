import * as T from "three";

const BODY_SOURCE_VERTICES = 13380;
export const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
export const mix = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = a => Math.hypot(a[0], a[1], a[2]);
export const unit = a => { const l = length(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const lerp3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const h = (a, b, c) => { let n = Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 2147483647); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967295; };
  const at = (dz) => mix(mix(h(xi, yi, zi + dz), h(xi + 1, yi, zi + dz), u), mix(h(xi, yi + 1, zi + dz), h(xi + 1, yi + 1, zi + dz), u), v);
  return mix(at(0), at(1), w);
}
export function hash1(n) { let x = Math.imul(n | 0, 0x9e3779b1); x = Math.imul(x ^ (x >>> 15), 0x85ebca6b); return ((x ^ (x >>> 13)) >>> 0) / 4294967295; }

export function mergeSkin(pairs) {
  const sum = new Map();
  for (const [bone, weight] of pairs) if (weight > 0) sum.set(bone, (sum.get(bone) ?? 0) + weight);
  const best = [...sum].sort((a, b) => b[1] - a[1]).slice(0, 4), total = best.reduce((s, x) => s + x[1], 0) || 1;
  const bones = [0, 0, 0, 0], weights = [0, 0, 0, 0];
  best.forEach(([bone, weight], i) => { bones[i] = bone; weights[i] = weight / total; });
  if (!best.length) weights[0] = 1;
  return [bones, weights];
}

export function analyse(surface) {
  const { positions: P, names, ids } = surface;
  let count = 0;
  while (count < ids.length && ids[count] < BODY_SOURCE_VERTICES) count++;
  const tri = [];
  for (let i = 0; i < surface.indices.length; i += 3) {
    const a = surface.indices[i], b = surface.indices[i + 1], c = surface.indices[i + 2];
    if (a < count && b < count && c < count) tri.push(a, b, c);
  }
  const N = new Float32Array(count * 3);
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t] * 3, b = tri[t + 1] * 3, c = tri[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    for (const k of [a, b, c]) { N[k] += x; N[k + 1] += y; N[k + 2] += z; }
  }
  for (let i = 0; i < N.length; i += 3) { const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1; N[i] /= l; N[i + 1] /= l; N[i + 2] /= l; }
  let floor = Infinity, top = -Infinity;
  for (let i = 0; i < count; i++) { floor = Math.min(floor, P[i * 3 + 1]); top = Math.max(top, P[i * 3 + 1]); }
  const bone = name => { const i = names.indexOf(name); if (i < 0) throw new Error("The human rig has no " + name + " joint."); return i; };
  const joint = name => { const i = bone(name) * 3; return [surface.joints[i], surface.joints[i + 1], surface.joints[i + 2]]; };
  const fields = new Map();
  function weight(pattern) {
    const key = String(pattern);
    if (!fields.has(key)) {
      const pick = names.map(name => pattern.test(name)), out = new Float32Array(count);
      for (let v = 0; v < count; v++) for (let j = v * 4; j < v * 4 + 4; j++) if (pick[surface.boneIndices[j]]) out[v] += surface.weights[j];
      fields.set(key, out);
    }
    return fields.get(key);
  }
  const point = v => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
  function limb(rootName, middleName, endName, tipPattern) {
    const out = new Float32Array(count).fill(-.3), most = new Float32Array(count);
    for (const side of ["l", "r"]) {
      const root = joint(rootName + "_" + side), middle = joint(middleName + "_" + side), end = joint(endName + "_" + side);
      const a = sub(middle, root), b = sub(end, middle), la = dot(a, a), lb = dot(b, b);
      const wa = weight(new RegExp("^" + rootName + "_" + side)), wb = weight(new RegExp("^" + middleName + "_" + side));
      const wc = weight(new RegExp("^(" + endName + "|" + tipPattern + ")_?.*_" + side + "$"));
      for (let v = 0; v < count; v++) {
        const total = wa[v] + wb[v] + wc[v];
        if (total <= most[v]) continue;
        most[v] = total;
        const p = point(v), ta = dot(sub(p, root), a) / la, tb = dot(sub(p, middle), b) / lb;
        const along = (wa[v] * Math.min(ta, 1.1) + wb[v] * (1 + clamp(tb, -.1, 1.1)) + wc[v] * (2 + Math.max(0, tb - 1))) / total;
        out[v] = mix(-.3, along, smooth(0, .55, total));
      }
    }
    return out;
  }
  const scale = (top - floor) / 1.72;
  const cell = .03 * scale, grid = new Map();
  const key = (x, y, z) => (Math.floor(x / cell) + 512) + (Math.floor(y / cell) + 512) * 1024 + (Math.floor(z / cell) + 512) * 1048576;
  for (let v = 0; v < count; v++) { const k = key(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(v); }
  function nearest(p, reach = 3, skip = null) {
    let best = -1, distance = Infinity;
    const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell), cz = Math.floor(p[2] / cell);
    for (let ring = 0; ring <= reach && (best < 0 || ring <= 1 || distance > ((ring - 1) * cell) ** 2); ring++)
      for (let x = -ring; x <= ring; x++) for (let y = -ring; y <= ring; y++) for (let z = -ring; z <= ring; z++) {
        if (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) !== ring) continue;
        const list = grid.get((cx + x + 512) + (cy + y + 512) * 1024 + (cz + z + 512) * 1048576);
        if (list) for (const v of list) { if (skip?.[v]) continue; const d = (P[v * 3] - p[0]) ** 2 + (P[v * 3 + 1] - p[1]) ** 2 + (P[v * 3 + 2] - p[2]) ** 2; if (d < distance) { distance = d; best = v; } }
      }
    return best;
  }
  const skinOf = v => [[...surface.boneIndices.subarray(v * 4, v * 4 + 4)], [...surface.weights.subarray(v * 4, v * 4 + 4)]];
  const rigid = name => [[bone(name), 0, 0, 0], [1, 0, 0, 0]];
  function skinAt(p) { const v = nearest(p, 8); return v < 0 ? rigid("spine_02") : skinOf(v); }
  let arms = null;
  function trunkAt(p) {
    arms ??= weight(/^(upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)/).map(w => w > .05 ? 1 : 0);
    const v = nearest(p, 8, arms);
    return v < 0 ? rigid("spine_02") : skinOf(v);
  }
  function clear(p, gap) {
    const v = nearest(p, 2);
    if (v < 0) return p;
    const n = [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]], d = dot(sub(p, point(v)), n);
    return d < gap && d > -.08 * scale ? add(p, n, gap - d) : p;
  }
  const body = {
    surface, P, N, tri, count, names, floor, top, scale, bone, joint, weight, point, nearest, skinAt, trunkAt, skinOf, rigid, clear,
    arm: null, leg: null,
    blend(parts) { return mergeSkin(parts.flatMap(([name, w]) => [[bone(name), w]])); },
  };
  body.arm = limb("upperarm", "lowerarm", "hand", "thumb|index|middle|ring|pinky");
  body.leg = limb("thigh", "calf", "foot", "ball");
  return body;
}

export class Shell {
  constructor() { this.pos = []; this.anc = []; this.nrm = []; this.bones = []; this.weights = []; this.tri = []; this.f = {}; }
  get count() { return this.pos.length / 3; }
  at(i) { return [this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]]; }
  anchor(i) { return [this.anc[i * 3], this.anc[i * 3 + 1], this.anc[i * 3 + 2]]; }
  normal(i) { return [this.nrm[i * 3], this.nrm[i * 3 + 1], this.nrm[i * 3 + 2]]; }
  set(i, p) { this.pos[i * 3] = p[0]; this.pos[i * 3 + 1] = p[1]; this.pos[i * 3 + 2] = p[2]; }
  skin(i) { return [this.bones.slice(i * 4, i * 4 + 4), this.weights.slice(i * 4, i * 4 + 4)]; }
}

export function bodyShell(body, fields = {}) {
  const s = new Shell();
  s.pos = Array.from(body.P.subarray(0, body.count * 3));
  s.anc = s.pos.slice();
  s.nrm = Array.from(body.N);
  s.bones = Array.from(body.surface.boneIndices.subarray(0, body.count * 4));
  s.weights = Array.from(body.surface.weights.subarray(0, body.count * 4));
  s.tri = body.tri.slice();
  s.f = { arm: Array.from(body.arm), leg: Array.from(body.leg), wArm: Array.from(body.weight(/^(upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)/)),
    wLeg: Array.from(body.weight(/^(thigh|calf|foot|ball)/)), wHead: Array.from(body.weight(/^(head|neck)/)), ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, Array.from(v)])) };
  return s;
}

export function cut(s, value) {
  const n = s.count, f = new Float32Array(n);
  for (let i = 0; i < n; i++) f[i] = value(i);
  const out = new Shell(), names = Object.keys(s.f), map = new Int32Array(n).fill(-1), edges = new Map();
  for (const name of names) out.f[name] = [];
  out.f.edge = [];
  function keep(i) {
    if (map[i] < 0) {
      map[i] = out.count;
      for (const key of ["pos", "anc", "nrm"]) out[key].push(s[key][i * 3], s[key][i * 3 + 1], s[key][i * 3 + 2]);
      for (let j = 0; j < 4; j++) { out.bones.push(s.bones[i * 4 + j]); out.weights.push(s.weights[i * 4 + j]); }
      for (const name of names) out.f[name].push(s.f[name][i]);
      out.f.edge.push(s.f.edge?.[i] ?? 0);
    }
    return map[i];
  }
  function split(a, b) {
    const key = a < b ? a * n + b : b * n + a;
    if (!edges.has(key)) {
      const t = f[a] / (f[a] - f[b]);
      edges.set(key, out.count);
      for (const k of ["pos", "anc", "nrm"]) for (let d = 0; d < 3; d++) out[k].push(mix(s[k][a * 3 + d], s[k][b * 3 + d], t));
      const pairs = [];
      for (let j = 0; j < 4; j++) pairs.push([s.bones[a * 4 + j], s.weights[a * 4 + j] * (1 - t)], [s.bones[b * 4 + j], s.weights[b * 4 + j] * t]);
      const [bones, weights] = mergeSkin(pairs);
      out.bones.push(...bones); out.weights.push(...weights);
      for (const name of names) out.f[name].push(mix(s.f[name][a], s.f[name][b], t));
      out.f.edge.push(1);
    }
    return edges.get(key);
  }
  for (let t = 0; t < s.tri.length; t += 3) {
    const v = [s.tri[t], s.tri[t + 1], s.tri[t + 2]], inside = v.map(i => f[i] > 0), total = inside[0] + inside[1] + inside[2];
    if (total === 3) out.tri.push(keep(v[0]), keep(v[1]), keep(v[2]));
    else if (total === 1) {
      const k = inside.indexOf(true), a = v[k], b = v[(k + 1) % 3], c = v[(k + 2) % 3];
      out.tri.push(keep(a), split(a, b), split(a, c));
    } else if (total === 2) {
      const k = inside.indexOf(false), c = v[k], a = v[(k + 1) % 3], b = v[(k + 2) % 3];
      const ka = keep(a), kb = keep(b), bc = split(b, c), ac = split(a, c);
      out.tri.push(ka, kb, bc, ka, bc, ac);
    }
  }
  return out;
}

export function connected(s, near) {
  const parent = Array.from({ length: s.count }, (_, i) => i);
  const find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  for (let t = 0; t < s.tri.length; t += 3) { parent[find(s.tri[t])] = find(s.tri[t + 1]); parent[find(s.tri[t + 1])] = find(s.tri[t + 2]); }
  let best = 0, distance = Infinity;
  for (let i = 0; i < s.count; i++) { const d = length(sub(s.anchor(i), near)); if (d < distance) { distance = d; best = i; } }
  const root = find(best);
  return cut(s, i => find(i) === root ? 1 : -1);
}

const topologies = new WeakMap();
function topology(s) {
  const known = topologies.get(s);
  if (known && known.tri === s.tri && known.size === s.tri.length && known.count === s.count) return known.made;
  const n = s.count, tri = s.tri, half = new Set(), fill = new Int32Array(n + 1);
  for (let t = 0; t < tri.length; t += 3) for (let k = 0; k < 3; k++) half.add(tri[t + k] * n + tri[t + (k + 1) % 3]);
  const next = new Int32Array(n).fill(-1), prev = new Int32Array(n).fill(-1), pairs = [];
  for (const key of half) {
    const a = Math.floor(key / n), b = key % n, twin = half.has(b * n + a);
    if (!twin) { next[a] = b; prev[b] = a; }
    if (!twin || a < b) pairs.push(a, b);
  }
  for (const v of pairs) fill[v + 1]++;
  for (let i = 0; i < n; i++) fill[i + 1] += fill[i];
  const flat = new Int32Array(pairs.length), cursor = fill.slice(0, n);
  for (let e = 0; e < pairs.length; e += 2) { flat[cursor[pairs[e]]++] = pairs[e + 1]; flat[cursor[pairs[e + 1]]++] = pairs[e]; }
  const neighbours = Array.from({ length: n }, (_, i) => Array.from(flat.subarray(fill[i], fill[i + 1])));
  const made = { neighbours, next, prev };
  topologies.set(s, { tri, size: tri.length, count: n, made });
  return made;
}

export function loops(s) {
  const { next } = topology(s), seen = new Uint8Array(s.count), out = [];
  for (let i = 0; i < s.count; i++) {
    if (next[i] < 0 || seen[i]) continue;
    const loop = [];
    for (let v = i; v >= 0 && !seen[v]; v = next[v]) { seen[v] = 1; loop.push(v); }
    if (loop.length > 2) out.push(loop);
  }
  return out;
}

export function lift(s, distance) {
  for (let i = 0; i < s.count; i++) { const d = typeof distance === "function" ? distance(i) : distance; s.set(i, add(s.anchor(i), s.normal(i), d)); }
  return s;
}

export function relax(s, { passes = 6, strength = .5, gap = .003, edge = .5, hold, alongNormal = false, apart = false } = {}) {
  const { neighbours, next, prev } = topology(s), n = s.count;
  for (let pass = 0; pass < passes; pass++) {
    const fresh = s.pos.slice();
    for (let i = 0; i < n; i++) {
      const open = next[i] >= 0 && prev[i] >= 0, list = open ? [next[i], prev[i]] : neighbours[i];
      if (!list.length) continue;
      const k = (open ? edge : strength) * (hold ? hold(i) : 1);
      if (!k) continue;
      let x = 0, y = 0, z = 0;
      for (const j of list) { x += s.pos[j * 3]; y += s.pos[j * 3 + 1]; z += s.pos[j * 3 + 2]; }
      fresh[i * 3] = mix(s.pos[i * 3], x / list.length, k); fresh[i * 3 + 1] = mix(s.pos[i * 3 + 1], y / list.length, k); fresh[i * 3 + 2] = mix(s.pos[i * 3 + 2], z / list.length, k);
    }
    s.pos = fresh;
    for (let i = 0; i < n; i++) {
      const g = typeof gap === "function" ? gap(i) : gap, nx = s.nrm[i * 3], ny = s.nrm[i * 3 + 1], nz = s.nrm[i * 3 + 2];
      const d = (s.pos[i * 3] - s.anc[i * 3]) * nx + (s.pos[i * 3 + 1] - s.anc[i * 3 + 1]) * ny + (s.pos[i * 3 + 2] - s.anc[i * 3 + 2]) * nz;
      if (alongNormal) { s.pos[i * 3] = s.anc[i * 3] + nx * d; s.pos[i * 3 + 1] = s.anc[i * 3 + 1] + ny * d; s.pos[i * 3 + 2] = s.anc[i * 3 + 2] + nz * d; }
      if (apart && Math.abs(s.anc[i * 3]) > .0002 && s.pos[i * 3] * s.anc[i * 3] < 0) s.pos[i * 3] = 0;
      if (d < g) { s.pos[i * 3] += nx * (g - d); s.pos[i * 3 + 1] += ny * (g - d); s.pos[i * 3 + 2] += nz * (g - d); }
      if (apart && Math.abs(s.anc[i * 3]) > .0002 && s.pos[i * 3] * s.anc[i * 3] < 0) s.pos[i * 3] = 0;
    }
  }
  return s;
}

export function subdivide(s) {
  const out = new Shell(), n = s.count, names = Object.keys(s.f), edges = new Map();
  for (const key of ["pos", "anc", "nrm", "bones", "weights"]) out[key] = s[key].slice();
  for (const name of names) out.f[name] = s.f[name].slice();
  function middle(a, b) {
    const key = a < b ? a * n + b : b * n + a;
    if (!edges.has(key)) {
      edges.set(key, out.count);
      for (const k of ["pos", "anc", "nrm"]) for (let d = 0; d < 3; d++) out[k].push((s[k][a * 3 + d] + s[k][b * 3 + d]) / 2);
      const pairs = [];
      for (let j = 0; j < 4; j++) pairs.push([s.bones[a * 4 + j], s.weights[a * 4 + j]], [s.bones[b * 4 + j], s.weights[b * 4 + j]]);
      const [bones, weights] = mergeSkin(pairs);
      out.bones.push(...bones); out.weights.push(...weights);
      for (const name of names) out.f[name].push((s.f[name][a] + s.f[name][b]) / 2);
    }
    return edges.get(key);
  }
  for (let t = 0; t < s.tri.length; t += 3) {
    const a = s.tri[t], b = s.tri[t + 1], c = s.tri[t + 2], ab = middle(a, b), bc = middle(b, c), ca = middle(c, a);
    out.tri.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  for (let i = 0; i < out.nrm.length; i += 3) { const l = Math.hypot(out.nrm[i], out.nrm[i + 1], out.nrm[i + 2]) || 1; out.nrm[i] /= l; out.nrm[i + 1] /= l; out.nrm[i + 2] /= l; }
  return out;
}

export class Envelope {
  constructor(origin, axis, h0, h1, rows, cols = 48) {
    this.o = origin; this.a = unit(axis); this.h0 = h0; this.h1 = h1; this.rows = rows; this.cols = cols;
    const front = Math.abs(this.a[2]) > .9 ? [1, 0, 0] : [0, 0, 1];
    this.u = unit(sub(front, [this.a[0] * dot(front, this.a), this.a[1] * dot(front, this.a), this.a[2] * dot(front, this.a)]));
    this.v = cross(this.a, this.u);
    this.r = new Float32Array(rows * cols).fill(-1);
    this.cu = new Float32Array(rows); this.cv = new Float32Array(rows);
  }
  row(h) { return clamp((h - this.h0) / (this.h1 - this.h0), 0, 1) * (this.rows - 1); }
  local(p) { const d = sub(p, this.o); return [dot(d, this.a), dot(d, this.u), dot(d, this.v)]; }
  centre(h) { const f = this.row(h), i = Math.min(this.rows - 2, Math.floor(f)), t = f - i; return [mix(this.cu[i], this.cu[i + 1], t), mix(this.cv[i], this.cv[i + 1], t)]; }
  polar(p) { const [h, x, y] = this.local(p), [cx, cy] = this.centre(h); return [h, Math.atan2(y - cy, x - cx), Math.hypot(x - cx, y - cy)]; }
  point(h, angle, radius) {
    const [cx, cy] = this.centre(h), x = cx + Math.cos(angle) * radius, y = cy + Math.sin(angle) * radius;
    return [this.o[0] + this.a[0] * h + this.u[0] * x + this.v[0] * y, this.o[1] + this.a[1] * h + this.u[1] * x + this.v[1] * y, this.o[2] + this.a[2] * h + this.u[2] * x + this.v[2] * y];
  }
  measure(points) {
    const { rows, cols } = this, lo = Array.from({ length: rows }, () => [Infinity, Infinity]), hi = Array.from({ length: rows }, () => [-Infinity, -Infinity]);
    const locals = points.map(p => this.local(p)).filter(([h]) => h >= this.h0 - (this.h1 - this.h0) / rows && h <= this.h1 + (this.h1 - this.h0) / rows);
    for (const [h, x, y] of locals) { const i = Math.round(this.row(h)); lo[i][0] = Math.min(lo[i][0], x); lo[i][1] = Math.min(lo[i][1], y); hi[i][0] = Math.max(hi[i][0], x); hi[i][1] = Math.max(hi[i][1], y); }
    const known = [];
    for (let i = 0; i < rows; i++) if (lo[i][0] < Infinity) { known.push(i); this.cu[i] = (lo[i][0] + hi[i][0]) / 2; this.cv[i] = (lo[i][1] + hi[i][1]) / 2; }
    if (!known.length) return this;
    for (let i = 0; i < rows; i++) if (lo[i][0] === Infinity) { const k = known.reduce((a, b) => Math.abs(b - i) < Math.abs(a - i) ? b : a); this.cu[i] = this.cu[k]; this.cv[i] = this.cv[k]; }
    for (let pass = 0; pass < 3; pass++) for (const c of [this.cu, this.cv]) { const old = c.slice(); for (let i = 1; i < rows - 1; i++) c[i] = (old[i - 1] + 2 * old[i] + old[i + 1]) / 4; }
    if (this.fixed) { this.cu.fill(0); this.cv.fill(0); }
    for (const [h, x, y] of locals) {
      const [cx, cy] = this.centre(h), radius = Math.hypot(x - cx, y - cy), fr = this.row(h), fc = ((Math.atan2(y - cy, x - cx) / (2 * Math.PI) + 1) % 1) * cols;
      for (const i of [Math.floor(fr), Math.min(rows - 1, Math.floor(fr) + 1)]) for (const j of [Math.floor(fc) % cols, (Math.floor(fc) + 1) % cols]) this.r[i * cols + j] = Math.max(this.r[i * cols + j], radius);
    }
    const full = [];
    for (let i = 0; i < rows; i++) {
      const row = this.r.subarray(i * cols, (i + 1) * cols), old = row.slice(), filled = [];
      for (let j = 0; j < cols; j++) if (old[j] >= 0) filled.push(j);
      if (!filled.length) continue;
      full.push(i);
      for (let j = 0; j < cols; j++) if (old[j] < 0) {
        let da = 1, db = 1;
        while (old[(j + cols - da) % cols] < 0) da++;
        while (old[(j + db) % cols] < 0) db++;
        row[j] = mix(old[(j + cols - da) % cols], old[(j + db) % cols], da / (da + db));
      }
    }
    for (let i = 0; i < rows; i++) if (!full.includes(i)) {
      const k = full.reduce((a, b) => Math.abs(b - i) < Math.abs(a - i) ? b : a, -1);
      for (let j = 0; j < cols; j++) this.r[i * cols + j] = k < 0 ? 0 : this.r[k * cols + j];
    }
    return this;
  }
  taut(tension = 1, span = Math.PI) {
    const { rows, cols } = this, reach = Math.max(1, Math.round(span / (2 * Math.PI) * cols / 2)), step = 2 * Math.PI / cols;
    for (let i = 0; i < rows; i++) {
      const row = this.r.subarray(i * cols, (i + 1) * cols), hull = row.slice();
      for (let j = 0; j < cols; j++) for (let a = 1; a <= reach; a++) for (let b = 1; b <= reach && a + b < cols / 2; b++) {
        const r1 = row[(j + cols - a) % cols], r2 = row[(j + b) % cols];
        const chord = r1 * r2 * Math.sin((a + b) * step) / (r1 * Math.sin(b * step) + r2 * Math.sin(a * step));
        if (chord > hull[j]) hull[j] = chord;
      }
      for (let j = 0; j < cols; j++) row[j] = mix(row[j], hull[j], tension);
    }
    return this;
  }
  hang(fall = .2, rise = 1) {
    const { rows, cols } = this, dh = (this.h1 - this.h0) / (rows - 1);
    for (let j = 0; j < cols; j++) {
      for (let i = 1; i < rows; i++) this.r[i * cols + j] = Math.max(this.r[i * cols + j], this.r[(i - 1) * cols + j] - fall * dh);
      for (let i = rows - 2; i >= 0; i--) this.r[i * cols + j] = Math.max(this.r[i * cols + j], this.r[(i + 1) * cols + j] - rise * dh);
    }
    return this;
  }
  soften(passes = 1) {
    const { rows, cols } = this;
    for (let pass = 0; pass < passes; pass++) {
      const old = this.r.slice();
      for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
        const up = Math.max(0, i - 1), down = Math.min(rows - 1, i + 1), left = (j + cols - 1) % cols, right = (j + 1) % cols;
        this.r[i * cols + j] = Math.max(old[i * cols + j], (4 * old[i * cols + j] + old[up * cols + j] + old[down * cols + j] + old[i * cols + left] + old[i * cols + right]) / 8);
      }
    }
    return this;
  }
  sample(h, angle) {
    const { rows, cols } = this, fr = this.row(h), i = Math.min(rows - 2, Math.floor(fr)), t = fr - i;
    const fc = ((angle / (2 * Math.PI) % 1) + 1) % 1 * cols, j = Math.floor(fc) % cols, s = fc - Math.floor(fc), k = (j + 1) % cols;
    return mix(mix(this.r[i * cols + j], this.r[i * cols + k], s), mix(this.r[(i + 1) * cols + j], this.r[(i + 1) * cols + k], s), t);
  }
  drape(s, mask, extra = 0) {
    for (let i = 0; i < s.count; i++) {
      const m = mask ? mask(i) : 1;
      if (m <= 0) continue;
      const [h, angle, radius] = this.polar(s.anchor(i));
      if (h < this.h0 || h > this.h1) continue;
      const [, , now] = this.polar(s.at(i)), want = this.sample(h, angle) + (typeof extra === "function" ? extra(i, h, angle) : extra);
      if (want <= now) continue;
      const p = s.at(i), [hp, ap] = this.polar(p), q = this.point(hp, ap, mix(now, want, m));
      s.set(i, q);
    }
    return s;
  }
}

export class Piece {
  constructor() { this.pos = []; this.bones = []; this.weights = []; this.tri = []; }
  get count() { return this.pos.length / 3; }
  vertex(p, skin) { this.pos.push(p[0], p[1], p[2]); this.bones.push(...skin[0]); this.weights.push(...skin[1]); return this.count - 1; }
  shell(s, { thickness = .004, close = true, flip = false } = {}) {
    const base = this.count;
    (this.shells ??= []).push(s);
    if (s.f.foldMetres) (this.foldBands ??= []).push([base,s.f.foldMetres]);
    for (let i = 0; i < s.count; i++) this.vertex(s.at(i), s.skin(i));
    for (let t = 0; t < s.tri.length; t += 3) flip ? this.tri.push(base + s.tri[t], base + s.tri[t + 2], base + s.tri[t + 1]) : this.tri.push(base + s.tri[t], base + s.tri[t + 1], base + s.tri[t + 2]);
    if (!close) return this;
    const { neighbours, next, prev } = topology(s), ring = new Map();
    for (let i = 0; i < s.count; i++) {
      if (next[i] < 0) continue;
      const p = s.at(i), a = s.anchor(i), n = s.normal(i), skin = s.skin(i), gap = length(sub(p, a));
      const inner = gap > thickness + .001 ? add(p, unit(sub(a, p)), thickness) : add(a, n, .0008);
      let deep = [0, 0, 0], total = 0;
      for (const j of neighbours[i]) if (next[j] < 0 && prev[j] < 0) { deep = add(deep, s.anchor(j)); total++; }
      const sunk = gap > .012 ? -Math.min(.012, (gap - .012) * .6) : .0006;
      deep = total ? add(lerp3(a, [deep[0] / total, deep[1] / total, deep[2] / total], .8), n, sunk) : add(a, n, sunk);
      ring.set(i, [this.vertex(p, skin), this.vertex(inner, skin), this.vertex(deep, skin), Math.min(1, Math.max(0, (gap - .012) / .02))]);
    }
    for (let pass = 0; pass < 16; pass++) {
      const old = this.pos.slice();
      for (const [i, [, , deep, clear]] of ring) {
        const a = ring.get(prev[i]), b = ring.get(next[i]);
        if (!a || !b || clear <= 0) continue;
        for (let d = 0; d < 3; d++) this.pos[deep * 3 + d] = mix(old[deep * 3 + d], (old[a[2] * 3 + d] + old[b[2] * 3 + d]) / 2, .6 * clear);
      }
    }
    for (const [a, [a0, a1, a2]] of ring) {
      const b = next[a];
      if (!ring.has(b)) continue;
      const [b0, b1, b2] = ring.get(b);
      const quad = (p, q, r, t) => flip ? this.tri.push(p, r, q, p, t, r) : this.tri.push(p, q, r, p, r, t);
      quad(b0, a0, a1, b1); quad(b1, a1, a2, b2);
    }
    return this;
  }
  loft(rings, skin, { closed = true, capStart = false, capEnd = false, flip = false } = {}) {
    const base = this.count, m = rings[0].length;
    rings.forEach((ring, i) => ring.forEach((p, j) => this.vertex(p, typeof skin === "function" ? skin(p, i, j) : skin)));
    const push = (a, b, c) => flip ? this.tri.push(a, c, b) : this.tri.push(a, b, c);
    for (let i = 0; i + 1 < rings.length; i++) for (let j = 0; j < (closed ? m : m - 1); j++) {
      const a = base + i * m + j, b = base + i * m + (j + 1) % m, c = base + (i + 1) * m + j, d = base + (i + 1) * m + (j + 1) % m;
      push(a, c, b); push(b, c, d);
    }
    for (const [on, i, order] of [[capStart, 0, false], [capEnd, rings.length - 1, true]]) {
      if (!on) continue;
      const ring = rings[i], centre = ring.reduce((s, p) => add(s, p), [0, 0, 0]).map(x => x / m);
      const hub = this.vertex(centre, typeof skin === "function" ? skin(centre, i, 0) : skin), first = this.count;
      ring.forEach((p, j) => this.vertex(p, typeof skin === "function" ? skin(p, i, j) : skin));
      for (let j = 0; j < (closed ? m : m - 1); j++) order ? push(hub, first + (j + 1) % m, first + j) : push(hub, first + j, first + (j + 1) % m);
    }
    return this;
  }
  slab(outer, inner, skin) {
    const rows = outer.length, cols = outer[0].length, base = this.count, at = (grid, i, j) => base + (grid ? rows * cols : 0) + i * cols + j;
    const weigh = (p, i, j) => typeof skin === "function" ? skin(p, i, j) : skin;
    for (const grid of [outer, inner]) grid.forEach((row, i) => row.forEach((p, j) => this.vertex(p, weigh(p, i, j))));
    const P = n => [this.pos[n * 3], this.pos[n * 3 + 1], this.pos[n * 3 + 2]];
    const quad = (a, b, c, d, from) => {
      const pa = P(a), n = cross(sub(P(b), pa), sub(P(d), pa)), centre = [0, 1, 2].map(x => (pa[x] + P(b)[x] + P(c)[x] + P(d)[x]) / 4);
      dot(n, sub(centre, from)) >= 0 ? this.tri.push(a, b, c, a, c, d) : this.tri.push(a, c, b, a, d, c);
    };
    const middle = (i, j) => lerp3(outer[i][j], inner[i][j], .5);
    for (let i = 0; i + 1 < rows; i++) for (let j = 0; j + 1 < cols; j++) {
      const core = lerp3(
        lerp3(middle(i, j), middle(i, j + 1), .5),
        lerp3(middle(i + 1, j), middle(i + 1, j + 1), .5), .5,
      );
      quad(at(0, i, j), at(0, i, j + 1), at(0, i + 1, j + 1), at(0, i + 1, j), core);
      quad(at(1, i, j), at(1, i, j + 1), at(1, i + 1, j + 1), at(1, i + 1, j), core);
    }
    const mean = list => list.reduce((s, p) => add(s, p), [0, 0, 0]).map(x => x / list.length);
    for (let j = 0; j + 1 < cols; j++) {
      const lane = mean(outer.flatMap((row, i) => [middle(i, j), middle(i, j + 1)]));
      for (const i of [0, rows - 1]) quad(at(0, i, j), at(0, i, j + 1), at(1, i, j + 1), at(1, i, j), lane);
    }
    for (let i = 0; i + 1 < rows; i++) {
      const band = mean(outer[i].flatMap((p, j) => [middle(i, j), middle(i + 1, j)]));
      for (const j of [0, cols - 1]) quad(at(0, i, j), at(0, i + 1, j), at(1, i + 1, j), at(1, i, j), band);
    }
    return this;
  }
  mesh(material, region, name) {
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(this.pos, 3));
    g.setIndex(this.tri);
    g.computeVertexNormals();
    const mesh = new T.Mesh(g, material);
    mesh.name = name;
    if (this.foldBands) {
      mesh.foldMetres = new Float32Array(this.count);
      for (const [start,heights] of this.foldBands) mesh.foldMetres.set(heights,start);
    }
    mesh.castShadow = true;
    mesh.humanWeights = { weights: Float32Array.from(this.weights), boneIndices: Uint8Array.from(this.bones) };
    mesh.userData.styleRegion = region;
    return mesh;
  }
}

export function hull2(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const turn = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length > 1 && turn(lower.at(-2), lower.at(-1), q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length > 1 && turn(upper.at(-2), upper.at(-1), q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
export function reach2(outline, centre, angle) {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  let best = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length], ex = b[0] - a[0], ey = b[1] - a[1], det = dx * ey - dy * ex;
    if (Math.abs(det) < 1e-12) continue;
    const t = ((a[0] - centre[0]) * ey - (a[1] - centre[1]) * ex) / det, s = ((a[0] - centre[0]) * dy - (a[1] - centre[1]) * dx) / det;
    if (t > 0 && s >= -1e-6 && s <= 1 + 1e-6) best = Math.max(best, t);
  }
  return best;
}

function meet(pos, a, b, c, ox, oy, oz, dx, dy, dz) {
  const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2], e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return Infinity;
  const tx = ox - pos[a], ty = oy - pos[a + 1], tz = oz - pos[a + 2], u = (tx * px + ty * py + tz * pz) / det;
  if (u < 0 || u > 1) return Infinity;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (dx * qx + dy * qy + dz * qz) / det;
  if (v < 0 || u + v > 1) return Infinity;
  const d = (e2x * qx + e2y * qy + e2z * qz) / det;
  return d > 1e-6 ? d : Infinity;
}

export function raycast(pos, tri, origin, direction) {
  let best = Infinity;
  const [ox, oy, oz] = origin, [dx, dy, dz] = direction;
  for (let t = 0; t < tri.length; t += 3) { const d = meet(pos, tri[t] * 3, tri[t + 1] * 3, tri[t + 2] * 3, ox, oy, oz, dx, dy, dz); if (d < best) best = d; }
  return best;
}

export function raycaster(pos, tri, cell = .03) {
  const count = tri.length / 3, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  if (!count) return () => Infinity;
  for (let t = 0; t < tri.length; t++) for (let d = 0; d < 3; d++) { const x = pos[tri[t] * 3 + d]; if (x < lo[d]) lo[d] = x; if (x > hi[d]) hi[d] = x; }
  const size = [0, 1, 2].map(d => Math.max(1, Math.min(48, Math.ceil((hi[d] - lo[d]) / cell)))), step = [0, 1, 2].map(d => (hi[d] - lo[d]) / size[d] || 1e-9);
  const cells = new Array(size[0] * size[1] * size[2]), at = (x, d) => Math.max(0, Math.min(size[d] - 1, Math.floor((x - lo[d]) / step[d])));
  for (let t = 0; t < tri.length; t += 3) {
    const from = [0, 0, 0], to = [0, 0, 0];
    for (let d = 0; d < 3; d++) { const a = pos[tri[t] * 3 + d], b = pos[tri[t + 1] * 3 + d], c = pos[tri[t + 2] * 3 + d]; from[d] = at(Math.min(a, b, c), d); to[d] = at(Math.max(a, b, c), d); }
    for (let x = from[0]; x <= to[0]; x++) for (let y = from[1]; y <= to[1]; y++) for (let z = from[2]; z <= to[2]; z++) (cells[x + size[0] * (y + size[1] * z)] ??= []).push(t);
  }
  const seen = new Uint32Array(count);
  let stamp = 0;
  return (origin, direction, maxDistance = Infinity) => {
    let enter = 0, leave = maxDistance;
    for (let d = 0; d < 3; d++) {
      if (Math.abs(direction[d]) < 1e-12) { if (origin[d] < lo[d] - 1e-9 || origin[d] > hi[d] + 1e-9) return Infinity; continue; }
      const a = (lo[d] - origin[d]) / direction[d], b = (hi[d] - origin[d]) / direction[d];
      enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b));
    }
    if (enter > leave) return Infinity;
    stamp++;
    const c = [0, 0, 0], way = [0, 0, 0], edge = [Infinity, Infinity, Infinity], stride = [Infinity, Infinity, Infinity], [ox, oy, oz] = origin, [dx, dy, dz] = direction;
    for (let d = 0; d < 3; d++) {
      c[d] = at(origin[d] + direction[d] * enter, d);
      if (Math.abs(direction[d]) < 1e-12) continue;
      way[d] = direction[d] > 0 ? 1 : -1; stride[d] = step[d] / Math.abs(direction[d]);
      edge[d] = (lo[d] + (c[d] + (way[d] > 0 ? 1 : 0)) * step[d] - origin[d]) / direction[d];
    }
    let best = Infinity;
    for (;;) {
      const list = cells[c[0] + size[0] * (c[1] + size[1] * c[2])];
      if (list) for (const t of list) {
        if (seen[t / 3] === stamp) continue;
        seen[t / 3] = stamp;
        const d = meet(pos, tri[t] * 3, tri[t + 1] * 3, tri[t + 2] * 3, ox, oy, oz, dx, dy, dz);
        if (d < best) best = d;
      }
      const axis = edge[0] < edge[1] ? (edge[0] < edge[2] ? 0 : 2) : (edge[1] < edge[2] ? 1 : 2);
      if (best <= edge[axis] || edge[axis] >= leave) return best <= maxDistance ? best : Infinity;
      c[axis] += way[axis];
      if (way[axis] === 0 || c[axis] < 0 || c[axis] >= size[axis]) return best <= maxDistance ? best : Infinity;
      edge[axis] += stride[axis];
    }
  };
}
