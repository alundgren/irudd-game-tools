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
// Jointed limbs need a few firm cross-sections. Plated axial sweeps also
// need six points along every ring so socket retention cannot erase the tip.
export function retainSweepSections(
  geometry,
  bands,
  sides,
  platedAxis = false,
) {
  const pins = new Uint8Array(geometry.attributes.position.count);
  const limbSections = [0, 0.1, 0.24, 0.42, 0.61, 0.79, 0.93, 1];
  const rings = platedAxis
    ? Array.from({ length: bands + 1 }, (_, i) => i)
    : limbSections.map((t) => Math.round(t * bands));
  const around = platedAxis ? 6 : 12;
  for (const ring of rings) {
    const start = ring * (sides + 1);
    for (let i = 0; i <= around; i++)
      pins[start + Math.round((i * sides) / around)] = 1;
  }
  geometry.setAttribute("lodAnchor", new T.BufferAttribute(pins, 1));
}

// A flatter ground-contact cross section leaves a distinct heel and toe box.
function sectionRadius(value, exponent) {
  return exponent === 1
    ? value
    : Math.sign(value) * Math.abs(value) ** exponent;
}
// The rings of a sweep from its first knot to its last: the centre of each,
// the two axes of its cross-section with their radii, and the direction of
// the path there.
export function sweepRings(knots, horizontal = false) {
  const centers = knots.map(([x, y, z]) => new T.Vector3(x, y, z));
  const path = new T.CatmullRomCurve3(centers, false, "centripetal");
  const bands = (knots.length - 1) * 5,
    rings = [];
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
    rings.push({
      center,
      along,
      u,
      v,
      w: radiusAt(knots, left, mix, 3),
      d: radiusAt(knots, left, mix, 4),
    });
  }
  return rings;
}
export function sweepGeometry(
  knots,
  horizontal = false,
  sides = 20,
  footSection,
) {
  const rings = sweepRings(knots, horizontal),
    bands = rings.length - 1;
  const points = [],
    uv = [],
    indices = [];
  const section = Array.from({ length: sides + 1 }, (_, i) => {
    const angle = (i / sides) * Math.PI * 2;
    const x = Math.cos(angle),
      y = Math.sin(angle);
    if (footSection === "sole")
      return [sectionRadius(x, 0.56), sectionRadius(y, 0.42)];
    if (footSection && y < 0) return [x, sectionRadius(y, 0.65)];
    return [x, y];
  });
  for (let row = 0; row <= bands; row++) {
    const t = row / bands,
      { center, u, v, w, d } = rings[row];
    for (let k = 0; k <= sides; k++) {
      const [x, y] = section[k];
      const pt = center
        .clone()
        .addScaledVector(u, w * x)
        .addScaledVector(v, d * y);
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
