import { BufferGeometry, Color, Float32BufferAttribute, Vector3 } from "three";
import { sweepRings } from "./sweep.js";
import type { FigureCage, FigureSweep, Knot } from "@irudd/document";
import { MeshStandardMaterial, type Material, type Mesh } from "three";

export function suctionCups(
  knots: readonly Knot[],
  rows: number,
  colour: string,
  pale: string,
  game: boolean,
) {
  const rings = sweepRings(knots);
  const first = rings[0],
    oral = new Vector3(0, -0.78, 0.62);
  if (!first) throw new Error("Missing suction cup root.");
  const angle = Math.atan2(oral.dot(first.v), oral.dot(first.u));
  const skin = new Color(colour),
    rim = skin.clone().lerp(new Color(pale), 0.48);
  const hollow = skin.clone().multiplyScalar(0.43);
  const position: number[] = [],
    colors: number[] = [],
    indices: number[] = [],
    sides = game ? 8 : 12;
  const armLength = rings
    .slice(1)
    .reduce((sum, ring, i) => sum + ring.center.distanceTo(rings[i]?.center ?? ring.center), 0);
  const spacing = armLength / (game ? 16 : 24);
  for (let row = 0; row < rows; row++) {
    let previous: Vector3 | undefined;
    for (let j = 4 + row; j < rings.length - 1; j++) {
      const ring = rings[j];
      if (!ring) continue;
      const radius = Math.min(ring.w, ring.d);
      if (previous && previous.distanceTo(ring.center) < Math.max(spacing, radius * 0.98)) continue;
      previous = ring.center;
      const a = angle + (rows === 1 ? 0 : row === 0 ? -0.49 : 0.49);
      const normal = ring.u
        .clone()
        .multiplyScalar(Math.cos(a) / ring.w)
        .addScaledVector(ring.v, Math.sin(a) / ring.d)
        .normalize();
      const sideways = new Vector3().crossVectors(normal, ring.along).normalize();
      const root = ring.center
        .clone()
        .addScaledVector(ring.u, Math.cos(a) * ring.w)
        .addScaledVector(ring.v, Math.sin(a) * ring.d);
      const size = radius * (rows === 1 ? 0.56 : 0.44),
        start = position.length / 3;
      const profile = [
        [0.72, -0.4, skin],
        [1, 0.12, rim],
        [0.83, 0.39, rim],
        [0.53, 0.15, hollow],
      ] as const;
      for (const [r, h, color] of profile)
        for (let i = 0; i < sides; i++) {
          const t = (i * 2 * Math.PI) / sides;
          const p = root
            .clone()
            .addScaledVector(normal, size * h)
            .addScaledVector(ring.along, size * r * Math.cos(t) * 1.08)
            .addScaledVector(sideways, size * r * Math.sin(t));
          position.push(p.x, p.y, p.z);
          colors.push(color.r, color.g, color.b);
        }
      const centre = root.clone().addScaledVector(normal, 0.035 * size);
      const cap = position.length / 3;
      position.push(centre.x, centre.y, centre.z);
      colors.push(hollow.r, hollow.g, hollow.b);
      for (let i = 0; i < sides; i++) {
        const next = (i + 1) % sides;
        for (let k = 0; k < profile.length - 1; k++) {
          const lo = start + k * sides,
            hi = lo + sides;
          indices.push(lo + i, lo + next, hi + next, lo + i, hi + next, hi + i);
        }
        const lip = start + (profile.length - 1) * sides;
        indices.push(lip + i, lip + next, cap);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(position, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function applyRadialFit(
  geometry: BufferGeometry,
  fit: NonNullable<FigureSweep["radialFit"]>,
) {
  const pos = geometry.getAttribute("position"),
    { rows, step, bottom } = fit;
  const count = rows[0]?.length ?? 0;
  for (let i = 0; i < pos.count; i++) {
    const h = (pos.getY(i) - bottom) / step,
      level = Math.floor(h);
    if (level < 0 || level >= rows.length - 1) continue;
    const x = pos.getX(i),
      z = pos.getZ(i),
      radius = Math.hypot(x, z);
    if (radius < 0.001) continue;
    const u = ((Math.atan2(x, z) / (2 * Math.PI) + 1) % 1) * count;
    const a = Math.floor(u),
      b = (a + 1) % count,
      f = u - a;
    const low = (rows[level]?.[a] ?? 0) * (1 - f) + (rows[level]?.[b] ?? 0) * f;
    const high = (rows[level + 1]?.[a] ?? 0) * (1 - f) + (rows[level + 1]?.[b] ?? 0) * f;
    const delta = low + (high - low) * (h - level);
    const scale = Math.max(0.001, radius + delta) / radius;
    pos.setXYZ(i, x * scale, pos.getY(i), z * scale);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

export function finishEar(
  mesh: Mesh<BufferGeometry, Material>,
  cage: FigureCage,
  faces: readonly number[] | undefined,
  color: string,
) {
  const g = mesh.geometry,
    index = g.index;
  if (!faces || !index || !(mesh.material instanceof MeshStandardMaterial)) return;
  const count = g.getAttribute("position").count,
    weights = new Float32Array(count),
    visits = new Uint16Array(count);
  const shades = [0, 0, 0.04, 0.17, 0.37, 0.68, 0.77, 0.87, 0.9];
  const base = new Color(color),
    lining = base.clone().lerp(new Color("#b97c76"), 0.38).multiplyScalar(0.75);
  for (const [face, which] of faces.entries()) {
    const control = cage.faces[which];
    if (!control) continue;
    const ring = Math.min(shades.length - 1, Math.floor(Math.min(...control) / 16));
    for (let j = 0; j < 3; j++) {
      const v = index.getX(3 * face + j);
      weights[v] = (weights[v] ?? 0) + (shades[ring] ?? 0);
      visits[v] = (visits[v] ?? 0) + 1;
    }
  }
  const tint = new Color(),
    colors = new Float32Array(count * 3);
  for (let v = 0; v < count; v++)
    tint
      .copy(base)
      .lerp(lining, (weights[v] ?? 0) / Math.max(1, visits[v] ?? 0))
      .toArray(colors, 3 * v);
  g.setAttribute("color", new Float32BufferAttribute(colors, 3));
  const material = mesh.material.clone();
  material.color.set(0xffffff);
  material.vertexColors = true;
  mesh.material = material;
}
