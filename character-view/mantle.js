import { BufferGeometry, Float32BufferAttribute, MathUtils } from "three";

import { skirtGeometry, validSkirtOutline } from "./skirt-pattern.js";
export const garmentCuts = ["Cape", "Poncho", "Tabard", "Skirt"];
export const armAccessOptions = ["Covered", "Open sides", "Armholes"];
export function armAccess(c) {
  return (
    c.armAccess ??
    { Cape: "Covered", Tabard: "Open sides", Poncho: "Armholes" }[c.kind]
  );
}
export function validCut(c) {
  return (
    c &&
    garmentCuts.includes(c.kind) &&
    (c.kind === "Skirt" || armAccessOptions.includes(armAccess(c))) &&
    ["width", "depth", "drop"].every(
      (k) => Number.isFinite(c[k]) && c[k] >= 0.025 && c[k] <= 8,
    ) &&
    Number.isFinite(c.flare) &&
    c.flare >= 0.65 &&
    c.flare <= 2.2 &&
    (c.kind === "Skirt"
      ? validSkirtOutline(c.outline) &&
        Number.isFinite(c.bias) &&
        Math.abs(c.bias) <= 1 &&
        Number.isFinite(c.gather) &&
        c.gather >= 0 &&
        c.gather <= 0.3 &&
        Number.isFinite(c.train) &&
        c.train >= 0 &&
        c.train <= 2 &&
        Number.isInteger(c.tiers) &&
        c.tiers >= 0 &&
        c.tiers <= 6
      : Number.isFinite(c.opening) && c.opening >= 2 && c.opening <= 150) &&
    Number.isInteger(c.folds) &&
    c.folds >= 0 &&
    c.folds <= 24
  );
}
// A single fabric panel wraps an open neckline. Two surfaces share sewn
// boundaries around the hem, front opening and armholes.
export function mantleGeometry(c) {
  if (c.kind === "Skirt") return skirtGeometry(c);
  const arms = armAccess(c);
  const columns = 96,
    rows = 34,
    ring = columns + 1,
    layer = ring * (rows + 1),
    positions = [],
    uv = [],
    colors = [],
    indices = [],
    boundary = new Map();
  function edge(a, b) {
    const key = Math.min(a, b) * layer + Math.max(a, b);
    if (boundary.has(key)) boundary.delete(key);
    else boundary.set(key, [a, b]);
  }
  for (let side = 0; side < 2; side++)
    for (let j = 0; j <= rows; j++)
      for (let i = 0; i <= columns; i++) {
        const u = i / columns,
          t = j / rows,
          q = ((c.opening * Math.PI) / 180) * (0.56 + 0.44 * t),
          theta = q / 2 + u * (Math.PI * 2 - q);
        const sa = Math.sin(theta),
          ca = Math.cos(theta),
          shoulder = MathUtils.smoothstep(t, 0, 0.29),
          hang = Math.max(0, (t - 0.23) / 0.77);
        const fold = c.folds
          ? Math.sin(
              c.folds * theta + 0.55 * hang + 0.27 * Math.sin(3 * theta),
            ) *
            (0.007 + 0.043 * hang)
          : 0;
        const rx =
            c.width * (0.205 + 0.375 * shoulder + 0.2 * c.flare * hang + fold),
          rz = c.depth * (0.27 + 0.3 * shoulder + 0.3 * c.flare * hang + fold);
        const thickness =
          side * Math.min(0.0055, 0.012 * Math.min(c.width, c.depth));
        const frontFall =
          c.kind === "Cape" ? 1 - 0.37 * Math.max(0, ca) ** 2 : 1;
        const fall = c.drop * (t * 0.22 + Math.pow(t, 1.55) * 0.78) * frontFall;
        const hem = c.drop * 0.018 * Math.sin(3 * theta + 0.2) * t * t;
        positions.push(
          sa * (rx - thickness),
          -fall + hem + side * 0.0007,
          ca * (rz - thickness),
        );
        uv.push(u, 1 - t);
        const trim = j <= 1 || j >= rows - 1 || i <= 1 || i >= columns - 1;
        colors.push(
          ...(trim
            ? [0.49, 0.49, 0.49]
            : side
              ? [0.72, 0.72, 0.72]
              : [1, 1, 1]),
        );
      }
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < columns; i++) {
      const u = (i + 0.5) / columns,
        t = (j + 0.5) / rows,
        half = ((c.opening * Math.PI) / 360) * (0.56 + 0.44 * t);
      const theta = half + u * (Math.PI * 2 - 2 * half),
        sideDistance = Math.abs(Math.cos(theta));
      if (
        arms === "Open sides" &&
        t > 0.14 &&
        sideDistance < 0.76 * MathUtils.smoothstep(t, 0.14, 0.3) + 0.09 * t
      )
        continue;
      if (
        arms === "Armholes" &&
        ((t - 0.55) / 0.16) ** 2 + (sideDistance / 0.17) ** 2 < 1
      )
        continue;
      const a = j * ring + i,
        b = a + 1,
        d = a + ring,
        e = d + 1;
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
  for (const [a, b] of boundary.values())
    indices.push(b, a, a + layer, b, a + layer, b + layer);
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(positions, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}
