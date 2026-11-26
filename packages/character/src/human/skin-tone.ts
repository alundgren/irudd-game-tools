// Local tone for bare body skin (character-view/human-skin-tone.js at
// 2761eb1). Hollows between tendons, knuckles and collarbones sit a little
// deeper in the skin's own hue, and skin that differs on anybody (knuckle
// creases, nails, the navel and the folds of a joint, measured from the CC0
// MakeHuman skins) is darker or redder. It is held on the vertices of the
// smooth surface the head and the body are both cut from, and fades out over
// the neck before it reaches the painted face.

import type * as T from "three";
import { boneNames } from "./catalogue.js";
import type { HumanPaint } from "./paint-data.js";
import type { SmoothSurface } from "./smooth.js";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smooth = (v: number, a: number, b: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const at = (a: ArrayLike<number>, i: number) => a[i] ?? 0;

// How strongly a region flushes, by the joint that carries it.
function flushOf(name: string): number {
  if (/_03_/.test(name)) return 1;
  if (/^(index|middle|ring|pinky|thumb)_/.test(name)) return 0.8;
  if (/^(hand|ball)_/.test(name)) return 0.6;
  if (name.startsWith("foot_")) return 0.4;
  return 0;
}

interface Near {
  readonly start: Uint32Array;
  readonly list: Uint32Array;
}
function neighbours(indices: Uint32Array, corners: number, count: number): Near {
  const start = new Uint32Array(count + 1);
  for (let c = 0; c < corners; c++) {
    const k = at(indices, c) + 1;
    start[k] = at(start, k) + 2;
  }
  for (let i = 0; i < count; i++) start[i + 1] = at(start, i + 1) + at(start, i);
  const fill = start.slice(0, count),
    list = new Uint32Array(at(start, count));
  for (let c = 0; c < corners; c += 3)
    for (let k = 0; k < 3; k++) {
      const a = at(indices, c + k);
      list[at(fill, a)] = at(indices, c + ((k + 1) % 3));
      fill[a] = at(fill, a) + 1;
      list[at(fill, a)] = at(indices, c + ((k + 2) % 3));
      fill[a] = at(fill, a) + 1;
    }
  return { start, list };
}
function relax(
  values: Float32Array,
  size: number,
  { start, list }: Near,
  passes: number,
): Float32Array {
  let from = values,
    to: Float32Array = new Float32Array(values.length);
  for (let pass = 0; pass < passes; pass++) {
    for (let v = 0; v < start.length - 1; v++) {
      const n = at(start, v + 1) - at(start, v);
      for (let d = 0; d < size; d++) {
        if (!n) {
          to[v * size + d] = at(from, v * size + d);
          continue;
        }
        let sum = 0;
        for (let j = at(start, v); j < at(start, v + 1); j++)
          sum += at(from, at(list, j) * size + d);
        to[v * size + d] = 0.5 * at(from, v * size + d) + (0.5 * sum) / n;
      }
    }
    [from, to] = [to, from === values ? new Float32Array(values.length) : from];
  }
  return from;
}

/**
 * Where the surface is hollow (positive) or stands proud (negative), per
 * vertex, relative to the size of the form around it: a fine scale for
 * knuckles and tendons and a broad one for collarbones, the throat and the
 * hollow of a knee.
 */
function skinRelief(surface: SmoothSurface, normals: ArrayLike<number>): Float32Array {
  const count = surface.positions.length / 3,
    corners = surface.bodyTriangles * 3;
  const near = neighbours(surface.indices, corners, count);
  const relief = new Float32Array(count);
  let from = surface.positions,
    passes = 0;
  for (const [until, weight] of [
    [3, 0.55],
    [12, 0.45],
  ] as const) {
    from = relax(from, 3, near, until - passes);
    passes = until;
    for (let v = 0; v < count; v++) {
      if (at(near.start, v + 1) === at(near.start, v)) continue;
      let offset = 0,
        span = 0;
      for (let d = 0; d < 3; d++)
        offset += (at(from, v * 3 + d) - at(surface.positions, v * 3 + d)) * at(normals, v * 3 + d);
      for (let j = at(near.start, v); j < at(near.start, v + 1); j++) {
        const o = at(near.list, j) * 3,
          x = at(from, o) - at(from, v * 3),
          y = at(from, o + 1) - at(from, v * 3 + 1),
          z = at(from, o + 2) - at(from, v * 3 + 2);
        span += Math.sqrt(x * x + y * y + z * z);
      }
      span /= at(near.start, v + 1) - at(near.start, v);
      // The smoothed neighbourhood sets the scale, so a child and a giant shade alike.
      relief[v] = at(relief, v) + (weight * offset) / Math.max(span * Math.sqrt(until), 1e-6);
    }
  }
  // A finger or an arm is round all over. Keep what differs from the form around it.
  const local = relax(relief, 1, near, 2),
    around = relax(local, 1, near, 14);
  for (let v = 0; v < count; v++) local[v] = at(local, v) - at(around, v);
  return local;
}

/**
 * Linear colour multipliers per vertex, never above one, for a body of this
 * skin colour. Vertices that move wholly with the head keep exactly one.
 */
export function skinShade(
  surface: SmoothSurface,
  normals: ArrayLike<number>,
  skin: T.Color,
  paint: HumanPaint,
): Float32Array {
  const count = surface.positions.length / 3,
    shade = new Float32Array(count * 3).fill(1);
  const tone = [skin.r, skin.g, skin.b].map((v) => Math.max(0.004, v));
  const most = Math.max(...tone),
    hue = tone.map((v) => Math.max(-1.1, Math.log(v / most)));
  const head = boneNames.indexOf("head"),
    flush = boneNames.map(flushOf);
  const relief = skinRelief(surface, normals);
  const packed = count * 2 === paint.tone.length ? paint.tone : null;
  const { toneRange, warmRange } = paint;
  for (let v = 0; v < count; v++) {
    let face = 0,
      warm = 0;
    for (let j = v * 4; j < v * 4 + 4; j++) {
      if (surface.boneIndices[j] === head) face += at(surface.weights, j);
      warm += at(flush, at(surface.boneIndices, j)) * at(surface.weights, j);
    }
    const body = 1 - smooth(face, 0.1, 0.9);
    if (body <= 0) continue;
    const hollow = smooth(at(relief, v), 0.004, 0.05),
      proud = smooth(-at(relief, v), 0.006, 0.05);
    const darker = packed ? Math.max(0, ((128 - at(packed, v * 2)) / 127) * toneRange - 0.03) : 0;
    const redder = packed
      ? Math.max(0, ((at(packed, v * 2 + 1) - 128) / 127) * warmRange - 0.02)
      : 0;
    // A hollow is deeper and more saturated; blood shows where skin is thin over bone.
    const deep = body * Math.min(0.75, 0.42 * hollow + 2.2 * darker);
    const blood = body * Math.min(2.2, 0.45 * warm + 0.9 * proud * (0.4 + 0.6 * warm) + 7 * redder);
    for (let d = 0; d < 3; d++)
      shade[v * 3 + d] = Math.max(
        0.45,
        (1 - 0.42 * deep) * Math.exp(at(hue, d) * (0.55 * deep + 0.2 * blood)),
      );
  }
  return shade;
}
