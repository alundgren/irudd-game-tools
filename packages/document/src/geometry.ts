// Pure numeric geometry over plain tuples. Document geometry never depends on a
// rendering library: builders may convert these values into Three.js objects
// behind the character boundary.
//
// Conventions: right-handed, +Y up, +Z forward. Rotations are unit quaternions
// [x, y, z, w]. A part's position and rotation are expressed in its parent's
// child basis; size is the part's extent along its own axes. In the core the
// child basis is the parent's rigid metric frame, so size never propagates to
// children. A family feature may declare a scaled child basis instead
// (`FeatureDefinition.childBasis`); placement is then affine (see below).

export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];

export const zero: Vec3 = [0, 0, 0];
export const identity: Quat = [0, 0, 0, 1];

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
/** Component-wise product. */
export function mul(a: Vec3, b: Vec3): Vec3 {
  return [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
}
/** Component-wise quotient. */
export function div(a: Vec3, b: Vec3): Vec3 {
  return [a[0] / b[0], a[1] / b[1], a[2] / b[2]];
}
export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}
export function distance(a: Vec3, b: Vec3): number {
  return length(sub(a, b));
}

export function quatMultiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}
export function quatConjugate(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}
export function quatNorm(q: Quat): number {
  return Math.hypot(q[0], q[1], q[2], q[3]);
}
/** Normalise and choose the representative with w >= 0 so equal rotations compare equal. */
export function quatNormalize(q: Quat): Quat {
  const n = quatNorm(q);
  if (!(n > 0)) return identity;
  const s = q[3] < 0 ? -1 / n : 1 / n;
  return [q[0] * s, q[1] * s, q[2] * s, q[3] * s];
}
export function quatFromAxisAngle(axis: Vec3, radians: number): Quat {
  const n = length(axis);
  if (!(n > 0)) return identity;
  const s = Math.sin(radians / 2) / n;
  return quatNormalize([axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(radians / 2)]);
}
/** Rotate a vector by a unit quaternion. */
export function rotate(q: Quat, v: Vec3): Vec3 {
  const u: Vec3 = [q[0], q[1], q[2]];
  const w = q[3];
  const t = scale(cross(u, v), 2);
  return add(add(v, scale(t, w)), cross(u, t));
}
/** Angle in radians between two rotations. */
export function quatAngle(a: Quat, b: Quat): number {
  const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(Math.min(1, d / (quatNorm(a) * quatNorm(b))));
}

/** A rigid frame: x_world = position + rotation · x_local. */
export interface Frame {
  readonly position: Vec3;
  readonly rotation: Quat;
}
export const worldFrame: Frame = { position: zero, rotation: identity };

export function compose(parent: Frame, child: Frame): Frame {
  return {
    position: add(parent.position, rotate(parent.rotation, child.position)),
    rotation: quatNormalize(quatMultiply(parent.rotation, child.rotation)),
  };
}
export function toFrame(frame: Frame, world: Vec3): Vec3 {
  return rotate(quatConjugate(frame.rotation), sub(world, frame.position));
}
export function fromFrame(frame: Frame, local: Vec3): Vec3 {
  return add(frame.position, rotate(frame.rotation, local));
}
/** Express a direction (no translation) in the frame. */
export function directionToFrame(frame: Frame, world: Vec3): Vec3 {
  return rotate(quatConjugate(frame.rotation), world);
}
export function directionFromFrame(frame: Frame, local: Vec3): Vec3 {
  return rotate(frame.rotation, local);
}

export function vecNear(a: Vec3, b: Vec3, tolerance: number): boolean {
  return distance(a, b) <= tolerance;
}

// ── Affine transforms ───────────────────────────────────────────────────────
//
// A family may attach a part's children in a scaled basis (see
// `FeatureDefinition.childBasis`). Nested rotations under a non-uniform basis
// then shear, so world placement is an affine map, not a rigid frame. These
// helpers are the one implementation of that math: renderers, world picks and
// edit directions all compose and invert through them. Nothing is normalised
// per level; `decomposeAffine` normalises its rotation once.

type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

/** x' = linear · x + translation, with `linear` stored column-major. */
export interface Affine {
  readonly linear: Mat3;
  readonly translation: Vec3;
}

export const identityAffine: Affine = { linear: [1, 0, 0, 0, 1, 0, 0, 0, 1], translation: zero };

/** Translate, then rotate, then scale along local axes: T · R · S, as Three.js composes. */
export function affineFromTrs(position: Vec3, rotation: Quat, size: Vec3 = [1, 1, 1]): Affine {
  const [x, y, z, w] = rotation;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  const [sx, sy, sz] = size;
  return {
    linear: [
      (1 - (yy + zz)) * sx,
      (xy + wz) * sx,
      (xz - wy) * sx,
      (xy - wz) * sy,
      (1 - (xx + zz)) * sy,
      (yz + wx) * sy,
      (xz + wy) * sz,
      (yz - wx) * sz,
      (1 - (xx + yy)) * sz,
    ],
    translation: position,
  };
}

