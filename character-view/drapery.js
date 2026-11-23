import { MathUtils } from "three";

export function pleat(
  geometry,
  knots,
  { folds = 12, depth = 0.09, twist = 0.25 },
) {
  const pos = geometry.attributes.position,
    uv = geometry.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const t = uv.getY(i),
      angle = uv.getX(i) * 2 * Math.PI;
    const f = t * (knots.length - 1),
      row = Math.min(knots.length - 2, Math.floor(f));
    const cx = MathUtils.lerp(knots[row][0], knots[row + 1][0], f - row);
    const cz = MathUtils.lerp(knots[row][2], knots[row + 1][2], f - row);
    const weight = (1 - t) ** 0.65;
    const wave =
      Math.cos(folds * (angle + twist * t * 0.45)) +
      0.23 * Math.cos((folds + 1) * angle + 0.5);
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
