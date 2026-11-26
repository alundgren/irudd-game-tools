import { BufferGeometry, Float32BufferAttribute, MathUtils } from "three";
export const skirtOutline = [
  [0, 1],
  [0.2, 1.22],
  [0.6, 1.04],
  [1, 1.5],
];
export function validSkirtOutline(points) {
  return (
    Array.isArray(points) &&
    points.length >= 3 &&
    points.length <= 64 &&
    points.every(
      (p, i) =>
        Array.isArray(p) &&
        p.length === 2 &&
        p.every(Number.isFinite) &&
        p[1] >= 0.32 &&
        p[1] <= 4 &&
        (!i || p[0] > points[i - 1][0]),
    ) &&
    points[0][0] === 0 &&
    points[0][1] === 1 &&
    points.at(-1)[0] === 1
  );
}
export function traceSkirt(points) {
  if (points.length < 4)
    throw new Error(
      "Mark the waist centre, its edge and two or more points down to the hem.",
    );
  const [center, edge, ...rest] = points,
    dx = edge[0] - center[0],
    drop = rest.at(-1)[1] - edge[1];
  if (
    Math.abs(dx) < 2 ||
    drop <= 0 ||
    Math.abs(edge[1] - center[1]) > Math.abs(dx) * 0.3
  )
    throw new Error(
      "Mark the waist centre and edge at the same height, then work down one side.",
    );
  const outline = [
    [0, 1],
    ...rest.map(([x, y]) => [(y - edge[1]) / drop, (x - center[0]) / dx]),
  ];
  if (!validSkirtOutline(outline))
    throw new Error(
      "Follow one side downwards. Each width must be 32–400% of the waist radius.",
    );
  return outline;
}
export function skirtRadius(curve, t) {
  let b = 1;
  while (b < curve.length - 1 && curve[b][0] < t) b++;
  const a = b - 1,
    p = curve[a],
    q = curve[b],
    len = q[0] - p[0],
    s = MathUtils.clamp((t - p[0]) / len, 0, 1);
  const slope = (i) => {
    if (i === 0)
      return (curve[1][1] - curve[0][1]) / (curve[1][0] - curve[0][0]);
    if (i === curve.length - 1)
      return (curve[i][1] - curve[i - 1][1]) / (curve[i][0] - curve[i - 1][0]);
    const left =
        (curve[i][1] - curve[i - 1][1]) / (curve[i][0] - curve[i - 1][0]),
      right = (curve[i + 1][1] - curve[i][1]) / (curve[i + 1][0] - curve[i][0]);
    return left * right > 0 ? (2 * left * right) / (left + right) : 0;
  };
  return (
    (2 * s ** 3 - 3 * s * s + 1) * p[1] +
    (s ** 3 - 2 * s * s + s) * len * slope(a) +
    (-2 * s ** 3 + 3 * s * s) * q[1] +
    (s ** 3 - s * s) * len * slope(b)
  );
}
export function skirtGeometry(c) {
  const pleats = c.pleats ?? 0;
  const cols = Math.max(80, pleats * 8),
    rows = Math.max(68, 6 * c.folds, 8 * c.tiers),
    ring = cols + 1,
    layer = ring * (rows + 1),
    positions = [],
    uv = [],
    colors = [],
    index = [],
    relief = [];
  for (let side = 0; side < 2; side++)
    for (let j = 0; j <= rows; j++) {
      const t = j / rows,
        radius = skirtRadius(c.outline, t) * MathUtils.lerp(1, c.flare, t * t);
      for (let i = 0; i <= cols; i++) {
        const u = i / cols,
          theta = (u - 0.5) * Math.PI * 2,
          sa = Math.sin(theta),
          ca = Math.cos(theta);
        const lower = MathUtils.smoothstep(t, 0.58, 0.86);
        const field =
          t +
          c.bias * 0.23 * sa * (1 - 0.62 * lower) +
          0.045 * ca * ca * Math.sin(Math.PI * t);
        const wave = c.folds
          ? Math.sin(2 * Math.PI * c.folds * field + 0.35 * Math.sin(theta))
          : 0;
        const drape =
          c.gather *
          (0.24 + 0.76 * ca * ca) *
          (0.88 - 0.55 * lower) *
          (0.22 * (1 + wave) + 0.78 * Math.max(0, wave) ** 2) *
          MathUtils.smoothstep(t, 0, 0.1);
        const tierPhase = ((t - 0.64) / 0.36) * c.tiers;
        const phase = Math.max(0, tierPhase) % 1;
        const lip =
          MathUtils.smoothstep(phase, 0.06, 0.8) *
          (1 - MathUtils.smoothstep(phase, 0.8, 1));
        const tier =
          c.tiers && t > 0.64
            ? 0.1 * MathUtils.smoothstep(t, 0.64, 0.72) * lip
            : 0;
        const pleat = pleats
          ? (c.pleatDepth ?? 0.14) *
            MathUtils.smoothstep(t, 0, 0.42) *
            (0.5 +
              0.5 * Math.cos(pleats * theta + 0.48 * Math.sin(Math.PI * t))) **
              2
          : 0;
        const vertical = 0.022 * Math.cos(theta * 9 + 0.63 * t) * t * t;
        const rear = (1 - ca) * 0.5,
          tail = c.train * rear ** 3 * t ** 2;
        const thick = side * Math.min(0.004, c.width * 0.009);
        const rx =
          c.width * 0.5 * (radius + vertical + drape + tier + pleat) - thick;
        const rz =
          c.depth * 0.5 * (radius + vertical + drape + tier + pleat) - thick;
        positions.push(sa * rx, -c.drop * t + side * 0.0004, ca * rz - tail);
        relief.push(
          sa * c.width * 0.5 * (drape + tier + pleat),
          ca * c.depth * 0.5 * (drape + tier + pleat),
        );
        uv.push(u, 1 - t);
        const band =
          j === 0 ||
          j === rows ||
          (c.tiers && t > 0.64 && tierPhase % 1 > 0.84);
        const shade = side ? 0.74 : band ? 0.8 : 1;
        colors.push(shade, shade, shade);
      }
    }
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const a = j * ring + i,
        b = a + 1,
        d = a + ring,
        e = d + 1;
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
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(positions, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new Float32BufferAttribute(colors, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  const n = g.attributes.normal;
  for (let s = 0; s < 2; s++)
    for (let j = 0; j <= rows; j++) {
      const a = s * layer + j * ring,
        b = a + cols,
        x = n.getX(a) + n.getX(b),
        y = n.getY(a) + n.getY(b),
        z = n.getZ(a) + n.getZ(b),
        length = Math.hypot(x, y, z) || 1;
      for (const i of [a, b]) n.setXYZ(i, x / length, y / length, z / length);
    }
  g.skirtRelief = new Float32Array(relief);
  g.computeBoundingBox();
  return g;
}
