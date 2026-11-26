import * as T from "three";
import { depthFieldSize, type DepthField, type DepthPin, type FigurePaint } from "@irudd/document";
import { unpack } from "./packed.js";

const [width, height] = depthFieldSize;

export function applyPortraitDepth(
  geometry: T.BufferGeometry,
  paint: Pick<FigurePaint, "height" | "offset" | "rest">,
  field: DepthField | undefined,
): T.BufferGeometry {
  if (!field?.mix) return geometry;
  const values = unpack(field.values);
  const pos = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  let [left, right, back, front] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const [x, , z, w, r] of paint.rest) {
    left = Math.min(left, x - w);
    right = Math.max(right, x + w);
    back = Math.min(back, z - r);
    front = Math.max(front, z + r);
  }
  const at = (i: number) => values[i] ?? 0;
  const fieldAt = (x: number, y: number): number => {
    const xf = T.MathUtils.clamp((x - left) / (right - left || 1), 0, 1) * (width - 1);
    const yf = T.MathUtils.clamp((y + paint.offset[1]) / paint.height, 0, 1) * (height - 1);
    const xi = Math.floor(xf);
    const yi = Math.floor(yf);
    const xn = Math.min(xi + 1, width - 1);
    const yn = Math.min(yi + 1, height - 1);
    const sample = (row: number) =>
      T.MathUtils.lerp(at(row * width + xi), at(row * width + xn), xf - xi);
    return T.MathUtils.lerp(sample(yi), sample(yn), yf - yi) / 255;
  };
  let count = 0;
  let sum = 0;
  let zSum = 0;
  let sum2 = 0;
  let cross = 0;
  for (let i = 0; i < pos.count; i++) {
    const facing = -Math.sin(uv.getX(i) * 2 * Math.PI);
    const y = (pos.getY(i) + paint.offset[1]) / paint.height;
    if (facing < 0.42 || y < 0.19 || y > 0.86) continue;
    const gray = fieldAt(pos.getX(i), pos.getY(i));
    const z = pos.getZ(i);
    count++;
    sum += gray;
    sum2 += gray * gray;
    zSum += z;
    cross += gray * z;
  }
  if (!count) return geometry;
  const depth = front - back;
  const variance = sum2 - (sum * sum) / count;
  if (variance < 1e-5) return geometry;
  const gain = T.MathUtils.clamp(
    (cross - (sum * zSum) / count) / variance,
    depth * 0.25,
    depth * 1.3,
  );
  const offset = (zSum - gain * sum) / count;
  for (let i = 0; i < pos.count; i++) {
    const facing = -Math.sin(uv.getX(i) * 2 * Math.PI);
    const y = (pos.getY(i) + paint.offset[1]) / paint.height;
    const blend =
      field.mix *
      T.MathUtils.smoothstep(facing, 0.15, 0.65) *
      T.MathUtils.smoothstep(y, 0.09, 0.24) *
      (1 - T.MathUtils.smoothstep(y, 0.81, 0.97));
    if (!blend) continue;
    const old = pos.getZ(i);
    const desired = offset + gain * fieldAt(pos.getX(i), pos.getY(i));
    pos.setZ(
      i,
      old + blend * T.MathUtils.clamp(desired - old, -paint.height * 0.13, paint.height * 0.13),
    );
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function frontDepth(geometry: T.BufferGeometry, x: number, y: number): number | undefined {
  const a = geometry.getAttribute("position");
  const indices = geometry.getIndex();
  const n = indices ? indices.count : a.count;
  const vertex = (j: number) => (indices ? indices.getX(j) : j);
  let best = -Infinity;
  for (let j = 0; j < n; j += 3) {
    const i0 = vertex(j);
    const i1 = vertex(j + 1);
    const i2 = vertex(j + 2);
    const ax = a.getX(i0);
    const ay = a.getY(i0);
    const bx = a.getX(i1);
    const by = a.getY(i1);
    const cx = a.getX(i2);
    const cy = a.getY(i2);
    if (
      x < Math.min(ax, bx, cx) ||
      x > Math.max(ax, bx, cx) ||
      y < Math.min(ay, by, cy) ||
      y > Math.max(ay, by, cy)
    )
      continue;
    const ux = bx - ax;
    const uy = by - ay;
    const vx = cx - ax;
    const vy = cy - ay;
    const det = ux * vy - uy * vx;
    if (Math.abs(det) < 1e-13) continue;
    const dx = x - ax;
    const dy = y - ay;
    const u = (dx * vy - dy * vx) / det;
    const v = (ux * dy - uy * dx) / det;
    if (u >= -1e-5 && v >= -1e-5 && u + v <= 1.00001)
      best = Math.max(best, a.getZ(i0) * (1 - u - v) + a.getZ(i1) * u + a.getZ(i2) * v);
  }
  return Number.isFinite(best) ? best : undefined;
}

function weight(dx: number, dy: number, r: number): number {
  const t = Math.hypot(dx, dy) / r;
  return t >= 1 ? 0 : (1 - t) ** 4 * (4 * t + 1);
}

function solve(matrix: number[][]): number[] {
  const n = matrix.length;
  const row = (i: number): number[] => {
    const r = matrix[i];
    if (!r) throw new Error("Depth landmark system row out of range.");
    return r;
  };
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let j = i + 1; j < n; j++)
      if (Math.abs(row(j)[i] ?? 0) > Math.abs(row(pivot)[i] ?? 0)) pivot = j;
    const top = row(pivot);
    matrix[pivot] = row(i);
    matrix[i] = top;
    const k = top[i] ?? 0;
    if (Math.abs(k) < 1e-8) continue;
    for (let j = i; j <= n; j++) top[j] = (top[j] ?? 0) / k;
    for (let j = 0; j < n; j++)
      if (j !== i) {
        const other = row(j);
        const f = other[i] ?? 0;
        for (let col = i; col <= n; col++) other[col] = (other[col] ?? 0) - f * (top[col] ?? 0);
      }
  }
  return matrix.map((r) => r[n] ?? 0);
}

export function fitDepth(
  geometry: T.BufferGeometry,
  pins: ReadonlyArray<DepthPin> | undefined,
  height: number,
): T.BufferGeometry {
  if (!pins?.length) return geometry;
  const accepted: { x: number; y: number; z: number; radius: number }[] = [];
  for (const [x, y, z, radius] of pins) {
    const depth = frontDepth(geometry, x, y);
    if (depth !== undefined)
      accepted.push({
        x,
        y,
        z: T.MathUtils.clamp(z - depth, -height * 0.17, height * 0.17),
        radius,
      });
  }
  if (!accepted.length) return geometry;
  const coefficients = solve(
    accepted.map((a, i) => [
      ...accepted.map((b, j) => weight(a.x - b.x, a.y - b.y, b.radius) + (i === j ? 0.015 : 0)),
      a.z,
    ]),
  );
  const pos = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < pos.count; i++) {
    const front = T.MathUtils.smoothstep(-Math.sin(uv.getX(i) * 2 * Math.PI), 0, 0.45);
    if (!front) continue;
    const x = pos.getX(i);
    const y = pos.getY(i);
    let change = 0;
    accepted.forEach((p, j) => {
      change += (coefficients[j] ?? 0) * weight(x - p.x, y - p.y, p.radius);
    });
    pos.setZ(i, pos.getZ(i) + front * T.MathUtils.clamp(change, -height * 0.17, height * 0.17));
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
