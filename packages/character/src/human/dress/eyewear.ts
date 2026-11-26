// Spectacles fitted to the adult's face (character-view/human-eyewear.js at
// 2761eb1): one unglazed frame with clear openings at every export detail,
// in ordinary opaque geometry so a single-material game export shows both
// pupils. The rims clear the skin in front of each eye and the arms follow
// the side of the head to just behind it.

import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { boneNames } from "../catalogue.js";
import type { HumanSurface } from "../surface.js";

interface Frame {
  readonly power: number;
  readonly aspect: number;
  readonly rise: number;
  readonly radius: number;
  readonly colour: string;
  readonly metal: boolean;
}
const sections = 48;
const frames: Readonly<Record<string, Frame>> = {
  "Round wire": {
    power: 1,
    aspect: 0.88,
    rise: 0,
    radius: 0.00125,
    colour: "#755c39",
    metal: true,
  },
  "Square acetate": {
    power: 0.55,
    aspect: 0.69,
    rise: 0.04,
    radius: 0.00235,
    colour: "#3b2d29",
    metal: false,
  },
  "Upswept frames": {
    power: 0.72,
    aspect: 0.69,
    rise: 0.23,
    radius: 0.002,
    colour: "#503445",
    metal: false,
  },
};

type Axis = "x" | "z";
type Depth = (
  xAxis: Axis,
  depthAxis: Axis,
  x: number,
  y: number,
  sign: number,
  fallback: number,
) => number;

/**
 * Orthographic depth through the current skin. Project from the front for
 * the nose and rims, and from the side for the temple arms and earpieces.
 */
function faceDepth(surface: HumanSurface, eye: T.Vector3, unit: number): Depth {
  const triangles: Array<readonly [T.Vector3, T.Vector3, T.Vector3]> = [],
    v = (i: number) => new T.Vector3().fromArray(surface.positions, 3 * i);
  const { indices, positions } = surface;
  const at = (a: ArrayLike<number>, i: number) => a[i] ?? 0;
  for (let i = 0; i < surface.bodyTriangles * 3; i += 3) {
    const ia = at(indices, i),
      ib = at(indices, i + 1),
      ic = at(indices, i + 2);
    const ya = at(positions, 3 * ia + 1),
      yb = at(positions, 3 * ib + 1),
      yc = at(positions, 3 * ic + 1);
    if (
      Math.max(ya, yb, yc) >= eye.y - 0.045 * unit &&
      Math.min(ya, yb, yc) <= eye.y + 0.045 * unit
    )
      triangles.push([v(ia), v(ib), v(ic)]);
  }
  return (xAxis, depthAxis, x, y, sign, fallback) => {
    let hit = -Infinity;
    for (const [a, b, c] of triangles) {
      if (
        x < Math.min(a[xAxis], b[xAxis], c[xAxis]) ||
        x > Math.max(a[xAxis], b[xAxis], c[xAxis]) ||
        y < Math.min(a.y, b.y, c.y) ||
        y > Math.max(a.y, b.y, c.y)
      )
        continue;
      const bx = b[xAxis] - a[xAxis],
        by = b.y - a.y,
        cx = c[xAxis] - a[xAxis],
        cy = c.y - a.y;
      const det = bx * cy - by * cx;
      if (Math.abs(det) < 1e-12) continue;
      const u = ((x - a[xAxis]) * cy - (y - a.y) * cx) / det,
        w = (bx * (y - a.y) - by * (x - a[xAxis])) / det;
      if (u < 0 || w < 0 || u + w > 1) continue;
      hit = Math.max(
        hit,
        sign *
          (a[depthAxis] + u * (b[depthAxis] - a[depthAxis]) + w * (c[depthAxis] - a[depthAxis])),
      );
    }
    return Number.isFinite(hit) ? hit : fallback;
  };
}

