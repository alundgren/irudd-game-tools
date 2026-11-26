import * as T from "three";
import { ConvexHull } from "three/addons/math/ConvexHull.js";
import { clamp, cross, dot, hash1, mix, noise3, smooth, unit } from "./human-style-kit.js";

const DEG = Math.PI / 180, TAU = Math.PI * 2;
const POLE = unit([0, Math.sin(52 * DEG), -Math.cos(52 * DEG)]), RIGHT = [1, 0, 0], AHEAD = unit(cross(RIGHT, POLE)), REACH = 136 * DEG, LEVEL = 38 * DEG;
const DISC = [.5, .55, .445], STRIP = .09;

export function clumpChart(q) {
  const angle = Math.acos(clamp(dot(q, POLE), -1, 1)), x = dot(q, RIGHT), y = dot(q, AHEAD), flat = Math.hypot(x, y) || 1, r = DISC[2] * Math.min(1, angle / REACH);
  return [DISC[0] + r * x / flat, DISC[1] + r * y / flat];
}
export function clumpEdge(phi, inner) {
  return [.03 + .94 * Math.abs(phi) / Math.PI, STRIP * mix(.07, .93, inner)];
}
function chartDirection(u, v) {
  const x = (u - DISC[0]) / DISC[2], y = (v - DISC[1]) / DISC[2], r = Math.hypot(x, y);
  if (r > 1) return null;
  const angle = r * REACH, s = r > 1e-9 ? Math.sin(angle) / r : 0, c = Math.cos(angle);
  return [POLE[0] * c + (RIGHT[0] * x + AHEAD[0] * y) * s, POLE[1] * c + (RIGHT[1] * x + AHEAD[1] * y) * s, POLE[2] * c + (RIGHT[2] * x + AHEAD[2] * y) * s];
}

class Scatter {
  constructor(points, spacing) {
    this.p = points; this.n = points.length / 3; this.spacing = spacing;
    const cell = this.cell = 1.3 * spacing, G = this.G = Math.ceil(2.02 / cell) + 1;
    this.head = new Int32Array(G * G * G).fill(-1); this.next = new Int32Array(this.n);
    for (let i = 0; i < this.n; i++) { const at = this.at(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]); this.next[i] = this.head[at]; this.head[at] = i; }
  }
  at(x, y, z) { const G = this.G, c = this.cell; return (Math.floor((x + 1.01) / c) * G + Math.floor((y + 1.01) / c)) * G + Math.floor((z + 1.01) / c); }
  near(x, y, z, out) {
    const G = this.G, c = this.cell, p = this.p, cx = Math.floor((x + 1.01) / c), cy = Math.floor((y + 1.01) / c), cz = Math.floor((z + 1.01) / c);
    let best = Infinity, second = Infinity, id = -1;
    for (let i = Math.max(0, cx - 1); i <= Math.min(G - 1, cx + 1); i++) for (let j = Math.max(0, cy - 1); j <= Math.min(G - 1, cy + 1); j++) for (let k = Math.max(0, cz - 1); k <= Math.min(G - 1, cz + 1); k++)
      for (let v = this.head[(i * G + j) * G + k]; v >= 0; v = this.next[v]) {
        const dx = p[v * 3] - x, dy = p[v * 3 + 1] - y, dz = p[v * 3 + 2] - z, d = dx * dx + dy * dy + dz * dz;
        if (d < best) { second = best; best = d; id = v; } else if (d < second) second = d;
      }
    out.i = id; out.d = Math.sqrt(best) / this.spacing; out.e = Math.sqrt(second) / this.spacing;
    return out;
  }
}

function scattered(count, jitter, seed) {
  const points = new Float32Array(count * 3), spacing = Math.sqrt(4 * Math.PI / count / .866), golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * i + 1) / count, r = Math.sqrt(Math.max(0, 1 - y * y)), a = golden * i, p = [r * Math.cos(a), y, r * Math.sin(a)];
    const side = unit(cross(p, Math.abs(y) > .9 ? [1, 0, 0] : [0, 1, 0])), up = cross(p, side), turn = TAU * hash1(seed * 7919 + i * 13 + 1), far = jitter * spacing * Math.sqrt(hash1(seed * 104729 + i * 29 + 2));
    const q = unit([p[0] + (side[0] * Math.cos(turn) + up[0] * Math.sin(turn)) * far, p[1] + (side[1] * Math.cos(turn) + up[1] * Math.sin(turn)) * far, p[2] + (side[2] * Math.cos(turn) + up[2] * Math.sin(turn)) * far]);
    points.set(q, i * 3);
  }
  return { points, spacing };
}

