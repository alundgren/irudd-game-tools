// Pelt locks: rooted guides grown from a fur undercoat, as a shag mantle
// makes. At the game mesh budget their fibres become fewer, wider clumps,
// and part of the budget roots short tufts over the undercoat between them.
// Ported from character-view/creature-pelt.js at 2761eb1, arithmetic and
// draws in the same order.

import * as T from "three";
import type { FigureFibres } from "@irudd/document";
import { randomStream } from "../random.js";
import type { BlendOwners } from "./blend.js";

export const peltGame = {
  /** Of the pelt triangles, the share spent on guard clumps. */
  guardShare: 0.6,
  clumpSpans: 7,
  /** Of the mean lock length. */
  tuftLength: 0.34,
} as const;
export const clumpTriangles = (spans: number): number => 6 * spans + 2;
const tuftTriangles = 9;

/** Strands kept on one guide in a game build, the spans each keeps, and a pelt lock's clump width. */
export interface FibreDetail {
  readonly count: number;
  readonly spans: number;
  readonly clump?: number;
}

const at = <V>(list: ArrayLike<V>, i: number): V => {
  const v = list[i];
  if (v === undefined) throw new Error("Pelt index out of range.");
  return v;
};

/**
 * Divide the triangles the strand budget gave the pelt between clumps per
 * lock and one tuft pool for the undercoats.
 */
export function peltGameDetail(
  guides: ReadonlyArray<{ readonly id: string; readonly fibres: FigureFibres }>,
  triangles: number,
): { detail: Map<string, FibreDetail>; tufts: number } {
  if (!guides.length) return { detail: new Map(), tufts: 0 };
  const spans = Math.min(peltGame.clumpSpans, Math.floor((triangles / guides.length - 2) / 6));
  const total = guides.reduce((n, p) => n + p.fibres.count, 0);
  const clumps = Math.min(
    total,
    Math.max(guides.length, Math.floor((triangles * peltGame.guardShare) / clumpTriangles(spans))),
  );
  const detail = new Map<string, FibreDetail>();
  let given = 0;
  guides.forEach((p, i) => {
    const remainingLocks = guides.length - i - 1;
    const available = clumps - given - remainingLocks;
    const share = remainingLocks ? Math.round((clumps * p.fibres.count) / total) : available;
    const count = Math.max(1, Math.min(p.fibres.count, available, share));
    given += count;
    detail.set(p.id, {
      count,
      spans,
      clump: Math.pow(p.fibres.count / count, 0.55),
    });
  });
  const used = [...detail.values()].reduce((n, d) => n + d.count * clumpTriangles(spans), 0);
  return {
    detail,
    tufts: Math.max(0, Math.floor((triangles - used) / tuftTriangles)),
  };
}

/** A pelt lock in world space, before its guide becomes fibres. */
export interface PeltLock {
  readonly mesh: T.Mesh;
  readonly root: T.Vector3;
  readonly flow: T.Vector3;
  readonly length: number;
  readonly colour: T.Color;
}

export interface Tufts {
  readonly pos: number[];
  readonly col: number[];
  readonly idx: number[];
}

interface Facet {
  readonly a: T.Vector3;
  readonly b: T.Vector3;
  readonly c: T.Vector3;
  readonly n: T.Vector3;
  readonly cum: number;
}

/**
 * Short tapered tufts rooted on the undercoat, leaning with the nearest
 * locks. Each tuft is three-sided: a buried root ring, a mid ring and a
 * point. Returns per-lock arrays in the lock mesh's local frame.
 */