/** The frame for a style, or no mesh for "None". It follows the head by the rig's region weights. */
export function fittedEyewear(
  surface: HumanSurface,
  style: string | undefined,
  material: (colour: string, type: string) => T.Material,
  plain = false,
): T.Mesh[] {
  const cut = style === undefined ? undefined : frames[style];
  if (!cut) return [];
  const eyeBounds = surface.eyeGroups
    .map((group) => {
      const bounds = new T.Box3(),
        v = new T.Vector3();
      for (const index of group) bounds.expandByPoint(v.fromArray(surface.positions, 3 * index));
      return bounds;
    })
    .sort((a, b) => a.min.x - b.min.x);
  const eyes = eyeBounds.map((b) => b.getCenter(new T.Vector3()));
  const [eye0, eye1] = eyes;
  if (!eye0 || !eye1) return [];
  const centre = eye0.clone().lerp(eye1, 0.5);
  const halfSpan = (eye1.x - eye0.x) / 2,
    unit = halfSpan / 0.031;
  const depth = faceDepth(surface, centre, unit);
  const front = (x: number, y: number) => depth("x", "z", x, y, 1, centre.z);
  const pieces: T.BufferGeometry[] = [],
    bridgeEnds: T.Vector3[] = [];
  const tube = (points: T.Vector3[], radius: number, steps: number, closed = false) => {
    const curve = new T.CatmullRomCurve3(points, closed, "centripetal");
    pieces.push(new T.TubeGeometry(curve, steps, radius, 6, closed));
  };
  const power = (x: number) => Math.sign(x) * Math.pow(Math.abs(x), cut.power);
  const headZ = surface.joints[boneNames.indexOf("head") * 3 + 2] ?? 0;
  for (let i = 0; i < eyes.length; i++) {
    const eye = eyes[i],
      bounds = eyeBounds[i];
    if (!eye || !bounds) continue;
    const sign = i ? 1 : -1;
    const width = halfSpan * 0.81,
      height = width * cut.aspect;
    const radius = cut.radius * unit;
    const rim = Array.from({ length: sections }, (_, j) => {
      const theta = (j * 2 * Math.PI) / sections,
        lateral = power(Math.cos(theta)),
        vertical = power(Math.sin(theta));
      return new T.Vector3(
        eye.x + sign * width * lateral,
        eye.y + height * (vertical - 0.1 + cut.rise * lateral),
        -0.15 * width * lateral + 0.06 * height * vertical,
      );
    });
    // Rims have one plane per eye. Lift the whole plane until both the eye
    // dome and every point of the rim clear the fitted skin.
    const plane = Math.max(
      bounds.max.z + 0.003 * unit,
      ...rim.map((p) => front(p.x, p.y) - p.z + radius + 0.002 * unit),
    );
    for (const p of rim) p.z += plane;
    tube(rim, radius, sections, true);
    const end = rim[Math.round(sections * 0.43)],
      hinge = rim[2];
    if (!end || !hinge) continue;
    bridgeEnds.push(end);
    const tipZ = headZ - 0.016 * unit;
    const arm = [hinge];
    for (let j = 1; j <= 14; j++) {
      const t = j / 14,
        z = T.MathUtils.lerp(hinge.z, tipZ, t);
      const y =
        hinge.y +
        unit * (0.003 * Math.sin(Math.PI * t) - 0.018 * T.MathUtils.smoothstep(t, 0.74, 1));
      const taper = T.MathUtils.smoothstep(t, 0, 0.18);
      const side = depth("z", "x", z, y, sign, sign * hinge.x);
      arm.push(
        new T.Vector3(
          sign * T.MathUtils.lerp(sign * hinge.x, side + radius + 0.0015 * unit, taper),
          y,
          z,
        ),
      );
    }
    tube(arm, radius * 0.81, 28);
  }
  const [left, right] = bridgeEnds;
  if (!left || !right) return [];
  const mid = left.clone().lerp(right, 0.5);
  mid.y += 0.0035 * unit;
  mid.z = Math.max(mid.z, front(mid.x, mid.y) + (cut.radius + 0.0015) * unit);
  tube([left, mid, right], cut.radius * unit * 0.87, 12);
  const geometry = mergeGeometries(pieces);
  for (const g of pieces) g.dispose();
  const frameMaterial = material(cut.colour, cut.metal ? "metal" : "cloth").clone();
  if (!plain && frameMaterial instanceof T.MeshStandardMaterial) {
    frameMaterial.roughness = cut.metal ? 0.29 : 0.39;
    frameMaterial.metalness = cut.metal ? 0.57 : 0.04;
  }
  // The hinges and narrow wires must stay connected after mesh reduction.
  frameMaterial.userData["fibreLOD"] = true;
  const mesh = new T.Mesh(geometry, frameMaterial);
  mesh.name = style ?? "";
  mesh.userData["styleRegion"] = "head";
  mesh.castShadow = true;
  return [mesh];
}
