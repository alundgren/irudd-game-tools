import * as T from "three";

// Editable cross sections follow a centreline. Parallel-transported frames
// keep fins slender and limbs round even as the spine bends around a corner.
// Monotone cubic interpolation keeps section radii positive and gives adjacent
// bands the same tangent. Linear radii create false rings on cheeks and sleeves.
function radiusAt(knots, left, t, k) {
  const a = knots[left][k],
    b = knots[left + 1][k],
    delta = b - a;
  const slope = (u, v) => (u * v <= 0 ? 0 : (2 * u * v) / (u + v));
  const da = left ? slope(a - knots[left - 1][k], delta) : delta;
  const db =
    left + 2 < knots.length ? slope(delta, knots[left + 2][k] - b) : delta;
  const t2 = t * t,
    t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * a +
    (t3 - 2 * t2 + t) * da +
    (-2 * t3 + 3 * t2) * b +
    (t3 - t2) * db
  );
}
// Keep a sparse set of full cross-sections when a jointed limb is reduced.
export function retainSweepSections(geometry, bands, sides) {
  const pins = new Uint8Array(geometry.attributes.position.count);
  for (const t of [0, 0.1, 0.24, 0.42, 0.61, 0.79, 0.93, 1]) {
    const start = Math.round(t * bands) * (sides + 1);
    for (let i = 0; i <= 12; i++)
      pins[start + Math.round((i * sides) / 12)] = 1;
  }
  geometry.setAttribute("lodAnchor", new T.BufferAttribute(pins, 1));
}

export function sweepGeometry(knots, horizontal = false, sides = 20) {
  const centers = knots.map(([x, y, z]) => new T.Vector3(x, y, z));
  const path = new T.CatmullRomCurve3(centers, false, "centripetal");
  const bands = (knots.length - 1) * 5;
  const points = [],
    uv = [],
    indices = [];
  let lastAxis;
  for (let row = 0; row <= bands; row++) {
    const t = row / bands,
      center = path.getPoint(t),
      along = horizontal
        ? new T.Vector3(0, 1, 0)
        : path.getTangent(t).normalize();
    if (!lastAxis)
      lastAxis =
        Math.abs(along.x) < 0.85
          ? new T.Vector3(1, 0, 0)
          : new T.Vector3(0, 0, 1);
    const u = lastAxis
      .clone()
      .addScaledVector(along, -lastAxis.dot(along))
      .normalize();
    const v = new T.Vector3().crossVectors(along, u).normalize();
    lastAxis = u;
    const at = t * (knots.length - 1),
      left = Math.min(knots.length - 2, Math.floor(at)),
      mix = at - left;
    const w = radiusAt(knots, left, mix, 3);
    const d = radiusAt(knots, left, mix, 4);
    for (let k = 0; k <= sides; k++) {
      const phi = (k / sides) * Math.PI * 2;
      const pt = center
        .clone()
        .addScaledVector(u, w * Math.cos(phi))
        .addScaledVector(v, d * Math.sin(phi));
      points.push(pt.x, pt.y, pt.z);
      uv.push(k / sides, t);
      if (row < bands && k < sides) {
        const a = row * (sides + 1) + k,
          b = a + sides + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  for (let k = 1; k < sides - 1; k++) {
    indices.push(0, k + 1, k);
    const end = bands * (sides + 1);
    indices.push(end, end + k, end + k + 1);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(points, 3));
  geometry.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // Average duplicate normals at the longitude seam.
  const normals = geometry.getAttribute("normal");
  for (let row = 0; row <= bands; row++) {
    const a = row * (sides + 1),
      b = a + sides;
    const normal = new T.Vector3()
      .fromBufferAttribute(normals, a)
      .add(new T.Vector3().fromBufferAttribute(normals, b))
      .normalize();
    normals.setXYZ(a, normal.x, normal.y, normal.z);
    normals.setXYZ(b, normal.x, normal.y, normal.z);
  }
  return geometry;
}