const fields = new Map();
export function clumpField(curl) {
  const tall = curl.tall ?? 1, key = [curl.kind, curl.clump, curl.deep, tall].join("/");
  if (fields.has(key)) return fields.get(key);
  const angle = curl.clump / curl.deep, count = Math.round(4 * Math.PI / (.866 * angle * angle)), { points, spacing } = scattered(count, .42, 17 + curl.clump);
  const turned = (v, map) => { const lat = Math.asin(clamp(v[1], -1, 1)), to = map(lat), flat = Math.hypot(v[0], v[2]) || 1e-9, c = Math.cos(to); return [v[0] / flat * c, Math.sin(to), v[2] / flat * c]; };
  const toHead = tall === 1 ? u => u : u => turned(u, lat => lat >= LEVEL ? lat : Math.max(-89 * DEG, LEVEL - tall * (LEVEL - lat)));
  const toField = tall === 1 ? q => q : q => turned(q, lat => lat >= LEVEL ? lat : LEVEL - (LEVEL - lat) / tall);
  const nodes = Array.from({ length: count }, (_, i) => Object.assign(new T.Vector3(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]), { clump: i }));
  const hull = new ConvexHull().setFromPoints(nodes), corners = [], members = [], rings = Array.from({ length: count }, () => []);
  for (const face of hull.faces) {
    const ids = [];
    let edge = face.edge;
    do { ids.push(edge.head().point.clump); edge = edge.next; } while (edge !== face.edge);
    if (ids.length !== 3) continue;
    const [a, b, c] = ids.map(i => [points[i * 3], points[i * 3 + 1], points[i * 3 + 2]]);
    let n = unit(cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]));
    if (dot(n, a) < 0) n = [-n[0], -n[1], -n[2]];
    for (const i of ids) rings[i].push(corners.length);
    corners.push(n); members.push(ids);
  }
  rings.forEach((ring, i) => {
    const c = [points[i * 3], points[i * 3 + 1], points[i * 3 + 2]], side = unit(cross(c, Math.abs(c[1]) > .9 ? [1, 0, 0] : [0, 1, 0])), up = cross(c, side);
    const turn = ring.map(id => Math.atan2(dot(corners[id], up), dot(corners[id], side)));
    const order = ring.map((_, at) => at).sort((x, y) => turn[x] - turn[y]);
    rings[i] = order.map(at => ring[at]);
  });
  const field = { count, points, spacing, tall, toHead, toField, corners, members, rings, lookup: new Scatter(points, spacing), kind: curl.kind, key };
  fields.set(key, field);
  return field;
}

