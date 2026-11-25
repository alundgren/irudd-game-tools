// Curly and coily hair as one sculpted mass: the volume the hair fills is built from the clumps themselves.
// Every clump is a dome of the surface with a crease where it meets its neighbours, so clumps touch all the
// way round and the outline of the head is whole clumps. A picture drawn from the same clumps shows the coils
// or the ringlets inside each dome, so paint, relief and outline agree.
//   clumpField(curl)                the clumps of a style: their centres, neighbours and corners on a sphere of directions
//   clumpVolume(context)            geometry of the mass on one adult, as plain arrays
//   clumpMaps(curl)                 { map, bumpMap } the picture and its relief, shared by every adult
//   clumpPixels(curl)               the same as pixels, for tests and for a view without a page
// Directions are unit vectors of the head frame (see human-fringe.js). The picture is laid out round a pole
// behind the crown, so the whole scalp and hair that hangs a little below it is one chart with no seam.
import * as T from "three";
import { ConvexHull } from "three/addons/math/ConvexHull.js";
import { clamp, cross, dot, hash1, mix, noise3, smooth, unit } from "./human-style-kit.js";

const DEG = Math.PI / 180, TAU = Math.PI * 2;
const POLE = unit([0, Math.sin(52 * DEG), -Math.cos(52 * DEG)]), RIGHT = [1, 0, 0], AHEAD = unit(cross(RIGHT, POLE)), REACH = 136 * DEG, LEVEL = 38 * DEG;
// The chart is a disc in the lower nine tenths of the picture. The strip above it is the edge of the hair: opaque hair
// at its foot that thins into separate fine hairs towards the top, for the band along the hairline.
const DISC = [.5, .55, .445], STRIP = .09;

/** Where a direction lies in the picture, 0 to 1 both ways. */
export function clumpChart(q) {
  const angle = Math.acos(clamp(dot(q, POLE), -1, 1)), x = dot(q, RIGHT), y = dot(q, AHEAD), flat = Math.hypot(x, y) || 1, r = DISC[2] * Math.min(1, angle / REACH);
  return [DISC[0] + r * x / flat, DISC[1] + r * y / flat];
}
/** Where the edge of the hair at an azimuth lies in the strip: `inner` 1 at its opaque foot, 0 where the last hairs end. */
export function clumpEdge(phi, inner) {
  return [.03 + .94 * Math.abs(phi) / Math.PI, STRIP * mix(.07, .93, inner)];
}
/** The direction a place in the picture shows, or null outside the chart. */
function chartDirection(u, v) {
  const x = (u - DISC[0]) / DISC[2], y = (v - DISC[1]) / DISC[2], r = Math.hypot(x, y);
  if (r > 1) return null;
  const angle = r * REACH, s = r > 1e-9 ? Math.sin(angle) / r : 0, c = Math.cos(angle);
  return [POLE[0] * c + (RIGHT[0] * x + AHEAD[0] * y) * s, POLE[1] * c + (RIGHT[1] * x + AHEAD[1] * y) * s, POLE[2] * c + (RIGHT[2] * x + AHEAD[2] * y) * s];
}

// Points on a sphere with a lookup of the nearest two.
class Scatter {
  constructor(points, spacing) {
    this.p = points; this.n = points.length / 3; this.spacing = spacing;
    const cell = this.cell = 1.3 * spacing, G = this.G = Math.ceil(2.02 / cell) + 1;
    this.head = new Int32Array(G * G * G).fill(-1); this.next = new Int32Array(this.n);
    for (let i = 0; i < this.n; i++) { const at = this.at(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]); this.next[i] = this.head[at]; this.head[at] = i; }
  }
  at(x, y, z) { const G = this.G, c = this.cell; return (Math.floor((x + 1.01) / c) * G + Math.floor((y + 1.01) / c)) * G + Math.floor((z + 1.01) / c); }
  /** The nearest point `out.i`, its distance `out.d` and the distance `out.e` to the second nearest, in units of the spacing. */
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

/** `count` points spread evenly over a sphere, each moved a share of the spacing off its place. */
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
/**
 * The clumps of a style, the same on every head.
 *   curl.clump   width of a clump in millimetres on a head of average size
 *   curl.deep    how far the surface of the hair stands from the middle of the head there, in millimetres
 *   curl.tall    how many times taller than wide a clump is where the hair hangs (ringlets); 1 for coils
 * Clumps are laid out in a space where a hanging clump is as wide as it is tall: `toHead` and `toField` go between it
 * and directions of the head. Each clump lists its corners in order round it; a corner is where three clumps meet.
 */
