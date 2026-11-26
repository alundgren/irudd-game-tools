// A face warped to landmarks traced on a portrait. Ported from headFrame,
// portraitAxes, applyFrontFit and carryFaceEdits in
// character-view/front-fit.js at 2761eb1, arithmetic in the same order so the
// vertices match.

import type { FrontFitPass, FrontFitView } from "@irudd/document";
import * as T from "three";
import { isMesh } from "../mesh.js";
import { sectionDepth, type SurfaceMove } from "./profile-fit.js";

/** A face's bounds centre and its scale to head-height units. */
export interface HeadFrame {
  readonly center: T.Vector3;
  readonly factor: T.Vector3;
  readonly height: number;
  readonly half: number;
}

export function headFrame(mesh: T.Mesh): HeadFrame {
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox ?? new T.Box3();
  const center = box.getCenter(new T.Vector3());
  const size = box.getSize(new T.Vector3());
  const scale = mesh.getWorldScale(new T.Vector3());
  const height = Math.max(size.y * scale.y, 1e-6);
  const factor = scale.divideScalar(height);
  return { center, factor, height, half: 0.56 * Math.max(1, size.x * factor.x) };
}

interface Axes {
  readonly right: T.Vector3;
  readonly up: T.Vector3;
  readonly out: T.Vector3;
}

/** Orthonormal frame of an upright camera orbiting a head centred at the origin. */
export function portraitAxes(yaw = 0, pitch = 0): Axes {
  const y = T.MathUtils.degToRad(yaw);
  const p = T.MathUtils.degToRad(pitch);
  return {
    right: new T.Vector3(Math.cos(y), 0, -Math.sin(y)),
    up: new T.Vector3(-Math.sin(y) * Math.sin(p), Math.cos(p), -Math.cos(y) * Math.sin(p)),
    out: new T.Vector3(Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)),
  };
}

interface Pin {
  readonly at: readonly [number, number, number];
  readonly shift: readonly [number, number];
}

/**
 * Fit a local 2D similarity at each projected vertex (moving least squares,
 * Schaefer, McPhail & Warren, 2006). Broad shifts can then narrow a whole jaw
 * without creating an indentation just under each selected point.
 */
function frontalWarp(pass: FrontFitPass): (x: number, y: number, z: number) => [number, number] {
  const pins: Pin[] = [...pass.pins];
  // Free boundary controls keep a sparse mouth/jaw fit from resizing the crown.
  for (const [x, y] of [
    [0, 0.49],
    [-0.32, 0.47],
    [0.32, 0.47],
    [0, -0.5],
  ] as const)
    if (pins.every((p) => Math.hypot(p.at[0] - x, p.at[1] - y) > 0.12))
      pins.push({ at: [x, y, 0], shift: [0, 0] });
  const weights = new Float64Array(pins.length);
  return (x, y, z) => {
    let sum = 0;
    let px = 0;
    let py = 0;
    let dx = 0;
    let dy = 0;
    let nearest = Infinity;
    for (let i = 0; i < pins.length; i++) {
      const p = pins[i];
      if (!p) continue;
      const dist = (p.at[0] - x) ** 2 + (p.at[1] - y) ** 2;
      nearest = Math.min(nearest, dist);
      const w = 1 / Math.max(1e-10, dist);
      weights[i] = w;
      sum += w;
      px += w * p.at[0];
      py += w * p.at[1];
      dx += w * p.shift[0];
      dy += w * p.shift[1];
    }
    px /= sum;
    py /= sum;
    dx /= sum;
    dy /= sum;
    let dot = 0;
    let cross = 0;
    let norm = 0;
    for (let i = 0; i < pins.length; i++) {
      const p = pins[i];
      if (!p) continue;
      const a = p.at[0] - px;
      const b = p.at[1] - py;
      const ex = p.shift[0] - dx;
      const ey = p.shift[1] - dy;
      const w = weights[i] ?? 0;
      dot += w * (a * ex + b * ey);
      cross += w * (a * ey - b * ex);
      norm += w * (a * a + b * b);
    }
    const u = x - px;
    const v = y - py;
    if (norm > 1e-10) {
      dx += (dot * u - cross * v) / norm;
      dy += (cross * u + dot * v) / norm;
    }
    const local =
      1 - T.MathUtils.smoothstep(Math.sqrt(nearest), pass.radius * 0.65, pass.radius * 1.8);
    // Side contours carry their nearby rear surface with them. The middle of
    // the occiput stays behind the editing area.
    const depth = T.MathUtils.smoothstep(z + 0.55 * Math.abs(x), -0.52, -0.16);
    return [dx * local * depth * pass.amount, dy * local * depth * pass.amount];
  };
}

/**
 * A depth correction is a scalar field over the anatomical front plane.
 * Moving every point in the same column monotonically keeps a large nose
 * correction from folding the far eyelid or the underside of the nose.
 */
