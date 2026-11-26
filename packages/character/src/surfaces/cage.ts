// Control-cage surfaces. Ported from cageGeometry in character-view/control-cage.js
// at 2761eb1: Catmull–Clark subdivision with creases, outward-facing closed
// shells and split normals along creases. The document has already checked
// the cage's topology (figure.cage), so the builder does not repeat it.

import * as T from "three";
import type { FigureCage } from "@irudd/document";

const key = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`);

interface Edge {
  readonly a: number;
  readonly b: number;
  readonly faces: number[];
  index?: number;
}

interface Mesh {
  readonly vertices: T.Vector3[];
  readonly faces: number[][];
  readonly creases: Array<readonly [number, number]>;
}

const at = <V>(list: ReadonlyArray<V>, i: number): V => {
  const value = list[i];
  if (value === undefined) throw new Error("Cage index out of range.");
  return value;
};

function average(points: ReadonlyArray<T.Vector3>): T.Vector3 {
  const sum = new T.Vector3();
  for (const point of points) sum.add(point);
  return sum.divideScalar(points.length);
}

function normal(points: ReadonlyArray<T.Vector3>): T.Vector3 {
  const n = new T.Vector3();
  const origin = at(points, 0);
  for (let i = 1; i < points.length - 1; i++)
    n.add(
      new T.Vector3().crossVectors(
        at(points, i).clone().sub(origin),
        at(points, i + 1)
          .clone()
          .sub(origin),
      ),
    );
  return n;
}

function net(vertices: ReadonlyArray<unknown>, faces: ReadonlyArray<ReadonlyArray<number>>) {
  const edges = new Map<string, Edge>();
  const faceRings = vertices.map((): number[] => []);
  const edgeRings = vertices.map((): Edge[] => []);
  faces.forEach((face, fi) => {
    face.forEach((a, i) => {
      at(faceRings, a).push(fi);
      const b = at(face, (i + 1) % face.length);
      const id = key(a, b);
      let edge = edges.get(id);
      if (!edge) {
        edge = { a, b, faces: [] };
        edges.set(id, edge);
        at(edgeRings, a).push(edge);
        at(edgeRings, b).push(edge);
      }
      edge.faces.push(fi);
    });
  });
  return { edges, faceRings, edgeRings };
}

function subdivide(
  vertices: T.Vector3[],
  faces: number[][],
  creases: ReadonlyArray<readonly [number, number]>,
): Mesh {
  const { edges, faceRings, edgeRings } = net(vertices, faces);
  const centers = faces.map((face) => average(face.map((i) => at(vertices, i))));
  const sharp = new Set(creases.map(([a, b]) => key(a, b)));
  const out = vertices.map((p, i) => {
    const ring = at(edgeRings, i);
    const neighbors = ring
      .filter((e) => e.faces.length === 1 || sharp.has(key(e.a, e.b)))
      .map((e) => at(vertices, e.a === i ? e.b : e.a));
    if (neighbors.length > 2) return p.clone();
    if (neighbors.length === 2)
      return p
        .clone()
        .multiplyScalar(0.75)
        .addScaledVector(at(neighbors, 0), 0.125)
        .addScaledVector(at(neighbors, 1), 0.125);
    const n = at(faceRings, i).length;
    const F = average(at(faceRings, i).map((f) => at(centers, f)));
    const R = average(ring.map((e) => at(vertices, e.a).clone().lerp(at(vertices, e.b), 0.5)));
    return F.addScaledVector(R, 2)
      .addScaledVector(p, n - 3)
      .divideScalar(n);
  });
  const nextSharp: Array<readonly [number, number]> = [];
  for (const [id, e] of edges) {
    const mid = average([at(vertices, e.a), at(vertices, e.b)]);
    if (e.faces.length === 2 && !sharp.has(id))
      mid.lerp(average(e.faces.map((f) => at(centers, f))), 0.5);
    e.index = out.push(mid) - 1;
    if (sharp.has(id)) nextSharp.push([e.a, e.index], [e.index, e.b]);
  }
  const start = out.length;
  out.push(...centers);
  const edgeIndex = (a: number, b: number): number => {
    const index = edges.get(key(a, b))?.index;
    if (index === undefined) throw new Error("Missing cage edge.");
    return index;
  };
  const quads: number[][] = [];
  faces.forEach((f, j) =>
    f.forEach((a, i) =>
      quads.push([
        a,
        edgeIndex(a, at(f, (i + 1) % f.length)),
        start + j,
        edgeIndex(at(f, (i + f.length - 1) % f.length), a),
      ]),
    ),
  );
  return { vertices: out, faces: quads, creases: nextSharp };
}

/** Closed shells should face out even if an imported cage used the opposite winding. */
function orientShells(vertices: ReadonlyArray<T.Vector3>, faces: number[][]): number[][] {
  const { edges } = net(vertices, faces);
  const links = faces.map((): number[] => []);
  const boundary = new Set<number>();
  for (const e of edges.values()) {
    const [a, b] = e.faces;
    if (a === undefined) continue;
    if (b === undefined) boundary.add(a);
    else {
      at(links, a).push(b);
      at(links, b).push(a);
    }
  }
  const result = [...faces];
  const visited = new Set<number>();
  for (let i = 0; i < faces.length; i++) {
    if (visited.has(i)) continue;
    const pending = [i];
    const component: number[] = [];
    visited.add(i);
    let closed = true;
    let volume = 0;
    for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
      const f = at(faces, id);
      component.push(id);
      if (boundary.has(id)) closed = false;
      for (let j = 1; j < f.length - 1; j++)
        volume += at(vertices, at(f, 0)).dot(
          new T.Vector3().crossVectors(at(vertices, at(f, j)), at(vertices, at(f, j + 1))),
        );
      for (const neighbor of at(links, id))
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          pending.push(neighbor);
        }
    }
    if (closed && volume < 0) for (const id of component) result[id] = [...at(faces, id)].reverse();
  }
  return result;
}

/** Give each smooth fan its own render vertex so a deliberate crease also splits normals. */
function splitNormals(mesh: Mesh, faceted: boolean): Mesh {
  if (!mesh.creases.length && !faceted) return mesh;
  const { faceRings, edgeRings } = net(mesh.vertices, mesh.faces);
  const sharp = new Set(mesh.creases.map(([a, b]) => key(a, b)));
  const vertices: T.Vector3[] = [];
  const faces = mesh.faces.map((f) => Array.from(f, () => 0));
  for (let i = 0; i < mesh.vertices.length; i++) {
    const links = new Map<number, number[]>(at(faceRings, i).map((f) => [f, []]));
    if (!faceted)
      for (const e of at(edgeRings, i))
        if (e.faces.length === 2 && !sharp.has(key(e.a, e.b))) {
          const [a, b] = e.faces;
          if (a === undefined || b === undefined) continue;
          links.get(a)?.push(b);
          links.get(b)?.push(a);
        }
    const remaining = new Set(at(faceRings, i));
    for (const start of remaining) {
      remaining.delete(start);
      const pending = [start];
      const idx = vertices.push(at(mesh.vertices, i)) - 1;
      for (let f = pending.pop(); f !== undefined; f = pending.pop()) {
        at(faces, f)[at(mesh.faces, f).indexOf(i)] = idx;
        for (const n of links.get(f) ?? []) if (remaining.delete(n)) pending.push(n);
      }
    }
  }
  return { vertices, faces, creases: [] };
}

export interface CageSurface {
  readonly geometry: T.BufferGeometry;
  /** For each triangle of the geometry's index, the control face it came from. */
  readonly faces: ReadonlyArray<number>;
}

export function cageGeometry(cage: FigureCage): T.BufferGeometry {
  return cageSurface(cage).geometry;
}

/**
 * The subdivided surface and the control face each triangle subdivides. A
 * chart with one coordinate per control point is subdivided with the cage
 * and becomes its texture coordinates; without one, `uv` is the unit frame's x and y.
 */
export function cageSurface(
  cage: FigureCage,
  chart?: ReadonlyArray<readonly [number, number]>,
): CageSurface {
  const levels = cage.levels ?? 1;
  const vertices = cage.vertices.map(([x, y, z]) => new T.Vector3(x, y, z));
  let mesh: Mesh = {
    vertices,
    faces: orientShells(
      vertices,
      cage.faces.map((f) => [...f]),
    ),
    creases: [...(cage.creases ?? [])],
  };
  let uv: Mesh | undefined =
    chart?.length === vertices.length
      ? {
          vertices: chart.map(([u, v]) => new T.Vector3(u, v, 0)),
          faces: mesh.faces,
          creases: mesh.creases,
        }
      : undefined;
  let source = mesh.faces.map((_, i) => i);
  for (let i = 0; i < levels; i++) {
    const owners = source;
    source = mesh.faces.flatMap((f, j) => f.map(() => at(owners, j)));
    if (uv) uv = subdivide(uv.vertices, uv.faces, uv.creases);
    mesh = subdivide(mesh.vertices, mesh.faces, mesh.creases);
  }
  if (uv) uv = splitNormals(uv, levels === 0);
  mesh = splitNormals(mesh, levels === 0);
  const index: number[] = [];
  const faces: number[] = [];
  for (const [fi, f] of mesh.faces.entries()) {
    const points = f.map((i) => at(mesh.vertices, i));
    const n = normal(points);
    const abs = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)];
    const axis = abs.indexOf(Math.max(...abs));
    const projected = points.map((p) =>
      axis === 0
        ? new T.Vector2(p.y, p.z)
        : axis === 1
          ? new T.Vector2(p.z, p.x)
          : new T.Vector2(p.x, p.y),
    );
    for (const [a, b, c] of T.ShapeUtils.triangulateShape(projected, [])) {
      const fa = at(f, a ?? 0);
      const fb = at(f, b ?? 0);
      const fc = at(f, c ?? 0);
      faces.push(at(source, fi));
      if (n.getComponent(axis) < 0) index.push(fc, fb, fa);
      else index.push(fa, fb, fc);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute(
    "position",
    new T.Float32BufferAttribute(
      mesh.vertices.flatMap((v) => v.toArray()),
      3,
    ),
  );
  geometry.setAttribute(
    "uv",
    new T.Float32BufferAttribute(
      uv
        ? uv.vertices.flatMap((v) => [v.x, v.y])
        : mesh.vertices.flatMap((v) => [v.x + 0.5, v.y + 0.5]),
      2,
    ),
  );
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return { geometry, faces };
}
