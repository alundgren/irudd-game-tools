// Mantles: one two-sided fabric panel that wraps an open neckline and falls
// to a hem. Ported from mantleGeometry in character-view/mantle.js at 2761eb1,
// arithmetic in the same order so the vertices match. The two surfaces share
// sewn boundaries around the hem, the front opening and any armholes; the
// first half of the vertices is the outer surface, the second the lining.

import { armAccess, type ShoulderCut } from "@irudd/document";
import * as T from "three";

export function mantleGeometry(c: ShoulderCut): T.BufferGeometry {
  const arms = armAccess(c);
  const columns = 96;
  const rows = 34;
  const ring = columns + 1;
  const layer = ring * (rows + 1);
  const positions: number[] = [];
  const uv: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const boundary = new Map<number, readonly [number, number]>();
  const edge = (a: number, b: number): void => {
    const key = Math.min(a, b) * layer + Math.max(a, b);
    if (boundary.has(key)) boundary.delete(key);
    else boundary.set(key, [a, b]);
  };
  for (let side = 0; side < 2; side++)
    for (let j = 0; j <= rows; j++)
      for (let i = 0; i <= columns; i++) {
        const u = i / columns;
        const t = j / rows;
        const q = ((c.opening * Math.PI) / 180) * (0.56 + 0.44 * t);
        const theta = q / 2 + u * (Math.PI * 2 - q);
        const sa = Math.sin(theta);
        const ca = Math.cos(theta);
        const shoulder = T.MathUtils.smoothstep(t, 0, 0.29);
        const hang = Math.max(0, (t - 0.23) / 0.77);
        const fold = c.folds
          ? Math.sin(c.folds * theta + 0.55 * hang + 0.27 * Math.sin(3 * theta)) *
            (0.007 + 0.043 * hang)
          : 0;
        const rx = c.width * (0.205 + 0.375 * shoulder + 0.2 * c.flare * hang + fold);
        const rz = c.depth * (0.27 + 0.3 * shoulder + 0.3 * c.flare * hang + fold);
        const thickness = side * Math.min(0.0055, 0.012 * Math.min(c.width, c.depth));
        const frontFall = c.kind === "Cape" ? 1 - 0.37 * Math.max(0, ca) ** 2 : 1;
        const fall = c.drop * (t * 0.22 + Math.pow(t, 1.55) * 0.78) * frontFall;
        const hem = c.drop * 0.018 * Math.sin(3 * theta + 0.2) * t * t;
        positions.push(sa * (rx - thickness), -fall + hem + side * 0.0007, ca * (rz - thickness));
        uv.push(u, 1 - t);
        const trim = j <= 1 || j >= rows - 1 || i <= 1 || i >= columns - 1;
        colors.push(...(trim ? [0.49, 0.49, 0.49] : side ? [0.72, 0.72, 0.72] : [1, 1, 1]));
      }
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < columns; i++) {
      const u = (i + 0.5) / columns;
      const t = (j + 0.5) / rows;
      const half = ((c.opening * Math.PI) / 360) * (0.56 + 0.44 * t);
      const theta = half + u * (Math.PI * 2 - 2 * half);
      const sideDistance = Math.abs(Math.cos(theta));
      if (
        arms === "Open sides" &&
        t > 0.14 &&
        sideDistance < 0.76 * T.MathUtils.smoothstep(t, 0.14, 0.3) + 0.09 * t
      )
        continue;
      if (arms === "Armholes" && ((t - 0.55) / 0.16) ** 2 + (sideDistance / 0.17) ** 2 < 1)
        continue;
      const a = j * ring + i;
      const b = a + 1;
      const d = a + ring;
      const e = d + 1;
      indices.push(
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
      edge(a, d);
      edge(d, e);
      edge(e, b);
      edge(b, a);
    }
  for (const [a, b] of boundary.values()) indices.push(b, a, a + layer, b, a + layer, b + layer);
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}