export function clumpField(curl) {
  const tall = curl.tall ?? 1, key = [curl.kind, curl.clump, curl.deep, tall].join("/");
  if (fields.has(key)) return fields.get(key);
  const angle = curl.clump / curl.deep, count = Math.round(4 * Math.PI / (.866 * angle * angle)), { points, spacing } = scattered(count, .42, 17 + curl.clump);
  // Over the top of the head a clump is as wide as it is long. Below `LEVEL` of elevation, where hair hangs, it is `tall` times as long.
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
  // Corners in order round each clump, anticlockwise seen from outside.
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

/**
 * The mass of a curly style on one adult.
 *   spec       the style: `curl` as for clumpField plus `drop`, how far in millimetres ringlets hang below the hairline
 *              round the sides and the back; `relief`, how far a clump rises over its creases in millimetres
 *   margin     (phi, eps) -> degrees inside the hairline, negative outside
 *   cutAt      (q, phi, far) -> { cover, under, top, forehead, fade }
 *   seat       (q, height, out) -> { p, n, v } on this adult's scalp, `out` metres off it along the direction
 *   volume     (at, far) -> metres the smooth mass stands off the head
 *   hair, tone linear colours of the hair and the skin
 * Returns { position, normal, color, uv, index, bones, weights } with every clump whole.
 */
export function clumpVolume({ spec, f, k, body, margin, cutAt, seat, volume, hair, tone }) {
  const curl = spec.curl, mm = k / 1000, field = clumpField(curl), { points, corners, members, rings } = field;
  const relief = (spec.relief ?? 3) * mm, domed = relief > 2.1 * mm, shoulderAt = .6;
  const luma = .2126 * hair.r + .7152 * hair.g + .0722 * hair.b, crease = mix(.6, .8, smooth(.05, .45, luma));
  const aimOf = q => ({ q, phi: Math.atan2(q[0], q[2]), eps: Math.asin(clamp(q[1], -1, 1)) });
  // Ringlets hang past the hairline round the sides and the back, never over the face.
  // `hangAt` is 0 in front of the ear, where the mass rises from the hairline, and 1 behind it, where it hangs over the line.
  const hangAt = phi => curl.drop ? smooth(62 * DEG, 82 * DEG, Math.abs(phi)) : 0, dropAt = phi => (curl.drop ?? 0) / (.1 * 1000) / DEG * hangAt(phi), band = 4.2;
  const inside = q => { const at = aimOf(q); return margin(at.phi, at.eps) + dropAt(at.phi); };
  const fieldPoint = i => [points[i * 3], points[i * 3 + 1], points[i * 3 + 2]];
  const kept = new Uint8Array(field.count);
  // A clump is built where its middle is in the hair.
  for (let i = 0; i < field.count; i++) kept[i] = inside(field.toHead(fieldPoint(i))) >= 1 ? 1 : 0;

  const out = { position: [], normal: [], color: [], uv: [], index: [], bones: [], weights: [] }, smoothNormal = [];
  /**
   * A point of the mass along direction `q`: `rise` of the relief above the creases (0 to 1) on a clump of size `amp`,
   * in shade `shadeOf`. With `hug` it lies on the scalp instead: 1 where the last fine hairs end outside the hairline,
   * 3 where the hair is whole just inside it, both drawn from the strip of the picture, and 2 in the same place as the
   * foot of the mass.
   */
  const place = (q, rise, amp, shadeOf, hug = 0) => {
    const at = aimOf(q), edge = margin(at.phi, at.eps), far = Math.max(0, edge), here = cutAt(at.q, at.phi, far);
    // Where ringlets hang past the hairline the mass keeps its depth down to the line; elsewhere it rises from it.
    const hang = hangAt(at.phi), deepFar = mix(far, Math.max(far, .8 * spec.rim), hang);
    const grown = smooth(.5, .55 * spec.rim + 1, deepFar), dome = relief * grown * (rise * amp - .42);
    // The hair is never thinner than its roots, and a clump keeps its dome where the mass is thin.
    const off = hug ? here.under + .0007 * k : Math.max(here.under + .0007 * k, volume(at, deepFar) * mix(1, .85, hang) + dome);
    let station;
    if (edge < 0 && hang > 0 && !hug) {
      // Below the hairline the mass hangs: straight down from where it left the head, and its ends turn in under it.
      const eps = at.eps - edge * DEG, rim = [Math.cos(eps) * Math.sin(at.phi), Math.sin(eps), Math.cos(eps) * Math.cos(at.phi)], hung = -edge * DEG * .1 * k;
      const top = seat(rim, 0, off), inward = .62 * off * clamp(-edge / Math.max(1, dropAt(at.phi))) ** 1.6, flat = Math.hypot(top.p[0] - f.centre[0], top.p[2] - f.centre[2]) || 1;
      // Hair that hangs lies on the neck and the shoulders, never in them.
      const hangs = body.clear(body.clear([top.p[0] - (top.p[0] - f.centre[0]) / flat * inward, top.p[1] - hung, top.p[2] - (top.p[2] - f.centre[2]) / flat * inward], .004 * k), .004 * k);
      station = { p: hangs, n: unit([top.n[0], top.n[1] * .4, top.n[2]]), v: top.v };
    } else station = seat(q, 0, off);
    const index = out.position.length / 3, uv = hug === 1 || hug === 3 ? clumpEdge(at.phi, hug === 3 ? 1 : 0) : clumpChart(q);
    out.position.push(station.p[0], station.p[1], station.p[2]); smoothNormal.push(station.n[0], station.n[1], station.n[2]);
    out.uv.push(uv[0], 1 - uv[1]);
    // The mass is all hair, darkest at its foot. Along the hairline the picture itself thins into fine hairs over the skin.
    const shade = shadeOf * mix(.9, 1, here.top);
    out.color.push(hair.r * shade, hair.g * shade, hair.b * shade);
    const skin = body.skinOf(station.v >= 0 ? station.v : body.nearest(station.p, 8));
    out.bones.push(...skin[0]); out.weights.push(...skin[1]);
    out.flat.push(hug ? 1 : 0);
    return index;
  };
  out.flat = [];
  /**
   * The direction between `from` (inside the hair) and `to` where the hair first thins to `level` degrees inside its
   * edge. A hairline turns in and out, so the way is walked from `from` and the first crossing is the one kept.
   */
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
  // A clump at the edge of the hair runs on past its own outline to the hairline, over what a clump that was not
  // built would have covered. `walk` is where the hair first thins to `level` on the way from `from` to `via`, a place
  // on the outline of the clump, and on from there towards `to`, the middle of the clump that was not built. Every
  // point of one stretch of the edge heads for the same middle, so the points keep their order along the hairline.
  const walk = (from, via, to, level) => { const first = reach(from, via, level); return first === via ? reach(via, to, level) : first; };
  // At the edge of the hair a band a few millimetres wide lies on the scalp and thins into the skin; the mass rises
  // from the inner side of that band. `edgePair` gives both sides for a point of the edge.
  const edgePair = (from, via, to) => {
    const u = walk(from, via, to, 0), q = field.toHead(u), at = aimOf(q);
    if (dropAt(at.phi) > .3) { const index = place(q, 0, 1, crease); return { outer: index, inner: index, u }; }
    // The foot of the mass is always between where it was reached from and the hairline, however near the two are.
    // The band is never wider than a centimetre: where the hairline is a slow fade, as on a sideburn, the mass runs on to it.
    const last = walk(from, via, to, -1.3), deep = walk(from, via, to, Math.min(band, .6 * inside(field.toHead(from)))), span = Math.acos(clamp(dot(deep, last), -1, 1));
    const v = span > 6.5 * DEG ? mixed(last, deep, 6.5 * DEG / span) : deep, foot = field.toHead(v), root = crease * .9;
    return { outer: place(field.toHead(last), 0, 1, root, 1), strip: place(foot, 0, 1, root, 3), inner: place(foot, 0, 1, root, 2), u: v };
  };
  const valleys = new Map();
  // Where three clumps meet the crease is deepest. Some clumps run into each other instead: there the corner stays high.
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
      // The hairline is followed between the corners of a clump at the edge of the hair, so it is this adult's own line.
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
        // The fan from each shoulder meets in the middle of the edge.
        out.index.push(high[j], line[Math.ceil((line.length - 1) / 2)].inner, high[m]);
      }
    }
  }
  // Lit as the lumps it is made of, softened towards the round of the whole mass so no facet glints.
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