function depthWarp(
  pass: FrontFitPass,
  view: FrontFitView,
  { right, up, out }: Axes,
  rear: number,
): (x: number, y: number, z: number) => number {
  const sensitivity = right.z ** 2 + up.z ** 2;
  const pins = pass.pins.map(({ at: [u, v, w], shift: [du, dv] }) => {
    const point = new T.Vector3()
      .addScaledVector(right, u)
      .addScaledVector(up, v)
      .addScaledVector(out, w);
    const delta = T.MathUtils.clamp((du * right.z + dv * up.z) / sensitivity, -0.35, 0.35);
    return { point, delta };
  });
  if (view.symmetric)
    for (const pin of pins.slice())
      if (Math.abs(pin.point.x) > 1e-6)
        pins.push({ point: pin.point.clone().setX(-pin.point.x), delta: pin.delta });
  return (x, y, z) => {
    let sum = 0;
    let shift = 0;
    let depth = 0;
    let nearest = Infinity;
    for (const { point, delta } of pins) {
      const d = (x - point.x) ** 2 + (y - point.y) ** 2;
      nearest = Math.min(nearest, d);
      const w = 1 / Math.max(1e-10, d) ** 1.25;
      sum += w;
      shift += delta * w;
      depth += point.z * w;
    }
    const span = Math.max(0.02, depth / sum - rear);
    const fade =
      1 - T.MathUtils.smoothstep(Math.sqrt(nearest), pass.radius * 0.25, pass.radius * 1.65);
    const taper = T.MathUtils.clamp((z - rear) / span, 0, 1);
    return pass.amount * fade * taper * T.MathUtils.clamp(shift / sum, -span * 0.68, span);
  };
}

/**
 * Warp `mesh` by one front-fit pass, carrying what `owner` holds near the
 * face with it. `retainProfile` keeps a fitted side contour's depth.
 */
export function applyFrontFit(
  mesh: T.Mesh,
  pass: FrontFitPass,
  retainProfile = false,
  owner: T.Object3D = mesh,
): void {
  if (!pass.amount) return;
  const { center, factor } = headFrame(mesh);
  const g = mesh.geometry;
  const pos = g.getAttribute("position");
  const box = g.boundingBox ?? new T.Box3();
  const bottom = box.min.y + 0.008 / factor.y;
  const top = box.max.y - 0.008 / factor.y;
  const view = pass.view;
  const angled = Boolean(view?.yaw || view?.pitch);
  const before = retainProfile && !angled ? sectionDepth(g, bottom, top) : null;
  const basis = angled && view ? portraitAxes(view.yaw, view.pitch) : null;
  const at = new T.Vector3();
  const depth =
    basis && view?.mode === "depth"
      ? depthWarp(pass, view, basis, (box.min.z - center.z) * factor.z)
      : null;
  const warp = frontalWarp(pass);
  const move: SurfaceMove = (x, y, z) => {
    at.set((x - center.x) * factor.x, (y - center.y) * factor.y, (z - center.z) * factor.z);
    if (!basis) {
      const [dx, dy] = warp(at.x, at.y, at.z);
      return [x + dx / factor.x, y + dy / factor.y, z];
    }
    if (depth) return [x, y, z + depth(at.x, at.y, at.z) / factor.z];
    const { right, up, out } = basis;
    const [du, dv] = warp(at.dot(right), at.dot(up), at.dot(out));
    return [
      x + (du * right.x + dv * up.x) / factor.x,
      y + (du * right.y + dv * up.y) / factor.y,
      z + (du * right.z + dv * up.z) / factor.z,
    ];
  };
  for (let i = 0; i < pos.count; i++) {
    const [x, y, z] = move(pos.getX(i), pos.getY(i), pos.getZ(i));
    pos.setXYZ(i, x, y, z);
  }
  const after = before ? sectionDepth(g, bottom, top) : null;
  const keepDepth: SurfaceMove = (x, y, z) => {
    if (!before || !after) return [x, y, z];
    const last = after.near.length - 1;
    const t = ((y - bottom) / (top - bottom)) * last;
    if (t < 0 || t >= last) return [x, y, z];
    const lo = Math.floor(t);
    const f = t - lo;
    const sample = (arr: Float64Array) => T.MathUtils.lerp(arr[lo] ?? 0, arr[lo + 1] ?? 0, f);
    const original = sample(before.near);
    const front = sample(after.near);
    const rear = sample(after.rear);
    if (!Number.isFinite(original - front + rear) || front <= rear) return [x, y, z];
    const w = T.MathUtils.smoothstep((z - rear) / (front - rear), 0.6, 1);
    return [x, y, z + (original - front) * w];
  };
  if (before)
    for (let i = 0; i < pos.count; i++) {
      const [x, y, z] = keepDepth(pos.getX(i), pos.getY(i), pos.getZ(i));
      pos.setXYZ(i, x, y, z);
    }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  carryFaceEdits(mesh, owner, { center, factor }, move, (x, y, z) => keepDepth(...move(x, y, z)));
}

