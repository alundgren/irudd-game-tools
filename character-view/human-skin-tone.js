// Local tone for bare body skin. Two sources meet here. The shape of this body: hollows between
// tendons, knuckles and collarbones sit a little deeper in the skin's own hue. And where skin
// differs on anybody: knuckle creases, nails, the navel and the folds of a joint, measured from
// the CC0 MakeHuman skins by scripts/pack-human-skin-tone.py. Hands and feet carry more blood.
// It is held on the vertices of the one smooth surface that the head and the body are both cut
// from, so the two sides of the neck join read the same value, and it fades out over the neck
// before it reaches the painted face.

import { unzlibSync } from "three/addons/libs/fflate.module.js";
import data from "./human-skin-tone-data.json" with { type: "json" };

// The packed bytes are signed about this value. A file packed any other way must not be read.
export const toneEncoding = "signed-local-tone";
if (data.encoding?.name !== toneEncoding || data.encoding.neutral !== 128)
  throw new Error("human-skin-tone-data.json is not packed as " + toneEncoding + ". Run scripts/pack-human-skin-tone.py.");
let measured;
function measuredTone() {
  return (measured ??= unzlibSync(Uint8Array.from(atob(data.tone), (c) => c.charCodeAt(0))));
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (v, a, b) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const linear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

// How strongly a region flushes, by the joint that carries it.
function flushOf(name) {
  if (/_03_/.test(name)) return 1;
  if (/^(index|middle|ring|pinky|thumb)_/.test(name)) return 0.8;
  if (/^(hand|ball)_/.test(name)) return 0.6;
  if (/^foot_/.test(name)) return 0.4;
  return 0;
}

function neighbours(indices, corners, count) {
  const start = new Uint32Array(count + 1);
  for (let c = 0; c < corners; c++) start[indices[c] + 1] += 2;
  for (let i = 0; i < count; i++) start[i + 1] += start[i];
  const fill = start.slice(0, count), list = new Uint32Array(start[count]);
  for (let c = 0; c < corners; c += 3)
    for (let k = 0; k < 3; k++) {
      const a = indices[c + k];
      list[fill[a]++] = indices[c + ((k + 1) % 3)];
      list[fill[a]++] = indices[c + ((k + 2) % 3)];
    }
  return { start, list };
}
function relax(values, size, { start, list }, passes) {
  let from = values, to = new Float32Array(values.length);
  for (let pass = 0; pass < passes; pass++) {
    for (let v = 0; v < start.length - 1; v++) {
      const n = start[v + 1] - start[v];
      for (let d = 0; d < size; d++) {
        if (!n) { to[v * size + d] = from[v * size + d]; continue; }
        let sum = 0;
        for (let j = start[v]; j < start[v + 1]; j++) sum += from[list[j] * size + d];
        to[v * size + d] = 0.5 * from[v * size + d] + 0.5 * sum / n;
      }
    }
    [from, to] = [to, from === values ? new Float32Array(values.length) : from];
  }
  return from;
}

/**
 * Where the surface is hollow (positive) or stands proud (negative), per vertex, relative to
 * the size of the form around it: a fine scale for knuckles and tendons and a broad one for
 * collarbones, the throat and the hollow of a knee.
 */
export function skinRelief(surface, normals) {
  const count = surface.positions.length / 3, corners = surface.bodyTriangles * 3;
  const near = neighbours(surface.indices, corners, count);
  const relief = new Float32Array(count);
  let from = surface.positions, passes = 0;
  for (const [until, weight] of [[3, 0.55], [12, 0.45]]) {
    from = relax(from, 3, near, until - passes);
    passes = until;
    for (let v = 0; v < count; v++) {
      if (near.start[v + 1] === near.start[v]) continue;
      let offset = 0, span = 0;
      for (let d = 0; d < 3; d++) offset += (from[v * 3 + d] - surface.positions[v * 3 + d]) * normals[v * 3 + d];
      for (let j = near.start[v]; j < near.start[v + 1]; j++) {
        const o = near.list[j] * 3, x = from[o] - from[v * 3], y = from[o + 1] - from[v * 3 + 1], z = from[o + 2] - from[v * 3 + 2];
        span += Math.sqrt(x * x + y * y + z * z);
      }
      span /= near.start[v + 1] - near.start[v];
      // The smoothed neighbourhood sets the scale, so a child and a giant shade alike.
      relief[v] += weight * offset / Math.max(span * Math.sqrt(until), 1e-6);
    }
  }
  // A finger or an arm is round all over. Keep what differs from the form around it.
  const local = relax(relief, 1, near, 2), around = relax(local, 1, near, 14);
  for (let v = 0; v < count; v++) local[v] -= around[v];
  return local;
}

/**
 * Linear colour multipliers per vertex, never above one, for a body of this skin colour.
 * Vertices that move wholly with the head keep exactly one.
 */
export function skinShade(surface, normals, skin) {
  const count = surface.positions.length / 3, shade = new Float32Array(count * 3).fill(1);
  const tone = [skin.r, skin.g, skin.b].map((v) => Math.max(0.004, skin.isColor ? v : linear(v)));
  const most = Math.max(...tone), hue = tone.map((v) => Math.max(-1.1, Math.log(v / most)));
  // A vivid invented skin shifts no further than ordinary skin does: its weakest channel counts as a third.
  const head = surface.names.indexOf("head"), flush = surface.names.map(flushOf);
  const relief = skinRelief(surface, normals);
  const packed = count === data.count ? measuredTone() : null;
  const { toneRange, warmRange } = data.encoding;
  for (let v = 0; v < count; v++) {
    let face = 0, warm = 0;
    for (let j = v * 4; j < v * 4 + 4; j++) {
      if (surface.boneIndices[j] === head) face += surface.weights[j];
      warm += flush[surface.boneIndices[j]] * surface.weights[j];
    }
    const body = 1 - smooth(face, 0.1, 0.9);
    if (body <= 0) continue;
    const hollow = smooth(relief[v], 0.004, 0.05), proud = smooth(-relief[v], 0.006, 0.05);
    // Skin that is darker or redder than the skin around it on every measured body.
    const darker = packed ? Math.max(0, (128 - packed[v * 2]) / 127 * toneRange - 0.03) : 0;
    const redder = packed ? Math.max(0, (packed[v * 2 + 1] - 128) / 127 * warmRange - 0.02) : 0;
    // A hollow is deeper and more saturated; blood shows where skin is thin over bone.
    const deep = body * Math.min(0.75, 0.42 * hollow + 2.2 * darker);
    const blood = body * Math.min(2.2, 0.45 * warm + 0.9 * proud * (0.4 + 0.6 * warm) + 7 * redder);
    for (let d = 0; d < 3; d++)
      shade[v * 3 + d] = Math.max(0.45, (1 - 0.42 * deep) * Math.exp(hue[d] * (0.55 * deep + 0.2 * blood)));
  }
  return shade;
}
