import type { Appearance, FaceSculpt } from "@irudd/document";
import * as T from "three";
import { landmarkRelief } from "./face.js";
import { deformFace } from "./sculpt.js";

export const builtinFaces = [
  { skin: "#ac785a", jaw: 1.03, nose: 1.08, brow: 1.1, cheek: 1 },
  { skin: "#ae7f5d", jaw: 1.14, nose: 1.09, brow: 0.91, cheek: 1.12 },
  { skin: "#956449", jaw: 0.98, nose: 0.92, brow: 0.91, cheek: 1.16 },
  { skin: "#c9997c", jaw: 0.91, nose: 0.86, brow: 0.94, cheek: 1.03 },
] as const;

export const faceCell = (appearance: Pick<Appearance, "face">): 0 | 1 | 2 | 3 => {
  const cell = appearance.face ?? 0;
  return cell === 1 || cell === 2 || cell === 3 ? cell : 0;
};

export const headContour: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 0.006, 0.066, -0.057],
  [0.025, 0.038, 0.084, -0.019],
  [0.085, 0.056, 0.093, 0.034],
  [0.16, 0.073, 0.092, 0.066],
  [0.24, 0.081, 0.091, 0.081],
  [0.34, 0.084, 0.09, 0.093],
  [0.47, 0.094, 0.089, 0.103],
  [0.58, 0.092, 0.088, 0.106],
  [0.68, 0.093, 0.093, 0.106],
  [0.75, 0.094, 0.094, 0.102],
  [0.84, 0.088, 0.09, 0.095],
  [0.92, 0.073, 0.076, 0.082],
  [0.97, 0.048, 0.052, 0.054],
  [1, 0, 0, 0],
];

const item = <V>(list: ArrayLike<V>, i: number): V => {
  const v = list[i];
  if (v === undefined) throw new Error("Head contour index out of range.");
  return v;
};

const latitude = (height: number) => Math.acos(1 - 2 * height);
const adultRear = [
  0.058, 0.019, -0.038, -0.075, -0.088, -0.098, -0.11, -0.119, -0.118, -0.112, -0.1, -0.081, -0.06,
  -0.021,
];
const profile: ReadonlyArray<readonly number[]> = headContour.map(([t, ...rest], i) => [
  latitude(t),
  ...rest,
  item(adultRear, i),
]);

function section(i: number, angle: number, axis: number): number {
  const a = item(profile, i);
  const b = item(profile, i + 1);
  const previous = item(profile, Math.max(0, i - 1));
  const next = item(profile, Math.min(profile.length - 1, i + 2));
  const span = item(b, 0) - item(a, 0);
  const t = (angle - item(a, 0)) / span;
  const m0 = (span * (item(b, axis) - item(previous, axis))) / (item(b, 0) - item(previous, 0));
  const m1 = (span * (item(next, axis) - item(a, axis))) / (item(next, 0) - item(a, 0));
  return (
    T.MathUtils.lerp(item(a, axis), item(b, axis), t * t * (3 - 2 * t)) +
    t * (1 - t) * ((1 - t) * m0 - t * m1)
  );
}

const bump = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) =>
  Math.exp(-(((x - cx) / rx) ** 2) - ((y - cy) / ry) ** 2);

export type FaceLook = Pick<Appearance, "face"> & { readonly sculpt?: FaceSculpt | undefined };

