// figure.cage: a part built from a control cage, subdivided into a smooth surface.
//
// Ported from checkCage in character-view/control-cage.js at 2761eb1. The
// topology rules are part of the document's validation, so a builder only
// ever sees a cage it can subdivide: faces meet along oppositely wound edges,
// open edges form continuous borders and separate surfaces never touch at a
// single vertex.

import { Schema } from "effect";
import { cross, sub, add, dot, type Vec3 } from "../geometry.js";
import { bounded, family } from "./family.js";

const edgeKey = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`);

const Index = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 191 }));

export const FigureCage = Schema.Struct({
  /** Control points in the part frame. */
  vertices: Schema.Array(
    Schema.Tuple([bounded(-12, 12), bounded(-12, 12), bounded(-12, 12)]),
  ).check(Schema.isMinLength(3), Schema.isMaxLength(192)),
  /** Polygons of 3–8 distinct control points. */
  faces: Schema.Array(
    Schema.Array(Index).check(Schema.isMinLength(3), Schema.isMaxLength(8)),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  /** Catmull–Clark steps; 0 keeps the cage faceted. Defaults to 1. */
  levels: Schema.optionalKey(Schema.Literals([0, 1, 2])),
  /** Edges kept sharp through subdivision. */
  creases: Schema.optionalKey(Schema.Array(Schema.Tuple([Index, Index]))),
}).check(Schema.makeFilter((cage) => cageProblem(cage) ?? true));
export type FigureCage = typeof FigureCage.Type;

interface Edge {
  readonly a: number;
  readonly b: number;
  readonly faces: number[];
}

function faceNormal(points: ReadonlyArray<Vec3>): Vec3 {
  const origin = points[0];
  let n: Vec3 = [0, 0, 0];
  if (!origin) return n;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const q = points[i + 1];
    if (p && q) n = add(n, cross(sub(p, origin), sub(q, origin)));
  }
  return n;
}

/** The first topology rule a cage breaks, or undefined. */
export function cageProblem(cage: {
  readonly vertices: ReadonlyArray<Vec3>;
  readonly faces: ReadonlyArray<ReadonlyArray<number>>;
  readonly creases?: ReadonlyArray<readonly [number, number]>;
}): string | undefined {
  const { vertices, faces } = cage;
  const known = new Set<string>();
  for (const f of faces) {
    if (new Set(f).size !== f.length || f.some((i) => i >= vertices.length))
      return "A cage face needs 3–8 distinct vertex indices.";
    const id = [...f].sort((a, b) => a - b).join(",");
    const n = faceNormal(f.map((i) => vertices[i] ?? [0, 0, 0]));
    if (known.has(id) || dot(n, n) < 1e-16) return "A cage face is repeated or has zero area.";
    known.add(id);
  }
  const edges = new Map<string, Edge>();
  const faceRings = vertices.map((): number[] => []);
  const edgeRings = vertices.map((): Edge[] => []);
  for (const [fi, face] of faces.entries())
    for (const [i, a] of face.entries()) {
      faceRings[a]?.push(fi);
      const b = face[(i + 1) % face.length] ?? a;
      const id = edgeKey(a, b);
      let edge = edges.get(id);
      if (!edge) {
        edge = { a, b, faces: [] };
        edges.set(id, edge);
        edgeRings[a]?.push(edge);
        edgeRings[b]?.push(edge);
      } else if (edge.faces.length === 2 || edge.a === a)
        return "Faces must meet along oppositely wound edges.";
      edge.faces.push(fi);
    }
  for (let i = 0; i < vertices.length; i++) {
    const ring = faceRings[i] ?? [];
    const first = ring[0];
    if (first === undefined) return "Every cage point must belong to a face.";
    const adjacent = edgeRings[i] ?? [];
    const boundary = adjacent.filter((e) => e.faces.length === 1).length;
    if (boundary !== 0 && boundary !== 2) return "An open cage edge must form a continuous border.";
    const links = new Map<number, number[]>(ring.map((f) => [f, []]));
    for (const e of adjacent) {
      const [a, b] = e.faces;
      if (a !== undefined && b !== undefined) {
        links.get(a)?.push(b);
        links.get(b)?.push(a);
      }
    }
    const found = new Set([first]);
    const pending = [first];
    for (let f = pending.pop(); f !== undefined; f = pending.pop())
      for (const n of links.get(f) ?? [])
        if (!found.has(n)) {
          found.add(n);
          pending.push(n);
        }
    if (found.size !== ring.length) return "Separate surfaces may not meet at only one vertex.";
  }
  const creases = cage.creases ?? [];
  if (
    creases.length > edges.size ||
    creases.some(([a, b]) => !edges.has(edgeKey(a, b))) ||
    new Set(creases.map(([a, b]) => edgeKey(a, b))).size !== creases.length
  )
    return "Choose existing, distinct cage edges for creases.";
  return undefined;
}

export const figureCage = family({
  id: "figure.cage",
  version: 1,
  scope: "part",
  schema: FigureCage,
  toJson: (v) => v,
});