export function affineFromFrame(frame: Frame): Affine {
  return affineFromTrs(frame.position, frame.rotation);
}

/** Scale the local axes: a · S(size). */
export function affineScaled(a: Affine, size: Vec3): Affine {
  const m = a.linear;
  const [sx, sy, sz] = size;
  return {
    linear: [
      m[0] * sx,
      m[1] * sx,
      m[2] * sx,
      m[3] * sy,
      m[4] * sy,
      m[5] * sy,
      m[6] * sz,
      m[7] * sz,
      m[8] * sz,
    ],
    translation: a.translation,
  };
}

export function affineDirection(a: Affine, v: Vec3): Vec3 {
  const m = a.linear;
  return [
    m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
    m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
    m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
  ];
}

export function affinePoint(a: Affine, p: Vec3): Vec3 {
  return add(affineDirection(a, p), a.translation);
}

/** a ∘ b: apply b, then a. */
export function composeAffine(a: Affine, b: Affine): Affine {
  const n = b.linear;
  const c0 = affineDirection(a, [n[0], n[1], n[2]]);
  const c1 = affineDirection(a, [n[3], n[4], n[5]]);
  const c2 = affineDirection(a, [n[6], n[7], n[8]]);
  return {
    linear: [c0[0], c0[1], c0[2], c1[0], c1[1], c1[2], c2[0], c2[1], c2[2]],
    translation: affinePoint(a, b.translation),
  };
}

export function affineDeterminant(a: Affine): number {
  const m = a.linear;
  return dot([m[0], m[1], m[2]], cross([m[3], m[4], m[5]], [m[6], m[7], m[8]]));
}

/** The inverse map, or undefined when the transform collapses a dimension. */
export function invertAffine(a: Affine): Affine | undefined {
  const m = a.linear;
  const c0: Vec3 = [m[0], m[1], m[2]];
  const c1: Vec3 = [m[3], m[4], m[5]];
  const c2: Vec3 = [m[6], m[7], m[8]];
  const det = dot(c0, cross(c1, c2));
  if (!Number.isFinite(det) || Math.abs(det) < 1e-300) return undefined;
  // Rows of the inverse are the cross products of the columns over the determinant.
  const r0 = scale(cross(c1, c2), 1 / det);
  const r1 = scale(cross(c2, c0), 1 / det);
  const r2 = scale(cross(c0, c1), 1 / det);
  const linear: Mat3 = [r0[0], r1[0], r2[0], r0[1], r1[1], r2[1], r0[2], r1[2], r2[2]];
  const inverse: Affine = { linear, translation: zero };
  return { linear, translation: scale(affineDirection(inverse, a.translation), -1) };
}

/** Lengths of the transformed unit axes: the metres one local unit spans along each axis. */
export function affineAxisLengths(a: Affine): Vec3 {
  const m = a.linear;
  return [Math.hypot(m[0], m[1], m[2]), Math.hypot(m[3], m[4], m[5]), Math.hypot(m[6], m[7], m[8])];
}

export interface Trs {
  readonly position: Vec3;
  readonly rotation: Quat;
  readonly size: Vec3;
}

/**
 * Split an affine map into translate, rotate and positive per-axis scale, or
 * undefined when it shears or mirrors beyond `tolerance` (the largest cosine
 * allowed between transformed axes).
 */
export function decomposeAffine(a: Affine, tolerance = 1e-9): Trs | undefined {
  const size = affineAxisLengths(a);
  if (!size.every((s) => s > 0 && Number.isFinite(s))) return undefined;
  const m = a.linear;
  const u: Vec3 = [m[0] / size[0], m[1] / size[0], m[2] / size[0]];
  const v: Vec3 = [m[3] / size[1], m[4] / size[1], m[5] / size[1]];
  const w: Vec3 = [m[6] / size[2], m[7] / size[2], m[8] / size[2]];
  if (Math.abs(dot(u, v)) > tolerance || Math.abs(dot(v, w)) > tolerance) return undefined;
  if (Math.abs(dot(u, w)) > tolerance || dot(cross(u, v), w) <= 0) return undefined;
  // Rotation matrix to quaternion (Shepperd), normalised once at the end.
  const [m00, m10, m20, m01, m11, m21, m02, m12, m22] = [...u, ...v, ...w];
  const trace = m00 + m11 + m22;
  let q: Quat;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  return { position: a.translation, rotation: quatNormalize(q), size };
}

export function affineNear(a: Affine, b: Affine, tolerance: number): boolean {
  return (
    a.linear.every((x, i) => Math.abs(x - (b.linear[i] ?? NaN)) <= tolerance) &&
    vecNear(a.translation, b.translation, tolerance)
  );
}