export function faceGeometry(look: FaceLook, adultProfile = false): T.BufferGeometry {
  const base = item(builtinFaces, faceCell(look));
  const traits: Record<"jaw" | "nose" | "brow" | "cheek", number> = {
    jaw: base.jaw,
    nose: base.nose,
    brow: base.brow,
    cheek: base.cheek,
  };
  for (const k of ["jaw", "nose", "brow", "cheek"] as const) traits[k] *= look.sculpt?.[k] ?? 1;
  const vertices: number[] = [];
  const uv: number[] = [];
  const indices: number[] = [];
  const columns = 128;
  const rows = 112;
  const landmarks = { eyes: 0.566, mouth: 0.245, nose: 0.403 };
  for (let i = 0; i <= rows; i++) {
    const latitudeAngle = (Math.PI * i) / rows;
    const t = (1 - Math.cos(latitudeAngle)) / 2;
    let k = 1;
    while (k < headContour.length - 1 && item(headContour, k)[0] < t) k++;
    const interp = (j: number) => section(k - 1, latitudeAngle, j);
    const posterior = adultProfile ? interp(4) : 0;
    const width = interp(1) * (1 + (traits.jaw - 1) * Math.exp(-(((t - 0.18) / 0.22) ** 2)));
    for (let j = 0; j <= columns; j++) {
      const angle = (j * Math.PI * 2) / columns - Math.PI;
      const sin = Math.sin(angle);
      const cos = Math.cos(angle);
      const x = width * sin;
      const mask = Math.exp(-(((t - 0.46) / 0.32) ** 4));
      let z =
        cos > 0
          ? interp(2) * T.MathUtils.lerp(cos, cos ** 0.67, mask)
          : interp(3) * cos * (1 + 0.18 * T.MathUtils.smoothstep(t, 0.24, 0.55));
      const chinOffset = 0.061 * (1 - T.MathUtils.smoothstep(t, 0, 0.15));
      z += chinOffset * (1 - Math.abs(cos));
      let jawLift =
        0.037 *
        ((1 - cos) / 2) *
        T.MathUtils.smoothstep(t, 0, 0.12) *
        (1 - T.MathUtils.smoothstep(t, 0.02, 0.35));
      if (cos > 0) {
        const eye = Math.abs(x);
        const nose =
          0.022 * bump(x, t, 0, 0.419, 0.017, 0.058) +
          0.011 * bump(eye, t, 0.017, 0.395, 0.01, 0.034) +
          0.02 * bump(x, t, 0, 0.51, 0.013, 0.139);
        const cheek =
          0.018 * bump(eye, t, 0.059, 0.464, 0.029, 0.089) -
          0.005 * bump(eye, t, 0.065, 0.32, 0.023, 0.092);
        const ridge = 0.013 * bump(eye, t, 0.038, 0.623 + (0.022 * eye) / 0.06, 0.033, 0.045);
        const socket = -0.01 * bump(eye, t, 0.037, 0.58, 0.03, 0.055);
        const globe = 0.009 * bump(eye, t, 0.04, 0.566, 0.018, 0.031);
        const muzzle = 0.008 * bump(x, t, 0, 0.258, 0.043, 0.09);
        const chin = 0.01 * bump(x, t, 0, 0.094, 0.037, 0.063);
        const underLip = -0.004 * bump(x, t, 0, 0.178, 0.028, 0.026);
        const lipCurve = 0.013 * Math.min(1, (x / 0.03) ** 2);
        const features =
          0.205 *
          landmarkRelief(x / 0.077, t - lipCurve, landmarks) *
          (1 - T.MathUtils.smoothstep(t, 0.47, 0.51));
        const philtrum = 0.0035 * bump(eye, t, 0.006, 0.317, 0.004, 0.041);
        const nostril = -0.005 * bump(eye, t, 0.013, 0.384, 0.005, 0.012);
        z +=
          (traits.nose * nose +
            traits.cheek * cheek +
            traits.brow * ridge +
            socket +
            globe +
            muzzle +
            chin +
            underLip +
            features +
            philtrum +
            nostril) *
          cos;
      }
      if (adultProfile) {
        const front = T.MathUtils.smoothstep(cos, -0.48, 0.84);
        const dome = T.MathUtils.smoothstep(t, 0.66, 0.99);
        const chin = 1 - T.MathUtils.smoothstep(t, 0.04, 0.27);
        z += front * (0.012 * (1 - dome) + 0.014 * chin) - 0.021 * dome;
        if (cos < 0) {
          const sideDepth =
            chinOffset + 0.012 * front * (1 - dome) + 0.014 * front * chin - 0.021 * dome;
          z = T.MathUtils.lerp(sideDepth, posterior, -cos);
        }
        const rear = (1 - cos) / 2;
        jawLift =
          0.024 *
          T.MathUtils.smoothstep(rear, 0.23, 0.96) *
          T.MathUtils.smoothstep(t, 0, 0.11) *
          (1 - T.MathUtils.smoothstep(t, 0.13, 0.38));
      }
      vertices.push(x, 1.466 + t * 0.294 + jawLift, z);
      uv.push(j / columns, t);
      if (i < rows && j < columns) {
        const v = i * (columns + 1) + j;
        indices.push(v, v + 1, v + columns + 1, v + 1, v + columns + 2, v + columns + 1);
      }
    }
  }
  for (let j = 1; j < columns - 1; j++) indices.push(0, j + 1, j);
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.Float32BufferAttribute(vertices, 3));
  geo.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  deformFace(geo, look.sculpt, 0, false);
  return geo;
}

