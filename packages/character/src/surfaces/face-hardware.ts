import * as T from "three";
import { isMesh } from "../mesh.js";

interface Triangle {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly ux: number;
  readonly uy: number;
  readonly vx: number;
  readonly vy: number;
  readonly det: number;
  readonly uz: number;
  readonly vz: number;
}

function depthSampler(geometry: T.BufferGeometry): (x: number, y: number) => number {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox ?? new T.Box3();
  const { min, max } = box;
  const p = geometry.getAttribute("position");
  const index = geometry.index;
  const count = 32;
  const cells = Array.from({ length: count * count }, (): Triangle[] => []);
  const col = (x: number) =>
    Math.max(0, Math.min(count - 1, Math.floor(((x - min.x) * count) / (max.x - min.x || 1))));
  const row = (y: number) =>
    Math.max(0, Math.min(count - 1, Math.floor(((y - min.y) * count) / (max.y - min.y || 1))));
  for (let i = 0, n = index?.count ?? p.count; i < n; i += 3) {
    const a = index ? index.getX(i) : i;
    const b = index ? index.getX(i + 1) : i + 1;
    const c = index ? index.getX(i + 2) : i + 2;
    const x = p.getX(a);
    const y = p.getY(a);
    const z = p.getZ(a);
    const ux = p.getX(b) - x;
    const uy = p.getY(b) - y;
    const vx = p.getX(c) - x;
    const vy = p.getY(c) - y;
    const det = ux * vy - uy * vx;
    if (Math.abs(det) < 1e-14) continue;
    const tri = { x, y, z, ux, uy, vx, vy, det, uz: p.getZ(b) - z, vz: p.getZ(c) - z };
    const right = col(Math.max(x, x + ux, x + vx));
    const top = row(Math.max(y, y + uy, y + vy));
    for (let j = row(Math.min(y, y + uy, y + vy)); j <= top; j++)
      for (let k = col(Math.min(x, x + ux, x + vx)); k <= right; k++)
        cells[j * count + k]?.push(tri);
  }
  return (x, y) => {
    let result = -Infinity;
    for (const t of cells[row(y) * count + col(x)] ?? []) {
      const dx = x - t.x;
      const dy = y - t.y;
      const u = (dx * t.vy - dy * t.vx) / t.det;
      const v = (dy * t.ux - dx * t.uy) / t.det;
      if (u >= -1e-7 && v >= -1e-7 && u + v <= 1.0000001)
        result = Math.max(result, t.z + u * t.uz + v * t.vz);
    }
    return result;
  };
}

export interface FacePiece {
  readonly object: T.Object3D;
  readonly anchor: readonly [number, number, number];
  readonly clearance: number | undefined;
}

export function clearFaceHardware(face: T.Mesh, pieces: ReadonlyArray<FacePiece>): void {
  const groups = new Map<string, Array<{ object: T.Object3D; clearance: number | undefined }>>();
  for (const { object, anchor, clearance } of pieces) {
    const key = anchor.join(",");
    const group = groups.get(key) ?? [];
    group.push({ object, clearance });
    groups.set(key, group);
  }
  let sample: ((x: number, y: number) => number) | undefined;
  face.updateWorldMatrix(true, false);
  const inverse = face.matrixWorld.clone().invert();
  const unit = face.getWorldScale(new T.Vector3()).z;
  for (const group of groups.values()) {
    if (!group.some((p) => p.clearance !== undefined)) continue;
    const depthAt = (sample ??= depthSampler(face.geometry));
    const meshes: Array<{
      readonly m: T.Mesh;
      readonly toFace: T.Matrix4;
      readonly branch: { rear: number; readonly front: boolean };
    }> = [];
    const point = new T.Vector3();
    let lift = -Infinity;
    let frontLimit = Infinity;
    for (const { object, clearance } of group) {
      const branch = { rear: Infinity, front: clearance !== undefined };
      const visit = (m: T.Object3D): void => {
        if (!m.visible) return;
        if (isMesh(m)) {
          m.updateWorldMatrix(true, false);
          const toFace = new T.Matrix4().multiplyMatrices(inverse, m.matrixWorld);
          const pos = m.geometry.getAttribute("position");
          let minZ = Infinity;
          for (let i = 0; i < pos.count; i++) {
            point.fromBufferAttribute(pos, i).applyMatrix4(toFace);
            minZ = Math.min(minZ, point.z);
            if (clearance !== undefined)
              lift = Math.max(lift, depthAt(point.x, point.y) + clearance / unit - point.z);
          }
          if (clearance !== undefined) frontLimit = Math.min(frontLimit, minZ);
          branch.rear = Math.min(branch.rear, minZ);
          meshes.push({ m, toFace, branch });
        }
        for (const child of m.children) visit(child);
      };
      visit(object);
    }
    if (!Number.isFinite(lift) || Math.abs(lift) < 1e-7) continue;
    for (const { m, toFace, branch } of meshes) {
      const { rear: minZ, front } = branch;
      m.geometry = m.geometry.clone();
      const g = m.geometry;
      const pos = g.getAttribute("position");
      const fromFace = toFace.clone().invert();
      for (let i = 0; i < pos.count; i++) {
        point.fromBufferAttribute(pos, i).applyMatrix4(toFace);
        const fraction =
          front || minZ >= frontLimit
            ? 1
            : Math.max(0, Math.min(1, (point.z - minZ) / (frontLimit - minZ)));
        point.z += lift * fraction;
        point.applyMatrix4(fromFace);
        pos.setXYZ(i, point.x, point.y, point.z);
      }
      pos.needsUpdate = true;
      g.computeVertexNormals();
      g.computeBoundingBox();
      g.computeBoundingSphere();
    }
  }
}