/**
 * Carry what `owner` holds through a face's warp. A spectacle rim, an ear and
 * its attached hair occupy different local frames: nearby vertices move
 * through the same field as the face, rigid face pieces follow their anchor,
 * and eye pieces and their keyed positions move in the face's own frame.
 */
export function carryFaceEdits(
  mesh: T.Mesh,
  owner: T.Object3D,
  { center, factor }: Pick<HeadFrame, "center" | "factor">,
  move: SurfaceMove,
  moveSurface: SurfaceMove = move,
): void {
  owner.updateWorldMatrix(true, true);
  const fromWorld = mesh.matrixWorld.clone().invert();
  const rigid = new Set<T.Object3D>();
  owner.traverse((branch) => {
    if (branch === owner) return;
    if (branch.parent && rigid.has(branch.parent)) {
      rigid.add(branch);
      return;
    }
    const anchor: unknown = branch.userData["rigidFaceAnchor"];
    if (!Array.isArray(anchor)) return;
    rigid.add(branch);
    const pivot = new T.Vector3().fromArray(anchor.map(Number)).divide(factor).add(center);
    const before = pivot.clone().applyMatrix4(mesh.matrixWorld);
    const after = new T.Vector3()
      .fromArray(moveSurface(pivot.x, pivot.y, pivot.z))
      .applyMatrix4(mesh.matrixWorld);
    const parent = branch.parent;
    if (!parent) return;
    branch.position.add(parent.worldToLocal(after).sub(parent.worldToLocal(before)));
    branch.updateWorldMatrix(false, true);
  });
  owner.traverse((child) => {
    if (
      !isMesh(child) ||
      rigid.has(child) ||
      child === mesh ||
      child.userData["eyePiece"] ||
      child.userData["faceSurface"]
    )
      return;
    const toFace = new T.Matrix4().multiplyMatrices(fromWorld, child.matrixWorld);
    const fromFace = toFace.clone().invert();
    const source = child.geometry.getAttribute("position");
    const pt = new T.Vector3();
    const changed: Array<readonly [number, number, number, number]> = [];
    for (let i = 0; i < source.count; i++) {
      pt.fromBufferAttribute(source, i).applyMatrix4(toFace);
      const moved = move(pt.x, pt.y, pt.z);
      if (Math.abs(moved[0] - pt.x) + Math.abs(moved[1] - pt.y) + Math.abs(moved[2] - pt.z) < 1e-7)
        continue;
      pt.fromArray(moved).applyMatrix4(fromFace);
      changed.push([i, pt.x, pt.y, pt.z]);
    }
    if (changed.length) {
      child.geometry = child.geometry.clone();
      const g = child.geometry;
      const p = g.getAttribute("position");
      for (const [i, x, y, z] of changed) p.setXYZ(i, x, y, z);
      p.needsUpdate = true;
      g.computeVertexNormals();
      g.computeBoundingBox();
      g.computeBoundingSphere();
    }
  });
  // Eye patches and each keyed position live in the face's local coordinates.
  // Warp both endpoints before reconstructing the relative gaze or blink.
  for (const eye of mesh.children) {
    if (!isMesh(eye) || !eye.userData["eyePiece"]) continue;
    const eg = eye.geometry;
    const ep = eg.getAttribute("position");
    const targets = eg.morphAttributes["position"] ?? [];
    for (let i = 0; i < ep.count; i++) {
      const x = ep.getX(i);
      const y = ep.getY(i);
      const z = ep.getZ(i);
      const rest = moveSurface(x, y, z);
      for (const target of targets) {
        const to = moveSurface(x + target.getX(i), y + target.getY(i), z + target.getZ(i));
        target.setXYZ(i, to[0] - rest[0], to[1] - rest[1], to[2] - rest[2]);
      }
      ep.setXYZ(i, rest[0], rest[1], rest[2]);
    }
    ep.needsUpdate = true;
    eg.computeVertexNormals();
    eg.computeBoundingBox();
    eg.computeBoundingSphere();
    targets.forEach((target, i) => {
      target.needsUpdate = true;
      const posed = eg.clone();
      const pp = posed.getAttribute("position");
      for (let j = 0; j < pp.array.length; j++)
        pp.array[j] = (pp.array[j] ?? 0) + (target.array[j] ?? 0);
      posed.computeVertexNormals();
      const normal = eg.morphAttributes["normal"]?.[i];
      const posedNormal = posed.getAttribute("normal");
      const restNormal = eg.getAttribute("normal");
      if (normal)
        for (let j = 0; j < normal.array.length; j++)
          normal.array[j] = (posedNormal.array[j] ?? 0) - (restNormal.array[j] ?? 0);
      posed.dispose();
    });
  }
}
