import type { FigureProfileFit } from "@irudd/document";
import * as T from "three";
import type { HeadSpace } from "./face.js";

type Curve = FigureProfileFit["curve"];

const at = <V>(list: ArrayLike<V>, i: number): V => {
  const v = list[i];
  if (v === undefined) throw new Error("Profile index out of range.");
  return v;
};

function sample(curve: Curve, t: number): number {
  if (t <= 0) return at(curve, 0)[1];
  const i = curve.findIndex((p) => p[0] >= t);
  if (i < 0) return at(curve, curve.length - 1)[1];
  const a = at(curve, i - 1);
  const b = at(curve, i);
  return T.MathUtils.lerp(a[1], b[1], (t - a[0]) / (b[0] - a[0]));
}

export interface Sections {
  readonly near: Float64Array;
  readonly rear: Float64Array;
  readonly left: Float64Array | null;
  readonly right: Float64Array | null;
}

export function sectionDepth(
  geometry: T.BufferGeometry,
  bottom: number,
  top: number,
  rows = 193,
  withWidth = false,
): Sections {
  const pos = geometry.getAttribute("position");
  const idx = geometry.index;
  const near = new Float64Array(rows).fill(-Infinity);
  const rear = new Float64Array(rows).fill(Infinity);
  const left = withWidth ? new Float64Array(rows).fill(Infinity) : null;
  const right = withWidth ? new Float64Array(rows).fill(-Infinity) : null;
  const dy = (top - bottom) / (rows - 1);
  for (let i = 0, n = idx?.count ?? pos.count; i < n; i += 3) {
    for (let k = 0; k < 3; k++) {
      let a = idx ? idx.getX(i + k) : i + k;
      let b = idx ? idx.getX(i + ((k + 1) % 3)) : i + ((k + 1) % 3);
      if (pos.getY(a) > pos.getY(b)) [a, b] = [b, a];
      const ya = pos.getY(a);
      const yb = pos.getY(b);
      const za = pos.getZ(a);
      const zb = pos.getZ(b);
      if (yb === ya) continue;
      const first = Math.max(0, Math.ceil((ya - bottom) / dy - 1e-8));
      const last = Math.min(rows - 1, Math.floor((yb - bottom) / dy + 1e-8));
      for (let row = first; row <= last; row++) {
        const f = (bottom + row * dy - ya) / (yb - ya);
        const z = za + (zb - za) * f;
        if (left && right) {
          const x = pos.getX(a) + (pos.getX(b) - pos.getX(a)) * f;
          left[row] = Math.min(at(left, row), x);
          right[row] = Math.max(at(right, row), x);
        }
        near[row] = Math.max(at(near, row), z);
        rear[row] = Math.min(at(rear, row), z);
      }
    }
  }
  return { near, rear, left, right };
}

export type SurfaceMove = (x: number, y: number, z: number) => readonly [number, number, number];

export interface ProfileResult {
  readonly move: SurfaceMove;
  readonly brow: number;
  readonly chin: number;
  readonly front: number;
  readonly scale: T.Vector3;
}