export function shapeNeck(geometry: T.BufferGeometry): T.BufferGeometry {
  const pos = geometry.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const t = T.MathUtils.clamp((y - 1.364) / 0.2, 0, 1);
    const front = T.MathUtils.smoothstep(z, -0.04, 0.03);
    const muscle =
      0.006 *
      Math.exp(-(((Math.abs(x) - (0.014 + 0.039 * t)) / 0.01) ** 2)) *
      Math.sin(Math.PI * t) *
      front;
    const throat = 0.004 * Math.exp(-((x / 0.018) ** 2) - ((t - 0.54) / 0.14) ** 2) * front;
    const lean = 0.044 * (t - 0.65);
    pos.setXYZ(
      i,
      x + Math.sign(x) * muscle * 0.6,
      y + 0.013 * (1 - front) * Math.sin(Math.PI * t),
      z + lean + muscle + throat,
    );
  }
  geometry.computeVertexNormals();
  return geometry;
}

export function earGeometry(side: number): T.BufferGeometry {
  const g = new T.SphereGeometry(1, 48, 36);
  const pos = g.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const radius = Math.hypot(y, z);
    const outer = T.MathUtils.smoothstep(y, -0.76, -0.23);
    const folded =
      T.MathUtils.smoothstep(z, 0.36, 0.85) * (1 - T.MathUtils.smoothstep(y, 0.12, 0.65));
    const rim = 0.0065 * outer * (1 - 0.83 * folded) * Math.exp(-(((radius - 0.78) / 0.16) ** 2));
    const inner = 0.005 * bump(z, y, -0.26 + 0.22 * y, 0.12, 0.22, 0.55);
    const tragus = 0.006 * bump(z, y, 0.49, -0.13, 0.21, 0.25);
    const bowl = 0.005 * bump(z, y, 0.09, -0.04, 0.36, 0.4);
    const relief = T.MathUtils.smoothstep(side * x, 0, 0.42) * (rim + inner + tragus - bowl);
    pos.setXYZ(
      i,
      x * 0.015 + side * (relief + 0.0035 * y - 0.004 * z),
      y * 0.035,
      z * (0.021 + 0.005 * y) - 0.008 * y,
    );
  }
  g.computeVertexNormals();
  return g;
}

export function shadeNape(face: T.Mesh, neck: T.Mesh): void {
  face.updateWorldMatrix(true, false);
  neck.updateWorldMatrix(true, false);
  const toFace = face.matrixWorld.clone().invert();
  const point = new T.Vector3();
  const normal = new T.Vector3();
  const tangent = new T.Vector3();
  for (const mesh of [neck, face]) {
    const transform = new T.Matrix4().multiplyMatrices(toFace, mesh.matrixWorld);
    const toMesh = new T.Matrix3().getNormalMatrix(transform).invert();
    const position = mesh.geometry.getAttribute("position");
    const normals = mesh.geometry.getAttribute("normal");
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(transform);
      const t = (point.y - 1.466) / 0.294;
      const influence =
        T.MathUtils.smoothstep(t, -0.16, 0.05) *
        (1 - T.MathUtils.smoothstep(t, 0.33, 0.54)) *
        (1 - T.MathUtils.smoothstep(point.z, -0.014, 0.045));
      if (influence <= 0) continue;
      tangent
        .set(point.x, -0.01, 0.92 * (point.z + 0.009))
        .normalize()
        .applyNormalMatrix(toMesh);
      normal
        .fromBufferAttribute(normals, i)
        .lerp(tangent, 0.92 * influence)
        .normalize();
      normals.setXYZ(i, normal.x, normal.y, normal.z);
    }
    normals.needsUpdate = true;
  }
}
