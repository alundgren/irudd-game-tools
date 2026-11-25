// Finish the packed costumes against the body they are worn on.
//   node scripts/pack-human-attire-finish.mjs character-view/human-attire-data.json
// Run by pack-human-attire.py. Garment points their author fitted to helper geometry this body does not
// carry (the joint markers round an ankle) are fitted to the nearest skin instead, from where the author
// left them. Then the skin each garment covers is found, for garments whose authors marked none. A skin point is covered when the garment lies just outside it along its
// normal and no opening of the garment is near: skin stays up a sleeve, under a hem and inside a collar.
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";
import { evaluateHuman, humanRestPositions } from "../character-view/human-surface.js";
import { raycaster } from "../character-view/human-style-kit.js";

const file = process.argv[2], library = JSON.parse(readFileSync(file, "utf8"));
const unpack = (text, Type) => { const raw = inflateSync(Buffer.from(text, "base64")); return new Type(raw.buffer, raw.byteOffset, raw.byteLength / Type.BYTES_PER_ELEMENT); };
const pack = (values, Type = Uint16Array) => { const data = Type.from(values); return deflateSync(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { level: 9 }).toString("base64"); };
// The closest point of triangle abc to p, as barycentric weights.
function closest(p, a, b, c) {
  const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]], dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return [1, 0, 0];
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return [0, 1, 0];
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return [1 - v, v, 0]; }
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return [0, 0, 1];
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return [1 - w, 0, w]; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + d5 - d6); return [0, 1 - w, w]; }
  const k = 1 / (va + vb + vc);
  return [1 - vb * k - vc * k, vb * k, vc * k];
}
const body = evaluateHuman({}), rest = humanRestPositions(), at = new Map(Array.from(body.ids, (id, i) => [id, i]));
const reach = .07, opening = .028;

// Outward normals of the resting skin.
const normals = new Float32Array(body.bodyVertices * 3);
for (let c = 0; c < body.bodyTriangles * 3; c += 3) {
  const [a, b, d] = [0, 1, 2].map(k => body.indices[c + k]), p = k => [0, 1, 2].map(j => rest[k * 3 + j]);
  const [pa, pb, pd] = [p(a), p(b), p(d)], u = pb.map((x, j) => x - pa[j]), v = pd.map((x, j) => x - pa[j]);
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  for (const k of [a, b, d]) if (k < body.bodyVertices) for (let j = 0; j < 3; j++) normals[k * 3 + j] += n[j];
}

for (const [name, record] of Object.entries(library)) {
  const refs = unpack(record.refs, Uint16Array).slice(), weights = unpack(record.weights, Float32Array).slice(), offsets = unpack(record.offsets, Float32Array).slice(), corners = unpack(record.corners, Uint16Array);
  const authored = unpack(record.rest, Float32Array), cloth = new Float32Array(refs.length), point = v => [rest[v * 3], rest[v * 3 + 1], rest[v * 3 + 2]];
  // Where each point lies on this resting body. The author's own body differs a little from it, so a point
  // without a fit is moved the way the fitted points round it moved, and then fitted to the skin there.
  const loose = [], held = [];
  for (let i = 0; i < refs.length; i += 3) {
    if ([0, 1, 2].some(k => !at.has(refs[i + k]))) { loose.push(i); continue; }
    held.push(i);
    for (let k = 0; k < 3; k++) for (let d = 0; d < 3; d++) cloth[i + d] += rest[at.get(refs[i + k]) * 3 + d] * weights[i + k];
    for (let d = 0; d < 3; d++) cloth[i + d] += offsets[i + d];
  }
  for (const i of loose) {
    const near = held.map(j => [Math.hypot(authored[i] - authored[j], authored[i + 1] - authored[j + 1], authored[i + 2] - authored[j + 2]), j]).sort((u, v) => u[0] - v[0]).slice(0, 8);
    let sum = 0;
    const p = [0, 0, 0];
    for (const [far, j] of near) { const w = 1 / (far + .002); sum += w; for (let d = 0; d < 3; d++) p[d] += w * (cloth[j + d] - authored[j + d]); }
    for (let d = 0; d < 3; d++) p[d] = authored[i + d] + p[d] / sum;
    let best = Infinity;
    for (let c = 0; c < body.bodyTriangles * 3; c += 3) {
      const tri = [0, 1, 2].map(k => body.indices[c + k]), [a, b, d] = tri.map(point);
      if (Math.min(Math.abs(a[1] - p[1]), Math.abs(b[1] - p[1])) > .12) continue;
      const w = closest(p, a, b, d), q = [0, 1, 2].map(j => a[j] * w[0] + b[j] * w[1] + d[j] * w[2]), far = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      if (far >= best) continue;
      best = far;
      for (let k = 0; k < 3; k++) { refs[i + k] = body.ids[tri[k]]; weights[i + k] = w[k]; offsets[i + k] = p[k] - q[k]; }
    }
    cloth.set(p, i);
  }
  // Cloth worn under another piece lies close above a height: [from, to, share of its stand-off kept].
  if (record.under) {
    const [from, to, keep] = record.under;
    for (let i = 0; i < refs.length; i += 3) {
      const t = Math.min(1, Math.max(0, (cloth[i + 1] - from) / (to - from))), k = 1 + (keep - 1) * t * t * (3 - 2 * t);
      for (let d = 0; d < 3; d++) offsets[i + d] *= k;
    }
    delete record.under;
  }
  Object.assign(record, { refs: pack(refs), weights: pack(weights, Float32Array), offsets: pack(offsets, Float32Array) });
  delete record.rest;
  console.log(name, "fitted", loose.length, "loose points to the skin");
  if (!record.cover) { delete record.cover; continue; }
  delete record.cover;
  // Edges with one triangle are the garment's openings.
  const edges = new Map(), rim = [];
  for (let c = 0; c < corners.length; c += 3) for (let k = 0; k < 3; k++) {
    const a = corners[c + k], b = corners[c + (k + 1) % 3], key = a < b ? a * 65536 + b : b * 65536 + a;
    edges.set(key, (edges.get(key) ?? 0) + 1);
  }
  for (const [key, uses] of edges) if (uses === 1) for (const v of [Math.floor(key / 65536), key % 65536]) rim.push([cloth[v * 3], cloth[v * 3 + 1], cloth[v * 3 + 2]]);
  const hit = raycaster(cloth, corners), hide = [];
  for (let v = 0; v < body.bodyVertices; v++) {
    // None of these garments is a glove or a hood: a hand beside a skirt or a jaw over a collar stays.
    let lead = 0;
    for (let k = 1; k < 4; k++) if (body.weights[v * 4 + k] > body.weights[v * 4 + lead]) lead = k;
    if (/^head$|^hand_|^thumb|^index|^middle|^ring|^pinky/.test(body.names[body.boneIndices[v * 4 + lead]])) continue;
    const p = [rest[v * 3], rest[v * 3 + 1], rest[v * 3 + 2]], n = [normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]], l = Math.hypot(...n) || 1;
    const out = n.map(x => x / l), from = p.map((x, j) => x - out[j] * .004);
    if (!(hit(from, out, reach) < reach)) continue;
    if (rim.some(r => (r[0] - p[0]) ** 2 + (r[1] - p[1]) ** 2 + (r[2] - p[2]) ** 2 < opening * opening)) continue;
    hide.push(body.ids[v]);
  }
  record.hide = pack(hide.sort((a, b) => a - b));
  console.log(name, "covers", hide.length, "skin points");
}
writeFileSync(file, JSON.stringify(library) + "\n");
