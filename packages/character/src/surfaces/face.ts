// Faces traced from a portrait. Ported from portraitSurface in
// character-view/facial-sculpt.js, headSpace in portrait-frame.js and
// portrait-relief.js at 2761eb1, arithmetic in the same order so the vertices
// match. A fitted depth field (portrait-depth.js) blends in last.

import type { DepthField, FigurePaint, PortraitLandmarks } from "@irudd/document";
import * as T from "three";
import { applyPortraitDepth } from "./portrait-depth.js";

/** A binding in head-height units: its height and offset span the head, not the traced region. */
export type HeadSpace = Pick<FigurePaint, "height" | "offset" | "rest" | "portrait">;

const gaussian = (x: number, center: number, radius: number) =>
  Math.exp(-(((x - center) / radius) ** 2));
const bell = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) =>
  Math.exp(-(((x - cx) / rx) ** 2) - ((y - cy) / ry) ** 2);

/**
 * Portrait sculpting uses head-height units. The source picture's standing
 * height coordinates stay intact for sampling its colours.
 */
export function headSpace(paint: HeadSpace): HeadSpace {
  const frame = paint.portrait?.frame;
  if (!frame) return paint;
  const h = paint.height;
  return {
    ...paint,
    height: h * frame.span,
    offset: [
      paint.offset[0] - frame.centerX * h,
      paint.offset[1] - frame.base * h,
      paint.offset[2],
    ],
  };
}

type Correction = (i: number, x: number, y: number, phi: number, face: PortraitLandmarks) => number;

/**
 * A side silhouette carries the nose, lips and chin along its whole outside
 * contour. Rebuild a smooth cheek plane under it and keep the profile's
 * detail only at its anatomical landmarks.
 */
function profileCorrection(binding: HeadSpace, geometry: T.BufferGeometry): Correction {
  const height = binding.height;
  const rows = binding.rest;
  const profile = rows.map((row) => [row[1], row[2] + row[4], row[2] - row[4]] as const);
  const smooth = profile.map(([y, front, back]) => {
    let total = 0;
    let fore = 0;
    let rear = 0;
    for (const [sampleY, f, b] of profile) {
      const weight = gaussian(sampleY, y, height * 0.095);
      total += weight;
      fore += f * weight;
      rear += b * weight;
    }
    return [fore / total - front, rear / total - back] as const;
  });
  const uv = geometry.getAttribute("uv");
  return (i, x, y, phi, face) => {
    const t = uv.getY(i) * (rows.length - 1);
    const left = Math.min(rows.length - 2, Math.floor(t));
    const u = t - left;
    const a = smooth[left] ?? [0, 0];
    const b = smooth[left + 1] ?? a;
    const front = T.MathUtils.lerp(a[0], b[0], u);
    const rear = T.MathUtils.lerp(a[1], b[1], u);
    const facing = (1 - Math.sin(phi)) * 0.5;
    const preserve = Math.max(
      gaussian(x, 0, 0.21) * gaussian(y, face.nose + 0.015, 0.1),
      gaussian(x, 0, 0.37) * gaussian(y, face.mouth, 0.055),
      gaussian(x, 0, 0.5) * gaussian(y, face.chin + 0.025, 0.06),
    );
    const faceBand =
      T.MathUtils.smoothstep(y, face.chin - 0.055, face.chin + 0.04) *
      (1 - T.MathUtils.smoothstep(y, face.eyes + 0.14, face.eyes + 0.25));
    return (T.MathUtils.lerp(rear, front, facing) * (1 - preserve) * faceBand) / height;
  };
}

/** Convex corneas, lid margins, the orbital crease, nasal wings and the lip line. */
export function landmarkRelief(
  x: number,
  y: number,
  face: Pick<PortraitLandmarks, "eyes" | "nose" | "mouth">,
): number {
  const ax = Math.abs(x);
  const ex = (ax - 0.425) / 0.262;
  let relief = 0;
  if (Math.abs(ex) < 1.24) {
    const edge = T.MathUtils.clamp(1 - ex * ex, 0, 1);
    const falloff = 1 - T.MathUtils.smoothstep(Math.abs(ex), 0.83, 1.23);
    const eyeY = face.eyes + 0.008 * ex;
    const dy = y - eyeY;
    const upper = 0.031 * Math.sqrt(edge);
    const lower = -0.022 * Math.sqrt(edge);
    relief +=
      falloff *
      (0.028 * gaussian(dy, 0, 0.029) * Math.sqrt(edge) +
        0.015 * gaussian(dy, upper, 0.009) +
        0.009 * gaussian(dy, lower, 0.009) -
        0.012 * gaussian(dy, upper + 0.016, 0.011) -
        0.006 * gaussian(dy, lower - 0.023, 0.015));
  }
  relief += 0.019 * gaussian(ax, 0.19, 0.095) * gaussian(y, face.nose - 0.012, 0.029);
  relief -= 0.018 * gaussian(ax, 0.135, 0.054) * gaussian(y, face.nose - 0.025, 0.012);
  relief += 0.012 * gaussian(x, 0, 0.122) * gaussian(y, face.nose + 0.009, 0.036);
  const mx = x / 0.47;
  if (Math.abs(mx) < 1.15) {
    const fade = 1 - T.MathUtils.smoothstep(Math.abs(mx), 0.72, 1.13);
    const seam = face.mouth + 0.005 * mx * mx;
    const bow = 0.014 + 0.009 * gaussian(Math.abs(mx), 0.31, 0.2);
    relief +=
      fade *
      (0.016 * gaussian(y, seam + bow, 0.011) +
        0.021 * gaussian(y, seam - 0.018, 0.014) -
        0.017 * gaussian(y, seam, 0.007));
    relief -= 0.008 * gaussian(Math.abs(mx), 0.91, 0.13) * gaussian(y, seam - 0.003, 0.015);
  }
  return relief;
}

/**
 * Sculpt a traced face. A profile gives each row's frontmost point, which
 * only the bridge and tip of the nose reach: recess the cheeks and eye
 * sockets locally and keep the profile at the nose tip, lips and chin.
 * Without landmarks the geometry is unchanged; with them a fitted depth
 * field blends in last.
 */
export function portraitSurface(
  geometry: T.BufferGeometry,
  binding: HeadSpace,
  field?: DepthField,
): T.BufferGeometry {
  const paint = headSpace(binding);
  const face = paint.portrait;
  if (!face) return geometry;
  const pos = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  const v = new T.Vector3();
  const h = paint.height;
  const correction = profileCorrection(paint, geometry);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const y = (v.y + paint.offset[1]) / h;
    const ax = ((v.x + paint.offset[0]) / h - face.center) / face.width;
    const x = Math.abs(ax);
    const phi = uv.getX(i) * 2 * Math.PI;
    const front = T.MathUtils.smoothstep(-Math.sin(phi), 0.06, 0.68);
    const central = 1 - T.MathUtils.smoothstep(x, 0.78, 1.28);
    const noseBand = Math.exp(-(((y - face.nose) / 0.086) ** 2));
    const bridge = Math.exp(-(((y - (face.nose + 0.084)) / 0.126) ** 2));
    const tip = 1 - Math.exp(-((ax / 0.22) ** 2));
    const nasal = 1 - Math.exp(-((ax / 0.13) ** 2));
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
      correction(i, ax, y, phi, face) + front * central * (delta + landmarkRelief(ax, y, face));
    pos.setZ(i, v.z + h * adjusted);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return applyPortraitDepth(geometry, binding, field);
}