export function clumpVolume({ spec, f, k, body, margin, cutAt, seat, volume, hair, tone }) {
  const curl = spec.curl, mm = k / 1000, field = clumpField(curl), { points, corners, members, rings } = field;
  const relief = (spec.relief ?? 3) * mm, domed = relief > 2.1 * mm, shoulderAt = .6;
  const luma = .2126 * hair.r + .7152 * hair.g + .0722 * hair.b, crease = mix(.6, .8, smooth(.05, .45, luma));
  const aimOf = q => ({ q, phi: Math.atan2(q[0], q[2]), eps: Math.asin(clamp(q[1], -1, 1)) });
  const hangAt = phi => curl.drop ? smooth(62 * DEG, 82 * DEG, Math.abs(phi)) : 0, dropAt = phi => (curl.drop ?? 0) / (.1 * 1000) / DEG * hangAt(phi), band = 4.2;
  const inside = q => { const at = aimOf(q); return margin(at.phi, at.eps) + dropAt(at.phi); };
  const fieldPoint = i => [points[i * 3], points[i * 3 + 1], points[i * 3 + 2]];
  const kept = new Uint8Array(field.count);
  for (let i = 0; i < field.count; i++) kept[i] = inside(field.toHead(fieldPoint(i))) >= 1 ? 1 : 0;

  const out = { position: [], normal: [], color: [], uv: [], index: [], bones: [], weights: [] }, smoothNormal = [];
  const place = (q, rise, amp, shadeOf, hug = 0) => {
    const at = aimOf(q), edge = margin(at.phi, at.eps), far = Math.max(0, edge), here = cutAt(at.q, at.phi, far);
    const hang = hangAt(at.phi), deepFar = mix(far, Math.max(far, .8 * spec.rim), hang);
    const grown = smooth(.5, .55 * spec.rim + 1, deepFar), dome = relief * grown * (rise * amp - .42);
    const off = hug ? here.under + .0007 * k : Math.max(here.under + .0007 * k, volume(at, deepFar) * mix(1, .85, hang) + dome);
    let station;
    if (edge < 0 && hang > 0 && !hug) {
      const eps = at.eps - edge * DEG, rim = [Math.cos(eps) * Math.sin(at.phi), Math.sin(eps), Math.cos(eps) * Math.cos(at.phi)], hung = -edge * DEG * .1 * k;
      const top = seat(rim, 0, off), inward = .62 * off * clamp(-edge / Math.max(1, dropAt(at.phi))) ** 1.6, flat = Math.hypot(top.p[0] - f.centre[0], top.p[2] - f.centre[2]) || 1;
      const hangs = body.clear(body.clear([top.p[0] - (top.p[0] - f.centre[0]) / flat * inward, top.p[1] - hung, top.p[2] - (top.p[2] - f.centre[2]) / flat * inward], .004 * k), .004 * k);
      station = { p: hangs, n: unit([top.n[0], top.n[1] * .4, top.n[2]]), v: top.v };
    } else station = seat(q, 0, off);
    const index = out.position.length / 3, uv = hug === 1 || hug === 3 ? clumpEdge(at.phi, hug === 3 ? 1 : 0) : clumpChart(q);
    out.position.push(station.p[0], station.p[1], station.p[2]); smoothNormal.push(station.n[0], station.n[1], station.n[2]);
    out.uv.push(uv[0], 1 - uv[1]);
    const shade = shadeOf * mix(.9, 1, here.top);
    out.color.push(hair.r * shade, hair.g * shade, hair.b * shade);
    const skin = body.skinOf(station.v >= 0 ? station.v : body.nearest(station.p, 8));
    out.bones.push(...skin[0]); out.weights.push(...skin[1]);
    out.flat.push(hug ? 1 : 0);
    return index;
  };
  out.flat = [];
  const reach = (from, to, level = 0) => {
    const along = t => unit([mix(from[0], to[0], t), mix(from[1], to[1], t), mix(from[2], to[2], t)]), steps = 12;
    let a = 0;
    for (let i = 1; i <= steps; i++) {
      if (inside(field.toHead(along(i / steps))) >= level) { a = i / steps; continue; }
      let b = i / steps;
      for (let j = 0; j < 6; j++) { const t = (a + b) / 2; if (inside(field.toHead(along(t))) >= level) a = t; else b = t; }
      return along(a);
    }
    return to;
  };
  const mixed = (a, b, t) => unit([mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]);
  const walk = (from, via, to, level) => { const first = reach(from, via, level); return first === via ? reach(via, to, level) : first; };
  const edgePair = (from, via, to) => {
    const u = walk(from, via, to, 0), q = field.toHead(u), at = aimOf(q);
    if (dropAt(at.phi) > .3) { const index = place(q, 0, 1, crease); return { outer: index, inner: index, u }; }
    const last = walk(from, via, to, -1.3), deep = walk(from, via, to, Math.min(band, .6 * inside(field.toHead(from)))), span = Math.acos(clamp(dot(deep, last), -1, 1));
    const v = span > 6.5 * DEG ? mixed(last, deep, 6.5 * DEG / span) : deep, foot = field.toHead(v), root = crease * .9;
    return { outer: place(field.toHead(last), 0, 1, root, 1), strip: place(foot, 0, 1, root, 3), inner: place(foot, 0, 1, root, 2), u: v };
  };
  const valleys = new Map();
  const joined = corner => hash1(corner * 41 + 3) < .3 ? .46 : 0;
  const valley = corner => {
    if (valleys.has(corner)) return valleys.get(corner);
    const to = corners[corner];
    let made;
    if (members[corner].every(i => kept[i])) { const rise = joined(corner), index = place(field.toHead(to), rise, 1, mix(crease, 1, rise)); made = { outer: index, inner: index, u: to, whole: true }; }
    else {
      let from = null, near = -2, across = [0, 0, 0];
      for (const i of members[corner]) {
        const c = fieldPoint(i), d = dot(c, to);
        if (!kept[i]) across = [across[0] + c[0], across[1] + c[1], across[2] + c[2]];
        else if (d > near) { near = d; from = c; }
      }
      made = edgePair(from, to, unit(across));
    }
    valleys.set(corner, made);
    return made;
  };
  for (let i = 0; i < field.count; i++) {
    if (!kept[i] || rings[i].length < 3) continue;
    const c = fieldPoint(i), amp = .66 + .68 * hash1(i * 31 + 5), tint = 1 + .1 * (hash1(i * 57 + 9) - .5), ring = rings[i], n = ring.length;
    const centre = place(field.toHead(c), 1, amp, 1.04 * tint), low = ring.map(valley);
    const high = domed ? low.map(corner => place(field.toHead(mixed(c, corner.u, shoulderAt)), .8, amp, .95 * tint)) : null;
    for (let j = 0; j < n; j++) {
      const m = (j + 1) % n, beside = members[ring[j]].find(id => id !== i && members[ring[m]].includes(id)), a = low[j], b = low[m];
      const line = beside === undefined || kept[beside] ? [a, b] : [a, ...[.25, .5, .75].map(t => edgePair(c, mixed(corners[ring[j]], corners[ring[m]], t), fieldPoint(beside))), b];
      for (let e = 0; e + 1 < line.length; e++) {
        const x = line[e], y = line[e + 1];
        if (line.length < 3) ;
        else if (x.strip !== undefined && y.strip !== undefined) out.index.push(x.strip, x.outer, y.outer, x.strip, y.outer, y.strip);
        if (!domed) out.index.push(centre, x.inner, y.inner);
        else out.index.push(e * 2 < line.length - 1 ? high[j] : high[m], x.inner, y.inner);
      }
      if (domed) {
        out.index.push(centre, high[j], high[m]);
        out.index.push(high[j], line[Math.ceil((line.length - 1) / 2)].inner, high[m]);
      }
    }
  }
  const P = out.position, count = P.length / 3, normal = new Float32Array(count * 3);
  for (let t = 0; t < out.index.length; t += 3) {
    const a = out.index[t] * 3, b = out.index[t + 1] * 3, c = out.index[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { normal[v] += nx; normal[v + 1] += ny; normal[v + 2] += nz; }
  }
  for (let v = 0; v < count; v++) {
    const own = unit([normal[v * 3], normal[v * 3 + 1], normal[v * 3 + 2]]), round = [smoothNormal[v * 3], smoothNormal[v * 3 + 1], smoothNormal[v * 3 + 2]];
    const share = out.flat[v] ? 0 : .62, n = unit([mix(round[0], own[0], share), mix(round[1], own[1], share), mix(round[2], own[2], share)]);
    out.normal.push(n[0], n[1], n[2]);
  }
  delete out.flat;
  return out;
}


const pictures = new Map();
export function clumpPixels(curl, size = 512) {
  const field = clumpField(curl), key = field.key + "@" + size;
  if (pictures.has(key)) return pictures.get(key);
  const tone = new Uint8ClampedArray(size * size * 4), height = new Uint8ClampedArray(size * size * 4), coils = curl.kind === "coil";
  const lobeCount = Math.round(field.count * (curl.clump / (curl.coil ?? 10)) ** 2), lobes = scattered(lobeCount, .4, 71 + curl.clump), lobeLookup = new Scatter(lobes.points, lobes.spacing);
  const a = { i: 0, d: 0, e: 0 }, b = { i: 0, d: 0, e: 0 }, points = field.points;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const at = (y * size + x) * 4, q = chartDirection((x + .5) / size, (y + .5) / size);
    if ((y + .5) / size < STRIP) {
      const t = (y + .5) / size / STRIP, lane = x / size * 150, long = .55 * noise3(lane, 3.5, 9.5) + .3 * noise3(lane * 2.7, 7.5, 1.5) + .15 * hash1(x + 977);
      const cover = clamp((t - .62 * long) / .34), streak = .4 + .24 * noise3(lane * 3.1, 1.5, 4.5) + .08 * (hash1(x * 3 + 5) - .5);
      tone[at] = tone[at + 1] = tone[at + 2] = Math.round(255 * clamp(streak * (.8 + .2 * t)) ** (1 / 2.2)); tone[at + 3] = Math.round(255 * cover);
      height[at] = height[at + 1] = height[at + 2] = 128; height[at + 3] = 255;
      continue;
    }
    if (!q) { tone[at] = tone[at + 1] = tone[at + 2] = 190; tone[at + 3] = 255; height[at] = height[at + 1] = height[at + 2] = 128; height[at + 3] = 255; continue; }
    const u = field.toField(q);
    field.lookup.near(u[0], u[1], u[2], a);
    const gap = a.e - a.d, seam = smooth(0, .2, gap), dome = smooth(0, .8, gap), own = hash1(a.i * 57 + 9);
    let light, lift;
    if (coils) {
      lobeLookup.near(q[0], q[1], q[2], b);
      const crown = Math.max(0, 1 - (b.d / .62) ** 2), between = smooth(0, .2, b.e - b.d), each = hash1(b.i * 23 + 7);
      light = (.44 + .56 * crown) * (.6 + .4 * between) * (.84 + .32 * each);
      lift = .12 + .6 * crown * between + .28 * dome;
    } else {
      const cx = points[a.i * 3], cy = points[a.i * 3 + 1], cz = points[a.i * 3 + 2], side = unit(cross([cx, cy, cz], [0, 1, 0])), down = cross(side, [cx, cy, cz]);
      const sx = ((u[0] - cx) * side[0] + (u[1] - cy) * side[1] + (u[2] - cz) * side[2]) / field.spacing, sy = ((u[0] - cx) * down[0] + (u[1] - cy) * down[1] + (u[2] - cz) * down[2]) / field.spacing;
      const way = own < .5 ? -1 : 1, turns = (curl.turns ?? 1.7) * (.8 + .4 * hash1(a.i * 91 + 2)), wound = turns * sy + way * .5 * sx + own + .12 * Math.sin(TAU * (1.3 * sx + own));
      const band = .5 + .5 * Math.sin(TAU * wound), round = Math.max(0, 1 - (sx / .62) ** 2), strand = .5 + .5 * Math.sin(TAU * (5 * sx + .5 * Math.sin(TAU * wound) + 3 * own));
      light = (.42 + .54 * smooth(.2, .85, band)) * (.66 + .34 * round) * (.9 + .2 * strand);
      lift = .12 + .6 * smooth(.1, .9, band) * round + .28 * dome;
    }
    const fibre = 1 + .12 * (noise3(q[0] * 150 + 3, q[1] * 150, q[2] * 150) - .5);
    const value = clamp(light * fibre * (.66 + .34 * seam) * (.9 + .1 * dome) * (1 + .12 * (own - .5)), .05, 1);
    tone[at] = tone[at + 1] = tone[at + 2] = Math.round(255 * value ** (1 / 2.2)); tone[at + 3] = 255;
    height[at] = height[at + 1] = height[at + 2] = Math.round(255 * clamp(lift * (.4 + .6 * seam))); height[at + 3] = 255;
  }
  const made = { width: size, height: size, tone, relief: height };
  pictures.set(key, made);
  return made;
}

const maps = new Map();
function textureOf(pixels, size, name, colour) {
  let texture;
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    canvas.getContext("2d").putImageData(new ImageData(pixels, size, size), 0, 0);
    texture = new T.CanvasTexture(canvas);
  } else {
    const turned = new Uint8Array(pixels.length);
    for (let y = 0; y < size; y++) turned.set(pixels.subarray(y * size * 4, (y + 1) * size * 4), (size - 1 - y) * size * 4);
    texture = new T.DataTexture(turned, size, size, T.RGBAFormat);
    texture.needsUpdate = true;
  }
  texture.name = name;
  if (colour) texture.colorSpace = T.SRGBColorSpace;
  texture.magFilter = T.LinearFilter; texture.minFilter = T.LinearMipmapLinearFilter; texture.generateMipmaps = true;
  texture.anisotropy = 4;
  return texture;
}
export function clumpMaps(curl) {
  const key = clumpField(curl).key;
  if (maps.has(key)) return maps.get(key);
  const { width, tone, relief } = clumpPixels(curl), made = { map: textureOf(tone, width, "Hair clumps", true), bumpMap: textureOf(relief, width, "Hair clump relief", false) };
  maps.set(key, made);
  return made;
}
