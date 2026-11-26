import * as T from "three";
import type { Knot } from "@irudd/document";

const component = (knot: Knot | undefined, k: 3 | 4): number => knot?.[k] ?? 0;

function radiusAt(knots: ReadonlyArray<Knot>, left: number, t: number, k: 3 | 4): number {
  const a = component(knots[left], k);
  const b = component(knots[left + 1], k);
  const delta = b - a;
  const slope = (u: number, v: number) => (u * v <= 0 ? 0 : (2 * u * v) / (u + v));
  const da = left ? slope(a - component(knots[left - 1], k), delta) : delta;
  const db = left + 2 < knots.length ? slope(delta, component(knots[left + 2], k) - b) : delta;
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * a + (t3 - 2 * t2 + t) * da + (-2 * t3 + 3 * t2) * b + (t3 - t2) * db
  );
}

export interface SweepRing {
  readonly center: T.Vector3;
  readonly along: T.Vector3;
  readonly u: T.Vector3;
  readonly v: T.Vector3;
  readonly w: number;
  readonly d: number;
}

export function sweepRings(knots: ReadonlyArray<Knot>, horizontal = false): SweepRing[] {
  const centers = knots.map(([x, y, z]) => new T.Vector3(x, y, z));
  const path = new T.CatmullRomCurve3(centers, false, "centripetal");
  const bands = (knots.length - 1) * 5;
  const rings: SweepRing[] = [];
  let lastAxis: T.Vector3 | undefined;
  for (let row = 0; row <= bands; row++) {
    const t = row / bands;
    const center = path.getPoint(t);
    const along = horizontal ? new T.Vector3(0, 1, 0) : path.getTangent(t).normalize();
    lastAxis ??= Math.abs(along.x) < 0.85 ? new T.Vector3(1, 0, 0) : new T.Vector3(0, 0, 1);
    const u = lastAxis.clone().addScaledVector(along, -lastAxis.dot(along)).normalize();
    const v = new T.Vector3().crossVectors(along, u).normalize();
    lastAxis = u;
    const at = t * (knots.length - 1);
    const left = Math.min(knots.length - 2, Math.floor(at));
    const mix = at - left;
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

export type FootSection = "sole" | "bare" | "upper";

function sectionRadius(value: number, exponent: number): number {
  return exponent === 1 ? value : Math.sign(value) * Math.abs(value) ** exponent;
}

export function sweepGeometry(
  knots: ReadonlyArray<Knot>,
  horizontal = false,
  sides = 20,
  footSection?: FootSection,
): T.BufferGeometry {
  const rings = sweepRings(knots, horizontal);
  const bands = rings.length - 1;
  const points: number[] = [];
  const uv: number[] = [];
  const indices: number[] = [];
  const section = Array.from({ length: sides + 1 }, (_, i): readonly [number, number] => {
    const angle = (i / sides) * Math.PI * 2;
    const x = Math.cos(angle);
    const y = Math.sin(angle);
    if (footSection === "sole") return [sectionRadius(x, 0.56), sectionRadius(y, 0.42)];
    if (footSection && y < 0) return [x, sectionRadius(y, 0.65)];
    return [x, y];
  });
  rings.forEach(({ center, u, v, w, d }, row) => {
    const t = row / bands;
    section.forEach(([x, y], k) => {
      const pt = center
        .clone()
        .addScaledVector(u, w * x)
        .addScaledVector(v, d * y);
      points.push(pt.x, pt.y, pt.z);
      uv.push(k / sides, t);
      if (row < bands && k < sides) {
        const a = row * (sides + 1) + k;
        const b = a + sides + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    });
  });
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
  const normals = geometry.getAttribute("normal");
  for (let row = 0; row <= bands; row++) {
    const a = row * (sides + 1);
    const b = a + sides;
    const normal = new T.Vector3()
      .fromBufferAttribute(normals, a)
      .add(new T.Vector3().fromBufferAttribute(normals, b))
      .normalize();
    normals.setXYZ(a, normal.x, normal.y, normal.z);
    normals.setXYZ(b, normal.x, normal.y, normal.z);
  }
  return geometry;
}
