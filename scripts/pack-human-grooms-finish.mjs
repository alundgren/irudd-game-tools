// Resolve each packed groom against the body it is worn on.
//   node scripts/pack-human-grooms-finish.mjs character-view/human-grooms-data.json
// Run by pack-human-grooms.py. Two things are worked out here.
// MakeClothes stores every offset in units of a span of the wearer's head (the x, y and z scale lines of the
// .mhclo). The spans are measured here on the resting body, so the cards stand as far from the skin as their
// author set them, and the runtime fit in human-library.js can use the offsets as they are.
// Then the scalp each groom covers is found: a skin point of the head is covered when the trimmed cards pass
// over it. The roots layer under a groom is cut to this, so it ends where the artist's hairline ends and the
// feathered strands at the edge lie on skin, not on a cap.
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";
import { evaluateHuman, humanRestPositions } from "../character-view/human-surface.js";
import { surfaceBody } from "../character-view/human-fringe.js";

const file = process.argv[2], library = JSON.parse(readFileSync(file, "utf8"));
const body = evaluateHuman({}), rest = humanRestPositions(), at = new Map(Array.from(body.ids, (id, i) => [id, i]));
const unpack = (text, Type) => { const raw = inflateSync(Buffer.from(text, "base64")); return new Type(raw.buffer, raw.byteOffset, raw.byteLength / Type.BYTES_PER_ELEMENT); };
const skin = surfaceBody(body), headWeight = skin.weight(/^head/), P = skin.P, N = skin.N;
// Skin points next to each other, for smoothing the edge of the covered scalp.
const beside = Array.from({ length: skin.count }, () => new Set());
for (let t = 0; t < skin.tri.length; t += 3) for (let k = 0; k < 3; k++) { const a = skin.tri[t + k], b = skin.tri[t + (k + 1) % 3]; if (a < skin.count && b < skin.count) { beside[a].add(b); beside[b].add(a); } }
function covered(record, refs, offsets) {
  // The trimmed cards on the resting body.
  const weights = unpack(record.weights, Float32Array), card = new Float32Array(refs.length);
  for (let i = 0; i < refs.length; i += 3) for (let d = 0; d < 3; d++) {
    for (let k = 0; k < 3; k++) card[i + d] += body.positions[at.get(refs[i + k]) * 3 + d] * weights[i + k];
    card[i + d] += offsets[i + d];
  }
  const faceRefs = unpack(record.faceRefs, Uint16Array), blend = unpack(record.faceWeights, Uint16Array), faces = unpack(record.faceIndices, Uint32Array);
  const p = new Float32Array(faceRefs.length);
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) for (let d = 0; d < 3; d++) p[i + d] += card[faceRefs[i + k] * 3 + d] * blend[i + k] / 65535;
  // Triangles are binned by height so each skin point tests only the hair near it.
  const reach = .05, slab = .02, bins = new Map();
  for (let f = 0; f < faces.length; f += 3) {
    const ys = [0, 1, 2].map((k) => p[faces[f + k] * 3 + 1]);
    for (let b = Math.floor((Math.min(...ys) - reach) / slab); b <= Math.floor((Math.max(...ys) + reach) / slab); b++) (bins.get(b) ?? bins.set(b, []).get(b)).push(f);
  }
  const hit = (o, n) => {
    for (const f of bins.get(Math.floor(o[1] / slab)) ?? []) {
      const [a, b, c] = [0, 1, 2].map((k) => { const i = faces[f + k] * 3; return [p[i], p[i + 1], p[i + 2]]; });
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const h = [n[1] * e2[2] - n[2] * e2[1], n[2] * e2[0] - n[0] * e2[2], n[0] * e2[1] - n[1] * e2[0]], det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
      if (Math.abs(det) < 1e-12) continue;
      const t0 = [o[0] - a[0], o[1] - a[1], o[2] - a[2]], u = (t0[0] * h[0] + t0[1] * h[1] + t0[2] * h[2]) / det;
      if (u < 0 || u > 1) continue;
      const q = [t0[1] * e1[2] - t0[2] * e1[1], t0[2] * e1[0] - t0[0] * e1[2], t0[0] * e1[1] - t0[1] * e1[0]], v = (n[0] * q[0] + n[1] * q[1] + n[2] * q[2]) / det;
      if (v < 0 || u + v > 1) continue;
      const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
      if (t > 0 && t < reach) return true;
    }
    return false;
  };
  const ids = [], value = new Float32Array(skin.count);
  for (let i = 0; i < skin.count; i++) {
    if (headWeight[i] < .5) continue;
    ids.push(i);
    const n = [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]], o = [P[i * 3] - n[0] * .004, P[i * 3 + 1] - n[1] * .004, P[i * 3 + 2] - n[2] * .004];
    value[i] = hit(o, n) ? 1 : 0;
  }
  // A smooth edge half way between covered and bare skin, then drawn in a little under the hair.
  let field = value;
  for (let pass = 0; pass < 2; pass++) {
    const next = field.slice();
    for (const i of ids) { let sum = field[i], count = 1; for (const j of beside[i]) if (headWeight[j] >= .5) { sum += field[j]; count++; } next[i] = sum / count; }
    field = next;
  }
  return { ids: ids.map((i) => body.ids[i]), field: ids.map((i) => Math.round(Math.max(-1, Math.min(1, (field[i] - .6) * 2.5)) * 100)) };
}
for (const [name, record] of Object.entries(library)) {
  if (!record.scale) continue;
  const raw = inflateSync(Buffer.from(record.offsets, "base64")),
    offsets = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4).slice(),
    refs = inflateSync(Buffer.from(record.refs, "base64")), ids = new Uint16Array(refs.buffer, refs.byteOffset, refs.byteLength / 2);
  const missing = ids.filter((id) => !at.has(id)).length;
  if (missing) throw new Error(name + " is fitted to " + missing + " points this body does not carry");
  const factor = ["x", "y", "z"].map((axis, d) => {
    const span = record.scale[axis];
    if (!span) return 1;
    const [a, b, authored] = span;
    if (!at.has(a) || !at.has(b)) throw new Error(name + " measures a span this body does not carry");
    // Offsets and spans are stored in decimetres.
    return Math.abs(rest[at.get(a) * 3 + d] - rest[at.get(b) * 3 + d]) * 10 / authored;
  });
  for (let i = 0; i < offsets.length; i++) offsets[i] *= factor[i % 3];
  record.offsets = deflateSync(Buffer.from(offsets.buffer), { level: 9 }).toString("base64");
  delete record.scale;
  const cover = record.facial ? null : covered(record, ids, offsets);
  if (cover) {
    record.rootIds = deflateSync(Buffer.from(Uint16Array.from(cover.ids).buffer), { level: 9 }).toString("base64");
    record.rootField = deflateSync(Buffer.from(Int8Array.from(cover.field).buffer), { level: 9 }).toString("base64");
  }
  console.log(name, "spans", factor.map((f) => f.toFixed(3)).join(" "), cover ? "scalp points covered " + cover.field.filter((v) => v > 0).length + " of " + cover.ids.length : "");
}
writeFileSync(file, JSON.stringify(library) + "\n");
