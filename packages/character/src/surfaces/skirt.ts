// Skirts. Ported from skirtRadius and skirtGeometry in
// character-view/skirt-pattern.js at 2761eb1, arithmetic in the same order so
// the vertices match. Two surfaces, the outer one first, run from the waist
// ring down to the hem and are sewn there and at the waist; the fold relief is
// kept per vertex so a fit can ease the plain pattern and lay the folds back.

import type { SkirtCut } from "@irudd/document";
import * as T from "three";

type Outline = SkirtCut["outline"];

const at = (curve: Outline, i: number): readonly [number, number] => {
  const p = curve[i];
  if (!p) throw new Error("Skirt outline index out of range.");
  return p;
};

/** The outline's radius at height `t`, on monotone cubic tangents. */
export function skirtRadius(curve: Outline, t: number): number {
  let b = 1;
  while (b < curve.length - 1 && at(curve, b)[0] < t) b++;
  const a = b - 1;
  const p = at(curve, a);
  const q = at(curve, b);
  const len = q[0] - p[0];
  const s = T.MathUtils.clamp((t - p[0]) / len, 0, 1);
  // Monotone cubic tangents retain narrow knees without overshoot at a hem.
  const slope = (i: number): number => {
    if (i === 0) return (at(curve, 1)[1] - at(curve, 0)[1]) / (at(curve, 1)[0] - at(curve, 0)[0]);
    if (i === curve.length - 1)
      return (at(curve, i)[1] - at(curve, i - 1)[1]) / (at(curve, i)[0] - at(curve, i - 1)[0]);
    const left = (at(curve, i)[1] - at(curve, i - 1)[1]) / (at(curve, i)[0] - at(curve, i - 1)[0]);
    const right = (at(curve, i + 1)[1] - at(curve, i)[1]) / (at(curve, i + 1)[0] - at(curve, i)[0]);
    return left * right > 0 ? (2 * left * right) / (left + right) : 0;
  };
  return (
    (2 * s ** 3 - 3 * s * s + 1) * p[1] +
    (s ** 3 - 2 * s * s + s) * len * slope(a) +
    (-2 * s ** 3 + 3 * s * s) * q[1] +
    (s ** 3 - s * s) * len * slope(b)
  );
}

/** A skirt and its fold relief, per vertex [x, z]. */
export interface SkirtSurface {
  readonly geometry: T.BufferGeometry;
  readonly relief: Float32Array;
}

export function skirtGeometry(c: SkirtCut): SkirtSurface {
  const pleats = c.pleats ?? 0;
  const cols = Math.max(80, pleats * 8);
  const rows = Math.max(68, 6 * c.folds, 8 * c.tiers);
  const ring = cols + 1;
  const layer = ring * (rows + 1);
  const positions: number[] = [];
  const uv: number[] = [];
  const colors: number[] = [];
  const index: number[] = [];
  const relief: number[] = [];
  for (let side = 0; side < 2; side++)
    for (let j = 0; j <= rows; j++) {
      const t = j / rows;
      const radius = skirtRadius(c.outline, t) * T.MathUtils.lerp(1, c.flare, t * t);
      for (let i = 0; i <= cols; i++) {
        const u = i / cols;
        const theta = (u - 0.5) * Math.PI * 2;
        const sa = Math.sin(theta);
        const ca = Math.cos(theta);
        const lower = T.MathUtils.smoothstep(t, 0.58, 0.86);
        const field =
          t + c.bias * 0.23 * sa * (1 - 0.62 * lower) + 0.045 * ca * ca * Math.sin(Math.PI * t);
        const wave = c.folds ? Math.sin(2 * Math.PI * c.folds * field + 0.35 * Math.sin(theta)) : 0;
        const drape =
          c.gather *
          (0.24 + 0.76 * ca * ca) *
          (0.88 - 0.55 * lower) *
          (0.22 * (1 + wave) + 0.78 * Math.max(0, wave) ** 2) *
          T.MathUtils.smoothstep(t, 0, 0.1);
        const tierPhase = ((t - 0.64) / 0.36) * c.tiers;
        const phase = Math.max(0, tierPhase) % 1;
        const lip =
          T.MathUtils.smoothstep(phase, 0.06, 0.8) * (1 - T.MathUtils.smoothstep(phase, 0.8, 1));
        const tier = c.tiers && t > 0.64 ? 0.1 * T.MathUtils.smoothstep(t, 0.64, 0.72) * lip : 0;
        const pleat = pleats
          ? (c.pleatDepth ?? 0.14) *
            T.MathUtils.smoothstep(t, 0, 0.42) *
            (0.5 + 0.5 * Math.cos(pleats * theta + 0.48 * Math.sin(Math.PI * t))) ** 2
          : 0;
        const vertical = 0.022 * Math.cos(theta * 9 + 0.63 * t) * t * t;
        const rear = (1 - ca) * 0.5;
        const tail = c.train * rear ** 3 * t ** 2;
        const thick = side * Math.min(0.004, c.width * 0.009);
        const rx = c.width * 0.5 * (radius + vertical + drape + tier + pleat) - thick;
        const rz = c.depth * 0.5 * (radius + vertical + drape + tier + pleat) - thick;
        positions.push(sa * rx, -c.drop * t + side * 0.0004, ca * rz - tail);
        relief.push(
          sa * c.width * 0.5 * (drape + tier + pleat),
          ca * c.depth * 0.5 * (drape + tier + pleat),
        );
        uv.push(u, 1 - t);
        const band = j === 0 || j === rows || (c.tiers && t > 0.64 && tierPhase % 1 > 0.84);
        const shade = side ? 0.74 : band ? 0.8 : 1;
        colors.push(shade, shade, shade);
      }
    }
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const a = j * ring + i;
      const b = a + 1;
      const d = a + ring;
      const e = d + 1;
      index.push(
        a,
        d,
        b,
        b,
        d,
        e,
        a + layer,
        b + layer,
        d + layer,
        b + layer,
        e + layer,
        d + layer,
      );
      if (j === 0) index.push(a, b, a + layer, b, b + layer, a + layer);
      if (j === rows - 1) index.push(e, d, e + layer, d, d + layer, e + layer);
    }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  // Weld lighting across the UV seam while retaining separate texture coordinates.
  const n = g.getAttribute("normal");
  for (let s = 0; s < 2; s++)
    for (let j = 0; j <= rows; j++) {
      const a = s * layer + j * ring;
      const b = a + cols;
      const x = n.getX(a) + n.getX(b);
      const y = n.getY(a) + n.getY(b);
      const z = n.getZ(a) + n.getZ(b);
      const length = Math.hypot(x, y, z) || 1;
      for (const i of [a, b]) n.setXYZ(i, x / length, y / length, z / length);
    }
  g.computeBoundingBox();
  return { geometry: g, relief: new Float32Array(relief) };
}