export function undercoatTufts(
  undercoat: T.Mesh,
  locks: ReadonlyArray<PeltLock>,
  count: number,
  seed: number,
  coatColour: T.ColorRepresentation,
): Map<T.Mesh, Tufts> {
  const out = new Map<T.Mesh, Tufts>(locks.map((l) => [l.mesh, { pos: [], col: [], idx: [] }]));
  const first = locks[0];
  if (!count || !first) return out;
  const g = undercoat.geometry;
  const p = g.getAttribute("position");
  const index = g.index;
  const m = undercoat.matrixWorld;
  const up = new T.Vector3(0, 1, 0);
  const tris: Facet[] = [];
  let area = 0;
  const a = new T.Vector3();
  const b = new T.Vector3();
  const c = new T.Vector3();
  const n = new T.Vector3();
  const vertex = (i: number): number => (index ? index.getX(i) : i);
  for (let i = 0, k = index?.count ?? p.count; i < k; i += 3) {
    a.fromBufferAttribute(p, vertex(i)).applyMatrix4(m);
    b.fromBufferAttribute(p, vertex(i + 1)).applyMatrix4(m);
    c.fromBufferAttribute(p, vertex(i + 2)).applyMatrix4(m);
    n.subVectors(c, b).cross(new T.Vector3().subVectors(a, b));
    const s = n.length() / 2;
    if (s < 1e-12) continue;
    n.normalize();
    // The lower half of the undercoat sits inside the trunk.
    if (n.dot(up) < -0.15) continue;
    area += s;
    tris.push({
      a: a.clone(),
      b: b.clone(),
      c: c.clone(),
      n: n.clone(),
      cum: area,
    });
  }
  if (!tris.length) return out;
  const random = randomStream(seed);
  const spacing = Math.sqrt(area / count);
  const meanLength = locks.reduce((s, l) => s + l.length, 0) / locks.length;
  const deep = new T.Color(coatColour).multiplyScalar(0.5);
  const body = new T.Color(coatColour);
  const point = new T.Vector3();
  const flow = new T.Vector3();
  const across = new T.Vector3();
  for (let t = 0; t < count; t++) {
    const r = random() * area;
    let lo = 0;
    let hi = tris.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (at(tris, mid).cum < r) lo = mid + 1;
      else hi = mid;
    }
    const tri = at(tris, lo);
    let u = random();
    let v = random();
    if (u + v > 1) [u, v] = [1 - u, 1 - v];
    point
      .copy(tri.a)
      .addScaledVector(new T.Vector3().subVectors(tri.b, tri.a), u)
      .addScaledVector(new T.Vector3().subVectors(tri.c, tri.a), v);
    // Inverse-square blend of the lock directions near this root.
    flow.set(0, 0, 0);
    let nearest = first;
    let best = Infinity;
    for (const l of locks) {
      const d2 = point.distanceToSquared(l.root) + 1e-8;
      flow.addScaledVector(l.flow, 1 / d2);
      if (d2 < best) {
        best = d2;
        nearest = l;
      }
    }
    flow.addScaledVector(tri.n, -flow.dot(tri.n)).normalize();
    if (!Number.isFinite(flow.x)) continue;
    across.crossVectors(flow, tri.n).normalize();
    const length = meanLength * peltGame.tuftLength * (0.65 + 0.7 * random());
    const width = spacing * (0.55 + 0.25 * random());
    const lift = 0.08 + 0.16 * random();
    const bend = (random() - 0.5) * 0.5;
    const value = 0.88 + 0.24 * random();
    const dir = flow
      .clone()
      .multiplyScalar(Math.sqrt(1 - lift * lift))
      .addScaledVector(tri.n, lift)
      .addScaledVector(across, bend * 0.3)
      .normalize();
    const root = point.clone().addScaledVector(tri.n, -0.12 * width);
    const mid = point
      .clone()
      .addScaledVector(dir, length * 0.45)
      .addScaledVector(tri.n, length * 0.04);
    const tip = point
      .clone()
      .addScaledVector(dir, length)
      .addScaledVector(tri.n, -length * 0.06);
    const tipColour = body
      .clone()
      .lerp(nearest.colour, 0.55)
      .multiplyScalar(value * 1.06);
    const rings: ReadonlyArray<readonly [T.Vector3, number, T.Color]> = [
      [root, width * 0.62, deep.clone().multiplyScalar(value)],
      [mid, width * 0.4, body.clone().lerp(nearest.colour, 0.25).multiplyScalar(value)],
    ];
    const target = out.get(nearest.mesh);
    if (!target) continue;
    const local = nearest.mesh.matrixWorld.clone().invert();
    const base = target.pos.length / 3;
    for (const [centre, w, colour] of rings)
      for (let s = 0; s < 3; s++) {
        const angle = (s * 2 * Math.PI) / 3;
        const q = centre
          .clone()
          .addScaledVector(across, w * Math.cos(angle))
          .addScaledVector(tri.n, 0.45 * w * Math.sin(angle))
          .applyMatrix4(local);
        target.pos.push(q.x, q.y, q.z);
        target.col.push(colour.r, colour.g, colour.b);
      }
    const q = tip.clone().applyMatrix4(local);
    target.pos.push(q.x, q.y, q.z);
    target.col.push(tipColour.r, tipColour.g, tipColour.b);
    for (let s = 0; s < 3; s++) {
      const s1 = (s + 1) % 3;
      target.idx.push(base + s, base + s1, base + 3 + s, base + s1, base + 3 + s1, base + 3 + s);
      target.idx.push(base + 3 + s, base + 3 + s1, base + 6);
    }
  }
  return out;
}

/** Append tufts to a lock's strand geometry; tuft vertices take the lock root's joint owners. */
export function appendTufts(
  geometry: T.BufferGeometry,
  owners: BlendOwners | undefined,
  tufts: Tufts | undefined,
): { geometry: T.BufferGeometry; owners: BlendOwners | undefined } {
  const index = geometry.index;
  if (!tufts?.idx.length || !index) return { geometry, owners };
  const position = geometry.getAttribute("position");
  const color = geometry.getAttribute("color");
  const uv = geometry.getAttribute("uv");
  if (
    !(position instanceof T.BufferAttribute) ||
    !(color instanceof T.BufferAttribute) ||
    !(uv instanceof T.BufferAttribute)
  )
    throw new Error("Pelt tufts join plain strand attributes.");
  const first = position.count;
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute([...position.array, ...tufts.pos], 3));
  g.setAttribute("color", new T.Float32BufferAttribute([...color.array, ...tufts.col], 3));
  g.setAttribute(
    "uv",
    new T.Float32BufferAttribute([...uv.array, ...new Float32Array((tufts.pos.length / 3) * 2)], 2),
  );
  g.setIndex([...index.array, ...tufts.idx.map((i) => i + first)]);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  geometry.dispose();
  if (!owners) return { geometry: g, owners };
  const extra = tufts.pos.length / 3;
  const grow = <A extends Uint8Array | Float32Array>(a: A, next: A): A => {
    next.set(a);
    next.fill(at(a, 0), a.length);
    return next;
  };
  return {
    geometry: g,
    owners: {
      ids: owners.ids,
      first: grow(owners.first, new Uint8Array(owners.first.length + extra)),
      second: grow(owners.second, new Uint8Array(owners.second.length + extra)),
      weight: grow(owners.weight, new Float32Array(owners.weight.length + extra)),
    },
  };
}
