import { applyPortraitDepth } from "./portrait-depth.js";
import { headSpace } from "./portrait-frame.js";
import { profileCorrection, landmarkRelief } from "./portrait-relief.js";
import { MathUtils, Vector3 } from "three";

export const facialAxes = [
  "jaw",
  "nose",
  "brow",
  "cheek",
  "eyes",
  "eye size",
  "mouth",
  "lips",
  "chin",
  "smile",
];
export const isFace = (p) => p?.shape === "head" || p?.anatomy === "face";
const bell = (x, y, cx, cy, rx, ry) =>
  Math.exp(-(((x - cx) / rx) ** 2) - ((y - cy) / ry) ** 2);

export function deformFace(
  geometry,
  sculpt = {},
  chinFraction = 0,
  includeStructure = true,
) {
  if (!Object.values(sculpt).some((v) => v !== 1)) return geometry;
  geometry.computeBoundingBox();
  const box = geometry.boundingBox,
    span = box.getSize(new Vector3()),
    center = box.getCenter(new Vector3());
  const half = span.x * 0.5,
    height = span.y * (1 - chinFraction),
    chin = box.min.y + span.y * chinFraction;
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i),
      py = pos.getY(i),
      pz = pos.getZ(i);
    const x = (px - center.x) / half,
      y = (py - chin) / height,
      side = Math.sign(x),
      ax = Math.abs(x);
    const front = MathUtils.smoothstep(
      (pz - center.z) / Math.max(span.z * 0.5, 0.001),
      0.04,
      0.7,
    );
    const eye = bell(ax, y, 0.385, 0.56, 0.265, 0.1) * front;
    const lid = bell(ax, y, 0.385, 0.56, 0.19, 0.075) * front;
    const lip = bell(x, y, 0, 0.245, 0.43, 0.085) * front;
    const corner = bell(ax, y, 0.245, 0.245, 0.14, 0.068) * front;
    const lower = bell(x, y, 0, 0.085, 0.75, 0.13);
    let dx =
      side * 0.26 * ((sculpt.eyes ?? 1) - 1) * eye +
      (x - side * 0.385) * 0.65 * ((sculpt["eye size"] ?? 1) - 1) * lid;
    let dy = (y - 0.56) * 0.95 * ((sculpt["eye size"] ?? 1) - 1) * lid;
    dx += x * 0.9 * ((sculpt.mouth ?? 1) - 1) * lip;
    dy +=
      (y - 0.245) * 0.95 * ((sculpt.lips ?? 1) - 1) * lip +
      0.094 * ((sculpt.smile ?? 1) - 1) * corner;
    dy -= 0.14 * ((sculpt.chin ?? 1) - 1) * lower;
    let dz =
      0.065 * ((sculpt.lips ?? 1) - 1) * lip +
      0.08 * ((sculpt.chin ?? 1) - 1) * lower * front;
    if (includeStructure) {
      dx +=
        x *
        0.44 *
        ((sculpt.jaw ?? 1) - 1) *
        bell(ax, y, 0.55, 0.19, 0.53, 0.21);
      dz +=
        0.3 *
        ((sculpt.nose ?? 1) - 1) *
        bell(x, y, 0, 0.43, 0.22, 0.11) *
        front;
      dy +=
        0.068 *
        ((sculpt.brow ?? 1) - 1) *
        bell(ax, y, 0.37, 0.66, 0.33, 0.08) *
        front;
      dz +=
        0.1 *
        ((sculpt.brow ?? 1) - 1) *
        bell(ax, y, 0.37, 0.66, 0.33, 0.08) *
        front;
      dx +=
        side *
        0.13 *
        ((sculpt.cheek ?? 1) - 1) *
        bell(ax, y, 0.57, 0.41, 0.32, 0.15) *
        front;
    }
    pos.setXYZ(i, px + dx * half, py + dy * height, pz + dz * span.z * 0.5);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function portraitSurface(geometry, binding) {
  const paint = headSpace(binding);
  const face = paint?.portrait;
  if (!face) return geometry;
  const pos = geometry.attributes.position;
  const v = new Vector3(),
    h = paint.height;
  const correction = profileCorrection(paint, geometry);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const y = (v.y + paint.offset[1]) / h;
    const ax = ((v.x + paint.offset[0]) / h - face.center) / face.width;
    const x = Math.abs(ax),
      phi = geometry.attributes.uv.getX(i) * 2 * Math.PI;
    const front = MathUtils.smoothstep(-Math.sin(phi), 0.06, 0.68);
    const central = 1 - MathUtils.smoothstep(x, 0.78, 1.28);
    const noseBand = Math.exp(-(((y - face.nose) / 0.086) ** 2));
    const bridge = Math.exp(-(((y - (face.nose + 0.084)) / 0.126) ** 2));
    const tip = 1 - Math.exp(-((ax / 0.22) ** 2)),
      nasal = 1 - Math.exp(-((ax / 0.13) ** 2));
    const sockets = bell(x, y, 0.44, face.eyes, 0.255, 0.059);
    const brow = bell(x, y, 0.46, face.eyes + 0.058, 0.34, 0.043);
    const cheek = bell(x, y, 0.63, face.nose - 0.009, 0.3, 0.11);
    const philtrum = bell(ax, y, 0, face.mouth + 0.05, 0.08, 0.028);
    const mouth = bell(ax, y, 0, face.mouth, 0.34, 0.02);
    const underLip = bell(ax, y, 0, face.mouth - 0.047, 0.32, 0.027);
    const delta =
      -0.084 * noseBand * tip -
      0.035 * bridge * nasal -
      0.04 * sockets +
      0.024 * brow +
      0.021 * cheek -
      0.01 * philtrum +
      0.01 * mouth -
      0.017 * underLip;
    const adjusted =
      correction(i, ax, y, phi, face) +
      front * central * (delta + landmarkRelief(ax, y, face));
    pos.setZ(i, v.z + h * adjusted);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return applyPortraitDepth(geometry, binding);
}
