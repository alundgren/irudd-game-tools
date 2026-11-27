import type { BufferGeometry } from "three";
import { type HeadFrame, surfaceFrame } from "./dress/fringe.js";
import {
  at,
  vec,
  clamp,
  cross,
  dot,
  length,
  smooth,
  sub,
  unit,
  add,
  lerp3,
  type Vec,
} from "./dress/kit.js";
import type { HumanSurface } from "./surface.js";
const DEG = Math.PI / 180;
function landmarkWeights(positions: ArrayLike<number>, origin: Vec, f: HeadFrame) {
  const count = positions.length / 3;
  const weights = new Float32Array(count);
  const k = f.k;
  const eyeY = f.eye[1];
  const eyeZ = f.eye[2];
  const eyes = f.eyes;

  for (let i = 0; i < count; i++) {
    const wx = at(positions, i * 3) + origin[0];
    const wy = at(positions, i * 3 + 1) + origin[1];
    const wz = at(positions, i * 3 + 2) + origin[2];
    const direction = f.aim([wx, wy, wz]);
    const absPhi = Math.abs(direction.phi) / DEG;
    const eps = direction.eps / DEG;

    const frontMask = smooth(84, 58, absPhi) * smooth(-68, -42, eps) * smooth(42, 22, eps);
    if (frontMask <= 1e-4) continue;

    let eyeClear = 1.0;
    for (const e of eyes) {
      const dPhi = (direction.phi - e.phi) / Math.max(5 * DEG, e.wide * 1.95);
      const dEps = (direction.eps - e.eps) / Math.max(4.5 * DEG, e.tall * 2.15);
      const dist = Math.hypot(dPhi, dEps);
      eyeClear *= smooth(0.85, 1.38, dist);
    }
    if (eyeClear <= 1e-4) continue;

    const mouthY = eyeY - 0.064 * k;
    const dxMouth = Math.abs(wx) / (0.036 * k);
    const dyMouth = (wy - mouthY) / (0.02 * k);
    const mouthClear = smooth(0.85, 1.42, Math.hypot(dxMouth, dyMouth));

    const brow =
      Math.exp(-(((wy - (eyeY + 0.02 * k)) / (0.017 * k)) ** 2)) * smooth(62, 12, absPhi);
    const nose =
      smooth(0.024 * k, 0.008 * k, Math.abs(wx)) *
      smooth(eyeY - 0.044 * k, eyeY - 0.022 * k, wy) *
      smooth(eyeY + 0.022 * k, eyeY + 0.004 * k, wy) *
      smooth(eyeZ - 0.01 * k, eyeZ + 0.01 * k, wz);
    const cheek =
      Math.exp(-(((Math.abs(wx) - 0.048 * k) / (0.024 * k)) ** 2)) *
      Math.exp(-(((wy - (eyeY - 0.024 * k)) / (0.022 * k)) ** 2));
    const jaw =
      smooth(eyeY - 0.042 * k, eyeY - 0.072 * k, wy) *
      smooth(eyeY - 0.132 * k, eyeY - 0.1 * k, wy) *
      smooth(78, 38, absPhi);

    const structural = clamp(0.28 + 0.85 * Math.max(brow, nose, cheek, jaw), 0, 1);
    weights[i] = frontMask * eyeClear * mouthClear * structural;
  }
  return weights;
}

export function applyFacePlanes(
  geometry: BufferGeometry,
  cage: HumanSurface,
  origin: Vec,
  mode: string,
  tinted: boolean,
) {
  const position = geometry.getAttribute("position"),
    normal = geometry.getAttribute("normal"),
    index = geometry.index;
  if (!index || !position || !normal || (mode !== "Subtle" && mode !== "Sculpted")) return;
  const colour = tinted ? geometry.getAttribute("color") : undefined;
  const frame = surfaceFrame(cage),
    mask = landmarkWeights(position.array, origin, frame);
  const size = position.count,
    plane = new Float32Array(size * 3),
    neighbours = new Float32Array(size * 3),
    degree = new Uint32Array(size);
  const pos = (i: number) => vec(position.array, i * 3);
  for (let t = 0; t < index.count; t += 3) {
    const ids = [index.getX(t), index.getX(t + 1), index.getX(t + 2)] as const;
    const a = pos(ids[0]),
      b = pos(ids[1]),
      c = pos(ids[2]);
    const triangle = cross(sub(b, a), sub(c, a)),
      area = length(triangle);
    if (area < 1e-12) continue;
    const direction = unit(triangle);
    ids.forEach((v, j) => {
      if (at(mask, v) <= 1e-4) return;
      const weight = area * (Math.max(0, dot(direction, vec(normal.array, v * 3))) ** 5 + 0.02);
      plane.set(add(vec(plane, v * 3), direction, weight), v * 3);
      neighbours.set(add(vec(neighbours, v * 3), pos(ids[(j + 1) % 3] ?? v)), v * 3);
      degree[v] = at(degree, v) + 1;
    });
  }
  const strong = mode === "Sculpted";
  for (let i = 0; i < size; i++) {
    const w = at(mask, i);
    if (w <= 1e-4) continue;
    const original = vec(normal.array, i * 3),
      average = vec(plane, i * 3);
    let face = original;
    if (length(average) > 1e-9) {
      const [x, y, z] = unit(average);
      const quantize = (v: number, power: number) => Math.sign(v) * Math.abs(v) ** power;
      const target = unit([quantize(x, 0.82), quantize(y, 0.85), quantize(z, 0.86)]);
      face = unit(lerp3(original, target, w * (strong ? 0.68 : 0.42)));
      normal.setXYZ(i, ...face);
    }
    const count = at(degree, i);
    if (!colour || !count) continue;
    const delta = add(pos(i), vec(neighbours, i * 3), -1 / count);
    const curvature = clamp(dot(delta, original) / (0.0022 * frame.k), -1, 1);
    const turn =
      0.45 * smooth(0.32, 0.78, Math.abs(face[0])) + 0.85 * smooth(-0.08, -0.58, face[1]);
    const tint = w * ((strong ? 0.078 : 0.045) * curvature - (strong ? 0.048 : 0.028) * turn);
    colour.setXYZ(
      i,
      clamp(colour.getX(i) * (1 + tint * 1.06)),
      clamp(colour.getY(i) * (1 + tint * 0.98)),
      clamp(colour.getZ(i) * (1 + tint * 0.88)),
    );
  }
  normal.needsUpdate = true;
  if (colour) colour.needsUpdate = true;
}
