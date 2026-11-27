import { Box3, Triangle, Vector3, BufferGeometry, Material, Mesh } from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { bakeReference, readReferenceMesh } from "../reference-glb.js";

export interface ReferenceMesh {
  positions: Float32Array;
  indices: Uint32Array;
}
export async function readFittingFile(file: File) {
  if (/\.obj$/i.test(file.name)) {
    const root = new OBJLoader().parse(await file.text());
    try {
      return { ...bakeReference(root), credit: "" };
    } finally {
      root.traverse((node) => {
        if (node instanceof Mesh) {
          if (node.geometry instanceof BufferGeometry) node.geometry.dispose();
          const materials: unknown = node.material;
          for (const mat of Array.isArray(materials) ? materials : [materials])
            if (mat instanceof Material) mat.dispose();
        }
      });
    }
  }
  return readReferenceMesh(await file.arrayBuffer());
}

interface Node {
  box: Box3;
  start: number;
  end: number;
  left?: Node;
  right?: Node;
}

export function referenceTree(mesh: ReferenceMesh) {
  const { indices, positions } = mesh;
  const count = indices.length / 3;
  if (!Number.isInteger(count) || !count || count > 750000)
    throw new Error("Choose a reference with 1 to 750,000 triangles.");
  if (
    positions.length % 3 ||
    indices.some((i) => 3 * i + 2 >= positions.length) ||
    !positions.every(Number.isFinite)
  )
    throw new Error("The reference has invalid triangle coordinates.");
  const all = Uint32Array.from({ length: count }, (_, i) => i);
  const triangle = new Triangle(),
    point = new Vector3(),
    normal = new Vector3();
  function read(t: number) {
    triangle.a.fromArray(positions, 3 * (indices[3 * t] ?? 0));
    triangle.b.fromArray(positions, 3 * (indices[3 * t + 1] ?? 0));
    triangle.c.fromArray(positions, 3 * (indices[3 * t + 2] ?? 0));
    return triangle;
  }
  const order = all.filter((i) => read(i).getArea() > 0);
  if (!order.length) throw new Error("The reference has no usable triangle surface.");
  const centres = new Float32Array(count * 3);
  for (const t of order)
    read(t)
      .getMidpoint(point)
      .toArray(centres, 3 * t);
  function build(start: number, end: number): Node {
    const box = new Box3();
    for (let j = start; j < end; j++) {
      read(order[j] ?? 0);
      box.expandByPoint(triangle.a).expandByPoint(triangle.b).expandByPoint(triangle.c);
    }
    if (end - start <= 8) return { box, start, end };
    const size = box.getSize(point);
    const axis = size.x >= size.y && size.x >= size.z ? 0 : size.y >= size.z ? 1 : 2;
    order
      .subarray(start, end)
      .sort((a, b) => (centres[3 * a + axis] ?? 0) - (centres[3 * b + axis] ?? 0));
    const mid = (start + end) >>> 1;
    return { box, start, end, left: build(start, mid), right: build(mid, end) };
  }
  const root = build(0, order.length);
  function nearest(p: Vector3, facing?: Vector3, reach = Infinity, agreement = 0.5) {
    let best = reach,
      face = -1;
    const hit = new Vector3();
    function visit(node: Node) {
      if (node.box.distanceToPoint(p) > best) return;
      if (node.left && node.right) {
        const first = node.left.box.distanceToPoint(p) <= node.right.box.distanceToPoint(p);
        visit(first ? node.left : node.right);
        visit(first ? node.right : node.left);
      } else {
        for (let i = node.start; i < node.end; i++) {
          const f = order[i] ?? 0;
          read(f);
          if (facing && triangle.getNormal(normal).dot(facing) < agreement) continue;
          triangle.closestPointToPoint(p, point);
          const d = p.distanceTo(point);
          if (d < best) {
            face = f;
            best = d;
            hit.copy(point);
          }
        }
      }
    }
    visit(root);
    if (face < 0) return;
    read(face);
    const weights = triangle.getBarycoord(hit, new Vector3());
    if (!weights) return;
    const direction = triangle.getNormal(new Vector3());
    return {
      face,
      hit,
      weights,
      normal: direction,
      distance: best,
      signed: direction.dot(point.copy(p).sub(hit)) < 0 ? -best : best,
    };
  }
  return { mesh, nearest };
}
