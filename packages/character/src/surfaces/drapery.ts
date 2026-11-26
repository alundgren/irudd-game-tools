import type { Knot, FigureDrape } from "@irudd/document";
import { BufferGeometry, Float32BufferAttribute, MathUtils, Vector3 } from "three";

export function pleat(
  geometry: BufferGeometry,
  knots: readonly Knot[],
  { folds, depth, twist }: FigureDrape,
) {
  const pos = geometry.getAttribute("position"),
    uv = geometry.getAttribute("uv");
  for (let i = 0; i < pos.count; i++) {
    const t = uv.getY(i),
      angle = uv.getX(i) * 2 * Math.PI;
    const f = t * (knots.length - 1),
      row = Math.min(knots.length - 2, Math.floor(f));
    const a = knots[row],
      b = knots[row + 1];
    if (!a || !b) continue;
    const cx = MathUtils.lerp(a[0], b[0], f - row);
    const cz = MathUtils.lerp(a[2], b[2], f - row);
    const weight = (1 - t) ** 0.65;
    const wave =
      Math.cos(folds * (angle + twist * t * 0.45)) + 0.23 * Math.cos((folds + 1) * angle + 0.5);
    const scale = 1 + depth * weight * wave;
    pos.setXYZ(
      i,
      cx + (pos.getX(i) - cx) * scale,
      pos.getY(i) + 0.008 * weight * Math.cos(folds * angle),
      cz + (pos.getZ(i) - cz) * scale,
    );
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}

export function splitHem(
  source: BufferGeometry,
  knots: readonly Knot[],
  { slit, slitHeight }: FigureDrape,
) {
  if (!slit) return source;
  const original = source.getAttribute("position");
  const bands = (knots.length - 1) * 5,
    sides = original.count / (bands + 1) - 1;
  const positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [],
    centers: Vector3[] = [];
  const sample = new Vector3(),
    other = new Vector3();
  for (let row = 0; row <= bands; row++) {
    const center = new Vector3();
    for (let i = 0; i < sides; i++)
      center.add(sample.fromBufferAttribute(original, row * (sides + 1) + i));
    centers.push(center.divideScalar(sides));
  }
  for (const [start, end] of [
    [0, 0.25],
    [0.25, 0.75],
    [0.75, 1],
  ] as const) {
    const steps = Math.max(4, Math.round((end - start) * sides)),
      stride = steps + 1;
    const base = positions.length / 3,
      layer = (bands + 1) * stride;
    for (let surface = 0; surface < 2; surface++)
      for (let row = 0; row <= bands; row++) {
        const t = row / bands,
          gap = slit * 0.5 * (1 - MathUtils.smoothstep(t, 0, slitHeight));
        const left = start + (start > 0 ? gap : 0),
          right = end - (end < 1 ? gap : 0);
        for (let col = 0; col <= steps; col++) {
          const u = MathUtils.lerp(left, right, col / steps),
            f = u * sides,
            ix = Math.min(sides - 1, Math.floor(f)),
            point = row * (sides + 1) + ix;
          sample
            .fromBufferAttribute(original, point)
            .lerp(other.fromBufferAttribute(original, point + 1), f - ix);
          if (surface) sample.lerp(centers[row] ?? sample, 0.035);
          positions.push(...sample.toArray());
          uv.push(u, t);
        }
      }
    function quad(a: number, b: number, c: number, d: number) {
      indices.push(a, b, c, b, d, c);
    }
    for (let row = 0; row < bands; row++)
      for (let col = 0; col < steps; col++) {
        const a = base + row * stride + col,
          b = a + 1,
          c = a + stride,
          d = c + 1;
        quad(a, b, c, d);
        quad(a + layer, c + layer, b + layer, d + layer);
        if (row === 0) quad(a, a + layer, b, b + layer);
        if (row === bands - 1) quad(c, d, c + layer, d + layer);
        if (row / bands < slitHeight) {
          if (col === 0 && start > 0) quad(a, c, a + layer, c + layer);
          if (col === steps - 1 && end < 1) quad(b, b + layer, d, d + layer);
        }
      }
  }
  const result = new BufferGeometry();
  result.setAttribute("position", new Float32BufferAttribute(positions, 3));
  result.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  result.setIndex(indices);
  result.computeVertexNormals();
  result.computeBoundingBox();
  source.dispose();
  return result;
}