// ---------------------------------------------------------------------------------------------
// The picture

const pictures = new Map();
/**
 * The clumps of a style drawn as pixels: `tone` is RGBA, a grey that the hair colour is multiplied by, stored the way a
 * picture stores light; `height` is RGBA with the relief of the coils in its grey, 0 to 255 over one unit of height.
 */
export function clumpPixels(curl, size = 512) {
  const field = clumpField(curl), key = field.key + "@" + size;
  if (pictures.has(key)) return pictures.get(key);
  const tone = new Uint8ClampedArray(size * size * 4), height = new Uint8ClampedArray(size * size * 4), coils = curl.kind === "coil";
  // The export gives hair a few hundred pixels across this chart, so the picture is drawn in forms of a centimetre:
  // lobes of curl inside each clump, lit on their crowns and dark between, never single hairs.
  const lobeCount = Math.round(field.count * (curl.clump / (curl.coil ?? 10)) ** 2), lobes = scattered(lobeCount, .4, 71 + curl.clump), lobeLookup = new Scatter(lobes.points, lobes.spacing);
  const a = { i: 0, d: 0, e: 0 }, b = { i: 0, d: 0, e: 0 }, points = field.points;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const at = (y * size + x) * 4, q = chartDirection((x + .5) / size, (y + .5) / size);
    if ((y + .5) / size < STRIP) {
      // Fine hairs of uneven length, a few texels wide so they survive the export: whole at the foot, parted at the tips.
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
      // A ringlet is a lock wound round itself: each turn shows as a lit band across the lock, rounded off at its sides.
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
/** The picture of a style's clumps and its relief as textures. */
export function clumpMaps(curl) {
  const key = clumpField(curl).key;
  if (maps.has(key)) return maps.get(key);
  const { width, tone, relief } = clumpPixels(curl), made = { map: textureOf(tone, width, "Hair clumps", true), bumpMap: textureOf(relief, width, "Hair clump relief", false) };
  maps.set(key, made);
  return made;
}