export function fitHeadProfile(
  mesh: T.Mesh,
  fit: FigureProfileFit,
  binding: HeadSpace | undefined,
): ProfileResult | undefined {
  if (!fit.amount) return undefined;
  const g = mesh.geometry;
  g.computeBoundingBox();
  const box = g.boundingBox;
  if (!box) return undefined;
  const height = box.max.y - box.min.y;
  const marks = binding?.portrait;
  const brow =
    marks && binding
      ? (marks.eyes + 0.067) * binding.height - binding.offset[1]
      : box.min.y + 0.66 * height;
  const chin =
    marks && binding
      ? (marks.chin + 0.045) * binding.height - binding.offset[1]
      : box.min.y + 0.055 * height;
  const span = brow - chin;
  if (span <= 0) return undefined;
  const scale = mesh.getWorldScale(new T.Vector3());
  const rows = 193;
  const pad = 0.13 * span;
  const bottom = Math.max(box.min.y + height * 0.002, chin - pad);
  const top = Math.min(box.max.y - height * 0.002, brow + pad);
  if (brow >= top || chin <= bottom) return undefined;
  const { near, rear, left, right } = sectionDepth(g, bottom, top, rows, Boolean(fit.relief));
  const rowAt = (y: number) =>
    T.MathUtils.clamp(((y - bottom) / (top - bottom)) * (rows - 1), 0, rows - 1);
  const depth = (values: Float64Array, y: number): number => {
    const r = rowAt(y);
    const lo = Math.floor(r);
    const hi = Math.ceil(r);
    return T.MathUtils.lerp(at(values, lo), at(values, hi), r - lo);
  };
  const base = depth(near, brow);
  if (!Number.isFinite(base)) return undefined;
  const p = g.getAttribute("position");
  const minZ = box.min.z;
  const midX = (box.min.x + box.max.x) * 0.5;
  const halfWidth = (box.max.x - box.min.x) * 0.5;
  const finish = fit.stage === "finish";
  const dimension = (span * scale.y) / scale.z;
  const nasalBase = [sample(fit.curve, 0.07), sample(fit.curve, 0.55)] as const;
  const mouthBase = [sample(fit.curve, 0.56), sample(fit.curve, 0.8)] as const;
  const gaussian = (v: number) => Math.exp(-v * v);
  const relief = fit.relief;
  function rebuild(x: number, y: number, z: number, target: number, t: number, front: number) {
    if (!left || !right) return z;
    const l = depth(left, y);
    const r = depth(right, y);
    if (!Number.isFinite(l + r) || r <= l) return z;
    const radial = T.MathUtils.clamp((x - (l + r) * 0.5) / ((r - l) * 0.5), -1, 1);
    const ax = Math.abs(radial);
    const baseZ = minZ + 0.48 * (base - minZ);
    const frontWeight = T.MathUtils.smoothstep(
      z,
      baseZ - 0.01 * dimension,
      baseZ + 0.3 * (front - baseZ),
    );
    if (frontWeight === 0) return z;
    const nasal =
      T.MathUtils.smoothstep(t, -0.03, 0.13) * (1 - T.MathUtils.smoothstep(t, 0.48, 0.61));
    const oral =
      T.MathUtils.smoothstep(t, 0.51, 0.62) * (1 - T.MathUtils.smoothstep(t, 0.76, 0.84));
    const nr =
      base +
      dimension *
        T.MathUtils.lerp(nasalBase[0], nasalBase[1], T.MathUtils.clamp((t - 0.07) / 0.48, 0, 1));
    const mr =
      base +
      dimension *
        T.MathUtils.lerp(mouthBase[0], mouthBase[1], T.MathUtils.clamp((t - 0.56) / 0.24, 0, 1));
    const nose = nasal * Math.max(0, target - nr);
    const lips = oral * (target - mr);
    const core = target - nose - lips;
    const width = 0.21 + 0.08 * gaussian((t - 0.43) / 0.1);
    const surface =
      baseZ +
      (core - baseZ) * Math.pow(Math.max(0, 1 - radial * radial), 0.43) +
      nose * gaussian(ax / width) +
      lips * gaussian(ax / 0.43);
    const socket = gaussian((ax - 0.4) / 0.18) * gaussian((t - 0.15) / 0.11);
    const cheek = gaussian((ax - 0.55) / 0.23) * gaussian((t - 0.39) / 0.17);
    return T.MathUtils.lerp(
      z,
      Math.min(target, surface + dimension * (0.037 * cheek - 0.047 * socket)),
      frontWeight,
    );
  }
  const move: SurfaceMove = (px, y, z) => {
    if (y <= bottom || y >= top) return [px, y, z];
    const front = depth(near, y);
    const back = depth(rear, y);
    if (!Number.isFinite(front - back) || front <= back) return [px, y, z];
    const t = (brow - y) / span;
    const edgeY = T.MathUtils.clamp(y, chin, brow);
    const target = base + (sample(fit.curve, t) * span * scale.y) / scale.z;
    const fade =
      y < chin
        ? T.MathUtils.smoothstep(y, bottom, chin)
        : y > brow
          ? 1 - T.MathUtils.smoothstep(y, brow, top)
          : 1;
    const pivot = back + 0.43 * (front - back);
    const fraction = T.MathUtils.clamp((z - pivot) / (front - pivot), 0, 1);
    const shift = T.MathUtils.clamp(
      target - depth(near, edgeY),
      -0.62 * (front - pivot),
      0.85 * (front - back),
    );
    const nasal = Math.exp(-(((t - 0.36) / 0.24) ** 2));
    const lip = Math.exp(-(((t - 0.65) / 0.12) ** 2));
    const width = 0.65 - 0.41 * nasal - 0.2 * lip;
    const x = Math.abs(px - midX) / Math.max(halfWidth, 1e-6);
    const lateral = Math.exp(-((x / width) ** 2));
    const weight = finish ? fraction : fraction * fraction * lateral;
    let adjusted = z + shift * weight;
    if (relief) adjusted = T.MathUtils.lerp(adjusted, rebuild(px, y, z, target, t, front), relief);
    return [px, y, T.MathUtils.lerp(z, adjusted, fade * fit.amount)];
  };
  for (let i = 0; i < p.count; i++) p.setZ(i, move(p.getX(i), p.getY(i), p.getZ(i))[2]);
  p.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return { move, brow, chin, front: base, scale };
}
