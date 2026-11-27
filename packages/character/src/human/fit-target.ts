import { required } from "./required.js";
import { Triangle, Vector3, Ray, Box3 } from "three";

import type { ReferenceMesh } from "./reference-mesh.js";
type Face = { tri: Triangle; normal: Vector3; area: number; center: Vector3 };
type Node = { box: Box3; items: Face[] } | { box: Box3; left: Node; right: Node };
function scanBoundary(faces: Face[]) {
  const vertices = new Map<string, number>();
  const ids = new Uint32Array(3 * faces.length);
  for (let i = 0; i < faces.length; i++) {
    const { a, b, c } = required(faces[i]).tri;
    for (const [corner, p] of [a, b, c].entries()) {
      const key = [p.x, p.y, p.z].join(",");
      if (!vertices.has(key)) vertices.set(key, vertices.size);
      ids[i * 3 + corner] = vertices.get(key) ?? 0;
    }
  }
  const stride = vertices.size;
  const open = new Set<number>(),
    shared = new Set<number>();
  const edge = (a: number, b: number) => Math.min(a, b) * stride + Math.max(a, b);
  for (let i = 0; i < ids.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const key = edge(ids[i + k] ?? 0, ids[i + ((k + 1) % 3)] ?? 0);
      if (open.delete(key)) shared.add(key);
      else if (!shared.has(key)) open.add(key);
    }
  }
  const rim = new Set<number>();
  for (const key of open) {
    rim.add(Math.floor(key / stride));
    rim.add(key % stride);
  }
  const masks = new WeakMap<Face, number>();
  for (let i = 0; i < faces.length; i++) {
    let mask = 0;
    for (let k = 0; k < 3; k++) {
      if (rim.has(ids[3 * i + k] ?? 0)) mask |= 1 << (3 + k);
      if (open.has(edge(ids[3 * i + ((k + 1) % 3)] ?? 0, ids[3 * i + ((k + 2) % 3)] ?? 0)))
        mask |= 1 << k;
    }
    if (mask) masks.set(required(faces[i]), mask);
  }
  const bary = new Vector3();
  return (face: Face, point: Vector3) => {
    const mask = masks.get(face);
    if (!mask) return false;
    const { a, b, c } = face.tri;
    Triangle.getBarycoord(point, a, b, c, bary);
    for (let k = 0; k < 3; k++) {
      const weight = bary.getComponent(k);
      if (mask & (1 << k) && weight < 1e-5) return true;
      if (mask & (1 << (3 + k)) && weight > 1 - 1e-5) return true;
    }
    return false;
  };
}
const axisNames = ["x", "y", "z"] as const;
export function fitTarget(mesh: ReferenceMesh, partial = false) {
  const { positions, indices } = mesh;
  const n = indices.length / 3;
  if (!n || n > 750000) throw new Error("Use a reference with 1 to 750,000 triangles.");
  const triangles: Face[] = [],
    areaNormal = new Vector3();
  let totalArea = 0;
  for (let f = 0; f < n; f++) {
    const points = [0, 1, 2].map((k) =>
      new Vector3().fromArray(positions, 3 * (indices[f * 3 + k] ?? 0)),
    );
    if (!points.every((v) => Number.isFinite(v.x + v.y + v.z)))
      throw new Error("Reference contains nonfinite positions.");
    const tri = new Triangle(...points),
      normal = tri.getNormal(new Vector3());
    if (normal.lengthSq() > 0.5) {
      const area = tri.getArea();
      triangles.push({ tri, normal, area, center: tri.getMidpoint(new Vector3()) });
      totalArea += area;
      areaNormal.addScaledVector(normal, area);
    }
  }
  if (!triangles.length) throw new Error("The reference has no usable surface.");
  function build(items: Face[]): Node {
    const box = new Box3();
    for (const { tri } of items) box.expandByPoint(tri.a).expandByPoint(tri.b).expandByPoint(tri.c);
    if (items.length <= 10) return { box, items };
    const sizes = box.getSize(new Vector3()).toArray(),
      axis = required(axisNames[sizes.indexOf(Math.max(...sizes))]);
    items.sort((a, b) => a.center[axis] - b.center[axis]);
    const mid = items.length >> 1;
    return {
      box,
      left: build(items.slice(0, mid)),
      right: build(items.slice(mid)),
    };
  }
  const onBoundary = partial ? scanBoundary(triangles) : null;
  const tree = build(triangles),
    candidate = new Vector3(),
    near = new Vector3();
  function query(
    point: Vector3,
    normal: Vector3 | null,
    max = Infinity,
    rejectRim = Boolean(normal),
    matchedNormal: Vector3 | null = null,
  ): Vector3 | null {
    if (normal && onBoundary && !query(point, null, max, true)) return null;
    let best = max * max,
      nearestFace: Face | undefined;
    function visit(node: Node) {
      if (node.box.clampPoint(point, candidate).distanceToSquared(point) > best) return;
      if ("items" in node) {
        for (const face of node.items) {
          if (normal && face.normal.dot(normal) < 0.15) continue;
          face.tri.closestPointToPoint(point, candidate);
          const d = candidate.distanceToSquared(point);
          if (d < best) {
            best = d;
            near.copy(candidate);
            nearestFace = face;
          }
        }
      } else {
        const dl = node.left.box.clampPoint(point, candidate).distanceToSquared(point);
        const dr = node.right.box.clampPoint(point, candidate).distanceToSquared(point);
        if (dl < dr) {
          visit(node.left);
          visit(node.right);
        } else {
          visit(node.right);
          visit(node.left);
        }
      }
    }
    visit(tree);
    if (!nearestFace || (rejectRim && onBoundary?.(nearestFace, near))) return null;
    matchedNormal?.copy(nearestFace.normal);
    return near;
  }
  let observedDirection = null;
  if (areaNormal.length() > 0.35 * totalArea) {
    const direction = areaNormal.normalize();
    const opposingArea = triangles.reduce(
      (sum, t) => sum + (t.normal.dot(direction) < -0.08 ? t.area : 0),
      0,
    );
    if (opposingArea < 0.025 * totalArea) observedDirection = direction;
  }
  const ray = new Ray(),
    hit = new Vector3(),
    bestPoint = new Vector3();
  function fromView(p: Vector3, view: Vector3, reach: number) {
    ray.origin.copy(p).addScaledVector(view, reach);
    ray.direction.copy(view).negate();
    let best = reach * 2,
      bestFace: Face | undefined;
    function walk(node: Node) {
      if (!ray.intersectsBox(node.box) || node.box.distanceToPoint(ray.origin) > best) return;
      if (!("items" in node)) {
        walk(node.left);
        walk(node.right);
        return;
      }
      for (const face of node.items) {
        if (face.normal.dot(view) <= 0) continue;
        if (ray.intersectTriangle(face.tri.a, face.tri.b, face.tri.c, false, hit)) {
          const d = hit.distanceTo(ray.origin);
          if (d < best) {
            best = d;
            bestFace = face;
            bestPoint.copy(hit);
          }
        }
      }
    }
    walk(tree);
    return bestFace ? { point: bestPoint, normal: bestFace.normal } : null;
  }
  return { query, observedDirection, fromView };
}

export type FitTargetTree = ReturnType<typeof fitTarget>;
